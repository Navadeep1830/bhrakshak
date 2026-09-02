"""test_lorawan_simulation.py - Automated Tests for Virtual LoRaWAN ESP32 Edge Sensor Simulation
SIH26001: Verifies telemetry payload structures, physical FoS calculation, and edge anomaly detection.
"""

import sys
from pathlib import Path
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from simulate_lorawan import VIRTUAL_FLEET, generate_sensor_telemetry, EdgeSensorNode


def test_lorawan_fleet_initialization():
    """Virtual LoRaWAN fleet must contain distinct stations across all 4 pilot districts."""
    assert len(VIRTUAL_FLEET) == 4
    districts = {node.district for node in VIRTUAL_FLEET}
    assert districts == {"Noney", "Aizawl", "Kohima", "East Khasi Hills"}
    for node in VIRTUAL_FLEET:
        assert node.dev_eui.startswith("A840411F")
        assert node.battery_mv >= 3300


def test_lorawan_baseline_telemetry_generation():
    """Baseline telemetry generation must output valid physical ranges without false alarms."""
    node = EdgeSensorNode("SENSOR-TEST-01", "tiltmeter", "ZN-TEST-01", "Aizawl", 23.73, 92.71, "A840411F1D82A999")
    payload = generate_sensor_telemetry(node, step_index=0, storm_surge=False)

    assert payload["sensor_id"] == "SENSOR-TEST-01"
    assert 0.0 <= payload["vwc_pct"] <= 100.0
    assert payload["pore_pressure_kpa"] >= 0.0
    assert "lora_metadata" in payload
    assert payload["lora_metadata"]["dev_eui"] == "A840411F1D82A999"
    assert payload["factor_of_safety"] >= 1.20


def test_lorawan_storm_surge_anomaly_detection():
    """Storm surge condition must trigger PORE_PRESSURE_SURGE and CRITICAL_FOS_FAILURE anomaly flags."""
    node = EdgeSensorNode("SENSOR-SURGE-01", "hybrid_geotech", "ZN-SURGE-01", "Noney", 24.81, 93.68, "A840411F1D82A888", base_pore_kpa=12.0)
    payload = generate_sensor_telemetry(node, step_index=3, storm_surge=True)

    assert "PORE_PRESSURE_SURGE" in payload["anomalies_detected"]
    assert "CRITICAL_FOS_FAILURE" in payload["anomalies_detected"]
    assert payload["factor_of_safety"] < 1.05


if __name__ == "__main__":
    test_lorawan_fleet_initialization()
    test_lorawan_baseline_telemetry_generation()
    test_lorawan_storm_surge_anomaly_detection()
    print("âœ… All LoRaWAN edge sensor simulation tests passed successfully.")




