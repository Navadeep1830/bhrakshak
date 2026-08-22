"""Model B - Hazard Nowcast: LightGBM + isotonic calibration + I-D threshold fusion,
temporal split (train <=2019 / val 2020-22 / test 2023-24)."""

import json
from pathlib import Path

import numpy as np

from ml.registry.registry import save_artifact_meta, write_model_card

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"

ZONE_FEATURES = [
    "rain_1h", "rain_24h", "rain_48h", "rain_72h", "rain_7d", "eff_rain",
    "soil_moisture", "susc_mean", "susc_p90", "susc_high_frac", "seismic_flag",
    "verified_reports_7d",
]


def make_zone_dataset(n: int = 24000, seed: int = 21):
    """Synthetic zone-days across 2015-2024 with a monsoon-driven failure process."""
    rng = np.random.default_rng(seed)
    years = rng.integers(2015, 2025, n)
    month = rng.integers(1, 13, n)
    monsoon = np.isin(month, [5, 6, 7, 8, 9]).astype(float)

    rain24 = rng.gamma(0.9, 40, n) * monsoon
    rain1h = np.clip(rain24 / rng.uniform(4, 18, n), 0, 90)
    eff = rain24 * rng.uniform(0.5, 0.95, n)
    soil = np.clip(35 + 55 * monsoon * rng.uniform(0.7, 1.1, n), 5, 98)
    susc = rng.uniform(30, 95, n)
    seismic = (rng.random(n) < 0.02).astype(float)
    reports = rng.poisson(monsoon * 0.8)

    logit = (
        -7.2
        + 0.021 * rain24 + 0.03 * rain1h + 0.008 * eff
        + 0.045 * soil + 0.05 * susc
        + 1.4 * seismic + 0.25 * reports
        - 0.00012 * rain24 * susc
    )
    p = 1 / (1 + np.exp(-logit))
    y = (rng.random(n) < p).astype(int)

    X = np.column_stack([rain1h, rain24, rain24 * 1.3, rain24 * 1.6, rain24 * 2.1,
                         eff, soil, susc, susc + rng.normal(0, 4, n),
                         np.clip(susc / 100, 0, 1), seismic, reports])
    return X, y, years


def get_model():
    try:
        from lightgbm import LGBMClassifier
        return LGBMClassifier(n_estimators=400, num_leaves=48, learning_rate=0.06,
                              scale_pos_weight=8, n_jobs=4, verbose=-1)
    except ImportError:
        from sklearn.ensemble import HistGradientBoostingClassifier
        return HistGradientBoostingClassifier(max_iter=400)


def main() -> None:
    from sklearn.calibration import IsotonicRegression
    from sklearn.metrics import brier_score_loss, roc_auc_score

    X, y, years = make_zone_dataset()
    train, val, test = years <= 2019, (years >= 2020) & (years <= 2022), years >= 2023
    print(f"zone-days: train {train.sum()} | val {val.sum()} | test {test.sum()} | positives {y.sum()}")

    model = get_model().fit(X[train], y[train])

    # isotonic calibration on validation so probabilities mean what they say
    val_p_raw = model.predict_proba(X[val])[:, 1]
    calib = IsotonicRegression(out_of_bounds="clip").fit(val_p_raw, y[val])

    test_p = calib.predict(model.predict_proba(X[test])[:, 1])
    metrics = {
        "split": {"train": "<=2019", "val": "2020-2022", "test": "2023-2024"},
        "test_auc": round(float(roc_auc_score(y[test], test_p)), 3),
        "test_brier": round(float(brier_score_loss(y[test], test_p)), 4),
        "calibration": "isotonic",
        "fusion_rule": "level = max(threshold_tier, calibrated_ml_tier)",
    }
    print(f"TEST AUC {metrics['test_auc']} | Brier {metrics['test_brier']}")

    save_artifact_meta("hazard_nowcast", "v0-synthetic-temporal-split", metrics,
                       notes="SYNTHETIC zone-days until inventory+ERA5 join lands")
    write_model_card(
        "B-hazard-nowcast",
        "Dynamic WHEN: P(landslide in zone within 24h); fused with interpretable I-D thresholds; "
        "hysteresis escalate x2 / de-escalate x3",
        ZONE_FEATURES, metrics,
        "Temporal split guards against leakage but event counts are small per district; "
        "probabilities are calibrated only for the pilot domain.",
    )


if __name__ == "__main__":
    main()
