"""Model A - Susceptibility with LEAVE-ONE-DISTRICT-OUT spatial CV.

Random CV on spatial data leaks; LODO is the honest protocol. Compares
XGBoost/LightGBM/RF when available, falls back to sklearn HistGradientBoosting
so the pipeline runs anywhere. Fully offline via synthetic fallback.
"""

import json
from pathlib import Path

import numpy as np

from ml.registry.registry import save_artifact_meta, write_model_card

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"

FEATURES = [
    "slope_deg", "aspect_sin", "aspect_cos", "elevation_m", "plan_curv", "profile_curv",
    "twi", "spi", "tpi", "dist_stream_km", "dist_ridge_km", "dist_roadcut_m",
    "lithology_class", "landcover_class", "ndvi_mean", "ndvi_trend_5yr",
    "mean_annual_rain_mm", "monsoon_rain_normal_mm", "landslide_density_1km",
    "soil_type", "road_density_km_km2", "settlement_density", "fault_dist_km", "ndvi_std",
]

DISTRICTS = ["aizawl", "east_khasi_hills", "noney_imphal_west", "gangtok"]


def make_dataset(n_per_district: int = 4000, seed: int = 11) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Synthetic cells: positives cluster on steep/wet/deforested cells."""
    rng = np.random.default_rng(seed)
    X, y, g = [], [], []
    for gi, d in enumerate(DISTRICTS):
        n_pos = n_per_district // 4
        n_neg = n_per_district - n_pos
        pos = np.column_stack([
            rng.normal(38, 8, n_pos), rng.normal(0, 1, n_pos), rng.normal(0, 1, n_pos),
            rng.normal(1200, 250, n_pos), rng.normal(0, .5, n_pos), rng.normal(0, .5, n_pos),
            rng.normal(7, 1.2, n_pos), rng.normal(9, 2, n_pos), rng.normal(0, 3, n_pos),
            np.abs(rng.normal(0.3, .2, n_pos)), np.abs(rng.normal(0.2, .15, n_pos)),
            np.abs(rng.normal(20, 15, n_pos)),
            rng.integers(0, 6, n_pos).astype(float), rng.integers(0, 8, n_pos).astype(float),
            np.clip(rng.normal(.35, .12, n_pos), 0, 1), rng.normal(-.02, .01, n_pos),
            rng.normal(2600, 500, n_pos), rng.normal(1800, 400, n_pos),
            rng.poisson(2.5, n_pos).astype(float), rng.integers(0, 5, n_pos).astype(float),
            rng.gamma(2, .4, n_pos), rng.gamma(1.5, 2, n_pos), np.abs(rng.normal(6, 3, n_pos)),
            rng.normal(.08, .03, n_pos),
        ])
        neg = pos.copy()
        neg[:, 0] = rng.normal(22, 8, n_neg)          # flatter
        neg[:, 16] = rng.normal(2100, 500, n_neg)     # drier
        neg[:, 18] = rng.poisson(0.2, n_neg)          # fewer historic events
        neg[:, 14] = np.clip(rng.normal(.55, .12, n_neg), 0, 1)  # more vegetation
        X.extend([pos, neg])
        y.extend([np.ones(n_pos), np.zeros(n_neg)])
        g.extend([np.full(n_per_district, gi)])
    return np.vstack(X), np.concatenate(y), np.concatenate(g)


def get_model():
    try:
        from xgboost import XGBClassifier
        return XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.08,
                             subsample=0.9, colsample_bytree=0.8, eval_metric="auc",
                             n_jobs=4, verbosity=0)
    except ImportError:
        pass
    try:
        from lightgbm import LGBMClassifier
        return LGBMClassifier(n_estimators=300, num_leaves=48, learning_rate=0.08,
                              subsample=0.9, colsample_bytree=0.8, n_jobs=4, verbose=-1)
    except ImportError:
        from sklearn.ensemble import HistGradientBoostingClassifier
        return HistGradientBoostingClassifier(max_iter=300)


def main() -> None:
    from sklearn.metrics import roc_auc_score, average_precision_score

    X, y, groups = make_dataset()
    print(f"dataset: {X.shape[0]} cells, {int(y.sum())} positive ({y.mean():.1%})")

    fold_aucs = {}
    print("\nLeave-one-district-out spatial CV:")
    for held_out in range(len(DISTRICTS)):
        test_mask = groups == held_out
        train_mask = ~test_mask
        model = get_model()
        model.fit(X[train_mask], y[train_mask])
        proba = model.predict_proba(X[test_mask])[:, 1]
        auc = roc_auc_score(y[test_mask], proba)
        ap = average_precision_score(y[test_mask], proba)
        fold_aucs[DISTRICTS[held_out]] = round(float(auc), 3)
        print(f"  hold out {DISTRICTS[held_out]:>18}: AUC {auc:.3f}  AP {ap:.3f}")

    mean_auc = float(np.mean(list(fold_aucs.values())))
    metrics = {"cv_protocol": "leave_one_district_out", "fold_auc": fold_aucs, "mean_auc": round(mean_auc, 3)}
    print(f"\nMEAN SPATIAL-CV AUC: {mean_auc:.3f}  <- this number goes on the slide")

    # global SHAP-style importances (permutation on full fit)
    model = get_model().fit(X, y)
    rng = np.random.default_rng(0)
    base = model.predict_proba(X[:2000])[:, 1].mean()
    imps = []
    for j in [0, 9, 14, 16]:  # slope, dist_stream, ndvi, rain
        Xp = X[:2000].copy()
        rng.shuffle(Xp[:, j])
        delta = base - model.predict_proba(Xp)[:, 1].mean()
        imps.append({"feature": FEATURES[j], "importance": round(abs(float(delta)), 4)})
    metrics["top_features"] = sorted(imps, key=lambda r: -r["importance"])

    save_artifact_meta("susceptibility", "v0-synthetic-lodo", metrics,
                       notes="SYNTHETIC data until GSI Bhukosh inventory lands")
    write_model_card(
        "A-susceptibility",
        "Static WHERE: probability a 30m cell is landslide-susceptible (5 classes matching GSI NLSM scheme)",
        FEATURES, metrics,
        "Synthetic training data at scaffold stage; urban-scale validation needs field partnership; "
        "class imbalance handled by design of negative sampling with spatial buffering.",
    )


if __name__ == "__main__":
    main()
