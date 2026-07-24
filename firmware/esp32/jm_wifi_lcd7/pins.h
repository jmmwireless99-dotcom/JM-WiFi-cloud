/*
 * BANKERO GASOLINE LCD-7 — GPIO Pin Allocation
 * Board: Waveshare ESP32-S3-Touch-LCD-7 (800×480)
 *
 * IMPORTANT: Ang stable/tested firmware mo ay wala sa git — naka-flash lang sa ESP32.
 * I-verify ang mga pin dito gamit ang actual wiring o i-read mula sa flashed firmware
 * (tingnan HARDWARE-PINS.md).
 *
 * Huwag gamitin ang GPIO na naka-takda sa LCD/RS485/Touch/SD (nakalista sa HARDWARE-PINS.md).
 */

#pragma once

// ─── DISPENSE (pump solenoid relay) ───────────────────────────
// Active: LOW o HIGH — depende sa relay module (usually LOW-trigger)
#ifndef PIN_DISPENSE_RELAY
#define PIN_DISPENSE_RELAY  6    // TODO: verify — Sensor AD screw terminal (GPIO6)
#endif

// ─── FLOW METER (YF-S201 pulse output) ────────────────────────
// Interrupt on FALLING edge — 100 pulses/L sa cloud (LCD7S3)
#ifndef PIN_FLOW_METER
#define PIN_FLOW_METER      43   // TODO: verify — UART1 TX header (P1) kung libre
#endif

// ─── COIN ACCEPTOR (optional — kung may physical coin sa station) ─
// GCash QR ang primary payment; coin kung naka-wire pa rin
#ifndef PIN_COIN_PULSE
#define PIN_COIN_PULSE      44   // TODO: verify — UART1 RX header (P1)
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
