#pragma once
#include <ArduinoJson.h>

struct VendoConfig {
  float pricePerLiter = 0;
  int pulsesPerLiter = 0;
  int presets[8] = {};
  int presetCount = 0;
  String name;
  String mqttTopic;
};

struct VendoSession {
  int id = 0;
  float amountPesos = 0;
  float liters = 0;
  String status;
  String qrMonoUrl;
  String qrMonoBase64;
  bool valid = false;
};

bool vendoFetchConfig(VendoConfig& out);
bool vendoPollReady(VendoSession& out);
bool vendoCreateSession(float amountPesos, VendoSession& out);
bool vendoGetSession(int sessionId, VendoSession& out);
bool vendoDownloadQrMono(int sessionId, uint8_t* buf, size_t cap, size_t& outLen);
bool vendoMarkDispensing(int sessionId);
bool vendoMarkComplete(int sessionId);
