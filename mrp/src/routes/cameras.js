import { Router } from 'express';
import { pool, audit } from '../db.js';
import { allocateTunnelPort, generateToken } from '../services/allocator.js';
import { sync, getStreamStates, streamPathName, startPlaybackPath } from '../services/provisioner.js';
import { clientBarangayIds, hasBarangayAccess, requireAdmin, requirePlayback } from '../auth.js';
import { hlsBase } from '../config.js';
import { coordsFromRow, parseLatLngPair } from '../geoCoords.js';

const r = Router();
const HLS = hlsBase;

/** LEFT JOIN so NVR cameras without barangay still list for staff */
const GEO_JOIN = `
  LEFT JOIN barangays b ON b.id = c.barangay_id
  LEFT JOIN municipalities m ON m.id = b.municipality_id
  LEFT JOIN cities ci ON ci.id = m.city_id
  LEFT JOIN provinces p ON p.id = ci.province_id
  JOIN stations s ON s.id = c.station_id
  LEFT JOIN nvr_areas n ON n.id = c.nvr_area_id`;

function mapCamera(c, streams, { includeSecrets = false } = {}) {
  const { lat, lng } = coordsFromRow(c);
  const stationCoords = coordsFromRow({ lat: c.station_lat, lng: c.station_lng });
  const nvrCoords = coordsFromRow({ lat: c.nvr_lat, lng: c.nvr_lng });
  const view = {
    id: c.id, stationId: c.station_id, name: c.name,
    brand: c.brand || 'dahua',
    lanIp: c.lan_ip, rtspPort: c.rtsp_port, rtspPath: c.rtsp_path,
    rtspUser: c.rtsp_user || '', tunnelPort: c.tunnel_port, enabled: c.enabled,
    hlsUrl: `${HLS()}/${streamPathName(c)}/index.m3u8`,
    stream: streams[streamPathName(c)] || null,
    live: !!(c.enabled && c.station_status === 'active' && streams[streamPathName(c)]?.ready),
    station: c.station_name, stationStatus: c.station_status,
    nvrAreaId: c.nvr_area_id || null,
    nvrName: c.nvr_name || null,
    barangayId: c.barangay_id, barangay: c.barangay_name,
    municipalityId: c.municipality_id, municipality: c.municipality_name,
    cityId: c.city_id, city: c.city_name,
    provinceId: c.province_id, province: c.province_name,
    lat: lat ?? nvrCoords.lat ?? stationCoords.lat,
    lng: lng ?? nvrCoords.lng ?? stationCoords.lng,
    latOwn: lat,
    lngOwn: lng,
  };
  if (includeSecrets) view.rtspPass = c.rtsp_pass || '';
  return view;
}

function selectSql(whereSql = '', params = []) {
  return {
    text: `SELECT c.*, s.name AS station_name, s.status AS station_status,
            s.vpn_ip AS vpn_ip, s.lat AS station_lat, s.lng AS station_lng,
            n.name AS nvr_name, n.lat AS nvr_lat, n.lng AS nvr_lng,
            b.name AS barangay_name, b.municipality_id,
            m.name AS municipality_name, m.city_id,
            ci.name AS city_name, ci.province_id,
            p.name AS province_name
       FROM cameras c
       ${GEO_JOIN}
       ${whereSql}
      ORDER BY s.name, COALESCE(n.name, ''), c.name, c.id`,
    params,
  };
}

function routerosRule(cam) {
  return `/ip firewall nat add chain=dstnat in-interface=sstp-cctv protocol=tcp dst-port=${cam.tunnel_port} ` +
    `action=dst-nat to-addresses=${cam.lan_ip} to-ports=${cam.rtsp_port} comment="JM TECH SOLUTION: ${cam.name}"`;
}

