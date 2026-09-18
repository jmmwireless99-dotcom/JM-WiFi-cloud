# CCR1036-8G-2S+  RouterOS v7
# 8 WAN PCC + recursive failover — WALANG BRIDGE
# ether1-ISP1 .. ether8-ISP8  comment=WAN1 .. WAN8
# LAN L3 diretso sa SFP+:
#   sfp-sfpplus1 = 192.168.200.1/24 + 192.168.123.1/24   (SEND / CORE)
#   sfp-sfpplus2 = 192.168.25.1/24                       (OUT ACCESS)
#
# Gaya ng existing 2/3-WAN script (dhcp-client recursive + PCC mangle).
# Probe IP magkakaiba per WAN para hindi mag-collide ang check-gateway.
#
# IMPORT: paste sa Terminal  O  SSH: /import file=ccr-v7-8wan-pcc.rsc
# Remote apply: mikrotik/apply-via-ssh.sh  (SSH 22)  o  RouterOS API 8728
# Pagkatapos:
#   /interface sstp-client set sstp-cctv password="..."
#   /interface sstp-client set sstp-out1 password="..."
#   /ip dhcp-client renew [find]
# Unused WAN: /ip dhcp-client disable [find interface="etherN-ISPN"]
# HUWAG mag-FastTrack — masisira ang PCC.

/system identity
set name=MAGSAY2X-CORE
/system clock
set time-zone-name=Asia/Manila
/system note
set show-at-login=no
/tool romon
set enabled=yes
/ip settings
set allow-fast-path=no rp-filter=loose
/ip dns
set allow-remote-requests=yes servers=8.8.8.8,8.8.4.4
/ip service
set ssh disabled=no port=22
set api disabled=no port=8728
set winbox address=10.90.0.0/21

###############################################################################
# Ethernet — 8 WAN, no rename of SFP (LAN L3 ports)
###############################################################################
/interface ethernet
set [ find default-name=ether1 ] comment=WAN1 name=ether1-ISP1 disabled=no
set [ find default-name=ether2 ] comment=WAN2 name=ether2-ISP2 disabled=no
set [ find default-name=ether3 ] comment=WAN3 name=ether3-ISP3 disabled=no
set [ find default-name=ether4 ] comment=WAN4 name=ether4-ISP4 disabled=no
set [ find default-name=ether5 ] comment=WAN5 name=ether5-ISP5 disabled=no
set [ find default-name=ether6 ] comment=WAN6 name=ether6-ISP6 disabled=no
set [ find default-name=ether7 ] comment=WAN7 name=ether7-ISP7 disabled=no
set [ find default-name=ether8 ] comment=WAN8 name=ether8-ISP8 disabled=no
set [ find default-name=sfp-sfpplus1 ] comment=SEND
set [ find default-name=sfp-sfpplus2 ] comment=OUT-ACCESS

###############################################################################
# Routing tables (ROS v7)
###############################################################################
/routing table
add disabled=no fib name=to-WAN1
add disabled=no fib name=to-WAN2
add disabled=no fib name=to-WAN3
add disabled=no fib name=to-WAN4
add disabled=no fib name=to-WAN5
add disabled=no fib name=to-WAN6
add disabled=no fib name=to-WAN7
add disabled=no fib name=to-WAN8

###############################################################################
# SSTP
###############################################################################
/interface sstp-client
add connect-to=jmtechsolution.cloud disabled=no name=sstp-cctv port=4443 \
    user=MAGSAY2X-CORE profile=default-encryption \
    verify-server-address-from-certificate=no comment="JM TECH hub :4443"
add connect-to=124.105.235.44 disabled=no name=sstp-out1 profile=\
    default-encryption user=MALUBECORE \
    verify-server-address-from-certificate=no comment="legacy SSTP :443"

###############################################################################
# Lists
###############################################################################
/interface list
add name=WAN
add name=LAN
add name=VPN

