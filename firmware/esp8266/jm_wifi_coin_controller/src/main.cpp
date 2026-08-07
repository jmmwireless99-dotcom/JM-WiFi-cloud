/*
 * JM WiFi Cloud — ESP8266 Coin Vendo (Wireless)
 *
 * First boot: connect phone/laptop to WiFi AP "JM-CoinSetup"
 * Open http://192.168.4.1 → set shop WiFi + API key + device name
 *
 * Hardware (NodeMCU):
 *   OLED SSD1306 — SDA=D2 (GPIO4), SCL=D1 (GPIO5)
 *   Coin pulse — D5 (GPIO14)
 *   Config button (optional) — D6 (GPIO12) hold 3s = reopen setup
 */

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

// ─── Defaults ─────────────────────────────────────────────────

static const char* CLOUD_URL = "https://jmtechsolution.cloud/allvendo";
static const char* AP_NAME = "JM-CoinSetup";
static const char* DEFAULT_DEVICE = "CoinMachine-01";

static const int COIN_PIN = 14;   // D5
static const int LED_PIN = 2;     // D4
static const int BUZZER_PIN = 0;  // D3
static const int CONFIG_PIN = 12; // D6 — hold to reopen portal
static const int OLED_SDA = 4;    // D2
static const int OLED_SCL = 5;    // D1

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C

static const unsigned long HEARTBEAT_INTERVAL = 30000;
static const unsigned long DEBOUNCE_MS = 120;
static const unsigned long VOUCHER_SHOW_MS = 45000;
static const unsigned long BLINK_MS = 700;
static const unsigned long CONFIG_HOLD_MS = 3000;

static const uint32_t EEPROM_MAGIC = 0x4A4D5749; // "JMWI"
static const int EEPROM_SIZE = 512;
static const int EEPROM_API_OFF = 8;
static const int EEPROM_API_LEN = 64;
static const int EEPROM_NAME_OFF = 72;
static const int EEPROM_NAME_LEN = 32;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

enum UiState {
  UI_BOOT,
  UI_SETUP,
  UI_WIFI,
  UI_IDLE,
  UI_PROCESSING,
  UI_VOUCHER,
  UI_ERROR
};

UiState uiState = UI_BOOT;
String statusLine = "JM WiFi Vendo";
String voucherCode = "";
String wifiSsid = "";
String apiKey = "";
String deviceName = DEFAULT_DEVICE;
int voucherMinutes = 0;
int minutesPerCoin = 5;
unsigned long voucherShownAt = 0;
unsigned long lastBlink = 0;
bool blinkOn = true;

String deviceId = "";
volatile int coinCount = 0;
unsigned long lastCoinTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long configPressAt = 0;

void IRAM_ATTR coinPulse() {
  coinCount++;
}

// ─── EEPROM config ────────────────────────────────────────────

void loadConfig() {
  uint32_t magic = 0;
  EEPROM.get(0, magic);
  if (magic != EEPROM_MAGIC) {
    apiKey = "";
    deviceName = DEFAULT_DEVICE;
    return;
  }

  char keyBuf[EEPROM_API_LEN];
  char nameBuf[EEPROM_NAME_LEN];
  memset(keyBuf, 0, sizeof(keyBuf));
  memset(nameBuf, 0, sizeof(nameBuf));
  EEPROM.get(EEPROM_API_OFF, keyBuf);
  EEPROM.get(EEPROM_NAME_OFF, nameBuf);
  apiKey = String(keyBuf);
  deviceName = String(nameBuf);
  if (!deviceName.length()) deviceName = DEFAULT_DEVICE;
}

void saveConfig(const String& key, const String& name) {
  uint32_t magic = EEPROM_MAGIC;
  EEPROM.put(0, magic);

  char keyBuf[EEPROM_API_LEN];
  char nameBuf[EEPROM_NAME_LEN];
  memset(keyBuf, 0, sizeof(keyBuf));
  memset(nameBuf, 0, sizeof(nameBuf));
  key.substring(0, EEPROM_API_LEN - 1).toCharArray(keyBuf, EEPROM_API_LEN);
  name.substring(0, EEPROM_NAME_LEN - 1).toCharArray(nameBuf, EEPROM_NAME_LEN);
  EEPROM.put(EEPROM_API_OFF, keyBuf);
  EEPROM.put(EEPROM_NAME_OFF, nameBuf);
  EEPROM.commit();

  apiKey = String(keyBuf);
  deviceName = String(nameBuf);
}

