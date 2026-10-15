#!/bin/bash
# When SOCIAL-1 SSTP comes online: push NVR NAT, sync ChannelTitle names, keep 31ch catalog.
LOG=/var/log/mrp-soscial-nvr-watch.log
NVR_ID=2
STATION_USER=soscial-1-lgil
API=http://127.0.0.1:8081/api
MRP_DIR=/opt/mrp

TOKEN=$(curl -sS -X POST "$API/login" -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"wireless@jmm3000\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"token\",\"\"))" 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "$(date -Is) login failed" >> "$LOG"; exit 1; fi

PUSHED=0
SYNCED=0
for i in $(seq 1 240); do
  ON=$(accel-cmd show sessions 2>/dev/null | grep -c "$STATION_USER" || true)
  if [ "$ON" -ge 1 ]; then
    echo "$(date -Is) VPN up — restore 31ch + push NAT" >> "$LOG"
    RESP=$(curl -sS -X POST "$API/nvrs/$NVR_ID/restore" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"channels":31,"sharedTunnel":true}')
    echo "$(date -Is) restore $RESP" >> "$LOG"
    RESP=$(curl -sS -X POST "$API/nvrs/$NVR_ID/push" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')
    echo "$(date -Is) push $RESP" >> "$LOG"
    echo "$RESP" | grep -q '"ok":true' && PUSHED=1

    if [ -f "$MRP_DIR/scripts/sync-social-nvr-names.mjs" ]; then
      echo "$(date -Is) syncing ChannelTitle names" >> "$LOG"
      (cd "$MRP_DIR" && node scripts/sync-social-nvr-names.mjs >>"$LOG" 2>&1) && SYNCED=1
    fi

    RESP=$(curl -sS -X POST "$API/nvrs/$NVR_ID/sync-names" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
    echo "$(date -Is) sync-names $RESP" >> "$LOG"
    break
  fi
  sleep 30
done
echo "$(date -Is) watcher done pushed=$PUSHED synced=$SYNCED" >> "$LOG"
