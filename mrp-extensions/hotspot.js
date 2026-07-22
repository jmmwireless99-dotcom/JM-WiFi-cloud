import { Router } from 'express';
import { pool, audit } from '../db.js';
import { requireAdmin } from '../auth.js';

const r = Router();
r.use(requireAdmin);

function siteView(row) {
  return {
    id: row.id,
    name: row.name,
    stationId: row.station_id || null,
    stationName: row.station_name || null,
    bridgeInterface: row.bridge_interface || 'bridge-local',
    mikrotikHost: row.mikrotik_host || '',
    apiUser: row.api_user || 'admin',
    apiPasswordConfigured: !!(row.api_password && String(row.api_password).length),
    notes: row.notes || '',
    status: row.status || 'active',
    serverCount: Number(row.server_count || 0),
    created: row.created_at,
  };
}

function serverView(row) {
  const idle = Number(row.idle_timeout_sec || 600);
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name || '',
    name: row.name,
    vlanId: row.vlan_id,
    parentInterface: row.parent_interface,
    serverProfile: row.server_profile || 'default',
    idleTimeoutSec: idle,
    idleTimeout: formatIdle(idle),
    address: row.address,
    ipStart: row.ip_start,
    ipEnd: row.ip_end,
    masquerade: !!row.masquerade,
    antiSharing: !!row.anti_sharing,
    status: row.status || 'active',
    created: row.created_at,
  };
}

function formatIdle(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${d}d ${h}h ${m}m ${ss}s`;
}

function parseIdle({ idleDays, idleHours, idleMinutes, idleSeconds, idleTimeoutSec }) {
  if (idleTimeoutSec != null && Number.isFinite(Number(idleTimeoutSec))) {
    return Math.max(0, Math.floor(Number(idleTimeoutSec)));
  }
  const d = Number(idleDays) || 0;
  const h = Number(idleHours) || 0;
  const m = Number(idleMinutes) || 0;
  const s = Number(idleSeconds) || 0;
  return d * 86400 + h * 3600 + m * 60 + s;
}

function routerosForServer(site, srv) {
  const ifName = srv.name || `vlan-${srv.vlan_id}`;
  const poolName = `pool-${ifName}`;
  const dhcpName = `dhcp-${ifName}`;
  const gw = srv.address.split('/')[0];
  const net = srv.address;
  return [
    `/interface vlan add name=${ifName} vlan-id=${srv.vlan_id} interface=${srv.parent_interface} comment="JM Cloud Hotspot ${site.name}"`,
    `/ip pool add name=${poolName} ranges=${srv.ip_start}-${srv.ip_end}`,
    `/ip address add address=${srv.address} interface=${ifName} comment="${ifName} gateway"`,
    `/ip dhcp-server add name=${dhcpName} interface=${ifName} address-pool=${poolName} lease-time=1h`,
    `/ip dhcp-server network add address=${net} gateway=${gw} dns-server=${gw}`,
    `/ip hotspot add name=${ifName} interface=${ifName} address-pool=${poolName} profile=${srv.server_profile} idle-timeout=${formatIdle(srv.idle_timeout_sec)}`,
    srv.masquerade ? '/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade comment="JM Hotspot NAT"' : '',
  ].filter(Boolean).join('\n');
}

/** Overview stats for ALL VENDO dashboard */
r.get('/overview', async (_req, res) => {
  try {
    const sites = await pool.query(`SELECT COUNT(*)::int AS c FROM wifi_mikrotik_sites WHERE status = 'active'`);
    const servers = await pool.query(`SELECT COUNT(*)::int AS c FROM wifi_hotspot_servers WHERE status = 'active'`);
    const coins = await pool.query(
      `SELECT COALESCE(SUM(coins),0)::int AS c, COALESCE(SUM(minutes_granted),0)::int AS m
         FROM wifi_coin_logs WHERE created_at::date = CURRENT_DATE`
    ).catch(() => ({ rows: [{ c: 0, m: 0 }] }));
    const sessions = await pool.query(
      `SELECT COUNT(*)::int AS c FROM wifi_sessions WHERE started_at::date = CURRENT_DATE`
    ).catch(() => ({ rows: [{ c: 0 }] }));
    const siteRows = await pool.query(
      `SELECT s.*, st.name AS station_name,
              (SELECT COUNT(*)::int FROM wifi_hotspot_servers hs WHERE hs.site_id = s.id) AS server_count
         FROM wifi_mikrotik_sites s
         LEFT JOIN stations st ON st.id = s.station_id
        ORDER BY s.name`
    );
    const recent = await pool.query(
      `SELECT cl.*, ms.name AS site_name
         FROM wifi_coin_logs cl
         LEFT JOIN wifi_mikrotik_sites ms ON ms.id = cl.site_id
        ORDER BY cl.id DESC LIMIT 20`
    ).catch(() => ({ rows: [] }));

    res.json({
      total_revenue_today: 0,
      active_devices: 0,
      wifi: {
        coins_today: coins.rows[0]?.c || 0,
        minutes_today: coins.rows[0]?.m || 0,
        sessions_today: sessions.rows[0]?.c || 0,
        revenue_today: 0,
        sites_count: sites.rows[0]?.c || 0,
        servers_count: servers.rows[0]?.c || 0,
      },
      sites: siteRows.rows.map(siteView),
      recent_coins: recent.rows,
    });
  } catch (e) {
    console.error('hotspot overview:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** MikroTik sites (router / bridge parent) */
r.get('/sites', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, st.name AS station_name,
            (SELECT COUNT(*)::int FROM wifi_hotspot_servers hs WHERE hs.site_id = s.id) AS server_count
       FROM wifi_mikrotik_sites s
       LEFT JOIN stations st ON st.id = s.station_id
      ORDER BY s.name`
  );
  res.json({ sites: rows.map(siteView) });
});

