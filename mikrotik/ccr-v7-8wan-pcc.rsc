# JM TECH SOLUTION — CCR RouterOS v7
# 8-WAN PCC + recursive failover
# ether1-ISP1 .. ether8-ISP8  |  comment WAN1 .. WAN8
#
# Gaya ng MALUBI-CORE layout (bridge-ISP / bridge-OUT-ACCESS / SSTP hub /
# Winbox+API via 10.90.0.0/21) — pinalawak sa 8 ISP, walang duplicate probe IP.
#
# APPLY (Winbox Terminal or /import):
#   1. I-paste sa Terminal ng CLEAN CCR (o /import file=ccr-v7-8wan-pcc.rsc).
#      Filter/mangle: i-import ONCE — magdodoble ang rules kung ulit-ulitin.
#   2. Itakda ang SSTP password: /interface sstp-client set sstp-cctv password="..."
#   3. /ip dhcp-client renew [find]
#   4. /ip route print where comment~"to-WAN"
#   5. Unused ISP: /ip dhcp-client disable [find interface="etherN-ISPN"]
#      at /interface ethernet set etherN-ISPN disabled=yes
#
# HUWAG mag-FastTrack — masisira ang PCC routing marks.
# CCR2116/L3HW: i-off ang hardware offload kung hindi gumagana ang mangle.

###############################################################################
# Identity / clock / services
###############################################################################
/system identity set name=MAGSAY2X-CORE
/system clock set time-zone-name=Asia/Manila
/system note set show-at-login=no
/tool romon set enabled=yes

/ip service
set telnet disabled=yes
set ftp disabled=yes
set www disabled=yes
set www-ssl disabled=yes
set api address=10.90.0.0/21
set winbox address=10.90.0.0/21
set api-ssl disabled=yes

/ip dns set allow-remote-requests=yes servers=8.8.8.8,8.8.4.4
/ip settings set allow-fast-path=no rp-filter=loose

###############################################################################
# Routing tables (ROS v7 FIB)
###############################################################################
/routing table
:do { add disabled=no fib name=to-WAN1 } on-error={}
:do { add disabled=no fib name=to-WAN2 } on-error={}
:do { add disabled=no fib name=to-WAN3 } on-error={}
:do { add disabled=no fib name=to-WAN4 } on-error={}
:do { add disabled=no fib name=to-WAN5 } on-error={}
:do { add disabled=no fib name=to-WAN6 } on-error={}
:do { add disabled=no fib name=to-WAN7 } on-error={}
:do { add disabled=no fib name=to-WAN8 } on-error={}

###############################################################################
# Ethernet — WAN1..WAN8 on ether1..ether8
###############################################################################
/interface ethernet
:do { set [find default-name=ether1] comment=WAN1 name=ether1-ISP1 disabled=no } on-error={}
:do { set [find default-name=ether2] comment=WAN2 name=ether2-ISP2 disabled=no } on-error={}
:do { set [find default-name=ether3] comment=WAN3 name=ether3-ISP3 disabled=no } on-error={}
:do { set [find default-name=ether4] comment=WAN4 name=ether4-ISP4 disabled=no } on-error={}
:do { set [find default-name=ether5] comment=WAN5 name=ether5-ISP5 disabled=no } on-error={}
:do { set [find default-name=ether6] comment=WAN6 name=ether6-ISP6 disabled=no } on-error={}
:do { set [find default-name=ether7] comment=WAN7 name=ether7-ISP7 disabled=no } on-error={}
:do { set [find default-name=ether8] comment=WAN8 name=ether8-ISP8 disabled=no } on-error={}

###############################################################################
# Bridges (SEND core + OUT access) — extra ports kung meron sa model
###############################################################################
/interface bridge
:do { add comment=SEND name=bridge-ISP } on-error={}
:do { add comment=OUT name=bridge-OUT-ACCESS } on-error={}

