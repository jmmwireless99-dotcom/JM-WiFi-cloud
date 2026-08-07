/*
 * JM WiFi Cloud — ESP8266 Coin Vendo Controller
 *
 * Hardware (NodeMCU ESP8266):
 *   OLED SSD1306 128x64 I2C — SDA=D2 (GPIO4), SCL=D1 (GPIO5)
 *   Coin acceptor pulse — D5 (GPIO14)
 *   Buzzer (optional) — D3 (GPIO0)
 *   Status LED — D4 (GPIO2, built-in, active LOW)
 *
 * Libraries (Arduino IDE / PlatformIO):
 *   ESP8266WiFi, ESP8266HTTPClient, WiFiClientSecure
 *   ArduinoJson v6
 *   Adafruit GFX Library, Adafruit SSD1306
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

// ─── Configuration (edit before upload) ─────────────────────

const char* WIFI_SSID   = "YOUR_WIFI_SSID";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* CLOUD_URL   = "https://jmtechsolution.cloud/allvendo";
const char* API_KEY     = "YOUR_SITE_API_KEY";
const char* DEVICE_NAME = "CoinMachine-01";

// GPIO
const int COIN_PIN   = 14;  // D5
const int LED_PIN    = 2;   // D4 — built-in LED
const int BUZZER_PIN = 0;   // D3
const int OLED_SDA   = 4;   // D2
const int OLED_SCL   = 5;   // D1

// OLED
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C

// Timing
const unsigned long HEARTBEAT_INTERVAL = 30000;
const unsigned long DEBOUNCE_MS        = 120;
const unsigned long VOUCHER_SHOW_MS    = 45000;
const unsigned long BLINK_MS           = 700;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ─── Display states ───────────────────────────────────────────

enum UiState {
  UI_BOOT,
  UI_WIFI,
  UI_IDLE,
  UI_PROCESSING,
  UI_VOUCHER,
  UI_ERROR
};

UiState uiState = UI_BOOT;
String statusLine = "JM WiFi Vendo";
String voucherCode = "";
int voucherMinutes = 0;
int minutesPerCoin = 5;
unsigned long voucherShownAt = 0;
unsigned long lastBlink = 0;
bool blinkOn = true;

// ─── Runtime ──────────────────────────────────────────────────

String deviceId = "";
volatile int coinCount = 0;
unsigned long lastCoinTime = 0;
unsigned long lastHeartbeat = 0;

void ICACHE_RAM_ATTR coinPulse() {
  coinCount++;
}

// ─── OLED helpers ─────────────────────────────────────────────

void drawCentered(const String& line, int y, int size = 1) {
  display.setTextSize(size);
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(line, 0, 0, &x1, &y1, &w, &h);
  int x = (SCREEN_WIDTH - (int)w) / 2;
  display.setCursor(x, y);
  display.print(line);
}

void drawHeader() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("JM WiFi Vendo");
  display.drawLine(0, 10, SCREEN_WIDTH - 1, 10, SSD1306_WHITE);
}

void drawWifiDot() {
  const int x = SCREEN_WIDTH - 10;
  const int y = 2;
  bool online = WiFi.status() == WL_CONNECTED;
  display.fillCircle(x, y + 3, 3, online ? SSD1306_WHITE : SSD1306_BLACK);
  if (!online) display.drawCircle(x, y + 3, 3, SSD1306_WHITE);
}

void refreshDisplay() {
  display.clearDisplay();
  drawHeader();
  drawWifiDot();

  switch (uiState) {
    case UI_BOOT:
      drawCentered("Starting...", 28);
      break;

    case UI_WIFI:
      drawCentered("Connecting", 22);
      drawCentered(WIFI_SSID, 38, 1);
      break;

    case UI_IDLE:
      if (blinkOn) {
        display.setTextSize(2);
        drawCentered("INSERT", 20, 2);
        drawCentered("COIN", 42, 2);
      } else {
        display.setTextSize(1);
        drawCentered("---", 30);
      }
      display.setTextSize(1);
      drawCentered(String(minutesPerCoin) + " min / coin", 56);
      break;

    case UI_PROCESSING:
      drawCentered("Processing", 24, 2);
      drawCentered("coin...", 44);
      break;

    case UI_VOUCHER:
      drawCentered("VOUCHER", 16);
      display.setTextSize(2);
      drawCentered(voucherCode, 30, 2);
      display.setTextSize(1);
      drawCentered(String(voucherMinutes) + " minutes", 52);
      break;

    case UI_ERROR:
      drawCentered("ERROR", 22, 2);
      display.setTextSize(1);
      drawCentered(statusLine, 40);
      break;
  }

  display.display();
}

void setUi(UiState next, const String& status = "") {
  uiState = next;
  if (status.length()) statusLine = status;
  refreshDisplay();
}

// ─── Network ──────────────────────────────────────────────────

bool connectWiFi() {
  setUi(UI_WIFI);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting to WiFi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
    if (i % 2 == 0) refreshDisplay();
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected: " + WiFi.localIP().toString());
    return true;
  }

  Serial.println("\nWiFi failed");
  setUi(UI_ERROR, "WiFi failed");
  return false;
}

String httpPost(const char* endpoint, const String& jsonBody) {
  if (WiFi.status() != WL_CONNECTED) return "";

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);

  HTTPClient http;
  String url = String(CLOUD_URL) + endpoint;

  if (!http.begin(client, url)) {
    Serial.println("HTTP begin failed");
    return "";
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(15000);

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

bool registerDevice() {
  StaticJsonDocument<256> doc;
  doc["device_type"] = "esp8266";
  doc["mac_address"] = WiFi.macAddress();
  doc["name"] = DEVICE_NAME;

  String body;
  serializeJson(doc, body);

  String response = httpPost("/api/register-device", body);
  if (!response.length()) return false;

  StaticJsonDocument<512> resDoc;
  DeserializationError err = deserializeJson(resDoc, response);
  if (err) return false;

  if (resDoc.containsKey("device")) {
    deviceId = resDoc["device"]["id"].as<String>();
    Serial.println("Device ID: " + deviceId);
    return deviceId.length() > 0;
  }

  return false;
}

void sendHeartbeat() {
  if (!deviceId.length()) return;

  StaticJsonDocument<192> doc;
  doc["device_id"] = deviceId;
  doc["mac_address"] = WiFi.macAddress();

  String body;
  serializeJson(doc, body);

  String response = httpPost("/api/heartbeat", body);
  if (!response.length()) return;

  StaticJsonDocument<256> resDoc;
  if (deserializeJson(resDoc, response) == DeserializationError::Ok && resDoc["config"]) {
    int mpc = resDoc["config"]["minutes_per_coin"] | minutesPerCoin;
    if (mpc > 0) minutesPerCoin = mpc;
  }
}

void processCoinInsert(int coins) {
  if (!deviceId.length()) {
    setUi(UI_ERROR, "Not registered");
    return;
  }

  setUi(UI_PROCESSING);
  digitalWrite(LED_PIN, LOW);

  StaticJsonDocument<160> doc;
  doc["device_id"] = deviceId;
  doc["coins"] = coins;

  String body;
  serializeJson(doc, body);

  String response = httpPost("/api/coin-insert", body);
  if (!response.length()) {
    setUi(UI_ERROR, "Cloud offline");
    digitalWrite(LED_PIN, HIGH);
    delay(2000);
    setUi(UI_IDLE);
    return;
  }

  StaticJsonDocument<512> resDoc;
  if (deserializeJson(resDoc, response) != DeserializationError::Ok || !resDoc["success"]) {
    setUi(UI_ERROR, "Coin failed");
    digitalWrite(LED_PIN, HIGH);
    delay(2000);
    setUi(UI_IDLE);
    return;
  }

  voucherCode = resDoc["voucher_code"].as<String>();
  voucherMinutes = resDoc["minutes"] | 0;
  voucherShownAt = millis();

  Serial.println("=== VOUCHER ===");
  Serial.println(voucherCode);
  Serial.println(String(voucherMinutes) + " min");

  setUi(UI_VOUCHER);
  digitalWrite(LED_PIN, HIGH);
}

// ─── Setup / loop ─────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== JM WiFi Coin Vendo ===");

  pinMode(COIN_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  Wire.begin(OLED_SDA, OLED_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("OLED not found — serial-only mode");
  } else {
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false);
    setUi(UI_BOOT);
  }

  attachInterrupt(digitalPinToInterrupt(COIN_PIN), coinPulse, FALLING);

  if (!connectWiFi()) {
    delay(8000);
    ESP.restart();
  }

  if (!registerDevice()) {
    setUi(UI_ERROR, "Register failed");
    delay(3000);
    registerDevice();
  }

  sendHeartbeat();
  lastHeartbeat = millis();
  setUi(UI_IDLE);
}

void loop() {
  unsigned long now = millis();

  if (coinCount > 0 && now - lastCoinTime > DEBOUNCE_MS) {
    int coins = coinCount;
    coinCount = 0;
    lastCoinTime = now;
    Serial.printf("Coin: %d\n", coins);
    processCoinInsert(coins);
  }

  if (uiState == UI_IDLE && now - lastBlink > BLINK_MS) {
    lastBlink = now;
    blinkOn = !blinkOn;
    refreshDisplay();
  }

  if (uiState == UI_VOUCHER && now - voucherShownAt > VOUCHER_SHOW_MS) {
    voucherCode = "";
    setUi(UI_IDLE);
  }

  if (now - lastHeartbeat > HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = now;
    if (uiState == UI_IDLE) refreshDisplay();
  }

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (uiState != UI_PROCESSING && uiState != UI_VOUCHER) setUi(UI_IDLE);
  }

  delay(30);
}
