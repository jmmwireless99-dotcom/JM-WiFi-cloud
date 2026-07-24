# BANKERO GASOLINE LCD-7 — ESP32-S3 Firmware

Buong firmware para sa **Waveshare ESP32-S3-Touch-LCD-7** (`LCD7S3`) sa **MRP Vendo Cloud**.

| | |
|---|---|
| Dashboard | https://jmtechsolution.cloud/vendo-admin |
| Pay page (phone) | https://jmtechsolution.cloud/pay/LCD7S3 |
| Device ID | `LCD7S3` |
| Cloud API | `https://jmtechsolution.cloud/api/vendo` |

## Bakit OFFLINE sa vendo-admin?

Ang card ay **OFFLINE** kapag walang `GET /api/vendo/config` sa loob ng **2 minuto**.

Karaniwang dahilan:
1. **Hindi pa na-flash** ang bagong firmware (o mali ang `config.h` — blank API key)
2. **Mali ang WiFi** — dapat `PPPOE-ACCESS`
3. **Lumang firmware** — gumagamit pa ng `/allvendo` heartbeat (mali ang endpoint)

**Solusyon:** i-flash ulit gamit ang steps sa ibaba. Tingnan din ang [FLASH-GUIDE-TL.md](FLASH-GUIDE-TL.md).

## GPIO Pinout (Waveshare LCD7)

**Huwag gamitin ang GPIO 16 at 17** — RS485 at LCD blue channel iyon sa board na ito.

| Function | GPIO | Waveshare header | Wire |
|----------|------|------------------|------|
| **Relay (pump/solenoid)** | **6** | Sensor AD (PH2.0) | Relay IN → AD pin |
| **Flow meter (YF-S201)** | **43** | UART1 P1 — TX | Flow signal → TX |
| **Coin acceptor** (optional) | **44** | UART1 P1 — RX | Coin pulse → RX |

Relay: **LOW = ON** (active-low module). Flow: **FALLING edge**, 100 pulses/L.

Buong board map: [HARDWARE-PINS.md](HARDWARE-PINS.md)

## Flash sa COM6 — PlatformIO (same as dati)

Naka-set na ang **COM6** sa `platformio.ini`.

### Quick flash (Windows)

Double-click sa PC mo:

```
flash-com6-pio.bat
```

### Manual (Cursor terminal sa PC)

```bat
cd firmware\esp32\jm_wifi_lcd7
pio run -e lcd7s3 -t upload
pio device monitor -e lcd7s3
```

Kung wala ang `pio`: `pip install platformio` o VS Code + **PlatformIO extension**.

Build only: `pio run -e lcd7s3`

### VS Code PlatformIO

1. Open folder `firmware/esp32/jm_wifi_lcd7`
2. Bottom bar: **lcd7s3** → **Upload** → **Monitor**


## Dapat makita sa Serial (115200)

```
=== BANKERO GASOLINE LCD-7 ===
Device: LCD7S3
PINS: relay=GPIO6 flow=GPIO43 pulses/L default=100
WiFi OK 192.168.x.x
Cloud OK — BANKERO GASOLINE LCD-7 · PHP 95/L · 100 pulses/L
```

Every 15s: `Cloud OK` → **ONLINE** sa vendo-admin (hard refresh ang page).

## Files

| File | Purpose |
|------|---------|
| `jm_wifi_lcd7.ino` | Main loop |
| `config.h` | WiFi, DEVICE_ID, API_KEY |
| `pins.h` | GPIO relay / flow / coin |
| `vendo_client.cpp` | MRP API client |
| `dispense.cpp` | Relay + flow pulses |
| `ui_bankero.cpp` | Waveshare LCD + LVGL |

## Test cloud mula sa PC

```bash
curl -s "https://jmtechsolution.cloud/api/vendo/config" \
  -H "X-Device-Id: LCD7S3" \
  -H "X-Api-Key: YOUR_GV_KEY"
```

Kung HTTP 200, tama ang cloud. Ang ESP32 lang ang kailangan mag-flash para mag-ONLINE ang card.
