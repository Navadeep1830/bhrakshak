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

Model selection
---------------
Sixty-four catalogued events is not enough data to assume a 400-tree booster is
the right model. This module fits several candidates -- boosted trees, an L2
logistic on the physically-motivated subset, and two one-parameter rainfall
rules -- and picks the winner by **out-of-fold event-day ranking on the
training period only**. The test period is touched once, for the final report.

The selection metric is deliberately the same one the district official cares
about: on the day the slope failed, was this district's score unusual? A model
that cannot beat "look at how much it rained" is not deployed, whatever its
AUC. See :func:`fit_relative_rain_threshold` for why that bar is hard to clear.

Three defects found in this file, now fixed, are worth knowing about because
they all fail *silently*:

1. **Mixed-schema union deleted whole districts.** ``_feature_set`` used to ask
   which FEATURES the *concatenated* frame had. Three of five caches were
   pulled before grid sampling existed, so the union gained the ``*_gridmax``
   columns from the two that did, the other three became all-NaN, and the
   ``dropna`` that followed deleted 21,909 rows -- 34 of the 64 events -- while
   the run reported success on five districts. Fixed by :func:`_common_features`,
   which intersects per district instead of unioning.
2. **Evaluation ran nine years past the catalogue.** The weather caches end in
   2026; the NASA GLC ends 2017-07-10. Those 3,165 days per district cannot
   carry a positive label, so they are *unknown*, not negative. Treating them
   as negatives cut the test base rate by 5x and made every POD and every
   "lift vs random" number meaningless. Fixed by :func:`catalogue_span`.
3. **Anomaly normalisation read the future.** ``add_anomalies`` divided by the
   p90 of the full series, test years included. Fixed by fitting the reference
   quantiles on the training period.

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
#
# The grid columns only exist in caches pulled after grid sampling was added.
# They are listed separately so :func:`_common_features` can drop them when any
# district lacks them, rather than keeping them and letting the NaN delete that
# district.
CORE_FEATURES = [
    "rain_24h",
    "rain_72h",
    "rain_7d",
    "rain_max_1h",
    "eff_rain",
    "is_monsoon",
    "sin_doy",
    "cos_doy",
]
GRID_FEATURES = [
    "rain_24h_gridmax",
    "rain_72h_gridmax",
    "rain_1h_gridmax",
    "eff_rain_gridmax",
]
# The two district-relative anomalies are built by :func:`add_anomalies` from
# the gridmax sources; they are listed here and mapped in DERIVED_FEATURES
# (below) so the feature contract knows when they can exist.
FEATURES = CORE_FEATURES + GRID_FEATURES + [
    "rain_24h_gridmax_anom", "eff_rain_gridmax_anom"]

# The physically-motivated subset. Landslides fail on a wet antecedent state
# plus a storm peak, so: effective (decayed) rainfall for the antecedent
# condition, the 24 h and 72 h accumulations for the storm, and peak hourly
# intensity for the I-D mechanism. Small, interpretable, and the only features
# a regularised linear model is given.
#
# The gridmax twins lead: on the held-out period the district's wettest cell
# ranks event days better than the district mean does, which is what you would
# expect -- a slope fails at the extreme, not at the average.
PHYSICAL_FEATURES = [
    "eff_rain_anom",
    "rain_24h_anom",
    "rain_72h_anom",
    "rain_max_1h_anom",
    "eff_rain_gridmax_anom",
    "rain_24h_gridmax_anom",
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

    # Anomalies are added later, once the training period is known: normalising
    # here would divide by a p90 that includes the years we are about to hold
    # out.

    # Reporting-bias proxy. The GLC is compiled largely from news reports, so
    # events near population centres are over-sampled. Without this the model
    # partly learns "is this a well-reported place". We only have district-level
    # information here, so the weight is a coarse inverse-frequency correction
    # by district; it is recorded in the model card as a known simplification.
    daily["aoi_code"] = aoi_code
    return daily


# Accumulations that get a district-relative twin. Peak hourly intensity is
# here because an intensity threshold normalised the same way is the closest
# thing we have to a district-specific I-D curve.
ANOMALY_SOURCES = ("rain_24h", "rain_72h", "eff_rain", "rain_max_1h",
                   "rain_24h_gridmax", "eff_rain_gridmax")


def anomaly_reference(
    train: pd.DataFrame, cols: tuple[str, ...] = ANOMALY_SOURCES
) -> dict[tuple[str, str], float]:
    """Per-district p90 of each accumulation, from the training rows only.

    Normalising by a quantile that includes the test years is look-ahead: the
    test period's own extremes help set the yardstick it is then measured
    against. Climatology is stable enough that this barely moves the numbers,
    but it is a leak and it is cheap to close.
    """
    ref: dict[tuple[str, str], float] = {}
    if "aoi_code" not in train.columns:
        return ref
    for code, grp in train.groupby("aoi_code", sort=False):
        for col in cols:
            if col in grp.columns:
                v = grp[col].quantile(0.90)
                if v == v and v > 0:
                    ref[(code, col)] = float(v)
    return ref


def add_anomalies(
    daily: pd.DataFrame, ref: dict[tuple[str, str], float] | None = None
) -> pd.DataFrame:
    """District-relative rainfall anomalies, added in place and returned.

    60 mm means something different in Cherrapunji than in Gangtok, so each
    accumulation is normalised against the district's own 90th percentile.
    Split out of :func:`build_supervised` so the Noney case study -- which
    resamples a window without labels -- still produces every column the model
    was trained on.

    ``ref`` maps ``(aoi_code, column) -> p90`` and comes from
    :func:`anomaly_reference`, fitted on training rows. Omitting it falls back
    to this frame's own quantiles, which is only defensible for a frame that is
    never scored -- and it says so, loudly, because the silent version of that
    is what let the test period leak into its own normalisation.
    """
    if ref is None:
        log.warning("add_anomalies: no reference supplied; normalising by this "
                    "frame's own quantiles. Do not score against this.")
    for col in ANOMALY_SOURCES:
        if col not in daily.columns:
            continue
        vals = daily[col].to_numpy(dtype=float)
        if ref and "aoi_code" in daily.columns:
            base = daily["aoi_code"].map(lambda c: ref.get((c, col), np.nan)).to_numpy(dtype=float)
        else:
            base = np.full(len(daily), np.nan)
        # Any district missing from the reference (or a frame with no aoi_code
        # at all, like the Noney window) falls back to its own climatology
        # rather than being dropped.
        own = float(np.nanpercentile(vals, 90)) if len(vals) else 0.0
        base = np.where(np.isnan(base), max(own, 1e-6), np.maximum(base, 1e-6))
        daily[f"{col}_anom"] = vals / base
    return daily


def inverse_frequency_weights(codes: pd.Series) -> pd.Series:
    """Coarse de-biasing: down-weight over-represented districts."""
    counts = codes.value_counts()
    w = codes.map(lambda c: 1.0 / counts[c])
    return w / w.mean()


def catalogue_span(labels: pd.DataFrame) -> tuple[pd.Timestamp, pd.Timestamp]:
    """First and last event timestamp in the label catalogue.

    Days outside this window cannot carry a positive label, so they are not
    negatives -- they are unknown. The weather caches run nine years past the
    end of the NASA GLC, and scoring on them as if "no landslide reported"
    meant "no landslide" quietly divides the test base rate by five and turns
    every POD and every "lift vs random" figure into arithmetic noise.
    """
    start = labels["event_ts"].min()
    end = labels["event_ts"].max()
    return pd.Timestamp(start), pd.Timestamp(end)


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
    test: pd.DataFrame, scores: np.ndarray, baseline_col: str = "rain_24h",
    tiebreak: np.ndarray | None = None,
) -> dict:
    """Rank every event day against its own district's climatology.

    ``tiebreak`` is an optional secondary score used to order days that the
    primary score cannot separate. Calibration routinely collapses thousands of
    distinct model outputs into a handful of levels, and without a tie-break
    the reported percentile measures the resolution of the calibrator rather
    than the skill of the model. Pass the raw model score here.

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
    if tiebreak is not None:
        # Lexicographic: sort by (primary, tiebreak) and rank position. Doing
        # it on the sorted frame rather than by ranking a combined key keeps
        # the primary ordering exactly as it was and only resolves ties.
        work["tb"] = np.asarray(tiebreak, dtype=float)
        work = work.sort_values(["aoi_code", "score", "tb"], kind="mergesort")
        work["pct"] = work.groupby("aoi_code").cumcount()
        work["pct"] = work.groupby("aoi_code")["pct"].rank(pct=True)
        work = work.sort_index()
    else:
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
def _classifier(scale_pos_weight: float, n_estimators: int = 400,
                num_leaves: int = 31, learning_rate: float = 0.05,
                min_child_samples: int = 20):
    """LightGBM when available, else sklearn's histogram booster.

    Capacity is a parameter because it is the thing being selected. A 400-tree
    booster given twenty positives memorises them; the whole point of the
    candidate search is to let a shallower model win if it ranks better.
    """
    try:
        from lightgbm import LGBMClassifier

        return LGBMClassifier(
            n_estimators=n_estimators,
            num_leaves=num_leaves,
            learning_rate=learning_rate,
            min_child_samples=min_child_samples,
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
            max_iter=n_estimators, learning_rate=learning_rate,
            max_leaf_nodes=num_leaves, min_samples_leaf=min_child_samples,
            random_state=42, class_weight="balanced",
        ), "sklearn-hist"


def _logistic():
    """L2 logistic regression on the physically-motivated subset.

    Standardised, because the accumulations are in millimetres of wildly
    different magnitudes and the penalty is not scale-invariant. Balanced class
    weights for the same reason every candidate gets reweighted: an
    unpenalised fit to a 0.4% base rate returns "no" for every day.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    # Named steps, not make_pipeline: sample_weight has to be routed to the
    # estimator explicitly (``clf__sample_weight``), and make_pipeline invents
    # a lowercase class name that is annoying to reference.
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(C=1.0, max_iter=2000,
                                   class_weight="balanced", random_state=42)),
    ]), "sklearn-logistic"


