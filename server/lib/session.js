/**
 * Pause/resume session engine for JM WiFi Cloud Hotspot.
 * Time only counts while the client is connected — no wall-clock validity.
 * Supports random MAC: client re-authenticates with voucher code / username.
 */
const { v4: uuid } = require('uuid');
const db = require('../db');

function nowIso() {
  return new Date().toISOString();
}

function secondsBetween(fromIso, toIso = nowIso()) {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 1000));
}

/** Burn elapsed time for an active session; returns updated remaining_seconds. */
function syncRemaining(session) {
  if (!session || session.status !== 'active') {
    return session ? Number(session.remaining_seconds || 0) : 0;
  }
  const anchor = session.last_active_at || session.started_at || session.resumed_at;
  if (!anchor) return Number(session.remaining_seconds || 0);

  const elapsed = secondsBetween(anchor);
  const remaining = Math.max(0, Number(session.remaining_seconds || 0) - elapsed);

  db.prepare(`
    UPDATE sessions
    SET remaining_seconds = ?,
        last_active_at = ?,
        status = CASE WHEN ? <= 0 THEN 'exhausted' ELSE status END,
        expires_at = NULL
    WHERE id = ?
  `).run(remaining, nowIso(), remaining, session.id);

  return remaining;
}

function getSessionById(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function getResumableSession(siteId, { code, username, mac } = {}) {
  if (code) {
    const voucher = db.prepare(
      'SELECT * FROM vouchers WHERE code = ? AND site_id = ?'
    ).get(String(code).toUpperCase(), siteId);
    if (voucher) {
      const byVoucher = db.prepare(`
        SELECT * FROM sessions
        WHERE site_id = ? AND voucher_id = ? AND status IN ('active','paused')
        ORDER BY started_at DESC LIMIT 1
      `).get(siteId, voucher.id);
      if (byVoucher) return byVoucher;
    }
  }

  if (username) {
    const byUser = db.prepare(`
      SELECT * FROM sessions
      WHERE site_id = ? AND username = ? AND status IN ('active','paused')
      ORDER BY started_at DESC LIMIT 1
    `).get(siteId, username);
    if (byUser) return byUser;
  }

  if (mac) {
    return db.prepare(`
      SELECT * FROM sessions
      WHERE site_id = ? AND mac_address = ? AND status IN ('active','paused')
      ORDER BY started_at DESC LIMIT 1
    `).get(siteId, mac);
  }

  return null;
}

function createPauseResumeSession({
  siteId,
  mac,
  ip,
  voucherId,
  minutes,
  password,
  profileName = 'jmwifi-pause',
  allowRandomMac = 1
}) {
  const id = uuid();
  const username = `jm_${String(mac || id).replace(/:/g, '').toLowerCase().slice(0, 16)}`;
  const remaining = Math.max(60, Number(minutes) * 60);
  const ts = nowIso();

  db.prepare(`
    INSERT INTO sessions (
      id, site_id, mac_address, ip_address, username, voucher_id,
      minutes_granted, remaining_seconds, started_at, last_active_at, resumed_at,
      expires_at, status, pause_mode, allow_random_mac, profile_name, auth_password
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', 1, ?, ?, ?)
  `).run(
    id, siteId, mac || '', ip || null, username, voucherId || null,
    minutes, remaining, ts, ts, ts,
    allowRandomMac ? 1 : 0, profileName, password || null
  );

  return {
    success: true,
    sessionId: id,
    username,
    password: password || username,
    minutes,
    remaining_seconds: remaining,
    remaining_minutes: Math.ceil(remaining / 60),
    status: 'active',
    pause_mode: true,
    allow_random_mac: Boolean(allowRandomMac),
    profile_name: profileName,
    expiresAt: null,
    validity: 'none'
  };
}

function pauseSession(sessionId, reason = 'disconnect') {
  const session = getSessionById(sessionId);
  if (!session) return { error: 'Session not found' };
  if (session.status === 'exhausted') return { error: 'Time already exhausted', session };
  if (session.status === 'paused') {
    return {
      success: true,
      already: true,
      remaining_seconds: Number(session.remaining_seconds || 0),
      remaining_minutes: Math.ceil(Number(session.remaining_seconds || 0) / 60),
      status: 'paused'
    };
  }

  const remaining = syncRemaining(session);
  if (remaining <= 0) {
    db.prepare("UPDATE sessions SET status = 'exhausted', paused_at = ? WHERE id = ?")
      .run(nowIso(), sessionId);
    return { error: 'Time exhausted', remaining_seconds: 0, status: 'exhausted' };
  }

  db.prepare(`
    UPDATE sessions
    SET status = 'paused',
        remaining_seconds = ?,
        paused_at = ?,
        pause_reason = ?,
        last_active_at = ?
    WHERE id = ?
  `).run(remaining, nowIso(), reason, nowIso(), sessionId);

  return {
    success: true,
    remaining_seconds: remaining,
    remaining_minutes: Math.ceil(remaining / 60),
    status: 'paused',
    validity: 'none'
  };
}

function resumeSession(sessionId, { mac, ip } = {}) {
  const session = getSessionById(sessionId);
  if (!session) return { error: 'Session not found' };
  if (session.status === 'exhausted') return { error: 'Time exhausted' };

  let remaining = Number(session.remaining_seconds || 0);
  if (session.status === 'active') {
    remaining = syncRemaining(session);
  }

  if (remaining <= 0) {
    db.prepare("UPDATE sessions SET status = 'exhausted' WHERE id = ?").run(sessionId);
    return { error: 'Time exhausted', remaining_seconds: 0 };
  }

  const macChanged = mac && session.mac_address &&
    mac.toLowerCase() !== String(session.mac_address).toLowerCase();

  if (macChanged && !session.allow_random_mac) {
    return { error: 'MAC mismatch — random MAC not allowed for this session' };
  }

  const ts = nowIso();
  db.prepare(`
    UPDATE sessions
    SET status = 'active',
        remaining_seconds = ?,
        mac_address = COALESCE(?, mac_address),
        ip_address = COALESCE(?, ip_address),
        resumed_at = ?,
        last_active_at = ?,
        paused_at = NULL,
        pause_reason = NULL
    WHERE id = ?
  `).run(remaining, mac || null, ip || null, ts, ts, sessionId);

  const updated = getSessionById(sessionId);
  return {
    success: true,
    sessionId: updated.id,
    username: updated.username,
    password: updated.auth_password || updated.username,
    minutes: Math.ceil(remaining / 60),
    remaining_seconds: remaining,
    remaining_minutes: Math.ceil(remaining / 60),
    status: 'active',
    pause_mode: true,
    mac_address: updated.mac_address,
    random_mac: Boolean(macChanged),
    profile_name: updated.profile_name || 'jmwifi-pause',
    expiresAt: null,
    validity: 'none'
  };
}

function keepalive(sessionId, { mac, ip } = {}) {
  const session = getSessionById(sessionId);
  if (!session) return { error: 'Session not found' };

  if (session.status === 'paused') {
    return resumeSession(sessionId, { mac, ip });
  }
  if (session.status !== 'active') {
    return { error: `Session is ${session.status}` };
  }

  const remaining = syncRemaining(session);
  if (remaining <= 0) {
    return { error: 'Time exhausted', remaining_seconds: 0, status: 'exhausted' };
  }

  if (mac && session.allow_random_mac) {
    db.prepare('UPDATE sessions SET mac_address = ?, ip_address = COALESCE(?, ip_address) WHERE id = ?')
      .run(mac, ip || null, sessionId);
  }

  return {
    ok: true,
    remaining_seconds: remaining,
    remaining_minutes: Math.ceil(remaining / 60),
    status: 'active',
    validity: 'none'
  };
}

module.exports = {
  syncRemaining,
  getSessionById,
  getResumableSession,
  createPauseResumeSession,
  pauseSession,
  resumeSession,
  keepalive,
  secondsBetween
};
