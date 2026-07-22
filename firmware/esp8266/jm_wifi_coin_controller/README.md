# JM WiFi Coin Vendo — ESP8266 Firmware

Coin acceptor + OLED display para sa **JM WiFi Cloud** (`https://jmtechsolution.cloud/allvendo`).

## Display

| State | OLED |
|-------|------|
| Idle | **INSERT COIN** (blink) + `X min / coin` |
| Coin inserted | **VOUCHER** + code + minutes |
| Error | WiFi / cloud / register message |

## Wiring (NodeMCU)

| Part | Pin |
|------|-----|
| OLED SDA | D2 (GPIO4) |
| OLED SCL | D1 (GPIO5) |
| Coin pulse | D5 (GPIO14) |
| Coin GND | GND |
| Buzzer (optional) | D3 (GPIO0) |
| LED | D4 (GPIO2, built-in) |

Coin acceptor: 12V PSU hiwalay; pulse wire lang sa D5, common GND sa ESP.

## Flash

### Arduino IDE

1. Board: **NodeMCU 1.0 (ESP-12E)**
2. Libraries: `ArduinoJson`, `Adafruit GFX`, `Adafruit SSD1306`
3. Edit sa `.ino`:
   - `WIFI_SSID`, `WIFI_PASS`
   - `API_KEY` — mula sa portal **+ Add ESP8266 Coin Machine**
   - `DEVICE_NAME`
4. Upload, Serial Monitor **115200**

### PlatformIO

```bash
cd firmware/esp8266/jm_wifi_coin_controller
pio run -t upload
pio device monitor -b 115200
```

## Portal: mag-add ng vendo

1. Login sa monitoring portal → **ALL VENDO** → **Cloud Hotspot**
2. **+ Add ESP8266 Coin Machine**
3. Piliin ang MikroTik site, name, minutes/coin
4. Copy **API key** → ilagay sa firmware
5. Flash ESP8266 → dapat lumabas ang **INSERT COIN** sa OLED

## API (cloud)

- `POST /api/register-device` — auto sa boot
- `POST /api/heartbeat` — config sync
- `POST /api/coin-insert` — bawat coin → voucher code
