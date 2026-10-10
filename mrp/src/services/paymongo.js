import { getPaymongoSettings, getSetting, setSetting } from './settings.js';
import { pool } from '../db.js';

const PM_BASE = 'https://api.paymongo.com/v1';

export async function getPricePerLiter() {
  const fromDb = await getSetting('gasoline_price_per_liter');
  const n = Number(fromDb || process.env.GASOLINE_PRICE_PER_LITER || 65);
  return Number.isFinite(n) && n > 0 ? n : 65;
}

/** Per-board rate; falls back to global portal rate. */
export async function getDevicePricePerLiter(deviceRow) {
  const d = Number(deviceRow?.price_per_liter);
  if (Number.isFinite(d) && d > 0) return d;
  return getPricePerLiter();
}

const DEFAULT_AMOUNT_PRESETS = [50, 100, 200, 500];

/** Peso buttons shown on ESP32 home (add/delete via portal). */
export async function getAmountPresets() {
  const raw = await getSetting('gasoline_amount_presets');
  let list = DEFAULT_AMOUNT_PRESETS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      /* keep default */
    }
  }
  const cleaned = [...new Set(
    list
      .map((n) => Math.round(Number(n)))
      .filter((n) => Number.isFinite(n) && n >= 20 && n <= 10000)
  )].sort((a, b) => a - b);
  return cleaned.length ? cleaned.slice(0, 8) : [...DEFAULT_AMOUNT_PRESETS];
}

export async function setAmountPresets(presets) {
  const cleaned = [...new Set(
    (Array.isArray(presets) ? presets : [])
      .map((n) => Math.round(Number(n)))
      .filter((n) => Number.isFinite(n) && n >= 20 && n <= 10000)
  )].sort((a, b) => a - b);
  if (!cleaned.length) {
    throw new Error('at least one amount (₱20–10000)');
  }
  if (cleaned.length > 8) {
    throw new Error('max 8 amount buttons on ESP32');
  }
  await setSetting('gasoline_amount_presets', JSON.stringify(cleaned), 'gasoline');
  return cleaned;
}

function authHeader(secretKey) {
  return 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
}

