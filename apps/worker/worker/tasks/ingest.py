import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import SessionLocal
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

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    written = 0

    async with SessionLocal() as db:
        zone_rows = (
            await db.execute(
                select(
                    Zone,
                    gfunc.ST_Y(gfunc.ST_Centroid(Zone.geom)),
                    gfunc.ST_X(gfunc.ST_Centroid(Zone.geom)),
                )
            )
        ).all()

        for z, lat, lon in zone_rows:
            lat_f = float(lat) if lat is not None else None
            lon_f = float(lon) if lon is not None else None
            data = await _fetch_open_meteo(lat_f, lon_f) if lat_f and lon_f else None
            
            hourly: list[float]
            soil: list[float] | None = None
            if data and "hourly" in data:
                hourly = data["hourly"].get("precipitation") or []
                soil = data["hourly"].get("soil_moisture_3_to_9cm")
            else:
                hourly = _synthetic_hourly()
            if not hourly:
                continue

            tail = hourly[-72:]
            for i, mm in enumerate(tail):
                ts = now - timedelta(hours=len(tail) - 1 - i)
                idx = i
                r24 = round(sum(tail[max(0, idx - 23): idx + 1]), 2)
                r48 = round(sum(tail[max(0, idx - 47): idx + 1]), 2)
                r72 = round(sum(tail), 2)
                eff = round(sum(m * (0.5 ** (k / 48)) for k, m in enumerate(reversed(tail[: idx + 1]))), 2)
                sm = soil[idx] if soil and idx < len(soil) else None

                exists = await db.execute(
                    select(RainfallObs).where(RainfallObs.zone_id == z.id, RainfallObs.ts == ts)
                )
                if exists.scalar_one_or_none():
                    continue

                db.add(
                    RainfallObs(
                        ts=ts,
                        zone_id=z.id,
                        rain_1h=float(mm),
                        rain_24h=r24,
                        rain_48h=r48,
                        rain_72h=r72,
                        rain_7d=r72,
                        eff_rain=eff,
                        soil_moisture=sm,
                    )
                )
                written += 1
        await db.commit()
    return written


@celery_app.task(name="tasks.poll_rainfall")
def poll_rainfall():
    n = asyncio.run(_poll_all())
    log.info("rainfall poll wrote %s rows", n)
    return {"rows": n}
