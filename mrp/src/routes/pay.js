/**
 * Public client pay API — phone browser picks amount → QRPH on phone.
 * No device API key in the browser; device must be active.
 */
import { Router } from 'express';
import { pool, audit } from '../db.js';
import {
  createQrphCheckout,
  createGcashRedirectCheckout,
  getPricePerLiter,
  getDevicePricePerLiter,
  syncVendoSessionPayment,
} from '../services/paymongo.js';
import { BASE_PATH, HUB } from '../config.js';

const r = Router();

const createHits = new Map(); // ip -> { n, t }

function rateLimitCreate(ip) {
  const now = Date.now();
  const cur = createHits.get(ip) || { n: 0, t: now };
  if (now - cur.t > 60_000) {
    cur.n = 0;
    cur.t = now;
  }
  cur.n += 1;
  createHits.set(ip, cur);
  return cur.n <= 20; // 20 sessions / min / IP
}

function publicPayBase() {
  const host = HUB() || 'jmtechsolution.cloud';
  const base = BASE_PATH() || '';
  return `https://${host}${base}/api/pay`;
}

async function loadActiveDevice(deviceId) {
  const id = String(deviceId || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,32}$/.test(id)) return null;
  const { rows } = await pool.query(
    `SELECT * FROM gasoline_devices WHERE device_id = $1 AND status = 'active'`,
    [id]
  );
  return rows[0] || null;
}

function clientQrUrl(deviceId, sessionId) {
  return `${publicPayBase()}/${encodeURIComponent(deviceId)}/sessions/${sessionId}/qr.png`;
}

