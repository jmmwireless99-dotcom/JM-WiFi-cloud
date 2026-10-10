import { Router } from 'express';
import { pool, audit } from '../db.js';
import { requireAdmin } from '../auth.js';
import { coordsFromRow, parseLatLngPair } from '../geoCoords.js';
import { pushCameraNat, probeMikrotik } from '../services/mikrotikRest.js';
import { sync } from '../services/provisioner.js';
import { allocateTunnelPort, generateToken } from '../services/allocator.js';

const r = Router();
r.use(requireAdmin);

function toView(row, { includeSecrets = false } = {}) {
  const { lat, lng } = coordsFromRow(row);
  const view = {
    id: row.id,
    stationId: row.station_id,
    stationName: row.station_name || null,
    stationOnline: row.station_online ?? null,
    name: row.name,
    notes: row.notes || '',
    brand: row.brand || 'dahua',
    model: row.model || '',
    lanIp: row.lan_ip || null,
    rtspPort: row.rtsp_port != null ? Number(row.rtsp_port) : 554,
    tcpPort: row.tcp_port != null ? Number(row.tcp_port) : 37777,
    rtspUser: row.rtsp_user || 'admin',
    channels: row.channels != null ? Number(row.channels) : 0,
    firmware: row.firmware || '',
    lat,
    lng,
    cameraCount: row.camera_count !== undefined ? Number(row.camera_count) : undefined,
    created: row.created_at,
  };
  if (includeSecrets) view.rtspPass = row.rtsp_pass || '';
  else view.hasRtspPass = !!(row.rtsp_pass && String(row.rtsp_pass).length);
  return view;
}

function deviceFieldsFromBody(body = {}) {
  const out = {};
  if (body.brand !== undefined) out.brand = String(body.brand || 'dahua').toLowerCase();
  if (body.model !== undefined) out.model = String(body.model || '').trim();
  if (body.lanIp !== undefined || body.lan_ip !== undefined) {
    out.lan_ip = String((body.lanIp ?? body.lan_ip) || '').trim() || null;
  }
  if (body.rtspPort !== undefined || body.rtsp_port !== undefined) {
    out.rtsp_port = Number(body.rtspPort ?? body.rtsp_port) || 554;
  }
  if (body.tcpPort !== undefined || body.tcp_port !== undefined) {
    out.tcp_port = Number(body.tcpPort ?? body.tcp_port) || 37777;
  }
  if (body.rtspUser !== undefined || body.rtsp_user !== undefined) {
    out.rtsp_user = String((body.rtspUser ?? body.rtsp_user) || 'admin').trim() || 'admin';
  }
  if (body.rtspPass !== undefined || body.rtsp_pass !== undefined) {
    out.rtsp_pass = String((body.rtspPass ?? body.rtsp_pass) || '');
  }
  if (body.channels !== undefined) out.channels = Math.max(0, Number(body.channels) || 0);
  if (body.firmware !== undefined) out.firmware = String(body.firmware || '').trim();
  return out;
}

