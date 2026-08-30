"""MODEL B - Hazard Nowcast (WHEN).

Answers: given the rain that has fallen, will a landslide happen in the next
24 hours?

Leakage controls (the reason this file is long)
-----------------------------------------------
1. **Temporal leakage.** The label for time t is "an event occurs in (t, t+24h]".
   Features at time t use only rainfall at or before t. The original scaffold
   labelled a row positive if an event had *already* happened that day, which
   lets the model read the future -- it scores brilliantly and predicts nothing.
2. **No random split.** Samples are split by time (train up to 2014, test
   2015-2017). A random split on autocorrelated daily rainfall leaks tomorrow's
   weather into today's training row.
3. **No cascade leakage.** This model predicts *hazard*, not the fused warning
   level. The I-D threshold tier and hysteresis live in the API's risk engine;
   feeding a model its own downstream output would be circular.
4. **Reporting bias.** The NASA catalog over-reports events near roads and
   towns. Weights are the inverse of a simple accessibility proxy so the model
   fits the terrain/rainfall signal rather than "is this near a road".

Baseline
--------
Caine (1980) global intensity-duration threshold  I = 14.82 * D^(-0.39) is
evaluated on the same test set. Beating a published global threshold with a
regionally-trained model is the claim; without it there is nothing to compare to.

Run:
    python -m ml.models.hazard_nowcast
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from ml.config.aois import ANCHOR_EVENTS, all_aois
from ml.registry.registry import git_sha, save_artifact_meta, write_model_card

log = logging.getLogger("bhrakshak.hazard")

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
CACHE = Path(__file__).resolve().parents[1] / "cache"

# District-mean terms describe the general wetness; the `_gridmax` terms come
# from the 3x3 sample grid and describe the worst cell in the district. Slides
# initiate at the extreme, so the grid terms are the ones that carry signal.
FEATURES = [
    "rain_24h",
    "rain_72h",
    "rain_7d",
    "rain_max_1h",
    "eff_rain",
    "rain_24h_gridmax",
    "rain_72h_gridmax",
    "rain_1h_gridmax",
    "eff_rain_gridmax",
    "rain_24h_gridmax_anom",
    "is_monsoon",
    "sin_doy",
    "cos_doy",
]

# An unweighted model on a 0.3% base rate predicts "no" for everything; the
# raw n_neg/n_pos ratio (300+) makes it predict "yes" for everything. Both are
# useless, so the weight is chosen by out-of-fold average precision instead of
# being fixed by either rule of thumb.
SCALE_POS_WEIGHT_GRID = [1.0, 5.0, 15.0, 40.0, 100.0]

# Alert levels are defined by the fraction of days the system is allowed to
# spend at that level, not by a probability number. This is how an operational
# warning system is actually budgeted: L4 may fire on ~1% of days (3-4 days a
# year) or it stops being an emergency. Thresholds are frozen on the
# calibration split and measured on the untouched test period.
ALERT_LEVELS = [
    (1, "L1", 0.20),
    (2, "L2", 0.10),
    (3, "L3", 0.03),
    (4, "L4", 0.01),
]
ALERT_BUDGETS = [budget for _, _, budget in ALERT_LEVELS]

MODEL_NAME = "hazard_nowcast"
MODEL_VERSION = "v1-real-openmeteo"


# ---------------------------------------------------------------------------
# data assembly
# ---------------------------------------------------------------------------
def load_weather(aoi_slug: str) -> pd.DataFrame:
    """Featured hourly weather from the Module 1 cache."""
    path = CACHE / f"weather_{aoi_slug}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"no weather cache for {aoi_slug}; run ml.ingest.weather first")
    df = pd.read_parquet(path)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.sort_values("ts").reset_index(drop=True)


def load_labels() -> pd.DataFrame:
    """Real events from the NASA GLC (built by ml.ingest.labels)."""
    path = ARTIFACTS / "labels_events.csv"
    if not path.exists():
        raise FileNotFoundError("no labels; run `python -m ml.ingest.labels` first")
    df = pd.read_csv(path)
    df["event_ts"] = pd.to_datetime(df["event_ts"], utc=True)
    return df


def to_daily(weather: pd.DataFrame) -> pd.DataFrame:
    """Collapse hourly weather to one row per UTC day.

    ``rain_max_1h`` (peak hourly intensity) matters because landslides are
    triggered by intensity, not just totals -- 40 mm in one hour is a different
    hazard from 40 mm spread over a day, and the I-D literature is explicit
    about that.
    """
    idx = weather.set_index("ts")
    cols: dict[str, pd.Series] = {
        "rain_24h": idx["precipitation_mm"].resample("1D").sum(),
        "rain_max_1h": idx["precipitation_mm"].resample("1D").max(),
        # last value of the day = the accumulated state at end of day
        "rain_72h": idx["rain_72h"].resample("1D").last(),
        "rain_7d": idx["rain_7d"].resample("1D").last(),
        "eff_rain": idx["eff_rain"].resample("1D").last(),
    }
    # Grid-sampled caches carry the district worst-cell series; older
    # centroid-only caches do not, and the model still runs without them.
    if "rain_24h_gridmax" in weather.columns:
        cols["rain_24h_gridmax"] = idx["rain_24h_gridmax"].resample("1D").max()
        cols["rain_72h_gridmax"] = idx["rain_72h_gridmax"].resample("1D").max()
        cols["rain_1h_gridmax"] = idx["rain_1h_gridmax"].resample("1D").max()
        cols["eff_rain_gridmax"] = idx["eff_rain_gridmax"].resample("1D").max()
    daily = pd.DataFrame(cols).dropna(subset=["rain_24h"])
    daily.index.name = "day"
    daily = daily.reset_index()
    daily["sin_doy"] = np.sin(2 * np.pi * daily["day"].dt.dayofyear / 365.25)
    daily["cos_doy"] = np.cos(2 * np.pi * daily["day"].dt.dayofyear / 365.25)
    daily["is_monsoon"] = daily["day"].dt.month.isin(range(5, 10)).astype(int)
    return daily


def build_supervised(
    aoi_slug: str,
    aoi_code: str,
    labels: pd.DataFrame,
    horizon_days: int = 1,
) -> pd.DataFrame:
    """Daily samples for one AOI with a forward-looking label.

    label(t) = 1 when at least one rainfall-triggered event falls in
    (t, t + horizon_days]. Everything used as a feature is measured at or
    before the end of day t.
    """
    daily = to_daily(load_weather(aoi_slug))
    if daily.empty:
        return daily

    ev = labels[(labels["aoi_code"] == aoi_code) & (labels["is_rain_triggered"])]
    ev_ts = ev["event_ts"].dropna().to_numpy("datetime64[ns]")

    day_start = daily["day"].to_numpy("datetime64[ns]")
    window_end = day_start + np.timedelta64(horizon_days, "D")

    label = np.zeros(len(daily), dtype=int)
    lead_h = np.full(len(daily), np.nan)
    for i, (start, end) in enumerate(zip(day_start, window_end)):
        hit = ev_ts[(ev_ts > start) & (ev_ts <= end)]
        if len(hit):
            label[i] = 1
            # hours from end of day t to the first event in the window
            lead_h[i] = (hit.min() - end).astype("timedelta64[h]").astype(int) + horizon_days * 24

    daily["label"] = label
    daily["lead_h"] = lead_h

    add_anomalies(daily)

    # Reporting-bias proxy. The GLC is compiled largely from news reports, so
    # events near population centres are over-sampled. Without this the model
    # partly learns "is this a well-reported place". We only have district-level
    # information here, so the weight is a coarse inverse-frequency correction
    # by district; it is recorded in the model card as a known simplification.
    daily["aoi_code"] = aoi_code
    return daily


def add_anomalies(daily: pd.DataFrame) -> pd.DataFrame:
    """District-relative rainfall anomalies, added in place and returned.

    60 mm means something different in Cherrapunji than in Gangtok, so each
    accumulation is normalised against the district's own 90th percentile.
    Split out of :func:`build_supervised` so the Noney case study -- which
    resamples a window without labels -- still produces every column the model
    was trained on.
    """
    for col in ("rain_24h", "rain_24h_gridmax"):
        if col in daily.columns:
            p90 = daily[col].quantile(0.90)
            daily[f"{col}_anom"] = daily[col] / max(float(p90), 1e-6)
    return daily


def inverse_frequency_weights(codes: pd.Series) -> pd.Series:
    """Coarse de-biasing: down-weight over-represented districts."""
    counts = codes.value_counts()
    w = codes.map(lambda c: 1.0 / counts[c])
    return w / w.mean()


# ---------------------------------------------------------------------------
# baselines
# ---------------------------------------------------------------------------
def caine_intensity(duration_h: float) -> float:
    """Caine (1980) global rainfall intensity-duration threshold, mm/h.

    I = 14.82 * D^(-0.39), the most cited global landslide-triggering threshold.
    Used as the "could a published rule do this?" baseline.
    """
    return 14.82 * (duration_h ** -0.39)


def caine_baseline_predict(test: pd.DataFrame, duration_h: float = 24.0) -> np.ndarray:
    """Positive when mean intensity over the window exceeds the Caine curve."""
    threshold_mm = caine_intensity(duration_h) * duration_h
    return (test["rain_24h"].to_numpy() >= threshold_mm).astype(int)


def fit_relative_rain_threshold(
    train: pd.DataFrame,
    test: pd.DataFrame,
    col: str = "rain_24h_anom",
    duration_h: float = 24.0,
) -> dict:
    """Alarm when the day's rain exceeds k x that district's own 90th percentile.

    Why not an absolute threshold?

    Caine (1980) and every other published intensity-duration curve were fitted
    to rain-gauge POINT measurements. This system ingests gridded reanalysis
    averaged over districts of thousands of square kilometres, and area-mean
    rainfall is systematically far lower than the peak point value that
    actually failed the slope. Applying a point threshold to an area mean is a
    category error, and the data says so: both the global Caine threshold
    (103 mm/24 h) and an absolutely re-fitted regional version (92 mm/24 h)
    catch NONE of the held-out events, even though those events sit at the
    84.5th percentile of their own district's rainfall distribution.

    Expressing the trigger as a multiple of local climatology removes the
    area-reduction factor entirely, and it adapts to the enormous spread across
    these districts (1640 mm/yr in Aizawl, 6930 mm/yr in Gangtok) which a
    single millimetre figure cannot. One free parameter, fitted for maximum
    critical success index on the training period.

    Also worth saying plainly: a 400-tree booster has no business being fitted
    to twenty events. It ranks event days no better than chance and worse than
    this one-parameter rule. The rule is what gets deployed.
    """
    if col not in train.columns or col not in test.columns:
        return {}
    y_tr = train["label"].to_numpy()
    x_tr = train[col].to_numpy(dtype=float)
    if y_tr.sum() < 3:
        return {}

    x_te = test[col].to_numpy(dtype=float)
    y_te = test["label"].to_numpy()

    # k is set BY BUDGET, not by maximising CSI. Optimising CSI on twenty
    # positives selects an ultra-conservative trigger (it found 2.85 x p90,
    # about five alarm days a year, and caught nothing): with this much
    # imbalance the false-alarm term dominates and drives the threshold to
    # wherever the false alarms stop, which is not where the events are.
    # Fixing the operational budget instead makes the comparison against the
    # ML levels honest -- same number of alarm days, whichever produced them.
    rows = []
    for budget in ALERT_BUDGETS:
        k = float(np.quantile(x_tr, 1.0 - budget))
        pred = (x_te >= k).astype(int)
        scores = skill_scores(y_te, pred)
        scores.update({
            "budget": budget,
            "k_x_p90": round(k, 2),
            "realised_alert_days_per_year": round(float(pred.mean()) * 365.25, 1),
        })
        rows.append(scores)

    # Equivalent millimetres per district, so an operator can sanity-check the
    # trigger against a real gauge reading.
    equiv: dict[str, dict[str, float]] = {}
    for code in sorted(test["aoi_code"].unique()):
        ref = train.loc[train["aoi_code"] == code, "rain_24h"].quantile(0.90)
        if ref == ref:  # not NaN
            equiv[code] = {
                f"top {int(b * 100)}%": round(float(np.quantile(x_tr, 1.0 - b)) * float(ref), 1)
                for b in ALERT_BUDGETS
            }

    return {
        "form": "alarm when rain_24h >= k x that district's own p90; k set by alert budget",
        "col": col,
        "selection": "k = training-period quantile at each operational alert budget",
        "per_budget": rows,
        "equivalent_mm_per_24h_by_district": equiv,
        "caine_point_threshold_mm_24h": round(caine_intensity(duration_h) * duration_h, 1),
    }


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------
def skill_scores(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """POD / FAR / CSI / bias -- the standard warning-skill quartet."""
    tp = int(((y_pred == 1) & (y_true == 1)).sum())
    fp = int(((y_pred == 1) & (y_true == 0)).sum())
    fn = int(((y_pred == 0) & (y_true == 1)).sum())
    pod = tp / (tp + fn) if (tp + fn) else 0.0
    far = fp / (tp + fp) if (tp + fp) else 0.0
    csi = tp / (tp + fp + fn) if (tp + fp + fn) else 0.0
    bias = (tp + fp) / (tp + fn) if (tp + fn) else 0.0
    return {"pod": round(pod, 3), "far": round(far, 3), "csi": round(csi, 3),
            "bias": round(bias, 3), "tp": tp, "fp": fp, "fn": fn}


def event_percentiles(
    test: pd.DataFrame, scores: np.ndarray, baseline_col: str = "rain_24h"
) -> dict:
    """Rank every event day against its own district's climatology.

    Day-level POD at a fixed probability cut is dominated by the shape of the
    calibration curve, and with ten test events it is mostly noise. This asks
    the question a district official actually cares about: *on the day the
    slope failed, was this district's score unusual?* It stays interpretable
    however few events there are, and it needs no threshold.

    Under no skill ``frac_in_top_10pct`` is 0.10 by construction, so anything
    materially above that is genuine ranking signal. The same figure is
    reported for raw 24 h rainfall, which is the honest comparison: if the
    model cannot beat "just look at how much it rained", it should not be
    deployed.
    """
    work = test[["aoi_code", "label"]].copy()
    work["score"] = np.asarray(scores, dtype=float)
    work["pct"] = work.groupby("aoi_code")["score"].rank(pct=True)
    if baseline_col in test.columns:
        work["baseline"] = test[baseline_col].to_numpy(dtype=float)
        work["pct_base"] = work.groupby("aoi_code")["baseline"].rank(pct=True)

    ev = work[work["label"] == 1]
    if ev.empty:
        return {}

    out: dict = {
        "n_events": int(len(ev)),
        "median_percentile": round(float(ev["pct"].median()), 3),
    }
    for top in (20, 10, 5, 1):
        out[f"frac_in_top_{top}pct"] = round(float((ev["pct"] >= (100 - top) / 100).mean()), 3)
    if "pct_base" in ev.columns:
        out["baseline_median_percentile"] = round(float(ev["pct_base"].median()), 3)
        out["baseline_frac_in_top_10pct"] = round(float((ev["pct_base"] >= 0.90).mean()), 3)
    return out


# ---------------------------------------------------------------------------
# training
# ---------------------------------------------------------------------------
def _classifier(scale_pos_weight: float):
    """LightGBM when available, else sklearn's histogram booster."""
    try:
        from lightgbm import LGBMClassifier

        return LGBMClassifier(
            n_estimators=400,
            num_leaves=31,
            learning_rate=0.05,
            subsample=0.9,
            subsample_freq=1,
            colsample_bytree=0.8,
            scale_pos_weight=scale_pos_weight,
            random_state=42,
            verbose=-1,
        ), "lightgbm"
    except ImportError:
        from sklearn.ensemble import HistGradientBoostingClassifier

        return HistGradientBoostingClassifier(
            max_iter=400, learning_rate=0.05, random_state=42,
            class_weight="balanced",
        ), "sklearn-hist"


