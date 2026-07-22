#!/bin/bash
# Deploy jmtechsolution.cloud portal update (ALL VENDO button)
#
# Run ON THE VPS (as root or sudo):
#   curl -sL https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/cursor/jmwifi-hotspot-system-3173/deploy/update-jmtechsolution-portal.sh | sudo bash

set -e

BRANCH="cursor/jmwifi-hotspot-system-3173"
RAW_URL="https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/${BRANCH}/site/monitoring/index.html"
TMP="/tmp/jmtech-index-fixed.html"
TARGET="${1:-/opt/mrp/public/index.html}"

echo "Downloading portal from GitHub..."
curl -fsSL "$RAW_URL" -o "$TMP"

if ! grep -q "ALL VENDO" "$TMP"; then
  echo "ERROR: Downloaded file missing ALL VENDO button!"
  exit 1
fi

echo "OK: ALL VENDO button found in file"

if [ ! -f "$TARGET" ]; then
  for path in \
    "/opt/mrp/public/index.html" \
    "/opt/jmtech/public/index.html" \
    "/var/www/html/index.html" \
    "/var/www/jmtechsolution.cloud/index.html"; do
    if [ -f "$path" ]; then
      TARGET="$path"
      break
    fi
  done
fi

if [ ! -f "$TARGET" ]; then
  echo ""
  echo "Could not find portal file. Run manually:"
  echo "  cp $TMP /opt/mrp/public/index.html"
  echo "  systemctl restart mrp-backend.service"
  exit 1
fi

cp "$TARGET" "${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
cp "$TMP" "$TARGET"
echo "Deployed to: $TARGET"

if systemctl is-active mrp-backend &>/dev/null; then
  systemctl restart mrp-backend
  echo "Restarted mrp-backend.service"
elif command -v pm2 &>/dev/null; then
  pm2 restart all 2>/dev/null || true
fi

echo ""
echo "DONE! Hard-refresh browser: Ctrl+Shift+R"
echo "Sidebar should show: Gasoline Vendo -> ALL VENDO -> JM Market"
