# BANKERO GASOLINE LCD-7 — MRP Vendo Cloud

Ang device card sa **vendo-admin** (`/vendo-admin`) ay galing sa **MRP backend** (`/api/vendo`), **hindi** sa `/allvendo` hotspot admin.

## ONLINE rule

- **ONLINE** = may `GET /api/vendo/config` within **2 minutes**
- **OFFLINE** = walang ping > 2 min

## Config (`config.h`)

| Setting | Value |
|---------|--------|
| `WIFI_SSID` | `PPPOE-ACCESS` |
| `WIFI_PASS` | `Father@services1985` |
| `CLOUD_HOST` | `jmtechsolution.cloud` |
| `DEVICE_ID` | `LCD7S3` |
| `API_KEY` | mula sa vendo-admin device card |

## Flash

1. `cp config.h.example config.h` — fill API key
2. Arduino IDE → ESP32-S3 → COM6 → Upload
3. Serial Monitor 115200

**Dapat makita:**
```
WiFi OK
GET /api/vendo/config -> 200
Cloud OK — BANKERO GASOLINE LCD-7 · ₱95/L
```

## Test mula sa PC

```bash
curl -s "https://jmtechsolution.cloud/api/vendo/config" \
  -H "X-Device-Id: LCD7S3" \
  -H "X-Api-Key: YOUR_GV_KEY"
```

Pag 200 ang response, magiging **ONLINE** sa vendo-admin within ~1 min (refresh page).
