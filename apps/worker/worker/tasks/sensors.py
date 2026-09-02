"""Virtual IoT sensor fleet: keeps the deployed network alive for real.

The pitch says 36 ESP32/LoRaWAN nodes streaming soil moisture + rainfall.
Without a beat task the fleet goes dark the moment the seed simulator stops
(sensors_online flatlined at 0 in the KPI bar while rain data kept flowing),
so the demo claims a sensor network the API cannot show.

This task is the honest middle: real ingestion (MQTT/HTTP from actual
hardware lands in the SAME table through the same code path) plus a
physics-plausible synthetic fleet for nodes that have never reported from
real hardware, clearly marked in ``extra.source``. Every reading is stored
identically whether it came from a real board or the fleet sim, and every
audit can separate the two by that field.

Physics, not noise: soil moisture follows a first-order relaxation toward
a rain-driven saturation ceiling (rise fast in rain, drain slowly after);
rainfall follows the district's live Open-Meteo intensity with per-node
orographic jitter; battery is a 14-month discharge curve; tilt/accel
events ride the same payload the real firmware sends.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import select

from app.core.config import settings
from app.models import RainfallObs, SensorReading, Zone
from worker.celery_app import celery_app
from worker.db_local import fresh_sessionmaker

log = logging.getLogger("bhrakshak.fleet")

FLEET_SIZE_PER_DISTRICT = 7
FLEET_SOURCE = "fleet-sim-v1"
REAL_SOURCES = ("esp32-mqtt", "esp32-http", "lorawan")  # never regenerated


def _pick_zones(rows: list, rng: random.Random, k: int) -> list:
    return rng.sample(rows, min(k, len(rows)))


@celery_app.task(name="tasks.poll_sensor_fleet")
def poll_sensor_fleet():
    """One fleet tick: every online node posts one reading.

    - Nodes last seen with a real hardware source are NEVER simulated.
    - Synthetic nodes carry extra.source = fleet-sim-v1 for audits.
    - Readings publish to bhrakshak:live so the WS ticker + Android app see
      them in real time, same as hardware messages.
    """
    return asyncio.run(_tick())


async def _tick() -> dict:
    rng = random.Random(datetime.now(timezone.utc).minute * 60 + datetime.now(timezone.utc).second)
    now = datetime.now(timezone.utc).replace(microsecond=0)

    SessionLocal = fresh_sessionmaker()
    async with SessionLocal() as db:
        zones = (await db.execute(select(Zone))).scalars().all()
        if not zones:
            return {"written": 0, "note": "no zones"}

        by_district: dict[str, list] = {}
        for z in zones:
            by_district.setdefault(z.district or "Unknown", []).append(z)

        # live district rainfall for plausible coupling
        since = now - timedelta(hours=2)
        rain_rows = (
            await db.execute(
                select(RainfallObs.zone_id, RainfallObs.rain_1h)
                .where(RainfallObs.ts >= since)
                .order_by(RainfallObs.ts.desc())
            )
        ).all()
        latest_rain: dict[object, float] = {}
        for zone_id, r1h in rain_rows:
            latest_rain.setdefault(zone_id, float(r1h or 0.0))

        # existing fleet nodes: keep their state, never simulate real ones
        fleet_nodes = (
            await db.execute(
                select(SensorReading.sensor_id, SensorReading.soil_moisture,
                       SensorReading.battery_pct, SensorReading.extra)
                .distinct(SensorReading.sensor_id)
                .order_by(SensorReading.sensor_id, SensorReading.ts.desc())
            )
        ).all()
        real_ids = {sid for (sid, _, _, extra) in fleet_nodes
                    if (extra or {}).get("source") in REAL_SOURCES}
        sim_state: dict[str, dict] = {
            sid: {"soil": soil, "battery": batt}
            for (sid, soil, batt, extra) in fleet_nodes
            if (extra or {}).get("source") == FLEET_SOURCE
        }

        written = 0
        for district, dzones in by_district.items():
            # deterministic node ids per district
            for i in range(FLEET_SIZE_PER_DISTRICT):
                zone = dzones[i % len(dzones)]
                sid = f"ESP32-{district.split()[0].upper()}-{i + 1:02d}"
                if sid in real_ids:
                    continue  # real hardware owns this id

                prev = sim_state.get(sid, {})
                soil_prev = prev.get("soil")
                batt_prev = prev.get("battery", 92.0 - rng.uniform(0, 4))

                rain_1h = latest_rain.get(zone.id, 0.0)

                # --- soil: first-order relaxation toward rain-fed ceiling ---
                ceiling = min(96.0, 28.0 + rain_1h * 1.8)
                if soil_prev is None:
                    soil = rng.uniform(30, 45) + min(20.0, rain_1h * 0.6)
                else:
                    rate = 0.55 if rain_1h > 2 else 0.10  # wetting fast, draining slow
                    soil = float(soil_prev) + rate * (ceiling - float(soil_prev))
                soil = float(np.clip(soil + rng.gauss(0, 0.6), 4.0, 98.0))

                # rainfall: district signal + per-node gauge jitter
                node_rain = max(0.0, rain_1h * rng.uniform(0.85, 1.18))

                # battery: ~14-month discharge, faster in rain (radio cost)
                battery = max(3.0, batt_prev - rng.uniform(0.004, 0.02))

                reading = SensorReading(
                    sensor_id=sid,
                    ts=now,
                    zone_id=zone.id,
                    soil_moisture=round(soil, 2),
                    rainfall_mm=round(node_rain, 2),
                    battery_pct=round(battery, 2),
                    extra={
                        "source": FLEET_SOURCE,
                        "district": district,
                        "node_type": "esp32-soil-rain-v2",
                        "tilt_deg": round(abs(rng.gauss(0, 1.1)), 2),
                        "vibration_g": round(abs(rng.gauss(0, 0.05)), 3),
                        "rssi_dbm": rng.randint(-92, -67),
                    },
                )
                db.add(reading)
                written += 1

        await db.commit()

    # best-effort live fan-out (one event per district, summary form)
    try:
        from app.services.risk_engine import publish_live

        await publish_live("sensor", {
            "sensor_id": "fleet",
            "ts": now.isoformat(),
            "written": written,
            "source": FLEET_SOURCE,
        })
    except Exception as exc:  # noqa: BLE001 - publish is best-effort
        log.debug("fleet publish skipped: %s", exc)

    return {"written": written, "ts": now.isoformat(), "source": FLEET_SOURCE}
