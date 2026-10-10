import crypto from 'crypto';
import { Router } from 'express';
import { pool, audit } from '../db.js';
import { requireAdmin, requireSuperAdmin } from '../auth.js';
import {
  getPaymongoSettings,
  getPaymongoSettingsPublic,
  upsertPaymongoSettings,
  getGoogleMapsApiKey,
  setGoogleMapsApiKey,
} from '../services/settings.js';
import { markVendoSessionFromWebhook, markStoreOrderFromWebhook } from '../services/paymongo.js';
import { markWifiPayFromWebhook } from '../services/wifiPay.js';
import { BASE_PATH, HUB } from '../config.js';

const r = Router();

function webhookUrl() {
  const base = BASE_PATH() || '';
  const host = HUB() || 'jmtechsolution.cloud';
  return `https://${host}${base}/api/webhooks/paymongo`;
}

function maskKey(value) {
  const v = String(value || '');
  if (!v) return '';
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

r.get('/maps', requireAdmin, async (_req, res) => {
  try {
    const key = await getGoogleMapsApiKey();
    res.json({
      googleMapsApiKey: key,
      googleMapsApiKeyMasked: maskKey(key),
      configured: !!key,
      defaultCenter: { lat: 11.0, lng: 122.5 },
      defaultZoom: 7,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put('/maps', requireSuperAdmin, async (req, res) => {
  try {
    const key = req.body?.googleMapsApiKey !== undefined
      ? String(req.body.googleMapsApiKey || '').trim()
      : undefined;
    if (key !== undefined) await setGoogleMapsApiKey(key);
    const saved = await getGoogleMapsApiKey();
    await audit(req.user?.sub || 'admin', 'settings.maps.update', { configured: !!saved });
    res.json({
      googleMapsApiKey: saved,
      googleMapsApiKeyMasked: maskKey(saved),
      configured: !!saved,
      defaultCenter: { lat: 11.0, lng: 122.5 },
      defaultZoom: 7,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.get('/paymongo', requireAdmin, async (_req, res) => {
  try {
    const settings = await getPaymongoSettingsPublic();
    const { rows: logs } = await pool.query(
      `SELECT id, event_id, event_type, is_valid, duplicate, processed_at, created_at, error
         FROM paymongo_webhook_logs
        ORDER BY id DESC LIMIT 30`
    );
    res.json({
      settings,
      webhookUrl: webhookUrl(),
      recentWebhooks: logs.map(l => ({
        id: l.id,
        eventId: l.event_id,
        eventType: l.event_type,
        isValid: l.is_valid,
        duplicate: l.duplicate,
        processedAt: l.processed_at,
        created: l.created_at,
        error: l.error || '',
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put('/paymongo', requireSuperAdmin, async (req, res) => {
  try {
    const settings = await upsertPaymongoSettings({
      enabled: req.body?.enabled,
      mode: req.body?.mode,
      publicKey: req.body?.publicKey,
      secretKey: req.body?.secretKey,
      webhookSecret: req.body?.webhookSecret,
    });
    await audit(req.user?.sub || 'admin', 'settings.paymongo.update', {
      enabled: settings.enabled,
      mode: settings.mode,
      secretKeyConfigured: settings.secretKeyConfigured,
      webhookSecretConfigured: settings.webhookSecretConfigured,
    });
    res.json({ settings, webhookUrl: webhookUrl() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default r;

export function verifyPaymongoSignature(rawBody, signatureHeader, secret, mode = 'test') {
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(
    String(signatureHeader)
      .split(',')
      .map(p => p.trim().split('='))
      .filter(kv => kv.length === 2)
      .map(([k, v]) => [k, v])
  );
  const t = parts.t;
  const expected = mode === 'live' ? (parts.li || '') : (parts.te || parts.li || '');
  const sig = expected || (!signatureHeader.includes('=') ? signatureHeader.trim() : '');
  if (!sig) return false;

  const candidates = [];
  if (t) candidates.push(`${t}.${rawBody}`);
  candidates.push(rawBody);

  for (const msg of candidates) {
    const computed = crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('hex');
    try {
      const a = Buffer.from(computed, 'utf8');
      const b = Buffer.from(sig, 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Mount with express.raw({ type: 'application/json' }) BEFORE express.json() */
export function createPaymongoWebhookRouter() {
  const wh = Router();

  wh.post('/', async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : String(req.body || '');
    const signatureHeader = req.get('Paymongo-Signature') || req.get('paymongo-signature') || '';

    let parsed;
    try {
      parsed = JSON.parse(rawBody || '{}');
    } catch {
      return res.status(400).json({ error: 'invalid json' });
    }

    const eventType = parsed?.data?.attributes?.type || 'unknown';
    const eventId = parsed?.data?.id || null;
    const settings = await getPaymongoSettings();
    const secret = (settings.webhookSecret || process.env.PAYMONGO_WEBHOOK_SECRET || '').trim();
    const isValid = verifyPaymongoSignature(rawBody, signatureHeader, secret, settings.mode);

    // Idempotent insert — unique event_id
    if (eventId) {
      const dup = await pool.query(
        `SELECT id, processed_at FROM paymongo_webhook_logs WHERE event_id = $1 LIMIT 1`,
        [eventId]
      );
      if (dup.rows[0]?.processed_at) {
        await pool.query(
          `INSERT INTO paymongo_webhook_logs
             (event_id, event_type, payload, signature, is_valid, duplicate)
           VALUES ($1, $2, $3::jsonb, $4, $5, true)`,
          [null, eventType, rawBody, signatureHeader.slice(0, 500), isValid]
        ).catch(() => {});
        return res.json({ ok: true, duplicate: true });
      }
    }

    let logId = null;
    try {
      const { rows } = await pool.query(
        `INSERT INTO paymongo_webhook_logs
           (event_id, event_type, payload, signature, is_valid, duplicate)
         VALUES ($1, $2, $3::jsonb, $4, $5, false)
         RETURNING id`,
        [eventId, eventType, rawBody, signatureHeader.slice(0, 500), isValid]
      );
      logId = rows[0].id;
    } catch (e) {
      if (e.code === '23505') {
        return res.json({ ok: true, duplicate: true });
      }
      console.error('paymongo webhook log failed:', e.message);
    }

    if (!settings.enabled) {
      await finishLog(logId, null, 'paymongo disabled');
      return res.status(503).json({ error: 'paymongo disabled' });
    }

    if (!isValid) {
      await finishLog(logId, null, 'invalid signature');
      return res.status(401).json({ error: 'invalid signature' });
    }

    try {
      if (eventType === 'payment.paid' || eventType === 'payment.failed' || eventType === 'qrph.expired') {
        await markVendoSessionFromWebhook(eventType, parsed);
        await markStoreOrderFromWebhook(eventType, parsed);
        await markWifiPayFromWebhook(eventType, parsed);
        await audit('paymongo', `webhook.${eventType}`, {
          eventId,
          paymentId: parsed?.data?.attributes?.data?.id || null,
        });
      }
      await finishLog(logId, new Date(), null);
      return res.json({ ok: true, eventType });
    } catch (e) {
      await finishLog(logId, null, e.message);
      console.error('paymongo webhook process failed:', e.message);
      return res.json({ ok: false, error: e.message });
    }
  });

  return wh;
}

async function finishLog(id, processedAt, error) {
  if (!id) return;
  await pool.query(
    `UPDATE paymongo_webhook_logs
        SET processed_at = COALESCE($2, processed_at),
            error = COALESCE($3, error)
      WHERE id = $1`,
    [id, processedAt, error]
  ).catch(() => {});
}
