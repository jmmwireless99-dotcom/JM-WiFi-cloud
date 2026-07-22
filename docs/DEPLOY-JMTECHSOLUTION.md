# jmtechsolution.cloud — Sidebar Fix

In-edit ang live monitoring portal para alisin ang **Empty Bottle** at **Cloud Hotspot** sa sidebar.

## File

`site/monitoring/index.html` — kopya ng live portal na walang Empty Bottle / Cloud Hotspot links.

## Deploy sa VPS

```bash
# Hanapin ang current file
grep -r "Empty Bottle" /var/www /opt /home 2>/dev/null | head -3

# Deploy
sudo bash deploy/update-jmtechsolution-portal.sh
```

Hard refresh sa browser pagkatapos: `Ctrl+Shift+R`

## Note

Ang WiFi hotspot API at captive portal ay nasa `server/` at `portal/` — hiwalay sa monitoring portal ng jmtechsolution.cloud.
