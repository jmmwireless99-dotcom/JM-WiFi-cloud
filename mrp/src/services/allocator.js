// IP + port allocation from configured ranges, skipping what's already in the DB.
import { pool } from '../db.js';
import crypto from 'crypto';

const ipToInt = ip => {
  const host = String(ip || '').split('/')[0].trim();
  return host.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
};
const intToIp = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');

export async function allocateVpnIp() {
  const start = ipToInt(process.env.VPN_IP_START || '10.90.0.10');
  const end = ipToInt(process.env.VPN_IP_END || '10.90.6.254');
  const { rows } = await pool.query(
    `SELECT host(vpn_ip) AS vpn_ip FROM stations
     UNION ALL
     SELECT host(vpn_ip) FROM staff_accounts WHERE vpn_ip IS NOT NULL`
  );
  const used = new Set(rows.map(r => ipToInt(r.vpn_ip)).filter(n => !Number.isNaN(n)));
  for (let i = start; i <= end; i++) {
    if (!used.has(i)) return intToIp(i);
  }
  throw new Error('VPN IP pool exhausted');
}

export async function allocateStaffVpnUsername(portalUsername) {
  const base = `staff-${String(portalUsername || '').trim().toLowerCase()}`.slice(0, 32);
  let candidate = base;
  for (let n = 0; n < 20; n++) {
    const { rows } = await pool.query(
      `SELECT 1 FROM stations WHERE username = $1
       UNION SELECT 1 FROM staff_accounts WHERE vpn_username = $1`,
      [candidate]
    );
    if (!rows.length) return candidate;
    candidate = `${base.slice(0, 28)}-${n + 1}`;
  }
  throw new Error('VPN username exhausted');
}

export async function allocateWinboxPort() {
  const start = Number(process.env.PORT_RANGE_START || 50000);
  const end = Number(process.env.PORT_RANGE_END || 59998);
  const { rows } = await pool.query('SELECT winbox_port AS p, api_port AS a FROM stations');
  const used = new Set(rows.flatMap(r => [Number(r.p), Number(r.a)]).filter(Boolean));
  // Randomized para hindi sequential/guessable
  for (let tries = 0; tries < 200; tries++) {
    const p = start + crypto.randomInt(end - start + 1);
    if (!used.has(p) && !used.has(p + 1)) return p;
  }
  for (let p = start; p <= end; p++) if (!used.has(p) && !used.has(p + 1)) return p;
  throw new Error('Port range exhausted');
}

export async function allocateApiPort(winboxPort) {
  const apiPort = winboxPort + 1;
  const { rows } = await pool.query(
    'SELECT 1 FROM stations WHERE winbox_port = $1 OR api_port = $1 LIMIT 1',
    [apiPort]
  );
  if (rows.length) throw new Error(`API port ${apiPort} already in use`);
  return apiPort;
}

// Camera tunnel port: unique PER STATION lang (nasa vpn_ip ng station), starts 10554
export async function allocateTunnelPort(stationId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(tunnel_port), 10553) + 1 AS p FROM cameras WHERE station_id = $1',
    [stationId]
  );
  return Number(rows[0].p);
}

export function generatePassword(len = 16) {
  return crypto.randomBytes(24).toString('base64url').slice(0, len);
}

export function generateToken(len = 10) {
  return crypto.randomBytes(16).toString('hex').slice(0, len);
}
