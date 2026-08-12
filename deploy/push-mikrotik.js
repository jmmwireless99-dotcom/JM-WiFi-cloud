#!/usr/bin/env node
/**
 * Push hotspot to MikroTik via admin push logic (direct interface, no bridge).
 *
 * Usage:
 *   MIKROTIK_HOST=10.90.0.27 MIKROTIK_USER=admin MIKROTIK_PASS='...' \
 *   HS_INTERFACE=VLAN530 HS_ADDRESS=10.5.30.1 VLAN_IDS=530 \
 *   SITE_ID=... API_KEY=... node deploy/push-mikrotik.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pushHotspotServer } = require('../server/lib/mikrotik-push');

const HOST = process.env.MIKROTIK_HOST || '10.90.0.27';
const USER = process.env.MIKROTIK_USER || 'admin';
const PASS = process.env.MIKROTIK_PASS || '';
const SITE_ID = process.env.SITE_ID || '';
const API_KEY = process.env.API_KEY || '';
const CLOUD = (process.env.BASE_URL || 'https://jmtechsolution.cloud/allvendo').replace(/\/$/, '');
const VLAN_IDS = String(process.env.VLAN_IDS || process.env.VLAN_ID || '530')
  .split(',')
  .map((v) => Number(String(v).trim()))
  .filter((n) => n > 0);
const firstVlan = VLAN_IDS[0] || 530;
const HS_INTERFACE = process.env.HS_INTERFACE || `VLAN${firstVlan}`;
const HS_ADDRESS = process.env.HS_ADDRESS || process.env.HS_GATEWAY || '10.5.30.1';
const HS_NAME = process.env.HS_NAME || HS_INTERFACE;

if (!PASS) {
  console.error('MIKROTIK_PASS required');
  process.exit(1);
}
if (!HS_INTERFACE) {
  console.error('HS_INTERFACE required (hal. VLAN530, ether1)');
  process.exit(1);
}

const site = {
  id: SITE_ID || 'cli-push',
  mikrotik_host: HOST,
  mikrotik_user: USER,
  mikrotik_pass: PASS,
  api_key: API_KEY,
  module_type: 'hotspot'
};

const server = {
  name: HS_NAME,
  hs_address: HS_ADDRESS,
  interface_name: HS_INTERFACE,
  vlan_id: firstVlan,
  vlan_ids: VLAN_IDS.join(','),
  profile_name: 'jmwifi',
  login_by: 'http-pap,cookie',
  html_directory: 'hotspot',
  dns_name: 'jmwifi.local'
};

(async () => {
  console.log(`Push ${HS_NAME} → ${HS_INTERFACE} (${HS_ADDRESS}) VLANs=[${VLAN_IDS.join(',')}]`);
  const result = await pushHotspotServer(server, {
    site,
    cloudUrl: CLOUD,
    vlanParent: process.env.MIKROTIK_VLAN_PARENT || process.env.BRIDGE_LOCAL || 'bridge-local'
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
})();
