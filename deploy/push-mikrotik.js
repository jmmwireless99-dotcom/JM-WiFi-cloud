#!/usr/bin/env node
/**
 * Push JM WiFi Cloud CENTRAL hotspot (10.0.0.1) to MikroTik via RouterOS API.
 * Kitifi-style: all VLANs share one captive portal on bridge-hotspot.
 *
 * Usage:
 *   MIKROTIK_HOST=10.90.0.27 MIKROTIK_USER=admin MIKROTIK_PASS='...' \
 *   SITE_ID=... API_KEY=... VLAN_IDS=101,102 node deploy/push-mikrotik.js
 */
const net = require('net');

const HOST = process.env.MIKROTIK_HOST || '10.90.0.27';
const PORT = Number(process.env.MIKROTIK_API_PORT || 8728);
const USER = process.env.MIKROTIK_USER || 'admin';
const PASS = process.env.MIKROTIK_PASS || '';
const SITE_ID = process.env.SITE_ID || '';
const API_KEY = process.env.API_KEY || '';
const CLOUD = (process.env.BASE_URL || 'https://jmtechsolution.cloud/allvendo').replace(/\/$/, '');
const BRIDGE_LOCAL = process.env.BRIDGE_LOCAL || 'bridge-local';
const VLAN_IDS = String(process.env.VLAN_IDS || process.env.VLAN_ID || '101,102')
  .split(',')
  .map((v) => Number(String(v).trim()))
  .filter((n) => n > 0);
const HS_GW = process.env.HS_GATEWAY || '10.0.0.1';
const HS_NAME = process.env.HS_NAME || 'CENTRAL';

if (!PASS) {
  console.error('MIKROTIK_PASS required');
  process.exit(1);
}
if (!SITE_ID) {
  console.error('SITE_ID required');
  process.exit(1);
}

function encodeLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n >> 8) | 0x80, n & 0xff]);
  if (n < 0x200000) return Buffer.from([(n >> 16) | 0xc0, (n >> 8) & 0xff, n & 0xff]);
  if (n < 0x10000000) return Buffer.from([(n >> 24) | 0xe0, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
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
    let len = buf[i];
    i += 1;
    if (len === 0) {
      if (cur.length) sentences.push(cur);
      cur = [];
      continue;
    }
    if ((len & 0x80) === 0) {
      // ok
    } else if ((len & 0xc0) === 0x80) {
      len = ((len & 0x3f) << 8) + buf[i];
      i += 1;
    } else if ((len & 0xe0) === 0xc0) {
      len = ((len & 0x1f) << 16) + (buf[i] << 8) + buf[i + 1];
      i += 2;
    } else if ((len & 0xf0) === 0xe0) {
      len = ((len & 0x0f) << 24) + (buf[i] << 16) + (buf[i + 1] << 8) + buf[i + 2];
      i += 3;
    } else {
      len = buf.readUInt32BE(i);
      i += 4;
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
    this.sock = null;
    this.buf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.createConnection({ host: this.host, port: this.port }, () => resolve());
      this.sock.setTimeout(20000);
      this.sock.on('error', reject);
      this.sock.on('timeout', () => reject(new Error('socket timeout')));
      this.sock.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
      });
    });
  }

  close() {
    try { this.sock?.destroy(); } catch {}
  }

  async readReply(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const sentences = decodeSentences(this.buf);
      if (sentences.some((s) => s[0] === '!done' || s[0] === '!trap' || s[0] === '!fatal')) {
        this.buf = Buffer.alloc(0);
        const trap = sentences.find((s) => s[0] === '!trap' || s[0] === '!fatal');
        if (trap) throw new Error(trap.join(' '));
        return sentences
          .filter((s) => s[0] === '!re')
          .map((s) => {
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

async function ensure(api, menuPath, key, value, props) {
  const found = await api.call([`${menuPath}/print`, `?${key}=${value}`]);
  if (found.length) return found[0];
  try {
    await safeAdd(api, `${menuPath}/add`, props);
  } catch (e) {
    console.log('add warn:', e.message);
  }
  return null;
}

async function main() {
  console.log(`Connecting ${HOST}:${PORT} as ${USER}...`);
  console.log(`CENTRAL gateway ${HS_GW} VLANs=[${VLAN_IDS.join(',')}]`);
  const api = new RouterOS(HOST, PORT);
  await api.connect();
  await api.login(USER, PASS);
  const id = await api.call(['/system/identity/print']);
  console.log('Identity:', id[0]?.name || id);

  const loginUrl = `${CLOUD}/mikrotik/login-${SITE_ID}.html`;
  console.log('Fetching login.html from', loginUrl);
  try {
    await api.call([
      '/tool/fetch',
      `=url=${loginUrl}`,
      '=dst-path=hotspot/login.html'
    ]);
  } catch (e) {
    console.log('API fetch skip (use REST/SSH if needed):', e.message);
  }

  await ensure(api, '/interface/bridge', 'name', 'bridge-hotspot', {
    name: 'bridge-hotspot',
    comment: 'JM Central Captive Portal'
  });

  for (const vid of VLAN_IDS) {
    const vname = `VLAN${vid}`;
    await ensure(api, '/interface/vlan', 'name', vname, {
      name: vname,
      'vlan-id': String(vid),
      interface: BRIDGE_LOCAL,
      comment: `JM Cloud Hotspot ${vname}`
    });
    const ports = await api.call(['/interface/bridge/port/print', `?interface=${vname}`]);
    if (!ports.length) {
      await safeAdd(api, '/interface/bridge/port/add', {
        bridge: 'bridge-hotspot',
        interface: vname,
        comment: 'central HS'
      });
    } else if (ports[0].bridge !== 'bridge-hotspot') {
      try {
        await api.call([
          '/interface/bridge/port/set',
          `=.id=${ports[0]['.id']}`,
          '=bridge=bridge-hotspot',
          '=comment=central HS'
        ]);
      } catch (e) {
        console.log('bridge port move warn:', e.message);
      }
    }
  }

  await ensure(api, '/ip/pool', 'name', 'pool-central', {
    name: 'pool-central',
    ranges: '10.0.0.10-10.0.0.254'
  });

  const addrs = await api.call(['/ip/address/print', '?interface=bridge-hotspot']);
  const hasGw = addrs.some((a) => String(a.address || '').startsWith(`${HS_GW}/`));
  if (!hasGw) {
    await safeAdd(api, '/ip/address/add', {
      address: `${HS_GW}/24`,
      interface: 'bridge-hotspot',
      comment: 'JM Central Hotspot Captive Portal'
    });
  }

  await ensure(api, '/ip/dhcp-server', 'name', 'dhcp-central', {
    name: 'dhcp-central',
    interface: 'bridge-hotspot',
    'address-pool': 'pool-central',
    'lease-time': '30m'
  });

  const nets = await api.call(['/ip/dhcp-server/network/print', '?address=10.0.0.0/24']);
  if (!nets.length) {
    await safeAdd(api, '/ip/dhcp-server/network/add', {
      address: '10.0.0.0/24',
      gateway: HS_GW,
      'dns-server': HS_GW
    });
  }

  await ensure(api, '/ip/dns/static', 'name', 'jmwifi.local', {
    name: 'jmwifi.local',
    address: HS_GW,
    comment: 'Central captive portal'
  });

  await ensure(api, '/ip/hotspot/profile', 'name', 'jmwifi', {
    name: 'jmwifi',
    'hotspot-address': HS_GW,
    'dns-name': 'jmwifi.local',
    'html-directory': 'hotspot',
    'login-by': 'http-pap,cookie',
    'http-cookie-lifetime': '1d'
  });

  await ensure(api, '/ip/hotspot/user/profile', 'name', 'jmwifi-pause', {
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

  if (API_KEY) {
    const onLogout =
      `/tool fetch url="${CLOUD}/api/session/pause" http-method=post ` +
      `http-data="{\\"mac\\":\\"$mac-address\\"}" ` +
      `http-header-field="Content-Type: application/json,X-API-Key: ${API_KEY}" keep-result=no`;
    try {
      await api.call([
        '/ip/hotspot/user/profile/set',
        '=numbers=jmwifi-pause',
        `=on-logout=${onLogout}`
      ]);
      console.log('on-logout webhook set');
    } catch (e) {
      console.log('on-logout set warn:', e.message);
    }
  }

  for (const host of ['jmtechsolution.cloud', '*.jmtechsolution.cloud']) {
    const wg = await api.call(['/ip/hotspot/walled-garden/print', `?dst-host=${host}`]);
    if (!wg.length) {
      await safeAdd(api, '/ip/hotspot/walled-garden/add', {
        'dst-host': host,
        comment: 'JM WiFi Cloud'
      });
    }
  }

  await ensure(api, '/ip/hotspot', 'name', HS_NAME, {
    name: HS_NAME,
    interface: 'bridge-hotspot',
    'address-pool': 'pool-central',
    profile: 'jmwifi',
    'idle-timeout': 'none',
    'keepalive-timeout': '2m',
    disabled: 'no'
  });

  const nat = await api.call(['/ip/firewall/nat/print', '?comment=JM Hotspot NAT']);
  if (!nat.length) {
    await safeAdd(api, '/ip/firewall/nat/add', {
      chain: 'srcnat',
      'src-address': '10.0.0.0/24',
      action: 'masquerade',
      comment: 'JM Hotspot NAT'
    });
  }

  const hs = await api.call(['/ip/hotspot/print']);
  console.log('Hotspot servers:', hs.map((h) => `${h.name}@${h.interface}`).join(', '));
  console.log(`DONE — CENTRAL ${HS_GW} for VLANs ${VLAN_IDS.join(',')}`);
  api.close();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
