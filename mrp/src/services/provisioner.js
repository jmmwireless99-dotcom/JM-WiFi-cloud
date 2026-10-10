// Provisioner: declaratively syncs system state from the DB.
// Each step is isolated — failures log but never crash the API process.
import { writeFile, rename, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import { pool, audit } from '../db.js';
import { pushCameraNat, probeMikrotik } from './mikrotikRest.js';

const exec = promisify(execFile);
const DRY = process.env.DRY_RUN === '1';
const EXEC_MS = Number(process.env.EXEC_TIMEOUT_MS || 2000);
const CACHE_MS = Number(process.env.STATUS_CACHE_MS || 15000);
/** Local RTSP for ffmpeg remux (AAC). Avoid 8554/8555 (go2rtc). */
const MTX_RTSP = Number(process.env.MEDIAMTX_RTSP_PORT || 8556);
/** SOCIAL station — shared NVR tunnel :10560 must be dstnat'd after SSTP reconnect. */
const SOCIAL_STATION_ID = Number(process.env.SOCIAL_STATION_ID || 71);

let sessionsCache = { at: 0, data: new Map() };
let streamsCache = { at: 0, data: {} };
/** host:port → last NAT repair attempt ms */
const natRepairAt = new Map();

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

/** Prefer Dahua/Hik substream (subtype=1 / Channels/102) for live HLS — lower bitrate. */
export function liveRtspPath(rtspPath) {
  const raw = String(rtspPath || '').trim() || '/';
  let path = raw.startsWith('/') ? raw : `/${raw}`;
  if (/subtype=\d+/i.test(path)) {
    path = path.replace(/subtype=\d+/i, 'subtype=1');
  } else if (/\/Channels\/\d+/i.test(path)) {
    // Hikvision main .../101 → sub .../102
    path = path.replace(/\/Channels\/(\d)01\b/i, '/Channels/$102');
  }
  return path;
}

/** stations.vpn_ip is inet (often 10.90.0.42/32) — strip CIDR for RTSP URLs. */
export function vpnHost(vpnIp) {
  return String(vpnIp || '').trim().replace(/\/\d+$/, '');
}

export function rtspSource(cam, vpnIp, { liveSubstream = false } = {}) {
  const auth = cam.rtsp_user
    ? `${encodeURIComponent(cam.rtsp_user)}:${encodeURIComponent(cam.rtsp_pass || '')}@`
    : '';
  const host = vpnHost(vpnIp);
  const path = liveSubstream
    ? liveRtspPath(cam.rtsp_path)
    : (cam.rtsp_path.startsWith('/') ? cam.rtsp_path : '/' + cam.rtsp_path);
  return `rtsp://${auth}${host}:${cam.tunnel_port}${path}`;
}

/**
 * ffmpeg → MediaMTX publisher for browser HLS.
 * SOCIAL / modern Dahua cams often send HEVC; browsers cannot play HEVC in MSE/HLS.
 *
 * MediaMTX 1.9: HLS readers do NOT trigger runOnDemand on empty publisher paths
 * (instant 404). runOnInit works — but always-on remux of ~30 HEVC channels
 * saturates a 1-vCPU VPS so streams flap offline.
 *
 * Default MEDIAMTX_REMUX_MODE=pool:
 *  - YAML registers publisher stubs only (idle CPU ~0)
 *  - ensureLiveRemux() starts runOnInit via API when a viewer opens a cam
 *  - sweepRemuxIdle() stops remux when readers=0 after idle TTL
 * Set MEDIAMTX_REMUX_MODE=always for legacy always-on runOnInit.
 */
const REMUX_MODE = String(process.env.MEDIAMTX_REMUX_MODE || 'pool').toLowerCase();
// Cap concurrent ffmpeg remuxes for a 1-vCPU hub. 30 concurrent HEVC→x264
// saturates load≈30 and leaves tiles stuck on Connecting. Wall warms a page
// of visible cams; All Cam cycles / LRU-evicts. Override via MEDIAMTX_REMUX_MAX.
const REMUX_MAX = Math.max(1, Number(process.env.MEDIAMTX_REMUX_MAX || 8));
const REMUX_IDLE_MS = Math.max(15_000, Number(process.env.MEDIAMTX_REMUX_IDLE_MS || 45_000));
// Keep a small set of recently-used remuxes warm (first-paint cache). 0 = off.
const REMUX_KEEPALIVE = Math.max(0, Math.min(REMUX_MAX, Number(process.env.MEDIAMTX_REMUX_KEEPALIVE || 4)));
const MTX_API = () => (process.env.MEDIAMTX_API || 'http://127.0.0.1:9997').replace(/\/$/, '');

/** pathName → { origin, startedAt, lastEnsureAt, lite } */
const remuxActive = new Map();
let remuxSweepTimer = null;

export function remuxFfmpegCmd(originRtsp, { lite = false } = {}) {
  // Lite: Live Wall grid — tiny encode + no audio so a handful fit a 1-vCPU hub.
  // Short GOP → first HLS keyframe/segment arrives sooner.
  const vf = lite ? 'scale=240:-2' : 'scale=480:-2';
  const bv = lite ? '120k' : '400k';
  const maxrate = lite ? '150k' : '500k';
  const bufsize = lite ? '300k' : '1000k';
  const gop = lite ? 16 : 30;
  const mapAudio = lite ? '' : ' -map 0:a:0?';
  const audio = lite
    ? '-an'
    : '-c:a aac -ac 1 -ar 16000 -b:a 48k';
  return (
    `ffmpeg -hide_banner -loglevel error -fflags nobuffer -flags low_delay ` +
    `-rtsp_transport tcp -probesize 32k -analyzeduration 0 -i '${originRtsp}' ` +
    `-map 0:v:0${mapAudio} ` +
    `-c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p ` +
    `-profile:v baseline -level 3.0 -g ${gop} -keyint_min ${gop} -sc_threshold 0 -vf ${vf} ` +
    `-b:v ${bv} -maxrate ${maxrate} -bufsize ${bufsize} ` +
    `${audio} ` +
    `-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:$RTSP_PORT/$MTX_PATH`
  );
}

function pathBlockAlways(name, originRtsp) {
  const cmd = remuxFfmpegCmd(originRtsp);
  return (
    `  ${name}:\n` +
    `    source: publisher\n` +
    `    runOnInit: ${JSON.stringify(cmd)}\n` +
    `    runOnInitRestart: yes`
  );
}

function pathBlockPool(name) {
  return (
    `  ${name}:\n` +
    `    source: publisher`
  );
}

async function mtxFetch(path, { method = 'GET', body, timeoutMs } = {}) {
  const ctrl = new AbortController();
  const ms = Math.max(1000, Number(timeoutMs) || EXEC_MS * 4);
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${MTX_API()}${path}`, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

async function stopRemuxPath(name) {
  await mtxFetch(`/v3/config/paths/replace/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { name, source: 'publisher' },
    timeoutMs: 15_000,
  });
  remuxActive.delete(name);
}

