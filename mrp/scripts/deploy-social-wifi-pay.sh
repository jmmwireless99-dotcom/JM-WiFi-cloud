#!/usr/bin/env bash
# Deploy Social Park Buy Unli (wifi-pay) to VPS + push login.html to SOCIAL MikroTik.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS="${VPS_HOST:-jmtechsolution.cloud}"
VPS_USER="${VPS_USER:-root}"

echo "==> Sync wifi-pay + SOCIAL CCTV portal links to ${VPS_USER}@${VPS}:/opt/mrp"
ssh "${VPS_USER}@${VPS}" 'mkdir -p /opt/mrp/src/routes /opt/mrp/src/services /opt/mrp/public/hotspot/social-park /opt/mrp/public/soscial /opt/mrp/scripts'

scp "$ROOT/src/services/wifiPay.js" "${VPS_USER}@${VPS}:/opt/mrp/src/services/wifiPay.js"
scp "$ROOT/src/routes/wifiPay.js" "${VPS_USER}@${VPS}:/opt/mrp/src/routes/wifiPay.js"
scp "$ROOT/public/hotspot/social-park/login.html" "${VPS_USER}@${VPS}:/opt/mrp/public/hotspot/social-park/login.html"

# Browser portal targets: CCTV Viewer (/soscial/) + Download Apps (/soscial/download) + APKs
echo "==> Sync SOCIAL CCTV viewer + APKs"
scp "$ROOT/public/soscial/index.html" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/index.html"
scp "$ROOT/public/soscial/download.html" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/download.html"
scp "$ROOT/public/soscial/sw.js" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/sw.js"
scp "$ROOT/public/soscial/manifest.webmanifest" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/manifest.webmanifest"
scp "$ROOT/public/soscial/version.json" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/version.json"
scp "$ROOT/public/soscial/soscial-park-cctv.apk" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/soscial-park-cctv.apk"
scp "$ROOT/public/soscial/soscial-park-cctv-tv.apk" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/soscial-park-cctv-tv.apk"
scp "$ROOT/public/soscial/soscial-park-cctv.zip" "${VPS_USER}@${VPS}:/opt/mrp/public/soscial/soscial-park-cctv.zip"
if [[ -f "$ROOT/src/routes/soscialUpdate.js" ]]; then
  scp "$ROOT/src/routes/soscialUpdate.js" "${VPS_USER}@${VPS}:/opt/mrp/src/routes/soscialUpdate.js"
fi

# Patch index.js mount if missing
ssh "${VPS_USER}@${VPS}" 'python3 - << "PY"
from pathlib import Path
p = Path("/opt/mrp/src/index.js")
t = p.read_text()
changed = False
if "wifiPayRouter" not in t:
    t = t.replace(
        "import payRouter from '\''./routes/pay.js'\'';",
        "import payRouter from '\''./routes/pay.js'\'';\nimport wifiPayRouter from '\''./routes/wifiPay.js'\'';",
    )
    changed = True
if "/api/wifi-pay" not in t:
    t = t.replace(
        "app.use(`${BASE}/api/pay`, payRouter); // public phone client (no API key)",
        "app.use(`${BASE}/api/pay`, payRouter); // public phone client (no API key)\napp.use(`${BASE}/api/wifi-pay`, wifiPayRouter); // Social Park Buy Unli (public captive portal)",
    )
    changed = True
if "soscialUpdateRouter" not in t and Path("/opt/mrp/src/routes/soscialUpdate.js").exists():
    t = t.replace(
        "import { BASE_PATH } from '\''./config.js'\'';",
        "import { BASE_PATH } from '\''./config.js'\'';\nimport soscialUpdateRouter from '\''./routes/soscialUpdate.js'\'';",
    )
    t = t.replace(
        "app.use(`${BASE}/api/wifi-pay`, wifiPayRouter); // Social Park Buy Unli (public captive portal)",
        "app.use(`${BASE}/api/wifi-pay`, wifiPayRouter); // Social Park Buy Unli (public captive portal)\napp.use(`${BASE}/api/soscial`, soscialUpdateRouter); // public CCTV app updater + camera fingerprint",
    )
    changed = True
if changed:
    p.write_text(t)
    print("index.js patched")
else:
    print("index.js already has wifi-pay / soscial update")
PY'

# Patch settings webhook for wifi-pay
ssh "${VPS_USER}@${VPS}" 'python3 - << "PY"
from pathlib import Path
p = Path("/opt/mrp/src/routes/settings.js")
t = p.read_text()
changed = False
if "markWifiPayFromWebhook" not in t:
    t = t.replace(
        "import { markVendoSessionFromWebhook, markStoreOrderFromWebhook } from '\''../services/paymongo.js'\'';",
        "import { markVendoSessionFromWebhook, markStoreOrderFromWebhook } from '\''../services/paymongo.js'\'';\nimport { markWifiPayFromWebhook } from '\''../services/wifiPay.js'\'';",
    )
    t = t.replace(
        "await markStoreOrderFromWebhook(eventType, parsed);",
        "await markStoreOrderFromWebhook(eventType, parsed);\n        await markWifiPayFromWebhook(eventType, parsed);",
    )
    changed = True
