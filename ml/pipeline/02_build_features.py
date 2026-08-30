"""
02_build_features.py  —  BhuRakshak ML Training Pipeline, Step 2

Builds the training dataset for Model B (Hazard Nowcast — LightGBM).

For every COOLR NER event (positive label = 1):
  - Looks up the matching Open-Meteo time series
  - Computes rolling rainfall windows: 1h, 3h, 6h, 12h, 24h, 48h, 72h, 7d
  - Computes Kohler-Linsley effective (antecedent) rainfall
  - Extracts soil moisture at event time

For every positive, generates 5 synthetic negatives (label = 0):
  - Same grid cell, random dry-season date (Nov–Mar), year unchanged
  - Same feature computation, verified not to fall on a known event date

Output:
  data/features/model_b_dataset.parquet  — combined feature matrix, ready to train

Runtime: ~5–15 min depending on event count.
"""

import random, logging
import pandas as pd
import numpy as np
from pathlib import Path
from tqdm import tqdm

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

random.seed(42)
np.random.seed(42)

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT         = Path(__file__).parent
DATA_RAW     = ROOT / "data" / "raw"
TS_DIR       = DATA_RAW / "timeseries"
FEATURES_DIR = ROOT / "data" / "features"
FEATURES_DIR.mkdir(parents=True, exist_ok=True)

COOLR_NER    = DATA_RAW / "coolr_ner.csv"
OUT_PARQUET  = FEATURES_DIR / "model_b_dataset.parquet"

# Dry season months for NER (low rainfall, reliable negatives)
DRY_MONTHS = {11, 12, 1, 2, 3}
NEGS_PER_POS = 5

# ─────────────────────────────────────────────────────────────────────────────
# Effective rainfall — Kohler-Linsley exponential decay
# ─────────────────────────────────────────────────────────────────────────────
def effective_rainfall(hourly_rain: np.ndarray, half_life_h: float = 48.0) -> float:
    """
    ER(t) = rain(t) + k * ER(t-1)
    k = decay factor s.t. half-life = half_life_h hours.
    Processes oldest → newest (pass the window ending at event time).
    """
    k = 0.5 ** (1.0 / half_life_h)
    er = 0.0
    for r in hourly_rain:
        r_val = float(r) if not pd.isna(r) else 0.0
        er = r_val + k * er
    return er


