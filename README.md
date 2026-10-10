# JM WiFi Cloud / JM TECH SOLUTION

Cloud portal sources for **jmtechsolution.cloud** (MikroTik Remote Portal — `/opt/mrp`).

## MikroTik Sites (jmwifi.pro-style)

Staff nav **MikroTik Sites** shows unlimited branch routers as multi-site cards (hub banner, KPIs, Test / Manage / Winbox), matching the jmwifi.pro routers panel.

- `mrp/public/index.html` — UI
- `mrp/src/routes/stations.js` — VPN stations + `POST /api/stations/:id/test`
- `mrp/src/routes/hotspot.js` — hotspot sites + `POST /api/hotspot/sites/:id/test`

## SOCIAL Park CCTV (viewer key gate)

Mobile PWA / APK viewer for SOCIAL cameras (station 71). **Walang password** — admin-issued **viewer key** required. Key is remembered on the device until admin revokes it.

Catalog is **exactly 30 NVR channels (D1–D30)** with **display names only** (no device IP in the UI). Area tabs group by name prefix (CIRCLE OUTDOOR, CIRCLE INDOOR, CSU, …).

| Entry | URL |
|-------|-----|
| App / PWA (canonical) | `https://jmtechsolution.cloud/social/` |
| Legacy path | `https://jmtechsolution.cloud/soscial/` |
| Auto-viewer | `https://jmtechsolution.cloud/social/v/<cameraId>` |
| Install / APK page | `https://jmtechsolution.cloud/social/download` |
| APK | `https://jmtechsolution.cloud/soscial.apk` |

### Viewer key API

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/social/auth` | public — `{ key }` → viewer JWT |
| `GET` | `/api/social/auth/me` | viewer JWT — validate / detect revoke |
| `POST` | `/api/social/keys` | Super Admin JWT — create (plaintext once) |
| `GET` | `/api/social/keys` | Super Admin JWT — list |
| `DELETE` | `/api/social/keys/:id` | Super Admin JWT — revoke (`?hard=1` delete) |

Protected (need viewer token or admin JWT): `GET /api/soscial/cameras`, `POST /api/soscial/cameras/:id/ensure-live`.

Admin UI: portal **Accounts** → **SOCIAL Viewer Keys**.

### Stack / base

This branch builds on `cursor/social-cctv-noauth-mobile-9f0b` (PR #16 passwordless PWA), which stacks on `cursor/social-nvr-30ch-restore-9f0b` (PR #15).
