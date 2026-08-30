"""train.py - BhuRakshak Autoresearch Training & Model Architecture Sandbox
SIH26001: AI-Based Early Warning and Landslide Risk Monitoring System in NER.

============================================================================
!!  THIS FILE IS GENERATED. DO NOT EDIT IT BY HAND.                       !!
============================================================================

`run_loop.py::generate_experimental_code()` writes this file (see
`TRAIN_FILE.write_text(...)`), and the research loop overwrites it whenever it
promotes a new champion architecture. Any manual edit here is silently lost on
the next loop iteration.

Change `autoresearch/run_loop.py` (the template) instead, then regenerate.

One thing that must survive every regeneration: the preprocessors have to
return the names of the columns they append, and `export_champion.py` must
write those names into the bundle. See the `_FeatureFrame` docstring.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from sklearn.calibration import IsotonicRegression
from sklearn.preprocessing import RobustScaler, StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from autoresearch.evaluate import (
    compute_composite_score,
    evaluate_hazard,
    evaluate_susceptibility,
)

DATA_DIR = Path(__file__).resolve().parent / "data"
EXP_DIR = Path(__file__).resolve().parent / "experiments"
EXP_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================================
# 1. Feature Engineering & Preprocessing
# ============================================================================

def _apply_engineered(X: np.ndarray, f_map: dict, specs: list[tuple]) -> tuple[np.ndarray, list[str]]:
    """Append each engineered column whose inputs are present.

    Returns the widened matrix *and* the names of the columns it added, so the
    exporter can declare a feature list that actually matches what the model
    was fitted on.

    Previously the callers kept a separate hand-maintained name list that only
    held the raw inputs. Model A was fitted on 27 columns while its bundle
    declared 24; Model B on 16 while it declared 12. The bundle's feature list
    therefore described a matrix that no longer existed, and inference either
    crashed on the width mismatch or -- worse -- silently misaligned.
    """
    X_out = X
    added: list[str] = []
    for out_names, required, fn in specs:
        if all(r in f_map for r in required):
            cols = fn(X, f_map)
            cols = [cols] if cols.ndim == 1 else [cols[:, i] for i in range(cols.shape[1])]
            if len(cols) != len(out_names):
                raise ValueError(
                    f"engineered feature {out_names} produced {len(cols)} columns, "
                    f"expected {len(out_names)}"
                )
            X_out = np.column_stack([X_out, *cols])
            added.extend(out_names)
    return X_out, added


# (output names, required inputs, builder). One definition drives both the
# transform and the exported feature list -- they cannot drift apart.
_SUSC_SPECS = [
    (
        ["instability_idx"],
        ["slope_deg", "twi"],
        lambda X, m: np.sin(np.radians(X[:, m["slope_deg"]])) * X[:, m["twi"]],
    ),
    (
        ["roadcut_hazard"],
        ["slope_deg", "dist_roadcut_m"],
        lambda X, m: X[:, m["slope_deg"]] / (X[:, m["dist_roadcut_m"]] + 5.0),
    ),
    (
        ["veg_slope_risk"],
        ["slope_deg", "ndvi_mean"],
        lambda X, m: X[:, m["slope_deg"]] * (1.0 - X[:, m["ndvi_mean"]]),
    ),
]

_HAZARD_SPECS = [
    (
        ["id_power_law"],
        ["rain_1h", "rain_24h"],
        lambda X, m: X[:, m["rain_1h"]] * (np.maximum(X[:, m["rain_24h"]], 0.0) ** 0.45),
    ),
    (
        ["flash_ratio", "deep_storage"],
        ["rain_1h", "rain_24h", "rain_7d", "eff_rain"],
        lambda X, m: np.column_stack([
            X[:, m["rain_1h"]] / (X[:, m["rain_24h"]] + 0.5),
            (X[:, m["rain_7d"]] + X[:, m["eff_rain"]] * 1.5) / 120.0,
        ]),
    ),
    (
        ["pore_pressure"],
        ["soil_moisture", "eff_rain", "susc_p90"],
        lambda X, m: (X[:, m["eff_rain"]] / 35.0)
        * (np.clip((X[:, m["soil_moisture"]] - 25.0) / 75.0, 0.0, 1.0) ** 2.0)
        * (X[:, m["susc_p90"]] / 100.0),
    ),
]


def susceptibility_feature_names(feature_names: list[str]) -> list[str]:
    """Raw inputs plus the engineered columns, in model order."""
    f_map = {name: i for i, name in enumerate(feature_names)}
    names = list(feature_names)
    for out_names, required, _ in _SUSC_SPECS:
        if all(r in f_map for r in required):
            names.extend(out_names)
    return names


def hazard_feature_names(feature_names: list[str]) -> list[str]:
    """Raw inputs plus the engineered columns, in model order."""
    f_map = {name: i for i, name in enumerate(feature_names)}
    names = list(feature_names)
    for out_names, required, _ in _HAZARD_SPECS:
        if all(r in f_map for r in required):
            names.extend(out_names)
    return names


def preprocess_susceptibility_features(X: np.ndarray, feature_names: list[str]) -> np.ndarray:
    """Feature transformations for Model A (Susceptibility)."""
    f_map = {name: i for i, name in enumerate(feature_names)}
    X_out, added = _apply_engineered(X.copy(), f_map, _SUSC_SPECS)
    if X_out.shape[1] != len(susceptibility_feature_names(feature_names)):
        raise ValueError(
            f"preprocess produced {X_out.shape[1]} columns but declares "
            f"{len(susceptibility_feature_names(feature_names))} names"
        )
    return X_out.astype(np.float32)


def preprocess_hazard_features(X: np.ndarray, feature_names: list[str]) -> np.ndarray:
    """Feature transformations for Model B (Hazard Nowcast)."""
    f_map = {name: i for i, name in enumerate(feature_names)}
    X_out, added = _apply_engineered(X.copy(), f_map, _HAZARD_SPECS)
    if X_out.shape[1] != len(hazard_feature_names(feature_names)):
        raise ValueError(
            f"preprocess produced {X_out.shape[1]} columns but declares "
            f"{len(hazard_feature_names(feature_names))} names"
        )
    return X_out.astype(np.float32)


# ============================================================================
# 2. Model Architecture Definitions
# ============================================================================

def build_susceptibility_model(seed: int = 42):
    """Build Model A Classifier (Susceptibility)."""
    from lightgbm import LGBMClassifier
    return LGBMClassifier(
        n_estimators=350,
        num_leaves=31,
        learning_rate=0.045,
        max_depth=6,
        min_child_samples=25,
        subsample=0.85,
        colsample_bytree=0.80,
        scale_pos_weight=3.0,
        random_state=seed,
        n_jobs=4,
        verbose=-1,
    )


# ============================================================================
# 3. Model Training & Validation Loops
# ============================================================================

def train_and_eval_susceptibility(data_path: Path) -> dict:
    """Trains Model A using Leave-One-District-Out (LODO) Spatial Cross Validation."""
    npz = np.load(data_path, allow_pickle=True)
    X_raw, y, groups = npz["X"], npz["y"], npz["groups"]
    features = list(npz["features"])
    districts = list(npz["districts"])
    
    X = preprocess_susceptibility_features(X_raw, features)
    fold_predictions = {}
    
    for group_idx, dist_name in enumerate(districts):
        test_mask = groups == group_idx
        train_mask = ~test_mask
        
        X_train, y_train = X[train_mask], y[train_mask]
        X_test, y_test = X[test_mask], y[test_mask]
        
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        model = build_susceptibility_model(seed=42 + group_idx)
        model.fit(X_train_scaled, y_train)
        
        y_prob = model.predict_proba(X_test_scaled)[:, 1]
        fold_predictions[dist_name] = (y_test, y_prob)
        
    metrics = evaluate_susceptibility(fold_predictions)
    return metrics


def train_and_eval_hazard(data_path: Path) -> tuple[dict, float]:
    """Trains Model B using Temporal Split (<=2019 Train, 2020-22 Val, 2023-24 Test)."""
    npz = np.load(data_path, allow_pickle=True)
    X_raw, y, years = npz["X"], npz["y"], npz["years"]
    features = list(npz["features"])
    
    X = preprocess_hazard_features(X_raw, features)
    
    train_mask = years <= 2019
    val_mask = (years >= 2020) & (years <= 2022)
    test_mask = years >= 2023
    
    X_train, y_train = X[train_mask], y[train_mask]
    X_val, y_val = X[val_mask], y[val_mask]
    X_test, y_test = X[test_mask], y[test_mask]
    
    scaler = RobustScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_val_scaled = scaler.transform(X_val)
    X_test_scaled = scaler.transform(X_test)
    
    # Train LightGBM
    from lightgbm import LGBMClassifier
    model = LGBMClassifier(
        n_estimators=750,
        num_leaves=78,
        learning_rate=0.0219,
        max_depth=7,
        min_child_samples=40,
        subsample=0.89,
        colsample_bytree=0.82,
        scale_pos_weight=5.7,
        reg_alpha=0.1,
        reg_lambda=0.54,
        random_state=42,
        n_jobs=4,
        verbose=-1,
    )
    model.fit(X_train_scaled, y_train)
    val_raw_prob = model.predict_proba(X_val_scaled)[:, 1]
    test_raw_prob = model.predict_proba(X_test_scaled)[:, 1]
    
    # Probability calibration on validation set
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(val_raw_prob, y_val)
    
    val_cal_prob = calibrator.predict(val_raw_prob)
    test_cal_prob = calibrator.predict(test_raw_prob)
    
    # Fine-grained Pareto Threshold Search
    best_thresh = 0.50
    best_val_obj = -1.0
    for th in np.linspace(0.18, 0.68, 75):
        th_pred = (val_cal_prob >= th).astype(int)
        tp = np.sum((th_pred == 1) & (y_val == 1))
        fn = np.sum((th_pred == 0) & (y_val == 1))
        fp = np.sum((th_pred == 1) & (y_val == 0))
        denom = tp + fn + fp
        csi = tp / denom if denom > 0 else 0.0
        far = fp / (tp + fp) if (tp + fp) > 0 else 1.0
        obj = csi - 0.18 * far
        if obj > best_val_obj:
            best_val_obj = obj
            best_thresh = float(th)
            
    metrics = evaluate_hazard(y_val, val_cal_prob, y_test, test_cal_prob, threshold=best_thresh)
    metrics["optimized_threshold"] = round(best_thresh, 3)
    
    return metrics, best_thresh


# ============================================================================
# 4. Main Experiment Entrypoint
# ============================================================================

def run_experiment() -> dict:
    """Executes a full research experiment, calculates composite benchmark score."""
    start_time = time.time()
    
    susc_data_path = DATA_DIR / "data_susceptibility.npz"
    hazard_data_path = DATA_DIR / "data_hazard_nowcast.npz"
    
    if not susc_data_path.exists() or not hazard_data_path.exists():
        raise FileNotFoundError(f"Datasets missing in {DATA_DIR}. Run prepare.py first.")
        
    print("[1/2] Training Model A: Landslide Susceptibility (LODO Spatial CV)...")
    susc_metrics = train_and_eval_susceptibility(susc_data_path)
    print(f"  Model A Mean LODO AUC: {susc_metrics['mean_lodo_auc']:.4f} (Std: {susc_metrics['std_lodo_auc']:.4f})")
    
    print("[2/2] Training Model B: Hazard Nowcast (Temporal Split + Calibration)...")
    hazard_metrics, opt_threshold = train_and_eval_hazard(hazard_data_path)
    test_m = hazard_metrics["test"]
    print(f"  Model B Test AUC: {test_m['auc']:.4f} | CSI: {test_m['csi']:.4f} | FAR: {test_m['far']:.4f} | Brier: {test_m['brier']:.4f} (Thresh: {opt_threshold})")
    
    composite_score = compute_composite_score(
        lodo_mean_auc=susc_metrics["mean_lodo_auc"],
        hazard_test_auc=test_m["auc"],
        hazard_test_csi=test_m["csi"],
        hazard_test_far=test_m["far"],
        hazard_test_brier=test_m["brier"],
    )
    
    elapsed = time.time() - start_time
    print(f"\n============================================================")
    print(f"COMPOSITE BENCHMARK SCORE: {composite_score:.5f} (Elapsed: {elapsed:.2f}s)")
    print(f"============================================================")
    
    results = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(elapsed, 2),
        "composite_score": composite_score,
        "susceptibility": susc_metrics,
        "hazard": hazard_metrics,
    }
    
    return results


if __name__ == "__main__":
    res = run_experiment()
    print("\n--- JSON_RESULT_START ---")
    print(json.dumps(res, indent=2))
    print("--- JSON_RESULT_END ---")
