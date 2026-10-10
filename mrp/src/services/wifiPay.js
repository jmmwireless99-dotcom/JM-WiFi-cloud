/**
 * Social Park (and other hotspot sites) — PayMongo QRPH → MikroTik auto-login.
 * Packages expose price + online duration only; absolute validity (3d) stays server-side.
 */
import crypto from 'crypto';
import { pool, audit } from '../db.js';
import { createQrphCheckout, retrievePaymentIntent } from './paymongo.js';
// Isolated from mikrotikRest.js — CCTV agents often overwrite that file and
// previously crashed boot with missing disableHotspotUser / upsertHotspotUser.
import {
  upsertHotspotUser,
  ensureWifiPayWalledGarden,
  disableHotspotUser,
} from './wifiPayMikrotik.js';
import { BASE_PATH, HUB } from '../config.js';

/** Public package catalog — never include validityDays in API responses. */
export const WIFI_PAY_PACKAGES = Object.freeze([
  {
    id: 'unli20',
    name: 'Unli 20 Hours',
    label: '20 hours',
    pricePesos: 20,
    uptimeLimit: '20h',
    uptimeLabel: '20 hours',
    validityDays: 3,
  },
  {
    id: 'unli30',
    name: 'Unli 1 Day',
    label: '1 day',
    pricePesos: 30,
    uptimeLimit: '1d',
    uptimeLabel: '1 day',
    validityDays: 3,
  },
]);

export function publicPackages() {
  return WIFI_PAY_PACKAGES.map(({ id, name, label, pricePesos, uptimeLabel }) => ({
    id,
    name,
    label,
    pricePesos,
    uptimeLabel,
    currency: 'PHP',
  }));
}

export function getPackage(packageId) {
  return WIFI_PAY_PACKAGES.find((p) => p.id === String(packageId || '').trim()) || null;
}

export function publicBase() {
  const host = HUB() || 'jmtechsolution.cloud';
  const base = BASE_PATH() || '';
  return `https://${host}${base}`;
}

function genCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function normalizeMac(mac) {
  const raw = String(mac || '').trim().toUpperCase().replace(/-/g, ':');
  if (!raw || raw.includes('$(')) return '';
  const compact = raw.replace(/[^0-9A-F]/g, '');
  if (compact.length !== 12) return raw.length === 17 ? raw : '';
  return compact.match(/.{2}/g).join(':');
}

/** Resolve wifi_mikrotik_sites by id, name, or social alias. */
export async function resolveWifiSite(siteKey) {
  const key = String(siteKey || '').trim();
  if (!key) return null;
  if (/^\d+$/.test(key)) {
    const { rows } = await pool.query(
      `SELECT * FROM wifi_mikrotik_sites WHERE id = $1 AND status = 'active'`,
      [Number(key)]
    );
    return rows[0] || null;
  }
  const aliases = new Set([
    key.toLowerCase(),
    key.toLowerCase().replace(/_/g, '-'),
  ]);
  if (aliases.has('social') || aliases.has('social-park') || aliases.has('soscial') || aliases.has('social-hs')) {
    aliases.add('social-hs');
    aliases.add('soscial-park-1');
  }
  const { rows } = await pool.query(
    `SELECT * FROM wifi_mikrotik_sites
      WHERE status = 'active'
        AND (
          lower(name) = ANY($1::text[])
          OR lower(replace(name, ' ', '-')) = ANY($1::text[])
        )
      ORDER BY id
      LIMIT 1`,
    [[...aliases]]
  );
  return rows[0] || null;
}

export function sessionPublicView(row, { includeSecrets = false } = {}) {
  const pkg = getPackage(row.package_id);
  const base = publicBase();
  const out = {
    id: row.id,
    status: row.status,
    packageId: row.package_id,
    packageLabel: pkg?.uptimeLabel || row.package_label || '',
    amountPesos: Number(row.amount_pesos),
    currency: 'PHP',
    qrImageUrl: row.qr_image_url
      ? `${base}/api/wifi-pay/sessions/${row.id}/qr.png`
      : null,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    error: row.error || '',
    siteName: row.site_name || '',
  };
  // Never expose validityDays to clients
  if (includeSecrets && row.status === 'ready' && row.hotspot_username) {
    out.username = row.hotspot_username;
    out.password = row.hotspot_password;
    out.loginUrl = buildLoginUrl(row.link_login, row.hotspot_username, row.hotspot_password, row.link_orig);
  }
  return out;
}

export function buildLoginUrl(linkLogin, username, password, linkOrig) {
  const base = String(linkLogin || '').trim();
  if (!base || base.includes('$(')) return null;
  const u = new URL(base.includes('://') ? base : `http://gateway.local${base.startsWith('/') ? '' : '/'}${base}`);
  u.searchParams.set('username', username);
  u.searchParams.set('password', password);
  if (linkOrig && !String(linkOrig).includes('$(')) {
    u.searchParams.set('dst', linkOrig);
  }
  return u.toString().replace(/^http:\/\/gateway\.local/, '');
}

