#!/bin/bash
# Deploy jmtechsolution.cloud sidebar fix
# Removes: All Vendo, Empty Bottle, Cloud Hotspot
#
# Run ON THE VPS (as root or sudo):
#   curl -sL https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/cursor/jmwifi-hotspot-system-3173/deploy/update-jmtechsolution-portal.sh | sudo bash

set -e

BRANCH="cursor/jmwifi-hotspot-system-3173"
RAW_URL="https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/${BRANCH}/site/monitoring/index.html"
TMP="/tmp/jmtech-index-fixed.html"

echo "Downloading fixed portal from GitHub..."
curl -fsSL "$RAW_URL" -o "$TMP"

if grep -q "Empty Bottle" "$TMP" || grep -q "Cloud Hotspot" "$TMP"; then
  echo "ERROR: Downloaded file still contains sidebar items!"
  exit 1
fi

echo "OK: Empty Bottle, Cloud Hotspot, All Vendo — removed from file"

# Find current deployed file
FOUND=""
for path in $(grep -rl "Empty Bottle" /var/www /opt /home 2>/dev/null | grep -E "index\.html$" | head -5); do
  if grep -q "Remote Monitoring Portal\|Live Wall" "$path" 2>/dev/null; then
    FOUND="$path"
    break
  fi
done

if [ -z "$FOUND" ]; then
  # Try common Express static paths
  for path in \
    "/opt/jmtech/public/index.html" \
    "/var/www/html/index.html" \
    "/var/www/jmtechsolution.cloud/index.html" \
    "/home/*/jmtech*/public/index.html"; do
    if [ -f $path ] 2>/dev/null; then
      FOUND=$(ls $path 2>/dev/null | head -1)
      break
    fi
  done
fi

if [ -z "$FOUND" ]; then
  echo ""
  echo "Could not auto-find portal file. Run manually:"
  echo "  grep -r 'Empty Bottle' /var/www /opt /home 2>/dev/null"
  echo "  cp $TMP /path/to/index.html"
  echo ""
  echo "Then restart Node/Express if needed:"
  echo "  pm2 restart all   OR   systemctl restart jmtech"
  exit 1
fi

cp "$FOUND" "${FOUND}.bak.$(date +%Y%m%d%H%M%S)"
cp "$TMP" "$FOUND"
echo "Deployed to: $FOUND"

# Restart common process managers
if command -v pm2 &>/dev/null; then
  pm2 restart all 2>/dev/null || true
fi
if systemctl is-active jmtech &>/dev/null; then
  systemctl restart jmtech
fi

echo ""
echo "DONE! Hard-refresh browser: Ctrl+Shift+R"
echo "Sidebar should show: Gasoline Vendo -> JM Market (no All Vendo section)"
