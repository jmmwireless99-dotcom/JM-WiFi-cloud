import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, audit } from '../db.js';
import { requireAdmin, requireSuperAdmin } from '../auth.js';

const r = Router();
// List: portal managers. Create/edit/delete: Super Admin only.
r.use(requireAdmin);

async function loadClient(id) {
  const { rows } = await pool.query(
    `SELECT c.*,
            COALESCE(array_agg(a.barangay_id ORDER BY a.barangay_id)
              FILTER (WHERE a.barangay_id IS NOT NULL), '{}') AS barangay_ids
       FROM client_accounts c
       LEFT JOIN client_barangay_access a ON a.client_id = c.id
      WHERE c.id = $1
      GROUP BY c.id`,
    [id]
  );
  return rows[0] || null;
}

function toView(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: row.is_active,
    barangayIds: (row.barangay_ids || []).map(Number),
    created: row.created_at,
  };
}

async function setBarangayAccess(clientId, barangayIds) {
  await pool.query('DELETE FROM client_barangay_access WHERE client_id = $1', [clientId]);
  for (const barangayId of barangayIds) {
    await pool.query(
      'INSERT INTO client_barangay_access (client_id, barangay_id) VALUES ($1,$2)',
      [clientId, barangayId]
    );
  }
}

r.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*,
            COALESCE(array_agg(a.barangay_id ORDER BY a.barangay_id)
              FILTER (WHERE a.barangay_id IS NOT NULL), '{}') AS barangay_ids
       FROM client_accounts c
       LEFT JOIN client_barangay_access a ON a.client_id = c.id
      GROUP BY c.id
      ORDER BY c.username`
  );
  res.json(rows.map(toView));
});

r.post('/', requireSuperAdmin, async (req, res) => {
  const { username, password, displayName = '', barangayIds = [] } = req.body || {};
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(u))
    return res.status(400).json({ error: 'username: 3-32 chars, letters/numbers/dot/dash' });
  if (!password || String(password).length < 8)
    return res.status(400).json({ error: 'password: minimum 8 characters' });
  const ids = [...new Set((barangayIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'piliin ang kahit isang barangay' });

  const taken = await pool.query(
    'SELECT 1 FROM staff_accounts WHERE username=$1 UNION SELECT 1 FROM client_accounts WHERE username=$1',
    [u]
  );
  if (taken.rowCount) return res.status(409).json({ error: 'username already exists' });

  const hash = await bcrypt.hash(String(password), 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO client_accounts (username, password_hash, display_name)
       VALUES ($1,$2,$3) RETURNING *`,
      [u, hash, String(displayName || '').trim()]
    );
    await setBarangayAccess(rows[0].id, ids);
    const client = await loadClient(rows[0].id);
    await audit('admin', 'client.create', { username: u, barangayIds: ids });
    res.status(201).json(toView(client));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'username already exists' });
    if (e.code === '23503') return res.status(400).json({ error: 'invalid barangay id' });
    throw e;
  }
});

r.patch('/:id', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const client = await loadClient(id);
  if (!client) return res.status(404).json({ error: 'not found' });

  const sets = [];
  const vals = [];
  if (body.displayName !== undefined) {
    vals.push(String(body.displayName).trim());
    sets.push(`display_name = $${vals.length}`);
  }
  if (body.isActive !== undefined) {
    vals.push(!!body.isActive);
    sets.push(`is_active = $${vals.length}`);
  }
  if (body.password) {
    if (String(body.password).length < 8)
      return res.status(400).json({ error: 'password: minimum 8 characters' });
    vals.push(await bcrypt.hash(String(body.password), 10));
    sets.push(`password_hash = $${vals.length}`);
  }
  if (sets.length) {
    vals.push(id);
    await pool.query(`UPDATE client_accounts SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  }
  if (body.barangayIds !== undefined) {
    const ids = [...new Set((body.barangayIds || []).map(Number).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'piliin ang kahit isang barangay' });
    await setBarangayAccess(id, ids);
  }

  const updated = await loadClient(id);
  await audit('admin', 'client.update', { id, username: updated.username });
  res.json(toView(updated));
});

r.delete('/:id', requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM client_accounts WHERE id=$1 RETURNING username',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await audit('admin', 'client.delete', { username: rows[0].username });
  res.json({ ok: true });
});

export default r;
