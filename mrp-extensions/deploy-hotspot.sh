#!/bin/bash
# Deploy hotspot API to MRP backend on jmtechsolution.cloud VPS
set -e

MRP=/opt/mrp
BRANCH="cursor/jmwifi-hotspot-system-3173"
REPO_RAW="https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/${BRANCH}"

echo "=== Deploy hotspot route ==="
curl -fsSL "$REPO_RAW/mrp-extensions/hotspot.js" -o "$MRP/src/routes/hotspot.js"

if ! grep -q "hotspotRouter" "$MRP/src/index.js"; then
  cp "$MRP/src/index.js" "$MRP/src/index.js.bak.hotspot"
  sed -i "/import vendoRouter/a import hotspotRouter from './routes/hotspot.js';" "$MRP/src/index.js"
  sed -i "/app.use(\`\${BASE}\/api\/gasoline\`/a app.use(\`\${BASE}/api/hotspot\`, requireAuth, hotspotRouter);" "$MRP/src/index.js"
  echo "Registered /api/hotspot in index.js"
else
  echo "hotspot route already registered"
fi

echo "=== Run DB migration ==="
curl -fsSL "$REPO_RAW/mrp-extensions/hotspot-migrate.sql" -o /tmp/hotspot-migrate.sql
sudo -u postgres psql -d mrp -f /tmp/hotspot-migrate.sql 2>/dev/null || psql -d mrp -f /tmp/hotspot-migrate.sql

echo "=== Restart mrp-backend ==="
systemctl restart mrp-backend
sleep 2
systemctl is-active mrp-backend && echo "mrp-backend OK"
