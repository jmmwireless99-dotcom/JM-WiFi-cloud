const express = require('express');
const db = require('../db');

const router = express.Router();

// ALL VENDO overview — dashboard stats for monitoring portal
router.get('/overview', (req, res) => {
  const sites = db.prepare('SELECT * FROM sites').all();

  const siteStats = sites.map(site => {
    const devices = db.prepare(
      'SELECT COUNT(*) as total FROM devices WHERE site_id = ?'
    ).get(site.id);
    const online = db.prepare(
      "SELECT COUNT(*) as c FROM devices WHERE site_id = ? AND status = 'online'"
    ).get(site.id);
    const activeSessions = db.prepare(
      "SELECT COUNT(*) as c FROM sessions WHERE site_id = ? AND status = 'active' AND expires_at > datetime('now')"
    ).get(site.id);
    const coinsToday = db.prepare(
      "SELECT COALESCE(SUM(coins), 0) as c FROM coin_logs WHERE site_id = ? AND date(created_at) = date('now')"
    ).get(site.id);

    return {
      id: site.id,
      name: site.name,
      vlan_id: site.vlan_id || 10,
      devices: devices.total,
      online_devices: online.c,
      active_sessions: activeSessions.c,
      coins_today: coinsToday.c,
      rate_per_hour: site.rate_per_hour,
      minutes_per_coin: site.minutes_per_coin,
      mikrotik_host: site.mikrotik_host
    };
  });

  const totalCoins = db.prepare(
    "SELECT COALESCE(SUM(coins), 0) as c FROM coin_logs WHERE date(created_at) = date('now')"
  ).get();
  const totalMinutes = db.prepare(
    "SELECT COALESCE(SUM(minutes_granted), 0) as m FROM coin_logs WHERE date(created_at) = date('now')"
  ).get();
  const sessionsToday = db.prepare(
    "SELECT COUNT(*) as c FROM sessions WHERE date(started_at) = date('now')"
  ).get();
  const activeDevices = db.prepare(
    "SELECT COUNT(*) as c FROM devices WHERE status = 'online'"
  ).get();

  const recentCoins = db.prepare(`
    SELECT cl.*, s.name as site_name, s.vlan_id
    FROM coin_logs cl
    LEFT JOIN sites s ON s.id = cl.site_id
    ORDER BY cl.created_at DESC
    LIMIT 20
  `).all();

  const ratePerCoin = sites.length ? sites[0].minutes_per_coin : 5;
  const revenueToday = (totalCoins.c * ratePerCoin / 60) * (sites[0]?.rate_per_hour || 10);

  res.json({
    total_revenue_today: Math.round(revenueToday),
    active_devices: activeDevices.c,
    wifi: {
      coins_today: totalCoins.c,
      minutes_today: totalMinutes.m,
      sessions_today: sessionsToday.c,
      revenue_today: Math.round(revenueToday),
      sites_count: sites.length,
      vlans_count: sites.length
    },
    sites: siteStats,
    recent_coins: recentCoins
  });
});

// VLAN / Site detail
router.get('/vlan/:siteId', (req, res) => {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.siteId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const devices = db.prepare(
    'SELECT id, device_type, mac_address, name, status, last_seen FROM devices WHERE site_id = ?'
  ).all(site.id);

  const sessions = db.prepare(
    "SELECT mac_address, username, minutes_granted, expires_at, status FROM sessions WHERE site_id = ? AND status = 'active' AND expires_at > datetime('now') ORDER BY started_at DESC"
  ).all(site.id);

  const activeSessions = sessions.length;
  const coinsToday = db.prepare(
    "SELECT COALESCE(SUM(coins), 0) as c FROM coin_logs WHERE site_id = ? AND date(created_at) = date('now')"
  ).get(site.id);

  res.json({
    site: {
      id: site.id,
      name: site.name,
      vlan_id: site.vlan_id || 10,
      rate_per_hour: site.rate_per_hour,
      minutes_per_coin: site.minutes_per_coin,
      mikrotik_host: site.mikrotik_host
    },
    devices,
    sessions,
    active_sessions: activeSessions,
    coins_today: coinsToday.c
  });
});

module.exports = router;
