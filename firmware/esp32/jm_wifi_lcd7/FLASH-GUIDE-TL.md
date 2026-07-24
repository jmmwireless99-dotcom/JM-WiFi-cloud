# BANKERO LCD7 — Flash Guide (Tagalog)

Para sa device card na **BANKERO GASOLINE LCD-7** (`LCD7S3`) na **OFFLINE** sa vendo-admin.

---

## Step 1 — Ihanda ang config.h

Sa folder `jm_wifi_lcd7`:

```bash
cp config.h.example config.h
```

Buksan ang `config.h` at siguraduhing ganito:

| Setting | Dapat na value |
|---------|----------------|
| `WIFI_SSID` | `PPPOE-ACCESS` |
| `WIFI_PASS` | `Father@services1985` |
| `DEVICE_ID` | `LCD7S3` |
| `API_KEY` | `gv_...` mula sa vendo-admin (Rotate key kung wala) |

**Importante:** Kung `PASTE_VENDO_API_KEY_HERE` pa rin ang API key, **OFFLINE forever** ang device.

---

## Step 2 — Wiring (GPIO)

| Wire | Saan sa board |
|------|---------------|
| Relay IN | **Sensor AD** terminal = **GPIO 6** |
| Flow meter signal | **UART1 P1 TX** = **GPIO 43** |
| Coin pulse (kung meron) | **UART1 P1 RX** = **GPIO 44** |

**Huwag** i-wire sa GPIO 16 o 17 — mali iyon sa Waveshare LCD7.

---

## Step 3 — Arduino IDE upload

1. I-connect ang ESP32 sa PC (COM port, hal. COM6)
2. Board: **ESP32S3 Dev Module** o Waveshare LCD7 profile
3. Upload Speed: 921600
4. **Upload** ang sketch
5. Buksan ang **Serial Monitor** → **115200 baud**
6. I-reset ang board

---

## Step 4 — I-check ang Serial output

Dapat may lumabas na:

```
PINS: relay=GPIO6 flow=GPIO43 pulses/L default=100
WiFi OK ...
Cloud OK — BANKERO GASOLINE LCD-7 · PHP 95/L · 100 pulses/L
```

Kung `WiFi FAILED` → check SSID/password o signal.

Kung `VENDO: invalid DEVICE_ID or API_KEY` → mali ang `config.h`.

Kung `Cloud OK` → within 1–2 min **ONLINE** na sa vendo-admin (Ctrl+F5 refresh).

---

## Step 5 — Kung wala pa ring Cloud OK

1. Test mula sa PC (same network o internet):

```bash
curl -s "https://jmtechsolution.cloud/api/vendo/config" \
  -H "X-Device-Id: LCD7S3" \
  -H "X-Api-Key: ILAGAY_ANG_GV_KEY"
```

2. Kung 200 ang response → cloud OK, ESP32 lang ang kailangan i-flash ulit.
3. Kung 401 → Rotate key sa vendo-admin, ilagay sa `config.h`, flash ulit.

---

## Pinout reference

Naka-save na sa `pins.h` — huwag nang hanapin sa lumang chat. Buong detalye: `HARDWARE-PINS.md`.
