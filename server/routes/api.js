const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { createVoucher, redeemVoucher } = require('../lib/voucher');
const { createHotspotUser } = require('../lib/mikrotik');

const router = express.Router();

function authDevice(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const site = db.prepare('SELECT * FROM sites WHERE api_key = ?').get(apiKey);
  if (!site) return res.status(401).json({ error: 'Invalid API key' });

  req.site = site;
  next();
}

// ─── Site / Device Registration ───────────────────────────────

router.post('/register-device', authDevice, (req, res) => {
  const { device_type, mac_address, name } = req.body;
  if (!device_type || !['esp8266', 'mikrotik'].includes(device_type)) {
    return res.status(400).json({ error: 'device_type must be esp8266 or mikrotik' });
  }

  const existing = db.prepare(
    'SELECT * FROM devices WHERE site_id = ? AND mac_address = ?'
  ).get(req.site.id, mac_address);

  if (existing) {
    db.prepare(
      "UPDATE devices SET last_seen = datetime('now'), status = 'online', name = COALESCE(?, name) WHERE id = ?"
    ).run(name, existing.id);
    return res.json({ device: existing, registered: false });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO devices (id, site_id, device_type, mac_address, name, last_seen, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 'online')
  `).run(id, req.site.id, device_type, mac_address, name || `${device_type}-${mac_address}`);

  res.json({
    registered: true,
    device: { id, site_id: req.site.id, device_type, mac_address, name }
  });
});

router.post('/heartbeat', authDevice, (req, res) => {
  const { device_id, mac_address } = req.body;
  const device = db.prepare(
    'SELECT * FROM devices WHERE id = ? AND site_id = ?'
  ).get(device_id, req.site.id);

  if (!device) return res.status(404).json({ error: 'Device not found' });

  db.prepare(
    "UPDATE devices SET last_seen = datetime('now'), status = 'online' WHERE id = ?"
  ).run(device_id);

  const site = req.site;
  res.json({
    ok: true,
    config: {
      minutes_per_coin: site.minutes_per_coin,
      rate_per_hour: site.rate_per_hour,
      hotspot_profile: site.hotspot_profile
    }
  });
});

// ─── Coin Insert (ESP8266) ────────────────────────────────────

router.post('/coin-insert', authDevice, (req, res) => {
  const { device_id, coins = 1 } = req.body;
  const site = req.site;
  const minutes = site.minutes_per_coin * coins;

  const voucher = createVoucher(site.id, minutes, 'coin', device_id || null);

  const validDevice = device_id
    ? db.prepare('SELECT id FROM devices WHERE id = ? AND site_id = ?').get(device_id, site.id)
    : null;

  db.prepare(`
    INSERT INTO coin_logs (site_id, device_id, coins, minutes_granted, voucher_code)
    VALUES (?, ?, ?, ?, ?)
  `).run(site.id, validDevice ? device_id : null, coins, minutes, voucher.code);

  res.json({
    success: true,
    voucher_code: voucher.code,
    minutes,
    message: `Inserted ${coins} coin(s) = ${minutes} minutes. Code: ${voucher.code}`
  });
});

// ─── Voucher Redeem (Portal / Client) ─────────────────────────

router.post('/redeem', async (req, res) => {
  const { code, mac, site_id } = req.body;
  if (!code || !mac) {
    return res.status(400).json({ error: 'code and mac required' });
  }

  let siteId = site_id;
  if (!siteId) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const site = db.prepare('SELECT id FROM sites WHERE api_key = ?').get(apiKey);
      siteId = site?.id;
    }
  }
  if (!siteId) return res.status(400).json({ error: 'site_id required' });

  const result = redeemVoucher(code, mac, siteId);
  if (result.error) return res.status(400).json(result);

  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
  if (site) {
    const mtResult = await createHotspotUser(
      site, mac, result.username, result.password, result.minutes
    );
    result.mikrotik = mtResult;
  }

  res.json(result);
});

// ─── Generate Voucher (Admin / Calling) ───────────────────────

router.post('/generate-voucher', authDevice, (req, res) => {
  const { minutes, source = 'calling' } = req.body;
  if (!minutes || minutes < 1) {
    return res.status(400).json({ error: 'minutes required' });
  }

  const voucher = createVoucher(req.site.id, minutes, source);
  res.json({ voucher });
});

// ─── Site Info ────────────────────────────────────────────────

router.get('/site', authDevice, (req, res) => {
  const devices = db.prepare(
    'SELECT id, device_type, mac_address, name, last_seen, status FROM devices WHERE site_id = ?'
  ).all(req.site.id);

  const activeSessions = db.prepare(
    "SELECT COUNT(*) as c FROM sessions WHERE site_id = ? AND status = 'active' AND expires_at > datetime('now')"
  ).get(req.site.id);

  res.json({
    site: {
      id: req.site.id,
      name: req.site.name,
      minutes_per_coin: req.site.minutes_per_coin,
      rate_per_hour: req.site.rate_per_hour
    },
    devices,
    active_sessions: activeSessions.c
  });
});

// ─── Admin: Create Site ───────────────────────────────────────

router.post('/admin/create-site', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { name, mikrotik_host, minutes_per_coin = 5, rate_per_hour = 10 } = req.body;
  const id = uuid();
  const apiKey = uuid().replace(/-/g, '');

  db.prepare(`
    INSERT INTO sites (id, name, api_key, mikrotik_host, minutes_per_coin, rate_per_hour)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, apiKey, mikrotik_host, minutes_per_coin, rate_per_hour);

  res.json({ site_id: id, api_key: apiKey, name });
});

// ─── Sessions List ────────────────────────────────────────────

router.get('/sessions', authDevice, (req, res) => {
  const sessions = db.prepare(`
    SELECT * FROM sessions
    WHERE site_id = ? AND status = 'active'
    ORDER BY started_at DESC LIMIT 50
  `).all(req.site.id);
  res.json({ sessions });
});

module.exports = router;
