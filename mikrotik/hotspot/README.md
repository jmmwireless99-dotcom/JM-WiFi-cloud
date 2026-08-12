# JM WiFi — MikroTik Hotspot Portal Files

Complete captive portal file set for RouterOS `html-directory=hotspot`.

## Files

| File | Purpose |
|------|---------|
| `portal.css` | Shared JM WiFi theme |
| `portal.js` | Voucher redeem + cloud API (site-specific) |
| `login.html` | Main portal at **http://10.0.0.1** |
| `alogin.html` | After successful MikroTik login |
| `logout.html` | After logout |
| `status.html` | Session status (username, uptime, bytes) |
| `error.html` | Hotspot errors |
| `redirect.html` | Redirect to login |

## MikroTik variables

RouterOS expands these in HTML before the browser runs:

- `$(mac)` `$(ip)` `$(username)` `$(error)`
- `$(link-login)` `$(link-login-only)` `$(link-logout)` `$(link-redirect)` `$(link-orig-esc)`
- `$(uptime)` `$(bytes-in-nice)` `$(bytes-out-nice)`

## Build placeholders (replaced on push)

- `{{SITE_ID}}` — vendo site UUID
- `{{API_BASE}}` — e.g. `https://jmtechsolution.cloud/allvendo/api`
- `{{DOMAIN}}` — e.g. `jmtechsolution.cloud`

## Auto upload (recommended)

Admin → Hotspot Server → **Save & Push** — uploads all files via REST/FTP.

## Manual export

```bash
SITE_ID=your-site-uuid node deploy/export-hotspot-files.js
# Output: out/hotspot/*.html, portal.css, portal.js
```

Copy to MikroTik: **Files → hotspot/**

## Manual WinBox

1. Hotspot Profile → `html-directory=hotspot`
2. Hotspot Profile → `hotspot-address=10.0.0.1`
3. Upload all files to `flash/hotspot/`