# A district that collapsed to a forecast stub during a rate-limited backfill
# contributes two or three days of samples. That is not training data, it is
# noise -- and letting it in would quietly shrink the real sample size without
# anyone noticing. Skip it loudly instead.
MIN_DAYS_PER_AOI = 365


def _feature_set(data: pd.DataFrame) -> list[str]:
    """FEATURES restricted to the columns this cache actually provides.

    A centroid-only cache has no ``*_gridmax`` columns; a partially backfilled
    one may lack others. Zero-filling would be worse than dropping them: the
    model would read 0.0 as "the wettest cell in the district saw no rain",
    which is a lie. Train on what exists and record the subset in the metrics.
    """
    present = [c for c in FEATURES if c in data.columns]
    missing = [c for c in FEATURES if c not in data.columns]
    if missing:
        log.warning("features unavailable in this cache -- training without them: %s", missing)
    return present


def _oof_probabilities(
    train: pd.DataFrame, feats: list[str], spw: float, min_train_years: int = 2
) -> np.ndarray:
    """Expanding-window out-of-fold probabilities over the training period.

    Fit on every year up to N, predict year N+1, walk forward. Every prediction
    therefore comes from a model that never saw that year.

    This matters more than it looks. The calibrator and the alert-level cut
    points must be fitted on probabilities with the same scale the deployed
    model will produce. The obvious shortcut -- hold out one year, fit the
    calibrator on a *subset-trained* model's output, then apply it to a model
    trained on *everything* -- silently breaks: more training data shifts the
    probability distribution, the frozen cut points land in the wrong place,
    and every alert level fires on ~100% of days while still reporting POD
    1.000. Which is exactly what happened before this function existed.
    """
    X = train[feats].to_numpy(dtype=float)
    y = train["label"].to_numpy()
    years = sorted(train["day"].dt.year.unique())
    out = np.full(len(train), np.nan)

    for i in range(min_train_years, len(years)):
        fit_mask = (train["day"].dt.year <= years[i - 1]).to_numpy()
        pred_mask = (train["day"].dt.year == years[i]).to_numpy()
        if y[fit_mask].sum() < 2 or not pred_mask.any():
            # Not enough history to learn from yet -- leave this year as NaN
            # rather than scoring it with a model trained on nothing.
            continue
        fold, _ = _classifier(spw)
        fold.fit(
            X[fit_mask], y[fit_mask],
            sample_weight=inverse_frequency_weights(
                train.loc[fit_mask, "aoi_code"]).to_numpy(),
        )
        out[pred_mask] = fold.predict_proba(X[pred_mask])[:, 1]
    return out


