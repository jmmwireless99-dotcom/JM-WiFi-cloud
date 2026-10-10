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

const CCTV_IFACE = 'sstp-cctv';
const CCTV_TAG = 'JM TECH SOLUTION';

/**
 * Ensure SSTP firewall forward + dst-nat rules so hub can pull RTSP from LAN cameras/NVR.
 * Dedupes by tunnelPort (NVR multi-channel shares one port → one NAT rule).
 * Cleans leftover duplicate dst-port rules from older per-camera pushes.
 * cameras: [{ name, tunnelPort, lanIp, rtspPort }]
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

  // One NAT rule per tunnel port (shared NVR channel model)
  const byPort = new Map();
  for (const cam of cameras) {
    const tunnelPort = Number(cam.tunnelPort ?? cam.tunnel_port);
    const lanIp = String((cam.lanIp ?? cam.lan_ip) || '').trim();
    const rtspPort = Number(cam.rtspPort ?? cam.rtsp_port ?? 554) || 554;
    const name = String(cam.name || 'cam').trim();
    if (!tunnelPort || !lanIp) {
      steps.push({ step: `nat ${name}`, ok: false, error: 'missing tunnelPort/lanIp' });
      continue;
    }
    if (!byPort.has(tunnelPort)) {
      byPort.set(tunnelPort, { name, tunnelPort, lanIp, rtspPort, aliases: [name] });
    } else {
      byPort.get(tunnelPort).aliases.push(name);
    }
  }

  let allNat = [];
  try {
    const rows = await rest(site, 'GET', 'ip/firewall/nat');
    allNat = Array.isArray(rows) ? rows : [];
  } catch (e) {
    errors.push(`list nat: ${e.message}`);
  }

  for (const entry of byPort.values()) {
    const shared = entry.aliases.length > 1;
    const comment = shared
      ? `${CCTV_TAG}: NVR-RTSP :${entry.tunnelPort}`
      : `${CCTV_TAG}: ${entry.name}`;
    const body = {
      chain: 'dstnat',
      'in-interface': CCTV_IFACE,
      protocol: 'tcp',
      'dst-port': String(entry.tunnelPort),
      action: 'dst-nat',
      'to-addresses': entry.lanIp,
      'to-ports': String(entry.rtspPort),
      comment,
      disabled: 'false',
    };
    try {
      const samePort = allNat.filter((r) => String(r['dst-port']) === String(entry.tunnelPort));
      let keep = samePort.find((r) => String(r.comment) === comment)
        || samePort.find((r) => String(r.comment || '').includes('NVR-RTSP'))
        || samePort[0]
        || null;
      // Drop extras with same dst-port (old per-camera duplicates)
      for (const r of samePort) {
        if (keep && r['.id'] === keep['.id']) continue;
        try {
          await rest(site, 'DELETE', `ip/firewall/nat/${r['.id']}`);
          steps.push({ step: `nat cleanup ${r['.id']}`, ok: true, removed: true });
        } catch (e) {
          steps.push({ step: `nat cleanup ${r['.id']}`, ok: false, error: e.message });
        }
      }
      if (keep?.['.id']) {
        await rest(site, 'PATCH', `ip/firewall/nat/${keep['.id']}`, body);
        steps.push({
          step: `nat :${entry.tunnelPort}`,
          ok: true,
          updated: true,
          id: keep['.id'],
          cameras: entry.aliases.length,
        });
      } else {
        const created = await rest(site, 'PUT', 'ip/firewall/nat', body);
        steps.push({
          step: `nat :${entry.tunnelPort}`,
          ok: true,
          id: created?.['.id'],
          cameras: entry.aliases.length,
        });
      }
    } catch (e) {
      steps.push({ step: `nat :${entry.tunnelPort}`, ok: false, error: e.message });
      errors.push(`:${entry.tunnelPort}: ${e.message}`);
    }
  }

  const applied = steps.some((s) => String(s.step).startsWith('nat ') && s.ok);
  return { ok: errors.length === 0 && steps.some((s) => s.step === 'connect' && s.ok), applied, steps, errors };
}
