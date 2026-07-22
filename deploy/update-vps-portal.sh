#!/bin/bash
# Update JM All Vendo on VPS and verify captive portal build
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/jm-wifi-cloud}"
BRANCH="${BRANCH:-cursor/all-vendo-jmtechsolution-7ec1}"

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

# Ensure .env has BASE_PATH for /allvendo
if ! grep -q '^BASE_PATH=' .env 2>/dev/null; then
  echo 'BASE_PATH=/allvendo' >> .env
fi
sed -i 's|^BASE_URL=.*|BASE_URL=https://jmtechsolution.cloud|' .env || true

npm install --omit=dev
sudo systemctl restart jm-allvendo
sleep 2

echo "=== Portal build check ==="
curl -sI "http://127.0.0.1:${PORT:-3020}/allvendo/mikrotik/login-test.html" | grep -i x-jm-portal || true
curl -sI "https://jmtechsolution.cloud/allvendo/mikrotik/login-test.html" | grep -i x-jm-portal || true
echo "Done. Sa admin: Hotspot Server → Save & Push para ma-upload ang login.html sa MikroTik."
