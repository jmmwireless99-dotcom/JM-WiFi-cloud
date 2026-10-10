/**
 * WiFi Pay MikroTik helpers — isolated from mikrotikRest.js so CCTV/dashboard
 * agents that overwrite mikrotikRest cannot crash Buy Unli / wifi-pay boot.
 */
const DEFAULT_TIMEOUT_MS = 15000;

function siteCreds(site) {
  const host = String(site.mikrotik_host || site.mikrotikHost || '').trim();
  const user = String(site.api_user || site.apiUser || 'admin').trim() || 'admin';
  const pass = String(site.api_password || site.apiPassword || '');
  if (!host) throw new Error('MikroTik host missing on site');
  if (!pass) throw new Error('MikroTik API password missing on site — i-Edit ang site at ilagay ang API password');
  return { host, user, pass };
}

async function rest(site, method, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { host, user, pass } = siteCreds(site);
  const url = `http://${host}/rest/${String(path).replace(/^\/+/, '')}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.detail)) || text || res.statusText;
      const err = new Error(`MikroTik ${method} ${path}: ${msg}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`MikroTik timeout (${host}) — check VPN / API`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function findOne(site, path, query) {
  const qs = new URLSearchParams(query).toString();
  const rows = await rest(site, 'GET', `${path}?${qs}`);
  if (Array.isArray(rows)) return rows[0] || null;
  return rows || null;
}

/** Ensure HTTP walled-garden host (L7 Host match + HotSpot DNS-cache allow). */
export async function ensureWalledGardenHost(site, dstHost, comment = 'JM WiFi Cloud') {
  const host = String(dstHost || '').trim().toLowerCase();
  if (!host) throw new Error('dstHost required');
  const existing = await findOne(site, 'ip/hotspot/walled-garden', { 'dst-host': host }).catch(() => null);
  if (existing?.['.id']) {
    if (String(existing.disabled) === 'true') {
      await rest(site, 'PATCH', `ip/hotspot/walled-garden/${existing['.id']}`, { disabled: 'false' });
    }
    return { ok: true, skipped: true, id: existing['.id'], host };
  }
  const created = await rest(site, 'PUT', 'ip/hotspot/walled-garden', {
    'dst-host': host,
    action: 'allow',
    comment,
  });
  return { ok: true, skipped: false, id: created?.['.id'], host };
}

/**
 * Domains needed so Buy Unli / QR e-wallet works from captive portal
 * kahit walang cellular data (WiFi + walled garden lang).
 */
export const WIFI_PAY_WALLED_HOSTS = Object.freeze([
  'jmtechsolution.cloud',
  '*.jmtechsolution.cloud',
  'paymongo.com',
  'www.paymongo.com',
  'api.paymongo.com',
  'checkout.paymongo.com',
  'links.paymongo.com',
  'cdn.paymongo.com',
  'assets.paymongo.com',
  '*.paymongo.com',
  'gcash.com',
  'www.gcash.com',
  'm.gcash.com',
  'api.gcash.com',
  'app.gcash.com',
  'cdn.gcash.com',
  'payments.gcash.com',
  'glife.gcash.com',
  '*.gcash.com',
  'mynt.xyz',
  'api.mynt.xyz',
  'login.mynt.xyz',
  'mss.paas.mynt.xyz',
  'mdap.paas.mynt.xyz',
  'mgs-gw.paas.mynt.xyz',
  'customer-segment-api.mynt.xyz',
  '*.mynt.xyz',
  'mynt.ph',
  '*.mynt.ph',
  'gcashapp.page.link',
  'gcash-api.pulseid.com',
  '*.pulseid.com',
  'irisk-sea.alipay.com',
  'gw.alipayobjects.com',
  'alipay.com',
  '*.alipay.com',
  'alipayobjects.com',
  '*.alipayobjects.com',
  'alipayplus.com',
  '*.alipayplus.com',
  'maya.ph',
  'www.maya.ph',
  'api.maya.ph',
  'cdn.maya.ph',
  'app.maya.ph',
  'payments.maya.ph',
  '*.maya.ph',
  'paymaya.com',
  'www.paymaya.com',
  'api.paymaya.com',
  'assets.paymaya.com',
  '*.paymaya.com',
  'mayabank.ph',
  'api.mayabank.ph',
  'api-bnpl.mayabank.ph',
  '*.mayabank.ph',
  'comms-client-api-production.voyagerapis.com',
  'glimpse.voyagerapis.com',
  '*.voyagerapis.com',
  'updater.voyagerinnovation.com',
  '*.voyagerinnovation.com',
]);

export const WIFI_PAY_WALLED_IPS = Object.freeze([
  '8.8.8.8',
  '8.8.4.4',
  '1.1.1.1',
  '1.0.0.1',
  '72.62.73.235', // jmtechsolution.cloud
]);

async function ensureWalledGardenIp(site, dstAddress, comment = 'JM WiFi Pay DNS') {
  const addr = String(dstAddress || '').trim();
  if (!addr) throw new Error('dstAddress required');
  const rows = await rest(site, 'GET', 'ip/hotspot/walled-garden/ip').catch(() => []);
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const hit = list.find((r) => String(r['dst-address'] || '') === addr || String(r['dst-address'] || '').startsWith(addr + '/'));
  if (hit?.['.id']) {
    if (String(hit.disabled) === 'true') {
      await rest(site, 'PATCH', `ip/hotspot/walled-garden/ip/${hit['.id']}`, { disabled: 'false' });
    }
    return { ok: true, skipped: true, id: hit['.id'], address: addr };
  }
  const created = await rest(site, 'PUT', 'ip/hotspot/walled-garden/ip', {
    'dst-address': addr.includes('/') ? addr : `${addr}/32`,
    action: 'accept',
    comment,
  });
  return { ok: true, skipped: false, id: created?.['.id'], address: addr };
}

async function ensureWalledGardenIpHost(site, dstHost, comment = 'JM WiFi Pay HTTPS') {
  const host = String(dstHost || '').trim().toLowerCase();
  if (!host || host.includes('*')) {
    return { ok: true, skipped: true, host, note: 'wildcard-or-empty' };
  }
  const rows = await rest(site, 'GET', 'ip/hotspot/walled-garden/ip').catch(() => []);
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const hit = list.find((r) => String(r['dst-host'] || '').toLowerCase() === host);
  if (hit?.['.id']) {
    if (String(hit.disabled) === 'true') {
      await rest(site, 'PATCH', `ip/hotspot/walled-garden/ip/${hit['.id']}`, { disabled: 'false' });
    }
    return { ok: true, skipped: true, id: hit['.id'], host };
  }
  const created = await rest(site, 'PUT', 'ip/hotspot/walled-garden/ip', {
    'dst-host': host,
    action: 'accept',
    comment,
  });
  return { ok: true, skipped: false, id: created?.['.id'], host };
}

async function cleanupBrokenWalledGardenHosts(site) {
  const rows = await rest(site, 'GET', 'ip/hotspot/walled-garden').catch(() => []);
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const removed = [];
  for (const r of list) {
    if (String(r.dynamic) === 'true') continue;
    const dst = String(r['dst-host'] || '').trim();
    const comment = String(r.comment || '');
    if (!dst && /JM WiFi Pay DNS/i.test(comment) && r['.id']) {
      try {
        await rest(site, 'DELETE', `ip/hotspot/walled-garden/${r['.id']}`);
        removed.push(r['.id']);
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

/**
 * Open full PayMongo + GCash + Maya walled garden on a hotspot site.
 * Idempotent — safe to call on every Buy Unli session create.
 */
export async function ensureWifiPayWalledGarden(site, extraHosts = []) {
  const hub = String(site?.hub_domain || process.env.HUB_DOMAIN || 'jmtechsolution.cloud').trim().toLowerCase();
  const hosts = [...new Set([
    ...WIFI_PAY_WALLED_HOSTS,
    hub,
    hub ? `*.${hub.replace(/^\*\./, '')}` : '',
    ...extraHosts.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean),
  ].filter(Boolean))];

  const results = { hosts: [], ipHosts: [], ips: [], cleaned: [], errors: [] };
  try {
    results.cleaned = await cleanupBrokenWalledGardenHosts(site);
  } catch (e) {
    results.errors.push(`cleanup: ${e.message}`);
  }

  for (const host of hosts) {
    try {
      results.hosts.push(await ensureWalledGardenHost(site, host, 'JM WiFi Pay / e-wallet'));
    } catch (e) {
      results.errors.push(`${host}: ${e.message}`);
    }
    if (!host.includes('*')) {
      try {
        results.ipHosts.push(await ensureWalledGardenIpHost(site, host, 'JM WiFi Pay HTTPS'));
      } catch (e) {
        results.errors.push(`ip-host ${host}: ${e.message}`);
      }
    }
  }
  for (const ip of WIFI_PAY_WALLED_IPS) {
    try {
      results.ips.push(await ensureWalledGardenIp(site, ip, 'JM WiFi Pay DNS/IP'));
    } catch (e) {
      results.errors.push(`ip ${ip}: ${e.message}`);
    }
  }
  const added =
    results.hosts.filter((h) => !h.skipped).length
    + results.ipHosts.filter((h) => !h.skipped).length
    + results.ips.filter((i) => !i.skipped).length;
  const skipped =
    results.hosts.filter((h) => h.skipped).length
    + results.ipHosts.filter((h) => h.skipped).length
    + results.ips.filter((i) => i.skipped).length;
  return {
    ok: results.errors.length === 0,
    added,
    skipped,
    cleaned: results.cleaned.length,
    hosts: results.hosts,
    ipHosts: results.ipHosts,
    ips: results.ips,
    errors: results.errors,
  };
}

/**
 * Create (or refresh) a paid hotspot user for auto-login after PayMongo.
 */
export async function upsertHotspotUser(site, {
  username,
  password,
  profile = 'default',
  limitUptime,
  macAddress = '',
  comment = '',
  server = 'all',
} = {}) {
  const name = String(username || '').trim();
  if (!name) throw new Error('username required');
  const pass = String(password || name);
  const body = {
    name,
    password: pass,
    profile: profile || 'default',
    server: server || 'all',
    disabled: 'false',
  };
  if (limitUptime) body['limit-uptime'] = String(limitUptime);
  if (comment) body.comment = String(comment).slice(0, 240);
  const mac = String(macAddress || '').trim().toUpperCase();
  if (mac && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
    body['mac-address'] = mac;
  }

  const existing = await findOne(site, 'ip/hotspot/user', { name }).catch(() => null);
  if (existing?.['.id']) {
    await rest(site, 'PATCH', `ip/hotspot/user/${existing['.id']}`, body);
    return { ok: true, updated: true, id: existing['.id'], username: name, password: pass };
  }
  const created = await rest(site, 'PUT', 'ip/hotspot/user', body);
  return { ok: true, updated: false, id: created?.['.id'], username: name, password: pass };
}

/** Disable expired paid users (called from fulfill/cleanup). */
export async function disableHotspotUser(site, username) {
  const name = String(username || '').trim();
  if (!name) return { ok: false, error: 'username required' };
  const existing = await findOne(site, 'ip/hotspot/user', { name }).catch(() => null);
  if (!existing?.['.id']) return { ok: true, skipped: true };
  await rest(site, 'PATCH', `ip/hotspot/user/${existing['.id']}`, { disabled: 'true' });
  return { ok: true, id: existing['.id'] };
}

export { rest as wifiPayMikrotikRest, findOne as wifiPayMikrotikFindOne };