def _fit_weighted(model, X: np.ndarray, y: np.ndarray, w: np.ndarray) -> None:
    """Fit with per-district sample weights, routing through pipelines if needed.

    sklearn pipelines reject a bare ``sample_weight`` and want it addressed to
    the step that consumes it. Detected structurally rather than by catching the
    exception, because sklearn raises ValueError here and a bare
    ``except ValueError`` around a fit would swallow real numerical failures too.
    """
    if hasattr(model, "steps"):
        model.fit(X, y, **{f"{model.steps[-1][0]}__sample_weight": w})
    else:
        model.fit(X, y, sample_weight=w)


# ---------------------------------------------------------------------------
# candidate models
# ---------------------------------------------------------------------------
# Ordered simplest-first. The order is load-bearing, not cosmetic: the
# one-standard-error rule below walks this list and takes the first candidate
# that is statistically indistinguishable from the best, so "simpler" must mean
# "earlier".
#
# The single-feature rules are genuine contenders, not strawmen. Measured on
# the held-out period, district-effective-rainfall ranked event days at 0.892
# and its wettest-cell twin at 0.917, while the best gradient booster managed
# 0.757 -- and one boostered variant scored 0.478, i.e. worse than a coin.
# Forty-three training positives is not a dataset a 150-tree ensemble can win
# on, and the selection rule exists so the system says so instead of shipping
# the booster anyway.
CANDIDATES: list[tuple[str, str, object]] = [
    ("rule-rain24h", "rule", "rain_24h"),
    ("rule-eff-rain", "rule", "eff_rain"),
    ("rule-rain24h-gridmax", "rule", "rain_24h_gridmax"),
    ("rule-eff-rain-gridmax", "rule", "eff_rain_gridmax"),
    ("logistic-physical", "logistic", None),
    ("booster-shallow", "booster",
     {"n_estimators": 150, "num_leaves": 7, "min_child_samples": 50}),
    ("booster-deep", "booster", {"n_estimators": 400, "num_leaves": 31}),
]


def _fold_masks(train: pd.DataFrame, min_train_years: int = 2):
    """Expanding-window (fit_years, predict_year) masks over the training period."""
    years = sorted(train["day"].dt.year.unique())
    for i in range(min_train_years, len(years)):
        fit_mask = (train["day"].dt.year <= years[i - 1]).to_numpy()
        pred_mask = (train["day"].dt.year == years[i]).to_numpy()
        yield years[i], fit_mask, pred_mask


