/**
 * Push Hotspot Server settings from DB directly to MikroTik (RouterOS API :8728).
 */
const net = require('net');
const db = require('../db');
const { getPublicBaseUrl, getLoginHtmlUrl, getWalledGardenHosts } = require('./public-url');
const {
  uploadHotspotPortal,
  ensureWalledGardenIps,
  ensureHotspotRunning
} = require('./mikrotik-files');

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
      this.sock.setTimeout(90000);
      this.sock.on('error', reject);
      this.sock.on('timeout', () => reject(new Error('socket timeout')));
      this.sock.on('data', (c) => { this.buf = Buffer.concat([this.buf, c]); });
    });
  }

  close() {
    try { this.sock?.destroy(); } catch {}
  }

  async readReply(timeoutMs = 90000) {
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

async function uploadLoginHtml(api, site, siteId, options = {}) {
  return uploadHotspotPortal(api, site, siteId, options);
}

async function ensureIfaceIp(api, iface, ip, comment, steps) {
  const addr = `${ip}/24`;
  const addrs = await api.call(['/ip/address/print', `?interface=${iface}`]);
  const subnetPrefix = ip.split('.').slice(0, 3).join('.');
  const existing = addrs.find((a) => String(a.address || '').startsWith(`${subnetPrefix}.`));
  if (existing && existing.address !== addr) {
    await api.call(['/ip/address/set', `=.id=${existing['.id']}`, `=address=${addr}`, `=comment=${comment}`]);
    steps.push(`VLAN gateway ${ip} on ${iface}`);
  } else if (!addrs.some((a) => a.address === addr)) {
    await safeAdd(api, '/ip/address/add', { address: addr, interface: iface, comment });
    steps.push(`VLAN gateway ${ip} on ${iface}`);
  }
}

async function ensurePortalIp(api, iface, portalAddress, steps) {
  const portalAddr = `${portalAddress}/24`;
  const addrs = await api.call(['/ip/address/print', `?interface=${iface}`]);
  if (!addrs.some((a) => String(a.address || '').startsWith(`${portalAddress.split('.').slice(0, 3).join('.')}.`))) {
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

function resolveHotspotTarget(server, options = {}) {
  const selected = String(server.interface_name || '').trim();
  const vlanIds = parseVlanIds(server);
  const vlanMatch = selected.match(/^VLAN(\d+)$/i);
  const defaultParent = options.vlanParent || process.env.MIKROTIK_VLAN_PARENT || 'bridge-local';

  if (vlanMatch) {
    const vid = Number(vlanMatch[1]);
    return {
      selected,
      targetIface: `VLAN${vid}`,
      ensureVids: [{ vid, parent: defaultParent }]
    };
  }

  if (vlanIds.length >= 1 && vlanIds[0] > 0) {
    const vid = vlanIds[0];
    return {
      selected,
      targetIface: `VLAN${vid}`,
      ensureVids: [{ vid, parent: selected }]
    };
  }

  return { selected, targetIface: selected, ensureVids: [] };
}

async function cleanupMisplacedIps(api, parentIface, hsName, steps) {
  const addrs = await api.call(['/ip/address/print', `?interface=${parentIface}`]);
  for (const row of addrs) {
    const c = String(row.comment || '');
    if (c.includes(hsName) || c.startsWith('JM VLAN') || c.includes('JM Hotspot captive portal')) {
      try {
        await api.call(['/ip/address/remove', `=.id=${row['.id']}`]);
        steps.push(`Removed IP ${row.address} from ${parentIface} (ilipat sa VLAN)`);
      } catch {}
    }
  }
}

async function ensureVlanInterface(api, vid, vlanParent, comment) {
  const vname = `VLAN${vid}`;
  const existing = await api.call(['/interface/vlan/print', `?name=${vname}`]);
  if (existing.length) {
    const row = existing[0];
    const needsParent = String(row.interface || '') !== vlanParent;
    const words = ['/interface/vlan/set', `=.id=${row['.id']}`, `=comment=${comment}`];
    if (needsParent) words.push(`=interface=${vlanParent}`);
    if (String(row['vlan-id'] || '') !== String(vid)) words.push(`=vlan-id=${String(vid)}`);
    try {
      await api.call(words);
    } catch (e) {
      console.log('[mikrotik-push] vlan set warn:', e.message);
    }
    return vname;
  }
  await safeAdd(api, '/interface/vlan/add', {
    name: vname,
    'vlan-id': String(vid),
    interface: vlanParent,
    comment
  });
  return vname;
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
  const cloud = (options.cloudUrl || getPublicBaseUrl(options)).replace(/\/$/, '');

  const central = isCentralHotspot(site);
  const selected = String(server.interface_name || '').trim();
  if (!selected) {
    return { success: false, error: 'Pili ng parent interface sa admin (hal. ether2-OUT)' };
  }
  const { targetIface, ensureVids, selected: parentIface } = resolveHotspotTarget(server, options);
  const hsIface = targetIface;
  const vlanNet = parseGateway(server.hs_address || CENTRAL_GATEWAY);
  const portalAddress = central ? CENTRAL_GATEWAY : vlanNet.gw;
  const hsName = server.name || hsIface;
  const profileName = server.profile_name || 'jmwifi';
  const dnsName = server.dns_name || 'jmwifi.local';
  const htmlDir = server.html_directory || 'hotspot';
  const loginBy = server.login_by || 'http-pap,cookie';
  const { gw: vlanGw, network, pool } = vlanNet;
  const poolName = `pool-${hsName}`.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const dhcpName = `dhcp-${hsName}`.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

  const api = new RouterOS(host, port);
  const steps = [];

  try {
    await api.connect();
    await api.login(user, pass);
    const identity = await api.call(['/system/identity/print']);
    steps.push(`Connected: ${identity[0]?.name || host}`);

    const login = await uploadLoginHtml(api, site, site.id, options);
    if (login.ok) {
      steps.push(...(login.steps || [`login.html uploaded (${login.size} bytes) via ${login.method}`]));
    } else {
      steps.push(`ERROR: ${login.error || 'login.html upload failed'}`);
      if (login.steps) steps.push(...login.steps);
      api.close();
      return {
        success: false,
        error: login.error || 'login.html hindi na-upload — walang captive portal sa http://10.0.0.1',
        steps
      };
    }

    for (const { vid, parent } of ensureVids) {
      if (vid > 0) {
        await ensureVlanInterface(api, vid, parent, `JM Hotspot ${hsName}`);
        steps.push(`Created VLAN${vid} on ${parent}`);
      }
    }
    if (ensureVids.length) {
      steps.push(`Hotspot target ${hsIface} (parent ${parentIface})`);
    } else {
      steps.push(`Interface ${hsIface}`);
    }
    if (parentIface !== hsIface) {
      await cleanupMisplacedIps(api, parentIface, hsName, steps);
    }

    await ensureOrSet(api, '/ip/pool', 'name', poolName, { name: poolName, ranges: pool });

    await ensureIfaceIp(api, hsIface, vlanGw, `JM VLAN ${hsName}`, steps);
    if (central) {
      await ensurePortalIp(api, hsIface, CENTRAL_GATEWAY, steps);
    } else if (portalAddress !== vlanGw) {
      await ensurePortalIp(api, hsIface, portalAddress, steps);
    }
    steps.push(`Client DHCP ${network} gw ${vlanGw} · portal ${portalAddress}`);

    const existingDhcp = await api.call(['/ip/dhcp-server/print', `?interface=${hsIface}`]);
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
        interface: hsIface,
        'address-pool': poolName,
        'lease-time': '30m'
      });
    }

    const nets = await api.call(['/ip/dhcp-server/network/print', `?address=${network}`]);
    if (nets.length) {
      await api.call([
        '/ip/dhcp-server/network/set',
        `=.id=${nets[0]['.id']}`,
        `=gateway=${vlanGw}`,
        `=dns-server=${vlanGw}`
      ]);
    } else {
      await safeAdd(api, '/ip/dhcp-server/network/add', {
        address: network,
        gateway: vlanGw,
        'dns-server': vlanGw
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

    if (central) await removeExtraHotspots(api, hsIface, hsName);

    await ensureOrSet(api, '/ip/hotspot', 'name', hsName, {
      name: hsName,
      interface: hsIface,
      'address-pool': poolName,
      profile: profileName,
      'idle-timeout': 'none',
      'keepalive-timeout': '2m',
      disabled: 'no'
    });

    for (const dst of getWalledGardenHosts(options)) {
      const wg = await api.call(['/ip/hotspot/walled-garden/print', `?dst-host=${dst}`]);
      if (!wg.length) {
        await safeAdd(api, '/ip/hotspot/walled-garden/add', { 'dst-host': dst, comment: 'JM WiFi Cloud' });
      }
    }
    await ensureWalledGardenIps(api, options, steps);
    steps.push('Walled garden updated for cloud portal');

    const natComment = `JM Hotspot NAT ${hsName}`;
    const nat = await api.call(['/ip/firewall/nat/print', `?comment=${natComment}`]);
    if (!nat.length) {
      await safeAdd(api, '/ip/firewall/nat/add', {
        chain: 'srcnat',
        'src-address': network,
        action: 'masquerade',
        comment: natComment
      });
    } else {
      await api.call([
        '/ip/firewall/nat/set',
        `=.id=${nat[0]['.id']}`,
        `=src-address=${network}`
      ]);
    }

    await ensurePauseProfile(api, site, cloud, steps);

    await ensureHotspotRunning(api, hsName, steps);

    const hs = await api.call(['/ip/hotspot/print', `?name=${hsName}`]);
    steps.push(`Hotspot ${hsName} on ${hsIface} · open http://10.0.0.1`);

    api.close();
    return {
      success: true,
      host,
      identity: identity[0]?.name,
      gateway: vlanGw,
      client_network: network,
      hotspot_address: portalAddress,
      interface: hsIface,
      parent_interface: parentIface,
      vlans: ensureVids.map((v) => v.vid),
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

async function withRouterOS(site, fn, options = {}) {
  const host = site.mikrotik_host;
  const port = Number(options.apiPort || process.env.MIKROTIK_API_PORT || 8728);
  const user = site.mikrotik_user || 'admin';
  const pass = site.mikrotik_pass;
  const api = new RouterOS(host, port);
  try {
    await api.connect();
    await api.login(user, pass);
    return await fn(api);
  } finally {
    api.close();
  }
}

async function removeByName(api, menuPath, name) {
  const found = await api.call([`${menuPath}/print`, `?name=${name}`]);
  for (const row of found) {
    try {
      await api.call([`${menuPath}/remove`, `=.id=${row['.id']}`]);
    } catch (e) {
      console.log('[mikrotik-push] remove warn:', e.message);
    }
  }
  return found.length;
}

async function removeByComment(api, menuPath, comment) {
  const found = await api.call([`${menuPath}/print`, `?comment=${comment}`]);
  for (const row of found) {
    try {
      await api.call([`${menuPath}/remove`, `=.id=${row['.id']}`]);
    } catch (e) {
      console.log('[mikrotik-push] remove warn:', e.message);
    }
  }
  return found.length;
}

async function removeByInterface(api, menuPath, iface) {
  const found = await api.call([`${menuPath}/print`, `?interface=${iface}`]);
  for (const row of found) {
    try {
      await api.call([`${menuPath}/remove`, `=.id=${row['.id']}`]);
    } catch (e) {
      console.log('[mikrotik-push] remove by iface warn:', e.message);
    }
  }
  return found.length;
}

async function removeVlanInterface(api, vname, steps) {
  const found = await api.call(['/interface/vlan/print', `?name=${vname}`]);
  for (const row of found) {
    try {
      await api.call(['/interface/vlan/remove', `=.id=${row['.id']}`]);
      steps.push(`Removed VLAN interface ${vname}`);
    } catch (e) {
      steps.push(`WARN: VLAN ${vname} — ${e.message}`);
    }
  }
  return found.length;
}

/**
 * Remove hotspot server resources from MikroTik (mirror of push).
 */
async function deleteHotspotServer(server, options = {}) {
  const site = options.site || resolveSite(server);
  if (!site?.mikrotik_host || !site?.mikrotik_pass) {
    return { success: false, error: 'Walang MikroTik credentials' };
  }
  if (!server?.interface_name) {
    return { success: false, error: 'Walang interface_name sa record' };
  }

  const { targetIface, ensureVids } = resolveHotspotTarget(server, options);
  const hsIface = targetIface;
  const hsName = server.name || hsIface;
  const { network } = parseGateway(server.hs_address || CENTRAL_GATEWAY);
  const poolName = `pool-${hsName}`.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const dhcpName = `dhcp-${hsName}`.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const natComment = `JM Hotspot NAT ${hsName}`;
  const dnsName = server.dns_name || 'jmwifi.local';
  const steps = [];

  try {
    await withRouterOS(site, async (api) => {
      let hsRemoved = await removeByName(api, '/ip/hotspot', hsName);
      if (!hsRemoved) {
        hsRemoved = await removeByInterface(api, '/ip/hotspot', hsIface);
      }
      if (hsRemoved) steps.push(`Removed hotspot on ${hsIface}`);

      let dhcpRemoved = await removeByName(api, '/ip/dhcp-server', dhcpName);
      if (!dhcpRemoved) {
        dhcpRemoved = await removeByInterface(api, '/ip/dhcp-server', hsIface);
      }
      if (dhcpRemoved) steps.push(`Removed DHCP on ${hsIface}`);

      const poolRemoved = await removeByName(api, '/ip/pool', poolName);
      if (poolRemoved) steps.push(`Removed pool ${poolName}`);

      const natRemoved = await removeByComment(api, '/ip/firewall/nat', natComment);
      if (natRemoved) steps.push(`Removed NAT ${natComment}`);

      const nets = await api.call(['/ip/dhcp-server/network/print', `?address=${network}`]);
      for (const row of nets) {
        try {
          await api.call(['/ip/dhcp-server/network/remove', `=.id=${row['.id']}`]);
          steps.push(`Removed DHCP network ${network}`);
        } catch {}
      }

      const addrs = await api.call(['/ip/address/print', `?interface=${hsIface}`]);
      for (const row of addrs) {
        try {
          await api.call(['/ip/address/remove', `=.id=${row['.id']}`]);
          steps.push(`Removed IP ${row.address} on ${hsIface}`);
        } catch {}
      }

      const dnsRemoved = await removeByName(api, '/ip/dns/static', dnsName);
      if (dnsRemoved) steps.push(`Removed DNS static ${dnsName}`);

      if (/^VLAN\d+$/i.test(hsIface)) {
        await removeVlanInterface(api, hsIface, steps);
      }
      for (const { vid } of ensureVids) {
        if (vid > 0) await removeVlanInterface(api, `VLAN${vid}`, steps);
      }
    }, options);

    return {
      success: true,
      host: site.mikrotik_host,
      hotspot: hsName,
      interface: hsIface,
      steps: steps.length ? steps : ['Walang matching config sa MikroTik (OK)']
    };
  } catch (err) {
    return { success: false, error: err.message, steps };
  }
}

/**
 * Remove hotspot user profile from MikroTik.
 */
async function deleteHotspotProfile(profile, site) {
  if (!site?.mikrotik_host || !site?.mikrotik_pass) {
    return { success: false, error: 'Walang MikroTik credentials' };
  }
  const name = profile?.name;
  if (!name) return { success: false, error: 'Profile name required' };
  if (name === 'default') {
    return { success: false, error: 'Hindi pwedeng i-delete ang default profile sa MikroTik' };
  }

  try {
    let removed = 0;
    await withRouterOS(site, async (api) => {
      removed = await removeByName(api, '/ip/hotspot/user/profile', name);
    });
    return {
      success: true,
      host: site.mikrotik_host,
      profile: name,
      removed: removed > 0,
      steps: removed ? [`Removed user profile ${name}`] : [`Profile ${name} wala na sa MikroTik`]
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  CENTRAL_GATEWAY,
  pushHotspotServer,
  pushHotspotProfile,
  deleteHotspotServer,
  deleteHotspotProfile,
  resolveSite,
  parseGateway,
  parseVlanIds,
  isCentralHotspot
};
