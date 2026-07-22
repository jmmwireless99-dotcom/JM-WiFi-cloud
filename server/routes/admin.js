const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const {
  hashPassword,
  verifyPassword,
  signToken,
  authAdmin,
  requireRole
} = require('../lib/auth');
const { createVoucher, createVoucherBatch } = require('../lib/voucher');
const { getDashboardStats, getSalesReport } = require('../lib/reports');
const { moduleSitesSql, getOwnedSite, publicSite, siteIdsSubquery } = require('../lib/module-sites');

const router = express.Router();
const MODULE = 'hotspot';

function ownedSitesSql(operator) {
  return moduleSitesSql(operator, MODULE);
}

// ─── Auth ─────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const operator = db.prepare('SELECT * FROM operators WHERE email = ?').get(email.toLowerCase().trim());
  if (!operator || operator.status !== 'active' || !verifyPassword(password, operator.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(operator);
  res.json({
    token,
    operator: {
      id: operator.id,
      email: operator.email,
      name: operator.name,
      role: operator.role
    }
  });
});

router.get('/me', authAdmin, (req, res) => {
  res.json({ operator: req.operator });
});

router.post('/change-password', authAdmin, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'current_password and new_password (min 6) required' });
  }

  const op = db.prepare('SELECT * FROM operators WHERE id = ?').get(req.operator.id);
  if (!verifyPassword(current_password, op.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }

  db.prepare('UPDATE operators SET password_hash = ? WHERE id = ?')
    .run(hashPassword(new_password), op.id);
  res.json({ success: true });
});

// ─── Dashboard / Reports ──────────────────────────────────────

router.get('/dashboard', authAdmin, (req, res) => {
  const stats = getDashboardStats(req.operator, req.query.site_id || null, MODULE);
  res.json(stats);
});

router.get('/system', authAdmin, async (req, res) => {
  const os = require('os');
  const { mtFetch } = require('../lib/mikrotik');
  const f = moduleSitesSql(req.operator, MODULE);
  const sites = db.prepare(`
    SELECT id, name, mikrotik_host, mikrotik_user, mikrotik_pass
    FROM sites WHERE ${f.sql} AND mikrotik_host IS NOT NULL AND mikrotik_host != ''
    ORDER BY created_at DESC LIMIT 4
  `).all(...f.params);

  const routers = [];
  for (const site of sites) {
    if (!site.mikrotik_pass) {
      routers.push({
        site_id: site.id,
        name: site.name,
        host: site.mikrotik_host,
        online: false,
        error: 'No password'
      });
      continue;
    }
    const [identity, resource] = await Promise.all([
      mtFetch(site, '/system/identity'),
      mtFetch(site, '/system/resource')
    ]);
    const idData = Array.isArray(identity.data) ? identity.data[0] : identity.data;
    const resData = Array.isArray(resource.data) ? resource.data[0] : resource.data;
    if (!resource.success || !resData) {
      routers.push({
        site_id: site.id,
        name: site.name,
        host: site.mikrotik_host,
        online: false,
        error: resource.error || identity.error || 'Unreachable'
      });
      continue;
    }
    const totalMem = Number(resData['total-memory'] || 0);
    const freeMem = Number(resData['free-memory'] || 0);
    const totalHdd = Number(resData['total-hdd-space'] || 0);
    const freeHdd = Number(resData['free-hdd-space'] || 0);
    routers.push({
      site_id: site.id,
      name: site.name,
      host: site.mikrotik_host,
      online: true,
      identity: idData?.name || site.name,
      board: resData['board-name'] || resData.platform || 'MikroTik',
      version: resData.version || '',
      cpu_load: Number(resData['cpu-load'] || 0),
      cpu_count: Number(resData['cpu-count'] || 1),
      uptime: resData.uptime || '',
      architecture: resData['architecture-name'] || '',
      memory: {
        free: freeMem,
        total: totalMem,
        used_pct: totalMem ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0
      },
      hdd: {
        free: freeHdd,
        total: totalHdd,
        used_pct: totalHdd ? Math.round(((totalHdd - freeHdd) / totalHdd) * 100) : 0
      },
      temperature: resData['cpu-temperature'] || null
    });
  }

  const cpus = os.cpus() || [];
  const load = os.loadavg();
  res.json({
    cloud: {
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: os.uptime(),
      cpu_count: cpus.length,
      cpu_model: cpus[0]?.model || 'CPU',
      load: load[0],
      memory: {
        free: os.freemem(),
        total: os.totalmem(),
        used_pct: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
      }
    },
    routers,
    stamped_at: new Date().toISOString()
  });
});