r.get('/', async (req, res) => {
  const params = [];
  const where = [];
  const allowed = clientBarangayIds(req);
  if (allowed !== null) {
    if (!allowed.length) return res.json([]);
    params.push(allowed);
    where.push(`c.barangay_id = ANY($${params.length})`);
  }
  if (req.query.barangay_id) {
    const brgyId = Number(req.query.barangay_id);
    if (!hasBarangayAccess(req, brgyId)) return res.status(403).json({ error: 'access denied' });
    params.push(brgyId);
    where.push(`c.barangay_id = $${params.length}`);
  }
  if (req.query.station_id) {
    params.push(Number(req.query.station_id));
    where.push(`c.station_id = $${params.length}`);
  }
  if (req.query.nvr_area_id) {
    params.push(Number(req.query.nvr_area_id));
    where.push(`c.nvr_area_id = $${params.length}`);
  }
  const q = selectSql(where.length ? 'WHERE ' + where.join(' AND ') : '', params);
  const { rows } = await pool.query(q.text, q.params);
  const streams = await getStreamStates();
  res.json(rows.map(c => mapCamera(c, streams)));
});

r.get('/:id', async (req, res) => {
  const q = selectSql('WHERE c.id = $1', [req.params.id]);
  const { rows } = await pool.query(q.text, q.params);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'not found' });
  if (c.barangay_id && !hasBarangayAccess(req, c.barangay_id)) {
    return res.status(403).json({ error: 'access denied' });
  }
  const streams = await getStreamStates();
  const includeSecrets = req.user?.role === 'admin' || req.user?.role === 'staff';
  res.json({
    ...mapCamera(c, streams, { includeSecrets }),
    routerosRule: includeSecrets ? routerosRule(c) : undefined,
  });
});