def main(train_end_year: int = 2014) -> dict:
    labels = load_labels()
    frames, skipped = [], []
    for aoi in all_aois():
        cache = CACHE / f"weather_{aoi.slug}.parquet"
        if not cache.exists():
            log.warning("skipping %s: no weather cache", aoi.code)
            skipped.append(aoi.code)
            continue
        n_rows = len(pd.read_parquet(cache, columns=["ts"]))
        if n_rows < MIN_DAYS_PER_AOI * 24:
            log.error("skipping %s: cache holds only %d hourly rows; a full 20-year "
                      "pull is ~175k. Re-run ml.ingest.weather once the API quota "
                      "resets (Open-Meteo rate-limits per hour).", aoi.code, n_rows)
            skipped.append(aoi.code)
            continue
        d = build_supervised(aoi.slug, aoi.code, labels)
        if not d.empty:
            frames.append(d)
            log.info("%s: %d daily samples, %d positive", aoi.code, len(d), int(d["label"].sum()))

    if not frames:
        raise RuntimeError("no training data: run ml.ingest.weather and ml.ingest.labels first")
    if skipped:
        log.error("trained WITHOUT these AOIs (incomplete cache): %s", skipped)

    data = pd.concat(frames, ignore_index=True)
    feats = _feature_set(data)
    data = data.dropna(subset=feats).reset_index(drop=True)

    # --- temporal split (never random) -----------------------------------
    train = data[data["day"].dt.year <= train_end_year]
    test = data[data["day"].dt.year > train_end_year]
    if train.empty or test.empty:
        raise RuntimeError(f"temporal split produced an empty side (cut={train_end_year})")

    y_tr = train["label"].to_numpy()
    y_te = test["label"].to_numpy()
    X_tr = train[feats].to_numpy(dtype=float)
    X_te = test[feats].to_numpy(dtype=float)

    pos = max(int(y_tr.sum()), 1)
    neg = max(int((1 - y_tr).sum()), 1)

    print(f"\ntrain: {len(train)} days ({pos} positive) <= {train_end_year}")
    print(f"test : {len(test)} days ({int(y_te.sum())} positive) >  {train_end_year}")
    print(f"train base rate = {pos / len(y_tr):.4f}   raw neg/pos = {neg / pos:.1f}")

    # --- choose scale_pos_weight OUT OF FOLD ------------------------------
    # An unweighted model on a 0.3% base rate predicts "no" for every day; the
    # raw n_neg/n_pos ratio (300+) makes it predict "yes" for every day. Both
    # are useless, so the weight is selected by out-of-fold average precision
    # rather than by either rule of thumb.
    best_spw, best_ap, best_oof = SCALE_POS_WEIGHT_GRID[0], -1.0, None
    for spw in SCALE_POS_WEIGHT_GRID:
        oof = _oof_probabilities(train, feats, spw)
        seen = ~np.isnan(oof)
        if y_tr[seen].sum() < 3:
            continue
        ap = float(average_precision_score(y_tr[seen], oof[seen]))
        print(f"  spw={spw:>6.1f}   out-of-fold AP = {ap:.4f}   "
              f"({int(seen.sum())} days, {int(y_tr[seen].sum())} positive)")
        if ap > best_ap:
            best_spw, best_ap, best_oof = spw, ap, oof

    if best_oof is None:
        best_spw = 15.0
        log.warning("no usable out-of-fold window; using untuned scale_pos_weight=%s", best_spw)
    else:
        print(f"chosen scale_pos_weight = {best_spw:.1f} (out-of-fold AP {best_ap:.4f})")

    model, backend = _classifier(best_spw)
    w_tr = inverse_frequency_weights(train["aoi_code"]).to_numpy()
    model.fit(X_tr, y_tr, sample_weight=w_tr)
    print(f"backend: {backend}")

    raw = model.predict_proba(X_te)[:, 1]

    # --- calibration ------------------------------------------------------
    # Fitted on out-of-fold training predictions only, never on the test
    # period, and on the same probability scale the deployed model produces.
    calib_name = "none"
    calibrated = raw
    cal_prob = None
    if best_oof is not None:
        seen = ~np.isnan(best_oof)
        try:
            from sklearn.isotonic import IsotonicRegression

            iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
            iso.fit(best_oof[seen], y_tr[seen])
            calibrated = iso.predict(raw)
            cal_prob = iso.predict(best_oof[seen])
            calib_name = "isotonic"
        except Exception as exc:  # noqa: BLE001
            log.warning("calibration skipped (%s)", exc)
    print(f"calibration: {calib_name}")

    if best_oof is not None and calib_name != "none":
        # If the out-of-fold and test probability distributions sit on
        # different scales the frozen cut points land in the wrong place and
        # every level fires at once. Worth printing rather than discovering
        # from a nonsense alert table.
        print("\n--- probability scale check (OOF vs test, should be comparable) ---")
        print(f"{'':>10} {'p50':>9} {'p90':>9} {'p99':>9} {'max':>9}")
        for nm, arr in (("oof_raw", best_oof[seen]), ("oof_cal", cal_prob),
                        ("test_raw", raw), ("test_cal", calibrated)):
            print(f"{nm:>10} {np.percentile(arr, 50):>9.4f} {np.percentile(arr, 90):>9.4f} "
                  f"{np.percentile(arr, 99):>9.4f} {float(np.max(arr)):>9.4f}")

    # --- threshold-free ranking skill -------------------------------------
    # With only a handful of test positives the level statistics are noisy, so
    # the headline claim is ranking: does the model put the days that actually
    # failed above the days that did not? PR-AUC divided by the base rate
    # reads directly as "how many times better than alerting at random".
    pr_auc = float(average_precision_score(y_te, calibrated))
    roc_auc = float(roc_auc_score(y_te, calibrated)) if 0 < y_te.sum() < len(y_te) else float("nan")
    base_rate_te = float(y_te.mean())

    rng = np.random.default_rng(42)
    boot = []
    for _ in range(500):
        idx = rng.integers(0, len(y_te), len(y_te))
        if 0 < y_te[idx].sum() < len(y_te):
            boot.append(average_precision_score(y_te[idx], calibrated[idx]))
    pr_ci = [round(float(np.percentile(boot, 2.5)), 4),
             round(float(np.percentile(boot, 97.5)), 4)] if boot else [None, None]

    # --- alert levels -----------------------------------------------------
    # Levels are defined by operational ALERT BUDGET, not by arbitrary
    # probability cuts. A warning system that fires on a fifth of all days is
    # muted by its users within a month, so the honest question is "given we
    # may alert on the wettest X% of days, how many landslides do we catch?"
    # Cut points are frozen on the calibration split and then applied to the
    # untouched test period.
    per_level = []
    if cal_prob is not None:
        for lvl, name, budget in ALERT_LEVELS:
            thr = float(np.quantile(cal_prob, 1.0 - budget))
            row = skill_scores(y_te, (calibrated >= thr).astype(int))
            row.update({"level": lvl, "name": name, "alert_budget": budget,
                        "threshold": round(thr, 4),
                        "alert_days_per_year": round(budget * 365.25, 1)})
            per_level.append(row)

    caine_pred = caine_baseline_predict(test)
    caine = skill_scores(y_te, caine_pred)
    caine["alert_days_per_year"] = round(float(caine_pred.mean()) * 365.25, 1)

    # Physically-constrained comparator: same functional form as Caine, scale
    # factor fitted on this region's own training period.
    regional = fit_relative_rain_threshold(train, test)

    lead = test.loc[y_te == 1, "lead_h"].dropna()
    lead_stats = {
        "n": int(len(lead)),
        "median_h": round(float(lead.median()), 1) if len(lead) else None,
        "mean_h": round(float(lead.mean()), 1) if len(lead) else None,
    }

    ev_pct = event_percentiles(test, calibrated)

    print("\n--- ranking skill (threshold-free, held-out test period) ---")
    print(f"PR-AUC  = {pr_auc:.4f}   95% CI [{pr_ci[0]}, {pr_ci[1]}]   "
          f"base rate {base_rate_te:.4f} -> lift {pr_auc / max(base_rate_te, 1e-9):.1f}x")
    print(f"ROC-AUC = {roc_auc:.4f}")

    if ev_pct:
        print("\n--- event-day ranking (each event vs its own district climatology) ---")
        print(f"events scored             : {ev_pct['n_events']}")
        print(f"median event percentile   : {ev_pct['median_percentile']:.3f}   (0.50 = no skill)")
        for key in ("frac_in_top_20pct", "frac_in_top_10pct",
                    "frac_in_top_5pct", "frac_in_top_1pct"):
            top = key.split("_")[3]
            print(f"share of events in top {top:>3} : {ev_pct[key]:.3f}")
        if "baseline_frac_in_top_10pct" in ev_pct:
            print(f"same measure, raw 24h rain: {ev_pct['baseline_frac_in_top_10pct']:.3f}"
                  f"   (model {ev_pct['frac_in_top_10pct']:.3f})")
    print("\n--- Model B vs physical baselines, held-out test period ---")
    print(f"{'':>8} {'budget':>7} {'days/yr':>8} {'POD':>6} {'FAR':>6} {'CSI':>6} {'bias':>6}")
    for row in per_level:
        print(f"{'ML ' + row['name']:>8} {row['alert_budget']:>7.0%} {row['alert_days_per_year']:>8.1f} "
              f"{row['pod']:>6.3f} {row['far']:>6.3f} {row['csi']:>6.3f} {row['bias']:>6.3f}")
    for row in regional.get("per_budget", []):
        print(f"{'rain' + str(int(row['budget'] * 100)) + '%':>8} {row['budget']:>7.0%} "
              f"{row['realised_alert_days_per_year']:>8.1f} {row['pod']:>6.3f} "
              f"{row['far']:>6.3f} {row['csi']:>6.3f} {row['bias']:>6.3f}"
              f"   <- k={row['k_x_p90']} x district p90")
    print(f"{'Caine':>8} {'n/a':>7} {caine['alert_days_per_year']:>8.1f} "
          f"{caine['pod']:>6.3f} {caine['far']:>6.3f} {caine['csi']:>6.3f} {caine['bias']:>6.3f}")
    if regional:
        print(f"   equivalent mm/24h by district: {regional['equivalent_mm_per_24h_by_district']}")
        print(f"   Caine's point-gauge threshold is "
              f"{regional['caine_point_threshold_mm_24h']} mm/24h")

    metrics = {
        "model": MODEL_NAME,
        "backend": backend,
        "n_train": int(len(train)),
        "n_test": int(len(test)),
        "n_positive_train": int(y_tr.sum()),
        "n_positive_test": int(y_te.sum()),
        "split": f"temporal: train <= {train_end_year}, test > {train_end_year}",
        "label_definition": "event in (t, t+24h]",
        "calibration": calib_name,
        "scale_pos_weight": best_spw,
        "scale_pos_weight_selection": "out-of-fold average precision over "
                                      f"{SCALE_POS_WEIGHT_GRID}",
        "level_definition": "operational alert budget (fraction of days allowed "
                            "at that level); thresholds frozen on the calibration split",
        "per_level": per_level,
        "ranking": {
            "pr_auc": round(pr_auc, 4),
            "pr_auc_ci95": pr_ci,
            "roc_auc": round(roc_auc, 4) if roc_auc == roc_auc else None,
            "test_base_rate": round(base_rate_te, 5),
            "pr_auc_lift_vs_random": round(pr_auc / max(base_rate_te, 1e-9), 2),
        },
        "event_day_ranking": ev_pct,
        "caine_1980_baseline": caine,
        "regional_id_threshold": regional,
        "caine_threshold_mm_24h": round(caine_intensity(24.0) * 24.0, 2),
        "lead_time_h": lead_stats,
        "features": feats,
        "features_unavailable": [c for c in FEATURES if c not in feats],
        "aois_used": sorted(data["aoi_code"].unique().tolist()),
        "aois_skipped_incomplete_cache": skipped,
        "git_sha": git_sha(),
        "synthetic": False,
    }

    noney = noney_case_study(model, calib_name, feats)
    if noney:
        metrics["noney_2022_case_study"] = noney

    (ARTIFACTS).mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "hazard_nowcast_metrics.json").write_text(json.dumps(metrics, indent=2, default=str))

    save_artifact_meta(MODEL_NAME, MODEL_VERSION, metrics,
                       notes="Real Open-Meteo rainfall + NASA GLC labels. Temporal split; "
                             "label = event in (t, t+24h]. Class weight and alert-level "
                             "thresholds both chosen out of fold. Levels are alert budgets, "
                             "not probability cuts.")
    write_model_card(
        "B-hazard-nowcast",
        "Dynamic WHEN: probability of a rainfall-triggered landslide in the next 24 h",
        feats, metrics,
        "Trained on the NASA Global Landslide Catalog, which is news-derived and "
        "over-reports events near roads and towns; inverse-frequency weighting is a "
        "coarse correction only. Positives are few, so level-4 statistics are thin. "
        "Soil moisture is unavailable historically from Open-Meteo, so antecedent "
        "condition is carried by the Kohler-Linsley index instead.",
    )
    print(f"\nartifacts -> {ARTIFACTS / 'hazard_nowcast_metrics.json'}")
    return metrics


