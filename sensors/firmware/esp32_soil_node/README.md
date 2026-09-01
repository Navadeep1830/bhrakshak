# BhuRakshak ESP32 Soil Node (SIH26001)

**What it does:** Capacitive soil moisture + pore-pressure transducer + tilt (MPU6050) + tipping-bucket rain gauge → ESP32 → MQTT `sensors/#` → `sensor_readings` hypertable → geotech FoS.

### Wiring
| Signal | ESP32 pin | Notes |
|---|---|---|
| Soil AO | GPIO34 | Capacitive v1.2, 3.3V |
| Pore AO | GPIO35 | 0.5–4.5V transducer via 10k/20k divider to 3.3V |
| Battery | GPIO32 | 100k/100k divider from 1S Li-ion |
| Rain reed | GPIO27 | to GND, `INPUT_PULLUP` |
| MPU6050 | SDA 21 / SCL 22 | 3.3V |
| Status LED | GPIO2 | blink = tx ok, 3× blink = tilt alarm |
| Siren relay | GPIO26 | active-high, drive via NPN |

### Flash
- Arduino IDE board: ESP32 Dev Module, install `PubSubClient`, `ArduinoJson` (v6), `MPU6050` (ElectronicCats)
- Edit `config.h` `MQTT_HOST` to your Mosquitto host IP (not `localhost` from ESP32), or use WiFiManager portal
- Flash, open Serial 115200:
  ```
  id ML-EKH-004 EKH-04-S01 East Khasi Hills
  status
  tx
  ```

### Payload (matches `apps/worker/worker/mqtt_bridge.py`)
```json
{"sensor_id":"EKH-04-S01","zone_id":"ML-EKH-004","district":"East Khasi Hills",
 "soil_moisture":42.3,"pore_pressure_kpa":12.4,"tilt_x_deg":1.2,"tilt_y_deg":-0.8,
 "tilt_rate_deg_h":0.45,"rainfall_mm":4.2,"battery_pct":87,"fw":"esp32-v1.2"}
```

### Calibration
- Soil: place in dry air note `raw`, in water note `raw`, update `SOIL_DRY_RAW` / `SOIL_WET_RAW` in `config.h` then reflash or `prefs.putInt()`
- Pore: apply known 0 / 25 / 50 kPa, adjust `PORE_V_MIN/MAX`
- Battery: measure actual `volts` vs `raw`, adjust `BATTERY_DIVIDER`

### Deployment
- 15-minute cadence `TELEMETRY_INTERVAL_MS` matches Celery `rainfall poll 15m` + `risk recompute 15m`
- For solar masts set `DEEP_SLEEP_ENABLE 1` and power via 18650 + TP4056
- LoRaWAN variant: see `../lorawan_soil_node/` for SX1276 (433 MHz) + The Things Network decoder
