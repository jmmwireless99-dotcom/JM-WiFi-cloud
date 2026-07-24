# ESP32-S3 LCD7 — JM WiFi Cloud heartbeat

Para **ONLINE** ang device sa dashboard, kailangan mag-send ang ESP32 ng heartbeat sa cloud **every 30 seconds**.

## 1. I-configure bago i-flash

```bash
cp config.h.example config.h
```

Edit `config.h`:

| Setting | Value |
|---------|--------|
| `WIFI_SSID` | `PPPOE-ACCESS` |
| `WIFI_PASS` | `Father@services1985` |
| `CLOUD_URL` | `https://jmtechsolution.cloud/allvendo` |
| `API_KEY` | mula sa **Admin → Vendo List → API Key** (BANKERO site) |
| `DEVICE_NAME` | hal. `BANKERO-GAS-LCD7` |

## 2. Flash firmware

1. Arduino IDE → Board: **ESP32-S3**
2. Port: **COM6** (o kung saan naka-plug ang ESP)
3. Upload `jm_wifi_lcd7.ino`
4. Serial Monitor → **115200**

## 3. Serial Monitor — dapat makita ito

**Kung connected sa `PPPOE-ACCESS` at tama ang API key:**

```
WiFi connecting to SSID: PPPOE-ACCESS
WiFi OK
  SSID: PPPOE-ACCESS
  IP:   192.168.x.x
POST https://jmtechsolution.cloud/allvendo/api/heartbeat -> 200
Heartbeat OK — online sa cloud
```

**Kung hindi connected sa WiFi:**

```
WiFi FAILED — check SSID/password (PPPOE-ACCESS)
WiFi: DISCONNECTED
```

**Kung WiFi OK pero OFFLINE pa rin sa dashboard:**

- Mali ang `API_KEY` sa `config.h`
- Walang internet ang `PPPOE-ACCESS` network (kailangan may outbound HTTPS)
- Mali ang `CLOUD_URL` — dapat may `/allvendo`

## Dashboard rule

- **Online** = may heartbeat within **5 minutes**
- **Offline** = walang heartbeat > 5 min (kahit naka-on ang ESP)

## Test mula sa PC (optional)

Palitan ang `YOUR_API_KEY` mula sa Vendo List:

```bash
curl -X POST "https://jmtechsolution.cloud/allvendo/api/heartbeat" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"mac_address":"AA:BB:CC:DD:EE:FF","device_type":"esp32-s3","name":"BANKERO-GAS-LCD7"}'
```

Dapat: `{ "ok": true, "status": "online" }`
