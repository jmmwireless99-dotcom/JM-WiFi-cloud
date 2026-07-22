# JM WiFi Cloud — All Vendo

Multi-vendo WiFi hotspot cloud (Kitifi-style) para sa **JM Tech Solution**, naka-host sa VPS: **jmtechsolution.cloud**.

Central dashboard para sa lahat ng vendo: sales reports, devices (ESP8266 + MikroTik), sessions, vouchers, at captive portal.

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │  JM WiFi Cloud (VPS)                │
                    │  jmwifi.jmtechsolution.cloud        │
                    │  /admin  ·  /portal  ·  /api        │
                    └──────────────┬──────────────────────┘
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
     ┌──────────┐            ┌──────────┐            ┌──────────┐
     │ Vendo 1  │            │ Vendo 2  │            │ Vendo N  │
     │ MikroTik │            │ MikroTik │            │ MikroTik │
     │ + ESP8266│            │ + ESP8266│            │ + ESP8266│
     └──────────┘            └──────────┘            └──────────┘
```

## Features (same idea as Kitifi server)

- **Multi-vendo dashboard** — lahat ng sites sa isang cloud
- **Sales reports** — daily / weekly / monthly + per-vendo
- **Device management** — ESP8266 coin machines + MikroTik status
- **Active sessions** — monitor / disconnect
- **Voucher batch generate** — calling / admin codes
- **Rate plans** per vendo
- **Captive portal** — CENTRAL gateway **10.0.0.1** (lahat ng VLAN), branded JM WiFi login
- **REST API** for coin insert, redeem, heartbeat
- **Pause / resume** — disconnect = pause time; reconnect / random MAC OK with same voucher

## Quick deploy sa VPS

```bash
# Sa jmtechsolution.cloud VPS (Ubuntu)
curl -fsSL https://raw.githubusercontent.com/jmmwireless99-dotcom/jm-wifi-cloud/main/deploy/install-vps.sh | sudo bash
```

O manual:

```bash
sudo git clone https://github.com/jmmwireless99-dotcom/jm-wifi-cloud.git /opt/jm-wifi-cloud
cd /opt/jm-wifi-cloud
sudo bash deploy/install-vps.sh
```

Pagkatapos:
- Admin: `https://jmwifi.jmtechsolution.cloud/admin/`
- Portal: `https://jmwifi.jmtechsolution.cloud/portal/?site_id=YOUR_SITE_ID`
- Default login: `admin@jmtechsolution.cloud` / `admin123` — **palitan agad**

## Local development

```bash
cp .env.example .env
npm install
npm run init-db
npm start
```

Open `http://localhost:3000/admin/`

## Bind a new vendo

1. Mag-login sa `/admin/` → **Mga Vendo** → **+ Bagong Vendo**
2. I-save ang **API Key**
3. Flash ESP8266 (`firmware/esp8266/...`) with API key + cloud URL
4. Import `mikrotik/hotspot-setup.rsc` (CENTRAL **10.0.0.1**, VLAN101/102 → `bridge-hotspot`) o `node deploy/push-mikrotik.js`
5. Clients sa kahit anong VLAN → DHCP `10.0.0.x` → captive portal `10.0.0.1` → cloud portal → coin/voucher → internet

## API (device)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/register-device` | API key | Register ESP/MikroTik |
| POST | `/api/heartbeat` | API key | Keepalive + config |
| POST | `/api/coin-insert` | API key | Coin → voucher |
| POST | `/api/redeem` | — | Portal redeem |
| GET | `/api/portal-config/:siteId` | — | Portal rates |

## Admin API

JWT login via `POST /api/admin/login`, then `Authorization: Bearer <token>`.

Vendos, devices, sessions, vouchers, sales, reports — lahat under `/api/admin/*`.

## Docs

- Tagalog setup: [`docs/SETUP-GUIDE-TL.md`](docs/SETUP-GUIDE-TL.md)
- MikroTik API notes: [`mikrotik/api-integration.md`](mikrotik/api-integration.md)
