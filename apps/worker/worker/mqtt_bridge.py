"""MQTT bridge: subscribes to sensors/# on Mosquitto, validates JSON,
writes sensor_readings (hypertable), broadcasts to /ws/live.

Runs as a standalone process inside the worker container:
    python -m worker.mqtt_bridge
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import SensorReading
from app.services.risk_engine import publish_live

log = logging.getLogger("bhrakshak.mqtt")

TOPIC_FILTER = "sensors/#"


async def handle_message(topic: str, payload: bytes) -> None:
    try:
        data = json.loads(payload)
        assert isinstance(data.get("sensor_id"), str)
    except Exception as e:
        log.warning("bad payload on %s: %s", topic, e)
        return

    from app.services.geotech import calculate_factor_of_safety

    async with SessionLocal() as db:
        zone_id = data.get("zone_id")
        z_obj = None
        if zone_id is not None:
            from app.models import Zone

            res = await db.execute(select(Zone).where(Zone.zone_code == zone_id))
            z_obj = res.scalar_one_or_none()
            zone_id_uuid = z_obj.id if z_obj else None
        else:
            zone_id_uuid = None

        # Geotechnical Parameter Extraction
        soil_m = data.get("soil_moisture") or data.get("vwc_pct")
        pore_p = data.get("pore_pressure_kpa") or data.get("pore_kpa")
        tilt_x = data.get("tilt_x_deg")
        tilt_y = data.get("tilt_y_deg")
        tilt_rate = data.get("tilt_rate_deg_h")
        slope_angle = float(z_obj.susc_mean * 0.6 if z_obj and z_obj.susc_mean else 35.0)

        fos = calculate_factor_of_safety(
            slope_angle_deg=slope_angle,
            pore_pressure_kpa=pore_p,
            volumetric_water_content=soil_m,
        )

        extra_data = {
            "topic": topic,
            "pore_pressure_kpa": pore_p,
            "tilt_x_deg": tilt_x,
            "tilt_y_deg": tilt_y,
            "tilt_rate_deg_h": tilt_rate,
            "factor_of_safety": fos,
        }

        db.add(
            SensorReading(
                sensor_id=data["sensor_id"],
                ts=datetime.now(timezone.utc),
                zone_id=zone_id_uuid,
                soil_moisture=float(soil_m) if soil_m is not None else None,
                rainfall_mm=float(data["rainfall_mm"]) if "rainfall_mm" in data else None,
                battery_pct=float(data["battery_pct"]) if "battery_pct" in data else None,
                extra=extra_data,
            )
        )
        await db.commit()

    # Live Pub/Sub broadcast
    await publish_live(
        "sensor",
        {
            "topic": topic,
            "factor_of_safety": fos,
            **data,
        },
    )

    # If Factor of Safety drops below critical threshold, broadcast urgent geotechnical alarm
    if fos < 1.30:
        await publish_live(
            "geotech_alarm",
            {
                "sensor_id": data["sensor_id"],
                "zone_code": data.get("zone_id"),
                "factor_of_safety": fos,
                "urgency": "IMMINENT SLIP FAILURE" if fos < 1.05 else "CRITICAL ACCELERATING CREEP",
                "pore_pressure_kpa": pore_p,
                "tilt_rate_deg_h": tilt_rate,
            },
        )


def run_bridge() -> None:
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        log.error("paho-mqtt not installed; bridge disabled")
        return

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def on_connect(client, userdata, flags, reason_code, properties=None):
        log.info("mqtt connected (%s), subscribing %s", reason_code, TOPIC_FILTER)
        client.subscribe(TOPIC_FILTER)

    def on_message(client, userdata, msg):
        loop.run_until_complete(handle_message(msg.topic, msg.payload))

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=60)
    log.info("bridge listening on %s:%s [%s]", settings.mqtt_host, settings.mqtt_port, TOPIC_FILTER)
    client.loop_forever()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_bridge()