router.get('/reports/sales', authAdmin, (req, res) => {
  const report = getSalesReport(req.operator, {
    siteId: req.query.site_id || null,
    period: req.query.period || 'daily',
    days: Math.min(parseInt(req.query.days || '30', 10), 365),
    moduleType: MODULE
  });
  res.json(report);
});

// ─── Vendos (Sites) ───────────────────────────────────────────

router.get('/vendos', authAdmin, (req, res) => {
  const f = ownedSitesSql(req.operator);
  const vendos = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM devices d WHERE d.site_id = s.id) as device_count,
      (SELECT COUNT(*) FROM devices d WHERE d.site_id = s.id AND d.status = 'online') as online_count,
      (SELECT COUNT(*) FROM sessions sess WHERE sess.site_id = s.id AND sess.status = 'active' AND sess.expires_at > datetime('now')) as active_sessions,
      (SELECT COALESCE(SUM(amount), 0) FROM coin_logs c WHERE c.site_id = s.id AND date(c.created_at) = date('now')) as sales_today
    FROM sites s
    WHERE ${f.sql}
    ORDER BY s.created_at DESC
  `).all(...f.params).map(publicSite);

  res.json({ vendos });
});

router.get('/vendos/:id', authAdmin, (req, res) => {
  const site = getOwnedSite(req.operator, req.params.id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });

  const devices = db.prepare(
    'SELECT id, device_type, mac_address, name, last_seen, status, created_at FROM devices WHERE site_id = ? ORDER BY last_seen DESC'
  ).all(site.id);

  const plans = db.prepare(
    'SELECT * FROM rate_plans WHERE site_id = ? ORDER BY sort_order, coins'
  ).all(site.id);

  res.json({ vendo: publicSite(site), devices, plans });
});

router.post('/vendos', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const {
    name,
    address = '',
    mikrotik_host = '',
    mikrotik_user = 'admin',
    mikrotik_pass = '',
    minutes_per_coin = 5,
    rate_per_hour = 10,
    coin_value = 1,
    portal_title = 'JM WiFi',
    bandwidth_up = '2M',
    bandwidth_down = '5M',
    vlan_id = 10
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name required' });

  const id = uuid();
  const apiKey = uuid().replace(/-/g, '');

  db.prepare(`
    INSERT INTO sites (
      id, operator_id, name, api_key, module_type, address, mikrotik_host, mikrotik_user, mikrotik_pass,
      minutes_per_coin, rate_per_hour, coin_value, portal_title, bandwidth_up, bandwidth_down, vlan_id
    ) VALUES (?, ?, ?, ?, 'hotspot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.operator.id, name, apiKey, address, mikrotik_host, mikrotik_user, mikrotik_pass,
    minutes_per_coin, rate_per_hour, coin_value, portal_title, bandwidth_up, bandwidth_down, vlan_id
  );

  // Default rate plans
  const defaults = [
    ['5 Min', 1, minutes_per_coin, coin_value, 1],
    ['30 Min', 5, minutes_per_coin * 5, coin_value * 5, 2],
    ['1 Hour', 10, minutes_per_coin * 10, coin_value * 10, 3]
  ];
  for (const [planName, coins, minutes, price, sort] of defaults) {
    db.prepare(`
      INSERT INTO rate_plans (id, site_id, name, coins, minutes, price, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), id, planName, coins, minutes, price, sort);
  }

  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  res.status(201).json({ vendo: publicSite(site), api_key: apiKey });
});

router.put('/vendos/:id', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const site = getOwnedSite(req.operator, req.params.id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });

  const fields = [
    'name', 'address', 'status', 'portal_title', 'mikrotik_host', 'mikrotik_user',
    'mikrotik_pass', 'hotspot_profile', 'vlan_id', 'rate_per_hour', 'minutes_per_coin',
    'coin_value', 'bandwidth_up', 'bandwidth_down', 'notes'
  ];

  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  values.push(site.id);
  db.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id);
  res.json({ vendo: publicSite(updated) });
});

router.delete('/vendos/:id', authAdmin, requireRole('admin'), (req, res) => {
  const site = getOwnedSite(req.operator, req.params.id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });
  db.prepare('DELETE FROM sites WHERE id = ?').run(site.id);
  res.json({ success: true });
});

router.post('/vendos/:id/regenerate-key', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const site = getOwnedSite(req.operator, req.params.id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });
  const apiKey = uuid().replace(/-/g, '');
  db.prepare('UPDATE sites SET api_key = ? WHERE id = ?').run(apiKey, site.id);
  res.json({ api_key: apiKey });
});

// ─── Rate Plans ───────────────────────────────────────────────

router.get('/vendos/:id/plans', authAdmin, (req, res) => {
  const site = getOwnedSite(req.operator, req.params.id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });
  const plans = db.prepare('SELECT * FROM rate_plans WHERE site_id = ? ORDER BY sort_order').all(site.id);
  res.json({ plans });
});

router.post('/vendos/:id/plans', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const site = getOwnedSite(req.operator, req.params.id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });

  const { name, coins = 1, minutes, price } = req.body || {};
  if (!name || !minutes) return res.status(400).json({ error: 'name and minutes required' });

  const id = uuid();
  db.prepare(`
    INSERT INTO rate_plans (id, site_id, name, coins, minutes, price, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, site.id, name, coins, minutes, price ?? coins * site.coin_value, coins);

  res.status(201).json({ plan: db.prepare('SELECT * FROM rate_plans WHERE id = ?').get(id) });
});

router.delete('/plans/:id', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const plan = db.prepare('SELECT * FROM rate_plans WHERE id = ?').get(req.params.id);
  if (!plan || !getOwnedSite(req.operator, plan.site_id, MODULE)) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  db.prepare('DELETE FROM rate_plans WHERE id = ?').run(plan.id);
  res.json({ success: true });
});

