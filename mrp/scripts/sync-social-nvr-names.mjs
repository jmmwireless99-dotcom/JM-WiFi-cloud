#!/usr/bin/env node
/**
 * Pull Dahua NVR ChannelTitle names into SOCIAL station 71 cameras (D1–D30).
 * Source of truth = NVR (DHI-NVR4232), not hardcoded seed labels.
 *
 * Ensures MikroTik dstnat HTTP tunnel (default :10580 → NVR :80), then Digest CGI.
 *
 * Run on VPS: node /opt/mrp/scripts/sync-social-nvr-names.mjs
 * Dry-run:    node /opt/mrp/scripts/sync-social-nvr-names.mjs --dry-run
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import {
  SOCIAL_STATION_ID,
  SOCIAL_NVR_LAN,
  channelFromRtspPath,
  isCanonicalSocialChannel,
  areaGroupFromName,
  formatSocialCamName,
} from '../src/lib/socialCameraNames.js';
import { dahuaDigestGet, parseChannelTitleTable, normalizeNvrChannelName } from '../src/lib/dahuaCgi.js';
import { probeMikrotik } from '../src/services/mikrotikRest.js';

const dryRun = process.argv.includes('--dry-run');
const HTTP_TUNNEL_PORT = Number(process.env.SOCIAL_NVR_HTTP_TUNNEL || 10580);

async function mikrotikRest(site, method, path, body) {
  const host = String(site.mikrotik_host || '').replace(/\/\d+$/, '');
  const user = site.api_user || 'admin';
  const pass = site.api_password || '';
  const url = `http://${host}/rest/${String(path).replace(/^\//, '')}`;
  const res = await fetch(url, {
    method,
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
    throw new Error(`MikroTik ${method} ${path}: ${msg}`);
  }
  return data;
}

async function ensureNvrHttpNat(station, nvrLan) {
  const host = String(station.vpn_ip || '').replace(/\/\d+$/, '');
  if (!host || !station.api_password) {
    throw new Error('station missing vpn_ip / api_password — cannot open NVR HTTP tunnel');
  }
  const site = {
    mikrotik_host: host,
    api_user: station.api_user || 'admin',
    api_password: station.api_password,
  };
  await probeMikrotik(site);
  const existing = await mikrotikRest(
    site,
    'GET',
    `ip/firewall/nat?dst-port=${HTTP_TUNNEL_PORT}`
  );
  const rows = Array.isArray(existing) ? existing : existing ? [existing] : [];
  const match = rows.find(
    (r) =>
      String(r['to-addresses'] || '') === nvrLan &&
      String(r['to-ports'] || r['to-port'] || '') === '80'
  );
  if (!match) {
    await mikrotikRest(site, 'PUT', 'ip/firewall/nat', {
      chain: 'dstnat',
      protocol: 'tcp',
      'dst-port': String(HTTP_TUNNEL_PORT),
      action: 'dst-nat',
      'to-addresses': nvrLan,
      'to-ports': '80',
      comment: 'mrp-nvr-http-channeltitle',
    });
    console.log(`created dstnat :${HTTP_TUNNEL_PORT} → ${nvrLan}:80`);
  } else {
    console.log(`dstnat :${HTTP_TUNNEL_PORT} → ${nvrLan}:80 ok (${match['.id'] || 'existing'})`);
  }
  return `http://${host}:${HTTP_TUNNEL_PORT}`;
}

async function main() {
  const { rows: stRows } = await pool.query(`SELECT * FROM stations WHERE id = $1`, [SOCIAL_STATION_ID]);
  const station = stRows[0];
  if (!station) throw new Error(`station ${SOCIAL_STATION_ID} missing`);

  const { rows: nvrRows } = await pool.query(
    `SELECT * FROM nvr_areas WHERE station_id = $1 ORDER BY id LIMIT 1`,
    [SOCIAL_STATION_ID]
  );
  const nvr = nvrRows[0];
  if (!nvr) throw new Error('no nvr_areas for SOCIAL');
  const nvrLan = String(nvr.lan_ip || SOCIAL_NVR_LAN).replace(/\/\d+$/, '').trim() || SOCIAL_NVR_LAN;
  const user = nvr.rtsp_user || 'admin';
  const pass = nvr.rtsp_pass || '';

  const baseUrl = await ensureNvrHttpNat(station, nvrLan);
  const cgiText = await dahuaDigestGet(
    baseUrl,
    '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle',
    { user, pass }
  );
  const titles = parseChannelTitleTable(cgiText);
  console.log(`NVR ChannelTitle entries: ${titles.size}`);

  const { rows: cams } = await pool.query(
    `SELECT id, name, host(lan_ip) AS lan, rtsp_path, enabled
       FROM cameras WHERE station_id = $1 ORDER BY id`,
    [SOCIAL_STATION_ID]
  );

  const updates = [];
  for (const cam of cams) {
    const ch = channelFromRtspPath(cam.rtsp_path);
    if (!isCanonicalSocialChannel(ch)) continue;
    const lan = String(cam.lan || '').trim();
    if (lan && lan !== nvrLan && lan !== SOCIAL_NVR_LAN) continue;
    const raw = titles.get(ch);
    if (!raw) {
      console.log(`  skip D${ch} id=${cam.id} — no ChannelTitle`);
      continue;
    }
    const nextName = formatSocialCamName(normalizeNvrChannelName(raw));
    if (nextName !== cam.name) {
      updates.push({
        id: cam.id,
        ch,
        from: cam.name,
        to: nextName,
        group: areaGroupFromName(nextName),
      });
    }
  }

  console.log(
    `station ${SOCIAL_STATION_ID}: ${updates.length} rename(s)${dryRun ? ' (dry-run)' : ''}`
  );
  for (const u of updates) {
    console.log(`  D${u.ch} id=${u.id} [${u.group}] ${u.from} → ${u.to}`);
  }

  if (!dryRun) {
    for (const u of updates) {
      await pool.query(
        `UPDATE cameras SET name = $2 WHERE id = $1 AND station_id = $3`,
        [u.id, u.to, SOCIAL_STATION_ID]
      );
    }
  }

  const { rows: after } = await pool.query(
    `SELECT id, name, host(lan_ip) AS lan, rtsp_path, enabled
       FROM cameras WHERE station_id = $1
       ORDER BY COALESCE(NULLIF(substring(rtsp_path from 'channel=([0-9]+)'), '')::int, 0), id`,
    [SOCIAL_STATION_ID]
  );
  console.log(`\n--- catalog (${after.length}) ---`);
  for (const r of after) {
    const ch = channelFromRtspPath(r.rtsp_path);
    console.log(
      `D${ch ?? '?'}\tid=${r.id}\t${r.enabled ? 'on' : 'off'}\t${r.name}\t→ ${areaGroupFromName(r.name)}`
    );
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
