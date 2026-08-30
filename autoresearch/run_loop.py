"""run_loop.py - BhuRakshak Autonomous Continuous Research Daemon
SIH26001: AI-Based Early Warning and Landslide Risk Monitoring System in NER.

This engine executes continuous autonomous search across:
- Structured Domain Physics & Hydrology Hypotheses
- Evolutionary Hyperparameter & Feature Mutation
- Multi-Model Ensembles (LightGBM, XGBoost, PyTorch CUDA Neural Networks)
- Cost-Sensitive Decision Calibration
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import random
import re
import shutil
import signal
import subprocess
import sys
import time
from typing import Any, Callable

AUTORESEARCH_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AUTORESEARCH_DIR.parent
TRAIN_FILE = AUTORESEARCH_DIR / "train.py"
PYTHON_BIN = PROJECT_ROOT / ".venv" / "bin" / "python"
if not PYTHON_BIN.exists():
    PYTHON_BIN = Path(sys.executable)

sys.path.insert(0, str(PROJECT_ROOT))
from autoresearch.ledger import (
    backup_best_state,
    git_commit,
    git_revert,
    load_best_score,
    record_experiment,
)


def generate_experimental_code(
    hydro_mode: str,
    topo_mode: str,
    lgbm_params: dict,
    xgb_params: dict,
    ensemble_mode: str,
    ensemble_weights: tuple[float, float, float],
    threshold_penalty_weight: float,
) -> str:
    """Generates complete train.py code for any given architecture & parameter configuration."""
    
    # Topography Block
    if topo_mode == "compound_morpho":
        topo_block = """    # Compound hydro-morphological instability index
    if "slope_deg" in f_map and "twi" in f_map and "spi" in f_map:
        slope_rad = np.radians(X[:, f_map["slope_deg"]])
        twi = X[:, f_map["twi"]]
        spi = X[:, f_map["spi"]]

        ff.add("hydro_morpho", np.sin(slope_rad) * twi * np.log1p(np.maximum(spi, 0.0)))
        
    # Curvature acceleration index: plan concavity x profile convexity
    if "plan_curv" in f_map and "profile_curv" in f_map and "slope_deg" in f_map:

        ff.add("curv_acc", (-X[:, f_map["plan_curv"]]) * X[:, f_map["profile_curv"]] * (X[:, f_map["slope_deg"]] / 30.0))
        
    # Fault line exponential decay hazard
    if "fault_dist_km" in f_map and "slope_deg" in f_map:

        ff.add("fault_risk", np.exp(-X[:, f_map["fault_dist_km"]] / 3.5) * X[:, f_map["slope_deg"]])
        
    # Roadcut cutting into steep slopes
    if "slope_deg" in f_map and "dist_roadcut_m" in f_map:

        ff.add("roadcut_hazard", X[:, f_map["slope_deg"]] / (X[:, f_map["dist_roadcut_m"]] + 4.0))"""
    else:
        topo_block = """    # Non-linear topographic wetness x slope interaction (instability index)
    if "slope_deg" in f_map and "twi" in f_map:
        slope_rad = np.radians(X[:, f_map["slope_deg"]])
        twi = X[:, f_map["twi"]]

        ff.add("instability_idx", np.sin(slope_rad) * twi)
        
    # Roadcut hazard interaction: steep slope near roadcut
    if "slope_deg" in f_map and "dist_roadcut_m" in f_map:

        ff.add("roadcut_hazard", X[:, f_map["slope_deg"]] / (X[:, f_map["dist_roadcut_m"]] + 5.0))
        
    # Vegetation health penalty: low NDVI + high slope
    if "slope_deg" in f_map and "ndvi_mean" in f_map:

        ff.add("veg_slope_risk", X[:, f_map["slope_deg"]] * (1.0 - X[:, f_map["ndvi_mean"]]))"""

    # Hydrology Block
    if hydro_mode == "multi_scale_power_law":
        hydro_block = """    # Non-linear Intensity-Duration Power Law: I * D^0.45
    if "rain_1h" in f_map and "rain_24h" in f_map:

        ff.add("id_power_law", X[:, f_map["rain_1h"]] * (np.maximum(X[:, f_map["rain_24h"]], 0.0) ** 0.45))

    # Flash-to-Cumulative Ratio & 7-Day Antecedent Groundwater Index
    if "rain_1h" in f_map and "rain_24h" in f_map and "rain_7d" in f_map and "eff_rain" in f_map:


        ff.add("flash_ratio", X[:, f_map["rain_1h"]] / (X[:, f_map["rain_24h"]] + 0.5))
        ff.add("deep_storage", (X[:, f_map["rain_7d"]] + X[:, f_map["eff_rain"]] * 1.5) / 120.0)

    # Critical Pore Water Pressure Trigger
    if "soil_moisture" in f_map and "eff_rain" in f_map and "susc_p90" in f_map:
        soil_factor = np.clip((X[:, f_map["soil_moisture"]] - 25.0) / 75.0, 0.0, 1.0)

        ff.add("pore_pressure", (X[:, f_map["eff_rain"]] / 35.0) * (soil_factor ** 2.0) * (X[:, f_map["susc_p90"]] / 100.0))"""
    else:
        hydro_block = """    # Intensity-Duration Interaction: rain_1h * sqrt(rain_24h)
    if "rain_1h" in f_map and "rain_24h" in f_map:

        ff.add("id_interaction", X[:, f_map["rain_1h"]] * np.sqrt(np.maximum(X[:, f_map["rain_24h"]], 0.0)))

    # Multi-scale antecedent moisture indicators (12h flash vs 72h saturation)
    if "rain_1h" in f_map and "rain_24h" in f_map and "rain_72h" in f_map:


        ff.add("flash_surge", X[:, f_map["rain_1h"]] / (X[:, f_map["rain_24h"]] + 1.0))
        ff.add("saturation_acc", (X[:, f_map["rain_24h"]] * 0.5 + X[:, f_map["rain_72h"]] * 0.5) / 100.0)

    # Combined Saturation Trigger: non-linear soil-rainfall interaction
    if "eff_rain" in f_map and "soil_moisture" in f_map and "susc_p90" in f_map:
        soil_norm = np.clip((X[:, f_map["soil_moisture"]] - 30.0) / 70.0, 0.0, 1.0)

        ff.add("sat_trigger", (X[:, f_map["eff_rain"]] / 40.0) * (soil_norm ** 1.5) * (X[:, f_map["susc_p90"]] / 100.0))"""

    # Model & Ensemble Block
    w_lgbm, w_xgb, w_py = ensemble_weights
    
    if ensemble_mode == "lgbm_xgb_blend":
        train_block = f"""    # Train Weighted Blend: LightGBM ({w_lgbm:.2f}) + XGBoost ({w_xgb:.2f})
    from lightgbm import LGBMClassifier
    from xgboost import XGBClassifier
    lgbm = LGBMClassifier(
        n_estimators={lgbm_params['n_estimators']},
        num_leaves={lgbm_params['num_leaves']},
        learning_rate={lgbm_params['learning_rate']},
        max_depth={lgbm_params['max_depth']},
        min_child_samples={lgbm_params['min_child_samples']},
        subsample={lgbm_params['subsample']},
        colsample_bytree={lgbm_params['colsample_bytree']},
        scale_pos_weight={lgbm_params['scale_pos_weight']},
        reg_alpha={lgbm_params['reg_alpha']},
        reg_lambda={lgbm_params['reg_lambda']},
        random_state=42,
        n_jobs=4,
        verbose=-1,
    )
    lgbm.fit(X_train_scaled, y_train)
    
    xgb = XGBClassifier(
        n_estimators={xgb_params['n_estimators']},
        max_depth={xgb_params['max_depth']},
        learning_rate={xgb_params['learning_rate']},
        scale_pos_weight={xgb_params['scale_pos_weight']},
        subsample={xgb_params['subsample']},
        colsample_bytree={xgb_params['colsample_bytree']},
        reg_alpha={xgb_params['reg_alpha']},
        reg_lambda={xgb_params['reg_lambda']},
        random_state=42,
        n_jobs=4,
        verbosity=0,
    )
    xgb.fit(X_train_scaled, y_train)
    
    val_raw_prob = {w_lgbm:.3f} * lgbm.predict_proba(X_val_scaled)[:, 1] + {w_xgb:.3f} * xgb.predict_proba(X_val_scaled)[:, 1]
    test_raw_prob = {w_lgbm:.3f} * lgbm.predict_proba(X_test_scaled)[:, 1] + {w_xgb:.3f} * xgb.predict_proba(X_test_scaled)[:, 1]"""
    elif ensemble_mode == "tri_hybrid_neural":
        train_block = f"""    # Train Tri-Hybrid: LightGBM + XGBoost + PyTorch Neural TabNet on CUDA
    from lightgbm import LGBMClassifier
    from xgboost import XGBClassifier
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset

    lgbm = LGBMClassifier(
        n_estimators={lgbm_params['n_estimators']},
        num_leaves={lgbm_params['num_leaves']},
        learning_rate={lgbm_params['learning_rate']},
        max_depth={lgbm_params['max_depth']},
        scale_pos_weight={lgbm_params['scale_pos_weight']},
        reg_alpha={lgbm_params['reg_alpha']},
        reg_lambda={lgbm_params['reg_lambda']},
        random_state=42,
        n_jobs=4,
        verbose=-1,
    )
    lgbm.fit(X_train_scaled, y_train)
    
    xgb = XGBClassifier(
        n_estimators={xgb_params['n_estimators']},
        max_depth={xgb_params['max_depth']},
        learning_rate={xgb_params['learning_rate']},
        scale_pos_weight={xgb_params['scale_pos_weight']},
        random_state=42,
        n_jobs=4,
        verbosity=0,
    )
    xgb.fit(X_train_scaled, y_train)
    
    class TabularNet(nn.Module):
        def __init__(self, in_f):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(in_f, 96),
                nn.BatchNorm1d(96),
                nn.SiLU(),
                nn.Dropout(0.12),
                nn.Linear(96, 64),
                nn.BatchNorm1d(64),
                nn.SiLU(),
                nn.Linear(64, 1),
            )
        def forward(self, x):
            return self.net(x).squeeze(-1)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    net = TabularNet(X_train_scaled.shape[1]).to(device)
    pos_w = torch.tensor([{lgbm_params['scale_pos_weight']}], device=device)
    crit = nn.BCEWithLogitsLoss(pos_weight=pos_w)
    opt = optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    
    ds = TensorDataset(torch.from_numpy(X_train_scaled).float(), torch.from_numpy(y_train).float())
    dl = DataLoader(ds, batch_size=384, shuffle=True)
    net.train()
    for _ in range(14):
        for bx, by in dl:
            bx, by = bx.to(device), by.to(device)
            opt.zero_grad()
            l = crit(net(bx), by)
            l.backward()
            opt.step()
    net.eval()
    with torch.no_grad():
        val_py = torch.sigmoid(net(torch.from_numpy(X_val_scaled).float().to(device))).cpu().numpy()
        test_py = torch.sigmoid(net(torch.from_numpy(X_test_scaled).float().to(device))).cpu().numpy()
        
    val_raw_prob = {w_lgbm:.3f} * lgbm.predict_proba(X_val_scaled)[:, 1] + {w_xgb:.3f} * xgb.predict_proba(X_val_scaled)[:, 1] + {w_py:.3f} * val_py
    test_raw_prob = {w_lgbm:.3f} * lgbm.predict_proba(X_test_scaled)[:, 1] + {w_xgb:.3f} * xgb.predict_proba(X_test_scaled)[:, 1] + {w_py:.3f} * test_py"""
    else:
        train_block = f"""    # Train LightGBM
    from lightgbm import LGBMClassifier
    model = LGBMClassifier(
        n_estimators={lgbm_params['n_estimators']},
        num_leaves={lgbm_params['num_leaves']},
        learning_rate={lgbm_params['learning_rate']},
        max_depth={lgbm_params['max_depth']},
        min_child_samples={lgbm_params['min_child_samples']},
        subsample={lgbm_params['subsample']},
        colsample_bytree={lgbm_params['colsample_bytree']},
        scale_pos_weight={lgbm_params['scale_pos_weight']},
        reg_alpha={lgbm_params['reg_alpha']},
        reg_lambda={lgbm_params['reg_lambda']},
        random_state=42,
        n_jobs=4,
        verbose=-1,
    )
    model.fit(X_train_scaled, y_train)
    val_raw_prob = model.predict_proba(X_val_scaled)[:, 1]
    test_raw_prob = model.predict_proba(X_test_scaled)[:, 1]"""

    code = f'''"""train.py - BhuRakshak Autoresearch Training & Model Architecture Sandbox
