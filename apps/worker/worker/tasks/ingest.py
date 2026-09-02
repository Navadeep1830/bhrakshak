import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from worker.db_local import fresh_sessionmaker
from app.models import RainfallObs, Zone
from worker.celery_app import celery_app

log = logging.getLogger("bhrakshak.ingest")


async def _fetch_open_meteo(lat: float, lon: float) -> dict | None:
    if settings.fixture_mode:
        return None
    url = (
        f"{settings.open_meteo_base}/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=precipitation,soil_moisture_3_to_9cm"
        "&past_hours=168&forecast_days=3&timezone=UTC"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        log.warning("open-meteo fetch failed (%s) - fixture fallback", e)
        return None


def _synthetic_hourly(n: int = 168) -> list[float]:
    """Deterministic monsoon-ish pattern so the pipeline works fully offline."""
    base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    out = []
    for i in range(n):
        h = (base + timedelta(hours=i - n)).hour
        wave = max(0.0, 2.5 * ((i % 37) / 37) ** 2) + (1.2 if h in (14, 15, 16, 17) else 0.2)
        out.append(round(wave, 2))
    return out


async def _poll_all() -> int:
    from geoalchemy2 import functions as gfunc

    from sqlalchemy import func

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    written = 0

    async with fresh_sessionmaker()() as db:
        # One fetch per DISTRICT, not per zone: 536 zone-level requests every
        # tick blew through Open-Meteo's free tier (HTTP 429 across the fleet,
        # zero live rainfall). District centroids are ~8 requests; every zone
        # in the district shares its gauge. Zone-heterogeneity inside a
        # district is far smaller than the gap between "no data" and "data".
        zone_rows = (
            await db.execute(
                select(
                    Zone.district,
                    func.count().label("n_zones"),
                    func.avg(gfunc.ST_Y(gfunc.ST_Centroid(Zone.geom))).label("lat"),
                    func.avg(gfunc.ST_X(gfunc.ST_Centroid(Zone.geom))).label("lon"),
                )
                .group_by(Zone.district)
            )
        ).all()

        sem = asyncio.Semaphore(4)

        async def _fetch_for(district, lat_f, lon_f):
            async with sem:
                if lat_f is None or lon_f is None:
                    return district, None
                return district, await _fetch_open_meteo(float(lat_f), float(lon_f))

        results = await asyncio.gather(
            *(_fetch_for(d, lat, lon) for d, _n, lat, lon in zone_rows),
            return_exceptions=True,
        )

        data_by_district: dict = {}
        for item in results:
            if isinstance(item, Exception):
                log.warning("district fetch task failed: %s", item)
                continue
            district, data = item
            data_by_district[district] = data

        for district, _n, _lat, _lon in zone_rows:
            data = data_by_district.get(district)
            hourly: list[float]
            soil: list[float] | None = None
            if data and "hourly" in data:
                hourly = data["hourly"].get("precipitation") or []
                soil = data["hourly"].get("soil_moisture_3_to_9cm")
                # Open-Meteo emits null for the current partial hour; a None in
                # the tail would crash the rolling sums with TypeError.
                hourly = [float(m) if m is not None else 0.0 for m in hourly]
                if soil:
                    soil = [float(s) if s is not None else None for s in soil]
            else:
                hourly = _synthetic_hourly()
            if not hourly:
                continue

            # all zones of this district share the district gauge
            zone_ids = (
                await db.execute(select(Zone.id).where(Zone.district == district))
            ).scalars().all()
            if not zone_ids:
                continue

            tail = hourly[-72:]
            for ts_i, (mm, r24, r48, r72, eff, sm) in enumerate(_rolling_rows(tail, soil)):
                ts = now - timedelta(hours=len(tail) - 1 - ts_i)
                for zid in zone_ids:
                    exists = await db.execute(
                        select(RainfallObs).where(RainfallObs.zone_id == zid, RainfallObs.ts == ts)
                    )
                    if exists.scalar_one_or_none():
                        continue
                    db.add(
                        RainfallObs(
                            ts=ts,
                            zone_id=zid,
                            rain_1h=float(mm),
                            rain_24h=r24,
                            rain_48h=r48,
                            rain_72h=r72,
                            rain_7d=r72,
                            eff_rain=eff,
                            # Open-Meteo serves volumetric water content (m3/m3,
                            # e.g. 0.386); the whole API + geotech read PERCENT
                            # (38.6). Same 100x conversion ml/ingest/weather.py
                            # does at its boundary — the worker must agree or
                            # FoS and the soil-moisture driver read nonsense.
                            soil_moisture=(float(sm) * 100.0) if (sm is not None and float(sm) <= 1.0) else sm,
                        )
                    )
                    written += 1
        await db.commit()
    return written


def _rolling_rows(tail: list[float], soil: list[float | None] | None):
    """Yield (mm, r24, r48, r72, eff, sm) per hour of the 72h tail.

    Same rolling-window math the per-zone poller used, hoisted out so the
    district loop stays readable.
    """
    for i, mm in enumerate(tail):
        idx = i
        r24 = round(sum(tail[max(0, idx - 23): idx + 1]), 2)
        r48 = round(sum(tail[max(0, idx - 47): idx + 1]), 2)
        r72 = round(sum(tail), 2)
        eff = round(sum(m * (0.5 ** (k / 48)) for k, m in enumerate(reversed(tail[: idx + 1]))), 2)
        sm = soil[idx] if soil and idx < len(soil) else None
        yield float(mm), r24, r48, r72, eff, sm


@celery_app.task(name="tasks.poll_rainfall")
def poll_rainfall():
    n = asyncio.run(_poll_all())
    log.info("rainfall poll wrote %s rows", n)
    return {"rows": n}
