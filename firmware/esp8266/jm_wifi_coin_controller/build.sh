#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PIO="${PIO:-$HOME/.local/bin/pio}"
if ! command -v "$PIO" >/dev/null 2>&1; then
  PIO=pio
fi

echo "Building JM WiFi Coin Vendo (wireless)..."
"$PIO" run -e nodemcuv2_release

OUT=".pio/build/nodemcuv2_release"
RELEASE="releases"
mkdir -p "$RELEASE"

cp -f "$OUT/firmware.bin" "$RELEASE/jm-wifi-coin-vendo-wireless.bin"
cp -f "$OUT/firmware.elf" "$RELEASE/jm-wifi-coin-vendo-wireless.elf" 2>/dev/null || true

# Combined image for esptool (boot + app) — common for NodeMCU flash at 0x0
if [ -f "$OUT/bootloader.bin" ] && [ -f "$OUT/partitions.bin" ]; then
  python3 - <<'PY' "$OUT" "$RELEASE/jm-wifi-coin-vendo-wireless-merged.bin"
import sys
from pathlib import Path
out, merged = Path(sys.argv[1]), Path(sys.argv[2])
parts = []
# ESP8266 Arduino: boot at 0x0, app at 0x10000 typically for non-OTA single app
boot = out / "bootloader.bin"
app = out / "firmware.bin"
if boot.exists() and app.exists():
    data = bytearray(0x10000)
    boot_data = boot.read_bytes()
    data[0:len(boot_data)] = boot_data
    merged.write_bytes(bytes(data) + app.read_bytes())
    print("merged:", merged)
PY
fi

ls -lh "$RELEASE"/*.bin
echo ""
echo "Ready to flash:"
echo "  firmware only @ 0x00000: $RELEASE/jm-wifi-coin-vendo-wireless.bin"
echo ""
echo "esptool example:"
echo "  esptool.py --port /dev/ttyUSB0 write_flash 0x00000 $RELEASE/jm-wifi-coin-vendo-wireless.bin"
