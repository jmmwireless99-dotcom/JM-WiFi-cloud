# JM Gas Dispenser — GPIO Pinout

| Function | GPIO | Wire |
|----------|------|------|
| **Coin pulse** | **12** | Coin acceptor PULSE |
| **Bill pulse** | **13** | Bill acceptor PULSE |
| **Flow meter** | **14** | YF-S201 signal |
| **Nextion TX** | **21** | → Nextion RX |
| **Nextion RX** | **22** | ← Nextion TX |
| **Pause button** | **26** | GND on press |
| **Start button** | **27** | GND on press |
| **Relay (pump)** | **33** | Relay IN |

## Bill acceptor wiring

```
Bill acceptor PULSE  →  GPIO 13
Bill acceptor GND    →  ESP32 GND
Bill acceptor 12V    →  Separate PSU (NOT ESP32 3.3V)
```

Set **Bill Value** sa web portal (`http://192.168.4.1`):
- 1 pulse = ₱20 bill → `billValue = 20`
- 1 pulse = ₱50 bill → `billValue = 50`
- 2 pulses = ₱100 bill → `billValue = 50` (per pulse)

Connect phone/laptop to WiFi **GAS PREMIUM** (password: `admin123`).
