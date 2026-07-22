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

## 3) MikroTik — CENTRAL captive portal (Kitifi-style)

Lahat ng VLAN (hal. 101, 102) dadaan sa **isang** hotspot gateway: **`10.0.0.1`**.

1. I-edit `mikrotik/hotspot-setup.rsc` — palitan `YOUR_SITE_ID`, ayusin `vlanIds` kung kailangan
2. O sa VPS: `source /root/.jm-mikrotik.env && node deploy/push-mikrotik.js`
3. I-verify:
   - `/ip hotspot print` → **CENTRAL** on `bridge-hotspot`
   - `/ip address print` → **10.0.0.1/24**
   - Clients sa VLAN101/102 = DHCP `10.0.0.x`, portal = `10.0.0.1`
4. Walled garden: `jmtechsolution.cloud` + `*.jmtechsolution.cloud`
5. Cloud portal: `https://jmtechsolution.cloud/allvendo/portal/?site_id=...`

**Huwag** gumawa ng per-VLAN hotspot (10.101.x / 10.102.x) — central model lang.

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
