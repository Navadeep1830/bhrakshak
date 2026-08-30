"""
04_train_model_a.py  —  BhuRakshak ML Training Pipeline, Step 4

Trains Model A: XGBoost Susceptibility (static spatial layer).

Pipeline:
  1. Download SRTM 30m DEM for NER bounding box using the `elevation` package.
  2. Compute terrain derivatives with WhiteboxTools:
       slope, aspect, TWI (Topographic Wetness Index), plan curvature,
       distance to stream, TPI (Topographic Position Index)
  3. Sample terrain feature vectors at:
       - COOLR NER event locations  (positive, label = 1)
       - Random NER interior points, away from events (negative, label = 0)
  4. Train XGBoost with leave-one-district-out spatial CV
       (prevents spatial leakage — the single biggest ML credibility signal).
  5. SHAP TreeExplainer for global + local feature importance.
  6. Inference on the full NER grid → susceptibility GeoTIFF (0-100 scale, 5 classes).

Outputs (all in artifacts/):
  model_a_susceptibility.pkl      — joblib bundle: model + metadata
  model_a_metrics.json            — spatial CV metrics
  model_a_shap_importance.json
  ner_susceptibility.tif          — full NER susceptibility raster (for dashboard)

Integration note:
  ner_susceptibility.tif feeds into Model B's zone-level susceptibility stats:
    susc_mean, susc_p90, susc_pct_high  (to be added to Model B v2 features)
  Host it via Martin/PostGIS as the static susceptibility layer on the GIS dashboard.

Runtime: 30–90 min (DEM download dominates; terrain computation ~10 min).
"""

import json, logging, warnings
import numpy as np
import pandas as pd
import joblib
import xgboost as xgb
import shap
import rasterio
from rasterio.transform import from_bounds
from pathlib import Path
from sklearn.metrics import average_precision_score, roc_auc_score

warnings.filterwarnings("ignore")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT         = Path(__file__).parent
DATA_RAW     = ROOT / "data" / "raw"
DEM_DIR      = ROOT / "data" / "dem"
FEATURES_DIR = ROOT / "data" / "features"
ARTIFACTS    = ROOT / "artifacts"
DEM_DIR.mkdir(parents=True, exist_ok=True)
FEATURES_DIR.mkdir(parents=True, exist_ok=True)

COOLR_NER    = DATA_RAW / "coolr_ner.csv"
DEM_TIF      = DEM_DIR  / "ner_srtm.tif"
SLOPE_TIF    = DEM_DIR  / "ner_slope.tif"
ASPECT_TIF   = DEM_DIR  / "ner_aspect.tif"
TWI_TIF      = DEM_DIR  / "ner_twi.tif"
CURVATURE_TIF= DEM_DIR  / "ner_curvature.tif"
TPI_TIF      = DEM_DIR  / "ner_tpi.tif"
SUSC_TIF     = ARTIFACTS / "ner_susceptibility.tif"

# ── NER bounding box ─────────────────────────────────────────────────────────
NER_BOUNDS = (87.7, 21.5, 97.5, 29.8)   # (lon_min, lat_min, lon_max, lat_max)

TERRAIN_FEATURES = ["elevation", "slope", "aspect", "twi", "curvature", "tpi"]

# ── District-to-state lookup for spatial CV ───────────────────────────────────
# We assign events to CV folds by state (proxy for district-out CV)
NER_STATES = {
    "assam":         (24.1, 28.2, 89.7, 96.0),
    "arunachal":     (26.6, 29.5, 91.5, 97.4),
    "manipur":       (23.8, 25.7, 93.0, 94.8),
    "meghalaya":     (25.0, 26.1, 89.8, 92.8),
    "mizoram":       (21.9, 24.5, 92.3, 93.5),
    "nagaland":      (25.2, 27.0, 93.3, 95.3),
    "tripura":       (22.9, 24.5, 91.1, 92.3),
    "sikkim":        (27.1, 28.1, 88.0, 88.9),
}

def assign_state(lat: float, lon: float) -> str:
    for state, (lat_min, lat_max, lon_min, lon_max) in NER_STATES.items():
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return state
    return "other"


