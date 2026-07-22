const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { createVoucher, redeemVoucher } = require('../lib/voucher');
const { createHotspotUser } = require('../lib/mikrotik');
const { pauseSession, resumeSession, keepalive, getResumableSession, getSessionById } = require('../lib/session');

const router = express.Router();

function authDevice(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const site = db.prepare("SELECT * FROM sites WHERE api_key = ? AND status = 'active'").get(apiKey);
  if (!site) return res.status(401).json({ error: 'Invalid API key' });

  req.site = site;
  next();
}

router.get('/portal-config/:siteId', (req, res) => {
  const site = db.prepare(
    "SELECT id, name, portal_title, minutes_per_coin, rate_per_hour, coin_value, status, vlan_id FROM sites WHERE id = ?"
  ).get(req.params.siteId);

  if (!site || site.status !== 'active') {
    return res.status(404).json({ error: 'Site not found' });
  }

  const plans = db.prepare(
    'SELECT name, coins, minutes, price FROM rate_plans WHERE site_id = ? AND active = 1 ORDER BY sort_order'
  ).all(site.id);

  res.json({
    site: {
      id: site.id,
      name: site.name,
      portal_title: site.portal_title || site.name,
      minutes_per_coin: site.minutes_per_coin,
      rate_per_hour: site.rate_per_hour,
      coin_value: site.coin_value,
      vlan_id: site.vlan_id,
      pause_mode: true,
      validity: 'none',
      random_mac: true
    },
    plans,
    flow: {
      connect: 'Client → JM WiFi SSID → MikroTik VLAN hotspot',
      portal: 'Captive portal mixes MikroTik hotspot + cloud portal',
      pause: 'Auto-pause on disconnect (no validity expiry)',
      resume: 'Auto-resume on reconnect — random MAC OK with same voucher'
    }
  });
});

