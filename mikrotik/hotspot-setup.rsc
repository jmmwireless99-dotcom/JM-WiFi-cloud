; ============================================================
; JM WiFi Cloud - MikroTik RouterOS Hotspot Configuration
; ============================================================
; 
; Prerequisites:
;   - RouterOS v7+ recommended (v6 also works)
;   - Adjust interface names, IP ranges, and VLAN IDs
;   - Cloud portal URL: https://jmwifi.jmtechsolution.cloud
;
; Apply via Terminal or Winbox > New Terminal
; ============================================================

# ─── Variables (EDIT THESE) ───────────────────────────────────

:local cloudUrl "https://jmwifi.jmtechsolution.cloud"
:local siteId "YOUR_SITE_ID"
:local wlanInterface "wlan1"
:local bridgeName "bridge-hotspot"
:local vlanId 10
:local hotspotPool "10.10.10.2-10.10.10.254"
:local hotspotNetwork "10.10.10.0/24"
:local hotspotGateway "10.10.10.1"
:local dnsName "jmwifi.local"

# ─── 1. VLAN Setup ────────────────────────────────────────────

/interface vlan
add name=vlan-hotspot vlan-id=$vlanId interface=$wlanInterface comment="JM WiFi Hotspot VLAN"

/interface bridge
add name=$bridgeName comment="JM WiFi Hotspot Bridge"

/interface bridge port
add bridge=$bridgeName interface=vlan-hotspot

# ─── 2. IP Address for Hotspot Network ──────────────────────

/ip pool
add name=hotspot-pool ranges=$hotspotPool

/ip address
add address=($hotspotGateway . "/24") interface=$bridgeName comment="Hotspot Gateway"

# ─── 3. DHCP Server ───────────────────────────────────────────

/ip dhcp-server
add name=hotspot-dhcp interface=$bridgeName address-pool=hotspot-pool lease-time=1h

/ip dhcp-server network
add address=$hotspotNetwork gateway=$hotspotGateway dns-server=$hotspotGateway

# ─── 4. DNS ───────────────────────────────────────────────────

/ip dns
set allow-remote-requests=yes

/ip dns static
add name=$dnsName address=$hotspotGateway comment="JM WiFi Portal"

# ─── 5. Hotspot Profile ───────────────────────────────────────

/ip hotspot profile
add name=jmwifi \
    hotspot-address=$hotspotGateway \
    dns-name=$dnsName \
    html-directory=flash/hotspot \
    login-by=http-chap,http-pap,mac \
    http-proxy=0.0.0.0:0 \
    use-radius=no \
    rate-limit="" \
    shared-users=1 \
    open-status-page=http-login \
    status-autorefresh=1m

# External login page (redirects to cloud portal)
/ip hotspot profile
set jmwifi login-by=http-chap,http-pap \
    http-proxy=0.0.0.0:0

/ip hotspot walled-garden
add dst-host=jmwifi.jmtechsolution.cloud comment="Allow cloud portal"
add dst-host=*.jmtechsolution.cloud comment="Allow cloud subdomains"

# ─── 6. Hotspot Server ────────────────────────────────────────

/ip hotspot
add name=hotspot-jmwifi interface=$bridgeName address-pool=hotspot-pool profile=jmwifi disabled=no

# ─── 7. Hotspot User Profile (time-limited) ───────────────────

/ip hotspot user profile
add name=jmwifi-user \
    shared-users=1 \
    rate-limit="2M/2M" \
    transparent-proxy=no \
    keepalive-timeout=2m \
    status-autorefresh=1m \
    add-mac-cookie=yes \
    mac-cookie-timeout=3d

# ─── 8. External Login Page Redirect ──────────────────────────
# Upload login.html to flash/hotspot/ that redirects to cloud portal
# Or use hotspot login-url override:

/ip hotspot profile
set jmwifi login-by=http-chap,http-pap

# ─── 9. Firewall (isolate hotspot VLAN) ───────────────────────

/ip firewall filter
add chain=forward src-address=$hotspotNetwork action=accept comment="Hotspot users forward" place-before=0
add chain=forward src-address=$hotspotNetwork dst-address=!$hotspotNetwork connection-state=new action=drop comment="Block hotspot to LAN" place-before=1

# ─── 10. NAT Masquerade ───────────────────────────────────────

/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade comment="Hotspot NAT" place-before=0

:put "JM WiFi Hotspot configuration applied!"
:put ("Portal URL: " . $cloudUrl . "/portal/index.html?site_id=" . $siteId)
