# jmtechsolution.cloud — Alisin ang All Vendo / Empty Bottle / Cloud Hotspot

Ang fix ay nasa GitHub na, pero kailangan i-run sa **VPS** (72.62.73.235) — hindi automatic ang update.

## Isang command lang (copy-paste sa VPS SSH)

```bash
curl -sL https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/cursor/jmwifi-hotspot-system-3173/deploy/update-jmtechsolution-portal.sh | sudo bash
```

## Manual (kung hindi gumana ang script)

```bash
# 1. SSH sa VPS
ssh root@72.62.73.235

# 2. Hanapin ang portal file
grep -r "Empty Bottle" /var/www /opt /home 2>/dev/null | head -3

# 3. Backup at palitan (palitan ang PATH)
PATH="/var/www/.../index.html"
cp "$PATH" "$PATH.bak"
curl -fsSL "https://raw.githubusercontent.com/jmmwireless99-dotcom/JM-WiFi-cloud/cursor/jmwifi-hotspot-system-3173/site/monitoring/index.html" -o "$PATH"

# 4. Restart app
pm2 restart all
# o: systemctl restart jmtech

# 5. Browser: Ctrl+Shift+R
```

## Pagkatapos i-deploy, sidebar dapat:

```
Gasoline Vendo
JM Market        ← diretso, walang All Vendo section
Settings
...
```
