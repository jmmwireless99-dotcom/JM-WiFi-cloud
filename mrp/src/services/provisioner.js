// Provisioner: declaratively syncs system state from the DB.
// Each step is isolated — failures log but never crash the API process.
import { writeFile, rename, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pool, audit } from '../db.js';

const exec = promisify(execFile);
const DRY = process.env.DRY_RUN === '1';
const EXEC_MS = Number(process.env.EXEC_TIMEOUT_MS || 2000);
const CACHE_MS = Number(process.env.STATUS_CACHE_MS || 15000);

let sessionsCache = { at: 0, data: new Map() };
let streamsCache = { at: 0, data: {} };

async function run(cmd, args, input) {
  if (DRY) {
    console.log('[dry-run]', cmd, args.join(' '), input ? `<<< ${input.length}B` : '');
    return { stdout: '' };
  }
  return exec(cmd, args, {
    ...(input !== undefined ? { input } : {}),
    timeout: EXEC_MS,
    killSignal: 'SIGKILL',
  });
}

async function atomicWrite(target, body, mode = 0o600) {
  if (DRY) return console.log('[dry-run] write', target, `(${body.length}B)`);
  await mkdir(dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  await writeFile(tmp, body, { mode });
  await rename(tmp, target);
}

async function syncSecrets() {
  const [{ rows: stations }, { rows: staff }] = await Promise.all([
    pool.query("SELECT username, password, vpn_ip FROM stations WHERE status = 'active' ORDER BY id"),
    pool.query(
      `SELECT vpn_username AS username, vpn_password AS password, vpn_ip
         FROM staff_accounts
        WHERE is_active AND vpn_enabled AND vpn_username IS NOT NULL
        ORDER BY id`
    ),
  ]);
  const rows = [...stations, ...staff];
  const body =
    '# MANAGED BY mrp-backend - DO NOT EDIT BY HAND\n' +
    rows.map(r => `"${r.username}" * "${r.password}" ${r.vpn_ip}`).join('\n') + '\n';
  await atomicWrite(process.env.CHAP_SECRETS_FILE || '/etc/ppp/chap-secrets', body);
}

async function syncNft() {
  const wan = process.env.WAN_INTERFACE || 'eth0';
  const gw = process.env.VPN_GATEWAY || '10.90.0.1';
  const target = process.env.NFT_RULES_FILE || '/run/mrp.nft';
  const { rows } = await pool.query(
    "SELECT vpn_ip, winbox_port, api_port FROM stations WHERE status = 'active'"
  );
  const dnat = rows.flatMap(s => [
    `    iif "${wan}" tcp dport ${s.winbox_port} dnat to ${s.vpn_ip}:8291`,
    `    iif "${wan}" tcp dport ${s.api_port} dnat to ${s.vpn_ip}:8728`,
  ]).join('\n');
  const ruleset = `table ip mrp {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
${dnat || '    # no active stations'}
  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip daddr 10.90.0.0/21 snat to ${gw}
  }
  chain forward {
    type filter hook forward priority filter; policy accept;
    ip daddr 10.90.0.0/21 ct state established,related,new accept
  }
}
`;
  await atomicWrite(target, ruleset, 0o644);
  try {
    await run('nft', ['delete', 'table', 'ip', 'mrp']);
  } catch {
    // first deploy — table may not exist yet
  }
  await run('nft', ['-f', target]);
}

export function streamPathName(cam) {
  return `cam${cam.id}-${cam.stream_token}`;
}

function rtspSource(cam, vpnIp) {
  const auth = cam.rtsp_user
    ? `${encodeURIComponent(cam.rtsp_user)}:${encodeURIComponent(cam.rtsp_pass || '')}@`
    : '';
  const path = cam.rtsp_path.startsWith('/') ? cam.rtsp_path : '/' + cam.rtsp_path;
  return `rtsp://${auth}${vpnIp}:${cam.tunnel_port}${path}`;
}

async function syncMediamtx() {
  const { rows } = await pool.query(
    `SELECT c.*, s.vpn_ip FROM cameras c
       JOIN stations s ON s.id = c.station_id
      WHERE c.enabled AND s.status = 'active'
      ORDER BY c.id`
  );
  const paths = rows.map(c =>
    `  ${streamPathName(c)}:\n` +
    `    source: ${rtspSource(c, c.vpn_ip)}\n` +
    `    sourceOnDemand: yes\n` +
    `    sourceOnDemandStartTimeout: 10s\n` +
    `    sourceOnDemandCloseAfter: 30s`
  ).join('\n');

  const cfg = `# MANAGED BY mrp-backend - DO NOT EDIT BY HAND
logLevel: info
api: yes
apiAddress: 127.0.0.1:9997

rtsp: no
rtmp: no
srt: no
webrtc: no

hls: yes
hlsAddress: :${process.env.HLS_PORT || 8888}
hlsAlwaysRemux: yes
hlsVariant: fmp4
hlsSegmentCount: 7
hlsSegmentDuration: 2s
hlsAllowOrigin: '*'

paths:
${paths || '  {}'}
`;
  const target = process.env.MEDIAMTX_CONFIG || '/etc/mediamtx/mediamtx.yml';
  await atomicWrite(target, cfg, 0o644);
  // MediaMTX hot-reloads on file change. Do NOT systemctl restart here —
  // restart storms hit start-limit and take /hls down (404/503).
  try {
    const { stdout } = await run('systemctl', ['is-active', 'mediamtx']);
    if ((stdout || '').trim() !== 'active') {
      await run('systemctl', ['reset-failed', 'mediamtx']);
      await run('systemctl', ['start', 'mediamtx']);
    }
  } catch {
    // mediamtx not installed — skip
  }
}

export async function terminateSession(username) {
  try {
    await run('accel-cmd', ['-H', '127.0.0.1', '-p', '2001', 'terminate', 'username', username, 'hard']);
  } catch (e) {
    console.log(`terminate ${username}: ${e.message}`);
  }
}

export async function getActiveSessions() {
  const now = Date.now();
  if (now - sessionsCache.at < CACHE_MS) return sessionsCache.data;
  try {
    const { stdout } = await run('accel-cmd', ['-H', '127.0.0.1', '-p', '2001', 'show', 'sessions', 'username,ip,uptime']);
    const online = new Map();
    for (const line of (stdout || '').split('\n').slice(2)) {
      const parts = line.split('|').map(x => x.trim());
      if (parts.length >= 3 && parts[0]) online.set(parts[0], { ip: parts[1], uptime: parts[2] });
    }
    sessionsCache = { at: now, data: online };
    return online;
  } catch {
    sessionsCache = { at: now, data: new Map() };
    return sessionsCache.data;
  }
}

export async function getStreamStates() {
  const now = Date.now();
  if (now - streamsCache.at < CACHE_MS) return streamsCache.data;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), EXEC_MS);
    const res = await fetch(
      (process.env.MEDIAMTX_API || 'http://127.0.0.1:9997') + '/v3/paths/list?itemsPerPage=500',
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    const data = await res.json();
    const map = {};
    for (const item of data.items || []) {
      map[item.name] = { ready: item.ready, readers: (item.readers || []).length };
    }
    streamsCache = { at: now, data: map };
    return map;
  } catch {
    streamsCache = { at: now, data: {} };
    return streamsCache.data;
  }
}

export async function sync(actor = 'system', reason = 'sync') {
  const steps = [
    ['secrets', syncSecrets],
    ['nft', syncNft],
    ['mediamtx', syncMediamtx],
  ];
  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (e) {
      console.error(`sync ${name} failed:`, e.message);
    }
  }
  try {
    await audit(actor, 'sync', { reason });
  } catch (e) {
    console.error('sync audit failed:', e.message);
  }
}
