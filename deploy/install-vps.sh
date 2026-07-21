#!/usr/bin/env bash
# JM WiFi Cloud — All Vendo installer for jmtechsolution.cloud VPS
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/jm-wifi-cloud}"
DOMAIN="${DOMAIN:-jmwifi.jmtechsolution.cloud}"
REPO_URL="${REPO_URL:-https://github.com/jmmwireless99-dotcom/jm-wifi-cloud.git}"

echo "==> JM WiFi Cloud All Vendo install"
echo "    Domain: $DOMAIN"
echo "    Dir:    $APP_DIR"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-vps.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx build-essential

# Node.js 20
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only || true
else
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  JWT=$(openssl rand -hex 32)
  ADMIN_KEY=$(openssl rand -hex 16)
  sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
  sed -i "s|ADMIN_KEY=.*|ADMIN_KEY=$ADMIN_KEY|" .env
  sed -i "s|BASE_URL=.*|BASE_URL=https://$DOMAIN|" .env
  echo "Created .env — change ADMIN_PASSWORD after first login"
fi

npm install --omit=dev
npm run init-db

cp deploy/jmwifi.service /etc/systemd/system/jmwifi.service
cp deploy/nginx.conf /etc/nginx/sites-available/jmwifi
sed -i "s/jmwifi.jmtechsolution.cloud/$DOMAIN/g" /etc/nginx/sites-available/jmwifi
ln -sfn /etc/nginx/sites-available/jmwifi /etc/nginx/sites-enabled/jmwifi
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl daemon-reload
systemctl enable jmwifi nginx
systemctl restart jmwifi
systemctl reload nginx

if command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@jmtechsolution.cloud --redirect || \
    echo "SSL skipped — run later: certbot --nginx -d $DOMAIN"
fi

echo ""
echo "==> Done"
echo "    Admin:  https://$DOMAIN/admin/"
echo "    Portal: https://$DOMAIN/portal/"
echo "    Health: https://$DOMAIN/health"
echo "    Default login: admin@jmtechsolution.cloud / admin123"