// ─── Devices ──────────────────────────────────────────────────

router.get('/devices', authAdmin, (req, res) => {
  const f = siteIdsSubquery(req.operator, MODULE);
  const devices = db.prepare(`
    SELECT d.*, s.name as site_name
    FROM devices d
    JOIN sites s ON s.id = d.site_id
    WHERE ${f.sql}
    ORDER BY d.last_seen DESC
  `).all(...f.params);
  res.json({ devices });
});

// Mark offline devices (no heartbeat > 5 min)
function refreshDeviceStatuses() {
  db.prepare(`
    UPDATE devices SET status = 'offline'
    WHERE status = 'online'
      AND (last_seen IS NULL OR last_seen < datetime('now', '-5 minutes'))
  `).run();
}

router.get('/devices/refresh', authAdmin, (req, res) => {
  refreshDeviceStatuses();
  res.json({ success: true });
});

// ─── Sessions ─────────────────────────────────────────────────

router.get('/sessions', authAdmin, (req, res) => {
  const siteId = req.query.site_id;
  let sql = `
    SELECT sess.*, s.name as site_name
    FROM sessions sess
    JOIN sites s ON s.id = sess.site_id
    WHERE sess.status IN ('active','paused')
  `;
  const params = [];

  if (req.operator.role !== 'admin') {
    sql += ' AND s.operator_id = ?';
    params.push(req.operator.id);
  }
  if (siteId) {
    sql += ' AND sess.site_id = ?';
    params.push(siteId);
  }
  sql += ' ORDER BY sess.started_at DESC LIMIT 200';

  res.json({ sessions: db.prepare(sql).all(...params) });
});