/interface list member
add interface=ether1-ISP1 list=WAN
add interface=ether2-ISP2 list=WAN
add interface=ether3-ISP3 list=WAN
add interface=ether4-ISP4 list=WAN
add interface=ether5-ISP5 list=WAN
add interface=ether6-ISP6 list=WAN
add interface=ether7-ISP7 list=WAN
add interface=ether8-ISP8 list=WAN
add interface=sfp-sfpplus1 list=LAN
add interface=sfp-sfpplus2 list=LAN
add interface=sstp-cctv list=VPN
add interface=sstp-out1 list=VPN

###############################################################################
# LAN IPs — diretso sa SFP, walang bridge
###############################################################################
/ip address
add address=192.168.200.1/24 interface=sfp-sfpplus1 network=192.168.200.0 \
    comment=SEND
add address=192.168.123.1/24 interface=sfp-sfpplus1 network=192.168.123.0 \
    comment="SEND mgmt"
add address=192.168.25.1/24 interface=sfp-sfpplus2 network=192.168.25.0 \
    comment=OUT-ACCESS

/ip pool
add name=dhcp_pool_send ranges=192.168.200.2-192.168.200.254
add name=dhcp_pool_out ranges=192.168.25.2-192.168.25.254

/ip dhcp-server
add address-pool=dhcp_pool_send interface=sfp-sfpplus1 name=dhcp-send
add address-pool=dhcp_pool_out interface=sfp-sfpplus2 name=dhcp-out

/ip dhcp-server network
add address=192.168.200.0/24 dns-server=8.8.8.8,8.8.4.4 gateway=192.168.200.1
add address=192.168.25.0/24 dns-server=8.8.8.8,8.8.4.4 gateway=192.168.25.1

/ip firewall address-list
add address=192.168.200.0/24 list=lan-ip
add address=192.168.25.0/24 list=lan-ip
add address=192.168.123.0/24 list=lan-ip
add address=10.90.0.0/21 list=lan-ip comment="JM TECH VPN"
add address=jmtechsolution.cloud list=vpn-hub
add address=72.62.73.235 list=vpn-hub
add address=124.105.235.44 list=vpn-hub
add address=13.58.39.217 list=mgmt comment="cursor apply host"
add address=3.149.179.208 list=mgmt comment="cursor apply host 2"

