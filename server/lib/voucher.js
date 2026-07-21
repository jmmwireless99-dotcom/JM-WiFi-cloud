const { v4: uuid } = require('uuid');
const db = require('../db');

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

function redeemVoucher(code, macAddress, siteId) {
  const voucher = db.prepare(`
    SELECT * FROM vouchers WHERE code = ? AND site_id = ? AND used = 0
  `).get(code.toUpperCase(), siteId);

  if (!voucher) return { error: 'Invalid or already used voucher' };

  const expiresAt = new Date(Date.now() + voucher.minutes * 60 * 1000).toISOString();

  db.prepare(`
    UPDATE vouchers SET used = 1, used_by_mac = ?, used_at = datetime('now')
    WHERE id = ?
  `).run(macAddress, voucher.id);

  const sessionId = uuid();
  const username = `jm_${macAddress.replace(/:/g, '').toLowerCase()}`;

  db.prepare(`
    INSERT INTO sessions (id, site_id, mac_address, username, voucher_id, minutes_granted, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, siteId, macAddress, username, voucher.id, voucher.minutes, expiresAt);

  return {
    success: true,
    username,
    password: code.toUpperCase(),
    minutes: voucher.minutes,
    expiresAt,
    sessionId
  };
}

module.exports = { createVoucher, createVoucherBatch, redeemVoucher, generateCode };
