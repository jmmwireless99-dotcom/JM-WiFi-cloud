# JM Gas / Water Dispenser — Buong Firmware

ESP32 + Nextion LCD + Coin + **Bill acceptor** + Flow meter + Web portal

---

## Files sa folder na ito

| File | Purpose |
|------|---------|
| `jm_gas_dispenser.ino` | **Buong firmware** (1 file, lahat ng logic) |
| `platformio.ini` | PlatformIO config, COM6 |
| `PINS.md` | GPIO wiring |
| `flash-com6.bat` | One-click flash (Windows) |
| `README.md` | Ito |

---

## Features

- Coin acceptor (GPIO 12, PCNT hardware counter)
- **Bill acceptor (GPIO 13, PCNT)** — ₱ per pulse configurable
- Flow meter (GPIO 14, interrupt)
- Start / Pause buttons (GPIO 27 / 26)
- Relay pump (GPIO 33)
- Nextion LCD (GPIO 21 / 22)
- WiFi AP: **GAS PREMIUM** / `admin123`
- Web portal: **http://192.168.4.1**
- SPIFFS config + CSV sales history
- Button debounce + 5 min safety timeout

---

## GPIO Pinout

| Function | GPIO |
|----------|------|
| Coin pulse | **12** |
| Bill pulse | **13** |
| Flow meter | **14** |
| Nextion TX | **21** |
| Nextion RX | **22** |
| Pause | **26** |
| Start | **27** |
| Relay | **33** |

---

## Default settings

| Setting | Default |
|---------|---------|
| Price/L | ₱60 |
| Pulses/L | 450 |
| Coin value | ₱1 per pulse |
| Bill value | ₱20 per pulse |

Baguhin sa web portal pagkatapos ng flash.

---

## Flash — PlatformIO (COM6)

### Windows (madali)
```bat
cd firmware\esp32\jm_gas_dispenser
flash-com6.bat
```

### Manual
```bat
pip install platformio
cd firmware\esp32\jm_gas_dispenser
pio run -e esp32dev -t upload
pio device monitor -e esp32dev
```

### VS Code / Cursor
1. Open folder `firmware/esp32/jm_gas_dispenser`
2. PlatformIO → **esp32dev** → **Upload** → **Monitor**

---

## Pagkatapos ng flash

1. Serial Monitor 115200 — dapat may:
   ```
   === JM Gas Dispenser ===
   Coin GPIO12 | Bill GPIO13 | Flow GPIO14 | Relay GPIO33
   AP: GAS PREMIUM → http://192.168.4.1
   ```

2. Phone/laptop → WiFi **GAS PREMIUM** (pass: `admin123`)

3. Browser → **http://192.168.4.1** — settings + history

---

## Nextion HMI — kailangan na text fields

Sa Nextion Editor, gumawa ng mga text object:

| Object name | Sample text |
|-------------|-------------|
| `tCredit` | Credit: 0.00 |
| `tLiters` | Liters: 0.000 |
| `tPrice` | Price/L: 60.00 |
| `tCoin` | Coin: 1  Bill: 20 |
| `tState` | READY |

Upload ang `.tft` sa Nextion gamit ang SD card o USB-TTL.

---

## GitHub location

```
https://github.com/jmmwireless99-dotcom/JM-WiFi-cloud
Branch: cursor/all-vendo-jmtechsolution-7ec1
Path:   firmware/esp32/jm_gas_dispenser/
```

Pull/download:
```bat
git clone https://github.com/jmmwireless99-dotcom/JM-WiFi-cloud.git
cd JM-WiFi-cloud\firmware\esp32\jm_gas_dispenser
```

---

## Flow

```
Coin/Bill insert → credit +=
Start button     → relay ON, dispense
Flow pulses      → liters, credit -= cost
Credit = 0       → relay OFF, save history
Pause            → relay OFF, resume later
```