async function loadNvrRow(id) {
  const { rows } = await pool.query(
    `SELECT n.*, s.name AS station_name, s.vpn_ip, s.api_user, s.api_password, s.status AS station_status,
            (SELECT COUNT(*)::int FROM cameras c WHERE c.nvr_area_id = n.id) AS camera_count
       FROM nvr_areas n
       JOIN stations s ON s.id = n.station_id
      WHERE n.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** GET /api/nvrs?station_id= */
r.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.station_id) {
    params.push(Number(req.query.station_id));
    where.push(`n.station_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT n.*, s.name AS station_name,
            (SELECT COUNT(*)::int FROM cameras c WHERE c.nvr_area_id = n.id) AS camera_count
       FROM nvr_areas n
       JOIN stations s ON s.id = n.station_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY s.name, n.name, n.id`,
    params
  );
  res.json(rows.map((row) => toView(row, { includeSecrets: false })));
});

r.get('/:id', async (req, res) => {
  const row = await loadNvrRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(toView(row, { includeSecrets: true }));
});

/** POST { stationId, name, notes?, lanIp?, rtspUser?, rtspPass?, ... } */
r.post('/', async (req, res) => {
  const stationId = Number(req.body?.stationId ?? req.body?.station_id);
  const name = String(req.body?.name || '').trim();
  const notes = String(req.body?.notes || '').trim();
  if (!stationId || !name) return res.status(400).json({ error: 'stationId and name required' });

  const { rows: st } = await pool.query(`SELECT id, name FROM stations WHERE id = $1`, [stationId]);
  if (!st[0]) return res.status(400).json({ error: 'MikroTik site / VPN station not found' });

  let lat = null;
  let lng = null;
  try {
    const coords = parseLatLngPair(req.body || {});
    if (coords) { lat = coords.lat; lng = coords.lng; }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const dev = deviceFieldsFromBody(req.body || {});
  try {
    const cols = ['station_id', 'name', 'notes', 'lat', 'lng'];
    const vals = [stationId, name, notes, lat, lng];
    for (const [k, v] of Object.entries(dev)) {
      cols.push(k);
      vals.push(v);
    }
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await pool.query(
      `INSERT INTO nvr_areas (${cols.join(',')}) VALUES (${ph}) RETURNING *`,
      vals
    );
    await audit(req.user?.sub || 'admin', 'nvr.create', { id: rows[0].id, stationId, name });
    res.status(201).json(toView({ ...rows[0], station_name: st[0].name, camera_count: 0 }, { includeSecrets: true }));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'NVR name already exists on this site' });
    throw e;
  }
});

r.patch('/:id', async (req, res) => {
  const sets = [];
  const vals = [];
  if (req.body?.name !== undefined && String(req.body.name).trim()) {
    vals.push(String(req.body.name).trim());
    sets.push(`name = $${vals.length}`);
  }
  if (req.body?.notes !== undefined) {
    vals.push(String(req.body.notes || '').trim());
    sets.push(`notes = $${vals.length}`);
  }
  if (req.body?.stationId !== undefined || req.body?.station_id !== undefined) {
    const sid = Number(req.body.stationId ?? req.body.station_id);
    if (!sid) return res.status(400).json({ error: 'invalid stationId' });
    vals.push(sid);
    sets.push(`station_id = $${vals.length}`);
  }
  const dev = deviceFieldsFromBody(req.body || {});
  for (const [col, v] of Object.entries(dev)) {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
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
  try {
    const { rows } = await pool.query(
      `UPDATE nvr_areas SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const { rows: st } = await pool.query(`SELECT name FROM stations WHERE id = $1`, [rows[0].station_id]);
    res.json(toView({ ...rows[0], station_name: st[0]?.name, camera_count: undefined }, { includeSecrets: true }));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'NVR name already exists on this site' });
    throw e;
  }
});

/**
 * POST /api/nvrs/:id/restore
 * Re-enable / seed NVR channels 1..N (default 30), point them at NVR LAN IP,
 * share one tunnel port → NVR:554, push NAT, re-sync MediaMTX.
 * Body: { channels?: number, sharedTunnel?: boolean }
 */
