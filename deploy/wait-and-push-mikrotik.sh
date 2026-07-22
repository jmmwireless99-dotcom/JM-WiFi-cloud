#!/usr/bin/env bash
# Retry push CENTRAL hotspot (10.0.0.1) to MikroTik until VPN tunnel is up
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f /root/.jm-mikrotik.env ]]; then
  # shellcheck disable=SC1091
  source /root/.jm-mikrotik.env
fi
export MIKROTIK_HOST="${MIKROTIK_HOST:-10.90.0.27}"
export MIKROTIK_API_PORT="${MIKROTIK_API_PORT:-8728}"
export MIKROTIK_USER="${MIKROTIK_USER:-admin}"
export MIKROTIK_PASS="${MIKROTIK_PASS:?set MIKROTIK_PASS}"
export SITE_ID="${SITE_ID:?set SITE_ID}"
export API_KEY="${API_KEY:-}"
export BASE_URL="${BASE_URL:-https://jmtechsolution.cloud/allvendo}"
export VLAN_IDS="${VLAN_IDS:-101,102}"
export HS_GATEWAY="${HS_GATEWAY:-10.0.0.1}"
export HS_NAME="${HS_NAME:-CENTRAL}"
export BRIDGE_LOCAL="${BRIDGE_LOCAL:-bridge-local}"

cd "${ROOT}"
echo "Waiting for MikroTik at ${MIKROTIK_HOST}:${MIKROTIK_API_PORT} (CENTRAL ${HS_GATEWAY}) ..."
for i in $(seq 1 60); do
  if timeout 2 bash -c "echo >/dev/tcp/${MIKROTIK_HOST}/${MIKROTIK_API_PORT}" 2>/dev/null; then
    echo "Reachable — pushing CENTRAL config (attempt $i)"
    node deploy/push-mikrotik.js && exit 0
  fi
  if [[ "$i" -eq 1 || $((i % 5)) -eq 0 ]]; then
    echo "  still offline... ($i) — reconnect SSTP/VPN on MikroTik to jmtechsolution.cloud"
  fi
  sleep 5
done
echo "FAILED: MikroTik not reachable after waiting"
exit 1