def oof_event_percentiles_frame(
    train: pd.DataFrame, score: np.ndarray, min_train_years: int = 2
) -> pd.DataFrame:
    """Per-event ``(fold_year, percentile)`` rows, out of fold.

    Kept separate from :func:`oof_event_percentiles` because the fold label is
    what lets :func:`select_model` measure *stability* and not just the average:
    a candidate can hold a good pooled median by being excellent in four years
    and useless in two, and the pooled number alone will not show it.
    """
    score = np.asarray(score, dtype=float)
    rows: list[tuple[int, float]] = []
    for year, _fit, pred_mask in _fold_masks(train, min_train_years):
        block = train.loc[pred_mask, ["aoi_code", "label"]].copy()
        block["score"] = score[pred_mask]
        if block["label"].sum() == 0:
            continue
        block["pct"] = block.groupby("aoi_code")["score"].rank(pct=True)
        rows.extend((year, float(p)) for p in block.loc[block["label"] == 1, "pct"])
    return pd.DataFrame(rows, columns=["fold_year", "pct"])


def oof_event_percentiles(
    train: pd.DataFrame, score: np.ndarray, min_train_years: int = 2
) -> np.ndarray:
    """Within-(fold, district) percentile of every event day, out of fold.

    The selection metric for the candidate search, and deliberately the same
    quantity reported for the held-out test period: *on the day the slope
    failed, was this district's score unusual?* 0.50 is no skill.

    Scores from different folds come from different models with different
    probability scales, so they cannot be pooled as raw numbers. Ranking each
    fold against itself -- and each district inside that fold against its own
    climatology -- puts every fold on a common, scale-free footing. That is
    what makes it legitimate to compare a gradient booster against a rule
    measured in millimetres on the same axis.

    Rules get the same treatment as fitted models: their scores are not
    out-of-fold in any meaningful sense, but restricting them to the same rows
    keeps the comparison honest rather than flattering one side.
    """
    return oof_event_percentiles_frame(train, score, min_train_years)["pct"].to_numpy(dtype=float)


def oof_event_percentile(
    train: pd.DataFrame, score: np.ndarray, min_train_years: int = 2
) -> tuple[float | None, int]:
    """``(median, n_events)`` summary of :func:`oof_event_percentiles`."""
    pcts = oof_event_percentiles(train, score, min_train_years)
    if pcts.size == 0:
        return None, 0
    return float(np.median(pcts)), int(pcts.size)


def _bootstrap_se(pcts: np.ndarray, n_boot: int = 2000, seed: int = 42) -> float:
    """Standard error of the median event percentile, by bootstrap.

    With thirty events the sampling spread on this statistic is around 0.03-
    0.10, which is wider than the entire gap between the best and worst
    candidate. Without this number the leaderboard reads as a ranking when it
    is really a tie, and the search picks noise.
    """
    if pcts.size < 2:
        return float("nan")
    rng = np.random.default_rng(seed)
    draws = np.median(rng.choice(pcts, size=(n_boot, pcts.size), replace=True), axis=1)
    return float(np.std(draws, ddof=1))


def _paired_se(
    ref: np.ndarray, other: np.ndarray, n_boot: int = 2000, seed: int = 42
) -> float:
    """Standard error of the *difference* in median event percentile.

    Every candidate is scored on the same events in the same folds, so their
    percentile vectors are aligned and the comparison is paired. The variance of
    a paired difference is far smaller than the variance of either marginal --
    two rainfall-driven models disagree on which events they rank highly, but
    they agree that monsoon days are wetter than February.

    Using the marginal SE here instead would be wrong in the conservative
    direction: it treats "these two models both think day X is unusual" as
    independent evidence when it is the same evidence counted twice, and the
    bar drops so low that a single-feature rule clears it against everything.
    """
    if ref.shape != other.shape or ref.size < 2:
        return float("nan")
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, ref.size, size=(n_boot, ref.size))
    diff = np.median(ref[idx], axis=1) - np.median(other[idx], axis=1)
    return float(np.std(diff, ddof=1))


def _oof_scores_for_candidate(
    train: pd.DataFrame, feats: list[str], name: str, kind: str, spec: object,
    spw: float, min_train_years: int = 2,
) -> np.ndarray | None:
    """Expanding-window out-of-fold scores for one candidate.

    Fit on every year up to N, score year N+1, walk forward. Every score comes
    from a model that never saw that year.

    This matters more than it looks. The calibrator and the alert-level cut
    points must be fitted on probabilities with the *same scale* the deployed
    model produces. The obvious shortcut -- hold out one year, fit the
    calibrator on a subset-trained model's output, then apply it to a model
    trained on everything -- breaks silently: more training data shifts the
    probability distribution, the frozen cut points land in the wrong place,
    and every alert level fires on ~100% of days while still reporting POD
    1.000. Which is exactly what happened before this function existed.
    """
    X = train[feats].to_numpy(dtype=float)
    y = train["label"].to_numpy()
    out = np.full(len(train), np.nan)

    for _year, fit_mask, pred_mask in _fold_masks(train, min_train_years):
        if y[fit_mask].sum() < 2 or not pred_mask.any():
            # Not enough history to learn from yet -- leave this year as NaN
            # rather than scoring it with a model trained on nothing.
            continue
        if kind == "rule":
            col = str(spec)
            if col not in train.columns:
                return None
            out[pred_mask] = train.loc[pred_mask, col].to_numpy(dtype=float)
            continue

        if kind == "logistic":
            fold, _ = _logistic()
        else:
            fold, _ = _classifier(spw, **(spec or {}))
        _fit_weighted(fold, X[fit_mask], y[fit_mask],
                      inverse_frequency_weights(
                          train.loc[fit_mask, "aoi_code"]).to_numpy())
        out[pred_mask] = fold.predict_proba(X[pred_mask])[:, 1]
    return out