SIH26001: AI-Based Early Warning and Landslide Risk Monitoring System in NER.
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

class _FeatureFrame:
    """Accumulates engineered columns alongside their names.

    The research loop rewrites the feature blocks below, so the set of derived
    columns changes between experiments. Building the matrix and its name list
    together is what stops an exported bundle from declaring a feature list
    that no longer matches the matrix the model was actually fitted on.
    """

    def __init__(self, X, names):
        self.cols = [np.asarray(X[:, i]) for i in range(X.shape[1])]
        self.names = [str(n) for n in names]

    def add(self, name: str, col) -> None:
        self.cols.append(np.asarray(col))
        self.names.append(str(name))

    def matrix(self) -> np.ndarray:
        return np.column_stack(self.cols).astype(np.float32)


# Names of the columns the preprocessing above produced, filled in as a side
# effect of the last call. export_champion.py reads these so it can declare a
# feature list matching the fitted matrix.
_LAST_SUSC_NAMES: list[str] = []
_LAST_HAZ_NAMES: list[str] = []


def preprocess_susceptibility_features(X: np.ndarray, feature_names: list[str]) -> np.ndarray:
    """Feature transformations for Model A (Susceptibility)."""
    ff = _FeatureFrame(X.copy(), feature_names)
    f_map = {{name: i for i, name in enumerate(feature_names)}}
    
