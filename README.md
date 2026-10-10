# JM WiFi Cloud / JM TECH SOLUTION

Cloud portal sources for **jmtechsolution.cloud** (MikroTik Remote Portal — `/opt/mrp`).

## MikroTik Sites (jmwifi.pro-style)

Staff nav **MikroTik Sites** shows unlimited branch routers as multi-site cards (hub banner, KPIs, Test / Manage / Winbox), matching the jmwifi.pro routers panel.

- `mrp/public/index.html` — UI
- `mrp/src/routes/stations.js` — VPN stations + `POST /api/stations/:id/test`
- `mrp/src/routes/hotspot.js` — hotspot sites + `POST /api/hotspot/sites/:id/test`

## SOCIAL Park CCTV (passwordless)

Mobile PWA / APK viewer — **no username/password** for live SOCIAL cameras (station 71).

| Entry | URL |
|-------|-----|
| App / PWA | `https://jmtechsolution.cloud/soscial/?v=1.6.0` |
| Auto-viewer | `https://jmtechsolution.cloud/soscial/v/<cameraId>` |
| Query auto | `https://jmtechsolution.cloud/soscial/?cam=<id>&auto=1` |
| APK | `https://jmtechsolution.cloud/soscial.apk` |
| TV APK | `https://jmtechsolution.cloud/soscial-tv.apk` |

Public API (no JWT): `GET /api/soscial/cameras`, `POST /api/soscial/cameras/:id/ensure-live` (on-demand H.264 remux). Admin portal `/api/cameras` stays authenticated.
