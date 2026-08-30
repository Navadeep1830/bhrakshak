"""Landslide labels from the NASA Global Landslide Catalog (GLC).

This is the module that decides whether the models learn from reality or from
a random number generator, so it is deliberately strict:

* Labels are **never fabricated**. If the catalog cannot be downloaded or is
  empty, this module raises instead of inventing events. A susceptibility model
  trained on invented labels would report a beautiful AUC that means nothing --
  the single fastest way to lose a technical review.
* Every row keeps its provenance (``source_name``, ``source_link``,
  ``event_id``) so any prediction can be traced back to a citable event.

Known limitation, handled downstream rather than hidden: the GLC is a *reported*
catalog. Fatal events near roads are massively over-represented relative to
small slides in remote terrain. That reporting bias is why
``ml/models/susceptibility.py`` uses terrain-matched negative sampling and
``ml/models/hazard_nowcast.py`` applies inverse-accessibility weighting -- the
model must learn the terrain/rainfall signal, not the "is this near a road"
signal.

Run:
    python -m ml.ingest.labels            # download + normalise + write artifacts
    python -m ml.ingest.labels --report   # just summarise what is on disk
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from ml.config.aois import all_aois, get_aoi
from ml.util.http import download_file

log = logging.getLogger("bhrakshak.labels")

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
RAW = Path(__file__).resolve().parents[2] / "data" / "raw"

# Canonical export published on the NASA Open Data Portal.
GLC_URL = (
    "https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/"
    "Global_Landslide_Catalog_Export_rows.csv"
)
GLC_FILENAME = "nasa_global_landslide_catalog.csv"

LABELS_CSV = ARTIFACTS / "labels_events.csv"
LABELS_PARQUET = ARTIFACTS / "labels_events.parquet"
SUMMARY_JSON = ARTIFACTS / "labels_summary.json"

# Trigger values in the GLC that mean "rain drove this".
RAIN_TRIGGERS = {"downpour", "rain", "continuous_rain", "monsoon", "rainfall", "torrential_rain"}

# Kilometres outside a district polygon an event may sit and still be
# attributed to it. The pilot polygons are coarse 8-10 vertex approximations of
# real administrative boundaries, so a strict point-in-polygon test throws away
# genuine district events that fall just outside our simplified outline.
# Every such row is tagged aoi_match='near' so the looseness stays auditable.
NEAR_BUFFER_KM = 25.0

KEEP_COLS = [
    "event_id", "event_date", "event_ts", "lat", "lon", "aoi_code", "aoi_match",
    "district", "state",
    "country_name", "admin_division_name", "landslide_category", "landslide_trigger",
    "is_rain_triggered", "landslide_size", "fatality_count", "injury_count",
    "event_title", "location_description", "location_accuracy",
    "source_name", "source_link",
]


def _strip_diacritics(value: str) -> str:
    """Normalise 'Meghālaya' -> 'Meghalaya' so admin names group correctly."""
    decomposed = unicodedata.normalize("NFKD", str(value))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _parse_dates(series: pd.Series) -> pd.Series:
    """Parse the GLC's MM/DD/YYYY hh:mm:ss AM/PM strings to UTC timestamps.

    The catalog mixes timestamps with and without a time component, so we try
    the precise format first and fall back to date-only. Naive strings are
    treated as UTC: the GLC does not carry a timezone and UTC is the only
    defensible choice given every rainfall series we join against is UTC.
    """
    with_time = pd.to_datetime(series, format="%m/%d/%Y %I:%M:%S %p", errors="coerce", utc=True)
    date_only = pd.to_datetime(series, format="%m/%d/%Y", errors="coerce", utc=True)
    parsed = with_time.fillna(date_only)
    loose = parsed.isna() & series.notna()
    if loose.any():
        parsed.loc[loose] = pd.to_datetime(series[loose], errors="coerce", utc=True)
    return parsed


def fetch_glc(force: bool = False) -> Path:
    """Download the catalog if it is not already on disk. Idempotent."""
    RAW.mkdir(parents=True, exist_ok=True)
    dest = RAW / GLC_FILENAME
    if force and dest.exists():
        dest.unlink()
    return download_file(GLC_URL, dest)


def load_glc(path: Path | None = None) -> pd.DataFrame:
    """Load the raw catalog with coordinates and dates coerced to real types."""
    src = Path(path) if path else RAW / GLC_FILENAME
    if not src.exists():
        raise FileNotFoundError(
            f"GLC not found at {src}. Run `python -m ml.ingest.labels` to download it."
        )
    df = pd.read_csv(src, low_memory=False)
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df["event_ts"] = _parse_dates(df["event_date"])
    log.info("loaded %d raw GLC rows from %s", len(df), src)
    return df


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km."""
    from math import asin, cos, radians, sin, sqrt

    r = 6371.0088
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def _aoi_geoms() -> list[tuple]:
    """(AOI, shapely geometry) pairs, or [] when shapely is unavailable."""
    try:
        from shapely.geometry import shape
    except ImportError:
        log.warning("shapely unavailable - falling back to bbox/centroid assignment")
        return []
    return [(a, shape(a.geometry)) for a in all_aois()]


