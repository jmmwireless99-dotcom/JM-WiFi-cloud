const db = require('../db');

function siteFilter(operator, siteId) {
  if (operator.role === 'admin') {
    return siteId ? { sql: 'site_id = ?', params: [siteId] } : { sql: '1=1', params: [] };
  }
  if (siteId) {
    return {
      sql: 'site_id = ? AND site_id IN (SELECT id FROM sites WHERE operator_id = ?)',
      params: [siteId, operator.id]
    };
  }
  return {
    sql: 'site_id IN (SELECT id FROM sites WHERE operator_id = ?)',
    params: [operator.id]
  };
}

function getDashboardStats(operator, siteId = null) {
  const f = siteFilter(operator, siteId);

  const vendos = db.prepare(`
    SELECT COUNT(*) as c FROM sites
    WHERE ${operator.role === 'admin' ? (siteId ? 'id = ?' : '1=1') : 'operator_id = ?' + (siteId ? ' AND id = ?' : '')}
  `).get(
    ...(operator.role === 'admin'
      ? (siteId ? [siteId] : [])
      : (siteId ? [operator.id, siteId] : [operator.id]))
  );

  const devicesOnline = db.prepare(`
    SELECT COUNT(*) as c FROM devices
    WHERE status = 'online' AND ${f.sql}
  `).get(...f.params);

  const devicesTotal = db.prepare(`
    SELECT COUNT(*) as c FROM devices WHERE ${f.sql}
  `).get(...f.params);

  const activeSessions = db.prepare(`
    SELECT COUNT(*) as c FROM sessions
    WHERE status = 'active' AND expires_at > datetime('now') AND ${f.sql}
  `).get(...f.params);

  const todaySales = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount, COALESCE(SUM(coins), 0) as coins, COUNT(*) as txns
    FROM coin_logs
    WHERE date(created_at) = date('now') AND ${f.sql}
  `).get(...f.params);

  const weekSales = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount, COALESCE(SUM(coins), 0) as coins, COUNT(*) as txns
    FROM coin_logs
    WHERE created_at >= datetime('now', '-7 days') AND ${f.sql}
  `).get(...f.params);

  const monthSales = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount, COALESCE(SUM(coins), 0) as coins, COUNT(*) as txns
    FROM coin_logs
    WHERE created_at >= datetime('now', 'start of month') AND ${f.sql}
  `).get(...f.params);

  const yearSales = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount, COALESCE(SUM(coins), 0) as coins, COUNT(*) as txns
    FROM coin_logs
    WHERE created_at >= datetime('now', 'start of year') AND ${f.sql}
  `).get(...f.params);

  const unusedVouchers = db.prepare(`
    SELECT COUNT(*) as c FROM vouchers WHERE used = 0 AND ${f.sql}
  `).get(...f.params);

  const totalUsers = db.prepare(`
    SELECT COUNT(*) as c FROM sessions WHERE ${f.sql}
  `).get(...f.params);

  const pausedSessions = db.prepare(`
    SELECT COUNT(*) as c FROM sessions
    WHERE status = 'paused' AND ${f.sql}
  `).get(...f.params);

  return {
    vendos: vendos.c,
    devices_online: devicesOnline.c,
    devices_total: devicesTotal.c,
    active_sessions: activeSessions.c,
    paused_sessions: pausedSessions.c,
    total_users: totalUsers.c,
    unused_vouchers: unusedVouchers.c,
    sales: {
      today: todaySales,
      week: weekSales,
      month: monthSales,
      year: yearSales
    }
  };
}

function getSalesReport(operator, { siteId = null, period = 'daily', days = 30 } = {}) {
  const f = siteFilter(operator, siteId);
  const groupExpr =
    period === 'monthly'
      ? "strftime('%Y-%m', created_at)"
      : period === 'weekly'
        ? "strftime('%Y-W%W', created_at)"
        : "date(created_at)";

  const rows = db.prepare(`
    SELECT
      ${groupExpr} as period,
      COALESCE(SUM(amount), 0) as amount,
      COALESCE(SUM(coins), 0) as coins,
      COALESCE(SUM(minutes_granted), 0) as minutes,
      COUNT(*) as transactions
    FROM coin_logs
    WHERE created_at >= datetime('now', ?) AND ${f.sql}
    GROUP BY ${groupExpr}
    ORDER BY period ASC
  `).all(`-${days} days`, ...f.params);

  const byVendo = db.prepare(`
    SELECT
      s.id as site_id,
      s.name as site_name,
      COALESCE(SUM(c.amount), 0) as amount,
      COALESCE(SUM(c.coins), 0) as coins,
      COUNT(c.id) as transactions
    FROM sites s
    LEFT JOIN coin_logs c ON c.site_id = s.id
      AND c.created_at >= datetime('now', ?)
    WHERE ${
      operator.role === 'admin'
        ? (siteId ? 's.id = ?' : '1=1')
        : 's.operator_id = ?' + (siteId ? ' AND s.id = ?' : '')
    }
    GROUP BY s.id
    ORDER BY amount DESC
  `).all(
    `-${days} days`,
    ...(operator.role === 'admin'
      ? (siteId ? [siteId] : [])
      : (siteId ? [operator.id, siteId] : [operator.id]))
  );

  return { period, days, series: rows, by_vendo: byVendo };
}

module.exports = { getDashboardStats, getSalesReport, siteFilter };
