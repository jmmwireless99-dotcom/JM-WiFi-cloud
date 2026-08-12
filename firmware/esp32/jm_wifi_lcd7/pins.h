/*
 * BANKERO GASOLINE LCD-7 — GPIO Pin Allocation
 * Board: Waveshare ESP32-S3-Touch-LCD-7 (800×480)
 *
 * Wiring sa Waveshare headers (hindi GPIO 16/17 — RS485 + LCD ang gumagamit noon):
 *
 *   Relay IN      → Sensor AD terminal (PH2.0)  = GPIO 6
 *   Flow signal   → UART1 P1 pin TX            = GPIO 43
 *   Coin pulse    → UART1 P1 pin RX            = GPIO 44  (optional)
 *
 * Tingnan HARDWARE-PINS.md para sa buong board map.
 */

#pragma once

// ─── DISPENSE (pump solenoid relay) ───────────────────────────
// Sensor AD screw terminal — PH2.0 header sa board
#ifndef PIN_DISPENSE_RELAY
#define PIN_DISPENSE_RELAY  6
#endif

// ─── FLOW METER (YF-S201 pulse output) ────────────────────────
// UART1 P1 header, TX pin — interrupt FALLING, 100 pulses/L (LCD7S3)
#ifndef PIN_FLOW_METER
#define PIN_FLOW_METER      43
#endif

// ─── COIN ACCEPTOR (optional — GCash QR ang primary payment) ───
// UART1 P1 header, RX pin
#ifndef PIN_COIN_PULSE
#define PIN_COIN_PULSE      44
#endif

// ─── STATUS LED (optional) ────────────────────────────────────
#ifndef PIN_STATUS_LED
#define PIN_STATUS_LED      (-1) // -1 = disabled
#endif

// ─── Relay logic ──────────────────────────────────────────────
#ifndef RELAY_ACTIVE_LOW
#define RELAY_ACTIVE_LOW    1    // 1 = LOW=ON (common relay module)
#endif

// Cloud fallback kung walang pulsesPerLiter sa /api/vendo/config
#ifndef DEFAULT_PULSES_PER_LITER
#define DEFAULT_PULSES_PER_LITER  100
#endif
