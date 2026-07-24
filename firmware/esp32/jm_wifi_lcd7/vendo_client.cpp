#include "vendo_client.h"
#include "config.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

static String apiUrl(const char* path) {
  return String("https://") + CLOUD_HOST + path;
}

static bool vendoRequest(const char* method, const String& path, const String& body,
                         String& response, int& code) {
  response = "";
  code = -1;
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(20000);
  http.begin(client, apiUrl(path));
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Api-Key", API_KEY);
  if (body.length()) http.addHeader("Content-Type", "application/json");

  if (strcmp(method, "GET") == 0) code = http.GET();
  else if (strcmp(method, "POST") == 0) code = http.POST(body);
  else { http.end(); return false; }

  if (code > 0) response = http.getString();
  http.end();
  return code > 0;
}

static bool parseSession(const JsonDocument& doc, VendoSession& out) {
  out.id = doc["id"] | 0;
  out.amountPesos = doc["amountPesos"] | 0.0f;
  out.liters = doc["liters"] | 0.0f;
  out.status = doc["status"].as<String>();
  out.qrMonoUrl = doc["qrMonoUrl"] | doc["qr_mono_url"].as<const char*>();
  out.qrMonoBase64 = doc["qrMonoBase64"] | doc["qr_mono_base64"].as<const char*>();
  out.valid = out.id > 0;
  return out.valid;
}

bool vendoFetchConfig(VendoConfig& out) {
  String body;
  int code = 0;
  if (!vendoRequest("GET", "/api/vendo/config", "", body, code)) return false;
  if (code == 401) {
    Serial.println("VENDO: invalid DEVICE_ID or API_KEY");
    return false;
  }
  if (code != 200) {
    Serial.printf("VENDO config HTTP %d: %s\n", code, body.c_str());
    return false;
  }

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, body)) return false;

  out.name = doc["name"] | DEVICE_ID;
  out.pricePerLiter = doc["pricePerLiter"] | 0.0f;
  out.pulsesPerLiter = doc["pulsesPerLiter"] | 0;
  out.mqttTopic = doc["mqttTopic"] | String("vendo/") + DEVICE_ID;

  out.presetCount = 0;
  JsonArray presets = doc["presets"].as<JsonArray>();
  if (!presets.isNull()) {
    for (JsonVariant v : presets) {
      if (out.presetCount >= 8) break;
      out.presets[out.presetCount++] = v.as<int>();
    }
  }
  return true;
}

bool vendoPollReady(VendoSession& out) {
  String body;
  int code = 0;
  if (!vendoRequest("GET", "/api/vendo/sessions/ready", "", body, code)) return false;
  if (code != 200) return false;

  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, body)) return false;
  if (!(doc["ready"] | false)) {
    out.valid = false;
    return true;
  }
  return parseSession(doc["session"], out);
}

bool vendoCreateSession(float amountPesos, VendoSession& out) {
  StaticJsonDocument<128> req;
  req["amountPesos"] = amountPesos;
  String payload;
  serializeJson(req, payload);

  String body;
  int code = 0;
  if (!vendoRequest("POST", "/api/vendo/sessions", payload, body, code)) return false;
  if (code != 201 && code != 200) {
    Serial.printf("VENDO create session HTTP %d: %s\n", code, body.c_str());
    return false;
  }

  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, body)) return false;
  return parseSession(doc, out);
}

bool vendoGetSession(int sessionId, VendoSession& out) {
  String path = String("/api/vendo/sessions/") + sessionId;
  String body;
  int code = 0;
  if (!vendoRequest("GET", path.c_str(), "", body, code)) return false;
  if (code != 200) return false;

  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, body)) return false;
  return parseSession(doc, out);
}

bool vendoMarkDispensing(int sessionId) {
  String path = String("/api/vendo/sessions/") + sessionId + "/dispensing";
  String body;
  int code = 0;
  if (!vendoRequest("POST", path.c_str(), "{}", body, code)) return false;
  return code == 200;
}

bool vendoMarkComplete(int sessionId) {
  String path = String("/api/vendo/sessions/") + sessionId + "/complete";
  String body;
  int code = 0;
  if (!vendoRequest("POST", path.c_str(), "{}", body, code)) return false;
  return code == 200;
}

// Binary QR download (128x128 mono bitmap from server)
bool vendoDownloadQrMono(int sessionId, uint8_t* buf, size_t cap, size_t& outLen) {
  outLen = 0;
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(30000);
  String url = apiUrl(String("/api/vendo/sessions/") + sessionId + "/qr.mono");
  http.begin(client, url);
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Api-Key", API_KEY);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  outLen = 0;
  while (http.connected() && outLen < cap) {
    size_t avail = stream->available();
    if (!avail) {
      delay(1);
      continue;
    }
    size_t n = stream->readBytes(buf + outLen, min(avail, cap - outLen));
    outLen += n;
  }
  http.end();
  return outLen >= 4;
}
