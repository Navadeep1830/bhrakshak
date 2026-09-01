/*
 * BhuRakshak ESP32 Soil Node — SIH26001
 * Capacitive soil moisture + pore-pressure + tilt (MPU6050) + tipping-bucket rain
 * Publishes to Mosquitto topic: sensors/<district>/<zone_code>/<sensor_id>
 * Payload matches apps/worker/worker/mqtt_bridge.py:handle_message() schema:
 *   {sensor_id, zone_id, soil_moisture (vwc %), pore_pressure_kpa, tilt_x_deg, tilt_y_deg,
 *    tilt_rate_deg_h, rainfall_mm, battery_pct, vwc_raw, pore_raw, fw:"esp32-v1.2"}
 *
 * Wiring:
 *  Soil AO  -> GPIO34 (ADC, 3.3V, GND)  capacitive v1.2
 *  Pore AO  -> GPIO35 via 5V->3.3 divider (if 5V transducer, use 10k/20k divider)
 *  Battery  -> GPIO32 via 100k/100k divider from 18650
 *  Rain IRQ -> GPIO27 reed switch to GND (INPUT_PULLUP) + 0.1uF debounce
 *  MPU6050  -> SDA 21 / SCL 22 / VCC 3.3V
 *  LED      -> GPIO2 (status blink = publish ok, 3x blink = tilt alarm)
 *
 * Setup:
 *  1. Arduino IDE: Board ESP32 Dev Module, install PubSubClient, ArduinoJson, MPU6050 (ElectronicCats), WiFiManager
 *  2. Update config.h MQTT_HOST to your Mosquitto host (docker host IP, not localhost)
 *  3. Flash, open Serial 115200, type:  id ML-EKH-004 EKH-04-S01   (saves to NVS)
 *  4. Verify in Flower / DB: select * from sensor_readings order by ts desc limit 5;
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "config.h"

// ---------- globals ----------
Preferences prefs;
WiFiClient espClient;
PubSubClient mqtt(espClient);

volatile unsigned long rainTips = 0;
unsigned long lastRainTs = 0;
float lastTiltX = 0, lastTiltY = 0;
unsigned long lastTiltTs = 0;

String g_zoneCode = DEFAULT_ZONE_CODE;
String g_sensorId = DEFAULT_SENSOR_ID;
String g_district = DEFAULT_DISTRICT;

// ---------- ISR ----------
void IRAM_ATTR rainISR() {
  unsigned long now = millis();
  if (now - lastRainTs > 300) { // 300ms debounce (tipping bucket ~0.2mm/tip)
    rainTips++;
    lastRainTs = now;
  }
}

// ---------- sensors ----------
float readSoilVWC() {
  const int N = 16;
  long sum = 0;
  for (int i=0;i<N;i++) { sum += analogRead(PIN_SOIL_AO); delay(2); }
  int raw = sum / N;
  // map dry..wet raw -> 0..100% VWC, clamp
  float vwc = 100.0 * (SOIL_DRY_RAW - raw) / float(SOIL_DRY_RAW - SOIL_WET_RAW);
  return constrain(vwc, 0, 100);
}

float readPorePressureKpa() {
  const int N = 12;
  long sum = 0;
  for (int i=0;i<N;i++) { sum += analogRead(PIN_PORE_AO); delay(2); }
  int raw = sum / N;
  float volts = raw * 3.3 / 4095.0;
  // if using 5V transducer with divider, correct scale — here assume direct 0.5-4.5 mapped to 0-3.3 after divider
  // For 5V transducer with 2/3 divider: volts_actual = volts * 1.5
  #if 1
    volts = volts * 1.5; // undo external divider if present
  #endif
  if (volts < PORE_V_MIN) return 0;
  if (volts > PORE_V_MAX) volts = PORE_V_MAX;
  float kpa = (volts - PORE_V_MIN) / (PORE_V_MAX - PORE_V_MIN) * PORE_KPA_MAX;
  return kpa;
}

float readBatteryPct() {
  int raw = analogRead(PIN_BATTERY_AO);
  float volts = raw * 3.3 / 4095.0 * BATTERY_DIVIDER;
  float pct = 100.0 * (volts - BATTERY_V_MIN) / (BATTERY_V_MAX - BATTERY_V_MIN);
  return constrain(pct, 0, 100);
}

// MPU6050 simple tilt from accel (no DMP to keep code small)
bool readTilt(float &tiltX, float &tiltY) {
  Wire.beginTransmission(0x68);
  Wire.write(0x3B); // ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom((uint8_t)0x68, (uint8_t)6, true);
  if (Wire.available() < 6) return false;
  int16_t ax = (Wire.read()<<8)|Wire.read();
  int16_t ay = (Wire.read()<<8)|Wire.read();
  int16_t az = (Wire.read()<<8)|Wire.read();
  // tilt relative to gravity
  float axg = ax / 16384.0, ayg = ay / 16384.0, azg = az / 16384.0;
  tiltX = atan2(ayg, azg) * 57.2958;
  tiltY = atan2(-axg, sqrt(ayg*ayg + azg*azg)) * 57.2958;
  return true;
}

// ---------- WiFi / MQTT ----------
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[WiFi] connecting to %s", WIFI_SSID);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) { delay(500); Serial.print("."); tries++; }
  if (WiFi.status()==WL_CONNECTED) Serial.printf("\n[WiFi] ok ip=%s rssi=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else Serial.println("\n[WiFi] FAILED — will retry next cycle");
}

void connectMQTT() {
  if (mqtt.connected()) return;
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  String clientId = "bhrakshak-" + g_sensorId + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.printf("[MQTT] connect %s:%d as %s\n", MQTT_HOST, MQTT_PORT, clientId.c_str());
  bool ok = strlen(MQTT_USER) ? mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)
                              : mqtt.connect(clientId.c_str());
  if (ok) Serial.println("[MQTT] connected");
  else Serial.printf("[MQTT] failed rc=%d — will use HTTP fallback\n", mqtt.state());
}

void publishTelemetry() {
  float vwc = readSoilVWC();
  float pore = readPorePressureKpa();
  float batt = readBatteryPct();
  float tx, ty;
  bool hasTilt = readTilt(tx, ty);
  float tiltRate = 0;
  if (hasTilt && lastTiltTs) {
    float dtH = (millis() - lastTiltTs) / 3600000.0;
    if (dtH > 0.001) tiltRate = (abs(tx-lastTiltX)+abs(ty-lastTiltY))/2.0 / dtH;
  }
  if (hasTilt) { lastTiltX=tx; lastTiltY=ty; lastTiltTs=millis(); }

  // rainfall_mm = tips * 0.2mm per tip (standard 8" gauge) since last publish
  static unsigned long lastTips = 0;
  unsigned long tipsNow = rainTips;
  float rainMm = (tipsNow - lastTips) * 0.2;
  lastTips = tipsNow;

  // also read raw for debug
  int rawSoil = analogRead(PIN_SOIL_AO);
  int rawPore = analogRead(PIN_PORE_AO);

  char topic[128];
  snprintf(topic, sizeof(topic), "sensors/%s/%s/%s", g_district.c_str(), g_zoneCode.c_str(), g_sensorId.c_str());
  // mosquitto acl uses sensors/# so any subtopic works; keep canonical sensors/<zone>/<sensor>
  // bridge subscribes sensors/# and reads zone_id from JSON, so topic is informative only
  char topic2[96];
  snprintf(topic2, sizeof(topic2), "sensors/%s/%s", g_zoneCode.c_str(), g_sensorId.c_str());

  StaticJsonDocument<512> doc;
  doc["sensor_id"] = g_sensorId;
  doc["zone_id"] = g_zoneCode;
  doc["district"] = g_district;
  doc["soil_moisture"] = round(vwc*10)/10.0;
  doc["vwc_pct"] = round(vwc*10)/10.0;
  doc["pore_pressure_kpa"] = round(pore*10)/10.0;
  doc["pore_kpa"] = round(pore*10)/10.0;
  if (hasTilt) { doc["tilt_x_deg"] = round(tx*10)/10.0; doc["tilt_y_deg"] = round(ty*10)/10.0; doc["tilt_rate_deg_h"] = round(tiltRate*100)/100.0; }
  doc["rainfall_mm"] = round(rainMm*10)/10.0;
  doc["battery_pct"] = round(batt);
  doc["vwc_raw"] = rawSoil;
  doc["pore_raw"] = rawPore;
  doc["rain_tips"] = (int)(tipsNow);
  doc["fw"] = "esp32-v1.2";
  doc["rssi"] = WiFi.RSSI();

  char payload[512];
  size_t n = serializeJson(doc, payload, sizeof(payload));

  // try MQTT first
  bool published = false;
  if (mqtt.connected()) {
    published = mqtt.publish(topic2, payload, n);
    if (!published) published = mqtt.publish(topic, payload, n);
  }
  // HTTP fallback to /api/v1/ingest/sensor (ingest.py) when MQTT down
  if (!published) {
    Serial.println("[HTTP fallback] MQTT not connected — POST to /api/v1/ingest/sensor would go here (requires WiFi)");
    // Example: HTTPClient http; http.begin(String("http://")+MQTT_HOST+":8000/api/v1/ingest/sensor"); http.addHeader("Content-Type","application/json"); http.POST(payload);
  }

  Serial.printf("[TX] %s -> %s  vwc=%.1f%% pore=%.1f kPa tilt=%.1f/%.1f rate=%.2f rain=%.1f batt=%.0f%% rssi=%d %s\n",
    topic2, payload, vwc, pore, hasTilt?tx:0, hasTilt?ty:0, tiltRate, rainMm, batt, WiFi.RSSI(), published?"MQTT OK":"QUEUED");

  // status LED + local siren
  if (abs(tiltRate) >= TILT_ALERT_DEG) {
    for(int i=0;i<3;i++){ digitalWrite(PIN_STATUS_LED,HIGH); delay(120); digitalWrite(PIN_STATUS_LED,LOW); delay(120); }
    digitalWrite(PIN_SIREN_RELAY, HIGH); // could trigger field siren if level>=3 per geotech
  } else {
    digitalWrite(PIN_STATUS_LED, HIGH); delay(80); digitalWrite(PIN_STATUS_LED, LOW);
  }
}

void handleSerial() {
  if (!Serial.available()) return;
  String s = Serial.readStringUntil('\n'); s.trim();
  if (s.startsWith("id ")) {
    // id <zone_code> <sensor_id> [district]
    int p1 = s.indexOf(' ',3), p2 = s.indexOf(' ', p1+1);
    if (p1>0) {
      g_zoneCode = s.substring(3, p1);
      if (p2>0) { g_sensorId = s.substring(p1+1, p2); g_district = s.substring(p2+1); }
      else g_sensorId = s.substring(p1+1);
      prefs.putString("zone", g_zoneCode);
      prefs.putString("sensor", g_sensorId);
      prefs.putString("district", g_district);
      Serial.printf("[NVS] saved zone=%s sensor=%s district=%s\n", g_zoneCode.c_str(), g_sensorId.c_str(), g_district.c_str());
    }
  } else if (s=="status") {
    Serial.printf("zone=%s sensor=%s district=%s tips=%lu free=%u\n", g_zoneCode.c_str(), g_sensorId.c_str(), g_district.c_str(), rainTips, ESP.getFreeHeap());
  } else if (s=="tx") {
    publishTelemetry();
  }
  else Serial.println("cmds: id <zone_code> <sensor_id> [district] | status | tx");
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== BhuRakshak ESP32 Soil Node v1.2 ===");
  pinMode(PIN_RAIN_IRQ, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_SIREN_RELAY, OUTPUT);
  digitalWrite(PIN_SIREN_RELAY, LOW);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  prefs.begin("bhrakshak", false);
  g_zoneCode = prefs.getString("zone", g_zoneCode);
  g_sensorId = prefs.getString("sensor", g_sensorId);
  g_district = prefs.getString("district", g_district);
  Serial.printf("[NVS] zone=%s sensor=%s district=%s\n", g_zoneCode.c_str(), g_sensorId.c_str(), g_district.c_str());

  Wire.begin(PIN_MPU_SDA, PIN_MPU_SCL);
  // wake MPU6050
  Wire.beginTransmission(0x68); Wire.write(0x6B); Wire.write(0x00); Wire.endTransmission(true);
  delay(100);

  attachInterrupt(digitalPinToInterrupt(PIN_RAIN_IRQ), rainISR, FALLING);

  // watchdog 60s
  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

  connectWiFi();
  connectMQTT();
  lastTiltTs = millis();
  Serial.println("Type `id <zone> <sensor>` to set identity, `tx` to force publish");
}

void loop() {
  esp_task_wdt_reset();
  handleSerial();
  mqtt.loop();

  static unsigned long lastTx = 0;
  unsigned long now = millis();

  // keep WiFi/MQTT alive
  if (WiFi.status()!=WL_CONNECTED && now-lastTx>10000) connectWiFi();
  if (!mqtt.connected() && WiFi.status()==WL_CONNECTED) connectMQTT();

  if (now - lastTx >= TELEMETRY_INTERVAL_MS) {
    publishTelemetry();
    lastTx = now;
#if DEEP_SLEEP_ENABLE
    Serial.printf("[SLEEP] deep sleep %lu ms\n", TELEMETRY_INTERVAL_MS);
    esp_sleep_enable_timer_wakeup(TELEMETRY_INTERVAL_MS*1000ULL);
    esp_deep_sleep_start();
#endif
  }
  delay(200);
}
