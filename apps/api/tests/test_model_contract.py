"""test_model_contract.py - Model B bundle provenance + feature contract.

The API used to serve whatever `ml_models/model_b_nowcast.pkl` happened to be
on disk. The version in the repo was `v1.0-autoresearch-champion`: trained by
autoresearch on labels that prepare.py generates itself, with LightGBM
feature names `Column_0..Column_15`, and no metrics or git SHA. Nothing
downstream could tell that apart from a model fitted on real inventories.

These tests pin the guardrails:

  1. a bundle that cannot name its features is rejected;
  2. a bundle flagged synthetic is rejected;
  3. a bundle missing required keys is rejected;
  4. a well-formed bundle with named features is accepted;
  5. inference never invents a feature the observation row did not measure.

They run without a database and without lightgbm/xgboost installed.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

from app.services import risk_engine as re


class _FakeModel:
    """Stands in for an LGBM/XGB classifier; returns a fixed positive prob."""

    def __init__(self, p=0.7):
        self.p = p

    def predict_proba(self, X):
        return np.column_stack([1.0 - np.full(len(X), self.p), np.full(len(X), self.p)])


class _FakeScaler:
    def transform(self, X):
        return X


class _FakeCalibrator:
    def predict(self, raw):
        return np.asarray(raw, dtype=float)


def _bundle(**overrides):
    b = {
        "version": "test-1.0",
        "scaler": _FakeScaler(),
        "lgbm": _FakeModel(0.7),
        "xgb": _FakeModel(0.6),
        "calibrator": _FakeCalibrator(),
        "weights": (0.5, 0.5),
        "features": ["rain_24h", "rain_1h", "susc_p90"],
        "metrics": {"pod": 0.6, "far": 0.3},
        "git_sha": "abc123",
    }
    b.update(overrides)
    return b


@pytest.fixture(autouse=True)
def _reset_bundle_cache(monkeypatch):
    """Point the loader at a temp path and clear memoised state each test."""
    monkeypatch.setattr(re, "MODEL_B_PATH", Path("/nonexistent/model_b.pkl"))
    monkeypatch.setattr(re, "_MODEL_B_BUNDLE", None)
    monkeypatch.setattr(re, "_MODEL_B_REJECTED", False)
    yield
    monkeypatch.setattr(re, "_MODEL_B_BUNDLE", None)
    monkeypatch.setattr(re, "_MODEL_B_REJECTED", False)


def _serve(monkeypatch, bundle_or_exc):
    """Make `import joblib; joblib.load(...)` inside the loader return `bundle`.

    risk_engine imports joblib lazily (so the API still boots without the ML
    stack), which means there is no module attribute to patch -- the fake has
    to go into sys.modules.

    MODEL_B_PATH must point at a file that really exists, or the loader
    short-circuits on `not exists()` and returns None without ever reaching
    the validation -- which would make every rejection test below pass for the
    wrong reason.
    """
    monkeypatch.setattr(re, "MODEL_B_PATH", Path(__file__).resolve())
    assert re.MODEL_B_PATH.exists()

    def load(_path):
        if isinstance(bundle_or_exc, Exception):
            raise bundle_or_exc
        return bundle_or_exc

    monkeypatch.setitem(sys.modules, "joblib", type("m", (), {"load": staticmethod(load)}))


def test_placeholder_feature_names_are_rejected(monkeypatch):
    """`Column_0..Column_n` means there is no contract with this call site."""
    _serve(monkeypatch, _bundle(features=[f"Column_{i}" for i in range(16)]))
    assert re.get_model_b_bundle() is None
    assert re.active_model_version() == "physical-prior-v1"


def test_synthetic_flagged_bundle_is_rejected(monkeypatch):
    """A model trained on generated labels must never reach production."""
    _serve(monkeypatch, _bundle(synthetic=True))
    assert re.get_model_b_bundle() is None


def test_missing_keys_are_rejected(monkeypatch):
    incomplete = _bundle()
    del incomplete["calibrator"]
    _serve(monkeypatch, incomplete)
    assert re.get_model_b_bundle() is None


def test_unloadable_bundle_is_rejected(monkeypatch):
    """A corrupt or version-incompatible pickle must not crash the request."""
    _serve(monkeypatch, ValueError("input stream corrupted"))
    assert re.get_model_b_bundle() is None


def test_well_formed_bundle_is_accepted(monkeypatch):
    good = _bundle()
    _serve(monkeypatch, good)
    loaded = re.get_model_b_bundle()
    assert loaded is good
    assert re.active_model_version() == "test-1.0"


def test_features_are_ordered_by_the_bundle_not_by_the_caller(monkeypatch):
    """The vector must be built in the bundle's order, not a hardcoded one."""
    seen = {}

    class RecordingScaler:
        def transform(self, X):
            seen["row"] = X[0].tolist()
            return X

    # Deliberately a scrambled order relative to how the caller names things.
    _serve(
        monkeypatch,
        _bundle(features=["susc_p90", "rain_1h", "rain_24h"], scaler=RecordingScaler()),
    )
    from app.models import Zone

    zone = Zone(id=None, zone_code="T", susc_mean=80.0, susc_p90=88.0)
    re.predict_model_b(rain_1h=10.0, rain_24h=100.0, soil_moisture=None, zone=zone)
    assert seen["row"] == pytest.approx([88.0, 10.0, 100.0])


