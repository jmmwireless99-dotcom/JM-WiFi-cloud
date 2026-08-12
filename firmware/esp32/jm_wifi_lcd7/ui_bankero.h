#pragma once
#include "vendo_client.h"

bool uiInit();
void uiShowBoot();
void uiShowIdle(const VendoConfig& cfg, bool online);
void uiShowQr(float amountPesos, float liters);
void uiShowDispense(float liters);
void uiShowMessage(const char* title, const char* sub);
void uiDrawQrMono(const uint8_t* mono, size_t len);
void uiLoop();