r.post('/:id/restore', async (req, res) => {
  const nvr = await loadNvrRow(req.params.id);
  if (!nvr) return res.status(404).json({ error: 'not found' });
  const lanIp = String(nvr.lan_ip || '').trim();
  if (!lanIp) {
    return res.status(400).json({ error: 'NVR LAN IP required — i-set muna ang lanIp' });
  }
  const want = Math.min(32, Math.max(1, Number(req.body?.channels ?? nvr.channels ?? 32) || 32));
  const brand = String(nvr.brand || 'dahua').toLowerCase();
  const sharedTunnel = req.body?.sharedTunnel !== false; // NVR-channel model default

  const { rows: existing } = await pool.query(
    `SELECT id, name, rtsp_path, tunnel_port, enabled FROM cameras WHERE nvr_area_id = $1 ORDER BY id`,
    [nvr.id]
  );

  // Prefer an existing shared tunnel; else allocate one.
  let tunnelPort = null;
  if (sharedTunnel) {
    const counts = new Map();
    for (const c of existing) {
      const p = Number(c.tunnel_port);
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    let best = null; let bestN = 0;
    for (const [p, n] of counts) {
      if (n > bestN) { best = p; bestN = n; }
    }
    tunnelPort = best || await allocateTunnelPort(nvr.station_id);
  }

  const byChannel = new Map();
  for (const c of existing) {
    const m = String(c.rtsp_path || '').match(/channel=(\d+)/i)
      || String(c.rtsp_path || '').match(/\/Channels\/(\d+)/i);
    if (m) byChannel.set(Number(m[1]), c);
  }

  let created = 0;
  let enabled = 0;
  for (let ch = 1; ch <= want; ch++) {
    const path = brand === 'hikvision'
      ? `/Streaming/Channels/${ch}01`
      : `/cam/realmonitor?channel=${ch}&subtype=0`;
    const row = byChannel.get(ch);
    if (row) {
      const port = sharedTunnel ? tunnelPort : row.tunnel_port;
      await pool.query(
        `UPDATE cameras SET enabled=true, lan_ip=$1, rtsp_port=$2, rtsp_path=$3,
            rtsp_user=$4, rtsp_pass=$5, tunnel_port=$6, brand=$7
          WHERE id=$8`,
        [
          lanIp, Number(nvr.rtsp_port) || 554, path,
          nvr.rtsp_user || 'admin', nvr.rtsp_pass || '',
          port, brand, row.id,
        ]
      );
      enabled += 1;
    } else {
      const port = sharedTunnel ? tunnelPort : await allocateTunnelPort(nvr.station_id);
      await pool.query(
        `INSERT INTO cameras (station_id, nvr_area_id, name, brand, lan_ip, rtsp_port, rtsp_path, rtsp_user, rtsp_pass, tunnel_port, stream_token, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
        [
          nvr.station_id, nvr.id, `Ch${ch}`, brand, lanIp,
          Number(nvr.rtsp_port) || 554, path,
          nvr.rtsp_user || 'admin', nvr.rtsp_pass || '',
          port, generateToken(),
        ]
      );
      created += 1;
      enabled += 1;
    }
  }

  // Disable channels beyond want (e.g. 31–32) on this NVR
  await pool.query(
    `UPDATE cameras SET enabled=false
      WHERE nvr_area_id=$1
        AND COALESCE(NULLIF(substring(rtsp_path from 'channel=([0-9]+)'), '')::int, 0) > $2`,
    [nvr.id, want]
  );
  await pool.query(`UPDATE nvr_areas SET channels=$1 WHERE id=$2`, [want, nvr.id]);
  await sync('admin', `nvr restore ${nvr.name} ${want}ch`);

  const host = String(nvr.vpn_ip || '').replace(/\/\d+$/, '');
  let push = { ok: false, skipped: true };
  if (nvr.api_password && host) {
    try {
      await probeMikrotik({
        mikrotik_host: host,
        api_user: nvr.api_user || 'admin',
        api_password: nvr.api_password,
      });
      const { rows: cams } = await pool.query(
        `SELECT DISTINCT ON (tunnel_port) id, name, lan_ip, rtsp_port, tunnel_port
           FROM cameras WHERE nvr_area_id=$1 AND enabled ORDER BY tunnel_port, id`,
        [nvr.id]
      );
      push = await pushCameraNat(
        {
          mikrotik_host: host,
          api_user: nvr.api_user || 'admin',
          api_password: nvr.api_password,
        },
        cams.map((c) => ({
          name: c.name,
          tunnelPort: c.tunnel_port,
          lanIp: c.lan_ip,
          rtspPort: c.rtsp_port,
        }))
      );
      push.skipped = false;
    } catch (e) {
      push = { ok: false, skipped: false, error: e.message || 'MikroTik push failed' };
    }
  }

  await audit(req.user?.sub || 'admin', 'nvr.restore', {
    id: nvr.id, channels: want, created, enabled, pushOk: push.ok,
  });
  res.json({
    ok: true,
    nvrId: nvr.id,
    channels: want,
    created,
    enabled,
    tunnelPort: sharedTunnel ? tunnelPort : undefined,
    push,
  });
});

/**
 * POST /api/nvrs/:id/push — push camera NAT rules to MikroTik over VPN REST.
 * Optional body: { seedChannels?: number } — create Dahua channel cameras 1..N if none.
 */
r.post('/:id/push', async (req, res) => {
  const nvr = await loadNvrRow(req.params.id);
  if (!nvr) return res.status(404).json({ error: 'not found' });
  if (!nvr.api_password) {
    return res.status(400).json({
      ok: false,
      error: 'Walang MikroTik API password — Edit API sa MikroTik Sites',
    });
  }
  const host = String(nvr.vpn_ip || '').replace(/\/\d+$/, '');
  if (!host) return res.status(400).json({ error: 'station has no VPN IP' });

  const seedN = Number(req.body?.seedChannels ?? req.body?.seed_channels ?? 0);
  const lanIp = String(nvr.lan_ip || '').trim();
  if (seedN > 0 && lanIp) {
    const { rows: existing } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cameras WHERE nvr_area_id = $1`,
      [nvr.id]
    );
    if (Number(existing[0]?.n || 0) === 0) {
      const brand = String(nvr.brand || 'dahua').toLowerCase();
      for (let ch = 1; ch <= Math.min(seedN, 32); ch++) {
        const tunnelPort = await allocateTunnelPort(nvr.station_id);
        const path = brand === 'hikvision'
          ? `/Streaming/Channels/${ch}01`
          : `/cam/realmonitor?channel=${ch}&subtype=0`;
        await pool.query(
          `INSERT INTO cameras (station_id, nvr_area_id, name, brand, lan_ip, rtsp_port, rtsp_path, rtsp_user, rtsp_pass, tunnel_port, stream_token, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
          [
            nvr.station_id, nvr.id, `Ch${ch}`, brand, lanIp,
            Number(nvr.rtsp_port) || 554, path,
            nvr.rtsp_user || 'admin', nvr.rtsp_pass || '',
            tunnelPort, generateToken(),
          ]
        );
      }
      await sync('admin', `nvr seed channels ${nvr.name}`);
    }
  }

  const { rows: cams } = await pool.query(
    `SELECT id, name, lan_ip, rtsp_port, tunnel_port FROM cameras
      WHERE nvr_area_id = $1 AND enabled ORDER BY id`,
    [nvr.id]
  );
  if (!cams.length) {
    return res.status(400).json({
      ok: false,
      error: 'Walang camera sa NVR — mag-Add Camera muna (o seedChannels), o i-set ang NVR LAN IP',
    });
  }

  try {
    await probeMikrotik({
      mikrotik_host: host,
      api_user: nvr.api_user || 'admin',
      api_password: nvr.api_password,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      online: false,
      host,
      error: e.message || 'MikroTik unreachable — i-check ang SSTP VPN (VPN DOWN)',
    });
  }

  const push = await pushCameraNat(
    {
      mikrotik_host: host,
      api_user: nvr.api_user || 'admin',
      api_password: nvr.api_password,
    },
    cams.map((c) => ({
      name: c.name,
      tunnelPort: c.tunnel_port,
      lanIp: c.lan_ip,
      rtspPort: c.rtsp_port,
    }))
  );
  await audit(req.user?.sub || 'admin', 'nvr.push', {
    id: nvr.id, ok: push.ok, cameras: cams.length, errors: push.errors,
  });
  res.json({
    ok: push.ok,
    online: true,
    host,
    cameras: cams.length,
    ...push,
  });
});

r.delete('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM nvr_areas WHERE id = $1 RETURNING id, name, station_id`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await audit(req.user?.sub || 'admin', 'nvr.delete', { id: rows[0].id, name: rows[0].name });
  res.json({ ok: true });
});

export default r;