def assign_aoi(df: pd.DataFrame, near_buffer_km: float = NEAR_BUFFER_KM) -> pd.DataFrame:
    """Attribute each event to an AOI.

    Strictly inside the polygon -> ``aoi_match='inside'``. Otherwise the nearest
    AOI within ``near_buffer_km`` -> ``aoi_match='near(<d>km)'``. Anything
    further away is left unassigned and dropped by build_labels().
    """
    aois = all_aois()
    pairs = _aoi_geoms()

    codes: list[str | None] = []
    matches: list[str | None] = []
    for lat, lon in zip(df["latitude"], df["longitude"]):
        if pd.isna(lat) or pd.isna(lon):
            codes.append(None)
            matches.append(None)
            continue
        lat, lon = float(lat), float(lon)

        inside = None
        if pairs:
            from shapely.geometry import Point

            pt = Point(lon, lat)
            inside = next((a for a, g in pairs if g.contains(pt)), None)
        else:
            inside = next((a for a in aois if a.contains(lat, lon)), None)

        if inside is not None:
            codes.append(inside.code)
            matches.append("inside")
            continue

        best, best_d = None, float("inf")
        for a in aois:
            d = _haversine_km(lat, lon, a.lat, a.lon)
            if d < best_d:
                best, best_d = a, d
        if best is not None and best_d <= near_buffer_km:
            codes.append(best.code)
            matches.append(f"near({best_d:.1f}km)")
        else:
            codes.append(None)
            matches.append(None)

    df["aoi_code"] = codes
    df["aoi_match"] = matches
    return df


def build_labels(
    df: pd.DataFrame,
    *,
    aoi_filter: bool = True,
    min_year: int = 2000,
) -> pd.DataFrame:
    """Filter/normalise the raw catalog into the tidy label frame."""
    out = df.dropna(subset=["latitude", "longitude", "event_ts"]).copy()
    out = out[out["event_ts"].dt.year >= min_year]

    out["event_trigger_norm"] = (
        out["landslide_trigger"].astype(str).str.strip().str.lower()
    )
    out["is_rain_triggered"] = out["event_trigger_norm"].isin(RAIN_TRIGGERS)

    out = assign_aoi(out)
    if aoi_filter:
        out = out[out["aoi_code"].notna()]

    out = out.rename(columns={"latitude": "lat", "longitude": "lon"})
    out["admin_division_name"] = out["admin_division_name"].map(_strip_diacritics)
    out["district"] = out["aoi_code"].map(lambda c: get_aoi(c).district if c else None)
    out["state"] = out["aoi_code"].map(lambda c: get_aoi(c).state if c else None)

    # Collapse near-duplicate reports: same AOI, same day, within ~0.02 deg
    # (~2 km). The GLC aggregates several news wires and the same slide is
    # often filed twice; leaving them in would double-count positives.
    out = out.sort_values("event_ts")
    out["_cell"] = (
        out["aoi_code"].astype(str) + "|"
        + out["event_ts"].dt.strftime("%Y-%m-%d") + "|"
        + (out["lat"] / 0.02).round().astype(int).astype(str) + "|"
        + (out["lon"] / 0.02).round().astype(int).astype(str)
    )
    deduped = out.drop_duplicates(subset="_cell", keep="first").drop(columns="_cell")

    return deduped[[c for c in KEEP_COLS if c in deduped.columns]].reset_index(drop=True)


