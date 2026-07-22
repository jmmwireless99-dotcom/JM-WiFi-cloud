/**
 * Empty Bottle module — dedicated admin API (separate from Cloud Hotspot).
 */
const express = require('express');
const { v4: uuid } = require('uuid');
const os = require('os');
const db = require('../db');
const {
  hashPassword,
  verifyPassword,
  signToken,
  authAdmin,
  requireRole
} = require('../lib/auth');
const { createVoucherBatch } = require('../lib/voucher');
const { getDashboardStats, getSalesReport } = require('../lib/reports');
const { moduleSitesSql, getOwnedSite, publicSite, siteIdsSubquery } = require('../lib/module-sites');
const { mtFetch } = require('../lib/mikrotik');

const router = express.Router();
const MODULE = 'empty_bottle';

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
    operator: { id: operator.id, email: operator.email, name: operator.name, role: operator.role }
  });
});

router.get('/me', authAdmin, (req, res) => {
  res.json({ operator: req.operator, module: MODULE });
});

router.get('/dashboard', authAdmin, (req, res) => {
  res.json(getDashboardStats(req.operator, req.query.site_id || null, MODULE));
});

router.get('/system', authAdmin, async (req, res) => {
  const f = moduleSitesSql(req.operator, MODULE);
  const sites = db.prepare(`
    SELECT id, name, mikrotik_host, mikrotik_user, mikrotik_pass, vlan_id
    FROM sites WHERE ${f.sql} AND mikrotik_host IS NOT NULL AND mikrotik_host != ''
    ORDER BY created_at DESC LIMIT 4
  `).all(...f.params);

  const routers = [];
  for (const site of sites) {
    if (!site.mikrotik_pass) {
      routers.push({ site_id: site.id, name: site.name, host: site.mikrotik_host, online: false, error: 'No password' });
      continue;
    }
    const [identity, resource, vlanPrint] = await Promise.all([
      mtFetch(site, '/system/identity'),
      mtFetch(site, '/system/resource'),
      mtFetch(site, `/interface/vlan?name=VLAN${site.vlan_id || 103}`)
    ]);
    const idData = Array.isArray(identity.data) ? identity.data[0] : identity.data;
    const resData = Array.isArray(resource.data) ? resource.data[0] : resource.data;
    const vlanOk = vlanPrint.success && (Array.isArray(vlanPrint.data) ? vlanPrint.data.length : vlanPrint.data);
    if (!resource.success || !resData) {
      routers.push({
        site_id: site.id,
        name: site.name,
        host: site.mikrotik_host,
        vlan_id: site.vlan_id || 103,
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
      vlan_id: site.vlan_id || 103,
      vlan_configured: Boolean(vlanOk),
      online: true,
      identity: idData?.name || site.name,
      board: resData['board-name'] || 'MikroTik',
      version: resData.version || '',
      cpu_load: Number(resData['cpu-load'] || 0),
      cpu_count: Number(resData['cpu-count'] || 1),
      uptime: resData.uptime || '',
      memory: {
        free: freeMem,
        total: totalMem,
        used_pct: totalMem ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0
      },
      hdd: {
        free: freeHdd,
        total: totalHdd,
        used_pct: totalHdd ? Math.round(((totalHdd - freeHdd) / totalHdd) * 100) : 0
      }
    });
  }

  res.json({
    cloud: {
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: os.uptime(),
      cpu_count: os.cpus().length,
      load: os.loadavg()[0],
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

router.get('/site', authAdmin, (req, res) => {
  const f = moduleSitesSql(req.operator, MODULE);
  const site = db.prepare(`SELECT * FROM sites WHERE ${f.sql} ORDER BY created_at ASC LIMIT 1`).get(...f.params);
  if (!site) return res.status(404).json({ error: 'Empty Bottle site not configured' });
  const server = db.prepare(
    'SELECT * FROM hotspot_servers WHERE site_id = ? ORDER BY created_at ASC LIMIT 1'
  ).get(site.id);
  res.json({ site: publicSite(site), network: server || null });
});

router.put('/site', authAdmin, requireRole('admin', 'operator'), (req, res) => {
  const site = getOwnedSite(req.operator, req.body.id, MODULE);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  const allowed = [
    'name', 'address', 'portal_title', 'mikrotik_host', 'mikrotik_user',
    'mikrotik_pass', 'vlan_id', 'minutes_per_coin', 'coin_value', 'notes'
  ];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(req.body[key]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(site.id);
  db.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ site: publicSite(db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id)) });
});

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

router.get('/sales', authAdmin, (req, res) => {
  const f = siteIdsSubquery(req.operator, MODULE);
  const sales = db.prepare(`
    SELECT c.*, s.name as site_name, d.name as device_name
    FROM coin_logs c
    JOIN sites s ON s.id = c.site_id
    LEFT JOIN devices d ON d.id = c.device_id
    WHERE ${f.sql}
    ORDER BY c.created_at DESC
    LIMIT 200
  `).all(...f.params);
  res.json({ sales });
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

router.get('/network/script', authAdmin, (req, res) => {
  const f = moduleSitesSql(req.operator, MODULE);
  const site = db.prepare(`SELECT * FROM sites WHERE ${f.sql} LIMIT 1`).get(...f.params);
  const vlan = site?.vlan_id || 103;
  const gw = '10.0.3.1';
  const script = `; Empty Bottle Vendo — VLAN${vlan} machine network
/interface bridge add name=bridge-empty-bottle comment="Empty Bottle LAN"
/interface vlan add name=VLAN${vlan} vlan-id=${vlan} interface=bridge-local comment="Empty Bottle VLAN"
/interface bridge port add bridge=bridge-empty-bottle interface=VLAN${vlan}
/ip pool add name=pool-empty-bottle ranges=10.0.3.10-10.0.3.254
/ip address add address=${gw}/24 interface=bridge-empty-bottle comment="Empty Bottle Gateway"
/ip dhcp-server add name=dhcp-empty-bottle interface=bridge-empty-bottle address-pool=pool-empty-bottle lease-time=1h
/ip dhcp-server network add address=10.0.3.0/24 gateway=${gw} dns-server=${gw}
/ip firewall nat add chain=srcnat src-address=10.0.3.0/24 action=masquerade comment="Empty Bottle NAT"
:put "Empty Bottle VLAN${vlan} ready — gateway ${gw}"`;
  res.json({ script, vlan_id: vlan, gateway: gw });
});

module.exports = router;