// POST /api/cameras { nvrAreaId?, stationId?, barangayId?, name, lanIp, ... }
r.post('/', requireAdmin, async (req, res) => {
  const {
    barangayId, stationId, nvrAreaId,
    name,
    brand = 'dahua',
  } = req.body || {};
  let {
    lanIp, rtspPort = 554,
    rtspPath = '/cam/realmonitor?channel=1&subtype=0', rtspUser = '', rtspPass = '',
  } = req.body || {};

  let resolvedStationId = stationId ? Number(stationId) : null;
  let resolvedNvrId = nvrAreaId ? Number(nvrAreaId) : null;
  let resolvedBrgy = barangayId ? Number(barangayId) : null;

  let nvrRow = null;
  if (resolvedNvrId) {
    const { rows: nvr } = await pool.query(`SELECT * FROM nvr_areas WHERE id = $1`, [resolvedNvrId]);
    if (!nvr[0]) return res.status(400).json({ error: 'NVR area not found' });
    if (resolvedStationId && resolvedStationId !== nvr[0].station_id) {
      return res.status(400).json({ error: 'stationId does not match NVR MikroTik site' });
    }
    resolvedStationId = nvr[0].station_id;
    nvrRow = nvr[0];
    if (!lanIp) lanIp = nvrRow.lan_ip || '';
    if (!rtspUser) rtspUser = nvrRow.rtsp_user || 'admin';
    if (!rtspPass) rtspPass = nvrRow.rtsp_pass || '';
    if (!req.body?.rtspPort && nvrRow.rtsp_port) rtspPort = nvrRow.rtsp_port;
  }

  if (!name?.trim() || !lanIp) {
    return res.status(400).json({ error: 'name and lanIp required (o i-set ang NVR LAN IP)' });
  }

  if (!resolvedStationId) {
    return res.status(400).json({ error: 'nvrAreaId or stationId required' });
  }
  if (!resolvedNvrId && !resolvedBrgy) {
    return res.status(400).json({ error: 'nvrAreaId required (or barangayId for legacy)' });
  }

  const { rows: st } = await pool.query(`SELECT id FROM stations WHERE id = $1`, [resolvedStationId]);
  if (!st[0]) return res.status(400).json({ error: 'MikroTik site not found' });

  const brandNorm = String(brand || nvrRow?.brand || 'dahua').toLowerCase();
  const allowedBrand = ['dahua', 'hikvision', 'v380', 'other'].includes(brandNorm) ? brandNorm : 'other';
  let lat = null;
  let lng = null;
  try {
    const coords = parseLatLngPair(req.body || {});
    if (coords) { lat = coords.lat; lng = coords.lng; }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const tunnelPort = await allocateTunnelPort(resolvedStationId);
  const { rows } = await pool.query(
    `INSERT INTO cameras (barangay_id, station_id, nvr_area_id, name, brand, lan_ip, rtsp_port, rtsp_path, rtsp_user, rtsp_pass, tunnel_port, stream_token, lat, lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      resolvedBrgy, resolvedStationId, resolvedNvrId, name.trim(), allowedBrand, lanIp,
      Number(rtspPort), rtspPath, rtspUser, rtspPass, tunnelPort, generateToken(), lat, lng,
    ]
  );
  await sync('admin', `camera add ${name}`);
  await audit('admin', 'camera.create', {
    barangayId: resolvedBrgy, stationId: resolvedStationId, nvrAreaId: resolvedNvrId,
    name, lanIp, tunnelPort, brand: allowedBrand,
  });
  res.status(201).json({
    id: rows[0].id, tunnelPort, brand: allowedBrand,
    stationId: resolvedStationId, nvrAreaId: resolvedNvrId,
    lat, lng,
    hlsUrl: `${HLS()}/${streamPathName(rows[0])}/index.m3u8`,
    routerosRule: routerosRule(rows[0]),
  });
});

r.patch('/:id', requireAdmin, async (req, res) => {
  const allowed = ['name', 'brand', 'lan_ip', 'rtsp_port', 'rtsp_path', 'rtsp_user', 'rtsp_pass', 'enabled', 'nvr_area_id', 'barangay_id'];
  const body = req.body || {};
  const map = {
    name: 'name', brand: 'brand', lanIp: 'lan_ip', rtspPort: 'rtsp_port', rtspPath: 'rtsp_path',
    rtspUser: 'rtsp_user', rtspPass: 'rtsp_pass', enabled: 'enabled',
    nvrAreaId: 'nvr_area_id', barangayId: 'barangay_id',
  };
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(map)) {
    if (body[k] !== undefined && allowed.includes(col)) {
      let v = body[k];
      if (col === 'brand') {
        v = String(v || 'dahua').toLowerCase();
        if (!['dahua', 'hikvision', 'v380', 'other'].includes(v)) v = 'other';
      }
      if (col === 'nvr_area_id' || col === 'barangay_id') {
        v = v === null || v === '' ? null : Number(v);
      }
      vals.push(v); sets.push(`${col} = $${vals.length}`);
    }
  }
  try {
    const coords = parseLatLngPair(body);
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
    `UPDATE cameras SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await sync('admin', `camera update ${rows[0].name}`);
  res.json({ ok: true, routerosRule: routerosRule(rows[0]) });
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('DELETE FROM cameras WHERE id=$1 RETURNING name', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await sync('admin', `camera delete ${rows[0].name}`);
  await audit('admin', 'camera.delete', { id: req.params.id, name: rows[0].name });
  res.json({ ok: true });
});

/**
 * POST /api/cameras/:id/playback { start, end }
 * start/end: ISO datetime strings (local or Z). Opens temporary HLS for Dahua playback RTSP.
 * Super Admin only — staff / viewers get live HLS only.
 */
r.post('/:id/playback', requirePlayback, async (req, res) => {
  try {
    const q = selectSql('WHERE c.id = $1', [req.params.id]);
    const { rows } = await pool.query(q.text, q.params);
    const c = rows[0];
    if (!c) return res.status(404).json({ error: 'not found' });
    if (c.barangay_id && !hasBarangayAccess(req, c.barangay_id)) {
      return res.status(403).json({ error: 'access denied' });
    }
    const start = req.body?.start ? new Date(req.body.start) : null;
    const end = req.body?.end ? new Date(req.body.end) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: 'start and end datetime required' });
    }
    if (end <= start) return res.status(400).json({ error: 'end must be after start' });
    if ((end - start) > 6 * 3600 * 1000) {
      return res.status(400).json({ error: 'max playback window is 6 hours' });
    }
    if (!c.vpn_ip) return res.status(400).json({ error: 'camera station has no VPN IP' });
    const { pathName, start: s, end: e } = await startPlaybackPath(c, c.vpn_ip, start, end);
    res.json({
      ok: true,
      mode: 'playback',
      start: s,
      end: e,
      hlsUrl: `${HLS()}/${pathName}/index.m3u8`,
      note: 'Kailangan may recording sa camera SD o NVR. Kung walang file, mag-fail ang stream.',
    });
  } catch (err) {
    console.error('playback:', err.message);
    res.status(500).json({ error: err.message || 'playback failed' });
  }
});

export default r;
