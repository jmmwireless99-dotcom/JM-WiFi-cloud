#!/usr/bin/env node
/**
 * Push Empty Bottle VLAN network to MikroTik (VLAN103 · 10.0.3.1).
 * Separate from Cloud Hotspot CENTRAL 10.0.0.1.
 */
const net = require('net');

const HOST = process.env.MIKROTIK_HOST || '10.90.0.27';
const PORT = Number(process.env.MIKROTIK_API_PORT || 8728);
const USER = process.env.MIKROTIK_USER || 'admin';
const PASS = process.env.MIKROTIK_PASS || '';
const VLAN_ID = Number(process.env.VLAN_ID || 103);
const BRIDGE_LOCAL = process.env.BRIDGE_LOCAL || 'bridge-local';
const GW = process.env.EB_GATEWAY || '10.0.3.1';

if (!PASS) {
  console.error('MIKROTIK_PASS required');
  process.exit(1);
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
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.createConnection({ host: HOST, port: PORT }, () => resolve());
      this.sock.setTimeout(20000);
      this.sock.on('error', reject);
      this.buf = Buffer.alloc(0);
      this.sock.on('data', (c) => { this.buf = Buffer.concat([this.buf, c]); });
    });
  }
  close() { try { this.sock?.destroy(); } catch {} }
  async readReply() {
    const start = Date.now();
    while (Date.now() - start < 12000) {
      const sentences = decodeSentences(this.buf);
      if (sentences.some((s) => s[0] === '!done' || s[0] === '!trap')) {
        this.buf = Buffer.alloc(0);
        const trap = sentences.find((s) => s[0] === '!trap');
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

async function ensure(api, menu, key, value, props) {
  const found = await api.call([`${menu}/print`, `?${key}=${value}`]);
  if (found.length) return found[0];
  const words = [`${menu}/add`];
  for (const [k, v] of Object.entries(props)) words.push(`=${k}=${v}`);
  try { await api.call(words); } catch (e) { console.log('add warn:', e.message); }
}

async function main() {
  console.log(`Empty Bottle VLAN${VLAN_ID} @ ${GW} → ${HOST}:${PORT}`);
  const api = new RouterOS();
  await api.connect();
  await api.login(USER, PASS);
  const vname = `VLAN${VLAN_ID}`;

  await ensure(api, '/interface/bridge', 'name', 'bridge-empty-bottle', {
    name: 'bridge-empty-bottle',
    comment: 'Empty Bottle machine LAN'
  });

  await ensure(api, '/interface/vlan', 'name', vname, {
    name: vname,
    'vlan-id': String(VLAN_ID),
    interface: BRIDGE_LOCAL,
    comment: 'Empty Bottle Vendo'
  });

  const ports = await api.call(['/interface/bridge/port/print', `?interface=${vname}`]);
  if (!ports.length) {
    await api.call([
      '/interface/bridge/port/add',
      '=bridge=bridge-empty-bottle',
      `=interface=${vname}`,
      '=comment=empty bottle'
    ]);
  }

  await ensure(api, '/ip/pool', 'name', 'pool-empty-bottle', {
    name: 'pool-empty-bottle',
    ranges: '10.0.3.10-10.0.3.254'
  });

  const addrs = await api.call(['/ip/address/print', '?interface=bridge-empty-bottle']);
  if (!addrs.some((a) => String(a.address || '').startsWith(`${GW}/`))) {
    await api.call([
      '/ip/address/add',
      `=address=${GW}/24`,
      '=interface=bridge-empty-bottle',
      '=comment=Empty Bottle Gateway'
    ]);
  }

  await ensure(api, '/ip/dhcp-server', 'name', 'dhcp-empty-bottle', {
    name: 'dhcp-empty-bottle',
    interface: 'bridge-empty-bottle',
    'address-pool': 'pool-empty-bottle',
    'lease-time': '1h'
  });

  const nets = await api.call(['/ip/dhcp-server/network/print', '?address=10.0.3.0/24']);
  if (!nets.length) {
    await api.call([
      '/ip/dhcp-server/network/add',
      '=address=10.0.3.0/24',
      `=gateway=${GW}`,
      `=dns-server=${GW}`
    ]);
  }

  await ensure(api, '/ip/dns/static', 'name', 'emptybottle.local', {
    name: 'emptybottle.local',
    address: GW,
    comment: 'Empty Bottle LAN'
  });

  const nat = await api.call(['/ip/firewall/nat/print', '?comment=Empty Bottle NAT']);
  if (!nat.length) {
    await api.call([
      '/ip/firewall/nat/add',
      '=chain=srcnat',
      '=src-address=10.0.3.0/24',
      '=action=masquerade',
      '=comment=Empty Bottle NAT'
    ]);
  }

  console.log(`DONE — Empty Bottle VLAN${VLAN_ID} gateway ${GW}`);
  api.close();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
