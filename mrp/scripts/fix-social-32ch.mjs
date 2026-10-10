#!/usr/bin/env node
/**
 * Ensure SOCIAL station 71 has 32 viewable camera rows:
 * - Ch1–30 stay on NVR 192.168.20.254 (shared tunnel)
 * - Circle-In cams (ids 40/41 or names) use direct camera LAN IPs + unique tunnels
 * - Enable all, bump nvr_areas.channels to 32, sync MediaMTX
 *
 * Run on VPS: node /opt/mrp/scripts/fix-social-32ch.mjs
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { allocateTunnelPort } from '../src/services/allocator.js';
import { sync } from '../src/services/provisioner.js';
import { pushCameraNat } from '../src/services/mikrotikRest.js';

const STATION_ID = 71;
const NVR_IP = '192.168.20.254';

function channelFromPath(path) {
  const m = String(path || '').match(/channel=(\d+)/i);
  return m ? Number(m[1]) : null;
}

function ipFromName(name) {
  const m = String(name || '').match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  return m ? m[1] : null;
}

async function main() {
  const { rows: cams } = await pool.query(
    `SELECT * FROM cameras WHERE station_id = $1 ORDER BY id`,
    [STATION_ID]
  );
  if (!cams.length) throw new Error('No cameras on station 71');

  const { rows: stRows } = await pool.query(
    `SELECT * FROM stations WHERE id = $1`,
    [STATION_ID]
  );
  const station = stRows[0];
  if (!station) throw new Error('station 71 missing');

  await pool.query(
    `UPDATE nvr_areas SET channels = 32, lan_ip = COALESCE(lan_ip, $2)
       WHERE station_id = $1`,
    [STATION_ID, NVR_IP]
  );

  for (const cam of cams) {
    const ch = channelFromPath(cam.rtsp_path);
    const namedIp = ipFromName(cam.name);
    const isCircle = /circle/i.test(cam.name) || ch === 31 || ch === 32;

    if (isCircle && namedIp && namedIp !== NVR_IP) {
      let tunnel = Number(cam.tunnel_port);
      // Need a dedicated NAT if still sharing NVR tunnel or pointing at NVR LAN
      const needsOwnTunnel =
        String(cam.lan_ip) === NVR_IP ||
        cams.filter((c) => Number(c.tunnel_port) === tunnel).length > 1;
      if (needsOwnTunnel) {
        tunnel = await allocateTunnelPort(STATION_ID);
      }
      await pool.query(
        `UPDATE cameras
            SET lan_ip = $2::inet,
                rtsp_path = '/cam/realmonitor?channel=1&subtype=0',
                tunnel_port = $3,
                enabled = true
          WHERE id = $1`,
        [cam.id, namedIp, tunnel]
      );
      console.log(`circle ${cam.name}: lan=${namedIp} tunnel=${tunnel} ch=1`);
    } else {
      await pool.query(`UPDATE cameras SET enabled = true WHERE id = $1`, [cam.id]);
      console.log(`nvr ${cam.name}: ch=${ch} enabled`);
    }
  }

  const { rows: refreshed } = await pool.query(
    `SELECT id, name, host(lan_ip) AS lan, rtsp_path, tunnel_port, enabled
       FROM cameras WHERE station_id = $1 ORDER BY id`,
    [STATION_ID]
  );
  console.log('cameras', refreshed.length);
  for (const r of refreshed) {
    console.log(
      `${r.id}\t${r.enabled ? 'on' : 'off'}\t:${r.tunnel_port}\t${r.lan}\t${r.rtsp_path}\t${r.name}`
    );
  }

  await sync('admin', 'fix-social-32ch');

  if (station.api_password && station.vpn_ip) {
    const host = String(station.vpn_ip).replace(/\/\d+$/, '');
    const push = await pushCameraNat(
      {
        mikrotik_host: host,
        api_user: station.api_user || 'admin',
        api_password: station.api_password,
      },
      refreshed.map((c) => ({
        name: c.name,
        tunnelPort: c.tunnel_port,
        lanIp: c.lan,
        rtspPort: 554,
      }))
    );
    console.log('nat push', push.ok, 'errors', push.errors || []);
  } else {
    console.log('skip NAT push — missing api_password');
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
