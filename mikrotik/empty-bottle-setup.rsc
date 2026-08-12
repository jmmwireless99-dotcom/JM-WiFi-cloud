; ============================================================
; JM WiFi — Empty Bottle Vendo (dedicated VLAN / site)
; ============================================================
; Separate from Cloud Hotspot CENTRAL (10.0.0.1).
; Machine LAN for bottle vendo ESP8266 / controllers.
;
; VLAN 103 · gateway 10.0.3.1 · bridge-empty-bottle
; Cloud dashboard: /allvendo/empty-bottle/
; ============================================================

:local bridgeLocal "bridge-local"
:local bridgeName "bridge-empty-bottle"
:local vlanId 103
:local gateway "10.0.3.1"
:local network "10.0.3.0/24"
:local poolRange "10.0.3.10-10.0.3.254"

/interface bridge
add name=$bridgeName comment="Empty Bottle machine LAN" disabled=no

/interface vlan
add name=("VLAN" . $vlanId) vlan-id=$vlanId interface=$bridgeLocal comment="Empty Bottle Vendo"

/interface bridge port
add bridge=$bridgeName interface=("VLAN" . $vlanId) comment="empty bottle"

/ip pool
add name=pool-empty-bottle ranges=$poolRange

/ip address
add address=($gateway . "/24") interface=$bridgeName comment="Empty Bottle Gateway"

/ip dhcp-server
add name=dhcp-empty-bottle interface=$bridgeName address-pool=pool-empty-bottle lease-time=1h

/ip dhcp-server network
add address=$network gateway=$gateway dns-server=$gateway

/ip dns static
add name=emptybottle.local address=$gateway comment="Empty Bottle LAN"

/ip firewall nat
add chain=srcnat src-address=$network action=masquerade comment="Empty Bottle NAT"

/ip firewall filter
add chain=forward src-address=$network action=accept comment="Empty Bottle forward" place-before=0

:put ("Empty Bottle VLAN" . $vlanId . " ready — gateway " . $gateway)
