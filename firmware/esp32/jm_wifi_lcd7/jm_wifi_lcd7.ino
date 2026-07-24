/*
 * BANKERO GASOLINE LCD-7 — MRP Vendo Cloud keepalive
 *
 * Dashboard: https://jmtechsolution.cloud/vendo-admin
 * ONLINE = GET /api/vendo/config every ~30s (last_seen < 2 min)
 *
 * Setup: copy config.h.example → config.h, then flash ESP32-S3.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "config.h"

#ifndef DEVICE_ID
#error Copy config.h.example to config.h and set DEVICE_ID + API_KEY
#endif

const unsigned long PING_MS = 30000;
const unsigned long WIFI_RETRY_MS = 15000;

unsigned long lastPing = 0;
unsigned long lastWifiTry = 0;

String apiUrl(const char* path) {
  return String("https://") + CLOUD_HOST + path;
}

bool wifiConnected() {
  return WiFi.status() == WL_CONNECTED;
}

bool connectWiFi() {
  if (wifiConnected()) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("WiFi connecting to SSID: %s\n", WIFI_SSID);
  for (int i = 0; i < 40 && !wifiConnected(); i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (wifiConnected()) {
    Serial.println("WiFi OK");
    Serial.println("  IP:   " + WiFi.localIP().toString());
    Serial.println("  RSSI: " + String(WiFi.RSSI()) + " dBm");
    return true;
  }
  Serial.printf("WiFi FAILED — check SSID/password (%s)\n", WIFI_SSID);
  return false;
}

bool vendoGetConfig() {
  if (!wifiConnected()) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(15000);
  http.begin(client, apiUrl("/api/vendo/config"));
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Api-Key", API_KEY);

  int code = http.GET();
  String body = (code > 0) ? http.getString() : "";
  Serial.printf("GET /api/vendo/config -> %d\n", code);
  if (code <= 0) {
    Serial.println(http.errorToString(code));
    http.end();
    return false;
  }
  http.end();

  if (code == 401) {
    Serial.println("ERROR: invalid DEVICE_ID or API_KEY");
    return false;
  }
  if (code != 200) {
    Serial.println("Response: " + body);
    return false;
  }

  StaticJsonDocument<512> doc;
  if (!deserializeJson(doc, body)) {
    Serial.printf("Cloud OK — %s · ₱%.0f/L\n",
      doc["name"] | DEVICE_ID,
      doc["pricePerLiter"].as<float>());
  } else {
    Serial.println("Cloud OK — online sa vendo-admin");
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== BANKERO GASOLINE LCD-7 — MRP Vendo ===");
  Serial.println("Device ID: " + String(DEVICE_ID));
  Serial.println("Cloud: https://" + String(CLOUD_HOST) + "/api/vendo");

  if (strcmp(API_KEY, "PASTE_VENDO_API_KEY_HERE") == 0) {
    Serial.println("ERROR: I-set ang API_KEY sa config.h (vendo-admin → Rotate key / device card)");
  }

  connectWiFi();
  vendoGetConfig();
  lastPing = millis();
  Serial.println("Hint: dapat makita 'Cloud OK' every 30s para ONLINE sa vendo-admin");
}

void loop() {
  if (!wifiConnected()) {
    if (millis() - lastWifiTry > WIFI_RETRY_MS) {
      lastWifiTry = millis();
      connectWiFi();
    }
    delay(200);
    return;
  }

  if (millis() - lastPing > PING_MS) {
    vendoGetConfig();
    lastPing = millis();
  }

  delay(100);
}