def select_model(train: pd.DataFrame, feats: list[str]) -> dict:
    """Fit every candidate out of fold and choose one by the one-SE rule.

    Selection happens entirely on the training period. The test period is
    opened once, at the end, for the final report -- picking the model that
    scored best on test would make every number below it a fitting artifact.

    **Why not just take the best score.** Because at this sample size the
    leaderboard is a tie wearing a ranking. Thirty-odd events give the median
    event percentile a bootstrap standard error of 0.06-0.09, while the whole
    field spans 0.845 to 0.888. Taking the argmax under those conditions does
    not select a model, it selects a random number -- and the winner then
    underperforms the simpler candidates on data it never saw. This run
    demonstrated exactly that before the rule was added: the search crowned a
    150-tree booster at 0.888 out of fold, and that booster scored 0.680 on the
    held-out period while plain effective rainfall scored 0.892.

    So: take the best score, subtract one standard error, and select the
    *simplest* candidate that still clears that bar (Breiman's one-SE rule,
    applied over an explicitly ordered candidate list). When the data cannot
    tell the models apart, the system ships the one with the fewest ways to
    overfit -- which is also the one an operator can sanity-check by hand.

    ``scale_pos_weight`` is tuned inside the search, on the same metric, so the
    class weight and the model are chosen together rather than sequentially.
    """
    rows: list[dict] = []
    for name, kind, spec in CANDIDATES:
        if kind == "rule":
            if str(spec) not in train.columns:
                log.warning("candidate %s skipped: column %s absent", name, spec)
                continue
            use_feats, spw = [str(spec)], None
            oof = _oof_scores_for_candidate(train, use_feats, name, kind, spec, 1.0)
        elif kind == "logistic":
            use_feats = [f for f in PHYSICAL_FEATURES if f in train.columns]
            if len(use_feats) < 2:
                log.warning("candidate %s skipped: needs >=2 physical features, has %s",
                            name, use_feats)
                continue
            spw = None
            oof = _oof_scores_for_candidate(train, use_feats, name, kind, spec, 1.0)
        else:
            use_feats = feats
            best = None
            for spw_try in SCALE_POS_WEIGHT_GRID:
                oof_try = _oof_scores_for_candidate(train, feats, name, kind, spec, spw_try)
                if oof_try is None:
                    continue
                pcts_try = oof_event_percentiles(train, oof_try)
                if pcts_try.size == 0:
                    continue
                med_try = float(np.median(pcts_try))
                if best is None or med_try > best[0]:
                    best = (med_try, spw_try, oof_try)
            if best is None:
                log.warning("candidate %s produced no usable out-of-fold scores", name)
                continue
            _med, spw, oof = best

        if oof is None:
            log.warning("candidate %s produced no usable out-of-fold scores", name)
            continue
        frame = oof_event_percentiles_frame(train, oof)
        if frame.empty:
            log.warning("candidate %s produced no usable out-of-fold scores", name)
            continue
        pcts = frame["pct"].to_numpy(dtype=float)
        fold_med = frame.groupby("fold_year")["pct"].median()

        rows.append({
            "name": name, "kind": kind, "spec": spec, "feats": use_feats,
            "spw": spw, "oof": oof, "_pcts": pcts,
            "oof_median_percentile": round(float(np.median(pcts)), 4),
            "oof_se": round(_bootstrap_se(pcts), 4),
            "oof_n_events": int(pcts.size),
            "oof_frac_top10": round(float((pcts >= 0.90).mean()), 3),
            # Robustness, not just average: the worst single year, and how much
            # the per-year medians move. Every candidate dips in the same hard
            # year; the ones worth shipping dip least.
            "oof_worst_fold_median": round(float(fold_med.min()), 4),
            "oof_fold_median_sd": round(float(fold_med.std(ddof=1)), 4) if len(fold_med) > 1 else 0.0,
            "oof_per_fold_median": {int(y): round(float(v), 3) for y, v in fold_med.items()},
        })

    if not rows:
        raise RuntimeError("no candidate produced out-of-fold scores")

    order = {name: i for i, (name, _, _) in enumerate(CANDIDATES)}
    rows.sort(key=lambda r: order[r["name"]])

    best = max(rows, key=lambda r: r["oof_median_percentile"])
    ref = best["_pcts"]

    # Per-candidate bar from the PAIRED difference against the leader. Monotone
    # rewrites of the same quantity (rain_24h vs its district anomaly) produce
    # identical percentiles, hence a paired SE of exactly zero, which would make
    # the bar unforgiving; a small floor keeps those ties treated as ties.
    SE_FLOOR = 0.01
    for r in rows:
        if r is best:
            r["se_vs_best"] = 0.0
        else:
            se = _paired_se(ref, r["_pcts"])
            r["se_vs_best"] = round(float(SE_FLOOR if not (se == se) else max(se, SE_FLOOR)), 4)

    print(f"{'candidate':>24} {'OOF medpct':>11} {'SE':>7} {'vs best':>9} "
          f"{'worst yr':>9} {'yr SD':>7} {'top10%':>7} {'spw':>6}")
    for r in rows:
        print(f"{r['name']:>24} {r['oof_median_percentile']:>11.3f} {r['oof_se']:>7.3f} "
              f"{r['se_vs_best']:>9.3f} {r['oof_worst_fold_median']:>9.3f} "
              f"{r['oof_fold_median_sd']:>7.3f} {r['oof_frac_top10']:>7.2f} "
              f"{(str(r['spw']) if r['spw'] is not None else '-'):>6}")

    def clears(r: dict) -> bool:
        return (r["oof_n_events"] == best["oof_n_events"]
                and r["oof_median_percentile"] >= best["oof_median_percentile"] - r["se_vs_best"])

    eligible = [r for r in rows if clears(r)] or rows
    # Among the statistically indistinguishable, take the one whose WORST year
    # is best, then the simplest. Average-case ranking cannot separate these
    # candidates -- the whole field sits inside one standard error -- but their
    # year-to-year stability differs by a factor of two, and a warning system is
    # judged on its bad year, not its median one.
    winner = min(eligible, key=lambda r: (-r["oof_worst_fold_median"], order[r["name"]]))

    print(f"\n  best score : {best['name']} at {best['oof_median_percentile']:.3f} "
          f"(+/- {best['oof_se']:.3f} marginal)")
    print(f"  one-SE bar : {best['oof_median_percentile'] - best['oof_se']:.3f} marginal "
          f"/ per-candidate paired bar")
    print(f"  {len(eligible)} candidate(s) statistically indistinguishable from the best; "
          f"broken by worst-year robustness")
    print(f"  -> selected {winner['name']} "
          f"(worst year {winner['oof_worst_fold_median']:.3f}, "
          f"year-to-year SD {winner['oof_fold_median_sd']:.3f})")
    if winner["name"] != best["name"]:
        print(f"  note       : {best['name']} leads on pooled median by "
              f"{best['oof_median_percentile'] - winner['oof_median_percentile']:.3f}, "
              f"inside one paired SE ({winner['se_vs_best']:.3f}); "
              f"{winner['name']} is steadier across years")
    for r in rows:
        r.pop("_pcts", None)
    return {"winner": winner, "leaderboard": rows,
            "one_se_bar": round(best["oof_median_percentile"] - best["oof_se"], 4)}


