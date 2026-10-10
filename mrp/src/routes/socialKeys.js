/**
 * SOCIAL Park viewer keys — admin create/list/revoke + public key auth.
 * Scoped to SOCIAL station only. Plaintext key returned once on create.
 */
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, audit } from '../db.js';
import { requireAuth, requireSuperAdmin } from '../auth.js';

/** SOCIAL Park MikroTik site — keep in sync with soscialUpdate.js */
export const SOCIAL_STATION_ID = 71;

const r = Router();

const VIEWER_TOKEN_TTL = '12h';
const KEY_PREFIX = 'SPK';

function generatePlainKey() {
  const raw = crypto.randomBytes(12).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toUpperCase();
  const a = raw.slice(0, 4);
  const b = raw.slice(4, 8);
  const c = raw.slice(8, 12);
  const d = raw.slice(12, 16);
  return `${KEY_PREFIX}-${a}-${b}-${c}-${d}`;
}

function keyPrefix(plain) {
  return String(plain || '').slice(0, 8);
}

export function signSocialViewerToken({ keyId, label }) {
  return jwt.sign(
    {
      role: 'social_viewer',
      keyId: Number(keyId),
      stationId: SOCIAL_STATION_ID,
      label: label || '',
    },
    process.env.JWT_SECRET,
    { expiresIn: VIEWER_TOKEN_TTL }
  );
}

/** Look up active key by plaintext; returns row or null */
export async function findActiveKeyByPlain(plain) {
  const key = String(plain || '').trim();
  if (!key || key.length < 8) return null;
  const { rows } = await pool.query(
    `SELECT * FROM social_viewer_keys
      WHERE station_id = $1 AND revoked_at IS NULL
      ORDER BY id DESC`,
    [SOCIAL_STATION_ID]
  );
  for (const row of rows) {
    if (await bcrypt.compare(key, row.key_hash)) return row;
  }
  return null;
}

/** True if key id is still active (not revoked) */
export async function isKeyActive(keyId) {
  const id = Number(keyId);
  if (!id) return false;
  const { rows } = await pool.query(
    `SELECT id FROM social_viewer_keys
      WHERE id = $1 AND station_id = $2 AND revoked_at IS NULL`,
    [id, SOCIAL_STATION_ID]
  );
  return !!rows[0];
}

/**
 * Middleware: admin/staff JWT OR active social_viewer token.
 * Sets req.socialViewer / req.user accordingly.
 */
export async function requireSocialViewerOrAdmin(req, res, next) {
  const raw = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) {
    return res.status(401).json({ error: 'viewer key required', code: 'KEY_REQUIRED' });
  }
  try {
    const payload = jwt.verify(raw, process.env.JWT_SECRET);
    if (payload.role === 'admin' || payload.role === 'staff') {
      req.user = payload;
      return next();
    }
    if (payload.role === 'social_viewer') {
      const active = await isKeyActive(payload.keyId);
      if (!active) {
        return res.status(401).json({ error: 'key revoked', code: 'KEY_REVOKED' });
      }
      req.socialViewer = payload;
      req.user = payload;
      return next();
    }
    return res.status(403).json({ error: 'forbidden', code: 'FORBIDDEN' });
  } catch {
    return res.status(401).json({ error: 'invalid or expired token', code: 'TOKEN_INVALID' });
  }
}

function mapKeyRow(row, { includePlain } = {}) {
  const out = {
    id: row.id,
    stationId: row.station_id,
    label: row.label,
    notes: row.notes || '',
    keyPrefix: row.key_prefix,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    active: !row.revoked_at,
  };
  if (includePlain && row._plain) out.key = row._plain;
  return out;
}

