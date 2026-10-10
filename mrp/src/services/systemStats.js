/**
 * Live VPS metrics from /proc (CPU %, RAM, NIC rx/tx Mbps).
 * Keeps prior samples so successive polls (5–15s) yield accurate rates.
 */
import { readFile } from 'fs/promises';
import os from 'os';

const WAN = () => process.env.WAN_INTERFACE || '';

let cpuPrev = null; // { idle, total, at }
let netPrev = null; // { rxBytes, txBytes, at, iface }

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function readCpuSample() {
  const text = await readFile('/proc/stat', 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const parts = line.trim().split(/\s+/).slice(1).map(n);
  // user nice system idle iowait irq softirq steal guest guest_nice
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total, at: Date.now() };
}

async function readMem() {
  const text = await readFile('/proc/meminfo', 'utf8');
  const map = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) map[m[1]] = Number(m[2]) * 1024; // kB → bytes
  }
  const total = map.MemTotal || 0;
  // Prefer MemAvailable (accounts for cache); fall back to free+buffers+cached
  const available =
    map.MemAvailable != null
      ? map.MemAvailable
      : (map.MemFree || 0) + (map.Buffers || 0) + (map.Cached || 0);
  const used = Math.max(0, total - available);
  const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
  return {
    totalBytes: total,
    usedBytes: used,
    availableBytes: available,
    usedPct,
    totalGb: Math.round((total / 1e9) * 100) / 100,
    usedGb: Math.round((used / 1e9) * 100) / 100,
  };
}

async function readNetSample() {
  const text = await readFile('/proc/net/dev', 'utf8');
  const lines = text.split('\n').slice(2);
  const prefer = WAN();
  let best = null;
  for (const line of lines) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const iface = m[1].trim();
    if (iface === 'lo') continue;
    const cols = m[2].trim().split(/\s+/).map(n);
    const rxBytes = cols[0] || 0;
    const txBytes = cols[8] || 0;
    const sample = { iface, rxBytes, txBytes, at: Date.now() };
    if (prefer && iface === prefer) return sample;
    // Prefer non-virtual: skip docker/veth/br-/zt
    if (/^(docker|veth|br-|zt|tun|tap|wg)/i.test(iface)) continue;
    if (!best || rxBytes + txBytes > best.rxBytes + best.txBytes) best = sample;
  }
  return best;
}

/**
 * @returns {Promise<object>} CPU / RAM / network snapshot for dashboard cards
 */
export async function collectSystemStats() {
  const [cpuSample, mem, netSample] = await Promise.all([
    readCpuSample().catch(() => null),
    readMem().catch(() => ({
      totalBytes: 0, usedBytes: 0, availableBytes: 0, usedPct: 0, totalGb: 0, usedGb: 0,
    })),
    readNetSample().catch(() => null),
  ]);

  let cpuPct = null;
  if (cpuSample && cpuPrev && cpuSample.total > cpuPrev.total) {
    const dTotal = cpuSample.total - cpuPrev.total;
    const dIdle = cpuSample.idle - cpuPrev.idle;
    cpuPct = Math.round((1 - dIdle / dTotal) * 1000) / 10;
    if (cpuPct < 0) cpuPct = 0;
    if (cpuPct > 100) cpuPct = 100;
  } else if (cpuSample) {
    // First sample — approximate from loadavg vs CPU count
    const cores = os.cpus()?.length || 1;
    const load = os.loadavg()[0] || 0;
    cpuPct = Math.min(100, Math.round((load / cores) * 1000) / 10);
  }
  if (cpuSample) cpuPrev = cpuSample;

  let rxMbps = 0;
  let txMbps = 0;
  let iface = netSample?.iface || null;
  let linkMbps = null;
  if (netSample && netPrev && netPrev.iface === netSample.iface && netSample.at > netPrev.at) {
    const dt = (netSample.at - netPrev.at) / 1000;
    if (dt > 0.2) {
      rxMbps = Math.round(((netSample.rxBytes - netPrev.rxBytes) * 8) / dt / 1e6 * 100) / 100;
      txMbps = Math.round(((netSample.txBytes - netPrev.txBytes) * 8) / dt / 1e6 * 100) / 100;
      if (rxMbps < 0) rxMbps = 0;
      if (txMbps < 0) txMbps = 0;
    }
  }
  if (netSample) netPrev = netSample;

  // Optional: link capacity for % (ethtool not always available — env override)
  const capEnv = Number(process.env.WAN_LINK_MBPS || 0);
  if (capEnv > 0) linkMbps = capEnv;
  const totalMbps = rxMbps + txMbps;
  const netPct = linkMbps ? Math.min(100, Math.round((totalMbps / linkMbps) * 1000) / 10) : null;

  const loadavg = os.loadavg();
  return {
    at: new Date().toISOString(),
    hostname: os.hostname(),
    uptimeSec: Math.floor(os.uptime()),
    cpu: {
      pct: cpuPct,
      cores: os.cpus()?.length || 1,
      loadavg: loadavg.map((x) => Math.round(x * 100) / 100),
    },
    ram: mem,
    net: {
      iface,
      rxMbps,
      txMbps,
      totalMbps: Math.round(totalMbps * 100) / 100,
      linkMbps,
      pct: netPct,
    },
  };
}