if changed:
    p.write_text(t)
    print("settings.js webhook patched")
else:
    print("settings.js already wired")
PY'

# Ensure migrate includes wifi_pay_sessions (run migration snippet)
ssh "${VPS_USER}@${VPS}" 'cd /opt/mrp && node --input-type=module << "EOF"
import "dotenv/config";
import { pool } from "./src/db.js";
await pool.query(`
  CREATE TABLE IF NOT EXISTS wifi_pay_sessions (
    id                  SERIAL PRIMARY KEY,
    site_id             INT REFERENCES wifi_mikrotik_sites(id) ON DELETE SET NULL,
    site_name           TEXT NOT NULL DEFAULT '\'\'',
    package_id          TEXT NOT NULL,
    package_label       TEXT NOT NULL DEFAULT '\'\'',
    amount_pesos        NUMERIC(14,2) NOT NULL,
    amount_centavos     INT NOT NULL,
    uptime_limit        TEXT NOT NULL DEFAULT '\''20h'\'',
    validity_days       INT NOT NULL DEFAULT 3,
    valid_until         TIMESTAMPTZ,
    mac                 TEXT NOT NULL DEFAULT '\'\'',
    link_login          TEXT NOT NULL DEFAULT '\'\'',
    link_orig           TEXT NOT NULL DEFAULT '\'\'',
    client_ip           TEXT NOT NULL DEFAULT '\'\'',
    status              TEXT NOT NULL DEFAULT '\''pending'\'',
    paymongo_intent_id  TEXT,
    paymongo_method_id  TEXT,
    paymongo_payment_id TEXT,
    qr_image_url        TEXT NOT NULL DEFAULT '\'\'',
    client_key          TEXT NOT NULL DEFAULT '\'\'',
    hotspot_username    TEXT,
    hotspot_password    TEXT,
    mikrotik_user_id    TEXT NOT NULL DEFAULT '\'\'',
    error               TEXT NOT NULL DEFAULT '\'\'',
    expires_at          TIMESTAMPTZ,
    paid_at             TIMESTAMPTZ,
    provisioned_at      TIMESTAMPTZ,
    expired_cleaned     BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_wifi_pay_sessions_intent ON wifi_pay_sessions (paymongo_intent_id)`);
await pool.query(`GRANT ALL ON TABLE wifi_pay_sessions TO mrp`).catch(()=>{});
await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mrp`).catch(()=>{});
console.log("wifi_pay_sessions OK");
await pool.end();
EOF'

# Sync mikrotikRest (repo copy includes wifi-pay helpers + CCTV NAT)
scp "$ROOT/src/services/mikrotikRest.js" "${VPS_USER}@${VPS}:/opt/mrp/src/services/mikrotikRest.js"
echo "mikrotikRest synced"

# Patch cron cleanup
scp "$ROOT/src/cron.js" "${VPS_USER}@${VPS}:/opt/mrp/src/cron.js"

systemctl_restart() {
  ssh "${VPS_USER}@${VPS}" 'systemctl restart mrp-backend && sleep 2 && systemctl is-active mrp-backend && curl -sS http://127.0.0.1:8081/api/health || curl -sS http://127.0.0.1:8080/api/health'
}
systemctl_restart

# Push login.html to SOCIAL router via /tool/fetch from public URL
ssh "${VPS_USER}@${VPS}" 'cd /opt/mrp && node --input-type=module << "EOF"
import "dotenv/config";
import { pool } from "./src/db.js";
import { ensureWifiPayWalledGarden } from "./src/services/mikrotikRest.js";

const { rows } = await pool.query(`SELECT * FROM wifi_mikrotik_sites WHERE id = 2`);
const site = rows[0];
if (!site) throw new Error("SOCIAL-HS site missing");

const garden = await ensureWifiPayWalledGarden(site);
console.log("walled garden OK", { added: garden.added, skipped: garden.skipped, errors: garden.errors });

const auth = "Basic " + Buffer.from(`${site.api_user}:${site.api_password}`).toString("base64");
const host = site.mikrotik_host;
const url = "https://jmtechsolution.cloud/hotspot/social-park/login.html";

// trigger fetch on router
const fetchRes = await fetch(`http://${host}/rest/tool/fetch`, {
  method: "POST",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body: JSON.stringify({ url, "dst-path": "flash/hotspot/login.html" }),
});
const fetchText = await fetchRes.text();
console.log("tool/fetch", fetchRes.status, fetchText.slice(0, 200));

await new Promise((r) => setTimeout(r, 2500));
const files = await fetch(`http://${host}/rest/file?name=flash/hotspot/login.html`, {
  headers: { Authorization: auth },
}).then((r) => r.json());
console.log("login.html on router", files);
await pool.end();
EOF'

echo "==> Done"