// ─── OLED ─────────────────────────────────────────────────────

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
    case UI_SETUP:
      drawCentered("WiFi Setup", 16);
      drawCentered("Join:", 30);
      drawCentered(AP_NAME, 42);
      drawCentered("192.168.4.1", 54);
      break;
    case UI_WIFI:
      drawCentered("Connecting", 22);
      drawCentered(wifiSsid.length() ? wifiSsid : "...", 38, 1);
      break;
    case UI_IDLE:
      if (blinkOn) {
        drawCentered("INSERT", 20, 2);
        drawCentered("COIN", 42, 2);
      } else {
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

// ─── WiFiManager (wireless setup) ───────────────────────────

bool startWirelessSetup(bool forcePortal = false) {
  loadConfig();

  char apiBuf[EEPROM_API_LEN];
  char nameBuf[EEPROM_NAME_LEN];
  memset(apiBuf, 0, sizeof(apiBuf));
  memset(nameBuf, 0, sizeof(nameBuf));
  apiKey.substring(0, EEPROM_API_LEN - 1).toCharArray(apiBuf, EEPROM_API_LEN);
  deviceName.substring(0, EEPROM_NAME_LEN - 1).toCharArray(nameBuf, EEPROM_NAME_LEN);

  WiFiManager wm;
  WiFiManagerParameter pApiKey("apikey", "JM API Key (from portal)", apiBuf, EEPROM_API_LEN);
  WiFiManagerParameter pDevName("devname", "Device name", nameBuf, EEPROM_NAME_LEN);

  wm.addParameter(&pApiKey);
  wm.addParameter(&pDevName);
  wm.setConfigPortalTimeout(300);
  wm.setConnectTimeout(20);
  wm.setBreakAfterConfig(true);

  setUi(UI_SETUP);

  bool ok = false;
  if (forcePortal) {
    ok = wm.startConfigPortal(AP_NAME);
  } else {
    ok = wm.autoConnect(AP_NAME);
  }

  if (!ok) {
    setUi(UI_ERROR, "Setup timeout");
    return false;
  }

  wifiSsid = WiFi.SSID();
  saveConfig(String(pApiKey.getValue()), String(pDevName.getValue()));

  if (!apiKey.length()) {
    setUi(UI_ERROR, "No API key");
    return false;
  }

  Serial.println("WiFi OK: " + wifiSsid);
  Serial.println("Device: " + deviceName);
  return true;
}

// ─── Cloud API ────────────────────────────────────────────────

String httpPost(const char* endpoint, const String& jsonBody) {
  if (WiFi.status() != WL_CONNECTED || !apiKey.length()) return "";

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);

  HTTPClient http;
  String url = String(CLOUD_URL) + endpoint;
  if (!http.begin(client, url)) return "";

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", apiKey);
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
  doc["name"] = deviceName;

  String body;
  serializeJson(doc, body);
  String response = httpPost("/api/register-device", body);
  if (!response.length()) return false;

  StaticJsonDocument<512> resDoc;
  if (deserializeJson(resDoc, response)) return false;
  if (!resDoc.containsKey("device")) return false;

  deviceId = resDoc["device"]["id"].as<String>();
  return deviceId.length() > 0;
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
  setUi(UI_VOUCHER);
  digitalWrite(LED_PIN, HIGH);
}

// ─── Setup / loop ─────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== JM WiFi Coin Vendo (Wireless) ===");

  EEPROM.begin(EEPROM_SIZE);

  pinMode(COIN_PIN, INPUT_PULLUP);
  pinMode(CONFIG_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  Wire.begin(OLED_SDA, OLED_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("OLED not found");
  } else {
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false);
    setUi(UI_BOOT);
  }

  attachInterrupt(digitalPinToInterrupt(COIN_PIN), coinPulse, FALLING);

  bool forcePortal = (digitalRead(CONFIG_PIN) == LOW);
  if (!startWirelessSetup(forcePortal)) {
    delay(5000);
    ESP.restart();
  }

  setUi(UI_WIFI);
  wifiSsid = WiFi.SSID();
  refreshDisplay();
  delay(500);

  if (!registerDevice()) {
    setUi(UI_ERROR, "Register failed");
    delay(3000);
    if (!registerDevice()) {
      delay(5000);
      ESP.restart();
    }
  }

  sendHeartbeat();
  lastHeartbeat = millis();
  setUi(UI_IDLE);
}

void loop() {
  unsigned long now = millis();

  if (digitalRead(CONFIG_PIN) == LOW) {
    if (!configPressAt) configPressAt = now;
    else if (now - configPressAt >= CONFIG_HOLD_MS) {
      WiFi.disconnect(true);
      delay(200);
      startWirelessSetup(true);
      configPressAt = 0;
      registerDevice();
      setUi(UI_IDLE);
    }
  } else {
    configPressAt = 0;
  }

  if (coinCount > 0 && now - lastCoinTime > DEBOUNCE_MS) {
    int coins = coinCount;
    coinCount = 0;
    lastCoinTime = now;
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
    setUi(UI_WIFI);
    WiFi.reconnect();
    if (WiFi.status() == WL_CONNECTED) setUi(UI_IDLE);
  }

  delay(30);
}
