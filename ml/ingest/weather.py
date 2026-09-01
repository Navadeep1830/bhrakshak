"""MODULE 1 - Soil & Rainfall Analysis.

Pulls real hourly rainfall and soil moisture for every pilot AOI and turns it
into the antecedent-moisture features the hazard model runs on.

Provider abstraction
--------------------
``OpenMeteoProvider`` is the live path (Open-Meteo Historical/Archive for the
backfill, Open-Meteo Forecast for the forward window). ``IMDProvider`` is an
explicit stub for the IMD/mausam API so the swap is a config change rather than
a rewrite -- it raises rather than quietly returning invented numbers.

This module used to fall back to a synthetic generator whenever the network
blipped, with no record of it having done so. That is no longer silent: every
row carries a ``source`` column and the run summary reports ``synthetic``, so a
reviewer can see exactly how much of the dataset is real.

Coordinates come from ``ml.config.aois`` -- there are no hardcoded lat/lons
here, so adding a district is a data change, not a code change.

Run:
    python -m ml.ingest.weather                      # all AOIs, 5y -> today
    python -m ml.ingest.weather --aoi MN-NON --years 10
    python -m ml.ingest.weather --forecast-only
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

from ml.config.aois import (
    EFFECTIVE_RAIN_HALF_LIFE_H as HALF_LIFE_H,
)
from ml.config.aois import AOI, all_aois, get_aoi
from ml.util.http import get_json

log = logging.getLogger("bhrakshak.weather")

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = REPO_ROOT / "ml" / "cache"
ARTIFACTS = REPO_ROOT / "ml" / "artifacts"

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

HOURLY_VARS = "precipitation,soil_moisture_3_to_9cm,temperature_2m"


# ---------------------------------------------------------------------------
# providers
# ---------------------------------------------------------------------------
class WeatherProvider(ABC):
    """A source of hourly near-surface weather for a point."""

    name = "abstract"

    @abstractmethod
    def historical_hourly(self, lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
        """Return columns [ts, precipitation_mm, soil_moisture, temperature_c]."""

    @abstractmethod
    def forecast_hourly(self, lat: float, lon: float, hours: int = 72) -> pd.DataFrame:
        """Return the same schema for the forward window."""


def _frame_from_open_meteo(payload: dict, source: str) -> pd.DataFrame:
    empty = pd.DataFrame(columns=["ts", "precipitation_mm", "soil_moisture", "temperature_c"])
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return empty
    df = pd.DataFrame(
        {
            "ts": pd.to_datetime(times, utc=True),
            "precipitation_mm": pd.to_numeric(
                pd.Series(hourly.get("precipitation") or [np.nan] * len(times)), errors="coerce"
            ),
            "soil_moisture": pd.to_numeric(
                pd.Series(hourly.get("soil_moisture_3_to_9cm") or [np.nan] * len(times)), errors="coerce"
            ),
            "temperature_c": pd.to_numeric(
                pd.Series(hourly.get("temperature_2m") or [np.nan] * len(times)), errors="coerce"
            ),
        }
    )
    df["source"] = source
    return df


class OpenMeteoProvider(WeatherProvider):
    """Live Open-Meteo access. No API key required."""

    name = "open_meteo"

    def __init__(self, chunk_days: int = 365, pace_seconds: float = 1.2) -> None:
        # Long ranges are chunked: a single multi-year request routinely times
        # out, and chunking makes the pull resumable.
        self.chunk_days = chunk_days
        # A 20-year backfill is ~20 requests per AOI. Without pacing, Open-Meteo
        # starts returning 429 part-way through and whole districts fall back.
        self.pace_seconds = pace_seconds

    def historical_hourly(self, lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
        frames: list[pd.DataFrame] = []
        cursor = pd.Timestamp(start)
        stop = pd.Timestamp(end)
        while cursor <= stop:
            chunk_end = min(cursor + pd.Timedelta(days=self.chunk_days - 1), stop)
            payload = get_json(
                ARCHIVE_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "start_date": cursor.date().isoformat(),
                    "end_date": chunk_end.date().isoformat(),
                    "hourly": HOURLY_VARS,
                    "timezone": "UTC",
                },
                timeout=90,
            )
            frames.append(_frame_from_open_meteo(payload, "open-meteo-archive"))
            log.debug("archive %s -> %s", cursor.date(), chunk_end.date())
            cursor = chunk_end + pd.Timedelta(days=1)
            if cursor <= stop:
                time.sleep(self.pace_seconds)
        if not frames:
            return pd.DataFrame(columns=["ts", "precipitation_mm", "soil_moisture", "temperature_c"])
        return pd.concat(frames, ignore_index=True)

    def historical_grid(
        self,
        points: list[tuple[float, float]],
        start: date,
        end: date,
    ) -> pd.DataFrame:
        """Hourly rainfall aggregated over a grid of points, in ONE request each.

        A district spans tens of kilometres and landslides are triggered by
        *local* downpours. Sampling only the centroid misses the storm cell that
        actually hit the slope, which is a large part of why a point-sampled
        model looks no better than a global threshold. Open-Meteo accepts a
        comma-separated list of coordinates and returns one result per point, so
        a 3x3 grid costs the same number of requests as a single point.

        Returns [ts, precipitation_mm, precipitation_max_mm, temperature_c].
        """
        lats = ",".join(f"{p[0]:.5f}" for p in points)
        lons = ",".join(f"{p[1]:.5f}" for p in points)

        frames: list[pd.DataFrame] = []
        cursor = pd.Timestamp(start)
        stop = pd.Timestamp(end)
        while cursor <= stop:
            chunk_end = min(cursor + pd.Timedelta(days=self.chunk_days - 1), stop)
            payload = get_json(
                ARCHIVE_URL,
                params={
                    "latitude": lats,
                    "longitude": lons,
                    "start_date": cursor.date().isoformat(),
                    "end_date": chunk_end.date().isoformat(),
                    "hourly": HOURLY_VARS,
                    "timezone": "UTC",
                },
                timeout=120,
            )
            results = payload if isinstance(payload, list) else [payload]
            series: list[np.ndarray] = []
            temps: list[np.ndarray] = []
            times: list[str] = []
            for res in results:
                hourly = res.get("hourly") or {}
                if not times:
                    times = hourly.get("time") or []
                series.append(
                    pd.to_numeric(
                        pd.Series(hourly.get("precipitation") or []), errors="coerce"
                    ).to_numpy()
                )
                temps.append(
                    pd.to_numeric(
                        pd.Series(hourly.get("temperature_2m") or []), errors="coerce"
                    ).to_numpy()
                )
            if times:
                stack = np.vstack([s if len(s) == len(times) else np.full(len(times), np.nan)
                                   for s in series])
                tstack = np.vstack([t if len(t) == len(times) else np.full(len(times), np.nan)
                                    for t in temps])
                # nan-aware: a point that failed must not drag the mean down
                with np.errstate(invalid="ignore"):
                    mean_p = np.nanmean(np.where(np.isnan(stack), np.nan, stack), axis=0)
                    max_p = np.nanmax(np.where(np.isnan(stack), -np.inf, stack), axis=0)
                    mean_t = np.nanmean(np.where(np.isnan(tstack), np.nan, tstack), axis=0)
                max_p = np.where(np.isfinite(max_p), max_p, np.nan)
                frames.append(
                    pd.DataFrame(
                        {
                            "ts": pd.to_datetime(times, utc=True),
                            "precipitation_mm": mean_p,
                            "precipitation_max_mm": max_p,
                            "soil_moisture": np.nan,   # archive serves no soil moisture
                            "temperature_c": mean_t,
                            "source": "open-meteo-archive-grid",
                        }
                    )
                )
            log.debug("grid archive %s -> %s (%d pts)", cursor.date(), chunk_end.date(), len(points))
            cursor = chunk_end + pd.Timedelta(days=1)
            if cursor <= stop:
                time.sleep(self.pace_seconds)

        if not frames:
            return pd.DataFrame(columns=["ts", "precipitation_mm", "precipitation_max_mm"])
        return pd.concat(frames, ignore_index=True)

    def forecast_hourly(self, lat: float, lon: float, hours: int = 72) -> pd.DataFrame:
        days = max(1, int(np.ceil(hours / 24)) + 1)
        payload = get_json(
            FORECAST_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "hourly": HOURLY_VARS,
                "forecast_days": days,
                "timezone": "UTC",
            },
            timeout=60,
        )
        return _frame_from_open_meteo(payload, "open-meteo-forecast")


class IMDProvider(WeatherProvider):
    """Stub for the IMD / mausam API.

    Deliberately unimplemented. India's official station network is the right
    primary source for an operational system (ground truth where Open-Meteo is
    reanalysis), but it needs an API key and per-station handling. Wiring it
    later means filling in these two methods; nothing else changes.
    """

    name = "imd"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key

    def _unavailable(self) -> NotImplementedError:
        return NotImplementedError(
            "IMDProvider is a stub. Set IMD_API_KEY and implement "
            "historical_hourly()/forecast_hourly(), or use the default "
            "OpenMeteoProvider."
        )

    def historical_hourly(self, lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
        raise self._unavailable()

    def forecast_hourly(self, lat: float, lon: float, hours: int = 72) -> pd.DataFrame:
        raise self._unavailable()


def get_provider(name: str | None = None) -> WeatherProvider:
    """Provider factory. ``name`` overrides BHURAKSHAK_WEATHER_PROVIDER."""
    chosen = (name or os.environ.get("BHURAKSHAK_WEATHER_PROVIDER", "open_meteo")).strip().lower()
    if chosen in ("open_meteo", "openmeteo", "om"):
        return OpenMeteoProvider()
    if chosen == "imd":
        return IMDProvider(api_key=os.environ.get("IMD_API_KEY"))
    raise ValueError(f"unknown weather provider {chosen!r} (expected 'open_meteo' or 'imd')")


# ---------------------------------------------------------------------------
# feature engineering
# ---------------------------------------------------------------------------
def effective_rainfall(hourly_mm: Iterable[float], half_life_h: float = HALF_LIFE_H) -> np.ndarray:
    """Kohler-Linsley API-style antecedent precipitation index.

    eff[i] = eff[i-1] * decay + p[i], with decay set so the index halves every
    `half_life_h` hours. This expresses "the ground is already wet": a slope
    that took 150 mm three days ago is far more primed than a dry one, and a
    bare 24 h sum cannot see that.
    """
    arr = np.nan_to_num(np.asarray(list(hourly_mm), dtype=float), nan=0.0)
    decay = 0.5 ** (1.0 / half_life_h)
    out = np.zeros_like(arr)
    acc = 0.0
    for i, mm in enumerate(arr):
        acc = acc * decay + float(mm)
        out[i] = acc
    return out


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add rolling accumulations, effective rainfall and calendar features.

    Idempotent: safe to re-run on an already-featured frame.
    """
    if df.empty:
        return df
    out = df.copy()
    out["ts"] = pd.to_datetime(out["ts"], utc=True)
    out = out.drop_duplicates(subset="ts", keep="last").sort_values("ts").reset_index(drop=True)

    out["precipitation_mm"] = pd.to_numeric(out["precipitation_mm"], errors="coerce").fillna(0.0)
    idx = out.set_index("ts")

    # Time-based rolling sums stay correct across gaps; a fixed 24-row window
    # would silently under-count whenever an hour is missing.
    out["rain_1h"] = out["precipitation_mm"].to_numpy()
    for label, window in (
        ("rain_24h", "24h"), ("rain_48h", "48h"), ("rain_72h", "72h"), ("rain_7d", "7D")
    ):
        out[label] = idx["precipitation_mm"].rolling(window).sum().to_numpy()
    out["eff_rain"] = effective_rainfall(out["precipitation_mm"].to_numpy())

    # Grid-sampled pulls carry a per-hour maximum across the district. Two
    # distinct signals come out of it, and they behave differently:
    #   * rolling SUM  -> how much rain the wettest point received (total load)
    #   * rolling MAX  -> the peak hourly intensity anywhere (trigger energy)
    # Landslide triggering cares about both, which is why every published I-D
    # threshold is a curve in (intensity, duration) rather than a single number.
    if "precipitation_max_mm" in out.columns:
        grid_max = out.set_index("ts")["precipitation_max_mm"]
        for label, window, how in (
            ("rain_24h_gridmax", "24h", "sum"),
            ("rain_72h_gridmax", "72h", "sum"),
            ("rain_1h_gridmax", "24h", "max"),
        ):
            rolled = getattr(grid_max.rolling(window), how)()
            out[label] = rolled.to_numpy()
        out["eff_rain_gridmax"] = effective_rainfall(
            out["precipitation_max_mm"].fillna(0.0).to_numpy()
        )

    out["soil_moisture"] = pd.to_numeric(out.get("soil_moisture"), errors="coerce")
    # Open-Meteo reports volumetric water content (m3/m3, e.g. 0.386). The app,
    # the seed data and every dashboard reading treat soil_moisture as percent
    # (38.6). Previously the worker wrote 0.386 into rainfall_obs while the rest
    # of the system read it as percent -- a silent 100x error. Convert once,
    # here, at the boundary. Guarded so re-running on a converted frame is safe.
    if out["soil_moisture"].notna().any() and out["soil_moisture"].max() <= 1.0:
        out["soil_moisture"] = out["soil_moisture"] * 100.0
    out["temperature_c"] = pd.to_numeric(out.get("temperature_c"), errors="coerce")

    # Rolling-window edges start as NaN; backfill from the partial sum so no
    # model ever sees a hole at the start of the series.
    expanding = pd.Series(idx["precipitation_mm"].expanding().sum().to_numpy(), index=out.index)
    for label in ("rain_24h", "rain_48h", "rain_72h", "rain_7d"):
        out[label] = out[label].fillna(expanding)

    out["hour"] = out["ts"].dt.hour
    out["day_of_year"] = out["ts"].dt.dayofyear
    out["is_monsoon"] = out["ts"].dt.month.isin(range(5, 10)).astype(int)

    if "source" not in out.columns:
        out["source"] = "unknown"
    return out


