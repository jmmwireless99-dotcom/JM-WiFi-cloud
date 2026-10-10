#!/usr/bin/env node
/**
 * SOCIAL station 71 cleanup:
 * - Keep only NVR channels D1–D30 (delete extras / direct IPC leftovers)
 * - Do NOT apply hardcoded seed labels — names come from the NVR.
 *
 * Prefer: node /opt/mrp/scripts/sync-social-nvr-names.mjs
 * This script only prunes non-canonical rows.
 *
 * Dry-run: node /opt/mrp/scripts/rename-social-cameras.mjs --dry-run
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import {
  SOCIAL_STATION_ID,
  SOCIAL_NVR_LAN,
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

  const toDelete = [];
  const keep = [];

  for (const cam of cams) {
    const ch = channelFromRtspPath(cam.rtsp_path);
    const lan = String(cam.lan || '').trim();

    if (isCanonicalSocialChannel(ch) && (lan === SOCIAL_NVR_LAN || !lan)) {
      keep.push(cam);
      continue;
    }

    toDelete.push({
      id: cam.id,
      ch,
      name: cam.name,
      lan,
      enabled: cam.enabled,
    });
  }

  console.log(
    `station ${SOCIAL_STATION_ID}: keep ${keep.length} NVR D1–D30, delete ${toDelete.length} extras${dryRun ? ' (dry-run)' : ''}`
  );
  console.log('Names are owned by NVR ChannelTitle — run sync-social-nvr-names.mjs to refresh.');
  for (const d of toDelete) {
    console.log(`  DELETE id=${d.id} ch=${d.ch ?? '-'} lan=${d.lan} ${d.name}${d.enabled ? '' : ' (was off)'}`);
  }

  if (!dryRun) {
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
