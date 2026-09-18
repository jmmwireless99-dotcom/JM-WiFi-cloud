# MAGSAY2X-CORE — JM TECH SSTP + Winbox/API/SSH via VPN
# I-paste sa MikroTik terminal. SSTP password: set on device (huwag i-commit).
#
# Tunnel: 10.90.0.33
#   Winbox: jmtechsolution.cloud:52711 → 10.90.0.33:8291
#   API:    jmtechsolution.cloud:52712 → 10.90.0.33:8728  (user: admin)
#   SSH:    10.90.0.33:22  (mula sa 10.90.0.0/21 / hub)
#           kung kailangan ng public map: hub DNAT → 10.90.0.33:22
#
# Pagkatapos mag-paste:
#   /interface sstp-client set [find name=sstp-cctv] password="YOUR_SSTP_PASSWORD"
#   /interface sstp-client monitor [find name=sstp-cctv] once
#   /ip address print where interface=sstp-cctv

/system identity
set name=MAGSAY2X-CORE

/interface sstp-client
add name=sstp-cctv connect-to=jmtechsolution.cloud port=4443 \
    user="magsay2x-core-td8k" password="" profile=default \
    verify-server-certificate=no verify-server-address-from-certificate=no \
    disabled=no comment="JM TECH hub 10.90.0.33"

/interface list
add name=VPN
/interface list member
add interface=sstp-cctv list=VPN

/ip service
set ssh disabled=no port=22
set winbox disabled=no address=10.90.0.0/21
set api disabled=no address=10.90.0.0/21

/ip firewall filter
add chain=input action=accept protocol=tcp dst-port=22 src-address=10.90.0.0/21 \
    comment="JM TECH SOLUTION: SSH via VPN"
add chain=input action=accept protocol=tcp dst-port=8291 src-address=10.90.0.0/21 \
    comment="JM TECH SOLUTION: Winbox via VPN"
add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.90.0.0/21 \
    comment="JM TECH SOLUTION: API via VPN"
add chain=forward action=accept connection-state=established,related,untracked \
    comment="JM TECH SOLUTION: established"
add chain=forward action=accept connection-nat-state=dstnat in-interface=sstp-cctv \
    comment="JM TECH SOLUTION: hub to camera"