router.post('/sessions/:id/disconnect', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const session = db.prepare(`
    SELECT sess.* FROM sessions sess
    JOIN sites s ON s.id = sess.site_id
    WHERE sess.id = ?
      AND (${req.operator.role === 'admin' ? '1=1' : 's.operator_id = ?'})
  `).get(...(req.operator.role === 'admin' ? [req.params.id] : [req.params.id, req.operator.id]));

  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { pauseSession } = require('../lib/session');
  const result = pauseSession(session.id, 'admin-disconnect');
  res.json(result);
});

// ─── Hotspot Servers (Kitifi-style) ───────────────────────────

router.get('/hotspot/interfaces', authAdmin, async (req, res) => {
  const { resolveSite } = require('../lib/mikrotik-push');
  const { mtFetch } = require('../lib/mikrotik');
  const siteId = req.query.site_id || null;
  const site = siteId
    ? getOwnedSite(req.operator, siteId, MODULE)
    : resolveSite({});
  if (!site?.mikrotik_host) {
    return res.status(400).json({ error: 'Walang MikroTik sa vendo site', interfaces: [] });
  }
  const result = await mtFetch(site, '/interface');
  if (!result.success) {
    return res.status(502).json({ error: result.error || 'Hindi mabasa ang MikroTik', interfaces: [] });
  }
  const interfaces = (result.data || [])
    .filter((i) => i.name && String(i.disabled || 'false') !== 'true')
    .filter((i) => String(i.type || '').toLowerCase() !== 'bridge')
    .filter((i) => !/^bridge/i.test(String(i.name)))
    .filter((i) => {
      const t = String(i.type || '').toLowerCase();
      return t === 'ether' || t === 'vlan' || t === 'bond' || t === 'wlan';
    })
    .map((i) => ({
      name: i.name,
      type: i.type || '',
      running: String(i.running || '') !== 'false'
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ interfaces });
});

router.get('/hotspot/servers', authAdmin, (req, res) => {
  const f = ownedSitesSql(req.operator);
  const servers = db.prepare(`
    SELECT hs.*, s.name as site_name
    FROM hotspot_servers hs
    LEFT JOIN sites s ON s.id = hs.site_id
    WHERE (hs.site_id IS NULL OR ${f.sql.replace('operator_id', 's.operator_id')})
      AND COALESCE(s.module_type, 'hotspot') = 'hotspot'
    ORDER BY hs.created_at DESC
  `).all(...f.params);
  res.json({ servers });
});

router.post('/hotspot/servers', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const {
    name,
    site_id = null,
    hs_address = '10.0.0.1',
    html_directory = 'hotspot',
    login_by = 'http-pap,cookie',
    interface_name = '',
    vlan_id = 0,
    vlan_ids = '101,102',
    dns_name = 'jmwifi.local',
    profile_name = 'jmwifi',
    push_to_mikrotik = true
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name required' });
  if (!interface_name) return res.status(400).json({ error: 'interface_name required — pili ng parent interface' });
  if (!site_id) return res.status(400).json({ error: 'Pili ng Vendo site — kailangan para sa MikroTik sync' });
  const site = getOwnedSite(req.operator, site_id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });
  if (!site.mikrotik_host || !site.mikrotik_pass) {
    return res.status(400).json({ error: 'Walang MikroTik host/password sa vendo site. I-set sa Vendo List muna.' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO hotspot_servers (
      id, site_id, name, hs_address, html_directory, login_by,
      interface_name, vlan_id, vlan_ids, dns_name, profile_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, site_id, name, hs_address, html_directory, login_by, interface_name, vlan_id, vlan_ids, dns_name, profile_name);

  const server = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(id);
  const { pushHotspotServer } = require('../lib/mikrotik-push');
  const push = await pushHotspotServer(server, { site });
  if (!push.success) {
    db.prepare('DELETE FROM hotspot_servers WHERE id = ?').run(id);
    return res.status(502).json({ error: push.error || 'MikroTik push failed', push });
  }
  db.prepare("UPDATE hotspot_servers SET last_pushed_at = datetime('now') WHERE id = ?").run(id);
  const saved = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(id);
  res.status(201).json({ server: saved, push });
});

router.put('/hotspot/servers/:id', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const server = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (server.site_id && !getOwnedSite(req.operator, server.site_id, MODULE)) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const fields = [
    'name', 'hs_address', 'html_directory', 'login_by', 'interface_name',
    'vlan_id', 'vlan_ids', 'dns_name', 'profile_name', 'status', 'site_id'
  ];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(server.id);
  db.prepare(`UPDATE hotspot_servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(server.id);
  let push = null;
  if (req.body.push_to_mikrotik !== false) {
    const site = updated.site_id
      ? getOwnedSite(req.operator, updated.site_id, MODULE)
      : require('../lib/mikrotik-push').resolveSite(updated);
    if (!site?.mikrotik_host) {
      return res.status(400).json({ error: 'Walang MikroTik sa vendo site' });
    }
    const { pushHotspotServer } = require('../lib/mikrotik-push');
    push = await pushHotspotServer(updated, { site });
    if (push.success) {
      db.prepare("UPDATE hotspot_servers SET last_pushed_at = datetime('now') WHERE id = ?").run(server.id);
    }
  }
  const saved = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(server.id);
  res.json({ server: saved, push });
});

router.post('/hotspot/servers/:id/push', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const server = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (server.site_id && !getOwnedSite(req.operator, server.site_id, MODULE)) {
    return res.status(404).json({ error: 'Server not found' });
  }
  const { pushHotspotServer } = require('../lib/mikrotik-push');
  const push = await pushHotspotServer(server);
  if (push.success) {
    db.prepare("UPDATE hotspot_servers SET last_pushed_at = datetime('now') WHERE id = ?").run(server.id);
    return res.json(push);
  }
  res.status(502).json(push);
});

router.post('/hotspot/profiles/:id/push', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const profile = db.prepare('SELECT * FROM hotspot_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const site = profile.site_id
    ? getOwnedSite(req.operator, profile.site_id, MODULE)
    : require('../lib/mikrotik-push').resolveSite({});
  if (!site) return res.status(400).json({ error: 'Walang vendo site na may MikroTik' });
  const { pushHotspotProfile } = require('../lib/mikrotik-push');
  const push = await pushHotspotProfile(profile, site);
  if (push.success) return res.json(push);
  res.status(502).json(push);
});

router.delete('/hotspot/servers/:id', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const server = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (server.site_id && !getOwnedSite(req.operator, server.site_id, MODULE)) {
    return res.status(404).json({ error: 'Server not found' });
  }

  let mikrotik = null;
  if (req.query.remove_from_mikrotik !== 'false') {
    const { deleteHotspotServer } = require('../lib/mikrotik-push');
    mikrotik = await deleteHotspotServer(server);
  }

  db.prepare('DELETE FROM hotspot_servers WHERE id = ?').run(server.id);
  res.json({ success: true, mikrotik });
});

router.get('/hotspot/servers/:id/script', authAdmin, (req, res) => {
  const server = db.prepare('SELECT * FROM hotspot_servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const { buildServerScript } = require('../lib/mikrotik');
  const base = process.env.BASE_URL || 'https://jmtechsolution.cloud/allvendo';
  res.json({ script: buildServerScript(server, base) });
});

// ─── Hotspot Profiles (+ Profile) ─────────────────────────────

router.get('/hotspot/profiles', authAdmin, (req, res) => {
  const f = ownedSitesSql(req.operator);
  const profiles = db.prepare(`
    SELECT hp.*, s.name as site_name
    FROM hotspot_profiles hp
    LEFT JOIN sites s ON s.id = hp.site_id
    WHERE hp.site_id IS NULL OR ${f.sql.replace('operator_id', 's.operator_id')}
    ORDER BY hp.created_at DESC
  `).all(...f.params);
  res.json({ profiles });
});

router.post('/hotspot/profiles', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const {
    name,
    site_id = null,
    rate_limit = '2M/5M',
    shared_users = 1,
    session_timeout = '',
    idle_timeout = 'none',
    keepalive_timeout = '2m',
    pause_on_disconnect = 1,
    no_validity = 1,
    allow_random_mac = 1,
    mac_cookie = 1,
    notes = '',
    push_to_mikrotik = true
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name required' });
  if (site_id && !getOwnedSite(req.operator, site_id, MODULE)) {
    return res.status(404).json({ error: 'Vendo not found' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO hotspot_profiles (
      id, site_id, name, rate_limit, shared_users, session_timeout, idle_timeout,
      keepalive_timeout, pause_on_disconnect, no_validity, allow_random_mac, mac_cookie, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, site_id, name, rate_limit, shared_users, session_timeout, idle_timeout,
    keepalive_timeout, pause_on_disconnect ? 1 : 0, no_validity ? 1 : 0,
    allow_random_mac ? 1 : 0, mac_cookie ? 1 : 0, notes
  );

  const profile = db.prepare('SELECT * FROM hotspot_profiles WHERE id = ?').get(id);
  let push = null;
  if (push_to_mikrotik) {
    const site = site_id
      ? getOwnedSite(req.operator, site_id, MODULE)
      : require('../lib/mikrotik-push').resolveSite({});
    if (site) {
      const { pushHotspotProfile } = require('../lib/mikrotik-push');
      push = await pushHotspotProfile(profile, site);
    }
  }
  const { buildProfileScript } = require('../lib/mikrotik');
  res.status(201).json({ profile, push, script: buildProfileScript(profile) });
});

router.put('/hotspot/profiles/:id', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const profile = db.prepare('SELECT * FROM hotspot_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (profile.site_id && !getOwnedSite(req.operator, profile.site_id, MODULE)) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const fields = [
    'name', 'rate_limit', 'shared_users', 'session_timeout', 'idle_timeout',
    'keepalive_timeout', 'pause_on_disconnect', 'no_validity', 'allow_random_mac',
    'mac_cookie', 'transparent_proxy', 'active', 'notes', 'site_id'
  ];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      let val = req.body[field];
      if (['pause_on_disconnect', 'no_validity', 'allow_random_mac', 'mac_cookie', 'transparent_proxy', 'active'].includes(field)) {
        val = val ? 1 : 0;
      }
      values.push(val);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(profile.id);
  db.prepare(`UPDATE hotspot_profiles SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM hotspot_profiles WHERE id = ?').get(profile.id);

  let push = null;
  if (req.body.push_to_mikrotik !== false) {
    const site = updated.site_id
      ? getOwnedSite(req.operator, updated.site_id, MODULE)
      : require('../lib/mikrotik-push').resolveSite({});
    if (site) {
      const { pushHotspotProfile } = require('../lib/mikrotik-push');
      push = await pushHotspotProfile(updated, site);
    }
  }
  res.json({ profile: updated, push });
});

router.delete('/hotspot/profiles/:id', authAdmin, requireRole('admin', 'operator'), async (req, res) => {
  const profile = db.prepare('SELECT * FROM hotspot_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (profile.site_id && !getOwnedSite(req.operator, profile.site_id, MODULE)) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  let mikrotik = null;
  if (req.query.remove_from_mikrotik !== 'false') {
    const site = profile.site_id
      ? getOwnedSite(req.operator, profile.site_id, MODULE)
      : require('../lib/mikrotik-push').resolveSite({});
    if (site) {
      const { deleteHotspotProfile } = require('../lib/mikrotik-push');
      mikrotik = await deleteHotspotProfile(profile, site);
    }
  }

  db.prepare('DELETE FROM hotspot_profiles WHERE id = ?').run(profile.id);
  res.json({ success: true, mikrotik });
});

router.get('/hotspot/profiles/:id/script', authAdmin, (req, res) => {
  const profile = db.prepare('SELECT * FROM hotspot_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const { buildProfileScript } = require('../lib/mikrotik');
  res.json({ script: buildProfileScript(profile) });
});

// ─── Vouchers ─────────────────────────────────────────────────

router.get('/vouchers', authAdmin, (req, res) => {
  const siteId = req.query.site_id;
  const used = req.query.used;
  let sql = `
    SELECT v.*, s.name as site_name
    FROM vouchers v
    JOIN sites s ON s.id = v.site_id
    WHERE 1=1
  `;
  const params = [];

  if (req.operator.role !== 'admin') {
    sql += ' AND s.operator_id = ?';
    params.push(req.operator.id);
  }
  if (siteId) {
    sql += ' AND v.site_id = ?';
    params.push(siteId);
  }
  if (used === '0' || used === '1') {
    sql += ' AND v.used = ?';
    params.push(parseInt(used, 10));
  }
  sql += ' ORDER BY v.created_at DESC LIMIT 500';

  res.json({ vouchers: db.prepare(sql).all(...params) });
});

router.post('/vouchers/generate', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const { site_id, minutes, count = 1, price = 0, source = 'admin' } = req.body || {};
  if (!site_id || !minutes) {
    return res.status(400).json({ error: 'site_id and minutes required' });
  }

  const site = getOwnedSite(req.operator, site_id, MODULE);
  if (!site) return res.status(404).json({ error: 'Vendo not found' });

  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 200);
  const vouchers = createVoucherBatch(site.id, n, minutes, source, price);
  res.status(201).json({ vouchers, count: vouchers.length });
});

// ─── Coin / Sales logs ────────────────────────────────────────

router.get('/sales', authAdmin, (req, res) => {
  const siteId = req.query.site_id;
  let sql = `
    SELECT c.*, s.name as site_name, d.name as device_name
    FROM coin_logs c
    JOIN sites s ON s.id = c.site_id
    LEFT JOIN devices d ON d.id = c.device_id
    WHERE 1=1
  `;
  const params = [];

  if (req.operator.role !== 'admin') {
    sql += ' AND s.operator_id = ?';
    params.push(req.operator.id);
  }
  if (siteId) {
    sql += ' AND c.site_id = ?';
    params.push(siteId);
  }
  sql += ' ORDER BY c.created_at DESC LIMIT 500';

  res.json({ sales: db.prepare(sql).all(...params) });
});

// ─── Operators (admin only) ───────────────────────────────────

router.get('/operators', authAdmin, requireRole('admin'), (req, res) => {
  const operators = db.prepare(
    'SELECT id, email, name, role, status, created_at FROM operators ORDER BY created_at'
  ).all();
  res.json({ operators });
});

router.post('/operators', authAdmin, requireRole('admin'), (req, res) => {
  const { email, password, name, role = 'operator' } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, name required' });
  }
  if (!['admin', 'operator', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  const id = uuid();
  try {
    db.prepare(`
      INSERT INTO operators (id, email, password_hash, name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, email.toLowerCase().trim(), hashPassword(password), name, role);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw err;
  }

  res.status(201).json({
    operator: db.prepare(
      'SELECT id, email, name, role, status, created_at FROM operators WHERE id = ?'
    ).get(id)
  });
});

module.exports = router;