/interface bridge port
:do { add bridge=bridge-ISP interface=sfp-sfpplus1 comment="CORE-UPLINK" } on-error={}
:do { add bridge=bridge-ISP interface=sfp-sfpplus2 comment="CORE-UPLINK-2" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether9 comment="ACCESS-1" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether10 comment="ACCESS-2 / ROUTER" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether11 comment="ACCESS-3" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether12 comment="ACCESS-4" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether13 comment="ACCESS-5" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether14 comment="ACCESS-6" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether15 comment="ACCESS-7" } on-error={}
:do { add bridge=bridge-OUT-ACCESS interface=ether16 comment="ACCESS-8" } on-error={}

###############################################################################
# Interface lists
###############################################################################
/interface list
:do { add name=WAN } on-error={}
:do { add name=LAN } on-error={}
:do { add name=VPN } on-error={}

/interface list member
:do { add interface=ether1-ISP1 list=WAN } on-error={}
:do { add interface=ether2-ISP2 list=WAN } on-error={}
:do { add interface=ether3-ISP3 list=WAN } on-error={}
:do { add interface=ether4-ISP4 list=WAN } on-error={}
:do { add interface=ether5-ISP5 list=WAN } on-error={}
:do { add interface=ether6-ISP6 list=WAN } on-error={}
:do { add interface=ether7-ISP7 list=WAN } on-error={}
:do { add interface=ether8-ISP8 list=WAN } on-error={}
:do { add interface=bridge-ISP list=LAN } on-error={}
:do { add interface=bridge-OUT-ACCESS list=LAN } on-error={}

###############################################################################
# SSTP to JM TECH hub (password i-set after import)
###############################################################################
/interface sstp-client
:do { add connect-to=jmtechsolution.cloud disabled=no name=sstp-cctv port=4443 user=MAGSAY2X-CORE password="" profile=default-encryption verify-server-address-from-certificate=no comment="JM TECH SOLUTION hub" } on-error={}

/interface list member
:do { add interface=sstp-cctv list=VPN } on-error={}

###############################################################################
# LAN addressing + DHCP
###############################################################################
/ip address
:do { add address=192.168.200.1/24 interface=bridge-ISP comment="SEND / CORE LAN" } on-error={}
:do { add address=192.168.25.1/24 interface=bridge-OUT-ACCESS comment="OUT ACCESS LAN" } on-error={}

/ip pool
:do { add name=pool-isp ranges=192.168.200.2-192.168.200.254 } on-error={}
:do { add name=pool-out ranges=192.168.25.2-192.168.25.254 } on-error={}

/ip dhcp-server
:do { add address-pool=pool-isp interface=bridge-ISP name=dhcp-isp } on-error={}
:do { add address-pool=pool-out interface=bridge-OUT-ACCESS name=dhcp-out } on-error={}

/ip dhcp-server network
:do { add address=192.168.200.0/24 dns-server=8.8.8.8,8.8.4.4 gateway=192.168.200.1 } on-error={}
:do { add address=192.168.25.0/24 dns-server=8.8.8.8,8.8.4.4 gateway=192.168.25.1 } on-error={}

###############################################################################
# Address lists
###############################################################################
/ip firewall address-list
:do { add address=192.168.200.0/24 list=lan-ip } on-error={}
:do { add address=192.168.25.0/24 list=lan-ip } on-error={}
:do { add address=10.90.0.0/21 list=lan-ip comment="JM TECH VPN pool" } on-error={}
:do { add address=jmtechsolution.cloud list=vpn-hub } on-error={}
:do { add address=72.62.73.235 list=vpn-hub comment="jmtechsolution.cloud A" } on-error={}

###############################################################################
# DHCP-client scripts — unique recursive probe per WAN (avoid 1.1.1.1 collision)
# host route comment: to-WANn-host
# table default:      to-WANn-table
# main default:       to-WANn-main   (distance = WAN number, WAN1 primary)
###############################################################################
/ip dhcp-client

:do { add add-default-route=no interface=ether1-ISP1 use-peer-dns=no use-peer-ntp=no comment=WAN1 script={
    :local GWay [/ip dhcp-client get [find interface="ether1-ISP1"] gateway]
    :local hop ($GWay . "%ether1-ISP1")
    :local probe "1.1.1.1"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN1-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN1-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN1 distance=1 target-scope=11 comment="to-WAN1-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=1 target-scope=11 comment="to-WAN1-main"
        } else={
            /ip route set [find comment="to-WAN1-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN1-"]
    }
} } on-error={}

