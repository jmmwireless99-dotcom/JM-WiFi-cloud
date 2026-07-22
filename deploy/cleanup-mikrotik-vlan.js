#!/usr/bin/env node
/**
 * Remove orphaned hotspot resources from MikroTik (VLAN + hotspot + DHCP + IPs).
 *
 * Usage:
 *   MIKROTIK_HOST=10.90.0.27 MIKROTIK_USER=admin MIKROTIK_PASS='...' \
 *   HS_NAME=VLAN530 PARENT_IF=ether2-OUT VLAN_ID=530 HS_ADDRESS=10.5.30.1 \
 *   node deploy/cleanup-mikrotik-vlan.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { deleteHotspotServer } = require('../server/lib/mikrotik-push');

const HOST = process.env.MIKROTIK_HOST || '10.90.0.27';
const USER = process.env.MIKROTIK_USER || 'admin';
const PASS = process.env.MIKROTIK_PASS || '';
const HS_NAME = process.env.HS_NAME || 'VLAN530';
const PARENT_IF = process.env.PARENT_IF || process.env.HS_INTERFACE || 'ether2-OUT';
const VLAN_ID = Number(process.env.VLAN_ID || HS_NAME.replace(/^VLAN/i, '') || 530);
const HS_ADDRESS = process.env.HS_ADDRESS || '10.5.30.1';

if (!PASS) {
  console.error('MIKROTIK_PASS required');
  process.exit(1);
}

const site = {
  id: process.env.SITE_ID || 'cli-cleanup',
  mikrotik_host: HOST,
  mikrotik_user: USER,
  mikrotik_pass: PASS,
  module_type: 'hotspot'
};

const server = {
  name: HS_NAME,
  hs_address: HS_ADDRESS,
  interface_name: PARENT_IF,
  vlan_id: VLAN_ID,
  vlan_ids: String(VLAN_ID),
  dns_name: 'jmwifi.local'
};

(async () => {
  console.log(`Cleanup ${HS_NAME} (VLAN${VLAN_ID} on ${PARENT_IF}) from ${HOST}`);
  const result = await deleteHotspotServer(server, { site });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
})();
