/**
 * Minimal Dahua CGI client (Digest auth) for NVR ChannelTitle sync.
 * Used from VPS over MikroTik dstnat → NVR HTTP.
 */
import crypto from 'crypto';

function md5(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex');
}

function parseWwwAuthenticate(header) {
  const out = {};
  const raw = String(header || '');
  const m = raw.match(/Digest\s+(.+)/i);
  if (!m) return null;
  for (const part of m[1].matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) {
    out[part[1]] = part[2] ?? part[3] ?? '';
  }
  return out.realm ? out : null;
}

function digestAuthorization({ user, pass, method, uri, challenge, nc = 1 }) {
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ncStr = String(nc).padStart(8, '0');
  const ha1 = md5(`${user}:${challenge.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = (challenge.qop || '').split(',')[0].trim() || 'auth';
  const response = md5(`${ha1}:${challenge.nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`);
  const parts = [
    `Digest username="${user}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `algorithm="${challenge.algorithm || 'MD5'}"`,
    `response="${response}"`,
    `qop=${qop}`,
    `nc=${ncStr}`,
    `cnonce="${cnonce}"`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return parts.join(', ');
}

/**
 * GET Dahua CGI with Digest auth.
 * @param {string} baseUrl e.g. http://10.90.0.42:10580
 * @param {string} path e.g. /cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle
 */
export async function dahuaDigestGet(baseUrl, path, { user = 'admin', pass = '', timeoutMs = 12_000 } = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const uri = path.startsWith('/') ? path : `/${path}`;
  const url = `${root}${uri}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const first = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'manual' });
    if (first.status !== 401) {
      const text = await first.text();
      if (!first.ok) throw new Error(`Dahua CGI ${first.status}: ${text.slice(0, 160)}`);
      return text;
    }
    const challenge = parseWwwAuthenticate(first.headers.get('www-authenticate'));
    if (!challenge) throw new Error('Dahua CGI: no Digest challenge');
    const auth = digestAuthorization({ user, pass, method: 'GET', uri, challenge });
    const second = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { Authorization: auth },
    });
    const text = await second.text();
    if (!second.ok) throw new Error(`Dahua CGI ${second.status}: ${text.slice(0, 160)}`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse ChannelTitle table from configManager CGI text.
 * Index 0 = channel 1 on Dahua NVRs.
 * @returns {Map<number, string>} channel → name
 */
export function parseChannelTitleTable(text) {
  const map = new Map();
  const re = /table\.ChannelTitle\[(\d+)\]\.Name=(.*)/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const idx = Number(m[1]);
    const name = String(m[2] || '').replace(/\r$/, '').trim();
    if (!Number.isFinite(idx) || !name) continue;
    map.set(idx + 1, name);
  }
  return map;
}

/** Normalize NVR title for UI (underscores → spaces; strip trailing device IP). */
export function normalizeNvrChannelName(raw) {
  let s = String(raw || '').trim();
  s = s
    .replace(/\s*[·|]\s*\d{1,3}(?:\.\d{1,3}){3}\s*$/i, '')
    .replace(/[-\s]\d{1,3}(?:\.\d{1,3}){3}\s*$/i, '')
    .trim();
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s || 'UNKNOWN';
}
