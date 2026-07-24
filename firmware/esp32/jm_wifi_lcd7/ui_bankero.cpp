#include "ui_bankero.h"
#include "config.h"
#include <WiFi.h>

#if __has_include(<esp_display_panel.hpp>) && __has_include(<lvgl.h>)
  #define BANKERO_HAS_LCD 1
  #include <esp_display_panel.hpp>
  #include <lvgl.h>
  #include "lvgl_v8_port.h"
  using namespace esp_panel::drivers;
  using namespace esp_panel::board;
  static Board* g_board = nullptr;
  static lv_obj_t* g_title = nullptr;
  static lv_obj_t* g_sub = nullptr;
  static lv_obj_t* g_status = nullptr;
  static lv_obj_t* g_qrCanvas = nullptr;
  static lv_color_t* g_qrBuf = nullptr;
#else
  #define BANKERO_HAS_LCD 0
#endif

static void uiSerial(const char* title, const char* sub, bool online) {
  Serial.println("--- UI ---");
  Serial.println(title);
  if (sub && sub[0]) Serial.println(sub);
  Serial.printf("WiFi: %s | Cloud: %s\n",
    WiFi.status() == WL_CONNECTED ? "OK" : "OFF",
    online ? "ONLINE" : "OFFLINE");
  Serial.println("----------");
}

#if BANKERO_HAS_LCD
static void uiEnsureLabels() {
  if (g_title) return;
  lv_obj_t* scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_hex(0x071a14), 0);

  g_title = lv_label_create(scr);
  lv_obj_set_style_text_color(g_title, lv_color_hex(0xd4f06a), 0);
  lv_obj_set_style_text_font(g_title, &lv_font_montserrat_28, 0);
  lv_label_set_long_mode(g_title, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(g_title, lv_pct(100));
  lv_obj_align(g_title, LV_ALIGN_TOP_MID, 0, 20);

  g_sub = lv_label_create(scr);
  lv_obj_set_style_text_color(g_sub, lv_color_hex(0x9cb8a9), 0);
  lv_obj_set_style_text_font(g_sub, &lv_font_montserrat_20, 0);
  lv_label_set_long_mode(g_sub, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(g_sub, lv_pct(100));
  lv_obj_align(g_sub, LV_ALIGN_TOP_MID, 0, 70);

  g_status = lv_label_create(scr);
  lv_obj_set_style_text_color(g_status, lv_color_hex(0x3dd68c), 0);
  lv_obj_align(g_status, LV_ALIGN_BOTTOM_MID, 0, -20);
}

static void uiSetText(const char* title, const char* sub, const char* status) {
  uiEnsureLabels();
  lv_label_set_text(g_title, title ? title : "");
  lv_label_set_text(g_sub, sub ? sub : "");
  lv_label_set_text(g_status, status ? status : "");
  if (g_qrCanvas) {
    lv_obj_add_flag(g_qrCanvas, LV_OBJ_FLAG_HIDDEN);
  }
}
#endif

bool uiInit() {
#if BANKERO_HAS_LCD
  Serial.println("UI: init Waveshare LCD7 + LVGL");
  g_board = new Board();
  if (!g_board->init()) {
    Serial.println("UI: board init failed");
    return false;
  }
  if (!g_board->begin()) {
    Serial.println("UI: board begin failed");
    return false;
  }
  lvgl_port_init(g_board->getLCD(), g_board->getTouch());
  uiEnsureLabels();
  uiSetText("BANKERO FUEL", "Starting...", "");
  return true;
#else
  Serial.println("UI: no Waveshare libraries — Serial UI only");
  Serial.println("Install: ESP32_Display_Panel + lvgl_v8_port from Waveshare demo");
  return true;
#endif
}

void uiShowBoot() {
#if BANKERO_HAS_LCD
  uiSetText("BANKERO FUEL", "Connecting WiFi...", "");
#else
  uiSerial("BANKERO FUEL", "Connecting WiFi...", false);
#endif
}

void uiShowIdle(const VendoConfig& cfg, bool online) {
  char sub[160];
  snprintf(sub, sizeof(sub), "%s\nRate: PHP %.0f/L\nPay: jmtechsolution.cloud/pay/%s",
    cfg.name.c_str(), cfg.pricePerLiter, DEVICE_ID);
#if BANKERO_HAS_LCD
  uiSetText("BANKERO GASOLINE", sub, online ? "ONLINE" : "OFFLINE");
#else
  uiSerial("BANKERO GASOLINE", sub, online);
#endif
}

void uiShowQr(float amountPesos, float liters) {
  char sub[96];
  snprintf(sub, sizeof(sub), "Scan GCash QR\nPHP %.2f · %.3f L", amountPesos, liters);
#if BANKERO_HAS_LCD
  uiSetText("GCash QR", sub, "Awaiting payment");
#else
  uiSerial("GCash QR", sub, true);
#endif
}

void uiShowDispense(float liters) {
  char sub[64];
  snprintf(sub, sizeof(sub), "Dispensing %.3f L", liters);
#if BANKERO_HAS_LCD
  uiSetText("DISPENSING", sub, "Please wait");
#else
  uiSerial("DISPENSING", sub, true);
#endif
}

void uiShowMessage(const char* title, const char* sub) {
#if BANKERO_HAS_LCD
  uiSetText(title, sub, "");
#else
  uiSerial(title, sub, true);
#endif
}

void uiDrawQrMono(const uint8_t* mono, size_t len) {
  if (!mono || len < 4) return;
  uint16_t w = mono[0] | (mono[1] << 8);
  uint16_t h = mono[2] | (mono[3] << 8);
  if (w == 0 || h == 0 || len < (size_t)(4 + w * h)) return;

#if BANKERO_HAS_LCD
  uiEnsureLabels();
  if (!g_qrCanvas) {
    g_qrCanvas = lv_canvas_create(lv_scr_act());
    lv_obj_align(g_qrCanvas, LV_ALIGN_CENTER, 0, 40);
  }
  if (!g_qrBuf || w * h > 128 * 128) {
    static lv_color_t buf[128 * 128];
    g_qrBuf = buf;
  }
  const uint8_t* px = mono + 4;
  for (uint32_t i = 0; i < (uint32_t)w * h; i++) {
    g_qrBuf[i] = px[i] < 128 ? lv_color_black() : lv_color_white();
  }
  static lv_img_dsc_t dsc;
  dsc.header.cf = LV_IMG_CF_TRUE_COLOR;
  dsc.header.w = w;
  dsc.header.h = h;
  dsc.data_size = w * h * sizeof(lv_color_t);
  dsc.data = (const uint8_t*)g_qrBuf;
  lv_canvas_set_buffer(g_qrCanvas, g_qrBuf, w, h, LV_IMG_CF_TRUE_COLOR);
  lv_obj_clear_flag(g_qrCanvas, LV_OBJ_FLAG_HIDDEN);
  lv_obj_invalidate(g_qrCanvas);
#else
  Serial.printf("QR mono %ux%u received (install Waveshare libs for LCD)\n", w, h);
#endif
}

void uiLoop() {
#if BANKERO_HAS_LCD
  lv_timer_handler();
#endif
}
