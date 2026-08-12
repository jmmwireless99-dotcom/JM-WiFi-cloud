/*
 * JM Gas / Water Dispenser — ESP32 + Nextion
 * Coin (PCNT) + Bill acceptor (PCNT) + Flow meter + Web portal
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <SPIFFS.h>
#include <time.h>
#include "driver/pcnt.h"

// ---------------- PINS ----------------
#define PIN_COIN     12   // Coin acceptor pulse
#define PIN_BILL     13   // Bill acceptor pulse (₱ per pulse = billValue)
#define PIN_FLOW     14
#define PIN_START    27
#define PIN_PAUSE    26
#define PIN_RELAY    33

#define NEXTION_RX   21
#define NEXTION_TX   22

// ---------------- OBJECTS -------------
HardwareSerial nex(2);
WebServer server(80);

// ---------------- CONFIG --------------
struct Config {
  float pulsesPerLiter = 450.0f;
  float pricePerLiter  = 60.0f;
  float coinValue      = 1.0f;    // ₱ per coin pulse
  float billValue      = 20.0f;   // ₱ per bill pulse (e.g. ₱20 bill = 1 pulse)
} cfg;

struct Totals {
  uint32_t totalCoins = 0;
  uint32_t totalBills = 0;
  float totalLiters   = 0;
  float totalRevenue  = 0;
} totals;

enum class State { IDLE, DISPENSING, PAUSED };
State state = State::IDLE;

// ---------------- RUNTIME -------------
volatile uint32_t flowPulses = 0;
volatile uint32_t lastFlowMicros = 0;

float credit = 0;
float sessionLiters = 0;
float sessionCost = 0;

uint32_t flowBaseline = 0;
uint32_t lastUI = 0;
uint32_t dispenseStartMs = 0;
uint32_t lastStartMs = 0;
uint32_t lastPauseMs = 0;

static const uint32_t BTN_DEBOUNCE_MS = 300;
static const uint32_t MAX_DISPENSE_MS = 300000;  // 5 min safety timeout

// ---------------- FILES ----------------
#define CFG_PATH  "/config.json"
#define HIST_PATH "/history.csv"

// ---------------- FLOW ISR -------------
void IRAM_ATTR flowISR() {
  uint32_t now = micros();
  if (now - lastFlowMicros > 300) {
    flowPulses++;
    lastFlowMicros = now;
  }
}

// ---------------- PCNT -----------------
static void setupPCNTUnit(pcnt_unit_t unit, pcnt_channel_t channel, gpio_num_t pin) {
  pcnt_config_t c{};
  c.pulse_gpio_num = pin;
  c.ctrl_gpio_num  = PCNT_PIN_NOT_USED;
  c.unit           = unit;
  c.channel        = channel;
  c.pos_mode       = PCNT_COUNT_DIS;
  c.neg_mode       = PCNT_COUNT_INC;
  c.counter_h_lim  = 32767;
  c.counter_l_lim  = 0;
  pcnt_unit_config(&c);
  pcnt_set_filter_value(unit, 1000);  // ~1ms glitch filter
  pcnt_filter_enable(unit);
  pcnt_counter_clear(unit);
  pcnt_counter_resume(unit);
}

void setupPCNT() {
  setupPCNTUnit(PCNT_UNIT_0, PCNT_CHANNEL_0, (gpio_num_t)PIN_COIN);
  setupPCNTUnit(PCNT_UNIT_1, PCNT_CHANNEL_0, (gpio_num_t)PIN_BILL);
}

uint32_t readPCNT(pcnt_unit_t unit) {
  static uint32_t lastCoinMs = 0;
  static uint32_t lastBillMs = 0;
  uint32_t* lastMs = (unit == PCNT_UNIT_0) ? &lastCoinMs : &lastBillMs;

  int16_t v = 0;
  pcnt_get_counter_value(unit, &v);
  if (v <= 0) return 0;

  pcnt_counter_clear(unit);
  uint32_t now = millis();
  if (now - *lastMs < 5) return 0;
  *lastMs = now;
  return (uint32_t)v;
}

uint32_t readCoins() { return readPCNT(PCNT_UNIT_0); }
uint32_t readBills() { return readPCNT(PCNT_UNIT_1); }

// ---------------- NEXTION --------------
void nexCmd(const String &s) {
  nex.print(s);
  nex.write(0xFF);
  nex.write(0xFF);
  nex.write(0xFF);
}

void updateUI() {
  nexCmd("tCredit.txt=\"Credit: " + String(credit, 2) + "\"");
  nexCmd("tLiters.txt=\"Liters: " + String(sessionLiters, 3) + "\"");
  nexCmd("tPrice.txt=\"Price/L: " + String(cfg.pricePerLiter, 2) + "\"");
  nexCmd("tCoin.txt=\"Coin: " + String(cfg.coinValue, 0) + "  Bill: " + String(cfg.billValue, 0) + "\"");
  nexCmd("tState.txt=\"" +
    String(state == State::DISPENSING ? "Dispensing" :
           state == State::PAUSED     ? "Paused" : "READY") + "\"");
}

// ---------------- CONFIG ----------------
void saveConfig() {
  File f = SPIFFS.open(CFG_PATH, "w");
  if (!f) return;
  f.printf(
    "{\"ppl\":%.3f,\"price\":%.2f,\"coin\":%.2f,\"bill\":%.2f,"
    "\"coins\":%lu,\"bills\":%lu,\"liters\":%.3f,\"rev\":%.2f}",
    cfg.pulsesPerLiter, cfg.pricePerLiter, cfg.coinValue, cfg.billValue,
    totals.totalCoins, totals.totalBills, totals.totalLiters, totals.totalRevenue
  );
  f.close();
}

void loadConfig() {
  if (!SPIFFS.exists(CFG_PATH)) {
    saveConfig();
    return;
  }
  File f = SPIFFS.open(CFG_PATH, "r");
  if (!f) return;
  String s = f.readString();
  f.close();

  auto getF = [&](const char* k, float d) {
    int i = s.indexOf(k);
    return i < 0 ? d : s.substring(s.indexOf(':', i) + 1).toFloat();
  };
  auto getU = [&](const char* k, uint32_t d) {
    int i = s.indexOf(k);
    return i < 0 ? d : (uint32_t)s.substring(s.indexOf(':', i) + 1).toInt();
  };

  cfg.pulsesPerLiter = getF("ppl", 450);
  cfg.pricePerLiter  = getF("price", 60);
  cfg.coinValue      = getF("coin", 1);
  cfg.billValue      = getF("bill", 20);
  totals.totalCoins  = getU("coins", 0);
  totals.totalBills  = getU("bills", 0);
  totals.totalLiters = getF("liters", 0);
  totals.totalRevenue = getF("rev", 0);

  if (cfg.pulsesPerLiter <= 0) cfg.pulsesPerLiter = 450;
  if (cfg.billValue <= 0) cfg.billValue = 20;
}

// ---------------- HISTORY --------------
void saveHistory(float liters, float amount) {
  File f = SPIFFS.open(HIST_PATH, FILE_APPEND);
  if (!f) return;
  time_t now = time(nullptr);
  struct tm *t = localtime(&now);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%d,%H:%M", t);
  f.printf("%s,%.3f,%.2f\n", buf, liters, amount);
  f.close();
}

// ---------------- WEB ------------------
void handleRoot() {
  server.send(200, "text/html",
    "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'>"
    "<style>"
    "body{font-family:Arial;background:#0f172a;color:#e5e7eb;padding:20px}"
    "h2{color:#22c55e;font-size:32px}"
    "label{font-size:20px;display:block;margin-top:12px}"
    "input{font-size:22px;padding:6px;width:100%;box-sizing:border-box}"
    "button{font-size:22px;padding:10px;margin-top:10px;width:100%;"
    "background:#22c55e;color:#000;border:none;border-radius:6px}"
    ".note{color:#94a3b8;font-size:14px;margin-top:4px}"
    "</style></head><body>"
    "<h2>JM Gas Vending Machine</h2>"
    "<form method='post' action='/save'>"
    "<label>Price/L (₱)</label><input name='price' value='" + String(cfg.pricePerLiter, 2) + "'>"
    "<label>Pulses/L</label><input name='ppl' value='" + String(cfg.pulsesPerLiter, 2) + "'>"
    "<label>Coin Value (₱ per pulse)</label><input name='coin' value='" + String(cfg.coinValue, 2) + "'>"
    "<p class='note'>Coin acceptor — hal. 1 pulse = ₱1</p>"
    "<label>Bill Value (₱ per pulse)</label><input name='bill' value='" + String(cfg.billValue, 2) + "'>"
    "<p class='note'>Bill acceptor GPIO " + String(PIN_BILL) + " — hal. 1 pulse = ₱20 bill</p>"
    "<button>SAVE SETTINGS</button></form>"
    "<a href='/history'><button style='background:#38bdf8'>VIEW HISTORY</button></a>"
    "<form method='post' action='/clearhist'>"
    "<button style='background:#ef4444;color:#fff'>CLEAR HISTORY</button>"
    "</form></body></html>"
  );
}

void handleSave() {
  cfg.pricePerLiter  = server.arg("price").toFloat();
  cfg.pulsesPerLiter = server.arg("ppl").toFloat();
  cfg.coinValue      = server.arg("coin").toFloat();
  cfg.billValue      = server.arg("bill").toFloat();
  if (cfg.pulsesPerLiter <= 0) cfg.pulsesPerLiter = 450;
  if (cfg.billValue <= 0) cfg.billValue = 20;
  saveConfig();
  server.sendHeader("Location", "/");
  server.send(302);
}

void handleClearHistory() {
  if (SPIFFS.exists(HIST_PATH)) SPIFFS.remove(HIST_PATH);
  server.sendHeader("Location", "/history");
  server.send(302);
}

void handleHistory() {
  float sumL = 0, sumA = 0;
  uint32_t cnt = 0;
  String rows = "";
  if (SPIFFS.exists(HIST_PATH)) {
    File f = SPIFFS.open(HIST_PATH, "r");
    while (f.available()) {
      String l = f.readStringUntil('\n');
      l.trim();
      int a = l.indexOf(',');
      int b = l.indexOf(',', a + 1);
      int c = l.indexOf(',', b + 1);
      if (a < 0 || b < 0 || c < 0) continue;
      sumL += l.substring(b + 1, c).toFloat();
      sumA += l.substring(c + 1).toFloat();
      cnt++;
      rows += "<tr><td>" + l.substring(0, a) + "</td><td>" + l.substring(a + 1, b) +
              "</td><td style='color:#22c55e'>" + l.substring(b + 1, c) +
              "</td><td style='color:#38bdf8'>" + l.substring(c + 1) + "</td></tr>";
    }
    f.close();
  }

  server.send(200, "text/html",
    "<html><body style='background:#020617;color:#e5e7eb;font-family:Arial'>"
    "<h1 style='color:#38bdf8;text-align:center'>SALES HISTORY</h1>"
    "<div style='display:flex;gap:10px'>"
    "<div style='flex:1;font-size:28px;color:#22c55e'>" + String(sumL, 3) + "<br>Liters</div>"
    "<div style='flex:1;font-size:28px;color:#38bdf8'>" + String(sumA, 2) + "<br>Revenue</div>"
    "<div style='flex:1;font-size:28px;color:#facc15'>" + String(cnt) + "<br>Tx</div>"
    "</div>"
    "<p style='text-align:center'>Coins: " + String(totals.totalCoins) +
    " | Bills: " + String(totals.totalBills) + "</p>"
    "<table width='100%' style='font-size:22px'><tr><th>Date</th><th>Time</th><th>L</th><th>₱</th></tr>" +
    rows + "</table>"
    "<form method='post' action='/clearhist'>"
    "<button style='background:#ef4444;font-size:24px;width:100%'>CLEAR HISTORY</button></form>"
    "<a href='/'><button style='font-size:22px;width:100%'>BACK</button></a>"
    "</body></html>"
  );
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== JM Gas Dispenser ===");
  Serial.printf("Coin GPIO%d | Bill GPIO%d | Flow GPIO%d | Relay GPIO%d\n",
    PIN_COIN, PIN_BILL, PIN_FLOW, PIN_RELAY);

  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);
  pinMode(PIN_START, INPUT_PULLUP);
  pinMode(PIN_PAUSE, INPUT_PULLUP);
  pinMode(PIN_FLOW, INPUT_PULLUP);
  pinMode(PIN_COIN, INPUT);
  pinMode(PIN_BILL, INPUT);

  SPIFFS.begin(true);
  loadConfig();

  WiFi.mode(WIFI_AP);
  WiFi.softAP("GAS PREMIUM", "admin123");
  Serial.println("AP: GAS PREMIUM → http://192.168.4.1");

  configTime(8 * 3600, 0, "pool.ntp.org");  // Philippines UTC+8

  nex.begin(9600, SERIAL_8N1, NEXTION_RX, NEXTION_TX);

  setupPCNT();
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), flowISR, RISING);

  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/history", handleHistory);
  server.on("/clearhist", HTTP_POST, handleClearHistory);
  server.begin();

  updateUI();
}

// ---------------- LOOP -----------------
void loop() {
  server.handleClient();

  uint32_t coins = readCoins();
  if (coins) {
    credit += coins * cfg.coinValue;
    totals.totalCoins += coins;
    saveConfig();
    Serial.printf("Coin +%u → credit ₱%.2f\n", coins, credit);
  }

  uint32_t bills = readBills();
  if (bills) {
    credit += bills * cfg.billValue;
    totals.totalBills += bills;
    saveConfig();
    Serial.printf("Bill +%u (₱%.0f/pulse) → credit ₱%.2f\n", bills, cfg.billValue, credit);
  }

  uint32_t now = millis();

  if (digitalRead(PIN_START) == LOW && state == State::IDLE && credit > 0 &&
      now - lastStartMs > BTN_DEBOUNCE_MS) {
    lastStartMs = now;
    noInterrupts();
    flowBaseline = flowPulses;
    interrupts();
    sessionLiters = 0;
    sessionCost = 0;
    state = State::DISPENSING;
    dispenseStartMs = now;
    digitalWrite(PIN_RELAY, HIGH);
    Serial.println("START dispense");
  }

  if (digitalRead(PIN_PAUSE) == LOW && now - lastPauseMs > BTN_DEBOUNCE_MS) {
    lastPauseMs = now;
    if (state == State::DISPENSING) {
      state = State::PAUSED;
      digitalWrite(PIN_RELAY, LOW);
      Serial.println("PAUSED");
    } else if (state == State::PAUSED && credit > 0) {
      noInterrupts();
      flowBaseline = flowPulses;
      interrupts();
      state = State::DISPENSING;
      dispenseStartMs = now;
      digitalWrite(PIN_RELAY, HIGH);
      Serial.println("RESUME");
    }
  }

  if (state == State::DISPENSING) {
    if (now - dispenseStartMs > MAX_DISPENSE_MS) {
      digitalWrite(PIN_RELAY, LOW);
      state = State::IDLE;
      if (sessionLiters > 0) saveHistory(sessionLiters, sessionCost);
      saveConfig();
      Serial.println("TIMEOUT — relay OFF");
    } else {
      noInterrupts();
      uint32_t p = flowPulses - flowBaseline;
      flowBaseline = flowPulses;
      interrupts();
      if (p && cfg.pulsesPerLiter > 0) {
        float l = p / cfg.pulsesPerLiter;
        float cost = l * cfg.pricePerLiter;
        if (cost > credit) {
          cost = credit;
          l = cost / cfg.pricePerLiter;
        }
        credit -= cost;
        sessionLiters += l;
        sessionCost += cost;
        totals.totalLiters += l;
        totals.totalRevenue += cost;
      }
      if (credit <= 0.01f) {
        digitalWrite(PIN_RELAY, LOW);
        state = State::IDLE;
        if (sessionLiters > 0) saveHistory(sessionLiters, sessionCost);
        saveConfig();
        Serial.printf("DONE — %.3f L, ₱%.2f\n", sessionLiters, sessionCost);
      }
    }
  }

  if (now - lastUI > 400) {
    updateUI();
    lastUI = now;
  }
}