/** POST /api/social/auth — public: exchange viewer key → short-lived token */
r.post('/auth', async (req, res) => {
  try {
    const plain = String(req.body?.key || req.body?.viewerKey || '').trim();
    if (!plain) return res.status(400).json({ error: 'key required' });
    const row = await findActiveKeyByPlain(plain);
    if (!row) {
      return res.status(401).json({ error: 'invalid or revoked key', code: 'KEY_INVALID' });
    }
    await pool.query(
      `UPDATE social_viewer_keys SET last_used_at = now() WHERE id = $1`,
      [row.id]
    );
    const token = signSocialViewerToken({ keyId: row.id, label: row.label });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      token,
      expiresIn: VIEWER_TOKEN_TTL,
      keyId: row.id,
      label: row.label,
      stationId: SOCIAL_STATION_ID,
      role: 'social_viewer',
    });
  } catch (e) {
    console.error('social auth:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/social/auth/me — validate current viewer token */
r.get('/auth/me', async (req, res) => {
  try {
    const raw = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!raw) return res.status(401).json({ ok: false, code: 'KEY_REQUIRED' });
    let payload;
    try {
      payload = jwt.verify(raw, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ ok: false, code: 'TOKEN_INVALID' });
    }
    if (payload.role === 'admin' || payload.role === 'staff') {
      return res.json({ ok: true, role: payload.role, stationId: SOCIAL_STATION_ID });
    }
    if (payload.role !== 'social_viewer') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN' });
    }
    const active = await isKeyActive(payload.keyId);
    if (!active) {
      return res.status(401).json({ ok: false, code: 'KEY_REVOKED', error: 'key revoked' });
    }
    res.json({
      ok: true,
      role: 'social_viewer',
      keyId: payload.keyId,
      label: payload.label || '',
      stationId: SOCIAL_STATION_ID,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Admin: create key */
r.post('/keys', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const label = String(req.body?.label || req.body?.name || '').trim() || 'Viewer';
    const notes = String(req.body?.notes || '').trim();
    const plain = generatePlainKey();
    const hash = await bcrypt.hash(plain, 10);
    const prefix = keyPrefix(plain);
    const { rows } = await pool.query(
      `INSERT INTO social_viewer_keys (station_id, label, notes, key_hash, key_prefix, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [SOCIAL_STATION_ID, label, notes, hash, prefix, req.user?.sub || 'admin']
    );
    const row = rows[0];
    row._plain = plain;
    await audit(req.user?.sub || 'admin', 'social_key_create', {
      keyId: row.id,
      label,
      stationId: SOCIAL_STATION_ID,
    });
    res.status(201).json({
      ok: true,
      key: mapKeyRow(row, { includePlain: true }),
      message: 'Copy this key now — plaintext is shown only once.',
    });
  } catch (e) {
    console.error('social key create:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Admin: list keys (active + revoked) */
r.get('/keys', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, station_id, label, notes, key_prefix, created_by, created_at, revoked_at, last_used_at
         FROM social_viewer_keys
        WHERE station_id = $1
        ORDER BY created_at DESC`,
      [SOCIAL_STATION_ID]
    );
    res.json({
      ok: true,
      stationId: SOCIAL_STATION_ID,
      keys: rows.map((row) => mapKeyRow(row)),
      count: rows.length,
      activeCount: rows.filter((x) => !x.revoked_at).length,
    });
  } catch (e) {
    console.error('social key list:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Admin: revoke/delete key — devices with this key lose access */
r.delete('/keys/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const hard = String(req.query.hard || req.body?.hard || '') === '1'
      || req.body?.hard === true;
    if (hard) {
      const { rowCount } = await pool.query(
        `DELETE FROM social_viewer_keys WHERE id = $1 AND station_id = $2`,
        [id, SOCIAL_STATION_ID]
      );
      if (!rowCount) return res.status(404).json({ error: 'not found' });
      await audit(req.user?.sub || 'admin', 'social_key_delete', { keyId: id });
      return res.json({ ok: true, deleted: true, id });
    }
    const { rows } = await pool.query(
      `UPDATE social_viewer_keys
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1 AND station_id = $2
        RETURNING *`,
      [id, SOCIAL_STATION_ID]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    await audit(req.user?.sub || 'admin', 'social_key_revoke', { keyId: id });
    res.json({ ok: true, revoked: true, key: mapKeyRow(rows[0]) });
  } catch (e) {
    console.error('social key revoke:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default r;