###############################################################################
# DHCP clients — recursive routes (paste-safe { } scripts)
# comments: to-WANn-host / to-WANn-table / to-WANn-main
# (hiwalay para hindi mag-error "Multiple routes found" gaya ng luma)
###############################################################################
/ip dhcp-client
add add-default-route=no interface=ether1-ISP1 use-peer-dns=no use-peer-ntp=no comment=WAN1 script={
    :local GWay [/ip dhcp-client get [find interface="ether1-ISP1"] gateway]
    :local hop ($GWay."%ether1-ISP1")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN1-host"]] = 0) do={
            /ip route add dst-address=1.1.1.1/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN1-host"
            /ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 check-gateway=ping routing-table=to-WAN1 distance=1 target-scope=11 comment="to-WAN1-table"
            /ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 check-gateway=ping distance=1 target-scope=11 comment="to-WAN1-main"
        } else={
            /ip route set [find comment="to-WAN1-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN1-"]
    }
}
add add-default-route=no interface=ether2-ISP2 use-peer-dns=no use-peer-ntp=no comment=WAN2 script={
    :local GWay [/ip dhcp-client get [find interface="ether2-ISP2"] gateway]
    :local hop ($GWay."%ether2-ISP2")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN2-host"]] = 0) do={
            /ip route add dst-address=1.0.0.1/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN2-host"
            /ip route add dst-address=0.0.0.0/0 gateway=1.0.0.1 check-gateway=ping routing-table=to-WAN2 distance=1 target-scope=11 comment="to-WAN2-table"
            /ip route add dst-address=0.0.0.0/0 gateway=1.0.0.1 check-gateway=ping distance=2 target-scope=11 comment="to-WAN2-main"
        } else={
            /ip route set [find comment="to-WAN2-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN2-"]
    }
}
add add-default-route=no interface=ether3-ISP3 use-peer-dns=no use-peer-ntp=no comment=WAN3 script={
    :local GWay [/ip dhcp-client get [find interface="ether3-ISP3"] gateway]
    :local hop ($GWay."%ether3-ISP3")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN3-host"]] = 0) do={
            /ip route add dst-address=8.8.8.8/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN3-host"
            /ip route add dst-address=0.0.0.0/0 gateway=8.8.8.8 check-gateway=ping routing-table=to-WAN3 distance=1 target-scope=11 comment="to-WAN3-table"
            /ip route add dst-address=0.0.0.0/0 gateway=8.8.8.8 check-gateway=ping distance=3 target-scope=11 comment="to-WAN3-main"
        } else={
            /ip route set [find comment="to-WAN3-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN3-"]
    }
}
add add-default-route=no interface=ether4-ISP4 use-peer-dns=no use-peer-ntp=no comment=WAN4 script={
    :local GWay [/ip dhcp-client get [find interface="ether4-ISP4"] gateway]
    :local hop ($GWay."%ether4-ISP4")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN4-host"]] = 0) do={
            /ip route add dst-address=8.8.4.4/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN4-host"
            /ip route add dst-address=0.0.0.0/0 gateway=8.8.4.4 check-gateway=ping routing-table=to-WAN4 distance=1 target-scope=11 comment="to-WAN4-table"
            /ip route add dst-address=0.0.0.0/0 gateway=8.8.4.4 check-gateway=ping distance=4 target-scope=11 comment="to-WAN4-main"
        } else={
            /ip route set [find comment="to-WAN4-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN4-"]
    }
}
add add-default-route=no interface=ether5-ISP5 use-peer-dns=no use-peer-ntp=no comment=WAN5 script={
    :local GWay [/ip dhcp-client get [find interface="ether5-ISP5"] gateway]
    :local hop ($GWay."%ether5-ISP5")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN5-host"]] = 0) do={
            /ip route add dst-address=9.9.9.9/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN5-host"
            /ip route add dst-address=0.0.0.0/0 gateway=9.9.9.9 check-gateway=ping routing-table=to-WAN5 distance=1 target-scope=11 comment="to-WAN5-table"
            /ip route add dst-address=0.0.0.0/0 gateway=9.9.9.9 check-gateway=ping distance=5 target-scope=11 comment="to-WAN5-main"
        } else={
            /ip route set [find comment="to-WAN5-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN5-"]
    }
}
add add-default-route=no interface=ether6-ISP6 use-peer-dns=no use-peer-ntp=no comment=WAN6 script={
    :local GWay [/ip dhcp-client get [find interface="ether6-ISP6"] gateway]
    :local hop ($GWay."%ether6-ISP6")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN6-host"]] = 0) do={
            /ip route add dst-address=149.112.112.112/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN6-host"
            /ip route add dst-address=0.0.0.0/0 gateway=149.112.112.112 check-gateway=ping routing-table=to-WAN6 distance=1 target-scope=11 comment="to-WAN6-table"
            /ip route add dst-address=0.0.0.0/0 gateway=149.112.112.112 check-gateway=ping distance=6 target-scope=11 comment="to-WAN6-main"
        } else={
            /ip route set [find comment="to-WAN6-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN6-"]
    }
}
add add-default-route=no interface=ether7-ISP7 use-peer-dns=no use-peer-ntp=no comment=WAN7 script={
    :local GWay [/ip dhcp-client get [find interface="ether7-ISP7"] gateway]
    :local hop ($GWay."%ether7-ISP7")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN7-host"]] = 0) do={
            /ip route add dst-address=208.67.222.222/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN7-host"
            /ip route add dst-address=0.0.0.0/0 gateway=208.67.222.222 check-gateway=ping routing-table=to-WAN7 distance=1 target-scope=11 comment="to-WAN7-table"
            /ip route add dst-address=0.0.0.0/0 gateway=208.67.222.222 check-gateway=ping distance=7 target-scope=11 comment="to-WAN7-main"
        } else={
            /ip route set [find comment="to-WAN7-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN7-"]
    }
}
add add-default-route=no interface=ether8-ISP8 use-peer-dns=no use-peer-ntp=no comment=WAN8 script={
    :local GWay [/ip dhcp-client get [find interface="ether8-ISP8"] gateway]
    :local hop ($GWay."%ether8-ISP8")
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN8-host"]] = 0) do={
            /ip route add dst-address=208.67.220.220/32 gateway=$hop scope=10 target-scope=10 comment="to-WAN8-host"
            /ip route add dst-address=0.0.0.0/0 gateway=208.67.220.220 check-gateway=ping routing-table=to-WAN8 distance=1 target-scope=11 comment="to-WAN8-table"
            /ip route add dst-address=0.0.0.0/0 gateway=208.67.220.220 check-gateway=ping distance=8 target-scope=11 comment="to-WAN8-main"
        } else={
            /ip route set [find comment="to-WAN8-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN8-"]
    }
}

