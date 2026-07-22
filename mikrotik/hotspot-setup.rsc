; ============================================================
; JM WiFi Cloud - MikroTik VLAN Hotspot (Pause / Resume)
; ============================================================
; Flow:
;   Client → JM WiFi SSID → VLAN hotspot interface
;   Captive portal = MikroTik hotspot HTML + cloud portal (fast mix)
;   Time PAUSES on disconnect (no validity / wall-clock expiry)
;   Auto-RESUME on reconnect — random MAC OK with same voucher code
;
; Cloud: https://jmtechsolution.cloud/allvendo
; ============================================================

:local cloudUrl "https://jmtechsolution.cloud/allvendo"
:local siteId "YOUR_SITE_ID"
:local wlanInterface "wlan1"
:local bridgeName "bridge-hotspot"
:local vlanId 10
:local hotspotPool "10.10.10.2-10.10.10.254"
:local hotspotNetwork "10.10.10.0/24"
:local hotspotGateway "10.10.10.1"
:local dnsName "jmwifi.local"

# ─── 1. VLAN + Bridge ─────────────────────────────────────────

/interface vlan
add name=vlan-hotspot vlan-id=$vlanId interface=$wlanInterface comment="JM WiFi Cloud VLAN"

/interface bridge
add name=$bridgeName comment="JM WiFi Hotspot Bridge"

/interface bridge port
add bridge=$bridgeName interface=vlan-hotspot

# ─── 2. IP / DHCP ─────────────────────────────────────────────

/ip pool
add name=hotspot-pool ranges=$hotspotPool

/ip address
add address=($hotspotGateway . "/24") interface=$bridgeName comment="Hotspot Gateway"

/ip dhcp-server
add name=hotspot-dhcp interface=$bridgeName address-pool=hotspot-pool lease-time=30m

/ip dhcp-server network
add address=$hotspotNetwork gateway=$hotspotGateway dns-server=$hotspotGateway

/ip dns
set allow-remote-requests=yes

/ip dns static
add name=$dnsName address=$hotspotGateway comment="JM WiFi Portal"

# ─── 3. Hotspot Profile (mixed portal) ────────────────────────
; login.html in flash/hotspot redirects to cloud portal quickly

/ip hotspot profile
add name=jmwifi \
    hotspot-address=$hotspotGateway \
    dns-name=$dnsName \
    html-directory=flash/hotspot \
    login-by=http-pap,mac-cookie \
    http-cookie-lifetime=1d \
    open-status-page=http-login \
    status-autorefresh=30s

/ip hotspot walled-garden
add dst-host=jmtechsolution.cloud comment="Cloud portal"
add dst-host=*.jmtechsolution.cloud comment="Cloud subdomains"

# ─── 4. Hotspot Server ────────────────────────────────────────

/ip hotspot
add name=JMWIFI interface=$bridgeName address-pool=hotspot-pool profile=jmwifi disabled=no

# ─── 5. User Profile — PAUSE mode (no validity) ───────────────
; No session-timeout / no limit-uptime from profile.
; Cloud tracks remaining seconds; keepalive detects disconnect → pause.

/ip hotspot user profile
add name=jmwifi-pause \
    shared-users=1 \
    rate-limit="2M/5M" \
    transparent-proxy=no \
    keepalive-timeout=2m \
    idle-timeout=none \
    status-autorefresh=30s \
    add-mac-cookie=yes \
    mac-cookie-timeout=1d \
    on-logout="/tool fetch url=(\"$cloudUrl/api/session/pause\") http-method=post http-data=(\"{\\\"mac\\\":\\\"\$mac-address\\\"}\") http-header-field=\"Content-Type: application/json,X-API-Key: YOUR_API_KEY\" keep-result=no" \
    comment="JM WiFi pause — no validity, random MAC OK"

# ─── 6. Firewall / NAT ────────────────────────────────────────

/ip firewall filter
add chain=forward src-address=$hotspotNetwork action=accept comment="Hotspot users forward" place-before=0
add chain=forward src-address=$hotspotNetwork dst-address=!$hotspotNetwork connection-state=new action=drop comment="Block hotspot to LAN" place-before=1

/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade comment="Hotspot NAT" place-before=0

:put "JM WiFi Cloud VLAN Hotspot applied (pause/resume)."
:put ("Portal: " . $cloudUrl . "/portal/?site_id=" . $siteId)
:put "Upload flash/hotspot/login.html that redirects to cloud portal."