{topo_block}
        
    _LAST_SUSC_NAMES.clear()
    _LAST_SUSC_NAMES.extend(ff.names)
    return ff.matrix()


def preprocess_hazard_features(X: np.ndarray, feature_names: list[str]) -> np.ndarray:
    """Feature transformations for Model B (Hazard Nowcast)."""
    ff = _FeatureFrame(X.copy(), feature_names)
    f_map = {{name: i for i, name in enumerate(feature_names)}}
    
{hydro_block}
        
    _LAST_HAZ_NAMES.clear()
    _LAST_HAZ_NAMES.extend(ff.names)
    return ff.matrix()


def susceptibility_feature_names(feature_names: list[str]) -> list[str]:
    """Raw inputs plus whatever the active topo block derives."""
    preprocess_susceptibility_features(np.zeros((2, len(feature_names)), dtype=np.float32), feature_names)
    return list(_LAST_SUSC_NAMES)


def hazard_feature_names(feature_names: list[str]) -> list[str]:
    """Raw inputs plus whatever the active hydro block derives."""
    preprocess_hazard_features(np.zeros((2, len(feature_names)), dtype=np.float32), feature_names)
    return list(_LAST_HAZ_NAMES)


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
    fold_predictions = {{}}
    
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
    
{train_block}
    
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
        obj = csi - {threshold_penalty_weight:.2f} * far
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
        raise FileNotFoundError(f"Datasets missing in {{DATA_DIR}}. Run prepare.py first.")
        
    print("[1/2] Training Model A: Landslide Susceptibility (LODO Spatial CV)...")
    susc_metrics = train_and_eval_susceptibility(susc_data_path)
    print(f"  Model A Mean LODO AUC: {{susc_metrics['mean_lodo_auc']:.4f}} (Std: {{susc_metrics['std_lodo_auc']:.4f}})")
    
    print("[2/2] Training Model B: Hazard Nowcast (Temporal Split + Calibration)...")
    hazard_metrics, opt_threshold = train_and_eval_hazard(hazard_data_path)
    test_m = hazard_metrics["test"]
    print(f"  Model B Test AUC: {{test_m['auc']:.4f}} | CSI: {{test_m['csi']:.4f}} | FAR: {{test_m['far']:.4f}} | Brier: {{test_m['brier']:.4f}} (Thresh: {{opt_threshold}})")
    
    composite_score = compute_composite_score(
        lodo_mean_auc=susc_metrics["mean_lodo_auc"],
        hazard_test_auc=test_m["auc"],
        hazard_test_csi=test_m["csi"],
        hazard_test_far=test_m["far"],
        hazard_test_brier=test_m["brier"],
    )
    
    elapsed = time.time() - start_time
    print(f"\\n============================================================")
    print(f"COMPOSITE BENCHMARK SCORE: {{composite_score:.5f}} (Elapsed: {{elapsed:.2f}}s)")
    print(f"============================================================")
    
    results = {{
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(elapsed, 2),
        "composite_score": composite_score,
        "susceptibility": susc_metrics,
        "hazard": hazard_metrics,
    }}
    
    return results


