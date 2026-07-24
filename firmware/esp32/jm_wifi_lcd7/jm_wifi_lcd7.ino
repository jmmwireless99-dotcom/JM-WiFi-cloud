/*
 * BANKERO GASOLINE LCD-7 — full MRP Vendo firmware
 * Board: Waveshare ESP32-S3-Touch-LCD-7
 * Cloud: https://jmtechsolution.cloud/api/vendo
 * Dashboard: https://jmtechsolution.cloud/vendo-admin
 */

#include <WiFi.h>
#include "config.h"
#include "vendo_client.h"
#include "dispense.h"
#include "ui_bankero.h"

enum AppState {
  ST_BOOT,
  ST_IDLE,
  ST_QR_WAIT,
  ST_DISPENSE,
  ST_ERROR
};

const unsigned long CONFIG_MS = 30000;
const unsigned long READY_MS = 3000;
const unsigned long WIFI_RETRY_MS = 15000;

AppState state = ST_BOOT;
VendoConfig cfg;
VendoSession activeSession;
unsigned long lastConfig = 0;
unsigned long lastReady = 0;
unsigned long lastWifiTry = 0;
bool cloudOnline = false;

static uint8_t qrBuf[4 + 128 * 128];

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("WiFi -> %s\n", WIFI_SSID);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi OK " + WiFi.localIP().toString());
    return true;
  }
  Serial.println("WiFi FAILED");
  return false;
}

void refreshConfig() {
  if (vendoFetchConfig(cfg)) {
    cloudOnline = true;
    Serial.printf("Cloud OK — %s · PHP %.0f/L · %d pulses/L\n",
      cfg.name.c_str(), cfg.pricePerLiter, cfg.pulsesPerLiter);
  } else {
    cloudOnline = false;
  }
}

bool showSessionQr(const VendoSession& s) {
  size_t len = 0;
  if (!vendoDownloadQrMono(s.id, qrBuf, sizeof(qrBuf), len)) {
    Serial.println("QR download failed");
    return false;
  }
  uiDrawQrMono(qrBuf, len);
  uiShowQr(s.amountPesos, s.liters);
  return true;
}

void runDispense(const VendoSession& s) {
  state = ST_DISPENSE;
  uiShowDispense(s.liters);
  vendoMarkDispensing(s.id);
  int ppl = cfg.pulsesPerLiter > 0 ? cfg.pulsesPerLiter : DEFAULT_PULSES_PER_LITER;
  bool ok = dispenseLiters(s.liters, ppl);
  vendoMarkComplete(s.id);
  if (ok) {
    uiShowMessage("SALAMAT", "Dispense complete");
    state = ST_IDLE;
  } else {
    uiShowMessage("ERROR", "Dispense timeout");
    state = ST_ERROR;
  }
  lastConfig = 0;
  lastReady = 0;
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== BANKERO GASOLINE LCD-7 ===");
  Serial.printf("Device: %s\nCloud: https://%s/api/vendo\n", DEVICE_ID, CLOUD_HOST);

  dispenseInit();
  uiInit();
  uiShowBoot();

  connectWiFi();
  refreshConfig();
  uiShowIdle(cfg, cloudOnline);

  lastConfig = millis();
  lastReady = millis();
  state = cloudOnline ? ST_IDLE : ST_ERROR;
}

void loop() {
  uiLoop();

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiTry > WIFI_RETRY_MS) {
      lastWifiTry = millis();
      connectWiFi();
    }
    delay(50);
    return;
  }

  if (millis() - lastConfig > CONFIG_MS) {
    refreshConfig();
    if (state == ST_IDLE) uiShowIdle(cfg, cloudOnline);
    lastConfig = millis();
  }

  if (state == ST_IDLE && millis() - lastReady > READY_MS) {
    VendoSession ready;
    if (vendoPollReady(ready) && ready.valid) {
      Serial.printf("Paid session #%d · PHP %.2f · %.3f L\n",
        ready.id, ready.amountPesos, ready.liters);
      activeSession = ready;
      runDispense(activeSession);
    }
    lastReady = millis();
  }

  delay(20);
}