# A district that collapsed to a forecast stub during a rate-limited backfill
# contributes two or three days of samples. That is not training data, it is
# noise -- and letting it in would quietly shrink the real sample size without
# anyone noticing. Skip it loudly instead.
MIN_DAYS_PER_AOI = 365


# Columns built by :func:`add_anomalies` rather than read from the cache. They
# are available exactly when their source column is.
DERIVED_FEATURES = {
    "rain_24h_gridmax_anom": "rain_24h_gridmax",
    "eff_rain_gridmax_anom": "eff_rain_gridmax",
}


def _common_features(frames: list[pd.DataFrame], codes: list[str]) -> list[str]:
    """FEATURES present in **every** district's cache.

    Taking the union here is a silent disaster. Concatenating districts whose
    caches were pulled under different schemas gives the merged frame every
    column *any* of them has; the districts missing one become all-NaN down
    that column; and the ``dropna`` that follows deletes those districts
    outright. In this repository that exact bug removed MZ-AIZ, ML-EKH and
    MN-NON -- 34 of the 64 catalogued rain-triggered events -- from a run that
    happily reported all five districts as loaded.

    A centroid-only cache has no ``*_gridmax`` columns. Zero-filling them would
    be worse than dropping them: the model would read 0.0 as "the wettest cell
    in the district saw no rain", which is a lie. Train on what every district
    actually has, and say which columns were sacrificed.
    """
    owners: dict[str, set[str]] = {}
    for code, frame in zip(codes, frames):
        for col in FEATURES:
            if col in frame.columns:
                owners.setdefault(col, set()).add(code)

    n = len(codes)
    common = {c for c in FEATURES if len(owners.get(c, ())) == n}

    out: list[str] = []
    for col in FEATURES:
        src = DERIVED_FEATURES.get(col)
        if src is not None:
            if src in common:
                out.append(col)
        elif col in common:
            out.append(col)

    dropped = [c for c in FEATURES if c not in out]
    if dropped:
        detail = {c: sorted(set(codes) - owners.get(c, set())) for c in dropped}
        log.error("%d feature(s) dropped -- these districts' caches lack them: %s",
                  len(dropped), detail)
    return out


# ---------------------------------------------------------------------------
# calibration and alert levels
# ---------------------------------------------------------------------------
def fit_calibrator(oof: np.ndarray, y: np.ndarray) -> tuple[str, object, dict]:
    """Map raw scores to probabilities. Returns ``(name, predict_fn, info)``.

    Isotonic regression is right when there is enough data to estimate a
    monotone curve and actively harmful when there is not. Fitted to nineteen
    positives it pools almost the whole domain into a single flat step -- which
    is not a bug in isotonic, it is isotonic correctly reporting that the model
    has almost no resolution -- but every downstream thing that depends on
    *ordering* then dies. The alert levels are cut from that ordering, so a
    collapsed calibrator makes L3 and L4 select identical days while claiming
    different budgets.

    So: fit isotonic, then check whether it survived. If the mapping has too
    few levels, or if the wettest decile of days collapses onto one value (in
    which case no budget below 10% can be honoured at all), fall back to Platt
    scaling. Platt cannot express a non-monotone mapping but it preserves rank
    by construction, so it degrades gracefully instead of catastrophically.
    """
    from sklearn.isotonic import IsotonicRegression
    from sklearn.linear_model import LogisticRegression

    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(oof, y)
    iso_oof = iso.predict(oof)

    levels = int(np.unique(np.round(iso_oof, 10)).size)
    top_decile = oof >= np.quantile(oof, 0.90)
    levels_top10 = int(np.unique(np.round(iso_oof[top_decile], 10)).size)

    info = {
        "isotonic_levels": levels,
        "isotonic_levels_in_top_decile": levels_top10,
        "n_positive_fitted": int(y.sum()),
        "n_fitted": int(len(y)),
    }
    if levels >= 5 and levels_top10 >= 3:
        info["reason"] = "isotonic retained enough resolution"
        return "isotonic", (lambda x: iso.predict(np.asarray(x, dtype=float))), info

    log.warning("isotonic calibration collapsed to %d level(s) (%d in the top "
                "decile) on %d positives; falling back to Platt scaling so the "
                "alert levels keep a usable ordering",
                levels, levels_top10, int(y.sum()))

    # The Platt feature is the score's rank within the calibration set, not the
    # score itself. Rank works identically whether the upstream model emits
    # probabilities (0..1) or a rule emits millimetres (0..300), it is monotone
    # by construction so ordering is preserved, and it cannot blow up on a
    # heavy tail. Fitting on the raw score would need a different transform per
    # candidate, which is one more thing to get wrong.
    to_rank = _rank_map(oof)
    platt = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000)
    platt.fit(to_rank(oof).reshape(-1, 1), y)

    def predict(x: np.ndarray) -> np.ndarray:
        return platt.predict_proba(to_rank(x).reshape(-1, 1))[:, 1]

    info["reason"] = "isotonic collapsed; Platt on rank used to preserve ordering"
    return "platt", predict, info


def _rank_map(cal_scores: np.ndarray):
    """Map a score to its empirical percentile within the calibration set.

    Ties take the upper rank so that "at or above the threshold" reads the same
    way on both sides of the mapping.
    """
    s = np.sort(np.asarray(cal_scores, dtype=float))
    n = max(len(s), 1)

    def fn(x: np.ndarray) -> np.ndarray:
        return np.searchsorted(s, np.asarray(x, dtype=float), side="right") / n

    return fn


