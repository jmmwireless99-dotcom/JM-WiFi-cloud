#!/usr/bin/env node
/**
 * Rename SOCIAL station 71 cameras to operator area names (D# = NVR channel).
 * Keeps rtsp channel mapping; stores device LAN IP in the display name.
 * D18 → 2ND-GATE · 192.168.20.28
 *
 * Run on VPS: node /opt/mrp/scripts/rename-social-cameras.mjs
 * Dry-run:    node /opt/mrp/scripts/rename-social-cameras.mjs --dry-run
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import {
  SOCIAL_STATION_ID,
  SOCIAL_CHANNEL_NAMES,
  SOCIAL_DIRECT_CIRCLE_IN,
  SOCIAL_NVR_LAN,
  formatSocialCamName,
  channelFromRtspPath,
  ipFromName,
  areaGroupFromName,
} from '../src/lib/socialCameraNames.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const { rows: cams } = await pool.query(
    `SELECT id, name, host(lan_ip) AS lan, rtsp_path, enabled, tunnel_port
       FROM cameras WHERE station_id = $1 ORDER BY id`,
    [SOCIAL_STATION_ID]
  );
  if (!cams.length) throw new Error(`No cameras on station ${SOCIAL_STATION_ID}`);

  const updates = [];
  for (const cam of cams) {
    const ch = channelFromRtspPath(cam.rtsp_path);
    const namedIp = ipFromName(cam.name);
    const lan = String(cam.lan || '').trim();
    let nextName = null;

    // Direct Circle-In cams (own LAN, not NVR .254)
    const directKey = lan !== SOCIAL_NVR_LAN ? lan : null;
    if (directKey && SOCIAL_DIRECT_CIRCLE_IN[directKey]) {
      nextName = formatSocialCamName(SOCIAL_DIRECT_CIRCLE_IN[directKey], directKey);
    } else if (ch && SOCIAL_CHANNEL_NAMES[ch]) {
      const { label, lanIp } = SOCIAL_CHANNEL_NAMES[ch];
      nextName = formatSocialCamName(label, lanIp);
    } else if (namedIp && SOCIAL_DIRECT_CIRCLE_IN[namedIp]) {
      nextName = formatSocialCamName(SOCIAL_DIRECT_CIRCLE_IN[namedIp], namedIp);
    }

    if (!nextName || nextName === cam.name) continue;
    updates.push({
      id: cam.id,
      ch,
      from: cam.name,
      to: nextName,
      group: areaGroupFromName(nextName),
      lan,
      enabled: cam.enabled,
    });
  }

  console.log(`station ${SOCIAL_STATION_ID}: ${cams.length} cams, ${updates.length} renames${dryRun ? ' (dry-run)' : ''}`);
  for (const u of updates) {
    console.log(
      `  id=${u.id} ch=${u.ch ?? '-'} [${u.group}] ${u.from} → ${u.to}${u.enabled ? '' : ' (disabled)'}`
    );
  }

  if (!dryRun) {
    for (const u of updates) {
      await pool.query(`UPDATE cameras SET name = $2 WHERE id = $1 AND station_id = $3`, [
        u.id,
        u.to,
        SOCIAL_STATION_ID,
      ]);
    }
  }

  const { rows: after } = await pool.query(
    `SELECT id, name, host(lan_ip) AS lan, rtsp_path, enabled
       FROM cameras WHERE station_id = $1
       ORDER BY COALESCE(NULLIF(substring(rtsp_path from 'channel=([0-9]+)'), '')::int, 0), id`,
    [SOCIAL_STATION_ID]
  );
  console.log('\n--- catalog ---');
  for (const r of after) {
    const ch = channelFromRtspPath(r.rtsp_path);
    console.log(
      `D${ch ?? '?'}\tid=${r.id}\t${r.enabled ? 'on' : 'off'}\t${r.lan}\t${r.name}\t→ ${areaGroupFromName(r.name)}`
    );
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
