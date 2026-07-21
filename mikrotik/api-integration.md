# JM WiFi Cloud - MikroTik API Integration Script
#
# This script runs on the cloud server to create hotspot users
# after voucher redemption. Can also be triggered via RouterOS scheduler.
#
# Requires: node-routeros or direct API calls

## Option A: Manual user creation via RouterOS API

After voucher redeem, the cloud server can call MikroTik API to add a user:

```
/ip hotspot user add name=jm_AABBCCDDEEFF password=VOUCHERCODE profile=jmwifi-user limit-uptime=30m
```

## Option B: RouterOS Script (run on MikroTik)

Save as `/system script` named `jmwifi-adduser`:

```
:local macAddress $1
:local voucherCode $2
:local minutes $3
:local username ("jm_" . [:pick $macAddress 0 2] . [:pick $macAddress 3 5] . [:pick $macAddress 6 8] . [:pick $macAddress 9 11] . [:pick $macAddress 12 14] . [:pick $macAddress 15 17])
:local uptime ($minutes . "m")

/ip hotspot user
:if ([:len [find name=$username]] > 0) do={
    set [find name=$username] password=$voucherCode limit-uptime=$uptime
} else={
    add name=$username password=$voucherCode profile=jmwifi-user limit-uptime=$uptime
}

:log info ("JM WiFi: User " . $username . " added with " . $minutes . " minutes")
```

Call via API:
```
/system script run jmwifi-adduser mac="AA:BB:CC:DD:EE:FF" code="ABC12345" minutes=30
```

## Option C: RADIUS (recommended for scale)

For multiple MikroTik sites, deploy FreeRADIUS on the VPS:

1. Install FreeRADIUS on VPS
2. Configure MikroTik hotspot to use RADIUS
3. Cloud API writes to RADIUS database on voucher redeem

```
/ip hotspot profile set jmwifi use-radius=yes radius-accounting=yes
/radius add service=hotspot address=VPS_IP secret=radiussecret
```
