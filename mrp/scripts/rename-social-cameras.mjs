#!/usr/bin/env node
/**
 * Rename SOCIAL station 71 cameras to canonical names (D# = NVR channel).
 * Names are label-only (no IP). Deletes extras outside D1–D30.
 *
 * Run on VPS: node /opt/mrp/scripts/rename-social-cameras.mjs
 * Dry-run:    node /opt/mrp/scripts/rename-social-cameras.mjs --dry-run
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import {
  SOCIAL_STATION_ID,
  SOCIAL_CHANNEL_NAMES,
  SOCIAL_NVR_LAN,
  formatSocialCamName,
  channelFromRtspPath,
  isCanonicalSocialChannel,
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
  const toDelete = [];

  for (const cam of cams) {
    const ch = channelFromRtspPath(cam.rtsp_path);
    const lan = String(cam.lan || '').trim();

    if (isCanonicalSocialChannel(ch) && (lan === SOCIAL_NVR_LAN || !lan)) {
      const { label } = SOCIAL_CHANNEL_NAMES[ch];
      const nextName = formatSocialCamName(label);
      if (nextName !== cam.name || !cam.enabled) {
        updates.push({
          id: cam.id,
          ch,
          from: cam.name,
          to: nextName,
          group: areaGroupFromName(nextName),
          enable: true,
        });
      }
      continue;
    }

    // Anything else on station 71 (Circle-In .42/.43, UNKNOWN, ch>30, duplicates)
    toDelete.push({
      id: cam.id,
      ch,
      name: cam.name,
      lan,
      enabled: cam.enabled,
    });
  }

  console.log(
    `station ${SOCIAL_STATION_ID}: ${cams.length} cams → ${updates.length} renames, ${toDelete.length} deletes${dryRun ? ' (dry-run)' : ''}`
  );
  for (const u of updates) {
    console.log(`  rename id=${u.id} D${u.ch} [${u.group}] ${u.from} → ${u.to}`);
  }
  for (const d of toDelete) {
    console.log(`  DELETE id=${d.id} ch=${d.ch ?? '-'} lan=${d.lan} ${d.name}${d.enabled ? '' : ' (was off)'}`);
  }

  if (!dryRun) {
    for (const u of updates) {
      await pool.query(
        `UPDATE cameras SET name = $2, enabled = true
          WHERE id = $1 AND station_id = $3`,
        [u.id, u.to, SOCIAL_STATION_ID]
      );
    }
    for (const d of toDelete) {
      await pool.query(`DELETE FROM cameras WHERE id = $1 AND station_id = $2`, [
        d.id,
        SOCIAL_STATION_ID,
      ]);
    }
    await pool.query(
      `UPDATE nvr_areas SET channels = 30 WHERE station_id = $1`,
      [SOCIAL_STATION_ID]
    );
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