router.post('/register-device', authDevice, (req, res) => {
  const { device_type, mac_address, name } = req.body;
  if (!device_type || !['esp8266', 'mikrotik', 'vendo'].includes(device_type)) {
    return res.status(400).json({ error: 'device_type must be esp8266, mikrotik, or vendo' });
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
  const { device_id } = req.body;
  const device = db.prepare(
    'SELECT * FROM devices WHERE id = ? AND site_id = ?'
  ).get(device_id, req.site.id);

  if (!device) return res.status(404).json({ error: 'Device not found' });

  db.prepare(
    "UPDATE devices SET last_seen = datetime('now'), status = 'online' WHERE id = ?"
  ).run(device_id);

  const site = req.site;
  const plans = db.prepare(
    'SELECT name, coins, minutes, price FROM rate_plans WHERE site_id = ? AND active = 1 ORDER BY sort_order'
  ).all(site.id);

  res.json({
    ok: true,
    config: {
      minutes_per_coin: site.minutes_per_coin,
      rate_per_hour: site.rate_per_hour,
      coin_value: site.coin_value,
      hotspot_profile: site.hotspot_profile || 'jmwifi-pause',
      pause_mode: true,
      validity: 'none',
      plans
    }
  });
});

router.post('/coin-insert', authDevice, (req, res) => {
  const { device_id, coins = 1 } = req.body;
  const site = req.site;
  const coinCount = Math.max(1, parseInt(coins, 10) || 1);
  const minutes = site.minutes_per_coin * coinCount;
  const amount = (site.coin_value || 1) * coinCount;

  const voucher = createVoucher(site.id, minutes, 'coin', device_id || null, amount);

  const validDevice = device_id
    ? db.prepare('SELECT id FROM devices WHERE id = ? AND site_id = ?').get(device_id, site.id)
    : null;

  db.prepare(`
    INSERT INTO coin_logs (site_id, device_id, coins, amount, minutes_granted, voucher_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(site.id, validDevice ? device_id : null, coinCount, amount, minutes, voucher.code);

  res.json({
    success: true,
    voucher_code: voucher.code,
    minutes,
    amount,
    pause_mode: true,
    validity: 'none',
    message: `Inserted ${coinCount} coin(s) = ${minutes} minutes (pause on disconnect). Code: ${voucher.code}`
  });
});

router.post('/redeem', async (req, res) => {
  const { code, mac, site_id, ip } = req.body;
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

  const result = redeemVoucher(code, mac, siteId, { ip });
  if (result.error) return res.status(400).json(result);

  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
  if (site) {
    const mtResult = await createHotspotUser(
      site,
      mac,
      result.username,
      result.password,
      result.remaining_minutes || result.minutes,
      { profileName: result.profile_name || 'jmwifi-pause' }
    );
    result.mikrotik = mtResult;
  }

  res.json(result);
});

router.post('/session/pause', authDevice, (req, res) => {
  const { session_id, mac, code, username, reason = 'disconnect' } = req.body || {};
  let session = session_id ? getSessionById(session_id) : null;
  if (!session) {
    session = getResumableSession(req.site.id, { mac, code, username });
  }
  if (!session || session.site_id !== req.site.id) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const result = pauseSession(session.id, reason);
  if (result.error && result.status !== 'exhausted') return res.status(400).json(result);
  res.json(result);
});

router.post('/session/resume', authDevice, async (req, res) => {
  const { session_id, mac, code, username, ip } = req.body || {};
  if (!mac) return res.status(400).json({ error: 'mac required' });

  let session = session_id ? getSessionById(session_id) : null;
  if (!session) {
    session = getResumableSession(req.site.id, { mac, code, username });
  }
  if (!session || session.site_id !== req.site.id) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const result = resumeSession(session.id, { mac, ip });
  if (result.error) return res.status(400).json(result);

  const mtResult = await createHotspotUser(
    req.site,
    mac,
    result.username,
    result.password,
    result.remaining_minutes,
    { profileName: result.profile_name || 'jmwifi-pause' }
  );
  result.mikrotik = mtResult;
  res.json(result);
});

router.post('/session/keepalive', authDevice, (req, res) => {
  const { session_id, mac, code, username, ip } = req.body || {};
  let session = session_id ? getSessionById(session_id) : null;
  if (!session) {
    session = getResumableSession(req.site.id, { mac, code, username });
  }
  if (!session || session.site_id !== req.site.id) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const result = keepalive(session.id, { mac, ip });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post('/generate-voucher', authDevice, (req, res) => {
  const { minutes, source = 'calling', price = 0 } = req.body;
  if (!minutes || minutes < 1) {
    return res.status(400).json({ error: 'minutes required' });
  }

  const voucher = createVoucher(req.site.id, minutes, source, null, price);
  res.json({ voucher, pause_mode: true, validity: 'none' });
});

router.get('/site', authDevice, (req, res) => {
  const devices = db.prepare(
    'SELECT id, device_type, mac_address, name, last_seen, status FROM devices WHERE site_id = ?'
  ).all(req.site.id);

  const activeSessions = db.prepare(
    "SELECT COUNT(*) as c FROM sessions WHERE site_id = ? AND status IN ('active','paused')"
  ).get(req.site.id);

  const plans = db.prepare(
    'SELECT name, coins, minutes, price FROM rate_plans WHERE site_id = ? AND active = 1 ORDER BY sort_order'
  ).all(req.site.id);

  res.json({
    site: {
      id: req.site.id,
      name: req.site.name,
      portal_title: req.site.portal_title,
      minutes_per_coin: req.site.minutes_per_coin,
      rate_per_hour: req.site.rate_per_hour,
      coin_value: req.site.coin_value,
      pause_mode: true,
      validity: 'none'
    },
    devices,
    plans,
    active_sessions: activeSessions.c
  });
});

router.get('/sessions', authDevice, (req, res) => {
  const sessions = db.prepare(`
    SELECT * FROM sessions
    WHERE site_id = ? AND status IN ('active','paused')
    ORDER BY started_at DESC LIMIT 50
  `).all(req.site.id);
  res.json({ sessions });
});

router.post('/admin/create-site', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (process.env.NODE_ENV === 'production' && adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { name, mikrotik_host, minutes_per_coin = 5, rate_per_hour = 10 } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const id = uuid();
  const apiKey = uuid().replace(/-/g, '');
  const admin = db.prepare("SELECT id FROM operators WHERE role = 'admin' LIMIT 1").get();

  db.prepare(`
    INSERT INTO sites (id, operator_id, name, api_key, mikrotik_host, minutes_per_coin, rate_per_hour)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, admin?.id || null, name, apiKey, mikrotik_host, minutes_per_coin, rate_per_hour);

  res.json({ site_id: id, api_key: apiKey, name });
});

module.exports = router;
