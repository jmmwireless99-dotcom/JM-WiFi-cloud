# Paste ITO MUNA sa existing CCR (bago ang 8-WAN import) kung remote SSH/API apply.
# Binubuksan ang SSH 22 + API 8728 mula sa cursor apply hosts + 10.90.0.0/21.
# Palitan/dagdagan ang mgmt IP kung iba ang public IP ninyo.

/ip firewall address-list
add address=13.58.39.217 list=mgmt comment="cursor apply host"
add address=3.149.179.208 list=mgmt comment="cursor apply host 2"
add address=10.90.0.0/21 list=mgmt comment="JM TECH VPN"

/ip service
set ssh disabled=no port=22
set api disabled=no port=8728

/ip firewall filter
add action=accept chain=input comment="mgmt SSH" src-address-list=mgmt \
    protocol=tcp dst-port=22 place-before=0
add action=accept chain=input comment="mgmt API" src-address-list=mgmt \
    protocol=tcp dst-port=8728 place-before=0