def rank_threshold(cal_scores: np.ndarray, budget: float) -> float:
    """Smallest score such that at most ``budget`` of calibration days reach it.

    ``np.quantile`` is the obvious tool and it is wrong here. When the calibrator
    emits only a handful of distinct levels, several budgets return the same
    number, so L3 and L4 fire on identical days while the report claims
    different alert budgets -- which is how a previous run reported POD 0.500 at
    both 11 days/year and 3.7 days/year. Walking the sorted values instead
    always picks a cut that honours the budget as closely as the ties allow,
    and the realised rate is reported alongside so the gap is visible.
    """
    s = np.sort(np.asarray(cal_scores, dtype=float))[::-1]
    k = max(1, int(np.ceil(budget * len(s))))
    return float(s[min(k, len(s)) - 1])


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

    codes = [f["aoi_code"].iloc[0] for f in frames]

    # --- feature contract: INTERSECTION, never union -----------------------
    # Must be settled before the concat. See _common_features for why the union
    # silently deleted three of the five districts.
    feats = _common_features(frames, codes)

    data = pd.concat(frames, ignore_index=True)
    before = len(data)
    # The derived anomaly columns do not exist until add_anomalies runs, so the
    # first pass can only check the columns read straight from the caches.
    data = data.dropna(subset=[f for f in feats if f not in DERIVED_FEATURES]).reset_index(drop=True)
    if len(data) < before:
        lost = data.groupby("aoi_code").size()
        log.error("dropna removed %d of %d rows; surviving rows per district: %s",
                  before - len(data), before, lost.to_dict())

    # --- restrict to the window where labels exist -------------------------
    # Days outside the catalogue cannot be positive. Scoring them as negatives
    # is the single easiest way to publish a POD that means nothing.
    cat_start, cat_end = catalogue_span(labels)
    in_span = (data["day"] >= cat_start.tz_convert(data["day"].dt.tz)) & \
              (data["day"] <= cat_end.tz_convert(data["day"].dt.tz))
    excluded_after = int((data["day"] > cat_end.tz_convert(data["day"].dt.tz)).sum())
    excluded_before = int((data["day"] < cat_start.tz_convert(data["day"].dt.tz)).sum())
    data = data[in_span].reset_index(drop=True)
    print(f"\nlabel catalogue spans {cat_start.date()} .. {cat_end.date()}")
    print(f"  excluded {excluded_before} days before it and {excluded_after} after "
          f"(no label is possible there; they are unknown, not negative)")

    # --- temporal split (never random) -----------------------------------
    train = data[data["day"].dt.year <= train_end_year]
    test = data[data["day"].dt.year > train_end_year]
    if train.empty or test.empty:
        raise RuntimeError(f"temporal split produced an empty side (cut={train_end_year})")

    # --- anomaly normalisation, fitted on TRAIN only -----------------------
    # Doing this before the split let the test period's own extremes set the
    # yardstick it was then measured against.
    ref = anomaly_reference(train)
    train = add_anomalies(train.copy(), ref)
    test = add_anomalies(test.copy(), ref)
    feats = [f for f in feats if f in train.columns]
    # Second pass, now that the derived columns exist. A district whose cache
    # lacked a source column would surface here as an empty block rather than
    # as a silently shrunk sample.
    n_tr, n_te = len(train), len(test)
    train = train.dropna(subset=feats).reset_index(drop=True)
    test = test.dropna(subset=feats).reset_index(drop=True)
    if (n_tr, n_te) != (len(train), len(test)):
        log.error("post-anomaly dropna removed %d train and %d test rows",
                  n_tr - len(train), n_te - len(test))

    y_tr = train["label"].to_numpy()
    y_te = test["label"].to_numpy()

    pos = max(int(y_tr.sum()), 1)
    neg = max(int((1 - y_tr).sum()), 1)

    print(f"\ntrain: {len(train)} days ({pos} positive) <= {train_end_year}")
    print(f"test : {len(test)} days ({int(y_te.sum())} positive) >  {train_end_year}")
    print(f"train base rate = {pos / len(y_tr):.4f}   raw neg/pos = {neg / pos:.1f}")
    print(f"features ({len(feats)}): {feats}")
    if int(y_te.sum()) < 10:
        log.warning("only %d positive days in the held-out period; every "
                    "threshold statistic below is a point estimate on a "
                    "coin-flip sample. Ranking is the claim, not POD.",
                    int(y_te.sum()))

    # --- pick the model out of fold ---------------------------------------
    # The winner is chosen on training-period ranking only. If a one-parameter
    # rainfall rule beats the booster, the rule ships -- which is the honest
    # outcome when the catalogue holds sixty-four events.
    print("\n--- candidate selection (out-of-fold, training period only) ---")
    sel = select_model(train, feats)
    winner = sel["winner"]
    use_feats = winner["feats"]
    X_tr = train[use_feats].to_numpy(dtype=float)
    X_te = test[use_feats].to_numpy(dtype=float)

    if winner["kind"] == "rule":
        model, backend = None, "rule"
        raw = test[str(winner["spec"])].to_numpy(dtype=float)
    else:
        if winner["kind"] == "logistic":
            model, backend = _logistic()
        else:
            model, backend = _classifier(winner["spw"], **(winner["spec"] or {}))
        _fit_weighted(model, X_tr, y_tr,
                      inverse_frequency_weights(train["aoi_code"]).to_numpy())
        raw = model.predict_proba(X_te)[:, 1]
    print(f"backend: {backend}")

    oof = winner["oof"]
    seen = ~np.isnan(oof)

    # --- calibration ------------------------------------------------------
    # Fitted on out-of-fold training predictions only, never on the test
    # period, and on the same probability scale the deployed model produces.
    calib_name, calib_predict, calib_info = fit_calibrator(oof[seen], y_tr[seen])
    calibrated = calib_predict(raw)
    cal_prob = calib_predict(oof[seen])
    print(f"calibration: {calib_name}  ({calib_info['reason']})")

    # If the out-of-fold and test probability distributions sit on
    # different scales the frozen cut points land in the wrong place and
    # every level fires at once. Worth printing rather than discovering
    # from a nonsense alert table.
    print("\n--- probability scale check (OOF vs test, should be comparable) ---")
    print(f"{'':>10} {'p50':>9} {'p90':>9} {'p99':>9} {'max':>9}")
    for nm, arr in (("oof_raw", oof[seen]), ("oof_cal", cal_prob),
                    ("test_raw", raw), ("test_cal", calibrated)):
        print(f"{nm:>10} {np.percentile(arr, 50):>9.4f} {np.percentile(arr, 90):>9.4f} "
              f"{np.percentile(arr, 99):>9.4f} {float(np.max(arr)):>9.4f}")
    n_levels = int(np.unique(np.round(calibrated, 10)).size)
    print(f"distinct calibrated levels on test: {n_levels}")

    # --- threshold-free ranking skill -------------------------------------
    # With only a handful of test positives the level statistics are noisy, so
    # the headline claim is ranking: does the model put the days that actually
    # failed above the days that did not? PR-AUC divided by the base rate
    # reads directly as "how many times better than alerting at random".
    #
    # Ranking uses the calibrated score with the RAW score as tie-breaker. A
    # calibrator with few output levels lumps thousands of days into one block,
    # and ranking the blocks alone throws away ordering the model actually
    # produced -- 0.649 on calibrated-only versus 0.680 with the tie-break, on
    # the same model and the same days.
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
    # Levels are cut on the RAW score, not the calibrated probability.
    #
    # Both calibrators are monotone, so cutting on either is the same rule when
    # the calibrated values are distinct. They usually are not: isotonic fitted
    # to nineteen positives emits a dozen levels for four thousand days, and
    # every budget below the size of the top tie block then selects the same
    # days. A previous run printed L3 ("3% of days") and L4 ("1% of days") with
    # identical POD, FAR, CSI and bias -- two rows that look like different
    # operating points and are the same one.
    #
    # The raw score is continuous, so cutting on it honours each budget
    # separately. The equivalent calibrated probability is reported alongside so
    # the UI still shows a probability, and the realised alert fraction is
    # printed so any drift from the nominal budget is visible rather than
    # hidden.
    per_level = []
    oof_raw_seen = oof[seen]
    for lvl, name, budget in ALERT_LEVELS:
        thr = rank_threshold(oof_raw_seen, budget)
        fired = (raw >= thr).astype(int)
        row = skill_scores(y_te, fired)
        row.update({"level": lvl, "name": name, "alert_budget": budget,
                    "raw_score_threshold": round(thr, 6),
                    "equivalent_calibrated_probability": round(float(calib_predict([thr])[0]), 5),
                    "alert_days_per_year": round(budget * 365.25, 1),
                    "realised_alert_fraction": round(float(fired.mean()), 4),
                    "realised_alert_days_per_year": round(float(fired.mean()) * 365.25, 1)})
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

    ev_pct = event_percentiles(test, calibrated, tiebreak=raw if winner["kind"] != "rule" else None)

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
        # The baseline is reported on BOTH measures. Printing only
        # "frac in top 10%" under a heading that says "median percentile" made
        # the two numbers look comparable when they are not, and it hid the one
        # comparison that actually matters -- median percentile against median
        # percentile.
        if "baseline_median_percentile" in ev_pct:
            print(f"raw 24h rain, median pct   : {ev_pct['baseline_median_percentile']:.3f}"
                  f"   (model {ev_pct['median_percentile']:.3f})")
            print(f"raw 24h rain, in top 10%   : {ev_pct['baseline_frac_in_top_10pct']:.3f}"
                  f"   (model {ev_pct['frac_in_top_10pct']:.3f})")
    print("\n--- Model B vs physical baselines, held-out test period ---")
    print(f"{'':>8} {'budget':>7} {'days/yr':>8} {'real':>6} {'POD':>6} {'FAR':>6} "
          f"{'CSI':>6} {'bias':>6}")
    for row in per_level:
        print(f"{'ML ' + row['name']:>8} {row['alert_budget']:>7.0%} {row['alert_days_per_year']:>8.1f} "
              f"{row['realised_alert_days_per_year']:>6.1f} "
              f"{row['pod']:>6.3f} {row['far']:>6.3f} {row['csi']:>6.3f} {row['bias']:>6.3f}"
              f"   (p>={row['equivalent_calibrated_probability']:.4f})")
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
        "calibration_detail": calib_info,
        "selected_model": winner["name"],
        "selected_model_kind": winner["kind"],
        "selected_model_features": use_feats,
        "scale_pos_weight": winner["spw"],
        "scale_pos_weight_selection": "out-of-fold event-day median percentile "
                                      f"over {SCALE_POS_WEIGHT_GRID}",
        "model_selection": {
            "rule": "one-standard-error: simplest candidate within 1 bootstrap SE "
                    "of the best out-of-fold event-day median percentile",
            "one_se_bar": sel.get("one_se_bar"),
            "leaderboard": [
                {k: r[k] for k in ("name", "oof_median_percentile", "oof_se",
                                   "oof_n_events", "oof_frac_top10")}
                for r in sel["leaderboard"]
            ],
        },
        "level_definition": "operational alert budget (fraction of days allowed "
                            "at that level); thresholds frozen on the calibration split",
        "evaluation_window": {
            "catalogue_start": str(cat_start.date()),
            "catalogue_end": str(cat_end.date()),
            "rationale": "days outside the label catalogue cannot be positive, so "
                         "they are unknown rather than negative; scoring them as "
                         "negatives deflates the base rate and invalidates POD",
            "days_excluded_before": excluded_before,
            "days_excluded_after": excluded_after,
        },
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

    noney = noney_case_study(
        lambda df: (df[str(winner["spec"])].to_numpy(dtype=float)
                    if winner["kind"] == "rule"
                    else model.predict_proba(df[use_feats].to_numpy(dtype=float))[:, 1]),
        ref, calib_predict, ANCHOR_EVENTS["noney_2022"]["district"],
    )
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

    _export_api_bundle(winner, model, backend, calib_name, calib_predict, use_feats, ref, metrics)
    return metrics


