/**
 * Public WiFi hotspot PayMongo QR API (captive portal — no auth).
 * Used by Social Park login.html Buy Unli Internet flow.
 */
import { Router } from 'express';
import { pool } from '../db.js';
import {
  publicPackages,
  resolveWifiSite,
  createWifiPaySession,
  syncWifiPaySessionPayment,
  sessionPublicView,
} from '../services/wifiPay.js';

const r = Router();

const createHits = new Map();

function rateLimitCreate(ip) {
  const now = Date.now();
  const cur = createHits.get(ip) || { n: 0, t: now };
  if (now - cur.t > 60_000) {
    cur.n = 0;
    cur.t = now;
  }
  cur.n += 1;
  createHits.set(ip, cur);
  return cur.n <= 30;
}

function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

r.use(cors);

/** GET /api/wifi-pay/packages?site=social */
r.get('/packages', async (req, res) => {
  try {
    const siteKey = req.query.site || req.query.siteKey || 'social';
    const site = await resolveWifiSite(siteKey);
    if (!site) return res.status(404).json({ error: 'site not found' });
    res.json({
      siteId: site.id,
      siteName: site.name,
      packages: publicPackages(),
      currency: 'PHP',
      note: 'Scan GCash / Maya QR after choosing a package. WiFi-only OK via walled garden (no cellular data needed).',
    });
  } catch (e) {
    console.error('wifi-pay packages:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/wifi-pay/sessions */
r.post('/sessions', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || 'x';
    if (!rateLimitCreate(ip)) {
      return res.status(429).json({ error: 'Too many requests — try again in a minute' });
    }
    const body = req.body || {};
    const session = await createWifiPaySession({
      siteKey: body.siteKey || body.site || body.siteId || 'social',
      packageId: body.packageId || body.package,
      mac: body.mac,
      linkLogin: body.linkLogin || body.link_login,
      linkOrig: body.linkOrig || body.link_orig || body.dst,
      clientIp: ip,
    });
    res.status(201).json(sessionPublicView(session));
  } catch (e) {
    console.error('wifi-pay create:', e.message);
    res.status(e.status || 500).json({
      error: e.message,
      sessionId: e.sessionId || null,
    });
  }
});

/** GET /api/wifi-pay/sessions/:id — poll until ready, then auto-login fields appear */
r.get('/sessions/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const { rows } = await pool.query(`SELECT * FROM wifi_pay_sessions WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });

    let session = rows[0];
    if (['awaiting_payment', 'pending', 'paid'].includes(session.status)) {
      try {
        session = await syncWifiPaySessionPayment(session);
      } catch (e) {
        console.warn('wifi-pay poll sync:', e.message);
      }
    }

    const includeSecrets = session.status === 'ready';
    res.json(sessionPublicView(session, { includeSecrets }));
  } catch (e) {
    console.error('wifi-pay get:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Proxied QR PNG so captive portal only needs cloud in walled garden */
r.get('/sessions/:id/qr.png', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT qr_image_url FROM wifi_pay_sessions WHERE id = $1`,
      [id]
    );
    const raw = rows[0]?.qr_image_url || '';
    if (!raw) return res.status(404).json({ error: 'no qr' });

    // Proxy remote QR URLs (never redirect) so captive clients only need our cloud.
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const upstream = await fetch(raw, { redirect: 'follow' });
      if (!upstream.ok) {
        return res.status(502).json({ error: `qr upstream ${upstream.status}` });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const ct = upstream.headers.get('content-type') || 'image/png';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'private, max-age=120');
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.end(buf);
    }
    const m = String(raw).match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!m) return res.status(415).json({ error: 'unsupported qr' });
    const buf = Buffer.from(m[2], 'base64');
    res.setHeader('Content-Type', `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}`);
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end(buf);
  } catch (e) {
    console.error('wifi-pay qr:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default r;
