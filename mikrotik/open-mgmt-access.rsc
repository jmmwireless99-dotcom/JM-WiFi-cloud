# Paste ITO MUNA kung remote apply via WAN, O kung SSH via VPN na.
# SSH 22 + API 8728 mula sa mgmt hosts at 10.90.0.0/21 (SSTP tunnel).

/ip firewall address-list
add address=13.58.39.217 list=mgmt comment="cursor apply host"
add address=3.149.179.208 list=mgmt comment="cursor apply host 2"
add address=10.90.0.0/21 list=mgmt comment="JM TECH VPN"

/ip service
set ssh disabled=no port=22
set api disabled=no port=8728
set winbox disabled=no address=10.90.0.0/21

/ip firewall filter
add action=accept chain=input comment="JM TECH SOLUTION: SSH via VPN" \
    src-address=10.90.0.0/21 protocol=tcp dst-port=22 place-before=0
add action=accept chain=input comment="mgmt SSH" src-address-list=mgmt \
    protocol=tcp dst-port=22 place-before=0
add action=accept chain=input comment="mgmt API" src-address-list=mgmt \
    protocol=tcp dst-port=8728 place-before=0
