# JM WiFi Cloud

MikroTik WiFi Hotspot system with ESP8266 coin controller — cloud API at **jmtechsolution.cloud**.

## Components

- **REST API** — voucher, coin insert, device registration, MikroTik integration
- **Captive portal** (`/portal/`) — MikroTik hotspot login page para sa clients
- **ESP8266 firmware** — coin acceptor controller
- **MikroTik scripts** — VLAN hotspot setup

## Quick Start

```bash
git clone https://github.com/jmmwireless99-dotcom/JM-WiFi-cloud.git
cd JM-WiFi-cloud
cp .env.example .env
npm install
npm run init-db
npm start
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register-device` | Register ESP8266 or MikroTik |
| POST | `/api/heartbeat` | Device keepalive |
| POST | `/api/coin-insert` | Report coin insertion |
| POST | `/api/redeem` | Redeem voucher code |
| POST | `/api/generate-voucher` | Generate voucher |
| GET | `/api/site` | Site info and devices |
| POST | `/api/admin/create-site` | Create new hotspot site |

## jmtechsolution.cloud sidebar fix

Ang monitoring portal (`site/monitoring/index.html`) ay may fix para alisin ang Empty Bottle at Cloud Hotspot sa sidebar. I-deploy gamit ang:

```bash
sudo bash deploy/update-jmtechsolution-portal.sh
```

## Project Structure

```
JM-WiFi-cloud/
├── server/       # Node.js API
├── portal/       # MikroTik captive portal
├── firmware/     # ESP8266
├── mikrotik/     # RouterOS config
├── site/         # jmtechsolution.cloud monitoring portal (sidebar fix)
└── deploy/       # nginx, systemd
```