async function pmFetch(path, secretKey, { method = 'GET', body } = {}) {
  const res = await fetch(`${PM_BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader(secretKey),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errors?.[0]?.detail || data?.error || res.statusText;
    const err = new Error(msg || `PayMongo ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/**
 * Create Payment Intent → Payment Method (qrph) → Attach.
 * Returns { intentId, methodId, clientKey, qrImageUrl, status }.
 */
export async function createQrphCheckout({
  amountCentavos,
  description,
  metadata = {},
  billingName = 'Gasoline Vendo',
  statementDescriptor = 'JM GASOLINE',
  returnPath = '/',
}) {
  const settings = await getPaymongoSettings();
  if (!settings.enabled) {
    throw Object.assign(new Error('PayMongo disabled — enable in Settings'), { status: 503 });
  }
  const secret = (settings.secretKey || process.env.PAYMONGO_SECRET_KEY || '').trim();
  if (!secret) {
    throw Object.assign(new Error('PayMongo secret key not configured'), { status: 503 });
  }
  if (!Number.isFinite(amountCentavos) || amountCentavos < 100) {
    throw Object.assign(new Error('amount must be at least ₱1.00'), { status: 400 });
  }

  const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
  const returnUrl = `https://${process.env.HUB_DOMAIN || 'jmtechsolution.cloud'}${base}${returnPath || '/'}`;

  const intent = await pmFetch('/payment_intents', secret, {
    method: 'POST',
    body: {
      data: {
        attributes: {
          amount: Math.round(amountCentavos),
          currency: 'PHP',
          payment_method_allowed: ['qrph'],
          description: description || 'Gasoline Vendo',
          statement_descriptor: String(statementDescriptor || 'JM GASOLINE').slice(0, 22),
          metadata,
        },
      },
    },
  });

  const intentId = intent?.data?.id;
  const clientKey = intent?.data?.attributes?.client_key;

  const method = await pmFetch('/payment_methods', secret, {
    method: 'POST',
    body: {
      data: {
        attributes: {
          type: 'qrph',
          billing: {
            name: String(billingName || 'Gasoline Vendo').slice(0, 100),
            email: 'vendo@jmtechsolution.cloud',
          },
        },
      },
    },
  });
  const methodId = method?.data?.id;

  const attached = await pmFetch(`/payment_intents/${intentId}/attach`, secret, {
    method: 'POST',
    body: {
      data: {
        attributes: {
          payment_method: methodId,
          return_url: returnUrl,
        },
      },
    },
  });

  const attrs = attached?.data?.attributes || {};
  const qrImageUrl =
    attrs?.next_action?.code?.image_url ||
    attrs?.next_action?.redirect?.url ||
    null;

  return {
    intentId,
    methodId,
    clientKey,
    qrImageUrl,
    status: attrs.status || 'awaiting_payment_method',
    raw: attached?.data,
  };
}

/**
 * GCash e-wallet redirect — mobile browser opens GCash app via gcash:// deep link.
 * Use alongside QRPH session (same vendo_session_id in metadata for webhook match).
 */
export async function createGcashRedirectCheckout({
  amountCentavos,
  description,
  metadata = {},
  returnUrl,
}) {
  const settings = await getPaymongoSettings();
  if (!settings.enabled) {
    throw Object.assign(new Error('PayMongo disabled — enable in Settings'), { status: 503 });
  }
  const secret = (settings.secretKey || process.env.PAYMONGO_SECRET_KEY || '').trim();
  if (!secret) {
    throw Object.assign(new Error('PayMongo secret key not configured'), { status: 503 });
  }
  if (!Number.isFinite(amountCentavos) || amountCentavos < 100) {
    throw Object.assign(new Error('amount must be at least ₱1.00'), { status: 400 });
  }

  const intent = await pmFetch('/payment_intents', secret, {
    method: 'POST',
    body: {
      data: {
        attributes: {
          amount: Math.round(amountCentavos),
          currency: 'PHP',
          payment_method_allowed: ['gcash'],
          description: description || 'Gasoline Vendo GCash',
          statement_descriptor: 'JM GASOLINE',
          metadata,
        },
      },
    },
  });

  const intentId = intent?.data?.id;
  const clientKey = intent?.data?.attributes?.client_key;

  const method = await pmFetch('/payment_methods', secret, {
    method: 'POST',
    body: {
      data: {
        attributes: {
          type: 'gcash',
          billing: { name: 'Gasoline Vendo', email: 'vendo@jmtechsolution.cloud' },
        },
      },
    },
  });
  const methodId = method?.data?.id;

  const hub = process.env.HUB_DOMAIN || 'jmtechsolution.cloud';
  const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
  const fallbackReturn = `https://${hub}${base}/pay/${metadata.device_id || ''}`;

  const attached = await pmFetch(`/payment_intents/${intentId}/attach`, secret, {
    method: 'POST',
    body: {
      data: {
        attributes: {
          payment_method: methodId,
          return_url: returnUrl || fallbackReturn,
        },
      },
    },
  });

  const attrs = attached?.data?.attributes || {};
  const redirectUrl = attrs?.next_action?.redirect?.url || null;
  if (!redirectUrl) {
    throw Object.assign(new Error('No GCash redirect URL from PayMongo'), { status: 502 });
  }

  return {
    intentId,
    methodId,
    clientKey,
    redirectUrl,
    status: attrs.status || 'awaiting_next_action',
  };
}

/** Pull Payment Intent from PayMongo (used to unblock LCD without waiting on webhook). */
export async function retrievePaymentIntent(intentId) {
  const settings = await getPaymongoSettings();
  const secret = (settings.secretKey || process.env.PAYMONGO_SECRET_KEY || '').trim();
  if (!secret) {
    throw Object.assign(new Error('PayMongo secret key not configured'), { status: 503 });
  }
  if (!intentId) {
    throw Object.assign(new Error('intent id required'), { status: 400 });
  }
  return pmFetch(`/payment_intents/${encodeURIComponent(intentId)}`, secret, { method: 'GET' });
}

/**
 * If PayMongo already succeeded but webhook is slow/missed, flip session → dispense_ready.
 * Safe to call on every phone poll / return-from-GCash.
 */
export async function syncVendoSessionPayment(sessionRow) {
  if (!sessionRow?.id) return sessionRow;
  if (!['awaiting_payment', 'pending', 'paid'].includes(sessionRow.status)) {
    return sessionRow;
  }

  const intentIds = [sessionRow.paymongo_intent_id].filter(Boolean);

  let paidIntent = null;
  let paymentId = null;
  for (const intentId of intentIds) {
    try {
      const data = await retrievePaymentIntent(intentId);
      const st = data?.data?.attributes?.status || '';
      if (st === 'succeeded') {
        paidIntent = intentId;
        const payments = data?.data?.attributes?.payments || [];
        paymentId = payments[0]?.id || null;
        break;
      }
    } catch (e) {
      console.warn('sync intent', intentId, e.message);
    }
  }

  if (!paidIntent && sessionRow.status !== 'paid') return sessionRow;

  const { rows } = await pool.query(
    `UPDATE vendo_sessions
        SET status = 'dispense_ready',
            paymongo_payment_id = COALESCE($2, paymongo_payment_id),
            paid_at = COALESCE(paid_at, now()),
            updated_at = now(),
            error = ''
      WHERE id = $1
        AND status IN ('awaiting_payment','pending','paid')
      RETURNING *`,
    [sessionRow.id, paymentId]
  );
  const row = rows[0] || sessionRow;
  if (!rows[0]) return sessionRow;

  const exists = await pool.query(
    `SELECT id FROM gasoline_sales WHERE notes LIKE $1 LIMIT 1`,
    [`%session:${row.id}%`]
  );
  if (!exists.rows[0]) {
    await pool.query(
      `INSERT INTO gasoline_sales
         (vendor, fuel_type, liters, price_per_liter, amount, payment, notes, sold_by, sold_at, device_id)
       VALUES ($1,'Regular',$2,$3,$4,'QRPH',$5,$6, COALESCE($7, now()), $8)`,
      [
        row.device_name || row.device_id || 'Gasoline Vendo',
        row.liters,
        row.price_per_liter,
        row.amount_pesos,
        `session:${row.id} intent:${paidIntent || row.paymongo_intent_id || ''} pay:${paymentId || ''} sync device:${row.device_id || ''}`,
        'paymongo',
        row.paid_at,
        row.device_id || null,
      ]
    );
  }
  return row;
}

export async function markVendoSessionFromWebhook(eventType, parsed) {
  const paymentObj = parsed?.data?.attributes?.data || {};
  const paymentId = paymentObj?.id || null;
  const paymentAttrs = paymentObj?.attributes || {};
  // Payment Intent id may be on payment attributes
  const intentId =
    paymentAttrs.payment_intent_id ||
    paymentAttrs.source?.id ||
    parsed?.data?.attributes?.data?.attributes?.payment_intent_id ||
    null;

  if (eventType === 'qrph.expired') {
    const codeIntent =
      parsed?.data?.attributes?.data?.attributes?.payment_intent_id || intentId;
    if (codeIntent) {
      await pool.query(
        `UPDATE vendo_sessions
            SET status = 'expired', error = 'qrph.expired', updated_at = now()
          WHERE paymongo_intent_id = $1
            AND status IN ('awaiting_payment','pending')`,
        [codeIntent]
      );
    }
    return { ok: true };
  }

  if (eventType === 'payment.failed') {
    if (intentId) {
      await pool.query(
        `UPDATE vendo_sessions
            SET status = 'failed',
                paymongo_payment_id = COALESCE($2, paymongo_payment_id),
                error = 'payment.failed',
                updated_at = now()
          WHERE paymongo_intent_id = $1
            AND status IN ('awaiting_payment','pending')`,
        [intentId, paymentId]
      );
    }
    return { ok: true };
  }

  if (eventType !== 'payment.paid') return { ok: true, skipped: true };

  // Prefer match by intent id; fallback metadata.session_id
  const meta = paymentAttrs.metadata || {};
  const sessionId = meta.vendo_session_id || meta.session_id || null;

  let row = null;
  if (intentId) {
    const { rows } = await pool.query(
      `UPDATE vendo_sessions
          SET status = 'dispense_ready',
              paymongo_payment_id = COALESCE($2, paymongo_payment_id),
              paid_at = COALESCE(paid_at, now()),
              updated_at = now(),
              error = ''
        WHERE paymongo_intent_id = $1
          AND status IN ('awaiting_payment','pending','paid','dispense_ready')
        RETURNING *`,
      [intentId, paymentId]
    );
    row = rows[0] || null;
  }
  if (!row && sessionId) {
    const { rows } = await pool.query(
      `UPDATE vendo_sessions
          SET status = 'dispense_ready',
              paymongo_payment_id = COALESCE($2, paymongo_payment_id),
              paymongo_intent_id = COALESCE(paymongo_intent_id, $3),
              paid_at = COALESCE(paid_at, now()),
              updated_at = now(),
              error = ''
        WHERE id = $1
          AND status IN ('awaiting_payment','pending','paid','dispense_ready')
        RETURNING *`,
      [sessionId, paymentId, intentId]
    );
    row = rows[0] || null;
  }

  if (!row) return { ok: true, unmatched: true };

  // Idempotent sale record
  const exists = await pool.query(
    `SELECT id FROM gasoline_sales WHERE notes LIKE $1 LIMIT 1`,
    [`%session:${row.id}%`]
  );
  if (!exists.rows[0]) {
    await pool.query(
      `INSERT INTO gasoline_sales
         (vendor, fuel_type, liters, price_per_liter, amount, payment, notes, sold_by, sold_at, device_id)
       VALUES ($1,'Regular',$2,$3,$4,'QRPH',$5,$6, COALESCE($7, now()), $8)`,
      [
        row.device_name || row.device_id || 'Gasoline Vendo',
        row.liters,
        row.price_per_liter,
        row.amount_pesos,
        `session:${row.id} intent:${row.paymongo_intent_id || ''} pay:${paymentId || ''} device:${row.device_id || ''}`,
        'paymongo',
        row.paid_at,
        row.device_id || null,
      ]
    );
  }

  // Already dispense_ready from the UPDATE above
  return { ok: true, sessionId: row.id, ready: true };
}

/** Mark marketplace store_orders paid/failed/expired from PayMongo webhook */
export async function markStoreOrderFromWebhook(eventType, parsed) {
  const paymentObj = parsed?.data?.attributes?.data || {};
  const paymentId = paymentObj?.id || null;
  const paymentAttrs = paymentObj?.attributes || {};
  const intentId =
    paymentAttrs.payment_intent_id ||
    paymentAttrs.source?.id ||
    parsed?.data?.attributes?.data?.attributes?.payment_intent_id ||
    null;
  const meta = paymentAttrs.metadata || {};
  const orderId = meta.store_order_id || meta.order_id || null;

  if (eventType === 'qrph.expired') {
    const codeIntent =
      parsed?.data?.attributes?.data?.attributes?.payment_intent_id || intentId;
    if (codeIntent) {
      await pool.query(
        `UPDATE store_orders
            SET status = 'expired', error = 'qrph.expired', updated_at = now()
          WHERE paymongo_intent_id = $1
            AND status IN ('awaiting_payment','pending')`,
        [codeIntent]
      );
    }
    return { ok: true };
  }

  if (eventType === 'payment.failed') {
    if (intentId) {
      await pool.query(
        `UPDATE store_orders
            SET status = 'failed',
                paymongo_payment_id = COALESCE($2, paymongo_payment_id),
                error = 'payment.failed',
                updated_at = now()
          WHERE paymongo_intent_id = $1
            AND status IN ('awaiting_payment','pending')`,
        [intentId, paymentId]
      );
    }
    return { ok: true };
  }

  if (eventType !== 'payment.paid') return { ok: true, skipped: true };

  let row = null;
  if (intentId) {
    const { rows } = await pool.query(
      `UPDATE store_orders
          SET status = 'paid',
              paymongo_payment_id = COALESCE($2, paymongo_payment_id),
              paid_at = COALESCE(paid_at, now()),
              updated_at = now(),
              error = ''
        WHERE paymongo_intent_id = $1
          AND status IN ('awaiting_payment','pending','paid')
        RETURNING *`,
      [intentId, paymentId]
    );
    row = rows[0] || null;
  }
  if (!row && orderId) {
    const { rows } = await pool.query(
      `UPDATE store_orders
          SET status = 'paid',
              paymongo_payment_id = COALESCE($2, paymongo_payment_id),
              paymongo_intent_id = COALESCE(paymongo_intent_id, $3),
              paid_at = COALESCE(paid_at, now()),
              updated_at = now(),
              error = ''
        WHERE id = $1
          AND status IN ('awaiting_payment','pending','paid')
        RETURNING *`,
      [orderId, paymentId, intentId]
    );
    row = rows[0] || null;
  }
  return { ok: true, orderId: row?.id || null, paid: !!row };
}

/** Active poll fallback for store QR orders */
export async function syncStoreOrderPayment(orderRow) {
  if (!orderRow?.paymongo_intent_id) return orderRow;
  if (!['awaiting_payment', 'pending'].includes(orderRow.status)) return orderRow;

  let data;
  try {
    data = await retrievePaymentIntent(orderRow.paymongo_intent_id);
  } catch {
    return orderRow;
  }
  const status = data?.data?.attributes?.status;
  if (status !== 'succeeded') return orderRow;

  const payments = data?.data?.attributes?.payments || [];
  const paymentId = payments[0]?.id || null;

  const { rows } = await pool.query(
    `UPDATE store_orders
        SET status = 'paid',
            paymongo_payment_id = COALESCE($2, paymongo_payment_id),
            paid_at = COALESCE(paid_at, now()),
            updated_at = now(),
            error = ''
      WHERE id = $1
        AND status IN ('awaiting_payment','pending')
      RETURNING *`,
    [orderRow.id, paymentId]
  );
  return rows[0] || orderRow;
}
