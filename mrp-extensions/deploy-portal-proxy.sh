#!/bin/bash
# Fix client-side captive portal + Apache proxy for /portal/ and /mikrotik/
set -e

APACHE_CONF="/etc/apache2/sites-enabled/000-default-le-ssl.conf"
if [ ! -f "$APACHE_CONF" ]; then
  APACHE_CONF=$(ls /etc/apache2/sites-enabled/*jmtech* 2>/dev/null | head -1)
fi

if [ -f "$APACHE_CONF" ] && ! grep -q "ProxyPass /portal/" "$APACHE_CONF"; then
  cp "$APACHE_CONF" "${APACHE_CONF}.bak.portal"
  sed -i '/# JM WiFi Cloud All Vendo/i \
    # JM WiFi captive portal (client phones)\
    ProxyPass /portal/ http://127.0.0.1:3020/portal/\
    ProxyPassReverse /portal/ http://127.0.0.1:3020/portal/\
    ProxyPass /mikrotik/ http://127.0.0.1:3020/mikrotik/\
    ProxyPassReverse /mikrotik/ http://127.0.0.1:3020/mikrotik/\
' "$APACHE_CONF"
  apache2ctl configtest && systemctl reload apache2
  echo "Apache portal proxy added"
else
  echo "Apache portal proxy already configured or conf not found"
fi

curl -fsSI "https://jmtechsolution.cloud/portal/" | head -3 || true
curl -fsSI "https://jmtechsolution.cloud/allvendo/portal/" | head -3 || true
