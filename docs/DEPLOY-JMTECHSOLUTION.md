# Deploy sa jmtechsolution.cloud

Lahat ng system — monitoring dashboard, ALL VENDO, WiFi hotspot API — dito i-deploy sa **jmtechsolution.cloud**, hindi sa hiwalay na subdomain.

## URLs pagkatapos i-deploy

| URL | Purpose |
|-----|---------|
| `https://jmtechsolution.cloud/login` | Staff login |
| `https://jmtechsolution.cloud/dashboard/` | Monitoring portal + ALL VENDO |
| `https://jmtechsolution.cloud/api/` | REST API (ESP8266, MikroTik) |
| `https://jmtechsolution.cloud/hotspot/` | Captive portal (MikroTik redirect) |

## VPS Setup (Ubuntu)

### 1. SSH sa VPS

```bash
ssh root@YOUR_VPS_IP
```

### 2. Install dependencies

```bash
apt update && apt install -y nodejs npm nginx certbot python3-certbot-nginx git
```

### 3. Clone at install

```bash
git clone https://github.com/jmmwireless99-dotcom/JM-WiFi-cloud.git /opt/jmtechsolution
cd /opt/jmtechsolution
cp .env.example .env
nano .env   # set BASE_URL=https://jmtechsolution.cloud
npm install
npm run init-db
```

### 4. Systemd service

```bash
cp deploy/jmwifi.service /etc/systemd/system/jmtechsolution.service
# Edit WorkingDirectory=/opt/jmtechsolution
systemctl daemon-reload
systemctl enable jmtechsolution
systemctl start jmtechsolution
```

### 5. Nginx — jmtechsolution.cloud

```bash
cp deploy/nginx-jmtechsolution.cloud.conf /etc/nginx/sites-available/jmtechsolution.cloud
ln -sf /etc/nginx/sites-available/jmtechsolution.cloud /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d jmtechsolution.cloud -d www.jmtechsolution.cloud
```

### 6. Verify

```bash
curl https://jmtechsolution.cloud/health
```

Buksan: `https://jmtechsolution.cloud/login` → Sign In → Dashboard na may **ALL VENDO** button.

## MikroTik Hotspot Redirect

    mikrotik/login.html:

```
https://jmtechsolution.cloud/hotspot/index.html?mac=$(mac)&ip=$(ip)&link-login=$(link-login-only)&site_id=YOUR_SITE_ID
```

## Important

Kung may lumang app pa ang tumatakbo sa port 3000 o nginx, i-stop muna:

```bash
systemctl stop OLD_SERVICE_NAME
# o
lsof -i :3000
```

Pag na-deploy na ito, ang sidebar ay may **All Vendo** section lang — wala nang Empty Bottle o Cloud Hotspot.

## Quick fix — sidebar lang (existing portal)

Kung ayaw palitan buong server, i-update lang ang monitoring portal HTML:

```bash
# Sa VPS — hanapin muna ang file
grep -r "Empty Bottle" /var/www /opt /home 2>/dev/null | head -3

# Copy mula sa repo
cp /opt/jmtechsolution/site/monitoring/index.html /var/www/jmtechsolution.cloud/index.html
# o gamitin ang script:
sudo bash deploy/update-jmtechsolution-portal.sh
```

File na in-edit: `site/monitoring/index.html` (live portal mula sa jmtechsolution.cloud)