:do { add add-default-route=no interface=ether2-ISP2 use-peer-dns=no use-peer-ntp=no comment=WAN2 script={
    :local GWay [/ip dhcp-client get [find interface="ether2-ISP2"] gateway]
    :local hop ($GWay . "%ether2-ISP2")
    :local probe "1.0.0.1"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN2-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN2-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN2 distance=1 target-scope=11 comment="to-WAN2-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=2 target-scope=11 comment="to-WAN2-main"
        } else={
            /ip route set [find comment="to-WAN2-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN2-"]
    }
} } on-error={}

:do { add add-default-route=no interface=ether3-ISP3 use-peer-dns=no use-peer-ntp=no comment=WAN3 script={
    :local GWay [/ip dhcp-client get [find interface="ether3-ISP3"] gateway]
    :local hop ($GWay . "%ether3-ISP3")
    :local probe "8.8.8.8"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN3-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN3-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN3 distance=1 target-scope=11 comment="to-WAN3-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=3 target-scope=11 comment="to-WAN3-main"
        } else={
            /ip route set [find comment="to-WAN3-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN3-"]
    }
} } on-error={}

:do { add add-default-route=no interface=ether4-ISP4 use-peer-dns=no use-peer-ntp=no comment=WAN4 script={
    :local GWay [/ip dhcp-client get [find interface="ether4-ISP4"] gateway]
    :local hop ($GWay . "%ether4-ISP4")
    :local probe "8.8.4.4"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN4-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN4-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN4 distance=1 target-scope=11 comment="to-WAN4-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=4 target-scope=11 comment="to-WAN4-main"
        } else={
            /ip route set [find comment="to-WAN4-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN4-"]
    }
} } on-error={}

:do { add add-default-route=no interface=ether5-ISP5 use-peer-dns=no use-peer-ntp=no comment=WAN5 script={
    :local GWay [/ip dhcp-client get [find interface="ether5-ISP5"] gateway]
    :local hop ($GWay . "%ether5-ISP5")
    :local probe "9.9.9.9"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN5-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN5-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN5 distance=1 target-scope=11 comment="to-WAN5-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=5 target-scope=11 comment="to-WAN5-main"
        } else={
            /ip route set [find comment="to-WAN5-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN5-"]
    }
} } on-error={}

:do { add add-default-route=no interface=ether6-ISP6 use-peer-dns=no use-peer-ntp=no comment=WAN6 script={
    :local GWay [/ip dhcp-client get [find interface="ether6-ISP6"] gateway]
    :local hop ($GWay . "%ether6-ISP6")
    :local probe "149.112.112.112"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN6-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN6-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN6 distance=1 target-scope=11 comment="to-WAN6-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=6 target-scope=11 comment="to-WAN6-main"
        } else={
            /ip route set [find comment="to-WAN6-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN6-"]
    }
} } on-error={}

:do { add add-default-route=no interface=ether7-ISP7 use-peer-dns=no use-peer-ntp=no comment=WAN7 script={
    :local GWay [/ip dhcp-client get [find interface="ether7-ISP7"] gateway]
    :local hop ($GWay . "%ether7-ISP7")
    :local probe "208.67.222.222"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN7-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN7-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN7 distance=1 target-scope=11 comment="to-WAN7-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=7 target-scope=11 comment="to-WAN7-main"
        } else={
            /ip route set [find comment="to-WAN7-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN7-"]
    }
} } on-error={}

:do { add add-default-route=no interface=ether8-ISP8 use-peer-dns=no use-peer-ntp=no comment=WAN8 script={
    :local GWay [/ip dhcp-client get [find interface="ether8-ISP8"] gateway]
    :local hop ($GWay . "%ether8-ISP8")
    :local probe "208.67.220.220"
    :if ($bound=1) do={
        :if ([:len [/ip route find where comment="to-WAN8-host"]] = 0) do={
            /ip route add dst-address=($probe . "/32") gateway=$hop scope=10 target-scope=10 comment="to-WAN8-host"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping routing-table=to-WAN8 distance=1 target-scope=11 comment="to-WAN8-table"
            /ip route add dst-address=0.0.0.0/0 gateway=$probe check-gateway=ping distance=8 target-scope=11 comment="to-WAN8-main"
        } else={
            /ip route set [find comment="to-WAN8-host"] gateway=$hop
        }
    } else={
        /ip route remove [find where comment~"^to-WAN8-"]
    }
} } on-error={}

