#!/usr/bin/env node
/**
 * Push JM WiFi Cloud VLAN hotspot config to MikroTik via RouterOS API (8728)
 * or REST when available. Downloads login.html from cloud via /tool fetch.
 *
 * Usage:
 *   MIKROTIK_HOST=10.254.0.10 MIKROTIK_USER=admin MIKROTIK_PASS='...' \
 *   SITE_ID=... API_KEY=... node deploy/push-mikrotik.js
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

const HOST = process.env.MIKROTIK_HOST || '10.254.0.10';
const PORT = Number(process.env.MIKROTIK_API_PORT || 8728);
const USER = process.env.MIKROTIK_USER || 'admin';
const PASS = process.env.MIKROTIK_PASS || '';
const SITE_ID = process.env.SITE_ID || '';
const API_KEY = process.env.API_KEY || '';
const CLOUD = (process.env.BASE_URL || 'https://jmtechsolution.cloud/allvendo').replace(/\/$/, '');
const VLAN_ID = Number(process.env.VLAN_ID || 10);
const WLAN = process.env.WLAN_INTERFACE || 'wlan1';
const HS_GW = process.env.HS_GATEWAY || '10.10.10.1';

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
      this.sock.setTimeout(15000);
      this.sock.on('error', reject);
      this.sock.on('timeout', () => reject(new Error('socket timeout')));
      this.sock.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
      });
    });
  }

  async write(words) {
    this.sock.write(encodeSentence(words));
  }

  async read(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const sentences = decodeSentences(this.buf);
      // Need trailing empty word consumed — decodeSentences already splits on 0
      // Wait until we see !done or !trap
      const flat = sentences.flat();
      if (flat.includes('!done') || flat.includes('!trap') || flat.includes('!fatal')) {
        this.buf = Buffer.alloc(0);
        return sentences;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('read timeout: ' + this.buf.toString('utf8').slice(0, 200));
  }

  async call(words) {
    await this.write(words);
    const sentences = await this.read();
    const trap = sentences.find((s) => s[0] === '!trap' || s[0] === '!fatal');
    if (trap) {
      const msg = trap.find((w) => w.startsWith('=message=')) || trap.join(' ');
      throw new Error(String(msg).replace(/^=message=/, ''));
    }
    return sentences.filter((s) => s[0] === '!re').map((s) => {
      const o = {};
      for (const w of s.slice(1)) {
        const m = w.match(/^=([^=]+)=(.*)$/);
        if (m) o[m[1]] = m[2];
      }
      return o;
    });
  }

  async login(user, pass) {
    // RouterOS v6.43+ post-login
    try {
      await this.call(['/login', `=name=${user}`, `=password=${pass}`]);
      return;
    } catch (_) {
      // fallback challenge login
    }
    const res = await this.call(['/login']);
    const ret = (res[0] && res[0].ret) || '';
    const crypto = require('crypto');
    const hash = crypto.createHash('md5')
      .update(Buffer.concat([Buffer.from([0]), Buffer.from(pass, 'utf8'), Buffer.from(ret, 'hex')]))
      .digest('hex');
    await this.call(['/login', `=name=${user}`, `=response=00${hash}`]);
  }

  close() {
    try { this.sock.end(); } catch (_) {}
  }
}

function safeAdd(api, path, props) {
  const words = [path + '/add', ...Object.entries(props).map(([k, v]) => `=${k}=${v}`)];
  return api.call(words);
}

async function ensure(api, printPath, matchKey, matchVal, addPath, props) {
  const rows = await api.call([printPath + '/print', `?${matchKey}=${matchVal}`]);
  if (rows.length) {
    console.log(`exists ${addPath} ${matchKey}=${matchVal}`);
    return rows[0];
  }
  console.log(`add ${addPath} ${matchKey}=${matchVal}`);
  try {
    await safeAdd(api, addPath, props);
  } catch (e) {
    // maybe already exists under different query
    console.log('add warn:', e.message);
  }
  return null;
}

async function main() {
  console.log(`Connecting ${HOST}:${PORT} as ${USER}...`);
  const api = new RouterOS(HOST, PORT);
  await api.connect();
  await api.login(USER, PASS);
  const id = await api.call(['/system/identity/print']);
  console.log('Identity:', id[0]?.name || id);

  // Enable API/www if needed — skip destructive changes
  // Fetch login.html from cloud (site-specific)
  const loginUrl = `${CLOUD}/mikrotik/login-${SITE_ID}.html`;
  console.log('Fetching login.html from', loginUrl);
  try {
    await api.call([
      '/tool/fetch',
      `=url=${loginUrl}`,
      '=dst-path=flash/hotspot/login.html',
      '=keep-result=no'
    ]);
  } catch (e) {
    // older path without flash/
    console.log('fetch flash path failed, trying hotspot/login.html:', e.message);
    await api.call([
      '/tool/fetch',
      `=url=${loginUrl}`,
      '=dst-path=hotspot/login.html',
      '=keep-result=no'
    ]);
  }

  // VLAN
  await ensure(api, '/interface/vlan', 'name', 'vlan-hotspot', '/interface/vlan', {
    name: 'vlan-hotspot',
    'vlan-id': String(VLAN_ID),
    interface: WLAN,
    comment: 'JM WiFi Cloud VLAN'
  });

  await ensure(api, '/interface/bridge', 'name', 'bridge-hotspot', '/interface/bridge', {
    name: 'bridge-hotspot',
    comment: 'JM WiFi Hotspot Bridge'
  });

  // bridge port
  const ports = await api.call(['/interface/bridge/port/print', '?interface=vlan-hotspot']);
  if (!ports.length) {
    await safeAdd(api, '/interface/bridge/port', {
      bridge: 'bridge-hotspot',
      interface: 'vlan-hotspot'
    });
  }

  await ensure(api, '/ip/pool', 'name', 'hotspot-pool', '/ip/pool', {
    name: 'hotspot-pool',
    ranges: '10.10.10.2-10.10.10.254'
  });

  const addrs = await api.call(['/ip/address/print', '?interface=bridge-hotspot']);
  if (!addrs.length) {
    await safeAdd(api, '/ip/address', {
      address: `${HS_GW}/24`,
      interface: 'bridge-hotspot',
      comment: 'Hotspot Gateway'
    });
  }

  await ensure(api, '/ip/dhcp-server', 'name', 'hotspot-dhcp', '/ip/dhcp-server', {
    name: 'hotspot-dhcp',
    interface: 'bridge-hotspot',
    'address-pool': 'hotspot-pool',
    'lease-time': '30m'
  });

  const nets = await api.call(['/ip/dhcp-server/network/print', '?address=10.10.10.0/24']);
  if (!nets.length) {
    await safeAdd(api, '/ip/dhcp-server/network', {
      address: '10.10.10.0/24',
      gateway: HS_GW,
      'dns-server': HS_GW
    });
  }

  // Hotspot server profile
  await ensure(api, '/ip/hotspot/profile', 'name', 'jmwifi', '/ip/hotspot/profile', {
    name: 'jmwifi',
    'hotspot-address': HS_GW,
    'dns-name': 'jmwifi.local',
    'html-directory': 'flash/hotspot',
    'login-by': 'http-pap,mac-cookie',
    'open-status-page': 'http-login',
    'status-autorefresh': '30s'
  });

  // User profile pause mode
  await ensure(api, '/ip/hotspot/user/profile', 'name', 'jmwifi-pause', '/ip/hotspot/user/profile', {
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

  // Set on-logout webhook if API key present
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

  // Walled garden
  for (const host of ['jmtechsolution.cloud', '*.jmtechsolution.cloud']) {
    const wg = await api.call(['/ip/hotspot/walled-garden/print', `?dst-host=${host}`]);
    if (!wg.length) {
      await safeAdd(api, '/ip/hotspot/walled-garden', {
        'dst-host': host,
        comment: 'JM WiFi Cloud'
      });
    }
  }

  await ensure(api, '/ip/hotspot', 'name', 'JMWIFI', '/ip/hotspot', {
    name: 'JMWIFI',
    interface: 'bridge-hotspot',
    'address-pool': 'hotspot-pool',
    profile: 'jmwifi',
    disabled: 'no'
  });

  // Quick verify
  const hs = await api.call(['/ip/hotspot/print']);
  const profiles = await api.call(['/ip/hotspot/user/profile/print']);
  console.log('Hotspot servers:', hs.map((h) => h.name).join(', '));
  console.log('User profiles:', profiles.map((p) => p.name).join(', '));
  console.log('DONE — VLAN hotspot pause/resume pushed.');
  api.close();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
