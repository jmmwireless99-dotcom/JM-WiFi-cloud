#!/bin/bash
# Deploy monitoring portal sidebar fix to jmtechsolution.cloud VPS
# Removes Empty Bottle and Cloud Hotspot from sidebar
#
# Usage on VPS:
#   sudo bash deploy/update-jmtechsolution-portal.sh

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$REPO_DIR/site/monitoring/index.html"

# Common deploy paths — edit if your server uses a different path
TARGETS=(
  "/var/www/jmtechsolution.cloud/index.html"
  "/opt/jmtechsolution/public/index.html"
  "/home/jmtech/index.html"
)

if [ ! -f "$SOURCE" ]; then
  echo "Error: $SOURCE not found"
  exit 1
fi

echo "Deploying monitoring portal (Empty Bottle + Cloud Hotspot removed)..."

DEPLOYED=0
for TARGET in "${TARGETS[@]}"; do
  if [ -f "$TARGET" ] || [ -d "$(dirname "$TARGET")" ]; then
    cp "$TARGET" "${TARGET}.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    cp "$SOURCE" "$TARGET"
    echo "  Updated: $TARGET"
    DEPLOYED=1
  fi
done

if [ "$DEPLOYED" -eq 0 ]; then
  echo ""
  echo "No default target found. Copy manually:"
  echo "  cp $SOURCE /path/to/jmtechsolution.cloud/index.html"
  echo ""
  echo "To find current file on VPS:"
  echo "  grep -r 'Empty Bottle' /var/www /opt /home 2>/dev/null | head -5"
  exit 1
fi

echo "Done. Hard-refresh browser (Ctrl+Shift+R) to see changes."
