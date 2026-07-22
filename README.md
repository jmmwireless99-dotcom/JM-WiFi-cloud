# JM WiFi Cloud

MikroTik WiFi Hotspot system with ESP8266 coin controller, managed via cloud VPS at **jmtechsolution.cloud**.

## System Architecture

```
┌─────────────┐     WiFi (VLAN)      ┌──────────────┐
│   Client    │ ──────────────────►  │   MikroTik   │
│  (Phone/PC) │                      │   Hotspot    │
└──────┬──────┘                      └──────┬───────┘
       │                                    │
       │  Captive Portal Redirect           │ RouterOS API
       ▼                                    ▼
┌──────────────────────────────────────────────────────┐
│           JM WiFi Cloud (VPS)                        │
│           jmwifi.jmtechsolution.cloud                │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ Portal  │  │ REST API │  │ SQLite Database   │   │
│  └─────────┘  └──────────┘  └───────────────────┘   │
└──────────────────────────┬───────────────────────────┘
                           │ HTTP API
                           ▼
                  ┌─────────────────┐
                  │  ESP8266        │
                  │  Coin Machine   │
                  │  (NodeMCU)      │
                  └─────────────────┘
```

## Flow

1. **Client** connects sa WiFi hotspot (naka-VLAN sa MikroTik)
2. **MikroTik** redirects sa captive portal (`jmwifi.jmtechsolution.cloud`)
3. Client may either:
   - **Mag-insert ng coin** sa ESP8266 machine → makakakuha ng voucher code
   - **Maglagay ng voucher code** (from coin o calling/admin)
4. **Cloud API** validates voucher → creates MikroTik hotspot user → client gets internet access

## Quick Start

### 1. Cloud Server (VPS)

```bash
# Clone at i-deploy sa VPS
git clone https://github.com/jmmwireless99-dotcom/JM-WiFi-cloud.git /opt/jm-wifi-cloud
cd /opt/jm-wifi-cloud
cp .env.example .env
# Edit .env - set JWT_SECRET, BASE_URL, etc.

npm install
npm run init-db
npm start
```

### 2. Nginx + SSL

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/jmwifi
sudo ln -s /etc/nginx/sites-available/jmwifi /etc/nginx/sites-enabled/
sudo certbot --nginx -d jmwifi.jmtechsolution.cloud
sudo systemctl enable jmwifi
sudo cp deploy/jmwifi.service /etc/systemd/system/
sudo systemctl start jmwifi
```

### 3. Create Site (get API key)

```bash
curl -X POST http://localhost:3000/api/admin/create-site \
  -H "Content-Type: application/json" \
  -d '{"name": "My Hotspot", "mikrotik_host": "192.168.88.1", "minutes_per_coin": 5}'
```

Save the returned `site_id` and `api_key`.

### 4. MikroTik Setup

1. Edit `mikrotik/hotspot-setup.rsc` - set your `siteId`, interface names, VLAN ID
2. Upload `mikrotik/login.html` to MikroTik `flash/hotspot/login.html` (replace `YOUR_SITE_ID`)
3. Run the `.rsc` script sa MikroTik terminal

### 5. ESP8266 Firmware

1. Open `firmware/esp8266/jm_wifi_coin_controller/jm_wifi_coin_controller.ino` sa Arduino IDE
2. Set `WIFI_SSID`, `WIFI_PASS`, `API_KEY` (from step 3)
3. Connect coin acceptor sa GPIO D2 (pin 4)
4. Upload sa NodeMCU

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register-device` | Register ESP8266 or MikroTik |
| POST | `/api/heartbeat` | Device keepalive |
| POST | `/api/coin-insert` | Report coin insertion |
| POST | `/api/redeem` | Redeem voucher code |
| POST | `/api/generate-voucher` | Admin/calling generate voucher |
| GET | `/api/site` | Site info and devices |
| POST | `/api/admin/create-site` | Create new hotspot site |

All device endpoints require `X-API-Key` header.

## Hardware Wiring (ESP8266)

```
Coin Acceptor          NodeMCU ESP8266
─────────────          ───────────────
  Pulse OUT  ────────►  D2 (GPIO 4)
  GND        ────────►  GND
  12V        ────────►  External 12V supply

Optional:
  Buzzer +   ────────►  D3 (GPIO 0)
  LED        ────────►  D4 (GPIO 2, built-in)
```

## Coin Rate Configuration

Default: **1 coin = 5 minutes**. Adjustable per site:

```bash
# Via API or database
UPDATE sites SET minutes_per_coin = 10 WHERE id = 'your-site-id';
```

## Admin Portal (ALL VENDO)

Monitoring dashboard na tumutugma sa jmtechsolution.cloud portal:

```
https://jmwifi.jmtechsolution.cloud/admin/
```

Sidebar may **ALL VENDO** button sa Operations section — central hub para sa:
- WiFi Hotspot Vendo (MikroTik + ESP8266)
- Gasoline Vendo
- Empty Bottle Vendo (planned)

Direct link: `/admin/#allvendo`

## Project Structure

```
JM-WiFi-cloud/
├── server/           # Node.js cloud API
│   ├── index.js
│   ├── routes/api.js
│   ├── lib/voucher.js
│   └── lib/mikrotik.js
├── portal/           # Captive portal web pages
├── firmware/         # ESP8266 Arduino firmware
├── mikrotik/         # RouterOS config scripts
├── deploy/           # Nginx + systemd configs
└── docs/             # Detailed setup guides
```

## License

Proprietary - JM Tech Solution (jmtechsolution.cloud)
