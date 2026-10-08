import { Router } from 'express';
import { pool, audit } from '../db.js';
import { allocateVpnIp, allocateWinboxPort, allocateApiPort, generatePassword } from '../services/allocator.js';
import { sync, terminateSession, getActiveSessions, getStreamStates, streamPathName } from '../services/provisioner.js';
import { requireAdmin } from '../auth.js';
import { HUB, SSTP_PORT, hlsBase } from '../config.js';
import { coordsFromRow, parseLatLngPair } from '../geoCoords.js';
import { probeMikrotik } from '../services/mikrotikRest.js';

const r = Router();
r.use(requireAdmin);
const HLS = hlsBase;

function toView(s, online, { includeSecrets = false } = {}) {
  const { lat, lng } = coordsFromRow(s);
  const view = {
    id: s.id,
    name: s.name,
    username: s.username,
    sstpServer: HUB(),
    sstpPort: SSTP_PORT(),
    vpnAddress: `${HUB()}:${s.winbox_port}`,
    apiAddress: `${HUB()}:${s.api_port}`,
    apiUser: s.api_user || 'admin',
    vpnIp: s.vpn_ip,
    winboxPort: s.winbox_port,
    apiPort: s.api_port,
    status: s.status,
    online: online?.has(s.username) || false,
    created: s.created_at,
    expiration: s.expires_at,
    notes: s.notes,
    lat,
    lng,
    cameraCount: s.camera_count !== undefined ? Number(s.camera_count) : undefined,
  };
  if (includeSecrets) {
    view.apiPassword = s.api_password || '';
  }
  return view;
}

