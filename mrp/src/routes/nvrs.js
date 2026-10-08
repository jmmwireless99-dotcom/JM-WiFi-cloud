import { Router } from 'express';
import { pool, audit } from '../db.js';
import { requireAdmin } from '../auth.js';
import { coordsFromRow, parseLatLngPair } from '../geoCoords.js';

const r = Router();
r.use(requireAdmin);

function toView(row) {
  const { lat, lng } = coordsFromRow(row);
  return {
    id: row.id,
    stationId: row.station_id,
    stationName: row.station_name || null,
    stationOnline: row.station_online ?? null,
    name: row.name,
    notes: row.notes || '',
    lat,
    lng,
    cameraCount: row.camera_count !== undefined ? Number(row.camera_count) : undefined,
    created: row.created_at,
  };
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
  res.json(rows.map(toView));
});

r.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT n.*, s.name AS station_name,
            (SELECT COUNT(*)::int FROM cameras c WHERE c.nvr_area_id = n.id) AS camera_count
       FROM nvr_areas n
       JOIN stations s ON s.id = n.station_id
      WHERE n.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(toView(rows[0]));
});

/** POST { stationId, name, notes?, lat?, lng? } */
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

  try {
    const { rows } = await pool.query(
      `INSERT INTO nvr_areas (station_id, name, notes, lat, lng)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [stationId, name, notes, lat, lng]
    );
    await audit(req.user?.sub || 'admin', 'nvr.create', { id: rows[0].id, stationId, name });
    res.status(201).json(toView({ ...rows[0], station_name: st[0].name, camera_count: 0 }));
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
    res.json(toView({ ...rows[0], station_name: st[0]?.name, camera_count: undefined }));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'NVR name already exists on this site' });
    throw e;
  }
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