async function evictOldestRemux(keepName) {
  while (remuxActive.size >= REMUX_MAX) {
    let victim = null;
    let oldest = Infinity;
    for (const [n, meta] of remuxActive) {
      if (n === keepName) continue;
      const ts = meta.lastEnsureAt || meta.startedAt || 0;
      if (ts < oldest) { oldest = ts; victim = n; }
    }
    if (!victim) break;
    try { await stopRemuxPath(victim); } catch (e) {
      console.error('remux evict', victim, e.message);
      remuxActive.delete(victim);
    }
  }
}

function tcpOpen(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port: Number(port), family: 4 }, () => {
      sock.destroy();
      resolve(true);
    });
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.on('error', () => { clearTimeout(t); resolve(false); });
    sock.on('close', () => clearTimeout(t));
  });
}

/**
 * If SOCIAL NVR RTSP tunnel is closed after SSTP flap, re-push MikroTik dstnat.
 * Throttled so Live Wall multi-cam warm does not hammer RouterOS.
 */
async function ensureTunnelOrRepairNat(cam, vpnIp) {
  const host = vpnHost(vpnIp);
  const port = Number(cam.tunnel_port);
  if (!host || !port) return { ok: false, skipped: true };
  if (await tcpOpen(host, port)) return { ok: true, open: true };

  const key = `${host}:${port}`;
  const now = Date.now();
  const last = natRepairAt.get(key) || 0;
  if (now - last < 45_000) return { ok: false, open: false, throttled: true };
  natRepairAt.set(key, now);

  if (Number(cam.station_id) !== SOCIAL_STATION_ID && Number(cam.nvr_area_id) == null) {
    return { ok: false, open: false };
  }
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.lan_ip, n.rtsp_port, host(s.vpn_ip) AS vpn_ip, s.api_user, s.api_password
         FROM nvr_areas n
         JOIN stations s ON s.id = n.station_id
        WHERE n.station_id = $1
        ORDER BY n.id
        LIMIT 1`,
      [Number(cam.station_id) || SOCIAL_STATION_ID]
    );
    const nvr = rows[0];
    if (!nvr?.api_password || !nvr.vpn_ip) return { ok: false, open: false, reason: 'no api' };
    const site = {
      mikrotik_host: String(nvr.vpn_ip).replace(/\/\d+$/, ''),
      api_user: nvr.api_user || 'admin',
      api_password: nvr.api_password,
    };
    await probeMikrotik(site);
    const { rows: cams } = await pool.query(
      `SELECT DISTINCT ON (tunnel_port) name, lan_ip, rtsp_port, tunnel_port
         FROM cameras WHERE nvr_area_id = $1 AND enabled ORDER BY tunnel_port, id`,
      [nvr.id]
    );
    const push = await pushCameraNat(
      site,
      cams.map((c) => ({
        name: c.name,
        tunnelPort: c.tunnel_port,
        lanIp: c.lan_ip || nvr.lan_ip,
        rtspPort: c.rtsp_port || nvr.rtsp_port || 554,
      }))
    );
    console.warn('ensureTunnelOrRepairNat', key, push.ok ? 'pushed' : 'push-failed', push.errors || []);
    // brief settle after dstnat replace
    await new Promise((r) => setTimeout(r, 400));
    const open = await tcpOpen(host, port, 3500);
    return { ok: open, open, repaired: true, pushOk: push.ok };
  } catch (e) {
    console.error('ensureTunnelOrRepairNat', key, e.message);
    return { ok: false, open: false, error: e.message };
  }
}

/**
 * Start (or refresh) H.264 remux for one camera path.
 * Call from the player / live wall before loading HLS.
 */
export async function ensureLiveRemux(cam, vpnIp, { lite = false, waitReady = false } = {}) {
  if (process.env.MEDIAMTX_AAC_REMUX === '0') {
    return { ok: true, mode: 'passthrough', pathName: streamPathName(cam) };
  }
  const name = streamPathName(cam);
  const origin = rtspSource(cam, vpnIp, { liveSubstream: true });
  const now = Date.now();
  // Prefer lite whenever the pool is busy or the caller asks (Live Wall / All Cam).
  const useLite = lite || remuxActive.size >= 3;

  if (REMUX_MODE !== 'pool') {
    return { ok: true, mode: 'always', pathName: name };
  }

  // After SSTP reconnect, MikroTik dstnat for :10560 can be missing → remux never ready.
  try {
    await ensureTunnelOrRepairNat(cam, vpnIp);
  } catch (e) {
    console.error('tunnel repair', e.message);
  }

  const existing = remuxActive.get(name);
  if (existing) {
    existing.lastEnsureAt = now;
    try {
      const st = await mtxFetch(`/v3/paths/get/${encodeURIComponent(name)}`, { timeoutMs: 3000 });
      if (st.ok && st.data?.ready) {
        return {
          ok: true,
          mode: 'pool',
          pathName: name,
          ready: true,
          reused: true,
          lite: !!existing.lite,
          active: remuxActive.size,
          max: REMUX_MAX,
        };
      }
    } catch { /* restart below */ }
  }

  await evictOldestRemux(name);
  const cmd = remuxFfmpegCmd(origin, { lite: useLite });
  try {
    const res = await mtxFetch(`/v3/config/paths/replace/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: {
        name,
        source: 'publisher',
        runOnInit: cmd,
        runOnInitRestart: true,
      },
      // Keep replace snappy — under load MediaMTX stalls; client retries + HLS cover it.
      timeoutMs: 8_000,
    });
    if (!res.ok) {
      throw new Error(typeof res.data === 'string' ? res.data : `mediamtx remux start failed (${res.status})`);
    }
  } catch (e) {
    // Still mark warming so clients attach HLS / retry instead of hard Stream error.
    remuxActive.set(name, { origin, startedAt: now, lastEnsureAt: now, lite: useLite });
    scheduleRemuxSweep();
    return {
      ok: true,
      mode: 'pool',
      pathName: name,
      ready: false,
      warming: true,
      deferred: true,
      lite: useLite,
      active: remuxActive.size,
      max: REMUX_MAX,
      error: e?.message || String(e),
    };
  }
  remuxActive.set(name, { origin, startedAt: now, lastEnsureAt: now, lite: useLite });
  scheduleRemuxSweep();

  // Default: return immediately so the player can start HLS as soon as the first
  // segment exists (HLS.js retries). Optional single quick probe when waitReady.
  if (waitReady) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const st = await mtxFetch(`/v3/paths/get/${encodeURIComponent(name)}`, { timeoutMs: 2000 });
      if (st.ok && st.data?.ready) {
        return {
          ok: true,
          mode: 'pool',
          pathName: name,
          ready: true,
          lite: useLite,
          active: remuxActive.size,
          max: REMUX_MAX,
        };
      }
    } catch { /* warming */ }
  }
  return {
    ok: true,
    mode: 'pool',
    pathName: name,
    ready: false,
    warming: true,
    lite: useLite,
    active: remuxActive.size,
    max: REMUX_MAX,
  };
}

