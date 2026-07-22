const { v4: uuid } = require('uuid');
const db = require('../db');
const { createPauseResumeSession, getResumableSession, resumeSession } = require('./session');

function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createVoucher(siteId, minutes, source = 'coin', deviceId = null, price = 0) {
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
  } while (
    db.prepare('SELECT id FROM vouchers WHERE code = ?').get(code) &&
    attempts < 10
  );

  const id = uuid();
  db.prepare(`
    INSERT INTO vouchers (id, site_id, code, minutes, price, source, device_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, siteId, code, minutes, price, source, deviceId);

  return { id, code, minutes, price };
}

function createVoucherBatch(siteId, count, minutes, source = 'batch', price = 0) {
  const vouchers = [];
  for (let i = 0; i < count; i++) {
    vouchers.push(createVoucher(siteId, minutes, source, null, price));
  }
  return vouchers;
}

function defaultProfileName(siteId) {
  const profile = db.prepare(`
    SELECT name FROM hotspot_profiles
    WHERE (site_id = ? OR site_id IS NULL) AND pause_on_disconnect = 1 AND active = 1
    ORDER BY CASE WHEN site_id = ? THEN 0 ELSE 1 END, created_at
    LIMIT 1
  `).get(siteId, siteId);
  return profile?.name || 'jmwifi-pause';
}

/**
 * Redeem voucher OR resume paused time for same code (random MAC OK).
 * No wall-clock validity — remaining time only.
 */
function redeemVoucher(code, macAddress, siteId, { ip } = {}) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized || !macAddress) {
    return { error: 'code and mac required' };
  }

  // Resume existing pause/resume session for this voucher
  const existing = getResumableSession(siteId, { code: normalized, mac: macAddress });
  if (existing) {
    const resumed = resumeSession(existing.id, { mac: macAddress, ip });
    if (resumed.error) return resumed;
    return {
      ...resumed,
      resumed: true,
      message: 'Auto-resume — remaining time continued (no validity expiry)'
    };
  }

  const voucher = db.prepare(`
    SELECT * FROM vouchers WHERE code = ? AND site_id = ? AND used = 0
  `).get(normalized, siteId);

  if (!voucher) return { error: 'Invalid or already used voucher' };

  db.prepare(`
    UPDATE vouchers SET used = 1, used_by_mac = ?, used_at = datetime('now')
    WHERE id = ?
  `).run(macAddress, voucher.id);

  const profileName = defaultProfileName(siteId);
  const session = createPauseResumeSession({
    siteId,
    mac: macAddress,
    ip,
    voucherId: voucher.id,
    minutes: voucher.minutes,
    password: normalized,
    profileName,
    allowRandomMac: 1
  });

  return {
    ...session,
    resumed: false,
    message: 'Connected — time pauses when you disconnect (no validity)'
  };
}

module.exports = { createVoucher, createVoucherBatch, redeemVoucher, generateCode };
