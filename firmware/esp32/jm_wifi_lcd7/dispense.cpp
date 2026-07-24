#include "dispense.h"
#include "pins.h"

static volatile uint32_t g_pulseCount = 0;

static void IRAM_ATTR onFlowPulse() {
  g_pulseCount++;
}

void dispenseInit() {
  pinMode(PIN_DISPENSE_RELAY, OUTPUT);
#if RELAY_ACTIVE_LOW
  digitalWrite(PIN_DISPENSE_RELAY, HIGH);  // relay OFF
#else
  digitalWrite(PIN_DISPENSE_RELAY, LOW);
#endif
  pinMode(PIN_FLOW_METER, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW_METER), onFlowPulse, FALLING);
  Serial.printf("PINS: relay=GPIO%d flow=GPIO%d pulses/L default=%d\n",
    PIN_DISPENSE_RELAY, PIN_FLOW_METER, DEFAULT_PULSES_PER_LITER);
}

bool dispenseLiters(float liters, int pulsesPerLiter) {
  if (liters <= 0 || pulsesPerLiter <= 0) {
    Serial.println("DISPENSE: invalid liters/pulsesPerLiter");
    return false;
  }

  uint32_t target = (uint32_t)(liters * pulsesPerLiter + 0.5f);
  if (target == 0) target = 1;

  Serial.printf("DISPENSE: %.3f L -> %u pulses\n", liters, target);
  g_pulseCount = 0;
#if RELAY_ACTIVE_LOW
  digitalWrite(PIN_DISPENSE_RELAY, LOW);   // relay ON
#else
  digitalWrite(PIN_DISPENSE_RELAY, HIGH);
#endif

  unsigned long start = millis();
  const unsigned long timeoutMs = (unsigned long)(liters * 120000) + 60000;

  while (g_pulseCount < target) {
    if (millis() - start > timeoutMs) {
      Serial.println("DISPENSE: timeout");
#if RELAY_ACTIVE_LOW
      digitalWrite(PIN_DISPENSE_RELAY, HIGH);
#else
      digitalWrite(PIN_DISPENSE_RELAY, LOW);
#endif
      return false;
    }
    delay(5);
  }

#if RELAY_ACTIVE_LOW
  digitalWrite(PIN_DISPENSE_RELAY, HIGH);
#else
  digitalWrite(PIN_DISPENSE_RELAY, LOW);
#endif
  Serial.printf("DISPENSE: done (%u pulses)\n", g_pulseCount);
  return true;
}
