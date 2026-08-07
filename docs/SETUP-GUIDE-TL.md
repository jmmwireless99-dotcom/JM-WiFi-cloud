# JM WiFi Cloud - Buong Setup Guide (Tagalog)

## Pangkalahatang Flow

```
Client → WiFi Hotspot (MikroTik VLAN) → Captive Portal (Cloud)
                                              ↓
                                    Voucher / Coin Insert
                                              ↓
                                    ESP8266 Coin Machine
                                              ↓
                                    Cloud API → MikroTik User
                                              ↓
                                    Client may Internet access
```

---

## Hakbang 1: I-setup ang Cloud Server (VPS)

### Requirements
- VPS na may domain: `jmwifi.jmtechsolution.cloud`
- Node.js 18+
- Nginx + Certbot (SSL)

### Install

```bash
# Sa VPS (Ubuntu/Debian)
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx git

# Clone project
sudo git clone https://github.com/jmmwireless99-dotcom/JM-WiFi-cloud.git /opt/jm-wifi-cloud
cd /opt/jm-wifi-cloud

# Configure
sudo cp .env.example .env
sudo nano .env
```

I-edit ang `.env`:
```
PORT=3000
BASE_URL=https://jmwifi.jmtechsolution.cloud
JWT_SECRET=maglagay-ng-mahaba-at-random-na-string
MINUTES_PER_COIN=5
```

```bash
npm install
npm run init-db
```

### Gumawa ng Site (Hotspot Location)

```bash
curl -X POST http://localhost:3000/api/admin/create-site \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tindahan WiFi",
    "mikrotik_host": "192.168.88.1",
    "minutes_per_coin": 5,
    "rate_per_hour": 10
  }'
```

**I-save ang `site_id` at `api_key` — kailangan ito sa MikroTik at ESP8266.**

### Enable as Service

```bash
sudo cp deploy/jmwifi.service /etc/systemd/system/
sudo cp deploy/nginx.conf /etc/nginx/sites-available/jmwifi
sudo ln -sf /etc/nginx/sites-available/jmwifi /etc/nginx/sites-enabled/
sudo systemctl daemon-reload
sudo systemctl enable jmwifi
sudo systemctl start jmwifi
sudo certbot --nginx -d jmwifi.jmtechsolution.cloud
```

---

## Hakbang 2: I-configure ang MikroTik

### 2.1 I-edit ang Configuration Script

Buksan ang `mikrotik/hotspot-setup.rsc` at palitan:

| Variable | Halaga |
|----------|--------|
| `cloudUrl` | `https://jmwifi.jmtechsolution.cloud` |
| `siteId` | API key mula sa Hakbang 1 |
| `wlanInterface` | `wlan1` o ang WiFi interface mo |
| `vlanId` | `10` (o gusto mong VLAN ID) |
| `hotspotPool` | `10.10.10.2-10.10.10.254` |

### 2.2 Upload Login Page

1. I-edit ang `mikrotik/login.html` — palitan ang `YOUR_SITE_ID` ng actual site ID
2. Sa Winbox: **Files** → `flash/hotspot/` → upload `login.html`

### 2.3 Run Script sa MikroTik Terminal

```
/import file-name=hotspot-setup.rsc
```

O kopyahin-paste ang script sa Terminal.

### 2.4 I-verify

```
/ip hotspot print
/ip hotspot active print
```

Dapat may active hotspot server na `hotspot-jmwifi`.

### 2.5 Walled Garden (Important!)

Siguraduhing naka-allow ang cloud domain bago mag-login ang client:

```
/ip hotspot walled-garden print
```

Dapat kasama ang `jmwifi.jmtechsolution.cloud`.

---

## Hakbang 3: I-flash ang ESP8266 (Coin Controller)

### Hardware

| Coin Acceptor Pin | ESP8266 Pin |
|-------------------|-------------|
| Pulse (signal)    | D2 (GPIO 4) |
| GND               | GND         |
| 12V               | External PSU |

### Software

1. I-install ang **Arduino IDE** + **ESP8266 board support**
2. I-install ang libraries: `ArduinoJson`, `ESP8266HTTPClient`
3. Buksan ang `firmware/esp8266/jm_wifi_coin_controller/jm_wifi_coin_controller.ino`
4. I-edit ang config:

```cpp
const char* WIFI_SSID     = "YourShopWiFi";
const char* WIFI_PASS     = "yourpassword";
const char* CLOUD_URL     = "https://jmtechsolution.cloud/allvendo";
const char* API_KEY       = "your-api-key-from-step-1";
const char* DEVICE_NAME   = "CoinMachine-01";
```

5. Upload sa NodeMCU
6. Buksan ang Serial Monitor (115200 baud) para i-verify

### Testing Coin Insert

1. Mag-insert ng coin
2. Sa Serial Monitor, dapat lumabas:
   ```
   Coin detected: 1
   === VOUCHER GENERATED ===
   Code: ABC12XYZ
   Minutes: 5
   ```
3. Ilagay ang code sa captive portal

---

## Hakbang 4: Binding (Cloud ↔ MikroTik ↔ ESP8266)

Ang binding ay automatic via **API Key**:

```
┌─────────────────────────────────────────────┐
│  Site: "Tindahan WiFi"                      │
│  API Key: abc123...                         │
│                                             │
│  ├── Device: esp8266 (CoinMachine-01)       │
│  │   MAC: AA:BB:CC:DD:EE:FF                │
│  │   Status: online                         │
│  │                                          │
│  └── Device: mikrotik (Router-01)           │
│      MAC: 11:22:33:44:55:66                │
│      Status: online                         │
└─────────────────────────────────────────────┘
```

Lahat ng devices na may parehong API key ay naka-bind sa iisang site.

### Manual Device Registration (MikroTik)

```bash
curl -X POST https://jmtechsolution.cloud/allvendo/api/register-device \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"device_type": "mikrotik", "mac_address": "11:22:33:44:55:66", "name": "Router-Main"}'
```

---

## Hakbang 5: Client Experience

1. Client kumonekta sa WiFi (`JM-WiFi` o configured SSID)
2. Auto-redirect sa login page
3. **Option A - Coin**: Pumunta sa coin machine → insert coin → kunin ang code → ilagay sa portal
4. **Option B - Voucher**: Ilagay ang code na binigay ng admin/calling
5. Click **Connect** → may internet na!

---

## Troubleshooting

| Problema | Solusyon |
|----------|----------|
| Hindi ma-access ang portal | Check walled-garden, DNS, at SSL cert |
| ESP8266 offline | Check WiFi credentials, API key, at Serial Monitor |
| Voucher invalid | Check kung tama ang site_id sa login.html |
| Walang internet after login | Check MikroTik NAT, firewall, at hotspot user |
| Coin hindi nagre-register | Check wiring sa GPIO D2, debounce settings |

## Support

JM Tech Solution - jmtechsolution.cloud
