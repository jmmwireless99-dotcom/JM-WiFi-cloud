#!/bin/bash
# Full deploy: portal UI + hotspot API + MikroTik push + Apache proxy
set -e

BRANCH="cursor/jmwifi-hotspot-system-3173"
REPO_RAW="https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/${BRANCH}"
MRP=/opt/mrp

echo "=== Portal HTML ==="
curl -fsSL "$REPO_RAW/site/monitoring/index.html" -o "$MRP/public/index.html"

echo "=== Hotspot API + MikroTik push ==="
curl -fsSL "$REPO_RAW/mrp-extensions/hotspot.js" -o "$MRP/src/routes/hotspot.js"
mkdir -p "$MRP/src/services"
curl -fsSL "$REPO_RAW/mrp-extensions/mikrotik-push.cjs" -o "$MRP/src/services/mikrotik-push.cjs"

if ! grep -q "hotspotRouter" "$MRP/src/index.js"; then
  sed -i "/import vendoRouter/a import hotspotRouter from './routes/hotspot.js';" "$MRP/src/index.js"
  sed -i "/app.use(\`\${BASE}\/api\/gasoline\`/a app.use(\`\${BASE}/api/hotspot\`, requireAuth, hotspotRouter);" "$MRP/src/index.js"
fi

echo "=== DB migration ==="
curl -fsSL "$REPO_RAW/mrp-extensions/hotspot-migrate.sql" -o /tmp/hotspot-migrate.sql
sudo -u postgres psql -d mrp -f /tmp/hotspot-migrate.sql 2>&1 | tail -5

echo "=== Apache portal proxy ==="
bash -s << 'APACHE'
APACHE_CONF="/etc/apache2/sites-enabled/000-default-le-ssl.conf"
[ ! -f "$APACHE_CONF" ] && APACHE_CONF=$(ls /etc/apache2/sites-enabled/*ssl* 2>/dev/null | head -1)
if [ -f "$APACHE_CONF" ] && ! grep -q "ProxyPass /portal/" "$APACHE_CONF"; then
  cp "$APACHE_CONF" "${APACHE_CONF}.bak.portal"
  sed -i '/# JM WiFi Cloud All Vendo/i \
    ProxyPass /portal/ http://127.0.0.1:3020/portal/\
    ProxyPassReverse /portal/ http://127.0.0.1:3020/portal/\
    ProxyPass /mikrotik/ http://127.0.0.1:3020/mikrotik/\
    ProxyPassReverse /mikrotik/ http://127.0.0.1:3020/mikrotik/\
' "$APACHE_CONF"
  apache2ctl configtest && systemctl reload apache2
fi
APACHE

echo "=== Restart services ==="
systemctl restart mrp-backend jm-allvendo
sleep 2
systemctl is-active mrp-backend jm-allvendo apache2

echo "=== Verify ==="
curl -fsSI "https://jmtechsolution.cloud/portal/" | head -2
echo "DONE"