def summarise(labels: pd.DataFrame) -> dict:
    """Summary written alongside the labels so the dataset is self-documenting."""
    by_aoi = (
        labels.groupby("aoi_code")
        .agg(
            n_events=("event_id", "count"),
            n_rain_triggered=("is_rain_triggered", "sum"),
            fatalities=("fatality_count", "sum"),
            first=("event_ts", "min"),
            last=("event_ts", "max"),
        )
        .reset_index()
    )
    # numpy/pandas scalars are not JSON serialisable -- downcast before writing
    for col in ("n_events", "n_rain_triggered", "fatalities"):
        by_aoi[col] = by_aoi[col].astype(int)
    for col in ("first", "last"):
        by_aoi[col] = by_aoi[col].astype(str)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "NASA Global Landslide Catalog (GLC) export",
        "source_url": GLC_URL,
        "n_events": int(len(labels)),
        "n_rain_triggered": int(labels["is_rain_triggered"].sum()),
        "date_range": [
            str(labels["event_ts"].min()),
            str(labels["event_ts"].max()),
        ],
        "fatalities_total": int(pd.to_numeric(labels["fatality_count"], errors="coerce").fillna(0).sum()),
        "by_aoi": by_aoi.to_dict(orient="records"),
        # 'near(12.3km)' -> 'near' so the report shows how many were buffered in
        "by_match": labels["aoi_match"].str.replace(r"\(.*\)", "", regex=True)
                        .value_counts().to_dict(),
        "near_buffer_km": NEAR_BUFFER_KM,
        "synthetic": False,
    }


def run(force_download: bool = False, aoi_filter: bool = True) -> pd.DataFrame:
    """Download (if needed), normalise, and persist labels. Idempotent."""
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    path = fetch_glc(force=force_download)
    raw = load_glc(path)
    labels = build_labels(raw, aoi_filter=aoi_filter)

    if labels.empty:
        raise RuntimeError(
            "No landslide events matched the AOI polygons. Refusing to write an "
            "empty label set -- models must not be trained on invented positives."
        )

    labels.to_csv(LABELS_CSV, index=False)
    try:
        labels.to_parquet(LABELS_PARQUET, index=False)
    except Exception as exc:  # pragma: no cover - pyarrow optional
        log.warning("parquet write skipped (%s)", exc)

    summary = summarise(labels)
    SUMMARY_JSON.write_text(json.dumps(summary, indent=2, default=str))

    log.info("labels -> %s (%d events)", LABELS_CSV, len(labels))
    return labels


def main() -> None:
    ap = argparse.ArgumentParser(description="Build landslide labels from the NASA GLC")
    ap.add_argument("--force", action="store_true", help="re-download the catalog")
    ap.add_argument("--all-ner", action="store_true",
                    help="keep every NER event, not only those inside an AOI polygon")
    ap.add_argument("--report", action="store_true", help="summarise existing labels")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.report:
        if not LABELS_CSV.exists():
            print("no labels on disk; run without --report first", file=sys.stderr)
            sys.exit(1)
        labels = pd.read_csv(LABELS_CSV)
        print(json.dumps(summarise(labels), indent=2, default=str))
        return

    labels = run(force_download=args.force, aoi_filter=not args.all_ner)
    summary = summarise(labels)
    print(f"\n{summary['n_events']} labelled events "
          f"({summary['n_rain_triggered']} rainfall-triggered), "
          f"{summary['date_range'][0]} -> {summary['date_range'][1]}")
    print("\nby AOI:")
    for row in summary["by_aoi"]:
        print(f"  {row['aoi_code']:8} n={row['n_events']:<4} rain={row['n_rain_triggered']:<4} "
              f"fatalities={row['fatalities']}")
    print(f"\nartifacts -> {LABELS_CSV}")


if __name__ == "__main__":
    main()
