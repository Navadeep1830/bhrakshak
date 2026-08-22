"""IoT soil-moisture sensor simulator: publishes JSON to MQTT sensors/# every 30s.

Usage: python sensor_simulator.py --host localhost --port 1883
Falls back to HTTP POST /ingest/sensors if paho-mqtt is unavailable.
"""

import argparse
import json
import random
import time
import urllib.request

ZONES = ["ML-EKH-004", "MZ-AIZ-007", "MN-NON-002", "SK-GNG-003"]


def make_payload(zone: str, i: int) -> dict:
    wet = 55 + 35 * ((i % 40) / 40) ** 2 + random.uniform(-3, 3)
    return {
        "sensor_id": f"soil-{zone.lower()}-01",
        "zone_id": zone,
        "soil_moisture": round(min(98.0, max(10.0, wet)), 1),
        "rainfall_mm": round(max(0.0, random.gauss(1.5, 2.0)), 2),
        "battery_pct": round(random.uniform(60, 100), 0),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--interval", type=int, default=30)
    args = ap.parse_args()

    try:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.connect(args.host, args.port, keepalive=60)
        client.loop_start()
        transport = "mqtt"
    except Exception as e:
        print(f"mqtt unavailable ({e}) - HTTP fallback to :8000")
        client = None
        transport = "http"

    print(f"simulating {len(ZONES)} sensors via {transport}, every {args.interval}s (Ctrl-C to stop)")
    i = 0
    while True:
        for zone in ZONES:
            payload = make_payload(zone, i)
            if client:
                client.publish(f"sensors/soil_moisture/{zone}", json.dumps(payload))
                print("MQTT ->", payload["sensor_id"], payload["soil_moisture"])
            else:
                req = urllib.request.Request(
                    "http://localhost:8000/api/v1/ingest/sensors",
                    data=json.dumps(payload).encode(),
                    headers={"Content-Type": "application/json"},
                )
                try:
                    urllib.request.urlopen(req, timeout=5)
                    print("HTTP ->", payload["sensor_id"], payload["soil_moisture"])
                except Exception as e:
                    print("send failed:", e)
        i += 1
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