/** Escape for RouterOS quoted strings in pasted scripts. */
function rosQuote(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Paste-once script: SSTP VPN + Winbox/API/REST services + cloud API user.
 * Credentials match what the VPS portal stores (api_user / api_password).
 */
export function routerosScript(s, cams = []) {
  const iface = 'sstp-cctv';
  const tag = 'JM TECH SOLUTION';
  const apiUser = String(s.api_user || s.apiUser || 'jmcloud').trim() || 'jmcloud';
  const apiPass = String(s.api_password || s.apiPassword || s.password || '');
  const apiUserQ = rosQuote(apiUser);
  const apiPassQ = rosQuote(apiPass);
  const sstpUserQ = rosQuote(s.username);
  const sstpPassQ = rosQuote(s.password);
  const lines = [
    `# --- ${tag}: i-paste sa MikroTik terminal ng "${s.name}" ---`,
    `# Pagkatapos nito: VPN + Winbox + API/REST ready; credentials naka-save na sa VPS portal.`,
    '',
    `# 1) SSTP VPN client → ${HUB()}:${SSTP_PORT()}`,
    `:do { /interface sstp-client remove [find name="${iface}"] } on-error={}`,
    `/interface sstp-client add name=${iface} connect-to=${HUB()} port=${SSTP_PORT()} \\`,
    `    user="${sstpUserQ}" password="${sstpPassQ}" profile=default \\`,
    `    verify-server-certificate=no verify-server-address-from-certificate=no disabled=no`,
    '',
    `# 2) Cloud API user (same as portal) — REST + binary API`,
    `#    user=${apiUser}  · password naka-save na sa VPS (portal Test / hotspot push)`,
    `:if ([:len [/user find where name="${apiUserQ}"]] = 0) do={`,
    `  /user add name="${apiUserQ}" password="${apiPassQ}" group=full comment="${tag} cloud API"`,
    `} else={`,
    `  /user set [find where name="${apiUserQ}"] password="${apiPassQ}"`,
    `}`,
    '',
    `# 3) Winbox + API (:8728) + www/REST (:80) — VPN subnet only`,
    `#    Winbox: ${HUB()}:${s.winbox_port} → ${s.vpn_ip}:8291`,
    `#    API:    ${HUB()}:${s.api_port} → ${s.vpn_ip}:8728`,
    `#    REST:   http://${s.vpn_ip}/rest/  (from VPS over tunnel)`,
    `/ip service set winbox disabled=no address=10.90.0.0/21`,
    `/ip service set api disabled=no address=10.90.0.0/21`,
    `/ip service set www disabled=no address=10.90.0.0/21`,
    `:do { /ip firewall filter remove [find where comment~"${tag}:"] } on-error={}`,
    `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8291 src-address=10.90.0.0/21 comment="${tag}: Winbox via VPN"`,
    `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.90.0.0/21 comment="${tag}: API via VPN"`,
    `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=80 src-address=10.90.0.0/21 comment="${tag}: REST www via VPN"`,
    '',
    `# 4) Firewall — allow hub to reach cameras (forward / dst-nat)`,
    `/ip firewall filter add chain=forward action=accept connection-state=established,related,untracked comment="${tag}: established"`,
    `/ip firewall filter add chain=forward action=accept connection-nat-state=dstnat in-interface=${iface} comment="${tag}: hub to camera"`,
  ];
  if (cams.length) {
    lines.push('', `# NAT — camera ports (hub pulls RTSP via tunnel IP:${s.vpn_ip})`);
    for (const c of cams) {
      lines.push(
        `/ip firewall nat add chain=dstnat in-interface=${iface} protocol=tcp dst-port=${c.tunnel_port} \\`,
        `    action=dst-nat to-addresses=${c.lan_ip} to-ports=${c.rtsp_port} comment="${tag}: ${c.name}"`
      );
    }
  } else {
    lines.push('', `# (Add CCTV sa portal para makakuha ng NAT rules — o idagdag manually later)`);
  }
  lines.push(
    '',
    `# Done. Sa portal: MikroTik Sites → Test (dapat online pag naka-VPN na).`,
  );
  return lines.join('\n');
}

r.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*,
            (SELECT COUNT(*) FROM cameras cam WHERE cam.station_id = s.id) AS camera_count
       FROM stations s ORDER BY s.id`);
  const online = await getActiveSessions();
  res.json(rows.map(s => toView(s, online)));
});

r.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM stations WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const s = rows[0];
  const { rows: cams } = await pool.query('SELECT * FROM cameras WHERE station_id=$1 ORDER BY id', [s.id]);
  const online = await getActiveSessions();
  const streams = await getStreamStates();
  res.json({
    ...toView(s, online, { includeSecrets: true }),
    password: s.password,
    routerosScript: routerosScript(s, cams),
    cameras: cams.map(c => ({
      id: c.id, name: c.name, lanIp: c.lan_ip, rtspPort: c.rtsp_port, rtspPath: c.rtsp_path,
      tunnelPort: c.tunnel_port, enabled: c.enabled,
      hlsUrl: `${HLS()}/${streamPathName(c)}/index.m3u8`,
      stream: streams[streamPathName(c)] || null,
    })),
  });
});

// POST /api/stations { name, days?, username?, password?, apiUser?, apiPassword?, vpnIp?, winboxPort? }
r.post('/', async (req, res) => {
  const { name, days, notes = '' } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  let username = (req.body.username || '').trim().toLowerCase();
  if (username && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username))
    return res.status(400).json({ error: 'username: 3-32 chars, letters/numbers/dot/dash lang' });
  if (!username)
    username = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
      + '-' + Math.random().toString(36).slice(2, 6);

  let password = (req.body.password || '').trim();
  if (password && password.length < 8)
    return res.status(400).json({ error: 'password: minimum 8 characters' });
  if (!password) password = generatePassword();

  // Dedicated cloud API user by default — auto password so paste script + VPS match
  let apiUser = String(req.body.apiUser ?? req.body.api_user ?? 'jmcloud').trim() || 'jmcloud';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,30}$/.test(apiUser))
    return res.status(400).json({ error: 'apiUser: letters/numbers/._- only (max 31)' });
  let apiPassword = String(req.body.apiPassword ?? req.body.api_password ?? '').trim();
  if (apiPassword && apiPassword.length < 8)
    return res.status(400).json({ error: 'apiPassword: minimum 8 characters' });
  if (!apiPassword) apiPassword = generatePassword(18);

  let vpnIp = (req.body.vpnIp || '').trim();
  if (vpnIp && !/^\d{1,3}(\.\d{1,3}){3}$/.test(vpnIp))
    return res.status(400).json({ error: 'invalid vpnIp' });
  if (!vpnIp) vpnIp = await allocateVpnIp();

  let port = Number(req.body.winboxPort) || 0;
  if (port && (port < 1024 || port > 65535))
    return res.status(400).json({ error: 'winboxPort: 1024-65535' });
  if (!port) port = await allocateWinboxPort();
  const apiPort = await allocateApiPort(port);

  const expires = days ? `now() + interval '${Number(days)} days'` : 'NULL';
  let lat = null;
  let lng = null;
  try {
    const coords = parseLatLngPair(req.body || {});
    if (coords) { lat = coords.lat; lng = coords.lng; }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO stations (name, username, password, vpn_ip, winbox_port, api_port, api_user, api_password, expires_at, notes, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ${expires}, $9, $10, $11) RETURNING *`,
      [name.trim(), username, password, vpnIp, port, apiPort, apiUser, apiPassword, notes, lat, lng]
    );
    const s = rows[0];
    await sync('admin', `create station ${username}`);
    await audit('admin', 'station.create', { username, vpnIp, port, apiPort, apiUser, days: days || null });
    res.status(201).json({
      ...toView(s, undefined, { includeSecrets: true }),
      password,
      routerosScript: routerosScript(s),
    });
  } catch (e) {
    if (e.code === '23505') {
      const c = e.constraint || '';
      if (c.includes('username')) return res.status(409).json({ error: 'SSTP username ay gamit na — subukan ibang username' });
      if (c.includes('vpn_ip')) return res.status(409).json({ error: 'VPN IP ay gamit na — subukan ulit' });
      if (c.includes('port')) return res.status(409).json({ error: 'Winbox/API port ay gamit na — subukan ulit' });
      return res.status(409).json({ error: 'username, VPN IP, o port ay gamit na' });
    }
    throw e;
  }
});