# ---------------------------------------------------------------------------
# ingestor
# ---------------------------------------------------------------------------
def grid_points(aoi: AOI, n: int = 3) -> list[tuple[float, float]]:
    """An n x n sample grid over the AOI, keeping points inside the polygon.

    Falls back to the centroid alone if the polygon is too small for the grid
    to land any interior point.
    """
    if n <= 1:
        return [(aoi.lat, aoi.lon)]
    minlon, minlat, maxlon, maxlat = aoi.bbox
    pts = []
    for i in range(n):
        for j in range(n):
            lat = minlat + (maxlat - minlat) * (i + 0.5) / n
            lon = minlon + (maxlon - minlon) * (j + 0.5) / n
            if aoi.contains(lat, lon):
                pts.append((round(lat, 5), round(lon, 5)))
    return pts or [(aoi.lat, aoi.lon)]


@dataclass
class WeatherIngestor:
    """Pulls, features and persists weather for one AOI."""

    aoi: AOI
    provider: WeatherProvider = field(default_factory=get_provider)
    cache_dir: Path = CACHE_DIR
    grid_n: int = 3

    @property
    def cache_path(self) -> Path:
        return Path(self.cache_dir) / f"weather_{self.aoi.slug}.parquet"

    def pull_historical(self, start: date, end: date) -> pd.DataFrame:
        """Historical pull over a grid of points, degrading to the centroid.

        ``grid_n > 1`` asks for ``grid_n x grid_n`` points across the district
        bounding box. The provider returns both the area mean and the area max
        per hour, and :func:`compute_features` turns the max series into the
        ``*_gridmax`` columns the nowcast model ranks on. If the provider cannot
        do grids the pull still succeeds on the centroid alone -- the model then
        simply sees no gridmax columns and trains on the point features only.
        """
        log.info("%s: historical %s -> %s", self.aoi.code, start, end)
        grid_fn = getattr(self.provider, "historical_grid", None)
        if self.grid_n > 1 and callable(grid_fn):
            points = grid_points(self.aoi, self.grid_n)
            if len(points) > 1:
                try:
                    df = grid_fn(points, start, end)
                    if not df.empty:
                        log.info("%s: grid pull %d points -> %d rows",
                                 self.aoi.code, len(points), len(df))
                        return df
                    log.warning("%s: grid pull empty, falling back to centroid", self.aoi.code)
                except Exception as exc:
                    # Never lose the pull over an optimisation: the centroid
                    # series is still usable, just less representative.
                    log.warning("%s: grid pull failed (%s); falling back to centroid",
                                self.aoi.code, exc)
        df = self.provider.historical_hourly(self.aoi.lat, self.aoi.lon, start, end)
        if df.empty:
            log.warning("%s: no historical rows returned", self.aoi.code)
        return df

    def pull_forecast(self, hours: int = 72) -> pd.DataFrame:
        return self.provider.forecast_hourly(self.aoi.lat, self.aoi.lon, hours).head(hours)

    def load_cache(self) -> pd.DataFrame:
        if not self.cache_path.exists():
            return pd.DataFrame(columns=["ts"])
        return pd.read_parquet(self.cache_path)

    def save_cache(self, df: pd.DataFrame) -> pd.DataFrame:
        """Idempotent merge on ts: re-running never duplicates or loses rows."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        merged = df
        if self.cache_path.exists():
            old = pd.read_parquet(self.cache_path)
            old["ts"] = pd.to_datetime(old["ts"], utc=True)
            merged = pd.concat([old, df], ignore_index=True)
            merged = merged.drop_duplicates(subset="ts", keep="last").sort_values("ts")
        merged = merged.reset_index(drop=True)
        try:
            merged.to_parquet(self.cache_path, index=False)
        except Exception as exc:  # pragma: no cover - pyarrow optional
            csv_path = self.cache_path.with_suffix(".csv")
            merged.to_csv(csv_path, index=False)
            log.warning("parquet unavailable (%s); wrote %s", exc, csv_path)
        return merged

    def upsert_to_db(self, df: pd.DataFrame, database_url: str | None = None) -> int:
        """Write featured rows into ``rainfall_obs`` for every zone in the AOI.

        Real upsert on the (ts, zone_id) primary key, so re-running is safe.
        Returns rows written, or 0 (logged) when no database is reachable --
        the API lives in Docker and the ML pipeline must run without it.
        """
        url = database_url or os.environ.get("DATABASE_URL")
        if not url or df.empty:
            log.info("%s: skipping db upsert (no DATABASE_URL or empty frame)", self.aoi.code)
            return 0

        async def _run() -> int:
            import asyncpg

            conn = await asyncpg.connect(url)
            try:
                zones = await conn.fetch(
                    "SELECT id FROM zones WHERE district = $1", self.aoi.district
                )
                if not zones:
                    log.warning("%s: no zones for district %s", self.aoi.code, self.aoi.district)
                    return 0
                rows = [
                    (
                        row.ts.to_pydatetime(), z["id"],
                        _f(row.rain_1h), _f(row.rain_24h), _f(row.rain_48h),
                        _f(row.rain_72h), _f(row.rain_7d), _f(row.eff_rain),
                        _f(row.soil_moisture),
                    )
                    for z in zones
                    for row in df.itertuples(index=False)
                ]
                await conn.executemany(
                    """
                    INSERT INTO rainfall_obs
                        (ts, zone_id, rain_1h, rain_24h, rain_48h, rain_72h,
                         rain_7d, eff_rain, soil_moisture)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    ON CONFLICT (ts, zone_id) DO UPDATE SET
                        rain_1h = EXCLUDED.rain_1h,
                        rain_24h = EXCLUDED.rain_24h,
                        rain_48h = EXCLUDED.rain_48h,
                        rain_72h = EXCLUDED.rain_72h,
                        rain_7d  = EXCLUDED.rain_7d,
                        eff_rain = EXCLUDED.eff_rain,
                        soil_moisture = EXCLUDED.soil_moisture
                    """,
                    rows,
                )
                return len(rows)
            finally:
                await conn.close()

        try:
            written = asyncio.run(_run())
            log.info("%s: upserted %d rainfall_obs rows", self.aoi.code, written)
            return written
        except Exception as exc:  # noqa: BLE001 - DB optional for the ML pipeline
            log.warning("%s: db upsert skipped (%s)", self.aoi.code, exc)
            return 0

    def _cached_rows(self) -> int:
        """Rows already in the cache, or 0 when it is missing or unreadable."""
        try:
            return int(len(pd.read_parquet(self.cache_path)))
        except Exception:  # noqa: BLE001
            return 0

    def _summarise(self, cached: pd.DataFrame, synthetic: bool, db_rows: int = 0) -> dict:
        real_rows = int((cached["source"] != "synthetic").sum()) if "source" in cached.columns else len(cached)
        return {
            "aoi": self.aoi.code,
            "district": self.aoi.district,
            "rows": int(len(cached)),
            "real_rows": real_rows,
            "start": str(cached["ts"].min()),
            "end": str(cached["ts"].max()),
            "annual_rain_mm": _annual_rain(cached),
            "max_eff_rain_mm": round(float(cached["eff_rain"].max()), 1),
            "mean_soil_moisture_pct": round(float(cached["soil_moisture"].mean()), 1)
            if cached["soil_moisture"].notna().any() else None,
            # Open-Meteo's archive endpoint does not serve soil moisture at all
            # (it accepts the variable and returns nulls), so historical coverage
            # is ~0 and only the forecast window has it. Models therefore use
            # eff_rain -- the Kohler-Linsley index -- as the antecedent-moisture
            # signal, which is defined over the full history.
            "soil_moisture_coverage_pct": round(float(cached["soil_moisture"].notna().mean() * 100), 1),
            "db_rows_written": db_rows,
            "synthetic": synthetic,
            "cache": str(self.cache_path),
        }

    def run(
        self,
        start: date | None = None,
        end: date | None = None,
        forecast_hours: int = 72,
        write_db: bool = False,
        historical: bool = True,
    ) -> dict:
        end = end or datetime.now(timezone.utc).date()
        start = start or (end - timedelta(days=365 * 5))

        frames: list[pd.DataFrame] = []
        synthetic = False
        if historical:
            try:
                frames.append(self.pull_historical(start, end))
            except Exception as exc:  # noqa: BLE001
                log.error("%s: historical pull failed (%s)", self.aoi.code, exc)
                synthetic = True
        try:
            frames.append(self.pull_forecast(forecast_hours))
        except Exception as exc:  # noqa: BLE001
            log.warning("%s: forecast pull failed (%s)", self.aoi.code, exc)

        # A failed historical pull must never downgrade a good cache.
        # Open-Meteo rate-limits (429) routinely; if we let the 72-hour forecast
        # stub merge over 20 years of real observations, the pipeline reports
        # success while the model quietly trains on three days. A stale cache is
        # recoverable -- a destroyed one costs another full re-pull.
        if synthetic and self._cached_rows() > 0:
            log.error("%s: keeping the existing cache (%d rows) instead of "
                      "overwriting it after a failed historical pull",
                      self.aoi.code, self._cached_rows())
            kept = self._summarise(self.load_cache(), synthetic=False)
            kept["error"] = "historical pull failed; existing cache preserved"
            return kept

        frames = [f for f in frames if not f.empty]
        if not frames:
            return {"aoi": self.aoi.code, "rows": 0, "synthetic": True,
                    "error": "no data retrieved"}

        featured = compute_features(pd.concat(frames, ignore_index=True))
        cached = self.save_cache(featured)
        written = self.upsert_to_db(featured) if write_db else 0
        return self._summarise(cached, synthetic, written)


def _f(value: Any) -> float | None:
    """Coerce to a DB-safe float, mapping NaN/None to NULL."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(out) else out


