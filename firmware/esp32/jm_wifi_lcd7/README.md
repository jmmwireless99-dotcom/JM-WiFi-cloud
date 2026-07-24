# ESP32-S3 LCD7 — JM WiFi Cloud heartbeat

Para **ONLINE** ang device sa dashboard, kailangan mag-send ang ESP32 ng heartbeat sa cloud **every 30 seconds**.

## Serial Monitor (COM6) — paano malaman kung connected

1. Arduino IDE → Tools → Port → **COM6**
2. Tools → Baud → **115200**
3. I-reset ang ESP32 (button EN) o i-unplug/plug USB

**Kung connected sa `candelaria-kitifi`:**
```
WiFi connecting to SSID: candelaria-kitifi
WiFi OK
  SSID: candelaria-kitifi
  IP:   192.168.x.x
Heartbeat OK — online sa cloud
```

**Kung hindi connected:**
```
WiFi FAILED — check password o SSID candelaria-kitifi
WiFi: DISCONNECTED
```

**Kung WiFi OK pero OFFLINE pa rin sa dashboard:**
- Mali ang `API_KEY` sa firmware
- Kulang ang URL — dapat `https://jmtechsolution.cloud/allvendo`
- Walang internet ang WiFi (local LAN lang)

## CONFIG sa firmware

```cpp
const char* WIFI_SSID = "candelaria-kitifi";
const char* WIFI_PASS = "password_ng_kitifi_wifi";
const char* API_KEY   = "api_key_mula_sa_Vendo_List";
```

1. **WiFi** — naka-connect ba sa internet? (hindi lang sa local LAN)
2. **CLOUD_URL** — dapat `https://jmtechsolution.cloud/allvendo` (may `/allvendo`)
3. **API_KEY** — same key sa Vendo site sa admin (X-API-Key header)
4. **Heartbeat loop** — dapat tumatakbo every 30s:
   - `POST /allvendo/api/register-device`
   - `POST /allvendo/api/heartbeat` with `device_id` + `mac_address`
5. **Last seen** — kung lumang date (hal. 7/19), huminto ang heartbeat mula noon

## Dashboard rule

- **Online** = may heartbeat within **5 minutes**
- **Offline** = walang heartbeat > 5 min (kahit naka-on ang ESP)

## Test mula sa VPS/PC

```bash
curl -X POST "https://jmtechsolution.cloud/allvendo/api/heartbeat" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"mac_address":"AA:BB:CC:DD:EE:FF","device_type":"esp32-s3","name":"LCD7S3-test"}'
```

Dapat `{ "ok": true, "status": "online" }`

## Flash firmware

Edit `jm_wifi_lcd7.ino`:
- `WIFI_SSID`, `WIFI_PASS`
- `API_KEY` from Vendo List
- `DEVICE_NAME` (hal. LCD7S3)

Upload sa ESP32-S3, buksan Serial Monitor 115200 — dapat makita `Heartbeat OK`.
