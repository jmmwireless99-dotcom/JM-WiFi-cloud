# VPS 503 recovery (2026-10-10)

## Root cause
Not OOM/ffmpeg. `mrp-backend` crash-looped on boot from **partial sibling deploys**:
1. `wifiPay.js` imported `disableHotspotUser` / `ensureWifiPayWalledGarden` while a short `mikrotikRest.js` lacked those exports.
2. `soscialUpdate.js` imported `ensureLiveRemux` while a stripped `provisioner.js` lacked it.
3. `hotspot.js` required missing `mikrotik-push.cjs`.
Apache 503 = reverse proxy with nothing on `:8081`.

## Fix applied on VPS
- Restored coherent `mikrotikRest.js`, `wifiPay.js`, `provisioner.js` (with `ensureLiveRemux`), `mikrotik-push.cjs`, cron, and `index.js` mounts for `/api/wifi-pay` + `/api/soscial`.
- `systemctl restart mrp-backend`; MediaMTX left running.
- Critical files temporarily `chattr +i` to stop mid-recovery overwrites.

## Health
- `https://jmtechsolution.cloud/` → 200
- `https://jmtechsolution.cloud/api/health` → `{"ok":true}` 200
- `/api/wifi-pay/packages` → 200
