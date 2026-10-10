/**
 * VPS / host metrics for admin Dashboard cards.
 * GET /api/system/stats  (admin JWT via requireAuth + requireAdmin)
 */
import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { collectSystemStats } from '../services/systemStats.js';

const r = Router();

r.get('/stats', requireAdmin, async (_req, res) => {
  try {
    const stats = await collectSystemStats();
    res.json(stats);
  } catch (e) {
    console.error('system/stats failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Alias matching /api/vps/metrics hint */
r.get('/metrics', requireAdmin, async (_req, res) => {
  try {
    const stats = await collectSystemStats();
    res.json(stats);
  } catch (e) {
    console.error('system/metrics failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default r;
