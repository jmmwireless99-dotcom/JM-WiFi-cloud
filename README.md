# JM WiFi Cloud / JM TECH SOLUTION

Cloud portal sources for **jmtechsolution.cloud** (MikroTik Remote Portal — `/opt/mrp`).

## MikroTik Sites (jmwifi.pro-style)

Staff nav **MikroTik Sites** shows unlimited branch routers as multi-site cards (hub banner, KPIs, Test / Manage / Winbox), matching the jmwifi.pro routers panel.

- `mrp/public/index.html` — UI
- `mrp/src/routes/stations.js` — VPN stations + `POST /api/stations/:id/test`
- `mrp/src/routes/hotspot.js` — hotspot sites + `POST /api/hotspot/sites/:id/test`

## SOCIAL Park CCTV (viewer key gate)

Mobile PWA / APK viewer for SOCIAL cameras (station 71). **Walang password** — admin-issued **viewer key** required. Key is remembered on the device until admin revokes it.

Catalog is **exactly 30 NVR channels (D1–D30)**. Display names sync from the Dahua NVR **ChannelTitle** (`sync-social-nvr-names.mjs` / `POST /api/nvrs/:id/sync-names`) — no hardcoded CIRCLE/CSU seed overwrite. Area tabs group by those NVR name prefixes. **Live Wall / All Cam 30** shows all 30 tiles; streams auto-cycle in pages of **6** with lite 320p remux (a 1-vCPU hub cannot sustain 30 concurrent HEVC→H.264 remuxes — pool default 12).

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

Admin UI: **NVR Cameras → SOCIAL CENTER** (Viewer Keys panel) — Super Admin only.
Enter **pangalan** (required) → **Generate Key** → copy plaintext once → give to that person for `/social` or Install App.
Revoke ends device access. Keys are remembered on the viewer until revoked.

### VPS monitoring (Dashboard)

Admin Dashboard cards poll **CPU %**, **RAM % / GB**, and **network ↓↑ Mbps** every ~8s.

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/system/stats` | admin/staff JWT |
| `GET` | `/api/server/stats` | admin/staff JWT (same payload) |
| `GET` | `/api/vps/metrics` | alias of system stats |

Optional env: `WAN_INTERFACE` (NIC for traffic), `WAN_LINK_MBPS` (link capacity → net %).

### Stack / base

**This branch (`cursor/dashboard-vps-monitoring-6344`)** is based on `cursor/social-nvr-names-all30-9f0b` (dashboard + SOCIAL NVR stack). Separate from Live Wall stream-restore work.

Earlier: `cursor/social-cctv-noauth-mobile-9f0b` (PR #16) → `cursor/social-nvr-30ch-restore-9f0b` (PR #15).