export async function createWifiPaySession({
  siteKey,
  packageId,
  mac,
  linkLogin,
  linkOrig,
  clientIp,
}) {
  const site = await resolveWifiSite(siteKey);
  if (!site) {
    const err = new Error('Hotspot site not found');
    err.status = 404;
    throw err;
  }
  const pkg = getPackage(packageId);
  if (!pkg) {
    const err = new Error('Invalid package');
    err.status = 400;
    throw err;
  }

  const macNorm = normalizeMac(mac);
  const amountPesos = pkg.pricePesos;
  const amountCentavos = Math.round(amountPesos * 100);
  const validUntil = new Date(Date.now() + pkg.validityDays * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const { rows } = await pool.query(
    `INSERT INTO wifi_pay_sessions
       (site_id, site_name, package_id, package_label, amount_pesos, amount_centavos,
        uptime_limit, validity_days, valid_until, mac, link_login, link_orig,
        client_ip, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)
     RETURNING *`,
    [
      site.id,
      site.name,
      pkg.id,
      pkg.uptimeLabel,
      amountPesos,
      amountCentavos,
      pkg.uptimeLimit,
      pkg.validityDays,
      validUntil,
      macNorm,
      String(linkLogin || '').slice(0, 500),
      String(linkOrig || '').slice(0, 500),
      String(clientIp || '').slice(0, 64),
      expiresAt,
    ]
  );
  let session = rows[0];

  try {
    // Do NOT await walled-garden here — 100+ MikroTik REST calls (~15s) cause Apache 502
    // on jmtechsolution.cloud and make Buy Unli look like it cannot generate QR.
    // Garden is already open from deploy; refresh in background after QR is returned.
    void ensureWifiPayWalledGarden(site, [HUB() || 'jmtechsolution.cloud']).catch((e) => {
      console.warn('walled-garden:', e.message);
    });

    const checkout = await createQrphCheckout({
      amountCentavos,
      description: `${site.name} · Unli ${pkg.uptimeLabel}`,
      billingName: 'Social Park WiFi',
      statementDescriptor: 'SOCIAL WIFI',
      returnPath: `/api/wifi-pay/sessions/${session.id}`,
      metadata: {
        wifi_pay_session_id: String(session.id),
        site_id: String(site.id),
        package_id: pkg.id,
        channel: 'hotspot_portal',
      },
    });

    const upd = await pool.query(
      `UPDATE wifi_pay_sessions SET
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
        checkout.qrImageUrl || '',
        checkout.clientKey || '',
      ]
    );
    session = upd.rows[0];
  } catch (e) {
    await pool.query(
      `UPDATE wifi_pay_sessions SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
      [session.id, e.message]
    );
    const err = new Error(e.message || 'PayMongo checkout failed');
    err.status = e.status || 502;
    err.sessionId = session.id;
    throw err;
  }

  await audit('wifi-pay', 'session.create', {
    id: session.id,
    siteId: site.id,
    packageId: pkg.id,
    amountPesos,
    mac: macNorm,
  });

  return session;
}

async function provisionHotspotUser(session) {
  const { rows: sites } = await pool.query(
    `SELECT * FROM wifi_mikrotik_sites WHERE id = $1`,
    [session.site_id]
  );
  const site = sites[0];
  if (!site?.mikrotik_host || !site?.api_password) {
    throw new Error('MikroTik site credentials missing');
  }

  const code = genCode(8);
  const username = `U${code}`;
  const password = code;
  const validUntil = session.valid_until
    ? new Date(session.valid_until)
    : new Date(Date.now() + (session.validity_days || 3) * 86400000);
  const comment = `wifi-pay:${session.id} until:${validUntil.toISOString()}`;

  const created = await upsertHotspotUser(site, {
    username,
    password,
    profile: 'default',
    limitUptime: session.uptime_limit || '20h',
    macAddress: session.mac || '',
    comment,
    server: 'all',
  });

  const { rows } = await pool.query(
    `UPDATE wifi_pay_sessions SET
        status = 'ready',
        hotspot_username = $2,
        hotspot_password = $3,
        mikrotik_user_id = $4,
        paid_at = COALESCE(paid_at, now()),
        provisioned_at = now(),
        error = '',
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [session.id, created.username, created.password, created.id || '']
  );

  await audit('wifi-pay', 'session.provisioned', {
    id: session.id,
    username: created.username,
    uptime: session.uptime_limit,
  });

  return rows[0];
}

/**
 * Mark paid + create MikroTik user (idempotent).
 */
export async function fulfillWifiPaySession(sessionRow, { paymentId = null } = {}) {
  if (!sessionRow?.id) return sessionRow;
  if (sessionRow.status === 'ready' && sessionRow.hotspot_username) {
    return sessionRow;
  }
  if (['failed', 'expired'].includes(sessionRow.status)) return sessionRow;

  const { rows } = await pool.query(
    `UPDATE wifi_pay_sessions SET
        status = CASE WHEN status = 'ready' THEN status ELSE 'paid' END,
        paymongo_payment_id = COALESCE($2, paymongo_payment_id),
        paid_at = COALESCE(paid_at, now()),
        updated_at = now(),
        error = ''
      WHERE id = $1
        AND status IN ('awaiting_payment','pending','paid','ready')
      RETURNING *`,
    [sessionRow.id, paymentId]
  );
  let session = rows[0] || sessionRow;
  if (session.status === 'ready' && session.hotspot_username) return session;

  try {
    session = await provisionHotspotUser(session);
  } catch (e) {
    console.error('wifi-pay provision:', e.message);
    await pool.query(
      `UPDATE wifi_pay_sessions SET error=$2, updated_at=now() WHERE id=$1`,
      [session.id, e.message]
    );
    session = { ...session, error: e.message };
  }
  return session;
}

export async function syncWifiPaySessionPayment(sessionRow) {
  if (!sessionRow?.id) return sessionRow;
  if (sessionRow.status === 'ready') return sessionRow;
  if (!['awaiting_payment', 'pending', 'paid'].includes(sessionRow.status)) {
    return sessionRow;
  }

  if (
    ['awaiting_payment', 'pending'].includes(sessionRow.status) &&
    sessionRow.expires_at &&
    new Date(sessionRow.expires_at) < new Date()
  ) {
    await pool.query(
      `UPDATE wifi_pay_sessions SET status='expired', updated_at=now() WHERE id=$1 AND status IN ('awaiting_payment','pending')`,
      [sessionRow.id]
    );
    return { ...sessionRow, status: 'expired' };
  }

  if (!sessionRow.paymongo_intent_id) return sessionRow;

  let data;
  try {
    data = await retrievePaymentIntent(sessionRow.paymongo_intent_id);
  } catch (e) {
    console.warn('wifi-pay sync intent:', e.message);
    return sessionRow;
  }
  const st = data?.data?.attributes?.status || '';
  if (st !== 'succeeded') return sessionRow;

  const payments = data?.data?.attributes?.payments || [];
  const paymentId = payments[0]?.id || null;
  return fulfillWifiPaySession(sessionRow, { paymentId });
}

export async function markWifiPayFromWebhook(eventType, parsed) {
  const paymentObj = parsed?.data?.attributes?.data || {};
  const paymentId = paymentObj?.id || null;
  const paymentAttrs = paymentObj?.attributes || {};
  const intentId =
    paymentAttrs.payment_intent_id ||
    paymentAttrs.source?.id ||
    parsed?.data?.attributes?.data?.attributes?.payment_intent_id ||
    null;
  const meta = paymentAttrs.metadata || {};
  const sessionId = meta.wifi_pay_session_id || null;

  if (eventType === 'qrph.expired') {
    const codeIntent =
      parsed?.data?.attributes?.data?.attributes?.payment_intent_id || intentId;
    if (codeIntent) {
      await pool.query(
        `UPDATE wifi_pay_sessions
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
        `UPDATE wifi_pay_sessions
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
      `SELECT * FROM wifi_pay_sessions WHERE paymongo_intent_id = $1 LIMIT 1`,
      [intentId]
    );
    row = rows[0] || null;
  }
  if (!row && sessionId) {
    const { rows } = await pool.query(
      `SELECT * FROM wifi_pay_sessions WHERE id = $1 LIMIT 1`,
      [sessionId]
    );
    row = rows[0] || null;
  }
  if (!row) return { ok: true, unmatched: true };

  const fulfilled = await fulfillWifiPaySession(row, { paymentId });
  return { ok: true, sessionId: fulfilled.id, ready: fulfilled.status === 'ready' };
}

/** Disable MikroTik users past absolute validity (hidden 3-day window). */
export async function cleanupExpiredWifiPayUsers() {
  const { rows } = await pool.query(
    `SELECT s.*, ms.mikrotik_host, ms.api_user, ms.api_password
       FROM wifi_pay_sessions s
       JOIN wifi_mikrotik_sites ms ON ms.id = s.site_id
      WHERE s.status = 'ready'
        AND s.hotspot_username IS NOT NULL
        AND s.valid_until < now()
        AND COALESCE(s.expired_cleaned, false) = false
      ORDER BY s.id
      LIMIT 50`
  );
  let n = 0;
  for (const row of rows) {
    try {
      await disableHotspotUser(row, row.hotspot_username);
      await pool.query(
        `UPDATE wifi_pay_sessions SET expired_cleaned = true, updated_at = now() WHERE id = $1`,
        [row.id]
      );
      n += 1;
    } catch (e) {
      console.warn('wifi-pay cleanup', row.id, e.message);
    }
  }
  return { cleaned: n };
}
