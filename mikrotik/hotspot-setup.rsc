; ============================================================
; JM WiFi Cloud — CENTRAL Hotspot (Kitifi-style)
; ============================================================
; Flow:
;   Client → SSID → VLAN101 / VLAN102 / … → bridge-hotspot
;   Captive portal gateway = 10.0.0.1 (ALL VLANs)
;   Time PAUSES on disconnect (no validity / wall-clock expiry)
;   Auto-RESUME on reconnect — random MAC OK with same voucher
;
; Cloud: https://jmtechsolution.cloud/allvendo
; ============================================================

:local cloudUrl "https://jmtechsolution.cloud/allvendo"
:local siteId "YOUR_SITE_ID"
:local bridgeLocal "bridge-local"
:local bridgeName "bridge-hotspot"
:local hotspotPool "10.0.0.10-10.0.0.254"
:local hotspotNetwork "10.0.0.0/24"
:local hotspotGateway "10.0.0.1"
:local dnsName "jmwifi.local"
:local vlanIds {101;102}

# ─── 1. Central hotspot bridge ────────────────────────────────

/interface bridge
add name=$bridgeName comment="JM Central Captive Portal" disabled=no

# ─── 2. VLAN interfaces → bridge-hotspot (all share 10.0.0.1) ─

:foreach vid in=$vlanIds do={
  :local vname ("VLAN" . $vid)
  :if ([:len [/interface vlan find where name=$vname]] = 0) do={
    /interface vlan add name=$vname vlan-id=$vid interface=$bridgeLocal comment=("JM Cloud Hotspot " . $vname)
  }
  :if ([:len [/interface bridge port find where interface=$vname]] = 0) do={
    /interface bridge port add bridge=$bridgeName interface=$vname comment="central HS"
  }
}

# ─── 3. IP / DHCP (single pool for all VLANs) ─────────────────

/ip pool
add name=pool-central ranges=$hotspotPool

/ip address
add address=($hotspotGateway . "/24") interface=$bridgeName comment="JM Central Hotspot Captive Portal"

/ip dhcp-server
add name=dhcp-central interface=$bridgeName address-pool=pool-central lease-time=30m

/ip dhcp-server network
add address=$hotspotNetwork gateway=$hotspotGateway dns-server=$hotspotGateway

/ip dns
set allow-remote-requests=yes

/ip dns static
add name=$dnsName address=$hotspotGateway comment="Central captive portal"

# ─── 4. Hotspot profile (mixed portal) ────────────────────────

/ip hotspot profile
add name=jmwifi \
    hotspot-address=$hotspotGateway \
    dns-name=$dnsName \
    html-directory=hotspot \
    login-by=http-pap,cookie \
    http-cookie-lifetime=1d

/ip hotspot walled-garden
add dst-host=jmtechsolution.cloud comment="JM WiFi Cloud"
add dst-host=*.jmtechsolution.cloud comment="JM WiFi Cloud"

# ─── 5. Single CENTRAL hotspot server ─────────────────────────

/ip hotspot
add name=CENTRAL interface=$bridgeName address-pool=pool-central profile=jmwifi \
    idle-timeout=none keepalive-timeout=2m disabled=no

# ─── 6. User profile — PAUSE mode (no validity) ───────────────

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
    comment="JM WiFi pause — no validity, random MAC OK"

# ─── 7. NAT ───────────────────────────────────────────────────

/ip firewall nat
add chain=srcnat src-address=$hotspotNetwork action=masquerade comment="JM Hotspot NAT"

:put "JM WiFi CENTRAL hotspot applied — gateway 10.0.0.1 for all VLANs."
:put ("Portal: " . $cloudUrl . "/portal/?site_id=" . $siteId)
:put "Upload hotspot/login.html (site-specific) that redirects to cloud portal."