# ─────────────────────────────────────────────────────────────────────────────
# 1.  Download SRTM 30m DEM via `elevation` package
# ─────────────────────────────────────────────────────────────────────────────
def download_dem() -> None:
    if DEM_TIF.exists():
        log.info(f"DEM already on disk ({DEM_TIF}) — skipping download.")
        return

    log.info("Downloading SRTM 30m DEM for NER (~500 MB–2 GB)…")
    try:
        import elevation
        elevation.clip(bounds=NER_BOUNDS, output=str(DEM_TIF), product="SRTM3")
        log.info(f"DEM saved → {DEM_TIF}")
    except Exception as e:
        raise RuntimeError(
            f"DEM download failed: {e}\n"
            "Make sure `elevation` is installed: pip install elevation\n"
            "Also requires GDAL: yay -S gdal   or   pip install gdal"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2.  Compute terrain derivatives with WhiteboxTools
# ─────────────────────────────────────────────────────────────────────────────
def compute_terrain() -> None:
    already_done = all(
        p.exists() for p in [SLOPE_TIF, ASPECT_TIF, TWI_TIF, CURVATURE_TIF, TPI_TIF]
    )
    if already_done:
        log.info("Terrain derivatives already computed — skipping.")
        return

    log.info("Computing terrain derivatives (WhiteboxTools)…")
    try:
        import whitebox
    except ImportError:
        raise ImportError("whitebox not installed: pip install whitebox")

    wbt = whitebox.WhiteboxTools()
    wbt.verbose = False
    wbt.work_dir = str(DEM_DIR)

    dem = str(DEM_TIF)

    log.info("  → Slope")
    wbt.slope(dem, str(SLOPE_TIF), units="degrees")

    log.info("  → Aspect")
    wbt.aspect(dem, str(ASPECT_TIF))

    log.info("  → Flow accumulation (needed for TWI)")
    fa_tif = str(DEM_DIR / "ner_flow_accum.tif")
    wbt.d8_flow_accumulation(dem, fa_tif)

    log.info("  → TWI (Topographic Wetness Index)")
    wbt.wetness_index(fa_tif, str(SLOPE_TIF), str(TWI_TIF))

    log.info("  → Plan curvature")
    wbt.plan_curvature(dem, str(CURVATURE_TIF))

    log.info("  → TPI (Topographic Position Index, 300m radius)")
    wbt.topographic_position_index(dem, str(TPI_TIF), minscale=1, maxscale=10, step=1)

    log.info("Terrain derivatives done.")


# ─────────────────────────────────────────────────────────────────────────────
# 3.  Sample terrain values at specific lat/lon points
# ─────────────────────────────────────────────────────────────────────────────
def sample_raster(tif_path: Path, lats: list, lons: list) -> np.ndarray:
    """Extract raster values at (lat, lon) coordinates. Returns float array."""
    with rasterio.open(tif_path) as src:
        coords = list(zip(lons, lats))   # rasterio expects (x=lon, y=lat)
        vals = np.array([v[0] for v in src.sample(coords)], dtype=float)
        nodata = src.nodata
        if nodata is not None:
            vals[vals == nodata] = np.nan
    return vals


def build_terrain_features(lats: list, lons: list) -> pd.DataFrame:
    """Build terrain feature DataFrame for a list of (lat, lon) points."""
    log.info(f"  Sampling terrain for {len(lats)} points…")
    records = {}

    rasters = {
        "elevation":  DEM_TIF,
        "slope":      SLOPE_TIF,
        "aspect":     ASPECT_TIF,
        "twi":        TWI_TIF,
        "curvature":  CURVATURE_TIF,
        "tpi":        TPI_TIF,
    }
    for feat_name, tif in rasters.items():
        if not tif.exists():
            log.warning(f"  {tif} not found — filling with NaN.")
            records[feat_name] = np.full(len(lats), np.nan)
        else:
            records[feat_name] = sample_raster(tif, lats, lons)

    records["lat"] = lats
    records["lon"] = lons
    return pd.DataFrame(records)


# ─────────────────────────────────────────────────────────────────────────────
# 4.  Build training dataset: COOLR positives + random NER negatives
# ─────────────────────────────────────────────────────────────────────────────
def build_training_dataset() -> pd.DataFrame:
    ner = pd.read_csv(COOLR_NER, parse_dates=["event_date"])

    pos_lats = ner["latitude"].tolist()
    pos_lons = ner["longitude"].tolist()
    n_pos = len(pos_lats)

    # ── Random negatives: sample from NER interior, at least 0.1° from any event ──
    rng = np.random.default_rng(42)
    n_neg = n_pos * 5

    event_coords = list(zip(pos_lats, pos_lons))
    neg_lats, neg_lons = [], []

    attempts = 0
    while len(neg_lats) < n_neg and attempts < n_neg * 20:
        attempts += 1
        lat = rng.uniform(21.5, 29.8)
        lon = rng.uniform(87.7, 97.5)
        # Ensure at least 0.1° (≈11 km) from any known event
        too_close = any(
            abs(lat - elat) < 0.1 and abs(lon - elon) < 0.1
            for elat, elon in event_coords
        )
        if not too_close:
            neg_lats.append(lat)
            neg_lons.append(lon)

    log.info(f"Sampled {n_pos} positives + {len(neg_lats)} negatives")

    # ── Build terrain features for all points ─────────────────────────────────
    all_lats = pos_lats + neg_lats
    all_lons = pos_lons + neg_lons
    labels   = [1] * n_pos + [0] * len(neg_lats)

    df_terrain = build_terrain_features(all_lats, all_lons)
    df_terrain["label"] = labels
    df_terrain["state"] = [assign_state(lt, ln) for lt, ln in zip(all_lats, all_lons)]

    # Drop rows with too many NaNs
    df_terrain = df_terrain.dropna(subset=["slope", "elevation"]).reset_index(drop=True)

    # Fill remaining NaNs with median
    for col in TERRAIN_FEATURES:
        if col in df_terrain.columns:
            df_terrain[col] = df_terrain[col].fillna(df_terrain[col].median())

    out = FEATURES_DIR / "model_a_dataset.parquet"
    df_terrain.to_parquet(out, index=False)
    log.info(f"Terrain dataset saved → {out}  ({len(df_terrain)} rows)")
    return df_terrain


# ─────────────────────────────────────────────────────────────────────────────
# 5.  Train XGBoost with leave-one-state-out spatial CV
# ─────────────────────────────────────────────────────────────────────────────
def train_xgboost_spatial_cv(df: pd.DataFrame) -> tuple:
    log.info("Training XGBoost with leave-one-state-out spatial CV…")

    states = [s for s in df["state"].unique() if s != "other"]
    X_all = df[TERRAIN_FEATURES].astype(float).values
    y_all = df["label"].values.astype(int)

    cv_scores = []
    for held_out in states:
        train_mask = df["state"] != held_out
        val_mask   = df["state"] == held_out

        X_tr, y_tr = X_all[train_mask], y_all[train_mask]
        X_va, y_va = X_all[val_mask],   y_all[val_mask]

        if y_va.sum() == 0 or len(y_va) < 5:
            log.warning(f"  Skipping {held_out} (too few positives in held-out)")
            continue

        pos_weight = (y_tr == 0).sum() / max((y_tr == 1).sum(), 1)

        m = xgb.XGBClassifier(
            n_estimators=800,
            learning_rate=0.05,
            max_depth=5,
            subsample=0.8,
            colsample_bytree=0.8,
            scale_pos_weight=pos_weight,
            eval_metric="aucpr",
            early_stopping_rounds=40,
            device="cuda",
            random_state=42,
            verbosity=0,
        )
        m.fit(
            X_tr, y_tr,
            eval_set=[(X_va, y_va)],
            verbose=False,
        )
        pr_auc = average_precision_score(y_va, m.predict_proba(X_va)[:, 1])
        log.info(f"  {held_out:12s} — PR-AUC: {pr_auc:.4f}  (n={len(y_va)}, pos={y_va.sum()})")
        cv_scores.append({"state": held_out, "pr_auc": pr_auc, "n": int(len(y_va))})

    mean_pr = np.mean([s["pr_auc"] for s in cv_scores])
    log.info(f"  Spatial CV mean PR-AUC: {mean_pr:.4f}")

    # ── Final model on all data ────────────────────────────────────────────────
    log.info("Training final model on all data…")
    pos_weight_all = (y_all == 0).sum() / max((y_all == 1).sum(), 1)
    final_model = xgb.XGBClassifier(
        n_estimators=800,
        learning_rate=0.05,
        max_depth=5,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=pos_weight_all,
        eval_metric="aucpr",
        device="cuda",
        random_state=42,
        verbosity=0,
    )
    final_model.fit(X_all, y_all, verbose=False)

    return final_model, cv_scores, mean_pr


# ─────────────────────────────────────────────────────────────────────────────
# 6.  SHAP
# ─────────────────────────────────────────────────────────────────────────────
def compute_shap_a(model, X: np.ndarray) -> dict:
    log.info("Computing SHAP (Model A)…")
    explainer   = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)
    mean_abs    = np.abs(shap_values).mean(axis=0)
    importance  = dict(zip(TERRAIN_FEATURES, [round(float(v), 6) for v in mean_abs]))
    importance_sorted = dict(sorted(importance.items(), key=lambda x: -x[1]))
    log.info("  Top features:")
    for k, v in list(importance_sorted.items())[:4]:
        log.info(f"    {k:12s}  {v:.5f}")
    return importance_sorted