r.get('/:deviceId/config', async (req, res) => {
  try {
    const device = await loadActiveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found or inactive' });
    const pricePerLiter = await getDevicePricePerLiter(device);
    res.json({
      deviceId: device.device_id,
      name: device.name,
      pricePerLiter,
      pulsesPerLiter: Number(device.pulses_per_liter) > 0 ? Number(device.pulses_per_liter) : null,
      currency: 'PHP',
      minAmountPesos: 20,
      maxAmountPesos: 10000,
      payPagePath: `${BASE_PATH() || ''}/pay/${device.device_id}`,
    });
  } catch (e) {
    console.error('pay config:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.post('/:deviceId/sessions', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || 'x';
    if (!rateLimitCreate(ip)) {
      return res.status(429).json({ error: 'Too many requests — try again in a minute' });
    }

    const device = await loadActiveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found or inactive' });

    const price = await getDevicePricePerLiter(device);
    let amountPesos = Number(req.body?.amountPesos ?? req.body?.amount);
    let liters = Number(req.body?.liters);
    if (Number.isFinite(amountPesos) && amountPesos > 0) {
      liters = Math.round((amountPesos / price) * 1000) / 1000;
    } else if (Number.isFinite(liters) && liters > 0) {
      amountPesos = Math.round(liters * price * 100) / 100;
    } else {
      return res.status(400).json({ error: 'provide amountPesos or liters' });
    }
    if (amountPesos < 20) return res.status(400).json({ error: 'minimum ₱20' });
    if (amountPesos > 10000) return res.status(400).json({ error: 'maximum ₱10000' });

    const amountCentavos = Math.round(amountPesos * 100);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min for phone

    const { rows } = await pool.query(
      `INSERT INTO vendo_sessions
         (device_db_id, device_id, device_name, amount_pesos, amount_centavos,
          liters, price_per_liter, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)
       RETURNING *`,
      [
        device.id, device.device_id, device.name,
        amountPesos, amountCentavos, liters, price, expiresAt,
      ]
    );
    let session = rows[0];

    try {
      const checkout = await createQrphCheckout({
        amountCentavos,
        description: `${device.name} · ${liters}L (phone)`,
        metadata: {
          vendo_session_id: String(session.id),
          device_id: device.device_id,
          channel: 'phone_client',
        },
      });

      const upd = await pool.query(
        `UPDATE vendo_sessions SET
            status = 'awaiting_payment',
            paymongo_intent_id = $2,
            paymongo_method_id = $3,
            qr_image_url = $4,
            client_key = $5,
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        [
          session.id,
          checkout.intentId,
          checkout.methodId,
          checkout.qrImageUrl,
          checkout.clientKey || '',
        ]
      );
      session = upd.rows[0];
    } catch (e) {
      await pool.query(
        `UPDATE vendo_sessions SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
        [session.id, e.message]
      );
      return res.status(e.status || 502).json({ error: e.message, sessionId: session.id });
    }

    await audit(device.device_id, 'pay.client.session', {
      id: session.id, amountPesos, liters, ip,
    });

    res.status(201).json({
      id: session.id,
      deviceId: session.device_id,
      amountPesos: Number(session.amount_pesos),
      liters: Number(session.liters),
      pricePerLiter: Number(session.price_per_liter),
      status: session.status,
      qrImageUrl: clientQrUrl(device.device_id, session.id),
      expiresAt: session.expires_at,
    });
  } catch (e) {
    console.error('pay session:', e.message);
    res.status(500).json({ error: e.message });
  }
});

r.get('/:deviceId/sessions/:id', async (req, res) => {
  try {
    const device = await loadActiveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { rows } = await pool.query(
      `SELECT * FROM vendo_sessions WHERE id = $1 AND device_id = $2`,
      [req.params.id, device.device_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });

    let s = rows[0];
    if (
      ['awaiting_payment', 'pending'].includes(s.status) &&
      s.expires_at && new Date(s.expires_at) < new Date()
    ) {
      await pool.query(
        `UPDATE vendo_sessions SET status='expired', updated_at=now() WHERE id=$1`,
        [s.id]
      );
      s = { ...s, status: 'expired' };
    }

    // Don't wait for slow PayMongo webhook — pull intent status on each poll
    if (['awaiting_payment', 'pending', 'paid'].includes(s.status) && s.paymongo_intent_id) {
      try {
        s = await syncVendoSessionPayment(s);
      } catch (e) {
        console.warn('pay session sync:', e.message);
      }
    }

    res.json({
      id: s.id,
      status: s.status,
      amountPesos: Number(s.amount_pesos),
      liters: Number(s.liters),
      pricePerLiter: Number(s.price_per_liter),
      qrImageUrl: s.qr_image_url
        ? clientQrUrl(device.device_id, s.id)
        : null,
      paidAt: s.paid_at,
      expiresAt: s.expires_at,
      error: s.error || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Open GCash app (redirect + deep link). Creates a GCash Payment Intent
 * linked to the same vendo session via metadata for webhook matching.
 */
r.post('/:deviceId/sessions/:id/gcash', async (req, res) => {
  try {
    const device = await loadActiveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { rows } = await pool.query(
      `SELECT * FROM vendo_sessions WHERE id = $1 AND device_id = $2`,
      [req.params.id, device.device_id]
    );
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!['awaiting_payment', 'pending'].includes(s.status)) {
      return res.status(409).json({ error: `session is ${s.status}` });
    }

    const host = HUB() || 'jmtechsolution.cloud';
    const base = BASE_PATH() || '';
    const returnUrl = `https://${host}${base}/pay/${device.device_id}?paid=1&sid=${s.id}`;

    const checkout = await createGcashRedirectCheckout({
      amountCentavos: Number(s.amount_centavos),
      description: `${device.name} · ${s.liters}L (GCash)`,
      returnUrl,
      metadata: {
        vendo_session_id: String(s.id),
        device_id: device.device_id,
        channel: 'phone_gcash',
      },
    });

    // Store GCash intent so webhook + active sync match (was stuck on QRPH intent)
    await pool.query(
      `UPDATE vendo_sessions
          SET paymongo_intent_id = $2, updated_at = now()
        WHERE id = $1 AND device_id = $3`,
      [s.id, checkout.intentId, device.device_id]
    );

    // Keep QRPH intent as primary; webhook matches via metadata.vendo_session_id
    await audit(device.device_id, 'pay.client.gcash', {
      id: s.id, gcashIntent: checkout.intentId,
    });

    res.json({
      ok: true,
      redirectUrl: checkout.redirectUrl,
      intentId: checkout.intentId,
    });
  } catch (e) {
    console.error('pay gcash:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Browser-friendly QR PNG (from stored PayMongo data URL) */
r.get('/:deviceId/sessions/:id/qr.png', async (req, res) => {
  try {
    const device = await loadActiveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { rows } = await pool.query(
      `SELECT qr_image_url, status FROM vendo_sessions WHERE id = $1 AND device_id = $2`,
      [req.params.id, device.device_id]
    );
    const raw = rows[0]?.qr_image_url || '';
    if (!raw) return res.status(404).json({ error: 'no qr' });

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return res.redirect(302, raw);
    }

    const m = String(raw).match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!m) return res.status(415).json({ error: 'unsupported qr' });
    const buf = Buffer.from(m[2], 'base64');
    res.setHeader('Content-Type', `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}`);
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('Content-Length', buf.length);
    return res.end(buf);
  } catch (e) {
    console.error('pay qr.png:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default r;