###############################################################################
# Pin SSTP hub to WAN1 recursive (1.1.1.1) so the tunnel does not bounce across PCC
###############################################################################
/ip route
:do { add dst-address=72.62.73.235/32 gateway=1.1.1.1 check-gateway=ping distance=1 target-scope=11 comment="SSTP hub via WAN1" } on-error={}

###############################################################################
# Firewall filter
###############################################################################
/ip firewall filter
:do { add action=accept chain=input comment="established" connection-state=established,related,untracked } on-error={}
:do { add action=drop chain=input comment="invalid" connection-state=invalid } on-error={}
:do { add action=accept chain=input comment="ICMP" protocol=icmp } on-error={}
:do { add action=accept chain=input comment="LAN input" in-interface-list=LAN } on-error={}
:do { add action=accept chain=input comment="JM TECH SOLUTION: Winbox via VPN" dst-port=8291 protocol=tcp src-address=10.90.0.0/21 } on-error={}
:do { add action=accept chain=input comment="JM TECH SOLUTION: API via VPN" dst-port=8728 protocol=tcp src-address=10.90.0.0/21 } on-error={}
:do { add action=drop chain=input comment="drop WAN input" in-interface-list=WAN } on-error={}

:do { add action=accept chain=forward comment="JM TECH SOLUTION: established" connection-state=established,related,untracked } on-error={}
:do { add action=drop chain=forward comment="invalid" connection-state=invalid } on-error={}
:do { add action=accept chain=forward comment="JM TECH SOLUTION: hub to camera" connection-nat-state=dstnat in-interface=sstp-cctv } on-error={}
:do { add action=accept chain=forward comment="LAN to WAN" in-interface-list=LAN out-interface-list=WAN } on-error={}
:do { add action=accept chain=forward comment="LAN to LAN" in-interface-list=LAN out-interface-list=LAN } on-error={}
:do { add action=accept chain=forward comment="VPN to LAN" in-interface-list=VPN out-interface-list=LAN } on-error={}

###############################################################################
# Mangle — reply-path + 8-way PCC (no FastTrack)
###############################################################################
/ip firewall mangle

# Skip PCC for SSTP hub (router + LAN both stay on main/WAN1)
:do { add action=accept chain=prerouting dst-address-list=vpn-hub comment="exclude SSTP hub from PCC" } on-error={}
:do { add action=accept chain=output dst-address-list=vpn-hub comment="exclude SSTP hub from PCC (output)" } on-error={}

# Incoming WAN — mark so replies return on the same ISP
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether1-ISP1 new-connection-mark=isp1 passthrough=yes comment="WAN1 in" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether2-ISP2 new-connection-mark=isp2 passthrough=yes comment="WAN2 in" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether3-ISP3 new-connection-mark=isp3 passthrough=yes comment="WAN3 in" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether4-ISP4 new-connection-mark=isp4 passthrough=yes comment="WAN4 in" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether5-ISP5 new-connection-mark=isp5 passthrough=yes comment="WAN5 in" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether6-ISP6 new-connection-mark=isp6 passthrough=yes comment="WAN6 in" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether7-ISP7 new-connection-mark=isp7 passthrough=yes comment="WAN7 in" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new in-interface=ether8-ISP8 new-connection-mark=isp8 passthrough=yes comment="WAN8 in" } on-error={}

