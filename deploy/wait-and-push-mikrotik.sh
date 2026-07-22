#!/usr/bin/env bash
# Retry push to MikroTik until VPN tunnel is up
set -euo pipefail
export MIKROTIK_HOST="${MIKROTIK_HOST:-10.254.0.10}"
export MIKROTIK_API_PORT="${MIKROTIK_API_PORT:-8728}"
export MIKROTIK_USER="${MIKROTIK_USER:-admin}"
export MIKROTIK_PASS="${MIKROTIK_PASS:?set MIKROTIK_PASS}"
export SITE_ID="${SITE_ID:?set SITE_ID}"
export API_KEY="${API_KEY:-}"
export BASE_URL="${BASE_URL:-https://jmtechsolution.cloud/allvendo}"
export VLAN_ID="${VLAN_ID:-10}"
export WLAN_INTERFACE="${WLAN_INTERFACE:-wlan1}"

cd /opt/jm-wifi-cloud
echo "Waiting for MikroTik at ${MIKROTIK_HOST}:${MIKROTIK_API_PORT} ..."
for i in $(seq 1 60); do
  if timeout 2 bash -c "echo >/dev/tcp/${MIKROTIK_HOST}/${MIKROTIK_API_PORT}" 2>/dev/null; then
    echo "Reachable — pushing config (attempt $i)"
    node deploy/push-mikrotik.js && exit 0
  fi
  # also try via local API relay
  if [[ "$i" -eq 1 || $((i % 5)) -eq 0 ]]; then
    echo "  still offline... ($i) — reconnect SSTP/VPN on MikroTik to jmtechsolution.cloud"
  fi
  sleep 5
done
echo "FAILED: MikroTik not reachable after waiting"
exit 1