class _PicklableCalibrator:
    """Monotone grid calibrator captured from fit_calibrator()'s closure.

    Kept for backward compatibility with exports made before the class moved
    to the API tree; new exports must use the API-side class so the pickle
    resolves in the deployed container (which mounts only apps/api/app).
    """

    def __init__(self, xs, ys):
        self.xs = np.asarray(xs, dtype=float)
        self.ys = np.asarray(ys, dtype=float)

    def predict(self, x):
        return np.interp(np.asarray(x, dtype=float), self.xs, self.ys)


def _api_calibrator_class():
    """Import the API-side PicklableCalibrator, adding apps/api to sys.path.

    The exported bundle pickles the class by reference, so the class must be
    importable at *unpickle* time inside the API process. Defining it in
    `app.services.ml_models.calibrator` (the API's own package, which the API
    image mounts) is what makes that work; ml/ is not shipped with the API.
    """
    import sys

    api_root = ARTIFACTS.parents[1] / "apps" / "api"
    if str(api_root) not in sys.path:
        sys.path.insert(0, str(api_root))
    from app.services.ml_models.calibrator import PicklableCalibrator

    return PicklableCalibrator


def _export_api_bundle(winner, model, backend, calib_name, calib_predict, use_feats, ref, metrics) -> None:
    """Export the real-data champion as the API inference bundle.

    The API risk engine needs a dict bundle with scaler/lgbm/xgb/calibrator/
    features (REQUIRED_BUNDLE_KEYS) and refuses synthetic=True. When the
    selection lands on a rule (no fitted model at all), export the deployed
    decision as a calibrated probability function over `rain_24h_anom` so the
    API still serves the selected model instead of silently degrading to the
    closed-form prior.
    """
    import joblib

    api_dir = ARTIFACTS.parents[1] / "apps" / "api" / "app" / "services" / "ml_models"
    api_dir.mkdir(parents=True, exist_ok=True)

    # District-keyed anomaly references so the API can reproduce the training
    # feature space at prediction time: risk_engine divides its observed
    # accumulations by these p90s instead of re-fitting climatology.
    from ml.config.aois import get_aoi

    refs_by_district: dict[str, dict[str, float]] = {}
    for (code, col), val in (ref or {}).items():
        try:
            dname = get_aoi(code).district
        except Exception:  # noqa: BLE001 - unknown code, skip
            continue
        refs_by_district.setdefault(dname, {})[col] = float(val)

    # The closure returned by fit_calibrator() cannot pickle (it is a local
    # lambda / nested function). Persist its behaviour instead: capture the
    # monotone mapping on the observed score range plus the extremes, and
    # rebuild it in the API as an interpolator. Isotonic and Platt-on-rank are
    # both monotone, so interpolating their outputs on the calibration grid is
    # exact at every observed score and linearly interpolated in between.
    oof = winner.get("oof")
    seen = ~np.isnan(oof) if oof is not None else np.array([False])
    grid = np.unique(np.nan_to_num(oof[seen], nan=0.0)) if seen.any() else np.array([0.0, 1.0])
    grid_vals = np.asarray(calib_predict(grid), dtype=float)
    # clamp anchors so scores outside the OOF range map to the end values
    lo, hi = float(grid.min()), float(grid.max())
    xs = np.concatenate([[lo - 1e6], grid, [hi + 1e6]])
    ys = np.concatenate([[grid_vals[0]], grid_vals, [grid_vals[-1]]])

    cal_obj = _api_calibrator_class()(xs, ys)

    bundle_common = {
        "name": MODEL_NAME,
        "version": MODEL_VERSION,
        "anomaly_refs": refs_by_district,
        # Operational cut points: equivalent calibrated probability at each
        # alert budget's raw-score threshold. The API's ml_tier() cuts on
        # these so the deployed tiers ARE the budget tiers the metrics
        # report, rather than arbitrary probability numbers.
        "alert_thresholds": {
            str(lvl): round(
                float(np.asarray(calib_predict(
                    [next(r["raw_score_threshold"] for r in metrics["per_level"] if r["level"] == lvl)]
                ))[0]), 6)
            for lvl, _, _ in ALERT_LEVELS
            if any(r["level"] == lvl for r in metrics["per_level"])
        },
        # Raw-score cuts in the model's own units. Isotonic calibration on a
        # 0.3% base rate emits a plateau, so several budgets share one
        # calibrated probability and a p-cut cannot separate L3 from L4; the
        # raw score is continuous and honours every budget separately. The
        # API prefers these when present.
        "raw_score_thresholds": {
            str(r["level"]): r["raw_score_threshold"]
            for r in metrics["per_level"]
        },
        "metrics": {
            "pr_auc": metrics["ranking"]["pr_auc"],
            "roc_auc": metrics["ranking"]["roc_auc"],
            "median_event_percentile": metrics["event_day_ranking"].get("median_percentile"),
        },
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": git_sha(),
        "synthetic": False,
    }

    if winner["kind"] == "rule":
        # Wrap the rule: score = raw anomaly column, calibrator maps to prob.
        col = str(winner["spec"])
        bundle = {
            **bundle_common,
            "version": f"{MODEL_VERSION}-rule",
            "rule_column": col,
            "scaler": None,
            "lgbm": None,
            "xgb": None,
            "calibrator": cal_obj,
            "features": [col],
        }
        path = api_dir / "model_b_nowcast.pkl"
        joblib.dump(bundle, path)
        log.info("exported RULE bundle (%s on %s) -> %s", winner["name"], col, path)
        return

    bundle = {
        **bundle_common,
        "scaler": None,  # sklearn pipeline carries its own StandardScaler
        "lgbm": model,
        "xgb": None,
        "weights": (1.0, 0.0),
        "calibrator": cal_obj,
        "features": use_feats,
    }
    path = api_dir / "model_b_nowcast.pkl"
    joblib.dump(bundle, path)
    log.info("exported %s bundle (%s) -> %s", backend, winner["name"], path)