:do { add action=mark-routing chain=output connection-mark=isp1 new-routing-mark=to-WAN1 passthrough=yes comment="WAN1 reply" } on-error={}
:do { add action=mark-routing chain=output connection-mark=isp2 new-routing-mark=to-WAN2 passthrough=yes comment="WAN2 reply" } on-error={}
:do { add action=mark-routing chain=output connection-mark=isp3 new-routing-mark=to-WAN3 passthrough=yes comment="WAN3 reply" } on-error={}
:do { add action=mark-routing chain=output connection-mark=isp4 new-routing-mark=to-WAN4 passthrough=yes comment="WAN4 reply" } on-error={}
:do { add action=mark-routing chain=output connection-mark=isp5 new-routing-mark=to-WAN5 passthrough=yes comment="WAN5 reply" } on-error={}
:do { add action=mark-routing chain=output connection-mark=isp6 new-routing-mark=to-WAN6 passthrough=yes comment="WAN6 reply" } on-error={}
:do { add action=mark-routing chain=output connection-mark=isp7 new-routing-mark=to-WAN7 passthrough=yes comment="WAN7 reply" } on-error={}
:do { add action=mark-routing chain=output connection-mark=isp8 new-routing-mark=to-WAN8 passthrough=yes comment="WAN8 reply" } on-error={}

# LAN outbound — equal PCC across 8 ISPs
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp1 passthrough=yes per-connection-classifier=src-address-and-port:8/0 comment="PCC WAN1" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp2 passthrough=yes per-connection-classifier=src-address-and-port:8/1 comment="PCC WAN2" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp3 passthrough=yes per-connection-classifier=src-address-and-port:8/2 comment="PCC WAN3" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp4 passthrough=yes per-connection-classifier=src-address-and-port:8/3 comment="PCC WAN4" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp5 passthrough=yes per-connection-classifier=src-address-and-port:8/4 comment="PCC WAN5" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp6 passthrough=yes per-connection-classifier=src-address-and-port:8/5 comment="PCC WAN6" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp7 passthrough=yes per-connection-classifier=src-address-and-port:8/6 comment="PCC WAN7" } on-error={}
:do { add action=mark-connection chain=prerouting connection-mark=no-mark connection-state=new dst-address-list=!lan-ip dst-address-type=!local in-interface-list=LAN new-connection-mark=isp8 passthrough=yes per-connection-classifier=src-address-and-port:8/7 comment="PCC WAN8" } on-error={}

:do { add action=mark-routing chain=prerouting connection-mark=isp1 in-interface-list=LAN new-routing-mark=to-WAN1 passthrough=yes comment="LAN -> WAN1" } on-error={}
:do { add action=mark-routing chain=prerouting connection-mark=isp2 in-interface-list=LAN new-routing-mark=to-WAN2 passthrough=yes comment="LAN -> WAN2" } on-error={}
:do { add action=mark-routing chain=prerouting connection-mark=isp3 in-interface-list=LAN new-routing-mark=to-WAN3 passthrough=yes comment="LAN -> WAN3" } on-error={}
:do { add action=mark-routing chain=prerouting connection-mark=isp4 in-interface-list=LAN new-routing-mark=to-WAN4 passthrough=yes comment="LAN -> WAN4" } on-error={}
:do { add action=mark-routing chain=prerouting connection-mark=isp5 in-interface-list=LAN new-routing-mark=to-WAN5 passthrough=yes comment="LAN -> WAN5" } on-error={}
:do { add action=mark-routing chain=prerouting connection-mark=isp6 in-interface-list=LAN new-routing-mark=to-WAN6 passthrough=yes comment="LAN -> WAN6" } on-error={}
:do { add action=mark-routing chain=prerouting connection-mark=isp7 in-interface-list=LAN new-routing-mark=to-WAN7 passthrough=yes comment="LAN -> WAN7" } on-error={}
:do { add action=mark-routing chain=prerouting connection-mark=isp8 in-interface-list=LAN new-routing-mark=to-WAN8 passthrough=yes comment="LAN -> WAN8" } on-error={}

###############################################################################
# NAT — masquerade all WANs only (hindi blanket, para hindi ma-NAT ang LAN-LAN)
###############################################################################
/ip firewall nat
:do { add action=masquerade chain=srcnat out-interface-list=WAN comment="MASQ WAN1-WAN8" } on-error={}

###############################################################################
# Done
###############################################################################
:log info "JM TECH: CCR v7 8-WAN PCC imported (MAGSAY2X-CORE). Set SSTP password then renew DHCP clients."
/ip dhcp-client print
/interface ethernet print where comment~"WAN"
/routing table print
