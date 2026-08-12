/*
 * JM WiFi Cloud - ESP8266 Coin Controller Firmware
 * 
 * Hardware:
 *   - NodeMCU ESP8266
 *   - Coin acceptor connected to GPIO D2 (pin 4)
 *   - Optional: OLED display on I2C (SDA=D1/GPIO5, SCL=D2/GPIO4) - use separate pins
 *   - Optional: Buzzer on D3 (GPIO0)
 *   - Optional: LED indicator on D4 (GPIO2)
 *
 * Libraries needed (Arduino IDE / PlatformIO):
 *   - ESP8266WiFi
 *   - ESP8266HTTPClient
 *   - ArduinoJson (v6)
 *   - WiFiManager (optional, for easy WiFi setup)
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>

// ─── Configuration ────────────────────────────────────────────
// Change these before uploading

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* CLOUD_URL     = "https://jmwifi.jmtechsolution.cloud";
const char* API_KEY       = "YOUR_SITE_API_KEY";
const char* DEVICE_NAME   = "CoinMachine-01";

// GPIO pins
const int COIN_PIN        = 4;    // D2 - Coin acceptor pulse input
const int LED_PIN         = 2;    // D4 - Status LED (built-in)
const int BUZZER_PIN      = 0;    // D3 - Buzzer (optional)

// Timing
const unsigned long HEARTBEAT_INTERVAL = 30000;  // 30 seconds
const unsigned long DEBOUNCE_MS        = 100;    // Coin debounce

// ─── Globals ──────────────────────────────────────────────────

String deviceId = "";
String lastVoucherCode = "";
int lastMinutes = 0;
unsigned long lastHeartbeat = 0;
volatile int coinCount = 0;
unsigned long lastCoinTime = 0;

// ─── Coin Interrupt ───────────────────────────────────────────

void ICACHE_RAM_ATTR coinPulse() {
  coinCount++;
}

// ─── WiFi Connect ─────────────────────────────────────────────

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting to WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected! IP: " + WiFi.localIP().toString());
    return true;
  }

  Serial.println("\nWiFi connection failed!");
  return false;
}

// ─── HTTP Helper ──────────────────────────────────────────────

String httpPost(const char* endpoint, const String& jsonBody) {
  if (WiFi.status() != WL_CONNECTED) return "";

  WiFiClient client;
  HTTPClient http;
  String url = String(CLOUD_URL) + endpoint;

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

  int httpCode = http.POST(jsonBody);
  String response = "";

  if (httpCode > 0) {
    response = http.getString();
    Serial.printf("HTTP %d: %s\n", httpCode, response.c_str());
  } else {
    Serial.printf("HTTP error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
  return response;
}

// ─── Device Registration ──────────────────────────────────────

bool registerDevice() {
  String mac = WiFi.macAddress();

  StaticJsonDocument<256> doc;
  doc["device_type"] = "esp8266";
  doc["mac_address"] = mac;
  doc["name"] = DEVICE_NAME;

  String body;
  serializeJson(doc, body);

  String response = httpPost("/api/register-device", body);
  if (response.length() == 0) return false;

  StaticJsonDocument<512> resDoc;
  deserializeJson(resDoc, response);

  if (resDoc.containsKey("device")) {
    deviceId = resDoc["device"]["id"].as<String>();
    if (deviceId.length() == 0 && resDoc["device"]["id"]) {
      deviceId = resDoc["device"]["id"].as<String>();
    }
    Serial.println("Device ID: " + deviceId);
    return true;
  }

  return false;
}

// ─── Heartbeat ────────────────────────────────────────────────

void sendHeartbeat() {
  if (deviceId.length() == 0) return;

  StaticJsonDocument<128> doc;
  doc["device_id"] = deviceId;
  doc["mac_address"] = WiFi.macAddress();

  String body;
  serializeJson(doc, body);
  httpPost("/api/heartbeat", body);
}

// ─── Coin Insert Handler ──────────────────────────────────────

void processCoinInsert(int coins) {
  if (deviceId.length() == 0) {
    Serial.println("Device not registered, cannot process coin");
    return;
  }

  // Visual/audio feedback
  digitalWrite(LED_PIN, LOW);
  tone(BUZZER_PIN, 1000, 200);

  StaticJsonDocument<128> doc;
  doc["device_id"] = deviceId;
  doc["coins"] = coins;

  String body;
  serializeJson(doc, body);

  String response = httpPost("/api/coin-insert", body);
  if (response.length() == 0) {
    Serial.println("Failed to report coin insert");
    digitalWrite(LED_PIN, HIGH);
    return;
  }

  StaticJsonDocument<512> resDoc;
  deserializeJson(resDoc, response);

  if (resDoc["success"]) {
    lastVoucherCode = resDoc["voucher_code"].as<String>();
    lastMinutes = resDoc["minutes"];

    Serial.println("=== VOUCHER GENERATED ===");
    Serial.println("Code: " + lastVoucherCode);
    Serial.println("Minutes: " + String(lastMinutes));
    Serial.println("=========================");

    // Success beep pattern
    tone(BUZZER_PIN, 1500, 100);
    delay(150);
    tone(BUZZER_PIN, 2000, 100);
    delay(150);
    tone(BUZZER_PIN, 2500, 200);
  }

  digitalWrite(LED_PIN, HIGH);
}

// ─── Setup ────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== JM WiFi Coin Controller ===");
  Serial.println("jmtechsolution.cloud");

  pinMode(COIN_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  attachInterrupt(digitalPinToInterrupt(COIN_PIN), coinPulse, FALLING);

  if (!connectWiFi()) {
    Serial.println("Restarting in 10s...");
    delay(10000);
    ESP.restart();
  }

  if (!registerDevice()) {
    Serial.println("Registration failed, retrying...");
    delay(5000);
    registerDevice();
  }

  sendHeartbeat();
  lastHeartbeat = millis();

  Serial.println("Ready. Waiting for coin insert...");
  tone(BUZZER_PIN, 800, 100);
}

// ─── Main Loop ────────────────────────────────────────────────

void loop() {
  // Process coin pulses
  if (coinCount > 0) {
    unsigned long now = millis();
    if (now - lastCoinTime > DEBOUNCE_MS) {
      int coins = coinCount;
      coinCount = 0;
      lastCoinTime = now;

      Serial.printf("Coin detected: %d\n", coins);
      processCoinInsert(coins);
    }
  }

  // Heartbeat
  if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  // WiFi reconnect
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    connectWiFi();
  }

  delay(50);
}