/** Count only real viewers — MediaMTX hlsMuxer stays attached and must not block idle sweep. */
function liveReaderCount(readers) {
  if (!Array.isArray(readers)) return Number(readers) || 0;
  return readers.filter((r) => r && r.type && r.type !== 'hlsMuxer').length;
}

export async function sweepRemuxIdle() {
  if (REMUX_MODE !== 'pool' || !remuxActive.size) return { stopped: 0 };
  let stopped = 0;
  const states = await getStreamStates(true);
  const now = Date.now();

  // Protect a small keep-alive set (most recently ensured) from eviction.
  const keep = new Set(
    [...remuxActive.entries()]
      .sort((a, b) => (b[1].lastEnsureAt || 0) - (a[1].lastEnsureAt || 0))
      .slice(0, REMUX_KEEPALIVE)
      .map(([n]) => n)
  );

  for (const [name, meta] of [...remuxActive.entries()]) {
    const st = states[name];
    const readers = st?.liveReaders ?? st?.readers ?? 0;
    const idleFor = now - (meta.lastEnsureAt || meta.startedAt || now);
    if (readers > 0) {
      meta.lastEnsureAt = now;
      continue;
    }
    if (keep.has(name) && remuxActive.size <= REMUX_MAX) continue;
    if (idleFor < REMUX_IDLE_MS) continue;
    try {
      await stopRemuxPath(name);
      stopped += 1;
    } catch (e) {
      console.error('remux sweep', name, e.message);
    }
  }
  return { stopped, active: remuxActive.size, keepalive: keep.size };
}

