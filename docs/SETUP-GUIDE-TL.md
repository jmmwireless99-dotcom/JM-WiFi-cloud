# JM WiFi Cloud All Vendo — Setup Guide (Tagalog)

Para sa VPS: **jmtechsolution.cloud**  
Gaya ng Kitifi: isang cloud server, maraming vendo.

## 1) I-install sa VPS

```bash
sudo bash deploy/install-vps.sh
```

I-set ang DNS: `jmwifi.jmtechsolution.cloud` → IP ng VPS.

Buksan: `https://jmwifi.jmtechsolution.cloud/admin/`

Default login:
- Email: `admin@jmtechsolution.cloud`
- Password: `admin123`

**Palitan agad ang password** (pwedeng via API `POST /api/admin/change-password`).

## 2) Magdagdag ng Vendo

1. Sa dashboard → **Mga Vendo** → **+ Bagong Vendo**
2. Lagyan ng pangalan, address, minutes/coin, MikroTik host
3. I-save ang **API Key** — ito ang key ng site na iyon

## 3) MikroTik

1. I-edit `mikrotik/hotspot-setup.rsc` — `cloudUrl` = `https://jmwifi.jmtechsolution.cloud`
2. I-edit `mikrotik/login.html` — palitan `YOUR_SITE_ID`
3. Upload login.html sa `flash/hotspot/`
4. `/import file-name=hotspot-setup.rsc`
5. I-verify walled garden may `jmwifi.jmtechsolution.cloud`

## 4) ESP8266 Coin Controller

Sa Arduino sketch:

```cpp
const char* CLOUD_URL = "https://jmwifi.jmtechsolution.cloud";
const char* API_KEY   = "api-key-mula-sa-dashboard";
```

Coin pulse → GPIO D2 → cloud `/api/coin-insert` → voucher code.

## 5) Client flow

1. Connect sa WiFi hotspot
2. Captive portal → cloud `/portal/?site_id=...`
3. Mag-coin o maglagay ng voucher
4. Cloud gumagawa ng MikroTik hotspot user
5. May internet na ang client

## 6) Multi-vendo (All Vendo)

Ulitin ang hakbang 2–4 para sa bawat tindahan/location.

Sa **Reports** makikita ang:
- Daily / weekly / monthly sales
- Breakdown per vendo
- Active sessions at device online status

Ito ang “all vendo” control plane — katulad ng Kitifi central server, pero branded JM WiFi Cloud.
