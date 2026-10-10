/**
 * VPN Server panel + VPS metrics.
 * GET /api/server/status | /sessions | /audit | /stats
 * POST /api/server/sync | /restart | /sessions/:user/kick
 */
import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pool, audit } from '../db.js';
import { requireAdmin } from '../auth.js';
import {
  sync,
  terminateSession,
  getActiveSessions,
  getStreamStates,
} from '../services/provisioner.js';
import { collectSystemStats } from '../services/systemStats.js';

const exec = promisify(execFile);
const r = Router();
r.use(requireAdmin);

const DRY = process.env.DRY_RUN === '1';

async function svcActive(name) {
  try {
    const { stdout } = await exec('systemctl', ['is-active', name], {
      timeout: 2000,
      killSignal: 'SIGKILL',
    });
    return (stdout || '').trim() || 'unknown';
  } catch (e) {
    const out = (e.stdout || e.message || '').toString().trim();
    return out.split('\n')[0] || 'inactive';
  }
}

/** Live VPS metrics (same payload as /api/system/stats) */
r.get('/stats', async (_req, res) => {
  try {
    res.json(await collectSystemStats());
  } catch (e) {
    console.error('server/stats failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.get('/status', async (_req, res) => {
  try {
    const [online, streams, vpnCounts, sys, accel, mtx, nft, pg] = await Promise.all([
      getActiveSessions(),
      getStreamStates(),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'disabled')::int AS disabled,
          COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW())::int AS expired
        FROM stations
      `).catch(() => ({ rows: [{}] })),
      collectSystemStats(),
      svcActive('accel-ppp'),
      svcActive('mediamtx'),
      svcActive('nftables'),
      svcActive('postgresql'),
    ]);

    const activePulls = Object.values(streams || {}).filter((s) => s?.ready).length;
    const row = vpnCounts.rows[0] || {};

    res.json({
      dryRun: DRY,
      vpn: {
        onlineSessions: online?.size || 0,
        active: row.active || 0,
        disabled: row.disabled || 0,
        expired: row.expired || 0,
      },
      streams: { activePulls },
      system: {
        hostname: sys.hostname,
        uptimeSec: sys.uptimeSec,
        loadavg: sys.cpu.loadavg,
        memUsedPct: sys.ram.usedPct,
        cpuPct: sys.cpu.pct,
        ramUsedGb: sys.ram.usedGb,
        ramTotalGb: sys.ram.totalGb,
        net: sys.net,
      },
      services: {
        'accel-ppp': accel,
        mediamtx: mtx,
        nftables: nft,
        postgresql: pg,
      },
    });
  } catch (e) {
    console.error('server/status failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.get('/sessions', async (_req, res) => {
  try {
    const online = await getActiveSessions();
    const names = [...(online?.keys?.() || [])];
    let nameMap = {};
    if (names.length) {
      const { rows } = await pool.query(
        'SELECT username, name FROM stations WHERE username = ANY($1)',
        [names]
      ).catch(() => ({ rows: [] }));
      nameMap = Object.fromEntries(rows.map((x) => [x.username, x.name]));
    }
    const list = names.map((username) => {
      const s = online.get(username) || {};
      return {
        username,
        station: nameMap[username] || username,
        ip: s.ip || '',
        uptime: s.uptime || '',
      };
    });
    res.json(list);
  } catch (e) {
    console.error('server/sessions failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const { rows } = await pool.query(
      `SELECT id, actor, action, detail, created_at AS at
         FROM audit_log ORDER BY id DESC LIMIT $1`,
      [limit]
    ).catch(() => ({ rows: [] }));
    res.json(
      rows.map((x) => ({
        id: x.id,
        actor: x.actor,
        action: x.action,
        detail: typeof x.detail === 'string' ? JSON.parse(x.detail || '{}') : (x.detail || {}),
        at: x.at,
      }))
    );
  } catch (e) {
    console.error('server/audit failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.post('/sync', async (req, res) => {
  try {
    await sync(req.user?.sub || 'admin', 'manual');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.post('/restart', async (req, res) => {
  const service = String(req.body?.service || '').trim();
  const allowed = new Set(['accel-ppp', 'mediamtx', 'nftables', 'mrp-backend']);
  if (!allowed.has(service)) return res.status(400).json({ error: 'invalid service' });
  if (DRY) {
    await audit(req.user?.sub || 'admin', 'server.restart', { service, dryRun: true });
    return res.json({ ok: true, dryRun: true });
  }
  try {
    await exec('systemctl', ['restart', service], { timeout: 30000, killSignal: 'SIGKILL' });
    await audit(req.user?.sub || 'admin', 'server.restart', { service });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.post('/sessions/:username/kick', async (req, res) => {
  try {
    const username = req.params.username;
    await terminateSession(username);
    await audit(req.user?.sub || 'admin', 'session.kick', { username });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default r;
