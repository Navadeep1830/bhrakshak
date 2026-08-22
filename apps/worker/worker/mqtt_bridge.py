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

    async with SessionLocal() as db:
        zone_id = data.get("zone_id")
        if zone_id is not None:
            from app.models import Zone

            zid = await db.execute(select(Zone.id).where(Zone.zone_code == zone_id))
            zone_id = zid.scalar_one_or_none()
        db.add(
            SensorReading(
                sensor_id=data["sensor_id"],
                ts=datetime.now(timezone.utc),
                zone_id=zone_id,
                soil_moisture=data.get("soil_moisture"),
                rainfall_mm=data.get("rainfall_mm"),
                battery_pct=data.get("battery_pct"),
                extra={"topic": topic},
            )
        )
        await db.commit()
    await publish_live("sensor", {"topic": topic, **data})


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