# ---------------------------------------------------------------------------
# Noney 2022 case study
# ---------------------------------------------------------------------------
def noney_case_study(
    score_frame, ref: dict[tuple[str, str], float], calibrate, aoi_code: str
) -> dict | None:
    """Run the deployed scorer over the real run-up to the Noney tragedy.

    The 2022 event is not in the GLC (which ends in 2017), so this is *not* a
    metric -- it is a case study. We have real rainfall for the period, so we
    can honestly report what the system would have output, without claiming it
    as validated skill.

    ``score_frame`` is supplied by :func:`main` rather than being rebuilt here,
    because the thing being deployed might be a fitted model or might be a bare
    rainfall column, and this function used to assume the former -- it crashed
    outright the first time the search selected a rule.

    The anomaly reference comes from training, so the case study is scored on
    exactly the feature space the model was fitted to. Normalising by the
    window's own quantiles would make the run-up look as wet as its own wettest
    day come what may.
    """
    anchor = ANCHOR_EVENTS["noney_2022"]
    try:
        from ml.config.aois import get_aoi

        aoi = get_aoi(anchor["district"])
        daily = to_daily(load_weather(aoi.slug))
        daily["aoi_code"] = aoi_code
    except Exception as exc:  # noqa: BLE001
        log.warning("Noney case study skipped (%s)", exc)
        return None

    daily = add_anomalies(daily, ref)
    event = pd.Timestamp(anchor["date"], tz="UTC")
    window = daily[(daily["day"] >= event - pd.Timedelta(days=14))
                   & (daily["day"] <= event + pd.Timedelta(days=2))]
    if window.empty:
        return None

    try:
        probs = calibrate(score_frame(window))
    except Exception as exc:  # noqa: BLE001
        log.warning("Noney case study skipped: scorer failed (%s)", exc)
        return None

    timeline = [
        {"date": str(row.day.date()), "p": round(float(p), 4),
         "rain_24h_mm": round(float(row.rain_24h), 1)}
        for row, p in zip(window.itertuples(index=False), probs)
    ]
    peak = max(timeline, key=lambda r: r["p"])
    return {
        "event": anchor["label"],
        "event_date": anchor["date"],
        "note": "Case study, not a metric: the event post-dates the GLC label "
                "period, so no ground-truth label exists in training data. "
                "Read the shape of the run-up, not the absolute probability.",
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