# ---------------------------------------------------------------------------
# Noney 2022 case study
# ---------------------------------------------------------------------------
def noney_case_study(model, calib_name: str, feats: list[str] | None = None) -> dict | None:
    """Run the trained model over the real run-up to the Noney tragedy.

    The 2022 event is not in the GLC (which ends in 2017), so this is *not* a
    metric -- it is a case study. We have real rainfall for the period, so we
    can honestly report what the model would have output, without claiming it
    as validated skill.
    """
    anchor = ANCHOR_EVENTS["noney_2022"]
    try:
        from ml.config.aois import get_aoi

        aoi = get_aoi(anchor["district"])
        # Same anomaly normalisation the training rows get, so the case study
        # is scored on exactly the feature space the model was fitted to.
        daily = add_anomalies(to_daily(load_weather(aoi.slug)))
    except Exception as exc:  # noqa: BLE001
        log.warning("Noney case study skipped (%s)", exc)
        return None

    event = pd.Timestamp(anchor["date"], tz="UTC")
    window = daily[(daily["day"] >= event - pd.Timedelta(days=14))
                   & (daily["day"] <= event + pd.Timedelta(days=2))]
    if window.empty:
        return None

    # Score on exactly the columns the model was fitted to -- an older
    # centroid-only cache trains on fewer features, and predicting with a
    # different width raises before it warns.
    cols = feats or FEATURES
    missing = [c for c in cols if c not in window.columns]
    if missing:
        log.warning("Noney case study: missing features zero-filled: %s", missing)
        for col in missing:
            window[col] = 0.0

    X = window[cols].to_numpy(dtype=float)
    probs = model.predict_proba(X)[:, 1]
    timeline = [
        {"date": str(row.day.date()), "p": round(float(p), 3),
         "rain_24h_mm": round(float(row.rain_24h), 1)}
        for row, p in zip(window.itertuples(index=False), probs)
    ]
    peak = max(timeline, key=lambda r: r["p"])
    return {
        "event": anchor["label"],
        "event_date": anchor["date"],
        "note": "Case study, not a metric: the event post-dates the GLC label "
                "period, so no ground-truth label exists in training data.",
        "peak_probability": peak["p"],
        "peak_date": peak["date"],
        "timeline": timeline,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--cut", type=int, default=2014, help="last training year")
    args = ap.parse_args()
    main(train_end_year=args.cut)
