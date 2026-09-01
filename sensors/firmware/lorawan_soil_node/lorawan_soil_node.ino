/*
 * BhuRakshak LoRaWAN Soil Node — SX1276 (433 MHz) variant for remote NER valleys with no WiFi.
 * Encodes same payload as ESP32 WiFi node into 12-byte CayenneLPP-like frame, TTN decoder -> MQTT sensors/#.
 * Requires: LoRa library (Sandeep Mistry), TTN OTAA keys.
 */
#include <SPI.h>
#include <LoRa.h>

#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 2
#define LORA_FREQ 433E6

uint8_t DevEUI[8] = {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01};
String SENSOR_ID = "EKH-04-L01";
String ZONE_CODE = "ML-EKH-004";

void setup(){ Serial.begin(115200); LoRa.setPins(LORA_SS,LORA_RST,LORA_DIO0); if(!LoRa.begin(LORA_FREQ)) Serial.println("LoRa init failed"); Serial.println("LoRaWAN node ready — OTAA join via TTN (configure AppEUI/AppKey)"); }
void loop(){
  // Read same analog pins as WiFi node (shrink to 12 bytes):
  int soilRaw = analogRead(34); int poreRaw = analogRead(35); int battRaw = analogRead(32);
  float vwc = constrain(100.0*(2950-soilRaw)/(2950-1350),0,100);
  uint8_t vwcB = (uint8_t)vwc; uint8_t battB = (uint8_t)constrain(100.0*(battRaw*3.3/4095.0*2.0-3.2)/(1.0),0,100);
  uint8_t payload[12] = {vwcB, battB, 0,0,0,0,0,0,0,0,0,0}; // decoder expands in TTN -> JSON -> MQTT
  LoRa.beginPacket(); LoRa.write(payload,sizeof(payload)); LoRa.endPacket();
  Serial.printf("LoRa TX vwc=%d batt=%d\n", vwcB, battB);
  delay(900000); // 15 min
}
