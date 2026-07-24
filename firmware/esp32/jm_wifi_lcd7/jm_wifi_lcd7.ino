/*
 * JM WiFi Cloud — ESP32-S3 LCD7 heartbeat + cloud sync
 *
 * Keeps device ONLINE sa dashboard via POST /api/heartbeat every 30s.
 *
 * Setup:
 *   1. Copy config.h.example → config.h
 *   2. Ilagay ang API_KEY mula sa Admin → Vendo List
 *   3. Flash sa ESP32-S3, Serial Monitor 115200
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"

#ifndef WIFI_SSID
#error Copy config.h.example to config.h and set WIFI_SSID
#endif

const unsigned long HEARTBEAT_MS = 30000;
const unsigned long WIFI_RETRY_MS = 15000;

Preferences prefs;
String deviceId;
unsigned long lastHeartbeat = 0;
unsigned long lastWifiTry = 0;

String apiUrl(const char* path) {
  return String(CLOUD_URL) + path;
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
    Serial.println("  SSID: " + WiFi.SSID());
    Serial.println("  IP:   " + WiFi.localIP().toString());
    Serial.println("  RSSI: " + String(WiFi.RSSI()) + " dBm");
    return true;
  }
  Serial.printf("WiFi FAILED — check SSID/password (%s)\n", WIFI_SSID);
  return false;
}

void printStatus() {
  Serial.println("--- STATUS ---");
  if (wifiConnected()) {
    Serial.println("WiFi: CONNECTED -> " + WiFi.SSID());
    Serial.println("IP:   " + WiFi.localIP().toString());
  } else {
    Serial.println("WiFi: DISCONNECTED");
  }
  Serial.println("Device ID: " + (deviceId.length() ? deviceId : String("(wala pa)")));
  Serial.println("Cloud: " + String(CLOUD_URL));
  Serial.println("--------------");
}

String httpPostJson(const String& url, const String& body) {
  if (!wifiConnected()) return "";

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(15000);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

  int code = http.POST(body);
  String response = (code > 0) ? http.getString() : "";
  Serial.printf("POST %s -> %d\n", url.c_str(), code);
  if (code <= 0) Serial.println(http.errorToString(code));
  http.end();
  return response;
}

String macAddress() {
  return WiFi.macAddress();
}

bool registerDevice() {
  StaticJsonDocument<256> doc;
  doc["device_type"] = DEVICE_TYPE;
  doc["mac_address"] = macAddress();
  doc["name"] = DEVICE_NAME;
  String body;
  serializeJson(doc, body);

  String response = httpPostJson(apiUrl("/api/register-device"), body);
  if (response.isEmpty()) return false;

  StaticJsonDocument<512> res;
  if (deserializeJson(res, response)) return false;

  if (res["error"]) {
    Serial.println(String("Register error: ") + res["error"].as<const char*>());
    return false;
  }

  const char* id = res["device_id"] | res["device"]["id"].as<const char*>();
  if (id && strlen(id) > 0) {
    deviceId = String(id);
    prefs.begin("jmwifi", false);
    prefs.putString("device_id", deviceId);
    prefs.end();
    Serial.println("Device ID: " + deviceId);
    return true;
  }
  return false;
}

bool sendHeartbeat() {
  StaticJsonDocument<256> doc;
  if (deviceId.length()) doc["device_id"] = deviceId;
  doc["mac_address"] = macAddress();
  doc["name"] = DEVICE_NAME;
  doc["device_type"] = DEVICE_TYPE;
  String body;
  serializeJson(doc, body);

  String response = httpPostJson(apiUrl("/api/heartbeat"), body);
  if (response.isEmpty()) return false;

  StaticJsonDocument<512> res;
  if (deserializeJson(res, response)) return false;
  if (res["error"]) {
    Serial.println(String("Heartbeat error: ") + res["error"].as<const char*>());
    return false;
  }

  if (res["device_id"]) {
    deviceId = res["device_id"].as<String>();
    prefs.begin("jmwifi", false);
    prefs.putString("device_id", deviceId);
    prefs.end();
  }

  Serial.println("Heartbeat OK — online sa cloud");
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== JM WiFi ESP32-S3 LCD7 ===");
  Serial.println(CLOUD_URL);

  if (strcmp(API_KEY, "PASTE_VENDO_API_KEY_HERE") == 0) {
    Serial.println("ERROR: I-set ang API_KEY sa config.h (Admin -> Vendo List -> API Key)");
  }

  prefs.begin("jmwifi", true);
  deviceId = prefs.getString("device_id", "");
  prefs.end();
  if (deviceId.length()) Serial.println("Saved device_id: " + deviceId);

  connectWiFi();
  printStatus();
  if (!deviceId.length()) registerDevice();
  else sendHeartbeat();
  lastHeartbeat = millis();
  Serial.println("Hint: dapat makita 'Heartbeat OK' every 30s para ONLINE sa dashboard");
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

  if (millis() - lastHeartbeat > HEARTBEAT_MS) {
    if (!sendHeartbeat() && !deviceId.length()) registerDevice();
    lastHeartbeat = millis();
    printStatus();
  }

  delay(100);
}
