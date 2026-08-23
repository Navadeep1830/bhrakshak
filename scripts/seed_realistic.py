"""Realistic demo state: escalates a few zones, adds historical reports,
marks one road segment predicted_blocked. Run after make seed:
    docker compose -f infra/docker-compose.yml run --rm seed python /srv/scripts/seed_realistic.py
"""

import asyncio
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/srv/apps/api")

from geoalchemy2 import WKTElement  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.models import CitizenReport, RoadStatus, SensorReading, User, Zone  # noqa: E402

SENSORS_PER_DISTRICT = ["soil-01", "rain-02", "soil-03"]

CATEGORIES = ["crack", "slope_movement", "blocked_road", "past_slide", "water_seepage"]


async def main() -> None:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    rng = random.Random(42)

    async with Session() as db:
        zones = (await db.execute(select(Zone))).scalars().all()
        if not zones:
            print("no zones found - run seed.py first")
            return
        citizen = (await db.execute(select(User).where(User.role == "citizen"))).scalars().first()

        n_reports = 0
        for z in rng.sample(zones, min(30, len(zones))):
            c = db.execute(
                select(Zone.id).where(Zone.id == z.id)
            )
            centroid = None
            for _ in [c]:
                pass
            # random point inside zone bbox (demo-grade)
            minx, miny, maxx, maxy = 0, 0, 0, 0
            row = (await db.execute(
                __import__("sqlalchemy").text(
                    "SELECT ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom) FROM zones WHERE id = :i"
                ),
                {"i": str(z.id)},
            )).first()
            if row is None:
                continue
            minx, miny, maxx, maxy = map(float, row)
            lat = rng.uniform(miny + 0.005, maxy - 0.005)
            lon = rng.uniform(minx + 0.005, maxx - 0.005)
            exists = await db.get(CitizenReport, uuid.uuid5(uuid.NAMESPACE_URL, f"seed-{z.zone_code}"))
            if exists:
                continue
            db.add(
                CitizenReport(
                    id=uuid.uuid5(uuid.NAMESPACE_URL, f"seed-{z.zone_code}"),
                    author_id=citizen.id if citizen else None,
                    role="citizen",
                    category=rng.choice(CATEGORIES),
                    geom=WKTElement(f"POINT({lon} {lat})", srid=4326),
                    description="Seeded demo report",
                    media_refs=[],
                    taken_at=datetime.now(timezone.utc) - timedelta(hours=rng.randint(1, 72)),
                    status="pending" if rng.random() < 0.7 else "verified",
                    exif_geo_ok=True,
                )
            )
            n_reports += 1

        # mark one road as predicted_blocked for the detour demo
        road = (await db.execute(select(RoadStatus).where(RoadStatus.osm_way_id == 900000002))).scalar_one_or_none()
        if road and road.status == "open":
            road.status = "predicted_blocked"
            road.delay_min = 47
            print("road NH-6 Shillong-Sohra -> predicted_blocked (+47 min detour)")

        # IoT sensor fleet: recent readings so the ops KPI is alive
        n_sensors = 0
        now = datetime.now(timezone.utc)
        seen = set()
        for z in zones[:12]:
            for tag in SENSORS_PER_DISTRICT:
                sid = f"{tag}-{z.zone_code.lower()}"
                if sid in seen:
                    continue
                seen.add(sid)
                for mins_ago in (2, 6, 14):
                    db.add(SensorReading(
                        sensor_id=sid,
                        ts=now - timedelta(minutes=mins_ago),
                        zone_id=z.id,
                        soil_moisture=round(rng.uniform(38, 92), 1),
                        rainfall_mm=round(max(0.0, rng.gauss(1.8, 2.2)), 2),
                        battery_pct=float(rng.randint(58, 100)),
                    ))
                n_sensors += 1

        await db.commit()
        print(f"inserted {n_reports} realistic reports + {n_sensors} simulated IoT sensors")


if __name__ == "__main__":
    asyncio.run(main())