function scheduleRemuxSweep() {
  if (remuxSweepTimer) return;
  remuxSweepTimer = setInterval(() => {
    sweepRemuxIdle().catch((e) => console.error('remux sweep', e.message));
  }, Math.min(30_000, Math.max(10_000, Math.floor(REMUX_IDLE_MS / 3))));
  if (typeof remuxSweepTimer.unref === 'function') remuxSweepTimer.unref();
}

async function syncMediamtx() {
  const { rows } = await pool.query(
    `SELECT c.*, s.vpn_ip FROM cameras c
       JOIN stations s ON s.id = c.station_id
      WHERE c.enabled AND s.status = 'active'
      ORDER BY c.id`
  );
  const useRemux = process.env.MEDIAMTX_AAC_REMUX !== '0';
  const poolMode = useRemux && REMUX_MODE === 'pool';
  const paths = rows.map(c => {
    const origin = rtspSource(c, c.vpn_ip, { liveSubstream: true });
    const name = streamPathName(c);
    if (!useRemux) {
      return (
        `  ${name}:\n` +
        `    source: ${origin}\n` +
        `    sourceOnDemand: yes\n` +
        `    sourceOnDemandStartTimeout: 20s\n` +
        `    sourceOnDemandCloseAfter: 45s\n` +
        `    rtspTransport: tcp`
      );
    }
    // Keep currently-warm remuxes in YAML so file reload does not kill them.
    if (poolMode) {
      if (remuxActive.has(name)) {
        remuxActive.get(name).origin = origin;
        return pathBlockAlways(name, origin);
      }
      return pathBlockPool(name);
    }
    return pathBlockAlways(name, origin);
  }).join('\n');

  const cfg = `# MANAGED BY mrp-backend - DO NOT EDIT BY HAND
logLevel: info
api: yes
apiAddress: 127.0.0.1:9997

rtsp: yes
rtspAddress: 127.0.0.1:${MTX_RTSP}
rtmp: no
srt: no
webrtc: no

hls: yes
hlsAddress: :${process.env.HLS_PORT || 8888}
hlsAlwaysRemux: ${poolMode ? 'no' : 'yes'}
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
  if (poolMode) scheduleRemuxSweep();
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

export async function getStreamStates(force = false) {
  const now = Date.now();
  if (!force && now - streamsCache.at < CACHE_MS) return streamsCache.data;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), EXEC_MS);
    const res = await fetch(
      MTX_API() + '/v3/paths/list?itemsPerPage=500',
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    const data = await res.json();
    const map = {};
    for (const item of data.items || []) {
      const raw = item.readers || [];
      const live = liveReaderCount(raw);
      map[item.name] = {
        ready: item.ready,
        readers: live,
        liveReaders: live,
        hlsMuxer: raw.some((r) => r?.type === 'hlsMuxer'),
      };
    }
    streamsCache = { at: now, data: map };
    return map;
  } catch {
    streamsCache = { at: now, data: {} };
    return streamsCache.data;
  }
}

/** Format local time for Dahua playback query: YYYY_MM_DD_HH_MM_SS */
export function dahuaTime(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) throw new Error('invalid datetime');
  const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}_${p(x.getMonth() + 1)}_${p(x.getDate())}_${p(x.getHours())}_${p(x.getMinutes())}_${p(x.getSeconds())}`;
}