r.post('/sites', async (req, res) => {
  try {
    const {
      name, stationId, bridgeInterface, mikrotikHost, apiUser, apiPassword, notes,
    } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    let host = (mikrotikHost || '').trim();
    let user = (apiUser || 'admin').trim();
    let pass = apiPassword || '';

    if (stationId) {
      const { rows } = await pool.query(`SELECT * FROM stations WHERE id = $1`, [stationId]);
      const st = rows[0];
      if (!st) return res.status(400).json({ error: 'station not found' });
      if (!host) host = st.vpn_ip;
      if (!pass && st.api_password) pass = st.api_password;
      if (st.api_user) user = st.api_user;
    }
    if (!host) return res.status(400).json({ error: 'mikrotikHost required (or link VPN station)' });

    const { rows } = await pool.query(
      `INSERT INTO wifi_mikrotik_sites
         (name, station_id, bridge_interface, mikrotik_host, api_user, api_password, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        name.trim(),
        stationId || null,
        (bridgeInterface || 'bridge-local').trim(),
        host,
        user,
        pass,
        (notes || '').trim(),
      ]
    );
    await audit(req.user?.sub || 'admin', 'hotspot.site.create', { id: rows[0].id, name });
    res.status(201).json(siteView(rows[0]));
  } catch (e) {
    console.error('hotspot site create:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.patch('/sites/:id', async (req, res) => {
  const id = Number(req.params.id);
  const fields = [];
  const params = [id];
  const map = {
    name: 'name', stationId: 'station_id', bridgeInterface: 'bridge_interface',
    mikrotikHost: 'mikrotik_host', apiUser: 'api_user', apiPassword: 'api_password',
    notes: 'notes', status: 'status',
  };
  for (const [k, col] of Object.entries(map)) {
    if (req.body?.[k] !== undefined) {
      params.push(req.body[k]);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  fields.push('updated_at = now()');
  const { rows } = await pool.query(
    `UPDATE wifi_mikrotik_sites SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(siteView(rows[0]));
});

r.delete('/sites/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query(`DELETE FROM wifi_mikrotik_sites WHERE id = $1`, [id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

/** Hotspot servers (VLAN per vendo) — KiTifi-style */
r.get('/servers', async (req, res) => {
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const params = [];
  let where = '';
  if (siteId) {
    params.push(siteId);
    where = ` WHERE hs.site_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT hs.*, ms.name AS site_name
       FROM wifi_hotspot_servers hs
       JOIN wifi_mikrotik_sites ms ON ms.id = hs.site_id
      ${where}
      ORDER BY hs.vlan_id, hs.name`,
    params
  );
  res.json({ servers: rows.map(serverView) });
});

r.post('/servers', async (req, res) => {
  try {
    const b = req.body || {};
    const siteId = Number(b.siteId);
    const vlanId = Number(b.vlanId);
    if (!siteId || !b.name?.trim()) return res.status(400).json({ error: 'siteId and name required' });
    if (!Number.isFinite(vlanId) || vlanId < 1 || vlanId > 4094) {
      return res.status(400).json({ error: 'vlanId 1–4094 required' });
    }
    if (!b.parentInterface?.trim()) return res.status(400).json({ error: 'parentInterface required' });
    if (!b.address?.trim() || !b.ipStart?.trim() || !b.ipEnd?.trim()) {
      return res.status(400).json({ error: 'address, ipStart, ipEnd required' });
    }

    const { rows: sites } = await pool.query(`SELECT * FROM wifi_mikrotik_sites WHERE id = $1`, [siteId]);
    if (!sites[0]) return res.status(400).json({ error: 'site not found' });

    const idleSec = parseIdle(b);
    const { rows } = await pool.query(
      `INSERT INTO wifi_hotspot_servers
         (site_id, name, vlan_id, parent_interface, server_profile, idle_timeout_sec,
          address, ip_start, ip_end, masquerade, anti_sharing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        siteId,
        b.name.trim(),
        vlanId,
        b.parentInterface.trim(),
        (b.serverProfile || 'default').trim(),
        idleSec || 600,
        b.address.trim(),
        b.ipStart.trim(),
        b.ipEnd.trim(),
        b.masquerade !== false,
        b.antiSharing !== false,
      ]
    );
    const script = routerosForServer(sites[0], rows[0]);
    await audit(req.user?.sub || 'admin', 'hotspot.server.create', { id: rows[0].id, name: rows[0].name, vlanId });
    res.status(201).json({ ...serverView(rows[0]), routerosScript: script });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'VLAN or name already exists on this site' });
    console.error('hotspot server create:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.patch('/servers/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const fields = [];
  const params = [id];
  const map = {
    name: 'name', vlanId: 'vlan_id', parentInterface: 'parent_interface',
    serverProfile: 'server_profile', address: 'address', ipStart: 'ip_start',
    ipEnd: 'ip_end', masquerade: 'masquerade', antiSharing: 'anti_sharing', status: 'status',
  };
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) {
      params.push(b[k]);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (b.idleDays !== undefined || b.idleHours !== undefined || b.idleMinutes !== undefined || b.idleSeconds !== undefined || b.idleTimeoutSec !== undefined) {
    params.push(parseIdle(b));
    fields.push(`idle_timeout_sec = $${params.length}`);
  }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  fields.push('updated_at = now()');
  const { rows } = await pool.query(
    `UPDATE wifi_hotspot_servers SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(serverView(rows[0]));
});

r.delete('/servers/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query(`DELETE FROM wifi_hotspot_servers WHERE id = $1`, [id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

r.get('/servers/:id/script', async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT hs.*, ms.*
       FROM wifi_hotspot_servers hs
       JOIN wifi_mikrotik_sites ms ON ms.id = hs.site_id
      WHERE hs.id = $1`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ script: routerosForServer(rows[0], rows[0]) });
});

export default r;