def test_missing_features_fall_back_instead_of_being_invented(monkeypatch):
    """A bundle needing rain_7d must not be fed a guessed rain_7d."""
    _serve(monkeypatch, _bundle(features=["rain_7d", "rain_24h"]))
    from app.models import Zone

    zone = Zone(id=None, zone_code="T", susc_mean=50.0, susc_p90=60.0)

    # No observation row -> rain_7d genuinely unmeasured.
    prob, drivers = re.predict_model_b(
        rain_1h=5.0, rain_24h=100.0, soil_moisture=None, zone=zone
    )
    # predict_model_b rounds to 4dp for storage, so compare with that tolerance.
    assert prob == pytest.approx(re._physical_prob(5.0, 100.0, 60.0), abs=1e-4)
    assert all(d["missing"] for d in drivers if d["feature"] == "7d Antecedent Rain")

    # With a row carrying rain_7d, the bundle is allowed to run.
    class Obs:
        rain_7d = 300.0

    prob2, drivers2 = re.predict_model_b(
        rain_1h=5.0, rain_24h=100.0, soil_moisture=None, zone=zone, antecedent=Obs()
    )
    assert prob2 == pytest.approx(0.65)  # 0.5*0.7 + 0.5*0.6
    assert not any(d["missing"] for d in drivers2 if d["feature"] == "7d Antecedent Rain")


def test_insar_driver_absent_unless_measured():
    """Layer-3 deformation used to be derived from the susceptibility score."""
    from app.models import Zone

    zone = Zone(id=None, zone_code="T", susc_mean=80.0, susc_p90=90.0)
    _, without = re.predict_model_b(1.0, 10.0, None, zone)
    assert not any("InSAR" in d["feature"] for d in without)

    _, with_insar = re.predict_model_b(
        1.0, 10.0, None, zone, insar_velocity_mm_yr=-12.0
    )
    assert any("InSAR" in d["feature"] for d in with_insar)


def test_unmeasured_soil_is_not_defaulted():
    """The old code substituted 45.0% when soil moisture was unknown."""
    from app.models import Zone

    zone = Zone(id=None, zone_code="T", susc_mean=50.0, susc_p90=60.0)
    _, drivers = re.predict_model_b(1.0, 10.0, None, zone)
    soil = next(d for d in drivers if d["feature"] == "Soil Saturation")
    assert soil["missing"] is True
    assert soil["value"] == "n/a"
    assert soil["val_num"] is None
