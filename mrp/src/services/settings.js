import { pool } from '../db.js';

const PAYMONGO_KEYS = [
  'paymongo_enabled',
  'paymongo_mode',
  'paymongo_public_key',
  'paymongo_secret_key',
  'paymongo_webhook_secret',
];

function mask(value) {
  const v = String(value || '');
  if (!v) return '';
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

export async function getSetting(key) {
  const { rows } = await pool.query(
    `SELECT value FROM system_settings WHERE key = $1`,
    [key]
  );
  return rows[0]?.value ?? '';
}

export async function setSetting(key, value, groupName = 'system') {
  await pool.query(
    `INSERT INTO system_settings (key, value, group_name, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, group_name = EXCLUDED.group_name, updated_at = now()`,
    [key, String(value ?? ''), groupName]
  );
  return getSetting(key);
}

export async function getPaymongoSettings() {
  const { rows } = await pool.query(
    `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
    [PAYMONGO_KEYS]
  );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value ?? '']));
  return {
    enabled: (map.paymongo_enabled || '0') === '1',
    mode: map.paymongo_mode === 'live' ? 'live' : 'test',
    publicKey: map.paymongo_public_key || '',
    secretKey: map.paymongo_secret_key || '',
    webhookSecret: map.paymongo_webhook_secret || '',
  };
}

export async function getPaymongoSettingsPublic() {
  const s = await getPaymongoSettings();
  return {
    enabled: s.enabled,
    mode: s.mode,
    publicKey: s.publicKey,
    publicKeyMasked: mask(s.publicKey),
    secretKeyConfigured: !!s.secretKey,
    secretKeyMasked: mask(s.secretKey),
    webhookSecretConfigured: !!s.webhookSecret,
    webhookSecretMasked: mask(s.webhookSecret),
  };
}

export async function upsertPaymongoSettings(input = {}) {
  const current = await getPaymongoSettings();
  const next = {
    paymongo_enabled: input.enabled === true || input.enabled === '1' || input.enabled === 1 ? '1' : '0',
    paymongo_mode: String(input.mode || current.mode || 'test') === 'live' ? 'live' : 'test',
    paymongo_public_key:
      input.publicKey !== undefined ? String(input.publicKey || '').trim() : current.publicKey,
    paymongo_secret_key:
      input.secretKey !== undefined && String(input.secretKey).trim()
        ? String(input.secretKey).trim()
        : current.secretKey,
    paymongo_webhook_secret:
      input.webhookSecret !== undefined && String(input.webhookSecret).trim()
        ? String(input.webhookSecret).trim()
        : current.webhookSecret,
  };

  for (const [key, value] of Object.entries(next)) {
    await pool.query(
      `INSERT INTO system_settings (key, value, group_name, updated_at)
       VALUES ($1, $2, 'paymongo', now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
  }
  return getPaymongoSettingsPublic();
}

export async function getGoogleMapsApiKey() {
  const fromEnv = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  return String(await getSetting('google_maps_api_key') || '').trim();
}

export async function setGoogleMapsApiKey(key) {
  await setSetting('google_maps_api_key', String(key || '').trim(), 'maps');
  return getGoogleMapsApiKey();
}
