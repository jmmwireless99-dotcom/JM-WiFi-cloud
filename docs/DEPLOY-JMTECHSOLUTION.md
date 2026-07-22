# jmtechsolution.cloud — Portal update (ALL VENDO button)

Ang fix ay nasa GitHub na, pero kailangan i-run sa **VPS** (72.62.73.235) — hindi automatic ang update.

## Isang command lang (copy-paste sa VPS SSH)

```bash
curl -sL https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/cursor/jmwifi-hotspot-system-3173/deploy/update-jmtechsolution-portal.sh | sudo bash
```

## Manual (kung hindi gumana ang script)

```bash
# 1. SSH sa VPS
ssh root@72.62.73.235

# 2. Backup at palitan
cp /opt/mrp/public/index.html /opt/mrp/public/index.html.bak
curl -fsSL "https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/cursor/jmwifi-hotspot-system-3173/site/monitoring/index.html" -o /opt/mrp/public/index.html

# 3. Restart app
systemctl restart mrp-backend.service

# 4. Browser: Ctrl+Shift+R
```

## Pagkatapos i-deploy, sidebar dapat:

```
Gasoline Vendo
ALL VENDO        ← bagong button (tulad ng Gasoline Vendo)
JM Market
Settings
...
```