if __name__ == "__main__":
    res = run_experiment()
    print("\\n--- JSON_RESULT_START ---")
    print(json.dumps(res, indent=2))
    print("--- JSON_RESULT_END ---")
'''
    return code


# ============================================================================
# Continuous Mutation Search Space Generator
# ============================================================================

def sample_random_hypothesis(rng: random.Random) -> tuple[str, str]:
    """Generates an exploration candidate across the high-dimensional ML parameter space."""
    hydro_mode = rng.choice(["default", "multi_scale_power_law"])
    topo_mode = rng.choice(["default", "compound_morpho"])
    ensemble_mode = rng.choice(["lgbm_only", "lgbm_xgb_blend", "tri_hybrid_neural"])
    
    # Sample LightGBM hyperparameters
    lgbm_params = {
        "n_estimators": rng.choice([350, 450, 550, 650, 750]),
        "num_leaves": rng.choice([31, 42, 54, 64, 78]),
        "learning_rate": round(rng.uniform(0.020, 0.045), 4),
        "max_depth": rng.choice([6, 7, 8, 9]),
        "min_child_samples": rng.choice([15, 20, 25, 30, 40]),
        "subsample": round(rng.uniform(0.80, 0.95), 2),
        "colsample_bytree": round(rng.uniform(0.75, 0.90), 2),
        "scale_pos_weight": round(rng.uniform(3.8, 6.2), 1),
        "reg_alpha": round(rng.uniform(0.05, 0.40), 2),
        "reg_lambda": round(rng.uniform(0.10, 0.60), 2),
    }
    
    # Sample XGBoost hyperparameters
    xgb_params = {
        "n_estimators": rng.choice([300, 400, 500]),
        "max_depth": rng.choice([5, 6, 7]),
        "learning_rate": round(rng.uniform(0.022, 0.042), 4),
        "scale_pos_weight": round(rng.uniform(4.0, 5.8), 1),
        "subsample": round(rng.uniform(0.82, 0.92), 2),
        "colsample_bytree": round(rng.uniform(0.75, 0.88), 2),
        "reg_alpha": round(rng.uniform(0.05, 0.30), 2),
        "reg_lambda": round(rng.uniform(0.10, 0.40), 2),
    }
    
    # Weights for ensemble
    if ensemble_mode == "lgbm_xgb_blend":
        w_lgbm = round(rng.uniform(0.40, 0.70), 2)
        w_xgb = round(1.0 - w_lgbm, 2)
        w_py = 0.0
    elif ensemble_mode == "tri_hybrid_neural":
        w_lgbm = round(rng.uniform(0.40, 0.55), 2)
        w_xgb = round(rng.uniform(0.25, 0.40), 2)
        w_py = round(max(0.05, 1.0 - (w_lgbm + w_xgb)), 2)
    else:
        w_lgbm, w_xgb, w_py = 1.0, 0.0, 0.0
        
    threshold_penalty = round(rng.uniform(0.12, 0.30), 2)
    
    desc = (
        f"Hypothesis[{ensemble_mode} | hydro={hydro_mode} | topo={topo_mode} | "
        f"lgbm_leaves={lgbm_params['num_leaves']} | pos_w={lgbm_params['scale_pos_weight']} | "
        f"weights=({w_lgbm:.2f},{w_xgb:.2f},{w_py:.2f}) | far_pen={threshold_penalty}]"
    )
    
    code = generate_experimental_code(
        hydro_mode=hydro_mode,
        topo_mode=topo_mode,
        lgbm_params=lgbm_params,
        xgb_params=xgb_params,
        ensemble_mode=ensemble_mode,
        ensemble_weights=(w_lgbm, w_xgb, w_py),
        threshold_penalty_weight=threshold_penalty,
    )
    
    return desc, code


def execute_experiment_run(iteration: int) -> tuple[dict[str, Any] | None, str | None]:
    """Runs train.py in a subprocess and parses JSON output."""
    try:
        proc = subprocess.run(
            [str(PYTHON_BIN), str(TRAIN_FILE)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=50,
        )
        stdout = proc.stdout
        stderr = proc.stderr
        
        if proc.returncode != 0:
            err = f"Process exited with code {proc.returncode}.\nStderr: {stderr[:500]}"
            print(f"❌ Execution failed: {err}")
            return None, err
            
        match = re.search(r"--- JSON_RESULT_START ---\s*(\{[\s\S]*?\})\s*--- JSON_RESULT_END ---", stdout)
        if not match:
            err = f"Could not find JSON result markers in stdout.\nStdout: {stdout[:500]}"
            print(f"❌ Parse error: {err}")
            return None, err
            
        result_json = json.loads(match.group(1))
        return result_json, None
    except subprocess.TimeoutExpired:
        return None, "Execution timed out (>50s budget)"
    except Exception as exc:
        return None, str(exc)


def run_continuous_overnight_loop(max_iterations: int = 0, delay_sec: float = 1.0, seed: int = 42) -> None:
    """Continuous overnight autonomous research loop."""
    print("=" * 80)
    print("🚀 BhuRakshak Continuous Overnight Autoresearch Daemon")
    print(f"PID: {os.getpid()} | Started: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 80)
    
    backup_best_state()
    baseline_res, err = execute_experiment_run(0)
    if baseline_res is None:
        print(f"FATAL: Baseline failed: {err}")
        sys.exit(1)
        
    best_score = max(baseline_res["composite_score"], load_best_score())
    print(f"Active All-Time Best Score: {best_score:.5f}\n")
    
    rng = random.Random(seed)
    iteration = 1
    
    while True:
        if max_iterations > 0 and iteration > max_iterations:
            print(f"\nReached target iteration limit ({max_iterations}). Daemon stopping.")
            break
            
        hypothesis_desc, candidate_code = sample_random_hypothesis(rng)
        
        print(f"\n----------------------------------------------------------------------")
        print(f"🔬 EXPERIMENT #{iteration:04d} | Best Score: {best_score:.5f}")
        print(f"{hypothesis_desc}")
        print(f"----------------------------------------------------------------------")
        
        # Write candidate code
        TRAIN_FILE.write_text(candidate_code, encoding="utf-8")
        
        # Run experiment
        res, err = execute_experiment_run(iteration)
        
        if res is not None:
            new_score = res["composite_score"]
            score_diff = new_score - best_score
            print(f"Result: Score = {new_score:.5f} (Diff: {score_diff:+.5f})")
            
            if new_score > best_score:
                print(f"🌟 NEW RECORD SCORE: {new_score:.5f} (+{score_diff:.5f}) -> COMMITTING TO GIT")
                best_score = new_score
                backup_best_state()
                git_commit(f"autoresearch #{iteration}: {hypothesis_desc} (Score: {new_score:.5f})")
                record_experiment(iteration, hypothesis_desc, res, accepted=True)
            else:
                print(f"❌ REVERTED (Score {new_score:.5f} <= Best {best_score:.5f})")
                git_revert()
                record_experiment(iteration, hypothesis_desc, res, accepted=False)
        else:
            print(f"💥 CRASH / REVERTED: {err}")
            git_revert()
            record_experiment(iteration, hypothesis_desc, None, accepted=False, error_msg=err)
            
        iteration += 1
        time.sleep(delay_sec)


def main() -> None:
    parser = argparse.ArgumentParser(description="BhuRakshak Continuous Autoresearch Daemon")
    parser.add_argument("--iterations", type=int, default=0, help="Max iterations (0 = infinite overnight)")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between iterations (seconds)")
    parser.add_argument("--seed", type=int, default=42, help="Random exploration seed")
    args = parser.parse_args()
    
    run_continuous_overnight_loop(max_iterations=args.iterations, delay_sec=args.delay, seed=args.seed)


if __name__ == "__main__":
    main()