def _annual_rain(df: pd.DataFrame) -> float | None:
    """Mean mm/year over the covered period, for sanity-checking a pull."""
    if df.empty:
        return None
    days = max((df["ts"].max() - df["ts"].min()).days, 1)
    return round(float(df["precipitation_mm"].sum()) * 365.0 / days, 0)


def run_all(
    aoi_names: list[str] | None = None,
    years: int = 5,
    forecast_hours: int = 72,
    write_db: bool = False,
) -> list[dict]:
    """Ingest every AOI. Idempotent."""
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=int(365 * years))
    results = []
    for aoi in (all_aois() if not aoi_names else [get_aoi(n) for n in aoi_names]):
        res = WeatherIngestor(aoi).run(
            start=start, end=end, forecast_hours=forecast_hours, write_db=write_db
        )
        results.append(res)
        log.info("%s -> %s rows", aoi.code, res.get("rows"))
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "weather_summary.json").write_text(json.dumps(results, indent=2, default=str))
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest real rainfall/soil-moisture for pilot AOIs")
    ap.add_argument("--aoi", action="append", help="AOI code or district name (repeatable)")
    ap.add_argument("--years", type=int, default=5, help="years of history to pull")
    ap.add_argument("--forecast-only", action="store_true")
    ap.add_argument("--write-db", action="store_true", help="also upsert into rainfall_obs")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.forecast_only:
        for aoi in (all_aois() if not args.aoi else [get_aoi(n) for n in args.aoi]):
            df = WeatherIngestor(aoi).pull_forecast(72)
            print(f"{aoi.code:8} forecast rows={len(df)} "
                  f"next24h={df['precipitation_mm'].head(24).sum():.1f}mm")
        return

    results = run_all(args.aoi, years=args.years, write_db=args.write_db)
    # ``soil%`` is COVERAGE, not the mean of the column. Open-Meteo's archive
    # endpoint accepts the soil-moisture variable and returns nulls for every
    # historical hour, so the mean is computed over the ~72 forecast rows and
    # printing it under a bare "soil%" header reads as 33% coverage when the
    # real figure is 0.04%. That misled a debugging session into thinking the
    # antecedent-moisture feature had been recovered. It has not; eff_rain is
    # still the proxy, which is why the models carry it.
    print(f"\n{'AOI':8} {'rows':>7} {'annual_mm':>10} {'max_eff':>8} "
          f"{'soil_cov%':>10}  synthetic")
    for r in results:
        print(f"{r['aoi']:8} {r['rows']:>7} {str(r.get('annual_rain_mm')):>10} "
              f"{str(r.get('max_eff_rain_mm')):>8} "
              f"{str(r.get('soil_moisture_coverage_pct')):>10}  "
              f"{'YES' if r.get('synthetic') else 'no'}")
    print(f"\nartifacts -> {ARTIFACTS / 'weather_summary.json'}")
    if any(float(r.get("soil_moisture_coverage_pct") or 0) < 1.0 for r in results):
        print("note: soil moisture is unavailable historically (archive endpoint "
              "returns nulls); antecedent condition is carried by eff_rain, the "
              "Kohler-Linsley index, which is defined over the full history.")


if __name__ == "__main__":
    main()
