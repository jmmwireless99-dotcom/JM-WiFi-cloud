#!/usr/bin/env node
/**
 * Repair captive portal on MikroTik (upload login.html via FTP + verify hotspot).
 *
 * Usage:
 *   MIKROTIK_HOST=10.90.0.27 MIKROTIK_USER=admin MIKROTIK_PASS='...' \
 *   SITE_ID=84ae9f8f-f8b0-401b-ae66-2cdb5546f163 \
 *   HS_NAME=VLAN530 PARENT_IF=ether2-OUT VLAN_ID=530 HS_ADDRESS=10.5.30.1 \
 *   node deploy/fix-hotspot-portal.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pushHotspotServer } = require('../server/lib/mikrotik-push');

const HOST = process.env.MIKROTIK_HOST || '10.90.0.27';
const USER = process.env.MIKROTIK_USER || 'admin';
const PASS = process.env.MIKROTIK_PASS || '';
const SITE_ID = process.env.SITE_ID || '';
const HS_NAME = process.env.HS_NAME || 'VLAN530';
const PARENT_IF = process.env.PARENT_IF || 'ether2-OUT';
const VLAN_ID = Number(process.env.VLAN_ID || 530);
const HS_ADDRESS = process.env.HS_ADDRESS || '10.5.30.1';

if (!PASS) {
  console.error('MIKROTIK_PASS required');
  process.exit(1);
}
if (!SITE_ID) {
  console.error('SITE_ID required');
  process.exit(1);
}

const site = {
  id: SITE_ID,
  mikrotik_host: HOST,
  mikrotik_user: USER,
  mikrotik_pass: PASS,
  module_type: 'hotspot',
  api_key: process.env.API_KEY || ''
};

const server = {
  site_id: SITE_ID,
  name: HS_NAME,
  hs_address: HS_ADDRESS,
  interface_name: PARENT_IF,
  vlan_id: VLAN_ID,
  vlan_ids: String(VLAN_ID),
  profile_name: 'jmwifi',
  login_by: 'http-pap,cookie',
  html_directory: 'hotspot',
  dns_name: 'jmwifi.local'
};

(async () => {
  console.log(`Fix captive portal → ${HS_NAME} on ${PARENT_IF} (portal http://10.0.0.1)`);
  const result = await pushHotspotServer(server, { site });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
})();
