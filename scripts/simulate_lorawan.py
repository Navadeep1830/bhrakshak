#!/usr/bin/env python3
"""scripts/simulate_lorawan.py - Virtual ESP32 / LoRaWAN Edge Geotechnical Sensor Simulator
SIH26001: Publishes bi-axial tiltmeter, vibrating wire piezometer & VWC telemetry over MQTT with edge anomaly detection.
"""

import argparse
import datetime
import json
import math
import random
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "apps" / "api"))

try:
    from app.services.geotech import calculate_factor_of_safety, check_rainfall_id_exceedance
except ImportError:
    def calculate_factor_of_safety(slope_angle_deg, pore_pressure_kpa=0.0, volumetric_water_content=50.0):
        beta = math.radians(slope_angle_deg)
        gamma, z, c, phi = 19.5, 3.2, 14.0, math.radians(31.0)
        sigma = max(0.1, gamma * z * (math.cos(beta) ** 2) - pore_pressure_kpa)
        resisting = c + sigma * math.tan(phi)
        driving = gamma * z * math.sin(beta) * math.cos(beta)
        return round(resisting / driving, 2)


@dataclass
class EdgeSensorNode:
    sensor_id: str
    sensor_type: str  # "tiltmeter", "piezometer", "soil_moisture", "hybrid_geotech"
    zone_id: str
    district: str
    lat: float
    lon: float
    dev_eui: str
    battery_mv: int = 3700
    base_tilt_x: float = 0.5
    base_tilt_y: float = -0.2
    base_pore_kpa: float = 4.0
    base_vwc_pct: float = 55.0
    f_cnt: int = 0


VIRTUAL_FLEET = [
    EdgeSensorNode("SENSOR-TUPUL-TILT-01", "hybrid_geotech", "ZN-TUPUL-01", "Noney", 24.8105, 93.6820, "A840411F1D82A001", base_pore_kpa=8.5, base_vwc_pct=68.0),
    EdgeSensorNode("SENSOR-AIZAWL-PIEZO-02", "piezometer", "ZN-AIZ-04", "Aizawl", 23.7325, 92.7155, "A840411F1D82A002", base_pore_kpa=6.0, base_vwc_pct=62.0),
    EdgeSensorNode("SENSOR-KOHIMA-VWC-03", "soil_moisture", "ZN-KOH-02", "Kohima", 25.6650, 94.1005, "A840411F1D82A003", base_pore_kpa=3.5, base_vwc_pct=50.0),
    EdgeSensorNode("SENSOR-SHILLONG-TILT-04", "tiltmeter", "ZN-EKH-01", "East Khasi Hills", 25.2810, 91.7210, "A840411F1D82A004", base_pore_kpa=5.0, base_vwc_pct=58.0),
]


def generate_sensor_telemetry(node: EdgeSensorNode, step_index: int, storm_surge: bool = False) -> dict:
    """Generates realistic LoRaWAN edge sensor packet with geotechnical physical metrics."""
    node.f_cnt += 1
    # Battery slow discharge with solar recharge jitter
    node.battery_mv = max(3100, min(4150, node.battery_mv + random.randint(-4, 3)))
    
    # Atmospheric & geotechnical progression
    t_factor = math.sin(step_index * 0.15)
    noise = random.uniform(-0.15, 0.15)
    
    if storm_surge:
        # Rapid storm saturation surge
        pore_pressure = node.base_pore_kpa + 14.5 + (step_index * 0.8) + noise
        vwc = min(98.5, node.base_vwc_pct + 28.0 + (step_index * 0.5) + noise)
        tilt_x = node.base_tilt_x + (step_index * 0.18) + (noise * 0.2)
        tilt_y = node.base_tilt_y + (step_index * 0.12) + (noise * 0.2)
        tilt_rate = 0.45 + (step_index * 0.08) + abs(noise * 0.1)
    else:
        pore_pressure = max(0.5, node.base_pore_kpa + t_factor * 2.0 + noise)
        vwc = max(30.0, min(95.0, node.base_vwc_pct + t_factor * 8.0 + noise * 2))
        tilt_x = node.base_tilt_x + noise * 0.05
        tilt_y = node.base_tilt_y + noise * 0.05
        tilt_rate = abs(noise * 0.04)

    # Limit-Equilibrium Factor of Safety calculation
    fos = calculate_factor_of_safety(
        slope_angle_deg=35.0,
        pore_pressure_kpa=pore_pressure,
        volumetric_water_content=vwc,
    )
    
    # Edge Anomaly Flags
    anomalies = []
    if pore_pressure >= 18.0:
        anomalies.append("PORE_PRESSURE_SURGE")
    if tilt_rate >= 0.50:
        anomalies.append("TILT_ACCELERATION_BREACH")
    if fos < 1.15:
        anomalies.append("CRITICAL_FOS_FAILURE")
    if node.battery_mv < 3350:
        anomalies.append("LOW_BATTERY_WARNING")

    rssi = random.randint(-118, -85)
    snr = round(random.uniform(-9.0, 8.5), 1)

    return {
        "sensor_id": node.sensor_id,
        "sensor_type": node.sensor_type,
        "zone_id": node.zone_id,
        "district": node.district,
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "lat": node.lat,
        "lon": node.lon,
        "pore_pressure_kpa": round(pore_pressure, 2),
        "soil_moisture": round(vwc, 1),
        "vwc_pct": round(vwc, 1),
        "tilt_x_deg": round(tilt_x, 3),
        "tilt_y_deg": round(tilt_y, 3),
        "tilt_rate_deg_h": round(tilt_rate, 3),
        "factor_of_safety": fos,
        "battery_mv": node.battery_mv,
        "lora_metadata": {
            "dev_eui": node.dev_eui,
            "f_cnt": node.f_cnt,
            "rssi_dbm": rssi,
            "snr_db": snr,
            "gateway_id": f"GW-{node.district[:3].upper()}-01",
        },
        "anomalies_detected": anomalies,
    }