# ─────────────────────────────────────────────────────────────────────────────
# Feature extraction for a single timestamp
# ─────────────────────────────────────────────────────────────────────────────
def extract_features(ts: pd.DataFrame, event_dt: pd.Timestamp) -> dict | None:
    """
    Given a sorted hourly time series and an event datetime, return the
    17-feature dict needed by Model B.  Returns None if insufficient history.
    """
    ts = ts.sort_values("time").reset_index(drop=True)
    idx = int(ts["time"].searchsorted(event_dt, side="right")) - 1

    # Need at least 7 days of history before the event
    if idx < 168:
        return None
    if idx >= len(ts):
        return None

    rain   = ts["precip"].fillna(0).values.astype(float)
    sm_0_7  = ts["sm_0_7"].values.astype(float)
    sm_7_28 = ts["sm_7_28"].values.astype(float)

    def rsum(hours: int) -> float:
        start = max(0, idx - hours)
        return float(np.nansum(rain[start:idx]))

    # Rolling sums
    r1h  = rsum(1)
    r3h  = rsum(3)
    r6h  = rsum(6)
    r12h = rsum(12)
    r24h = rsum(24)
    r48h = rsum(48)
    r72h = rsum(72)
    r7d  = rsum(168)

    # Effective rainfall over 14-day window (336 h)
    window_start = max(0, idx - 336)
    er = effective_rainfall(rain[window_start:idx])

    # Soil moisture at event time (with fallback to nearest non-NaN)
    def safe_sm(arr: np.ndarray, i: int) -> float:
        if not np.isnan(arr[i]):
            return float(arr[i])
        # Walk back up to 6 hours
        for j in range(i - 1, max(0, i - 7), -1):
            if not np.isnan(arr[j]):
                return float(arr[j])
        return float(np.nanmean(arr[max(0, i - 48):i + 1]))

    sm0 = safe_sm(sm_0_7,  idx)
    sm1 = safe_sm(sm_7_28, idx)

    return {
        "rain_1h":   r1h,
        "rain_3h":   r3h,
        "rain_6h":   r6h,
        "rain_12h":  r12h,
        "rain_24h":  r24h,
        "rain_48h":  r48h,
        "rain_72h":  r72h,
        "rain_7d":   r7d,
        "eff_rain":  er,
        "sm_0_7":    sm0,
        "sm_7_28":   sm1,
        "month":     event_dt.month,
        "hour":      event_dt.hour,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Load all time series into memory (keyed by grid cell)
# ─────────────────────────────────────────────────────────────────────────────
def load_timeseries() -> dict[str, pd.DataFrame]:
    ts_files = list(TS_DIR.glob("ts_*.parquet"))
    log.info(f"Loading {len(ts_files)} time-series files…")
    ts_map = {}
    for f in ts_files:
        df = pd.read_parquet(f)
        df["time"] = pd.to_datetime(df["time"])
        df = df.sort_values("time").reset_index(drop=True)
        glat = round(float(df["grid_lat"].iloc[0]), 2)
        glon = round(float(df["grid_lon"].iloc[0]), 2)
        ts_map[f"{glat}_{glon}"] = df
    return ts_map


# ─────────────────────────────────────────────────────────────────────────────
# Main feature-building loop
# ─────────────────────────────────────────────────────────────────────────────
def build_dataset() -> pd.DataFrame:
    ner = pd.read_csv(COOLR_NER, parse_dates=["event_date", "event_dt"])
    ts_map = load_timeseries()

    # Set of all event dates per grid cell (to avoid labelling negatives as positives)
    event_dates_by_cell: dict[str, set] = {}
    for _, row in ner.iterrows():
        key = f"{round(float(row['grid_lat']),2)}_{round(float(row['grid_lon']),2)}"
        event_dates_by_cell.setdefault(key, set()).add(row["event_dt"].date())

    rows: list[dict] = []
    skipped_no_ts = 0
    skipped_short = 0

    for _, ev in tqdm(ner.iterrows(), total=len(ner), desc="Building features"):
        glat = round(float(ev["grid_lat"]), 2)
        glon = round(float(ev["grid_lon"]), 2)
        key  = f"{glat}_{glon}"
        cell_event_dates = event_dates_by_cell.get(key, set())

        ts = ts_map.get(key)
        if ts is None:
            skipped_no_ts += 1
            continue

        event_dt = pd.Timestamp(ev["event_dt"])

        # ── Positive sample ──────────────────────────────────────────────────
        feat = extract_features(ts, event_dt)
        if feat is None:
            skipped_short += 1
            continue

        feat.update({
            "lat":   float(ev["latitude"]),
            "lon":   float(ev["longitude"]),
            "label": 1,
        })
        rows.append(feat)

        # ── Negative samples: dry-season dates at same cell ──────────────────
        ts_time = ts["time"]
        dry_ts = ts[ts_time.dt.month.isin(DRY_MONTHS)].copy()
        dry_dates = [
            d for d in dry_ts["time"].dt.date.unique()
            if d not in cell_event_dates
        ]

        if not dry_dates:
            continue

        sampled_dates = random.sample(dry_dates, min(NEGS_PER_POS, len(dry_dates)))

        for neg_date in sampled_dates:
            neg_dt = pd.Timestamp(neg_date).replace(hour=12)
            neg_feat = extract_features(ts, neg_dt)
            if neg_feat is None:
                continue
            neg_feat.update({
                "lat":   float(ev["latitude"]),
                "lon":   float(ev["longitude"]),
                "label": 0,
            })
            rows.append(neg_feat)

    df_out = pd.DataFrame(rows)

    log.info(f"Dataset built:  {len(df_out)} rows total")
    log.info(f"  Positives : {(df_out['label'] == 1).sum()}")
    log.info(f"  Negatives : {(df_out['label'] == 0).sum()}")
    log.info(f"  Skipped (no time series) : {skipped_no_ts}")
    log.info(f"  Skipped (insufficient history) : {skipped_short}")

    if len(df_out) < 50:
        raise RuntimeError(
            f"Only {len(df_out)} samples — too few to train. "
            "Check if COOLR filtered correctly and time series were fetched."
        )

    df_out.to_parquet(OUT_PARQUET, index=False)
    log.info(f"Saved → {OUT_PARQUET}")
    return df_out


# ─────────────────────────────────────────────────────────────────────────────
# Quick sanity check
# ─────────────────────────────────────────────────────────────────────────────
def sanity_check(df: pd.DataFrame) -> None:
    log.info("\n── Sanity check ─────────────────────────────────────")
    log.info(f"Shape        : {df.shape}")
    log.info(f"Columns      : {list(df.columns)}")
    log.info(f"NaN counts   :\n{df.isnull().sum()}")
    log.info(f"Label dist   : {df['label'].value_counts().to_dict()}")
    log.info(f"rain_24h max : {df['rain_24h'].max():.1f} mm")
    log.info(f"sm_0_7  range: [{df['sm_0_7'].min():.3f}, {df['sm_0_7'].max():.3f}]")
    log.info("─────────────────────────────────────────────────────\n")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log.info("=" * 60)
    log.info("  BhuRakshak  —  Step 2: Build Features")
    log.info("=" * 60)

    df = build_dataset()
    sanity_check(df)

    log.info("Step 2 DONE.  Run:  python 03_train_model_b.py")
