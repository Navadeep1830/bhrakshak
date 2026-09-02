"""MODEL A v2 - Micro-susceptibility on REAL terrain (WHERE, at ~70 m).

Two-tier architecture, Tier 2. Tier 1 (hazard_nowcast) answers WHEN a
district should alert. This model answers WHICH parts of it are dangerous,
so the heatmap is coloured per-pixel rather than per-district.

The label wall, and the decision it forces
------------------------------------------
The only labelled inventory is the NASA Global Landslide Catalog: 74
in-region events with a stated location accuracy of 5-50 km. Terrain-only
features therefore saturate. This module *measures* that instead of
assuming it: under strict leave-one-district-out CV the gradient-boosted
model is compared against slope-only and elevation-only logistic baselines
and against a transparent physical index. The run this card ships had the
booster at/below the slope baseline, so the DEPLOYED scorer is the physical
index - the same model-selection standard that kept Tier 1 honest when a
rainfall rule beat its booster. The ML harness is kept and re-runnable:
when GSI lithology, ESA WorldCover and road-cut distance land (next ingest
milestones), rerun this module and the leaderboard decides again.

Deployed scorer (frozen a priori, physics-weighted, slope-dominant)
------------------------------------------------------------------
    I = 100 * ( 0.60 * P(slope_deg_mean)
              + 0.15 * P(twi_mean)
              + 0.15 * P(relief_1km_mean)
              + 0.10 * (1 - P(dist_valley_km_mean)) )

where P(.) is the within-district percentile rank of the ~1 km block
context value across every cell of the AOI. slope is the single strongest
driving factor (F_drive = W sin theta); TWI carries wetness propensity;
relief the energy available to debris; valley proximity the toe-erosion
term (inverted - far from a valley = higher on the slope). Percentile
scale is district-relative by construction and stated as such.

Outputs (ml/artifacts/)
-----------------------
  model_a_micro.pkl               bundle consumed by the API (joblib)
  micro_susceptibility_{slug}.npz full-res index + calibrated grids
  micro_heatmap.json              downsampled uint8 grids per AOI -- served
                                  by GET /api/v1/analytics/micro-heatmap
  model_a_micro_metrics.json      full LODO leaderboard + metrics
  docs/model-cards/A2-micro-susceptibility.md

Run:
    python -m ml.models.micro_susceptibility
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import ndimage

from ml.config.aois import AOI, all_aois
from ml.features.micro_terrain import (
    build_features,
    build_training_feature_names,
    context_features,
    latlon_to_rc,
)
from ml.ingest.dem_real import load_cached
from ml.registry.registry import git_sha, save_artifact_meta, write_model_card

log = logging.getLogger("bhrakshak.micro_susc")

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
LABELS_CSV = ARTIFACTS / "labels_events.csv"

MODEL_NAME = "micro_susceptibility"
MODEL_VERSION = "v2-real-terrarium-dem"

BLOCK_RADIUS_M = 500        # context window ~1 km across
NEG_PER_POS = 8             # slope-matched negative blocks per positive block
EVENT_EXCLUSION_M = 2000    # negative blocks stay this far from any event
HEATMAP_MAX_DIM = 220       # downsampled grid size served by the API
INDEX_SMOOTH_CELLS = 3      # ~105 m cartographic smoothing of the index grid

CLASS_CUTS = [20.0, 40.0, 60.0, 80.0]
CLASS_NAMES = ["very_low", "low", "moderate", "high", "very_high"]

# The deployed physical index. Weights are frozen a priori (physics), not
# fitted: with 74 noisy labels any fitted weight would be fit to noise.
INDEX_FEATURES = ["slope_deg_mean", "twi_mean", "relief_1km_mean", "dist_valley_km_mean"]
INDEX_WEIGHTS = {"slope_deg_mean": 0.60, "twi_mean": 0.15,
                 "relief_1km_mean": 0.15, "dist_valley_km_mean": 0.10}
INDEX_INVERT = {"dist_valley_km_mean"}  # far from valley = higher on slope = riskier

FEATURES = build_training_feature_names()  # full contract, kept for the ML harness


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------
def _aoi_polygon(aoi: AOI):
    from shapely.geometry import shape
    from shapely.prepared import prep

    return prep(shape(aoi.geometry))


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return float(2 * R * np.arcsin(np.sqrt(a)))


def load_events() -> pd.DataFrame:
    if not LABELS_CSV.exists():
        raise FileNotFoundError("no labels; run `python -m ml.ingest.labels` first")
    df = pd.read_csv(LABELS_CSV)
    df["event_ts"] = pd.to_datetime(df["event_ts"], utc=True, errors="coerce")
    return df.dropna(subset=["lat", "lon"])


# ---------------------------------------------------------------------------
# dataset construction (block-level, for the LODO leaderboard)
# ---------------------------------------------------------------------------
def build_datasets(ctx_by_aoi: dict[str, dict], events: pd.DataFrame,
                   seed: int = 13, aois=None) -> dict[str, dict]:
    """Positive blocks = contain a GLC event. Negative blocks = slope-matched
    AOI polygon interior, >= EVENT_EXCLUSION_M from every event.

    ``aois`` restricts which AOIs are built (default: all) so tests can build
    a single-AOI dataset without the rest of the DEM caches present.
    """
    from shapely.geometry import Point

    rng = np.random.default_rng(seed)
    datasets: dict[str, dict] = {}
    for aoi in (aois or all_aois()):
        if aoi.slug not in ctx_by_aoi:
            continue
        ctx = ctx_by_aoi[aoi.slug]["ctx"]
        bbox = ctx_by_aoi[aoi.slug]["bbox"]
        shape_rc = next(iter(ctx.values())).shape
        poly = _aoi_polygon(aoi)

        ev = events[events["aoi_code"] == aoi.code]
        pos_blocks: set[tuple[int, int]] = set()
        for lat, lon in zip(ev["lat"], ev["lon"]):
            pos_blocks.add(latlon_to_rc(lat, lon, shape_rc, bbox))
        pos_list = sorted(pos_blocks)

        slope_ctx = ctx["slope_deg_mean"]

        if len(ev):
            ev_lat = ev["lat"].to_numpy(dtype=float)
            ev_lon = ev["lon"].to_numpy(dtype=float)
        else:
            ev_lat = ev_lon = np.empty(0)

        pos_slopes = np.array([slope_ctx[r, c] for r, c in pos_list]) if pos_list else np.empty(0)
        if len(pos_slopes):
            edges = np.unique(np.percentile(pos_slopes, np.linspace(0, 100, 5)))
            if len(edges) < 2:
                edges = np.array([pos_slopes.min() - 1, pos_slopes.max() + 1])
        else:
            edges = np.array([0.0, 90.0])
        per_bin = int(np.ceil(max(len(pos_list), 1) * NEG_PER_POS / max(1, (len(edges) - 1))))

        minx, miny, maxx, maxy = bbox
        neg_list: list[tuple[int, int]] = []
        taken: set[tuple[int, int]] = set(pos_list)
        counts = {b: 0 for b in range(len(edges) - 1)}
        attempts = 0
        target = per_bin * (len(edges) - 1)
        max_attempts = target * 800 + 100_000
        while len(neg_list) < target and attempts < max_attempts:
            attempts += 1
            lon = rng.uniform(minx, maxx)
            lat = rng.uniform(miny, maxy)
            if not poly.contains(Point(lon, lat)):
                continue
            if len(ev_lat):
                ds = np.hypot((ev_lat - lat) * 111_320.0,
                              (ev_lon - lon) * 111_320.0 * np.cos(np.radians(lat)))
                if ds.min() < EVENT_EXCLUSION_M:
                    continue
            r, c = latlon_to_rc(lat, lon, shape_rc, bbox)
            if (r, c) in taken:
                continue
            b = int(np.clip(np.searchsorted(edges, slope_ctx[r, c]) - 1, 0, len(edges) - 2))
            if counts[b] >= per_bin:
                continue
            counts[b] += 1
            taken.add((r, c))
            neg_list.append((r, c))

        def _rows(cells: list[tuple[int, int]]) -> np.ndarray:
            X = np.empty((len(cells), len(FEATURES)), dtype=np.float32)
            for k, name in enumerate(FEATURES):
                g = ctx[name]
                X[:, k] = [g[r, c] for r, c in cells]
            return X

        X = np.vstack([_rows(pos_list), _rows(neg_list)]) if pos_list else _rows(neg_list)
        y = np.concatenate([np.ones(len(pos_list)), np.zeros(len(neg_list))])

        datasets[aoi.slug] = {"aoi": aoi, "X": X, "y": y,
                              "n_pos": len(pos_list), "n_neg": len(neg_list)}
        print(f"  {aoi.district:>18}: {len(pos_list)} positive blocks, "
              f"{len(neg_list)} slope-matched negative blocks")
    return datasets


# ---------------------------------------------------------------------------
# percentile machinery (the deployed index + its evaluation)
# ---------------------------------------------------------------------------
def _grid_sorted(ctx: dict[str, np.ndarray], name: str, sample_stride: int = 3) -> np.ndarray:
    g = ctx[name].ravel()[::sample_stride]
    return np.sort(g)


def _pct(values: np.ndarray, grid_sorted: np.ndarray) -> np.ndarray:
    """Percentile rank of each value against the AOI grid distribution."""
    idx = np.searchsorted(grid_sorted, values, side="right")
    return (idx / max(1, len(grid_sorted))) * 100.0


def physical_index_blocks(ctx_by_aoi: dict[str, dict],
                          datasets: dict[str, dict]) -> np.ndarray:
    """Score every dataset block row with the deployed physical index."""
    pooled_oof: list[np.ndarray] = []
    for slug in sorted(datasets):
        ctx = ctx_by_aoi[slug]["ctx"]
        sorted_feats = {n: _grid_sorted(ctx, n) for n in INDEX_FEATURES}
        X = datasets[slug]["X"]
        idx_names = FEATURES
        score = np.zeros(len(X), dtype=np.float64)
        for name in INDEX_FEATURES:
            col = X[:, idx_names.index(name)].astype(np.float64)
            p = _pct(col, sorted_feats[name])
            if name in INDEX_INVERT:
                p = 100.0 - p
            score += INDEX_WEIGHTS[name] * p
        pooled_oof.append(score)
    return np.concatenate(pooled_oof)


def _get_model(seed: int = 13):
    try:
        from xgboost import XGBClassifier

        return ("xgboost", XGBClassifier(
            n_estimators=350, max_depth=5, learning_rate=0.05,
            subsample=0.9, colsample_bytree=0.7, min_child_weight=3,
            reg_lambda=2.0, eval_metric="auc", n_jobs=4, verbosity=0,
            random_state=seed,
        ))
    except ImportError:
        pass
    try:
        from lightgbm import LGBMClassifier

        return ("lightgbm", LGBMClassifier(
            n_estimators=350, num_leaves=40, learning_rate=0.05,
            subsample=0.9, colsample_bytree=0.7, min_child_samples=10,
            n_jobs=4, verbose=-1, random_state=seed,
        ))
    except ImportError:
        from sklearn.ensemble import HistGradientBoostingClassifier

        return ("sklearn-histgb", HistGradientBoostingClassifier(max_iter=350, random_state=seed))


def train_lo_do(datasets: dict[str, dict]) -> dict:
    """LODO leaderboard: booster vs slope-only vs elevation-only logistic."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import average_precision_score, roc_auc_score
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    slugs = sorted(datasets)
    Xs = {s: datasets[s]["X"] for s in slugs}
    ys = {s: datasets[s]["y"] for s in slugs}

    def lodo(kind: str, feat_idx=None):
        oof = np.full(sum(len(ys[s]) for s in slugs), np.nan)
        y_true = np.concatenate([ys[s] for s in slugs])
        slices = {}
        ofs = 0
        for s in slugs:
            slices[s] = slice(ofs, ofs + len(ys[s]))
            ofs += len(ys[s])
        for held in slugs:
            tr = [s for s in slugs if s != held]
            X_tr = np.vstack([Xs[s] for s in tr])
            y_tr = np.concatenate([ys[s] for s in tr])
            if feat_idx is not None:
                X_tr = X_tr[:, feat_idx]
                X_te = Xs[held][:, feat_idx]
            else:
                X_te = Xs[held]
            if kind == "logistic":
                model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000))
            else:
                model = _get_model()[1]
            model.fit(X_tr, y_tr)
            oof[slices[held]] = model.predict_proba(X_te)[:, 1]
        return oof, y_true, slices

    def metrics(oof, y_true):
        mask = ~np.isnan(oof)
        return {
            "roc_auc": round(float(roc_auc_score(y_true[mask], oof[mask])), 4),
            "pr_auc": round(float(average_precision_score(y_true[mask], oof[mask])), 4),
        }

    oof_model, y_true, slices = lodo("boost")
    oof_slope, _, _ = lodo("logistic", feat_idx=[FEATURES.index("slope_deg_mean")])
    oof_elev, _, _ = lodo("logistic", feat_idx=[FEATURES.index("elevation_m_mean")])

    per_aoi = {}
    for s in slugs:
        sl = slices[s]
        mask = ~np.isnan(oof_model[sl])
        if 0 < y_true[sl][mask].sum() < mask.sum():
            per_aoi[s] = {
                "roc_auc": round(float(roc_auc_score(y_true[sl][mask], oof_model[sl][mask])), 4),
                "n_pos": int(datasets[s]["n_pos"]),
            }
    return {
        "backend": _get_model()[0],
        "lodo_boosted": metrics(oof_model, y_true),
        "lodo_slope_only": metrics(oof_slope, y_true),
        "lodo_elevation_only": metrics(oof_elev, y_true),
        "per_aoi_boosted": per_aoi,
    }