###############################################################################
# SSTP hubs — follow WAN1 recursive (1.1.1.1) para hindi mag-bounce sa PCC
###############################################################################
/ip route
add dst-address=72.62.73.235/32 gateway=1.1.1.1 check-gateway=ping distance=1 \
    target-scope=11 comment="SSTP jmtech via WAN1"
add dst-address=124.105.235.44/32 gateway=1.1.1.1 check-gateway=ping distance=1 \
    target-scope=11 comment="SSTP 124.105 via WAN1"

###############################################################################
# Filter
###############################################################################
/ip firewall filter
add action=accept chain=input comment="established" connection-state=\
    established,related,untracked
add action=drop chain=input comment="invalid" connection-state=invalid
add action=accept chain=input comment=ICMP protocol=icmp
add action=accept chain=input comment="LAN input" in-interface-list=LAN
add action=accept chain=input comment="JM TECH SOLUTION: Winbox via VPN" \
    dst-port=8291 protocol=tcp src-address=10.90.0.0/21
add action=accept chain=input comment="JM TECH SOLUTION: API via VPN" \
    dst-port=8728 protocol=tcp src-address=10.90.0.0/21
add action=accept chain=input comment="mgmt SSH" src-address-list=mgmt \
    protocol=tcp dst-port=22
add action=accept chain=input comment="mgmt API" src-address-list=mgmt \
    protocol=tcp dst-port=8728
add action=drop chain=input comment="drop WAN input" in-interface-list=WAN
add action=accept chain=forward comment="JM TECH SOLUTION: established" \
    connection-state=established,related,untracked
add action=drop chain=forward comment="invalid" connection-state=invalid
add action=accept chain=forward comment="JM TECH SOLUTION: hub to camera" \
    connection-nat-state=dstnat in-interface=sstp-cctv
add action=accept chain=forward comment="LAN to WAN" in-interface-list=LAN \
    out-interface-list=WAN
add action=accept chain=forward comment="LAN to LAN" in-interface-list=LAN \
    out-interface-list=LAN
add action=accept chain=forward comment="VPN to LAN" in-interface-list=VPN \
    out-interface-list=LAN

###############################################################################
# Mangle — incoming reply-path + 8-way PCC
###############################################################################
/ip firewall mangle
add action=accept chain=prerouting dst-address-list=vpn-hub \
    comment="exclude SSTP hub from PCC"
add action=accept chain=output dst-address-list=vpn-hub \
    comment="exclude SSTP hub from PCC (output)"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether1-ISP1 new-connection-mark=isp1 \
    passthrough=yes comment="WAN1 in"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether2-ISP2 new-connection-mark=isp2 \
    passthrough=yes comment="WAN2 in"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether3-ISP3 new-connection-mark=isp3 \
    passthrough=yes comment="WAN3 in"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether4-ISP4 new-connection-mark=isp4 \
    passthrough=yes comment="WAN4 in"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether5-ISP5 new-connection-mark=isp5 \
    passthrough=yes comment="WAN5 in"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether6-ISP6 new-connection-mark=isp6 \
    passthrough=yes comment="WAN6 in"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether7-ISP7 new-connection-mark=isp7 \
    passthrough=yes comment="WAN7 in"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new in-interface=ether8-ISP8 new-connection-mark=isp8 \
    passthrough=yes comment="WAN8 in"
