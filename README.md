# JM WiFi Cloud / JM TECH SOLUTION

Cloud portal sources for **jmtechsolution.cloud** (MikroTik Remote Portal — `/opt/mrp`).

## MikroTik Sites (jmwifi.pro-style)

Staff nav **MikroTik Sites** shows unlimited branch routers as multi-site cards (hub banner, KPIs, Test / Manage / Winbox), matching the jmwifi.pro routers panel.

- `mrp/public/index.html` — UI
- `mrp/src/routes/stations.js` — VPN stations + `POST /api/stations/:id/test`
- `mrp/src/routes/hotspot.js` — hotspot sites + `POST /api/hotspot/sites/:id/test`