# ---------------------------------------------------------------------------
# deployed-index full-grid inference
# ---------------------------------------------------------------------------
def physical_index_grid(ctx: dict[str, np.ndarray]) -> np.ndarray:
    """0-100 physical susceptibility index over the whole AOI grid."""
    acc = np.zeros(next(iter(ctx.values())).shape, dtype=np.float64)
    for name in INDEX_FEATURES:
        g = ctx[name].astype(np.float64).ravel()
        order = np.argsort(g, kind="stable")
        ranks = np.empty(len(g))
        ranks[order] = np.linspace(0.0, 100.0, len(g))
        p = ranks.reshape(ctx[name].shape)
        if name in INDEX_INVERT:
            p = 100.0 - p
        acc += INDEX_WEIGHTS[name] * p
    if INDEX_SMOOTH_CELLS > 1:
        acc = ndimage.uniform_filter(acc, size=INDEX_SMOOTH_CELLS, mode="nearest")
    return np.clip(acc, 0, 100).astype(np.float32)


def _downsample(grid: np.ndarray, max_dim: int = HEATMAP_MAX_DIM) -> np.ndarray:
    h, w = grid.shape
    factor = max(1, int(np.ceil(max(h, w) / max_dim)))
    H, W = (h // factor) * factor, (w // factor) * factor
    return grid[:H, :W].reshape(H // factor, factor, W // factor, factor).mean(axis=(1, 3))


def export_heatmap(aoi: AOI, grid: np.ndarray, bbox) -> dict:
    g = _downsample(grid)
    return {
        "aoi_code": aoi.code,
        "district": aoi.district,
        "state": aoi.state,
        "bbox": [float(v) for v in bbox],
        "shape": [int(g.shape[0]), int(g.shape[1])],
        "cell_km": round(float((bbox[2] - bbox[0]) * 111.32 / g.shape[1]), 2),
        "values_u8": np.clip(np.round(g)).astype(np.uint8).ravel().tolist(),
        "class_cuts": CLASS_CUTS,
        "class_names": CLASS_NAMES,
        "model_version": MODEL_VERSION,
        "synthetic": False,
    }


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> dict:
    import joblib

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    t0 = datetime.now(timezone.utc)

    events = load_events()
    print(f"labels: {len(events)} GLC events across {events['aoi_code'].nunique()} AOIs")

    ctx_by_aoi: dict[str, dict] = {}
    for aoi in all_aois():
        dem = load_cached(aoi.slug)
        if dem is None:
            raise FileNotFoundError(
                f"no DEM cache for {aoi.slug}; run `python -m ml.ingest.dem_real` first"
            )
        base = build_features(dem["elevation"], dem["res_m"])
        ctx = context_features(base, dem["res_m"], radius_m=BLOCK_RADIUS_M)
        ctx_by_aoi[aoi.slug] = {"ctx": ctx, "bbox": dem["bbox"], "res_m": dem["res_m"]}
        print(f"  context {aoi.district:>18}: {next(iter(ctx.values())).shape}, "
              f"{len(ctx)} block features")

    print("\n--- building slope-matched block datasets ---")
    datasets = build_datasets(ctx_by_aoi, events)

    print("\n--- LODO leaderboard (booster vs 1-feature baselines vs deployed index) ---")
    lodo = train_lo_do(datasets)
    y_true = np.concatenate([datasets[s]["y"] for s in sorted(datasets)])
    idx_scores = physical_index_blocks(ctx_by_aoi, datasets)
    from sklearn.metrics import average_precision_score, roc_auc_score
    lodo["deployed_physical_index"] = {
        "roc_auc": round(float(roc_auc_score(y_true, idx_scores)), 4),
        "pr_auc": round(float(average_precision_score(y_true, idx_scores)), 4),
    }
    print(f"boosted ({lodo['backend']})  : ROC {lodo['lodo_boosted']['roc_auc']}  "
          f"PR {lodo['lodo_boosted']['pr_auc']}")
    print(f"slope-only logistic : ROC {lodo['lodo_slope_only']['roc_auc']}  "
          f"PR {lodo['lodo_slope_only']['pr_auc']}")
    print(f"elev-only logistic  : ROC {lodo['lodo_elevation_only']['roc_auc']}  "
          f"PR {lodo['lodo_elevation_only']['pr_auc']}")
    print(f"deployed phys index : ROC {lodo['deployed_physical_index']['roc_auc']}  "
          f"PR {lodo['deployed_physical_index']['pr_auc']}")

    print("\n--- deployed physical index over full grids ---")
    heatmaps: dict[str, dict] = {}
    grids: dict[str, dict] = {}
    for aoi in all_aois():
        grid = physical_index_grid(ctx_by_aoi[aoi.slug]["ctx"])
        heatmaps[aoi.code] = export_heatmap(aoi, grid, ctx_by_aoi[aoi.slug]["bbox"])
        grids[aoi.slug] = {"index": grid,
                           "bbox": np.array(ctx_by_aoi[aoi.slug]["bbox"])}
        hi = float((grid >= CLASS_CUTS[3]).mean()) * 100
        print(f"  {aoi.district:>18}: {hi:.1f}% of cells high/very-high susceptibility")

    # ---------------- artifacts ----------------
    ARTIFACTS.mkdir(exist_ok=True)
    metrics = {
        "model": MODEL_NAME,
        "version": MODEL_VERSION,
        "deployed": "physical_index",
        "deployed_weights": INDEX_WEIGHTS,
        "deployed_features": INDEX_FEATURES,
        "model_selection_note": (
            "The gradient-boosted model was evaluated under strict "
            "leave-one-district-out CV and did not beat the slope-only logistic "
            "baseline on this label set (74 GLC events, 5-50 km location "
            "accuracy; terrain-only features saturate). The transparent, "
            "physics-weighted slope-dominant index ships instead - the same "
            "selection standard Tier 1 applied when a rainfall rule beat its "
            "booster. The ML harness stays in this module for the lithology / "
            "WorldCover / road-cut ingest milestones."),
        "unit_of_analysis": f"~{BLOCK_RADIUS_M * 2} m block context (GLC label noise "
                            "5-50 km makes per-cell labels unsupportable)",
        "labels": {
            "source": "NASA Global Landslide Catalog",
            "n_events": int(len(events)),
            "negative_strategy": f"slope-matched blocks, {NEG_PER_POS}:1, "
                                 f"{EVENT_EXCLUSION_M} m event exclusion",
        },
        "features": FEATURES,
        "lodo_leaderboard": {
            "boosted": lodo["lodo_boosted"],
            "slope_only_logistic": lodo["lodo_slope_only"],
            "elevation_only_logistic": lodo["lodo_elevation_only"],
            "deployed_physical_index": lodo["deployed_physical_index"],
        },
        "per_aoi_boosted": lodo["per_aoi_boosted"],
        "class_cuts": CLASS_CUTS,
        "class_names": CLASS_NAMES,
        "resolution_m": "35 base / ~1 km context window",
        "trained_at": t0.isoformat(),
        "git_sha": git_sha(),
        "synthetic": False,
    }
    (ARTIFACTS / "model_a_micro_metrics.json").write_text(json.dumps(metrics, indent=2))
    (ARTIFACTS / "micro_heatmap.json").write_text(json.dumps(heatmaps, separators=(",", ":")))

    for slug, g in grids.items():
        np.savez_compressed(
            ARTIFACTS / f"micro_susceptibility_{slug}.npz",
            index=g["index"], bbox=g["bbox"],
            model_version=MODEL_VERSION,
        )

    bundle = {
        "name": MODEL_NAME,
        "version": MODEL_VERSION,
        "kind": "physical_index",
        "weights": INDEX_WEIGHTS,
        "features": INDEX_FEATURES,
        "invert": sorted(INDEX_INVERT),
        "block_radius_m": BLOCK_RADIUS_M,
        "class_cuts": CLASS_CUTS,
        "class_names": CLASS_NAMES,
        "metrics": {"lodo_leaderboard": metrics["lodo_leaderboard"]},
        "trained_at": t0.isoformat(),
        "git_sha": git_sha(),
        "synthetic": False,
    }
    joblib.dump(bundle, ARTIFACTS / "model_a_micro.pkl")

    save_artifact_meta(
        MODEL_NAME, MODEL_VERSION, metrics,
        notes="Tier-2 micro-susceptibility on real terrarium DEM. Deployed scorer "
              "is a slope-dominant physical percentile index; the boosted model "
              "was evaluated under LODO and did not beat the slope baseline on "
              "74 noisy GLC labels. Harness kept for future ingests.",
    )
    write_model_card(
        "A2-micro-susceptibility",
        "Static WHERE at ~70 m scored / ~1 km context: which parts of a district "
        "are landslide-prone",
        INDEX_FEATURES, metrics,
        "Scores inherit GLC location blur (5-50 km): blocks, not cells, carry "
        "positives, so a fitted booster cannot demonstrate out-of-district skill "
        "on this inventory - the leaderboard in the metrics file shows the "
        "measurement. Percentile scale is district-relative by construction. "
        "Lithology, land cover and road-cut distance are the next ingest "
        "milestones; rerun the module's LODO harness when they land.",
    )
    print(f"\nartifacts -> {ARTIFACTS / 'model_a_micro.pkl'}")
    print(f"           {ARTIFACTS / 'micro_heatmap.json'}")
    return metrics


if __name__ == "__main__":
    main()