def run_lorawan_simulation(
    broker="localhost",
    port=1883,
    topic="sensors/lorawan/telemetry",
    iterations=12,
    interval=0.5,
    storm_surge=False,
    export_json=None,
):
    """Executes live simulation of LoRaWAN edge gateway telemetry publishing."""
    print("=" * 80)
    print("📡  BHURAKSHAK VIRTUAL LoRaWAN / ESP32 EDGE TELEMETRY SIMULATOR")
    print(f"    Broker: {broker}:{port} | Topic: {topic}")
    print(f"    Nodes: {len(VIRTUAL_FLEET)} active geotechnical stations | Storm Surge: {storm_surge}")
    print("=" * 80)

    mqtt_client = None
    try:
        import paho.mqtt.client as mqtt
        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="bhrakshak_lora_sim")
        mqtt_client.connect(broker, port, keepalive=60)
        mqtt_client.loop_start()
        print("✅ Connected to MQTT Broker successfully.\n")
    except Exception as e:
        print(f"ℹ️  MQTT Broker offline ({e}) - Running in local telemetry verification mode.\n")

    records = []
    print("Iter | Station ID           | District    | Pore u  | VWC%  | Tilt X/Y  | FoS  | Anomaly Status")
    print("-" * 88)

    for i in range(iterations):
        for node in VIRTUAL_FLEET:
            payload = generate_sensor_telemetry(node, step_index=i, storm_surge=storm_surge)
            records.append(payload)
            
            # Publish to MQTT if client connected
            if mqtt_client:
                mqtt_client.publish(f"sensors/{node.sensor_id}", json.dumps(payload), qos=1)

            # Terminal HUD rendering
            anom_str = " | ".join(payload["anomalies_detected"]) if payload["anomalies_detected"] else "HEALTHY ✓"
            anom_icon = "🚨" if payload["anomalies_detected"] else "🟢"
            
            row = (
                f"{i+1:4d} | "
                f"{payload['sensor_id']:20s} | "
                f"{payload['district']:11s} | "
                f"{payload['pore_pressure_kpa']:5.1f}kPa | "
                f"{payload['vwc_pct']:4.1f}% | "
                f"{payload['tilt_x_deg']:+5.2f}/{payload['tilt_y_deg']:+5.2f}° | "
                f"{payload['factor_of_safety']:4.2f} | "
                f"{anom_icon} {anom_str[:22]}"
            )
            print(row)

        time.sleep(interval)

    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()

    if export_json:
        with open(export_json, "w") as f:
            json.dump(records, f, indent=2)
        print(f"\n📁 Exported {len(records)} LoRaWAN telemetry frames to {export_json}")

    print("\n" + "=" * 80)
    print(f"✅ LoRaWAN TELEMETRY SIMULATION COMPLETE: {len(records)} frames ingested.")
    print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Virtual LoRaWAN Geotechnical Sensor Simulator")
    parser.add_argument("--broker", type=str, default="localhost", help="MQTT Broker host")
    parser.add_argument("--port", type=int, default=1883, help="MQTT Broker port")
    parser.add_argument("--topic", type=str, default="sensors/lorawan/telemetry", help="MQTT Topic")
    parser.add_argument("--iterations", type=int, default=6, help="Number of telemetry cycles")
    parser.add_argument("--interval", type=float, default=0.1, help="Delay between cycles (seconds)")
    parser.add_argument("--storm", action="store_true", help="Inject rapid storm surge condition")
    parser.add_argument("--export-json", type=str, default=str(PROJECT_ROOT / "scripts" / "lorawan_telemetry.json"), help="Output JSON path")
    args = parser.parse_args()

    run_lorawan_simulation(
        broker=args.broker,
        port=args.port,
        topic=args.topic,
        iterations=args.iterations,
        interval=args.interval,
        storm_surge=args.storm,
        export_json=args.export_json,
    )
