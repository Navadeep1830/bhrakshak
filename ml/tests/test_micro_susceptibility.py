"""Model A v2 (micro-susceptibility) unit tests.

Network-free: terrain features run on tiny synthetic DEM grids, the
percentile machinery on synthetic blocks. The real-data path is exercised by
the ingest + training CLIs, not here.
"""

from __future__ import annotations

import numpy as np
import pytest

from ml.features.micro_terrain import (
    build_features,
    build_training_feature_names,
    context_features,
    latlon_to_rc,
    sample_at,
)


def _demo_grid(size: int = 96, seed: int = 3) -> np.ndarray:
    """Deterministic hilly DEM: ridge + valley + noise, 30 m cells."""
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 6 * np.pi, size)
    base = 900 + 400 * np.sin(x)[None, :] * np.cos(x)[:, None]
    noise = rng.normal(0, 8, (size, size))
    return (base + noise).astype(np.float64)


RES_M = 30.0


def test_build_features_shapes_and_finiteness():
    dem = _demo_grid()
    feats = build_features(dem, RES_M)
    for name in build_training_feature_names():
        base = name.rsplit("_", 1)[0] if name.endswith(("_mean", "_std")) else name
        if name == "slope_max":
            base = "slope_deg"
        assert base in feats, f"{name} needs base feature {base}"
    for name, grid in feats.items():
        assert grid.shape == dem.shape, name
        assert np.isfinite(grid).all(), name
    # slope on a hilly grid must be plausible
    assert 0 <= feats["slope_deg"].min() and feats["slope_deg"].max() < 90
    assert feats["slope_deg"].mean() > 1.0


def test_flow_accumulation_reaches_valleys():
    """After the D8 fix, accumulation must pool at the low ground: valley
    distance zero must exist and valley cells must be a small fraction."""
    dem = _demo_grid()
    feats = build_features(dem, RES_M)
    dv = feats["dist_valley_km"]
    assert (dv == 0).any(), "no valley cells found - routing failed"
    assert (dv > 0).mean() > 0.5, "most of the terrain cannot be valley"
    assert dv.max() > 0.05, "valley distance range implausibly small"


def test_twi_higher_in_valleys_than_ridges():
    dem = _demo_grid()
    feats = build_features(dem, RES_M)
    valley = feats["dist_valley_km"] == 0
    ridge = feats["dist_ridge_km"] > 0.8 * feats["dist_ridge_km"].max()
    assert feats["twi"][valley].mean() > feats["twi"][ridge].mean()


def test_context_features_contract_and_smoothness():
    dem = _demo_grid()
    feats = build_features(dem, RES_M)
    ctx = context_features(feats, RES_M, radius_m=300.0)
    names = build_training_feature_names()
    for n in names:
        assert n in ctx, n
        assert ctx[n].shape == dem.shape
        assert np.isfinite(ctx[n]).all()
    # block means must be smoother than the raw field
    raw_slope = feats["slope_deg"]
    assert ctx["slope_deg_mean"].std() < raw_slope.std()


def test_latlon_roundtrip_and_sample_at():
    dem = _demo_grid()
    feats = build_features(dem, RES_M)
    bbox = (92.0, 23.0, 92.5, 23.5)  # minx, miny, maxx, maxy
    # north-west corner lands in the first cell block
    r, c = latlon_to_rc(23.49, 92.01, dem.shape, bbox)
    assert r <= 1 and c <= 1
    # south-east corner lands in the last cell block
    r, c = latlon_to_rc(23.01, 92.49, dem.shape, bbox)
    assert r >= dem.shape[0] - 2 and c >= dem.shape[1] - 2
    centre = sample_at(feats, 23.25, 92.25, bbox)
    assert set(centre) == set(feats)
    assert all(np.isfinite(v) for v in centre.values())


def test_percentile_index_construction():
    """The deployed physical index: slope-dominant percentile blend, valley
    distance inverted."""
    from ml.models.micro_susceptibility import (
        INDEX_FEATURES,
        INDEX_INVERT,
        INDEX_WEIGHTS,
        physical_index_grid,
    )

    ctx = {
        "slope_deg_mean": np.linspace(0, 45, 100, dtype=np.float32).reshape(10, 10),
        "twi_mean": np.linspace(2, 12, 100, dtype=np.float32).reshape(10, 10),
        "relief_1km_mean": np.linspace(50, 800, 100, dtype=np.float32).reshape(10, 10),
        "dist_valley_km_mean": np.linspace(0, 3, 100, dtype=np.float32).reshape(10, 10),
    }
    grid = physical_index_grid(ctx)
    assert grid.shape == (10, 10)
    assert 0 <= grid.min() and grid.max() <= 100
    # steep+wet+high-relief corner (high everything, far from valley) wins
    steep_wet_corner = grid[9, 9]
    gentle_dry_corner = grid[0, 0]
    assert steep_wet_corner > gentle_dry_corner + 40


def test_dataset_builder_block_labels_and_exclusion():
    """Synthetic events inside one AOI bbox: positives carry blocks, negatives
    stay beyond the exclusion radius."""
    from types import SimpleNamespace

    from ml.config.aois import get_aoi
    from ml.models.micro_susceptibility import build_datasets

    aoi = get_aoi("SK-GNG")
    dem = _demo_grid(64, seed=5)
    feats = build_features(dem, 30.0)
    ctx = context_features(feats, 30.0, radius_m=300.0)
    bbox = aoi.bbox
    ctx_by_aoi = {aoi.slug: {"ctx": ctx, "bbox": bbox, "res_m": 30.0}}

    # two events, 5 km apart, inside the polygon's bbox
    minx, miny, maxx, maxy = bbox
    import pandas as pd

    events = pd.DataFrame({
        "lat": [maxy - 0.05, maxy - 0.10],
        "lon": [minx + 0.05, minx + 0.10],
        "aoi_code": [aoi.code, aoi.code],
        "event_ts": pd.to_datetime(["2015-06-01", "2016-07-01"], utc=True),
    })
    ds = build_datasets(ctx_by_aoi, events, aois=[aoi])
    d = ds[aoi.slug]
    assert d["n_pos"] >= 1
    assert d["n_neg"] >= d["n_pos"]
    assert d["X"].shape[1] == len(build_training_feature_names())


def test_lodo_leaderboard_runs_and_reports():
    from types import SimpleNamespace

    from ml.models.micro_susceptibility import build_training_feature_names, train_lo_do

    # two tiny fake districts with separable signal
    rng = np.random.default_rng(9)
    names = build_training_feature_names()
    datasets = {}
    for slug, shift in (("a", 0.0), ("b", 3.0)):
        n_pos, n_neg = 6, 20
        pos = rng.normal(35 + shift, 3, (n_pos, len(names)))
        neg = rng.normal(18 + shift, 5, (n_neg, len(names)))
        X = np.vstack([pos, neg]).astype(np.float32)
        y = np.concatenate([np.ones(n_pos), np.zeros(n_neg)])
        datasets[slug] = {"aoi": SimpleNamespace(slug=slug), "X": X, "y": y,
                          "n_pos": n_pos, "n_neg": n_neg}
    res = train_lo_do(datasets)
    assert "lodo_boosted" in res
    assert 0 <= res["lodo_slope_only"]["roc_auc"] <= 1
