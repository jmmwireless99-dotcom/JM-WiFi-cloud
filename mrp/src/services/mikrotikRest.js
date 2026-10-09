/**
 * MikroTik RouterOS 7 REST client — push VLAN / DHCP / hotspot from VPS over VPN.
 * Uses http://host/rest/... with Basic auth (api_user / api_password on site).
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

function formatIdle(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${d}d ${h}h ${m}m ${ss}s`;
}

/** 10.101.0.1/24 → 10.101.0.0/24 */
export function toNetworkCidr(cidr) {
  const raw = String(cidr || '').trim();
  const [ip, bitsRaw] = raw.split('/');
  const mask = Number(bitsRaw);
  if (!ip || !Number.isFinite(mask) || mask < 0 || mask > 32) return raw;
  const parts = ip.split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return raw;
  const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const maskBits = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  const net = (n & maskBits) >>> 0;
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${mask}`;
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

async function ensure(site, path, query, body, steps, label) {
  const existing = await findOne(site, path, query).catch(() => null);
  if (existing?.['.id']) {
    steps.push({ step: label, ok: true, skipped: true, id: existing['.id'] });
    return existing;
  }
  const created = await rest(site, 'PUT', path, body);
  steps.push({ step: label, ok: true, skipped: false, id: created?.['.id'] });
  return created;
}

/**
 * Push VLAN + pool + address + DHCP + hotspot (+ optional masquerade) to MikroTik.
 * Idempotent by name / comment where possible.
 */
export async function applyHotspotServer(site, srv) {
  const ifName = srv.name || `vlan-${srv.vlan_id}`;
  const poolName = `pool-${ifName}`;
  const dhcpName = `dhcp-${ifName}`;
  const gw = String(srv.address || '').split('/')[0];
  const net = toNetworkCidr(srv.address);
  const siteName = site.name || 'site';
  const idle = formatIdle(srv.idle_timeout_sec ?? srv.idleTimeoutSec ?? 600);
  const profile = srv.server_profile || srv.serverProfile || 'default';
  const parent = srv.parent_interface || srv.parentInterface;
  const steps = [];
  const errors = [];

  // Probe connectivity first
  try {
    await rest(site, 'GET', 'system/resource');
    steps.push({ step: 'connect', ok: true });
  } catch (e) {
    return { ok: false, applied: false, steps, errors: [e.message], ifName };
  }

  try {
    await ensure(
      site,
      'interface/vlan',
      { name: ifName },
      {
        name: ifName,
        'vlan-id': String(srv.vlan_id ?? srv.vlanId),
        interface: parent,
        comment: `JM Cloud Hotspot ${siteName}`,
      },
      steps,
      'interface vlan',
    );
  } catch (e) {
    errors.push(e.message);
    return { ok: false, applied: false, steps, errors, ifName };
  }

  try {
    await ensure(
      site,
      'ip/pool',
      { name: poolName },
      { name: poolName, ranges: `${srv.ip_start || srv.ipStart}-${srv.ip_end || srv.ipEnd}` },
      steps,
      'ip pool',
    );
  } catch (e) {
    steps.push({ step: 'ip pool', ok: false, error: e.message });
  }

  try {
    let addr = await findOne(site, 'ip/address', { comment: `${ifName} gateway` }).catch(() => null);
    if (!addr?.['.id']) {
      addr = await findOne(site, 'ip/address', { interface: ifName }).catch(() => null);
    }
    if (addr?.['.id']) {
      steps.push({ step: 'ip address', ok: true, skipped: true, id: addr['.id'] });
    } else {
      const created = await rest(site, 'PUT', 'ip/address', {
        address: srv.address,
        interface: ifName,
        comment: `${ifName} gateway`,
      });
      steps.push({ step: 'ip address', ok: true, skipped: false, id: created?.['.id'] });
    }
  } catch (e) {
    steps.push({ step: 'ip address', ok: false, error: e.message });
  }

  try {
    await ensure(
      site,
      'ip/dhcp-server',
      { name: dhcpName },
      {
        name: dhcpName,
        interface: ifName,
        'address-pool': poolName,
        'lease-time': '1h',
      },
      steps,
      'dhcp-server',
    );
  } catch (e) {
    steps.push({ step: 'dhcp-server', ok: false, error: e.message });
  }

  try {
    const existingNet = await findOne(site, 'ip/dhcp-server/network', { gateway: gw }).catch(() => null);
    if (existingNet?.['.id']) {
      steps.push({ step: 'dhcp-network', ok: true, skipped: true, id: existingNet['.id'] });
    } else {
      const created = await rest(site, 'PUT', 'ip/dhcp-server/network', {
        address: net,
        gateway: gw,
        'dns-server': gw,
      });
      steps.push({ step: 'dhcp-network', ok: true, skipped: false, id: created?.['.id'] });
    }
  } catch (e) {
    steps.push({ step: 'dhcp-network', ok: false, error: e.message });
  }

  try {
    let hs = await findOne(site, 'ip/hotspot', { name: ifName }).catch(() => null);
    if (hs?.['.id']) {
      steps.push({ step: 'hotspot', ok: true, skipped: true, id: hs['.id'] });
    } else {
      hs = await rest(site, 'PUT', 'ip/hotspot', {
        name: ifName,
        interface: ifName,
        'address-pool': poolName,
        profile,
        'idle-timeout': idle,
      });
      steps.push({ step: 'hotspot', ok: true, skipped: false, id: hs?.['.id'] });
    }
    // Enable if disabled
    if (hs?.['.id'] && String(hs.disabled) === 'true') {
      await rest(site, 'PATCH', `ip/hotspot/${hs['.id']}`, { disabled: 'false' });
      steps.push({ step: 'hotspot enable', ok: true });
    }
  } catch (e) {
    steps.push({ step: 'hotspot', ok: false, error: e.message });
  }

  const wantMasq = srv.masquerade !== false && srv.masquerade !== 'false';
  if (wantMasq) {
    try {
      const existing = await findOne(site, 'ip/firewall/nat', { comment: 'JM Hotspot NAT' }).catch(() => null);
      if (existing?.['.id']) {
        steps.push({ step: 'masquerade', ok: true, skipped: true, id: existing['.id'] });
      } else {
        const lists = await rest(site, 'GET', 'interface/list').catch(() => []);
        const hasWan = Array.isArray(lists) && lists.some((l) => String(l.name).toUpperCase() === 'WAN');
        const body = {
          chain: 'srcnat',
          action: 'masquerade',
          comment: 'JM Hotspot NAT',
        };
        if (hasWan) body['out-interface-list'] = 'WAN';
        const created = await rest(site, 'PUT', 'ip/firewall/nat', body);
        steps.push({ step: 'masquerade', ok: true, skipped: false, id: created?.['.id'], wanList: hasWan });
      }
    } catch (e) {
      // Non-fatal — VLAN/DHCP already applied
      steps.push({ step: 'masquerade', ok: false, error: e.message });
    }
  }

  const fatal = errors.some((m) => /interface vlan|connect|timeout|password|host missing/i.test(m));
  const applied = steps.some((s) => s.step === 'interface vlan' && s.ok);
  return {
    ok: applied && !fatal,
    applied,
    ifName,
    steps,
    errors,
  };
}

export async function probeMikrotik(site) {
  const data = await rest(site, 'GET', 'system/resource');
  return {
    ok: true,
    version: data?.version,
    board: data?.['board-name'],
    identity: data?.['architecture-name'],
    uptime: data?.uptime,
  };
}

/** Ensure HTTP walled-garden host (L7 Host match + HotSpot DNS-cache allow). */
export async function ensureWalledGardenHost(site, dstHost, comment = 'JM WiFi Cloud') {
  const host = String(dstHost || '').trim().toLowerCase();
  if (!host) throw new Error('dstHost required');
  const existing = await findOne(site, 'ip/hotspot/walled-garden', { 'dst-host': host }).catch(() => null);
  if (existing?.['.id']) {
    // Re-enable if previously disabled
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
 * QR image is proxied via our VPS; GCash/Maya apps still need their APIs.
 *
 * Exact names are dual-written to /ip/hotspot/walled-garden/ip (dst-host)
 * because HTTPS cannot be matched by the HTTP Host walled-garden alone.
 */
export const WIFI_PAY_WALLED_HOSTS = Object.freeze([
  // Our cloud (portal API + proxied QR PNG)
  'jmtechsolution.cloud',
  '*.jmtechsolution.cloud',
  // PayMongo (QRPH checkout / CDN / API)
  'paymongo.com',
  'www.paymongo.com',
  'api.paymongo.com',
  'checkout.paymongo.com',
  'links.paymongo.com',
  'cdn.paymongo.com',
  'assets.paymongo.com',
  '*.paymongo.com',
  // GCash app + APIs (no cellular)
  'gcash.com',
  'www.gcash.com',
  'm.gcash.com',
  'api.gcash.com',
  'app.gcash.com',
  'cdn.gcash.com',
  'payments.gcash.com',
  'glife.gcash.com',
  '*.gcash.com',
  // Mynt (GCash backend / PaaS)
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
  // Deep links / PulseID used when opening GCash from QR
  'gcashapp.page.link',
  'gcash-api.pulseid.com',
  '*.pulseid.com',
  // Alipay risk / objects CDN + Alipay+ rails (QRPH scans)
  'irisk-sea.alipay.com',
  'gw.alipayobjects.com',
  'alipay.com',
  '*.alipay.com',
  'alipayobjects.com',
  '*.alipayobjects.com',
  'alipayplus.com',
  '*.alipayplus.com',
  // Maya / PayMaya
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
  // Maya Bank
  'mayabank.ph',
  'api.mayabank.ph',
  'api-bnpl.mayabank.ph',
  '*.mayabank.ph',
  // Maya Voyager stack (app APIs)
  'comms-client-api-production.voyagerapis.com',
  'glimpse.voyagerapis.com',
  '*.voyagerapis.com',
  'updater.voyagerinnovation.com',
  '*.voyagerinnovation.com',
]);

/** Public DNS + cloud IP so name resolution / direct IP still works pre-login. */
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

/**
 * HTTPS destinations must use IP walled-garden with dst-host (RouterOS resolves
 * and accepts those IPs). Wildcards are not valid here — HTTP WG covers *.domain.
 */
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

/** Remove botched empty dst-host rows (IPs accidentally PUT into HTTP WG). */
async function cleanupBrokenWalledGardenHosts(site) {
  const rows = await rest(site, 'GET', 'ip/hotspot/walled-garden').catch(() => []);
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const removed = [];
  for (const r of list) {
    const dst = String(r['dst-host'] || '').trim();
    const comment = String(r.comment || '');
    if (!dst && /JM WiFi Pay DNS/i.test(comment) && r['.id']) {
      try {
        await rest(site, 'DELETE', `ip/hotspot/walled-garden/${encodeURIComponent(r['.id'])}`);
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
 * Dual-writes exact hosts to HTTP WG + IP WG (dst-host) for HTTPS.
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
    // Exact names → IP WG dst-host so HTTPS/app traffic works pre-login
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
 * limit-uptime = online time; comment stores absolute validity for cleanup.
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

export { rest as mikrotikRest, findOne as mikrotikFindOne };

const CCTV_IFACE = 'sstp-cctv';
const CCTV_TAG = 'JM TECH SOLUTION';

/**
 * Ensure SSTP firewall forward + dst-nat rules so hub can pull RTSP from LAN cameras/NVR.
 * Idempotent by comment. cameras: [{ name, tunnelPort, lanIp, rtspPort }]
 */
export async function pushCameraNat(site, cameras = []) {
  const steps = [];
  const errors = [];
  try {
    await rest(site, 'GET', 'system/resource');
    steps.push({ step: 'connect', ok: true });
  } catch (e) {
    return { ok: false, applied: false, steps, errors: [e.message] };
  }

  // Allow hub → camera via dstnat on SSTP
  try {
    const comment = `${CCTV_TAG}: hub to camera`;
    const existing = await findOne(site, 'ip/firewall/filter', { comment }).catch(() => null);
    if (existing?.['.id']) {
      steps.push({ step: 'forward dstnat', ok: true, skipped: true });
    } else {
      await rest(site, 'PUT', 'ip/firewall/filter', {
        chain: 'forward',
        action: 'accept',
        'connection-nat-state': 'dstnat',
        'in-interface': CCTV_IFACE,
        comment,
      });
      steps.push({ step: 'forward dstnat', ok: true, skipped: false });
    }
  } catch (e) {
    steps.push({ step: 'forward dstnat', ok: false, error: e.message });
    errors.push(e.message);
  }

  for (const cam of cameras) {
    const name = String(cam.name || 'cam').trim();
    const tunnelPort = Number(cam.tunnelPort ?? cam.tunnel_port);
    const lanIp = String((cam.lanIp ?? cam.lan_ip) || '').trim();
    const rtspPort = Number(cam.rtspPort ?? cam.rtsp_port ?? 554) || 554;
    if (!tunnelPort || !lanIp) {
      steps.push({ step: `nat ${name}`, ok: false, error: 'missing tunnelPort/lanIp' });
      continue;
    }
    const comment = `${CCTV_TAG}: ${name}`;
    try {
      const rows = await rest(site, 'GET', `ip/firewall/nat?comment=${encodeURIComponent(comment)}`).catch(() => []);
      const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      const hit = list.find((r) => String(r.comment) === comment) || null;
      const body = {
        chain: 'dstnat',
        'in-interface': CCTV_IFACE,
        protocol: 'tcp',
        'dst-port': String(tunnelPort),
        action: 'dst-nat',
        'to-addresses': lanIp,
        'to-ports': String(rtspPort),
        comment,
      };
      if (hit?.['.id']) {
        await rest(site, 'PATCH', `ip/firewall/nat/${hit['.id']}`, body);
        steps.push({ step: `nat ${name}`, ok: true, skipped: false, updated: true, id: hit['.id'] });
      } else {
        const created = await rest(site, 'PUT', 'ip/firewall/nat', body);
        steps.push({ step: `nat ${name}`, ok: true, skipped: false, id: created?.['.id'] });
      }
    } catch (e) {
      steps.push({ step: `nat ${name}`, ok: false, error: e.message });
      errors.push(`${name}: ${e.message}`);
    }
  }

  const applied = steps.some((s) => String(s.step).startsWith('nat ') && s.ok);
  return { ok: errors.length === 0 && steps.some((s) => s.step === 'connect' && s.ok), applied, steps, errors };
}
