# JM WiFi Coin Vendo — ESP8266 Wireless Firmware

**Ready-to-flash BIN:** [`releases/jm-wifi-coin-vendo-wireless.bin`](releases/jm-wifi-coin-vendo-wireless.bin)

Wireless setup — hindi na kailangan i-hardcode ang WiFi sa code. Unang boot, magbubukas ang setup portal.

## Flash (ready .bin)

### NodeMCU Flash Tool (Windows — pinakamadali)

1. Download [NodeMCU Flasher](https://github.com/nodemcu/nodemcu-flasher) o [ESP8266 Download Tool](https://www.espressif.com/en/support/download/other-tools)
2. Piliin ang COM port ng NodeMCU
3. **Flash address:** `0x00000`
4. File: `releases/jm-wifi-coin-vendo-wireless.bin`
5. Click **Flash**

### esptool (Linux / Mac)

```bash
pip install esptool
esptool.py --chip esp8266 --port /dev/ttyUSB0 --baud 115200 write_flash -fm dio 0x00000 releases/jm-wifi-coin-vendo-wireless.bin
```

Windows COM port hal: `COM3`

### Arduino IDE

Tools → ESP8266 Flash Size: **4MB (FS:2MB OTA:~1019KB)**  
Use **esptool** command above, or upload from source via PlatformIO.

## First-time wireless setup

1. Power on ang ESP8266
2. Sa phone/laptop, connect sa WiFi: **`JM-CoinSetup`**
3. Buksan ang browser: **http://192.168.4.1**
4. Ilagay:
   - Shop WiFi SSID + password
   - **JM API Key** (mula sa portal → ALL VENDO → + Add ESP8266)
   - Device name (hal. `CoinMachine-01`)
5. Save → magre-restart → OLED: **INSERT COIN**

### Re-open setup later

- Hold **D6 (GPIO12)** button **3 seconds** sa boot, o
- Kung hindi makakonekta sa WiFi, auto magbubukas ang `JM-CoinSetup` AP

## Wiring (NodeMCU)

| Part | Pin |
|------|-----|
| OLED SDA | D2 (GPIO4) |
| OLED SCL | D1 (GPIO5) |
| Coin pulse | D5 (GPIO14) |
| Config button (optional) | D6 (GPIO12) → GND |
| Coin GND | GND |

## Build from source

```bash
cd firmware/esp8266/jm_wifi_coin_controller
./build.sh
# Output: releases/jm-wifi-coin-vendo-wireless.bin
```

## Cloud

- URL: `https://jmtechsolution.cloud/allvendo`
- Portal: ALL VENDO → **+ Add ESP8266** → copy API key