r.patch('/:id', async (req, res) => {
  const sets = []; const vals = [];
  const map = { name: 'name', notes: 'notes', password: 'password' };
  for (const [k, col] of Object.entries(map)) {
    if (req.body?.[k] !== undefined && String(req.body[k]).trim()) {
      vals.push(String(req.body[k]).trim()); sets.push(`${col} = $${vals.length}`);
    }
  }
  if (req.body?.apiUser !== undefined || req.body?.api_user !== undefined) {
    vals.push(String(req.body.apiUser ?? req.body.api_user ?? 'admin').trim() || 'admin');
    sets.push(`api_user = $${vals.length}`);
  }
  const apiPass = req.body?.apiPassword ?? req.body?.api_password;
  if (apiPass !== undefined && String(apiPass).trim()) {
    vals.push(String(apiPass).trim());
    sets.push(`api_password = $${vals.length}`);
  }
  try {
    const coords = parseLatLngPair(req.body || {});
    if (coords) {
      vals.push(coords.lat); sets.push(`lat = $${vals.length}`);
      vals.push(coords.lng); sets.push(`lng = $${vals.length}`);
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE stations SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await sync('admin', `update station ${rows[0].username}`);
  res.json(toView(rows[0]));
});

/** Probe RouterOS REST over VPN (jmwifi-style site Test). */
r.post('/:id/test', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM stations WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const s = rows[0];
  const host = String(s.vpn_ip || '').replace(/\/\d+$/, '');
  if (!host) return res.status(400).json({ error: 'station has no VPN IP' });
  if (!s.api_password) {
    return res.status(400).json({
      ok: false,
      error: 'Walang MikroTik API password — i-Edit ang site at ilagay ang RouterOS API password',
    });
  }
  try {
    const probe = await probeMikrotik({
      mikrotik_host: host,
      api_user: s.api_user || 'admin',
      api_password: s.api_password,
    });
    await audit('admin', 'station.test', { id: s.id, ok: true, version: probe.version, board: probe.board });
    res.json({
      ok: true,
      online: true,
      host,
      version: probe.version,
      board: probe.board,
      uptime: probe.uptime,
      message: `Connected · ${probe.board || 'MikroTik'} · ROS ${probe.version || '?'}`,
    });
  } catch (e) {
    await audit('admin', 'station.test', { id: s.id, ok: false, error: e.message });
    res.status(502).json({
      ok: false,
      online: false,
      host,
      error: e.message || 'MikroTik unreachable',
    });
  }
});

r.post('/:id/extend', async (req, res) => {
  const days = req.body?.days;
  const q = days
    ? { text: `UPDATE stations SET expires_at = GREATEST(COALESCE(expires_at, now()), now()) + ($2 || ' days')::interval, status='active' WHERE id=$1 RETURNING *`, values: [req.params.id, String(Number(days))] }
    : { text: `UPDATE stations SET expires_at = NULL, status='active' WHERE id=$1 RETURNING *`, values: [req.params.id] };
  const { rows } = await pool.query(q);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await sync('admin', `extend ${rows[0].username}`);
  await audit('admin', 'station.extend', { id: rows[0].id, days: days || 'no-expiry' });
  res.json(toView(rows[0]));
});

r.post('/:id/disable', async (req, res) => {
  const { rows } = await pool.query("UPDATE stations SET status='disabled' WHERE id=$1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await sync('admin', `disable ${rows[0].username}`);
  await terminateSession(rows[0].username);
  await audit('admin', 'station.disable', { id: rows[0].id });
  res.json(toView(rows[0]));
});

r.post('/:id/enable', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE stations SET status='active'
      WHERE id=$1 AND (expires_at IS NULL OR expires_at > now()) RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(409).json({ error: 'not found o expired — use extend' });
  await sync('admin', `enable ${rows[0].username}`);
  await audit('admin', 'station.enable', { id: rows[0].id });
  res.json(toView(rows[0]));
});

r.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('DELETE FROM stations WHERE id=$1 RETURNING username', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await sync('admin', `delete ${rows[0].username}`);
  await terminateSession(rows[0].username);
  await audit('admin', 'station.delete', { username: rows[0].username });
  res.json({ ok: true });
});

export default r;
