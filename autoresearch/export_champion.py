"""export_champion.py - Serializes Champion Autoresearch Model for Production API
SIH26001: Exports Model A & Model B bundles for the live FastAPI risk engine & dashboard.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import joblib
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from autoresearch.evaluate import compute_composite_score
from autoresearch.train import (
    DATA_DIR,
    hazard_feature_names,
    preprocess_hazard_features,
    preprocess_susceptibility_features,
    susceptibility_feature_names,
)

ARTIFACTS_DIR = PROJECT_ROOT / "ml" / "artifacts"
API_MODEL_DIR = PROJECT_ROOT / "apps" / "api" / "app" / "services" / "ml_models"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
API_MODEL_DIR.mkdir(parents=True, exist_ok=True)


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_ROOT, text=True
        ).strip()
    except Exception:
        return "unknown"


def _data_provenance() -> dict:
    """Read the synthetic flag prepare.py writes into data/metadata.json.

    The bundle must inherit it. Otherwise a model trained on generated labels
    is exported looking exactly like one trained on a real inventory, and
    nothing downstream can tell them apart.
    """
    meta_path = DATA_DIR / "metadata.json"
    if not meta_path.exists():
        return {"synthetic": True, "synthetic_reason": "no metadata.json; provenance unknown"}
    try:
        meta = json.loads(meta_path.read_text())
    except Exception:
        return {"synthetic": True, "synthetic_reason": "unreadable metadata.json"}
    return {
        "synthetic": bool(meta.get("synthetic", False)),
        "synthetic_reason": meta.get("synthetic_reason"),
        "data_generated_at": meta.get("generated_at"),
    }


def export_champion():
    print("=" * 70)
    print("📦 Exporting Champion BhuRakshak Models to Production API")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 70)

    provenance = _data_provenance()
    sha = _git_sha()
    if provenance["synthetic"]:
        print("\n" + "!" * 70)
        print("!!  TRAINING DATA IS SYNTHETIC")
        print(f"!!  {provenance.get('synthetic_reason')}")
        print("!!  The exported bundles will carry synthetic=true, and")
        print("!!  risk_engine.get_model_b_bundle() will REFUSE to load them.")
        print("!!  That is intentional. Re-run the real pipeline (ml/pipeline/)")
        print("!!  on observed inventories before exporting for production.")
        print("!" * 70 + "\n")
    
    # 1. Load Data
    susc_npz = np.load(DATA_DIR / "data_susceptibility.npz", allow_pickle=True)
    hazard_npz = np.load(DATA_DIR / "data_hazard_nowcast.npz", allow_pickle=True)
    
    X_susc_raw, y_susc, groups = susc_npz["X"], susc_npz["y"], susc_npz["groups"]
    susc_feats = list(susc_npz["features"])
    
    X_haz_raw, y_haz, years = hazard_npz["X"], hazard_npz["y"], hazard_npz["years"]
    haz_feats = list(hazard_npz["features"])
    
    # 2. Train and Serialize Model A (Susceptibility)
    print("\n[1/2] Packaging Model A: Susceptibility Classifier...")
    from lightgbm import LGBMClassifier
    from sklearn.preprocessing import StandardScaler
    
    X_susc = preprocess_susceptibility_features(X_susc_raw, susc_feats)
    scaler_susc = StandardScaler()
    X_susc_scaled = scaler_susc.fit_transform(X_susc)
    
    model_a = LGBMClassifier(
        n_estimators=350,
        num_leaves=31,
        learning_rate=0.045,
        max_depth=6,
        min_child_samples=25,
        subsample=0.85,
        colsample_bytree=0.80,
        scale_pos_weight=3.0,
        random_state=42,
        n_jobs=4,
        verbose=-1,
    )
    model_a.fit(X_susc_scaled, y_susc)
    
    # Names AFTER preprocessing: the model sees 27 columns (24 raw + 3
    # engineered), so declaring susc_feats here would describe a matrix that
    # no longer exists.
    susc_out_feats = susceptibility_feature_names(susc_feats)
    assert X_susc.shape[1] == len(susc_out_feats), (
        f"Model A width mismatch: matrix has {X_susc.shape[1]} columns, "
        f"declared {len(susc_out_feats)} names"
    )

    model_a_bundle = {
        "name": "Model A - Susceptibility",
        "version": "v1.0-autoresearch-champion",
        "model": model_a,
        "scaler": scaler_susc,
        "features": susc_out_feats,
        "raw_features": susc_feats,
        "engineered_features": [f for f in susc_out_feats if f not in susc_feats],
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": sha,
        **provenance,
    }

    joblib.dump(model_a_bundle, ARTIFACTS_DIR / "model_a_susceptibility.pkl")
    joblib.dump(model_a_bundle, API_MODEL_DIR / "model_a_susceptibility.pkl")
    print(f"  Exported Model A bundle -> {API_MODEL_DIR / 'model_a_susceptibility.pkl'}")
    print(f"    features: {len(susc_out_feats)} ({len(susc_feats)} raw + "
          f"{len(susc_out_feats) - len(susc_feats)} engineered)")
    
    # 3. Train and Serialize Model B (Hazard Nowcast)
    print("\n[2/2] Packaging Model B: Tri-Hybrid Hazard Nowcast Ensemble...")
    from xgboost import XGBClassifier
    from sklearn.calibration import IsotonicRegression
    from sklearn.preprocessing import RobustScaler
    
    X_haz = preprocess_hazard_features(X_haz_raw, haz_feats)
    train_mask = years <= 2019
    val_mask = (years >= 2020) & (years <= 2022)
    
    scaler_haz = RobustScaler()
    X_haz_train_scaled = scaler_haz.fit_transform(X_haz[train_mask])
    X_haz_val_scaled = scaler_haz.transform(X_haz[val_mask])
    
    # LightGBM
    lgbm_b = LGBMClassifier(
        n_estimators=550,
        num_leaves=64,
        learning_rate=0.028,
        max_depth=8,
        min_child_samples=20,
        subsample=0.90,
        colsample_bytree=0.80,
        scale_pos_weight=4.4,
        reg_alpha=0.15,
        reg_lambda=0.30,
        random_state=42,
        n_jobs=4,
        verbose=-1,
    )
    lgbm_b.fit(X_haz_train_scaled, y_haz[train_mask])
    
    # XGBoost
    xgb_b = XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.032,
        scale_pos_weight=4.8,
        subsample=0.88,
        colsample_bytree=0.82,
        reg_alpha=0.15,
        reg_lambda=0.25,
        random_state=42,
        n_jobs=4,
        verbosity=0,
    )
    xgb_b.fit(X_haz_train_scaled, y_haz[train_mask])
    
    # Calibrator on validation set
    val_raw_prob = 0.58 * lgbm_b.predict_proba(X_haz_val_scaled)[:, 1] + 0.42 * xgb_b.predict_proba(X_haz_val_scaled)[:, 1]
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(val_raw_prob, y_haz[val_mask])
    
    # Same as Model A: 16 columns go in (12 raw + 4 engineered), so 16 names
    # have to come out.
    haz_out_feats = hazard_feature_names(haz_feats)
    assert X_haz.shape[1] == len(haz_out_feats), (
        f"Model B width mismatch: matrix has {X_haz.shape[1]} columns, "
        f"declared {len(haz_out_feats)} names"
    )

    model_b_bundle = {
        "name": "Model B - Hazard Nowcast",
        "version": "v1.0-autoresearch-champion",
        "lgbm": lgbm_b,
        "xgb": xgb_b,
        "weights": (0.58, 0.42),
        "scaler": scaler_haz,
        "calibrator": calibrator,
        # 0.437 was a hand-set constant, not derived from the validation
        # split. Recorded for reference only -- the API decides alert levels
        # from the alert budget in ml/models/hazard_nowcast.py, not from this.
        "optimal_threshold_reference_only": 0.437,
        "features": haz_out_feats,
        "raw_features": haz_feats,
        "engineered_features": [f for f in haz_out_feats if f not in haz_feats],
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": sha,
        **provenance,
    }

    joblib.dump(model_b_bundle, ARTIFACTS_DIR / "model_b_nowcast.pkl")
    joblib.dump(model_b_bundle, API_MODEL_DIR / "model_b_nowcast.pkl")
    print(f"  Exported Model B bundle -> {API_MODEL_DIR / 'model_b_nowcast.pkl'}")
    print(f"    features: {len(haz_out_feats)} ({len(haz_feats)} raw + "
          f"{len(haz_out_feats) - len(haz_feats)} engineered)")

    if provenance["synthetic"]:
        print("\n⚠️  Exported bundles are marked synthetic=true. The API will not load")
        print("    them. This is the correct outcome -- do not edit the flag to")
        print("    work around it; fix the training data instead.")

    print("\n✅ Production model export complete.\n")


if __name__ == "__main__":
    export_champion()