# ─────────────────────────────────────────────────────────────────────────────
# 7.  Inference: full NER susceptibility raster
# ─────────────────────────────────────────────────────────────────────────────
def infer_susceptibility_raster(model) -> None:
    """
    Apply Model A to a coarser grid (0.01° ≈ 1 km) over NER to produce
    the susceptibility map used by the GIS dashboard and Model B v2.
    Full 30m would be 291M cells — not practical in a hackathon pipeline.
    1km grid: ~26k cells, fast enough.
    """
    log.info("Generating NER susceptibility raster at 0.01° (≈1 km)…")

    lon_min, lat_min, lon_max, lat_max = NER_BOUNDS
    step = 0.01
    lons_grid = np.arange(lon_min, lon_max, step)
    lats_grid = np.arange(lat_max, lat_min, -step)   # top-to-bottom (rasterio convention)

    all_lons = np.tile(lons_grid, len(lats_grid))
    all_lats = np.repeat(lats_grid, len(lons_grid))

    df_grid = build_terrain_features(all_lats.tolist(), all_lons.tolist())

    # Fill NaN with median
    for col in TERRAIN_FEATURES:
        if col in df_grid.columns:
            df_grid[col] = df_grid[col].fillna(df_grid[col].median())

    X_grid = df_grid[TERRAIN_FEATURES].astype(float).values
    probs  = model.predict_proba(X_grid)[:, 1]

    # Scale 0-100
    susc_map = (probs * 100).reshape(len(lats_grid), len(lons_grid)).astype(np.float32)

    transform = from_bounds(lon_min, lat_min, lon_max, lat_max, len(lons_grid), len(lats_grid))
    with rasterio.open(
        SUSC_TIF, "w",
        driver="GTiff", height=len(lats_grid), width=len(lons_grid),
        count=1, dtype="float32", crs="EPSG:4326",
        transform=transform,
        compress="lzw",
    ) as dst:
        dst.write(susc_map, 1)

    log.info(f"Susceptibility raster saved → {SUSC_TIF}")
    log.info(f"  Value range: [{susc_map.min():.1f}, {susc_map.max():.1f}]")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log.info("=" * 60)
    log.info("  BhuRakshak  —  Step 4: Train Model A (Susceptibility)")
    log.info("=" * 60)

    # 1. DEM download
    download_dem()

    # 2. Terrain derivatives
    compute_terrain()

    # 3. Build training dataset
    df = build_training_dataset()

    # 4. Train with spatial CV
    model, cv_scores, mean_pr_auc = train_xgboost_spatial_cv(df)

    # 5. SHAP
    X_all = df[TERRAIN_FEATURES].astype(float).values
    shap_imp = compute_shap_a(model, X_all)

    # 6. Susceptibility raster
    infer_susceptibility_raster(model)

    # 7. Export
    bundle = {
        "model":           model,
        "feature_names":   TERRAIN_FEATURES,
        "spatial_cv":      cv_scores,
        "mean_pr_auc_cv":  round(mean_pr_auc, 4),
        "shap_importance": shap_imp,
    }
    model_path = ARTIFACTS / "model_a_susceptibility.pkl"
    joblib.dump(bundle, model_path)
    log.info(f"Model A saved → {model_path}")

    metrics = {
        "model":            "model_a_susceptibility",
        "algorithm":        "XGBoost",
        "features":         TERRAIN_FEATURES,
        "validation":       "leave-one-state-out spatial CV",
        "spatial_cv_folds": cv_scores,
        "mean_pr_auc_cv":   round(mean_pr_auc, 4),
        "shap_importance":  shap_imp,
        "note":             (
            "Susceptibility features do not include rainfall. "
            "They are static spatial predictors. "
            "susc_mean/susc_p90/susc_pct_high from ner_susceptibility.tif "
            "should be added as features in Model B v2."
        ),
    }
    with open(ARTIFACTS / "model_a_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)

    (ARTIFACTS / "model_a_shap_importance.json").write_text(
        json.dumps(shap_imp, indent=2)
    )

    log.info("\n" + "=" * 60)
    log.info("  Model A  DONE")
    log.info(f"  Spatial CV PR-AUC: {mean_pr_auc:.4f}")
    log.info(f"  Susceptibility raster: {SUSC_TIF}")
    log.info("=" * 60)
    log.info("  All training complete.  Artifacts in:  ./artifacts/")
