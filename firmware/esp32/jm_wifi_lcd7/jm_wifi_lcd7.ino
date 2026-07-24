/*
 * JM WiFi Cloud — ESP32-S3 LCD7 heartbeat + cloud sync
 *
 * Keeps device ONLINE sa dashboard via POST /api/heartbeat every 30s.
 *
 * Arduino IDE / PlatformIO:
 *   - Board: ESP32-S3
 *   - Libraries: WiFi, HTTPClient, ArduinoJson, Preferences
 *
 * I-set ang CLOUD_URL, API_KEY, DEVICE_NAME bago i-flash.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>

// ─── CONFIG — palitan bago upload ─────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* CLOUD_URL     = "https://jmtechsolution.cloud/allvendo";
const char* API_KEY       = "YOUR_SITE_API_KEY";
const char* DEVICE_NAME   = "LCD7S3";
const char* DEVICE_TYPE   = "esp32-s3";

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
  Serial.print("WiFi connecting");
  for (int i = 0; i < 40 && !wifiConnected(); i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (wifiConnected()) {
    Serial.println("WiFi OK: " + WiFi.localIP().toString());
    return true;
  }
  Serial.println("WiFi FAILED");
  return false;
}

String httpPostJson(const String& url, const String& body) {
  if (!wifiConnected()) return "";

  WiFiClientSecure client;
  client.setInsecure();  // HTTPS without cert bundle — OK for cloud API

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

  prefs.begin("jmwifi", true);
  deviceId = prefs.getString("device_id", "");
  prefs.end();
  if (deviceId.length()) Serial.println("Saved device_id: " + deviceId);

  connectWiFi();
  if (!deviceId.length()) registerDevice();
  else sendHeartbeat();
  lastHeartbeat = millis();
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
  }

  delay(100);
}
