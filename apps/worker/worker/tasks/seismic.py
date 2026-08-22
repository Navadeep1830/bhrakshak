import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import SeismicEvent
from worker.celery_app import celery_app

log = logging.getLogger("bhrakshak.seismic")

# Pilot district centroids for proximity trigger checks
PILOT_CENTROIDS = [
    ("Aizawl", 23.73, 92.72),
    ("East Khasi Hills", 25.45, 91.60),
    ("Noney", 25.00, 93.80),
    ("Imphal West", 24.82, 93.94),
    ("Gangtok", 27.42, 88.55),
]


@celery_app.task(name="tasks.poll_seismic")
def poll_seismic():
    """USGS FDSN: M>=4 within 100km of pilot zones in last 7 days -> trigger flag."""
    async def _run():
        now = datetime.now(timezone.utc)
        params = {
            "format": "geojson", "starttime": (now - timedelta(days=7)).strftime("%Y-%m-%d"),
            "minmagnitude": 4.0,
            "latitude": 25.5, "longitude": 91.5, "maxradiuskm": 800,
        }
        events = []
        if not settings.fixture_mode:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    r = await client.get("https://earthquake.usgs.gov/fdsnws/event/1/query", params=params)
                    r.raise_for_status()
                    events = r.json().get("features", [])
            except Exception as e:
                log.warning("USGS fetch failed: %s", e)
        n_flagged = 0
        async with SessionLocal() as db:
            for f in events:
                eid = f["id"]
                lon, lat, depth = f["geometry"]["coordinates"][:3]
                mag = f["properties"]["mag"] or 0
                occurred = datetime.fromtimestamp(f["properties"]["time"] / 1000, tz=timezone.utc)
                near = any(_haversine_km(lat, lon, la, lo) <= 100 and mag >= 4 for _, la, lo in PILOT_CENTROIDS)
                exists = await db.get(SeismicEvent, eid)
                if exists:
                    continue
                db.add(SeismicEvent(id=eid, magnitude=mag, lon=lon, lat=lat, depth_km=depth,
                                    occurred_at=occurred, trigger_flag=near))
                n_flagged += int(near)
            await db.commit()
        return {"events": len(events), "flagged": n_flagged}

    result = asyncio.run(_run())
    log.info("seismic poll: %s", result)
    return result


def _haversine_km(lat1, lon1, lat2, lon2):
    from math import asin, cos, radians, sin, sqrt

    R = 6371
    p1, p2 = radians(lat1), radians(lat2)
    a = sin(radians(lat2 - lat1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * R * asin(sqrt(a))


@celery_app.task(name="tasks.satellite_etl")
def satellite_etl():
    """Placeholder hook: Sentinel-2/WorldCover refresh -> ml/ingest pipeline.
    Real implementation lands with the ML phase (see ml/ingest)."""
    log.info("satellite ETL tick - delegate to ml pipeline")
    return {"status": "noop"}