/**
 * Register an on-demand MediaMTX path for Dahua playback RTSP.
 * Returns HLS path name (without /index.m3u8).
 */
export async function startPlaybackPath(cam, vpnIp, start, end) {
  const startStr = dahuaTime(start);
  const endStr = dahuaTime(end);
  const auth = cam.rtsp_user
    ? `${encodeURIComponent(cam.rtsp_user)}:${encodeURIComponent(cam.rtsp_pass || '')}@`
    : '';
  // Prefer dedicated playback URL; cams without SD/NVR record will fail clearly
  const pbPath =
    `/cam/playback?channel=1&subtype=0&starttime=${startStr}&endtime=${endStr}`;
  const origin = `rtsp://${auth}${vpnHost(vpnIp)}:${cam.tunnel_port}${pbPath}`;
  const name = `pb${cam.id}-${Date.now().toString(36)}`;
  const api = (process.env.MEDIAMTX_API || 'http://127.0.0.1:9997').replace(/\/$/, '');

  const useRemux = process.env.MEDIAMTX_AAC_REMUX !== '0';
  let body;
  if (useRemux) {
    // HEVC playback also needs H.264 remux for browser HLS
    body = {
      name,
      source: 'publisher',
      runOnInit: remuxFfmpegCmd(origin),
      runOnInitRestart: true,
    };
  } else {
    body = {
      name,
      source: origin,
      sourceOnDemand: true,
      sourceOnDemandStartTimeout: '25s',
      sourceOnDemandCloseAfter: '120s',
      rtspTransport: 'tcp',
    };
  }

  const res = await fetch(`${api}/v3/config/paths/add/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `mediamtx add path failed (${res.status})`);
  }
  // Auto-delete later (best-effort)
  setTimeout(() => {
    fetch(`${api}/v3/config/paths/delete/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  }, 15 * 60 * 1000);
  return { pathName: name, origin, start: startStr, end: endStr };
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
