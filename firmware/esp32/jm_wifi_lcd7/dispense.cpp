#include "dispense.h"
#include "config.h"

#if !defined(PIN_DISPENSE_RELAY)
#define PIN_DISPENSE_RELAY 16
#endif
#if !defined(PIN_FLOW_METER)
#define PIN_FLOW_METER 17
#endif

static volatile uint32_t g_pulseCount = 0;

static void IRAM_ATTR onFlowPulse() {
  g_pulseCount++;
}

void dispenseInit() {
  pinMode(PIN_DISPENSE_RELAY, OUTPUT);
  digitalWrite(PIN_DISPENSE_RELAY, LOW);
  pinMode(PIN_FLOW_METER, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW_METER), onFlowPulse, FALLING);
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
  digitalWrite(PIN_DISPENSE_RELAY, HIGH);

  unsigned long start = millis();
  const unsigned long timeoutMs = (unsigned long)(liters * 120000) + 60000;

  while (g_pulseCount < target) {
    if (millis() - start > timeoutMs) {
      Serial.println("DISPENSE: timeout");
      digitalWrite(PIN_DISPENSE_RELAY, LOW);
      return false;
    }
    delay(5);
  }

  digitalWrite(PIN_DISPENSE_RELAY, LOW);
  Serial.printf("DISPENSE: done (%u pulses)\n", g_pulseCount);
  return true;
}