add action=mark-routing chain=output connection-mark=isp1 new-routing-mark=\
    to-WAN1 passthrough=yes comment="WAN1 reply"
add action=mark-routing chain=output connection-mark=isp2 new-routing-mark=\
    to-WAN2 passthrough=yes comment="WAN2 reply"
add action=mark-routing chain=output connection-mark=isp3 new-routing-mark=\
    to-WAN3 passthrough=yes comment="WAN3 reply"
add action=mark-routing chain=output connection-mark=isp4 new-routing-mark=\
    to-WAN4 passthrough=yes comment="WAN4 reply"
add action=mark-routing chain=output connection-mark=isp5 new-routing-mark=\
    to-WAN5 passthrough=yes comment="WAN5 reply"
add action=mark-routing chain=output connection-mark=isp6 new-routing-mark=\
    to-WAN6 passthrough=yes comment="WAN6 reply"
add action=mark-routing chain=output connection-mark=isp7 new-routing-mark=\
    to-WAN7 passthrough=yes comment="WAN7 reply"
add action=mark-routing chain=output connection-mark=isp8 new-routing-mark=\
    to-WAN8 passthrough=yes comment="WAN8 reply"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp1 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/0 comment="PCC WAN1"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp2 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/1 comment="PCC WAN2"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp3 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/2 comment="PCC WAN3"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp4 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/3 comment="PCC WAN4"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp5 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/4 comment="PCC WAN5"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp6 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/5 comment="PCC WAN6"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp7 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/6 comment="PCC WAN7"
add action=mark-connection chain=prerouting connection-mark=no-mark \
    connection-state=new dst-address-list=!lan-ip dst-address-type=!local \
    in-interface-list=LAN new-connection-mark=isp8 passthrough=yes \
    per-connection-classifier=src-address-and-port:8/7 comment="PCC WAN8"
add action=mark-routing chain=prerouting connection-mark=isp1 \
    in-interface-list=LAN new-routing-mark=to-WAN1 passthrough=yes \
    comment="LAN -> WAN1"
add action=mark-routing chain=prerouting connection-mark=isp2 \
    in-interface-list=LAN new-routing-mark=to-WAN2 passthrough=yes \
    comment="LAN -> WAN2"
add action=mark-routing chain=prerouting connection-mark=isp3 \
    in-interface-list=LAN new-routing-mark=to-WAN3 passthrough=yes \
    comment="LAN -> WAN3"
add action=mark-routing chain=prerouting connection-mark=isp4 \
    in-interface-list=LAN new-routing-mark=to-WAN4 passthrough=yes \
    comment="LAN -> WAN4"
add action=mark-routing chain=prerouting connection-mark=isp5 \
    in-interface-list=LAN new-routing-mark=to-WAN5 passthrough=yes \
    comment="LAN -> WAN5"
add action=mark-routing chain=prerouting connection-mark=isp6 \
    in-interface-list=LAN new-routing-mark=to-WAN6 passthrough=yes \
    comment="LAN -> WAN6"
add action=mark-routing chain=prerouting connection-mark=isp7 \
    in-interface-list=LAN new-routing-mark=to-WAN7 passthrough=yes \
    comment="LAN -> WAN7"
add action=mark-routing chain=prerouting connection-mark=isp8 \
    in-interface-list=LAN new-routing-mark=to-WAN8 passthrough=yes \
    comment="LAN -> WAN8"

###############################################################################
# NAT — WAN only (hindi blanket, para hindi ma-NAT ang SFP-to-SFP LAN)
###############################################################################
/ip firewall nat
add action=masquerade chain=srcnat out-interface-list=WAN comment="MASQ WAN1-WAN8"
