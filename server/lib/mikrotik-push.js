/**
 * Push Hotspot Server settings from DB directly to MikroTik (RouterOS API :8728).
 */
const net = require('net');
const db = require('../db');

const CENTRAL_GATEWAY = '10.0.0.1';

function isCentralHotspot(site) {
  return !site || String(site.module_type || 'hotspot') !== 'empty_bottle';
}

function parseGateway(hsAddress) {
  const gw = String(hsAddress || CENTRAL_GATEWAY).split('/')[0].trim();
  const p = gw.split('.');
  if (p.length !== 4) throw new Error('Invalid hs_address: ' + hsAddress);
  const network = `${p[0]}.${p[1]}.${p[2]}.0/24`;
  const pool = `${p[0]}.${p[1]}.${p[2]}.10-${p[0]}.${p[1]}.${p[2]}.254`;
  return { gw, network, pool };
}

function parseVlanIds(server) {
  if (server.vlan_ids) {
    return String(server.vlan_ids).split(',').map((v) => Number(v.trim())).filter((n) => n > 0);
  }
  const single = Number(server.vlan_id);
  if (single > 0) return [single];
  return [101, 102];
}

function resolveSite(server) {
  if (server.site_id) {
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(server.site_id);
  }
  return db.prepare(`
    SELECT * FROM sites
    WHERE COALESCE(module_type, 'hotspot') = 'hotspot'
      AND mikrotik_host IS NOT NULL AND mikrotik_host != ''
    ORDER BY created_at ASC LIMIT 1
  `).get();
}

function encodeLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n >> 8) | 0x80, n & 0xff]);
  if (n < 0x200000) return Buffer.from([(n >> 16) | 0xc0, (n >> 8) & 0xff, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = 0xf0;
  b.writeUInt32BE(n, 1);
  return b;
}

function encodeWord(word) {
  const data = Buffer.from(String(word), 'utf8');
  return Buffer.concat([encodeLength(data.length), data]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

function decodeSentences(buf) {
  const sentences = [];
  let i = 0;
  let cur = [];
  while (i < buf.length) {
    let len = buf[i++];
    if (len === 0) {
      if (cur.length) sentences.push(cur);
      cur = [];
      continue;
    }
    if (len & 0x80) {
      if ((len & 0xc0) === 0x80) len = ((len & 0x3f) << 8) + buf[i++];
      else if ((len & 0xe0) === 0xc0) { len = ((len & 0x1f) << 16) + (buf[i] << 8) + buf[i + 1]; i += 2; }
    }
    cur.push(buf.slice(i, i + len).toString('utf8'));
    i += len;
  }
  if (cur.length) sentences.push(cur);
  return sentences;
}

class RouterOS {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.buf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.createConnection({ host: this.host, port: this.port }, () => resolve());
      this.sock.setTimeout(25000);
      this.sock.on('error', reject);
      this.sock.on('timeout', () => reject(new Error('socket timeout')));
      this.sock.on('data', (c) => { this.buf = Buffer.concat([this.buf, c]); });
    });
  }

  close() {
    try { this.sock?.destroy(); } catch {}
  }

  async readReply(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const sentences = decodeSentences(this.buf);
      if (sentences.some((s) => s[0] === '!done' || s[0] === '!trap' || s[0] === '!fatal')) {
        this.buf = Buffer.alloc(0);
        const trap = sentences.find((s) => s[0] === '!trap' || s[0] === '!fatal');
        if (trap) throw new Error(trap.join(' '));
        return sentences.filter((s) => s[0] === '!re').map((s) => {
          const o = {};
          for (const w of s.slice(1)) {
            if (w.startsWith('=')) {
              const eq = w.indexOf('=', 1);
              if (eq > 0) o[w.slice(1, eq)] = w.slice(eq + 1);
            }
          }
          return o;
        });
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('reply timeout');
  }

  async call(words) {
    this.sock.write(encodeSentence(words));
    return this.readReply();
  }

  async login(user, pass) {
    await this.call(['/login', `=name=${user}`, `=password=${pass}`]);
  }
}

async function safeAdd(api, addPath, props) {
  const words = [addPath];
  for (const [k, v] of Object.entries(props)) words.push(`=${k}=${v}`);
  return api.call(words);
}

async function ensureOrSet(api, menuPath, key, value, props) {
  const found = await api.call([`${menuPath}/print`, `?${key}=${value}`]);
  if (found.length) {
    const words = [`${menuPath}/set`, `=.id=${found[0]['.id']}`];
    for (const [k, v] of Object.entries(props)) {
      if (k === key) continue;
      words.push(`=${k}=${v}`);
    }
    try {
      await api.call(words);
    } catch (e) {
      console.log('[mikrotik-push] set warn:', e.message);
    }
    return found[0];
  }
  try {
    await safeAdd(api, `${menuPath}/add`, props);
  } catch (e) {
    console.log('[mikrotik-push] add warn:', e.message);
  }
  return null;
}

async function uploadLoginHtml(api, siteId, cloudBase) {
  const url = `${cloudBase.replace(/\/$/, '')}/mikrotik/login-${siteId}.html`;
  const attempts = [
    ['=mode=https', '=check-certificate=no'],
    ['=mode=http'],
    []
  ];
  for (const extra of attempts) {
    try {
      await api.call(['/tool/fetch', `=url=${url}`, '=dst-path=hotspot/login.html', ...extra]);
      const files = await api.call(['/file/print', '?name=login.html']);
      const hit = files.find((f) => String(f.name || '').includes('login.html'));
      if (hit && Number(hit.size || 0) > 100) return { ok: true, size: hit.size };
    } catch (e) {
      console.log('[mikrotik-push] fetch login warn:', e.message);
    }
  }
  return { ok: false, error: 'login.html hindi na-upload sa MikroTik' };
}

async function ensurePortalIp(api, iface, portalAddress, steps) {
  const portalAddr = `${portalAddress}/24`;
  const addrs = await api.call(['/ip/address/print', `?interface=${iface}`]);
  if (!addrs.some((a) => a.address === portalAddr)) {
    await safeAdd(api, '/ip/address/add', {
      address: portalAddr,
      interface: iface,
      comment: 'JM Hotspot captive portal'
    });
    steps.push(`Portal IP ${portalAddress} on ${iface}`);
  }
}

async function ensurePauseProfile(api, site, cloud, steps) {
  await ensureOrSet(api, '/ip/hotspot/user/profile', 'name', 'jmwifi-pause', {
    name: 'jmwifi-pause',
    'shared-users': '1',
    'rate-limit': '2M/5M',
    'keepalive-timeout': '2m',
    'idle-timeout': 'none',
    'status-autorefresh': '30s',
    'add-mac-cookie': 'yes',
    'mac-cookie-timeout': '1d',
    'transparent-proxy': 'no',
    comment: 'JM WiFi pause — no validity'
  });
  if (site?.api_key) {
    const onLogout =
      `/tool fetch url="${cloud}/api/session/pause" http-method=post ` +
      `http-data="{\\"mac\\":\\"$mac-address\\"}" ` +
      `http-header-field="Content-Type: application/json,X-API-Key: ${site.api_key}" keep-result=no`;
    try {
      await api.call([
        '/ip/hotspot/user/profile/set',
        '=numbers=jmwifi-pause',
        `=on-logout=${onLogout}`
      ]);
      steps.push('jmwifi-pause profile ready');
    } catch {}
  }
}

async function removeExtraHotspots(api, iface, keepName) {
  const all = await api.call(['/ip/hotspot/print', `?interface=${iface}`]);
  for (const hs of all) {
    if (hs.name && hs.name !== keepName) {
      try {
        await api.call(['/ip/hotspot/remove', `=.id=${hs['.id']}`]);
      } catch {}
    }
  }
}

/**
 * @param {object} server hotspot_servers row
 * @param {object} [options]
 */
async function pushHotspotServer(server, options = {}) {
  const site = options.site || resolveSite(server);
  if (!site?.mikrotik_host || !site?.mikrotik_pass) {
    return { success: false, error: 'Walang MikroTik credentials sa vendo site. I-set sa Vendo List.' };
  }

  const host = site.mikrotik_host;
  const port = Number(options.apiPort || process.env.MIKROTIK_API_PORT || 8728);
  const user = site.mikrotik_user || 'admin';
  const pass = site.mikrotik_pass;
  const cloud = (options.cloudUrl || process.env.BASE_URL || 'https://jmtechsolution.cloud/allvendo').replace(/\/$/, '');
  const bridgeLocal = options.bridgeLocal || 'bridge-local';

  const central = isCentralHotspot(site);
  const hsName = central ? 'CENTRAL' : (server.name || 'CENTRAL');
  const iface = server.interface_name || 'bridge-hotspot';
  const profileName = server.profile_name || 'jmwifi';
  const dnsName = server.dns_name || 'jmwifi.local';
  const htmlDir = server.html_directory || 'hotspot';
  const loginBy = server.login_by || 'http-pap,cookie';
  const vlanIds = parseVlanIds(server);
  const portalAddress = central ? CENTRAL_GATEWAY : parseGateway(server.hs_address).gw;
  const ifaceGw = central ? CENTRAL_GATEWAY : parseGateway(server.hs_address).gw;
  const extraIp = central && server.hs_address && parseGateway(server.hs_address).gw !== CENTRAL_GATEWAY
    ? parseGateway(server.hs_address).gw
    : null;
  const { network, pool } = parseGateway(central ? CENTRAL_GATEWAY : server.hs_address);
  const poolName = central ? 'pool-central' : `pool-${hsName}`.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const dhcpName = central ? 'dhcp-central' : `dhcp-${hsName}`.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

  const api = new RouterOS(host, port);
  const steps = [];

  try {
    await api.connect();
    await api.login(user, pass);
    const identity = await api.call(['/system/identity/print']);
    steps.push(`Connected: ${identity[0]?.name || host}`);

    const login = await uploadLoginHtml(api, site.id, cloud);
    if (login.ok) {
      steps.push(`login.html uploaded (${login.size} bytes)`);
    } else {
      steps.push(`WARN: ${login.error || 'login.html upload failed'}`);
    }

    await ensureOrSet(api, '/interface/bridge', 'name', iface, {
      name: iface,
      comment: `JM Hotspot ${hsName}`
    });

    for (const vid of vlanIds) {
      const vname = `VLAN${vid}`;
      await ensureOrSet(api, '/interface/vlan', 'name', vname, {
        name: vname,
        'vlan-id': String(vid),
        interface: bridgeLocal,
        comment: `JM Hotspot ${hsName}`
      });
      const ports = await api.call(['/interface/bridge/port/print', `?interface=${vname}`]);
      if (!ports.length) {
        await safeAdd(api, '/interface/bridge/port/add', {
          bridge: iface,
          interface: vname,
          comment: `HS ${hsName}`
        });
      } else if (ports[0].bridge !== iface) {
        await api.call([
          '/interface/bridge/port/set',
          `=.id=${ports[0]['.id']}`,
          `=bridge=${iface}`,
          `=comment=HS ${hsName}`
        ]);
      }
    }
    steps.push(`VLANs: ${vlanIds.join(', ')} → ${iface}`);

    await ensureOrSet(api, '/ip/pool', 'name', poolName, { name: poolName, ranges: pool });

    await ensurePortalIp(api, iface, portalAddress, steps);

    if (extraIp) {
      const extraAddr = `${extraIp}/24`;
      const addrs = await api.call(['/ip/address/print', `?interface=${iface}`]);
      if (!addrs.some((a) => a.address === extraAddr)) {
        await safeAdd(api, '/ip/address/add', {
          address: extraAddr,
          interface: iface,
          comment: `JM Hotspot ${server.name || 'extra'}`
        });
        steps.push(`Extra interface IP ${extraIp} on ${iface}`);
      }
    }
    steps.push(`Captive portal ${portalAddress} · DHCP ${network}`);

    const existingDhcp = await api.call(['/ip/dhcp-server/print', `?interface=${iface}`]);
    if (existingDhcp.length && existingDhcp[0].name !== dhcpName) {
      await api.call([
        '/ip/dhcp-server/set',
        `=.id=${existingDhcp[0]['.id']}`,
        `=name=${dhcpName}`,
        `=address-pool=${poolName}`,
        '=lease-time=30m'
      ]);
    } else {
      await ensureOrSet(api, '/ip/dhcp-server', 'name', dhcpName, {
        name: dhcpName,
        interface: iface,
        'address-pool': poolName,
        'lease-time': '30m'
      });
    }

    const nets = await api.call(['/ip/dhcp-server/network/print', `?address=${network}`]);
    const dhcpGw = central ? portalAddress : ifaceGw;
    if (nets.length) {
      await api.call([
        '/ip/dhcp-server/network/set',
        `=.id=${nets[0]['.id']}`,
        `=gateway=${dhcpGw}`,
        `=dns-server=${dhcpGw}`
      ]);
    } else {
      await safeAdd(api, '/ip/dhcp-server/network/add', {
        address: network,
        gateway: dhcpGw,
        'dns-server': dhcpGw
      });
    }

    await ensureOrSet(api, '/ip/dns/static', 'name', dnsName, {
      name: dnsName,
      address: portalAddress,
      comment: `Hotspot ${hsName}`
    });

    await ensureOrSet(api, '/ip/hotspot/profile', 'name', profileName, {
      name: profileName,
      'hotspot-address': portalAddress,
      'dns-name': dnsName,
      'html-directory': htmlDir,
      'login-by': loginBy,
      'http-cookie-lifetime': '1d'
    });
    steps.push(`Profile ${profileName} hotspot-address=${portalAddress}`);

    if (central) await removeExtraHotspots(api, iface, hsName);

    await ensureOrSet(api, '/ip/hotspot', 'name', hsName, {
      name: hsName,
      interface: iface,
      'address-pool': poolName,
      profile: profileName,
      'idle-timeout': 'none',
      'keepalive-timeout': '2m',
      disabled: 'no'
    });

    for (const dst of ['jmtechsolution.cloud', '*.jmtechsolution.cloud']) {
      const wg = await api.call(['/ip/hotspot/walled-garden/print', `?dst-host=${dst}`]);
      if (!wg.length) {
        await safeAdd(api, '/ip/hotspot/walled-garden/add', { 'dst-host': dst, comment: 'JM WiFi Cloud' });
      }
    }

    const natComment = central ? 'JM Hotspot NAT' : `JM Hotspot NAT ${hsName}`;
    const natNet = central ? '10.0.0.0/24' : network;
    const nat = await api.call(['/ip/firewall/nat/print', `?comment=${natComment}`]);
    if (!nat.length) {
      await safeAdd(api, '/ip/firewall/nat/add', {
        chain: 'srcnat',
        'src-address': natNet,
        action: 'masquerade',
        comment: natComment
      });
    } else {
      await api.call([
        '/ip/firewall/nat/set',
        `=.id=${nat[0]['.id']}`,
        `=src-address=${natNet}`
      ]);
    }

    await ensurePauseProfile(api, site, cloud, steps);

    const hs = await api.call(['/ip/hotspot/print', `?name=${hsName}`]);
    steps.push(`Hotspot ${hsName} active on ${iface}`);

    api.close();
    return {
      success: true,
      host,
      identity: identity[0]?.name,
      gateway: central ? portalAddress : ifaceGw,
      hotspot_address: portalAddress,
      vlans: vlanIds,
      hotspot: hs[0]?.name || hsName,
      steps
    };
  } catch (err) {
    api.close();
    return { success: false, error: err.message, steps };
  }
}

async function pushHotspotProfile(profile, site) {
  if (!site?.mikrotik_host || !site?.mikrotik_pass) {
    return { success: false, error: 'Walang MikroTik credentials' };
  }
  const host = site.mikrotik_host;
  const port = Number(process.env.MIKROTIK_API_PORT || 8728);
  const api = new RouterOS(host, port);
  try {
    await api.connect();
    await api.login(site.mikrotik_user || 'admin', site.mikrotik_pass);
    const name = profile.name;
    await ensureOrSet(api, '/ip/hotspot/user/profile', 'name', name, {
      name,
      'shared-users': String(profile.shared_users || 1),
      'rate-limit': profile.rate_limit || '2M/5M',
      'keepalive-timeout': profile.keepalive_timeout || '2m',
      'idle-timeout': profile.idle_timeout || 'none',
      'status-autorefresh': '30s',
      'add-mac-cookie': profile.mac_cookie === 0 ? 'no' : 'yes',
      'mac-cookie-timeout': '1d',
      'transparent-proxy': profile.transparent_proxy ? 'yes' : 'no',
      comment: profile.notes || 'JM WiFi profile'
    });
    api.close();
    return { success: true, host, profile: name };
  } catch (err) {
    api.close();
    return { success: false, error: err.message };
  }
}

module.exports = {
  CENTRAL_GATEWAY,
  pushHotspotServer,
  pushHotspotProfile,
  resolveSite,
  parseGateway,
  parseVlanIds,
  isCentralHotspot
};
