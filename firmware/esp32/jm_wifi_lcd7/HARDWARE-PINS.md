# BANKERO LCD7 — Pin Allocation Reference

## Status ng firmware source

| Location | May stable firmware? |
|----------|----------------------|
| ESP32 flash (tested mo na) | **OO** — display OK, dispense gumagana |
| Git repo / VPS | **HINDI** — wala ang original sketch na may tamang pins |
| Cloud agent transcript | **HINDI** — walang GPIO definitions |

Ang **stable firmware** ay naka-flash sa device lang. Ang `pins.h` sa repo ay **template + Waveshare-safe candidates** — kailangan i-verify laban sa actual wiring mo.

---

## Paano kunin ang tunay na pins mula sa flashed ESP32

### Option A — Arduino IDE (pinaka-madali)

1. I-connect ang ESP32 sa PC (COM6)
2. Arduino IDE → **File → Open Recent** — hanapin ang gasoline/LCD7/BANKERO sketch
3. O: **File → Preferences → Sketchbook location** → buksan ang folder → hanapin ang `.ino`
4. Hanapin sa code ang `#define PIN_`, `GPIO`, `relay`, `flow`, `coin`

### Option B — Serial Monitor sa boot

1. Serial Monitor **115200**
2. I-reset ang ESP32
3. Kung may print ang firmware ng `GPIO` / `pin` / `relay` sa startup — i-copy dito

### Option C — Basahin ang flash (advanced)

Sa PC na may COM6:

```bash
pip install esptool
esptool.py --port COM6 read_flash 0x10000 0x400000 /tmp/esp32_firmware.bin
strings /tmp/esp32_firmware.bin | grep -iE "GPIO|PIN_|relay|flow|coin|dispense"
```

I-paste ang output para ma-update ang `pins.h`.

---

## Waveshare ESP32-S3-Touch-LCD-7 — GPIO map

**Huwag gamitin ang mga pin na ito para sa relay/flow/coin** — ginagamit ng LCD, touch, SD, RS485:

| GPIO | Ginagamit ng board |
|------|-------------------|
| 0–5, 7, 10, 14, 17–18, 21, 38–42, 45–48 | RGB LCD data / sync |
| 4, 8, 9 | Touch I2C (SDA/SCL) + TP_IRQ |
| 11–13 | TF card SPI |
| 15–16 | RS485 TX/RX |
| 19–20 | USB / CAN |
| EXIO1–5 (CH422G) | TP_RST, backlight, LCD_RST, SD_CS |

### Mga pin na karaniwang libre para sa external wiring

| Header | Pins | Notes |
|--------|------|-------|
| **Sensor AD (PH2.0)** | **GPIO 6** | 3.3V, GND, AD — pwedeng digital input/output |
| **UART1 (P1, 4-pin)** | **GPIO 43 (TX), 44 (RX)** | Kung hindi ginagamit ang UART header |
| **I2C (P4)** | shared 8/9 | Ok lang kung I2C device, hindi para sa pulse interrupt |
| **CAN (P3)** | 19/20 | Kung walang CAN bus |

---

## Cloud config (MRP database)

| Device | Board | pulses/L | Role |
|--------|-------|----------|------|
| **LCD7S3** | ESP32-S3-Touch-LCD-7 | **100** | GCash QR display + vendo cloud |
| **F0C0FD** | ESP32-MAIN-desiel | **100** | Diesel pump MAIN (hiwalay na board) |

Ang **pulses_per_liter = 100** ay naka-save sa server — ibig sabihin ang firmware ay umiiral sa **100 flow pulses = 1 liter**.

---

## Wiring reference (typical gasoline vendo)

```
Flow meter (YF-S201):
  Signal  → GPIO (interrupt, INPUT_PULLUP)
  VCC     → 5V
  GND     → GND

Relay module (pump/solenoid):
  IN      → GPIO (OUTPUT)
  VCC     → 5V (hiwalay PSU kung kailangan)
  GND     → common GND sa ESP32

Coin acceptor (kung meron):
  Pulse   → GPIO (interrupt, INPUT_PULLUP)
  12V     → coin acceptor PSU (hiwalay)
```

---

## Repo `pins.h` — BANKERO LCD7 allocation

| Function | GPIO | Header |
|----------|------|--------|
| Dispense relay | **6** | Sensor AD (PH2.0) |
| Flow meter | **43** | UART1 P1 TX |
| Coin pulse | **44** | UART1 P1 RX |

**Babala:** Ang unang repo draft ay gumamit ng GPIO **16** at **17** — **MALI** sa Waveshare LCD7 (RS485 + LCD blue channel).

---

## Susunod na hakbang

1. Kunin ang tunay na pins mula sa stable firmware (Option A/B/C sa itaas)
2. I-update ang `pins.h` sa repo
3. I-commit para may permanent record na tayo

I-paste mo dito ang `#define` lines mula sa stable sketch o ang `strings` output — ia-update ko ang `pins.h` nang eksakto.
