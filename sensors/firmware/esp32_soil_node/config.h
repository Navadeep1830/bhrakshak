#pragma once
// BhuRakshak ESP32 Soil Node — compile-time defaults (overridable via WiFiManager portal)

// WiFi / MQTT (env in production: inject via platformio.ini build_flags or WiFiManager)
#define WIFI_SSID           "BhuRakshak-Field"
#define WIFI_PASS           "bhrakshak123"
#define MQTT_HOST           "192.168.1.50"   // mosquitto ip — set to your pi / docker host
#define MQTT_PORT           1883
#define MQTT_USER           ""
#define MQTT_PASS           ""

// Node identity — flash one sketch per zone, or set via serial `id <zone_code> <sensor_id>`
#define DEFAULT_ZONE_CODE   "ML-EKH-004"
#define DEFAULT_DISTRICT    "East Khasi Hills"
#define DEFAULT_SENSOR_ID   "EKH-04-S01"

// Pins (ESP32-WROOM-32)
#define PIN_SOIL_AO         34   // capacitive soil moisture AO -> ADC1_CH6 (input only)
#define PIN_PORE_AO         35   // pore pressure transducer 0.5-4.5V -> ADC1_CH7
#define PIN_BATTERY_AO      32   // voltage divider -> ADC1_CH4
#define PIN_RAIN_IRQ        27   // tipping bucket reed switch -> GPIO27 (pullup, interrupt)
#define PIN_MPU_SDA         21
#define PIN_MPU_SCL         22
#define PIN_STATUS_LED      2
#define PIN_SIREN_RELAY     26   // optional local siren relay (active high)

// Calibration — tune per sensor deployment, stored in NVS after field cal
#define SOIL_DRY_RAW        2950  // ADC reading in dry air
#define SOIL_WET_RAW        1350  // ADC reading in saturated soil (in water)
#define PORE_V_MIN          0.5   // transducer V at 0 kPa
#define PORE_V_MAX          4.5   // transducer V at 50 kPa
#define PORE_KPA_MAX        50.0
#define BATTERY_DIVIDER     2.0   // R1=R2=100k => /2
#define BATTERY_V_MAX       4.2
#define BATTERY_V_MIN       3.2

// Telemetry cadence
#define TELEMETRY_INTERVAL_MS  900000UL   // 15 min (matches risk_engine + Celery beat)
#define DEEP_SLEEP_ENABLE     0          // 1 = deep sleep between publishes (battery masts)
#define WATCHDOG_TIMEOUT_S    60

// Tilt thresholds forwarded as triggers (also computed server-side in geotech.py)
#define TILT_ALERT_DEG        1.0
