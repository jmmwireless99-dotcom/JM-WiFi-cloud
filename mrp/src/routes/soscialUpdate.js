/**
 * Public SOCIAL Park CCTV — no login.
 * App update fingerprint + camera catalog + ensure-live (station 71 only).
 */
import { Router } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';
import { HUB, BASE_PATH, hlsBase } from '../config.js';
import { getStreamStates, streamPathName, ensureLiveRemux } from '../services/provisioner.js';

const r = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const versionPath = path.join(__dirname, '../../public/soscial/version.json');

/** SOCIAL Park MikroTik site */
export const SOCIAL_STATION_ID = 71;

function publicBase() {
  const host = HUB() || 'jmtechsolution.cloud';
  const base = BASE_PATH() || '';
  return `https://${host}${base}`;
}

const HLS = hlsBase;

async function readVersionFile() {
  try {
    const raw = await readFile(versionPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      versionName: '1.6.0',
      versionCode: 9,
      webBuild: '1.6.0',
      notes: '',
    };
  }
}

const CAM_SELECT = `
  SELECT c.*, s.name AS station_name, s.status AS station_status, s.vpn_ip AS vpn_ip,
         n.name AS nvr_name
    FROM cameras c
    JOIN stations s ON s.id = c.station_id
    LEFT JOIN nvr_areas n ON n.id = c.nvr_area_id
`;

function mapPublicCamera(c, streams) {
  return {
    id: c.id,
    stationId: c.station_id,
    name: c.name,
    brand: c.brand || 'dahua',
    lanIp: c.lan_ip,
    rtspPath: c.rtsp_path,
    enabled: !!c.enabled,
    hlsUrl: `${HLS()}/${streamPathName(c)}/index.m3u8`,
    live: !!(c.enabled && c.station_status === 'active'),
    streaming: !!(streams[streamPathName(c)]?.ready),
    station: c.station_name,
    stationStatus: c.station_status,
    nvrAreaId: c.nvr_area_id || null,
    nvrName: c.nvr_name || null,
    autoViewUrl: `${publicBase()}/soscial/v/${c.id}`,
    shareUrl: `${publicBase()}/soscial/?cam=${c.id}&auto=1`,
  };
}

async function loadSocialCameras(whereExtra = '', params = []) {
  const where = [`c.station_id = $1`, whereExtra].filter(Boolean).join(' AND ');
  const { rows } = await pool.query(
    `${CAM_SELECT} WHERE ${where} ORDER BY c.id`,
    [SOCIAL_STATION_ID, ...params]
  );
  const streams = await getStreamStates();
  return rows.map((c) => mapPublicCamera(c, streams));
}

r.get('/update', async (_req, res) => {
  try {
    const ver = await readVersionFile();
    const base = publicBase();
    const { rows } = await pool.query(
      `SELECT id, name, enabled, lan_ip, rtsp_path, stream_token
         FROM cameras
        WHERE station_id = $1
        ORDER BY id`,
      [SOCIAL_STATION_ID]
    );
    const ids = rows.map((c) => c.id);
    const enabledCount = rows.filter((c) => c.enabled).length;
    const items = rows.map((c) => {
      const m = String(c.rtsp_path || '').match(/channel=(\d+)/i);
      return {
        id: c.id,
        name: c.name,
        lanIp: c.lan_ip,
        enabled: !!c.enabled,
        channel: m ? Number(m[1]) : null,
        autoViewUrl: `${base}/soscial/v/${c.id}`,
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      versionName: ver.versionName || '1.6.0',
      versionCode: Number(ver.versionCode) || 9,
      webBuild: ver.webBuild || ver.versionName || '1.6.0',
      apkUrl: ver.apkUrl || `${base}/soscial.apk`,
      tvApkUrl: ver.tvApkUrl || `${base}/soscial-tv.apk`,
      webUrl: ver.webUrl || `${base}/soscial/?v=${ver.webBuild || ver.versionName || '1.6.0'}`,
      notes: ver.notes || '',
      releasedAt: ver.releasedAt || null,
      noAuth: true,
      cameras: {
        stationId: SOCIAL_STATION_ID,
        count: rows.length,
        enabledCount,
        ids,
        fingerprint: `${rows.length}:${enabledCount}:${ids.join(',')}`,
        items,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('soscial update:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/soscial/cameras — public live catalog (no secrets, no login) */
r.get('/cameras', async (_req, res) => {
  try {
    const cameras = await loadSocialCameras();
    const { rows: st } = await pool.query(
      `SELECT id, name, status, vpn_ip FROM stations WHERE id = $1`,
      [SOCIAL_STATION_ID]
    );
    const site = st[0] || null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      noAuth: true,
      stationId: SOCIAL_STATION_ID,
      station: site
        ? {
            id: site.id,
            name: site.name,
            status: site.status,
            online: site.status === 'active',
          }
        : null,
      cameras,
      count: cameras.length,
      enabledCount: cameras.filter((c) => c.enabled).length,
      streamingCount: cameras.filter((c) => c.streaming).length,
    });
  } catch (e) {
    console.error('soscial cameras:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/soscial/cameras/:id */
r.get('/cameras/:id', async (req, res) => {
  try {
    const cameras = await loadSocialCameras('c.id = $2', [Number(req.params.id)]);
    const cam = cameras[0];
    if (!cam) return res.status(404).json({ error: 'not found' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, noAuth: true, camera: cam });
  } catch (e) {
    console.error('soscial camera:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/soscial/cameras/:id/ensure-live
 * Warm on-demand H.264 remux for a SOCIAL cam (public, live only).
 */
r.post('/cameras/:id/ensure-live', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${CAM_SELECT} WHERE c.station_id = $1 AND c.id = $2`,
      [SOCIAL_STATION_ID, Number(req.params.id)]
    );
    const c = rows[0];
    if (!c) return res.status(404).json({ error: 'not found' });
    if (!c.enabled) return res.status(400).json({ error: 'camera disabled' });
    if (!c.vpn_ip) return res.status(400).json({ error: 'camera station has no VPN IP' });
    if (c.station_status !== 'active') {
      return res.status(400).json({ error: 'station offline / inactive' });
    }
    const result = await ensureLiveRemux(c, c.vpn_ip);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      noAuth: true,
      ...result,
      hlsUrl: `${HLS()}/${result.pathName}/index.m3u8`,
      autoViewUrl: `${publicBase()}/soscial/v/${c.id}`,
    });
  } catch (e) {
    console.error('soscial ensure-live:', e.message);
    res.status(500).json({ error: e.message || 'ensure-live failed' });
  }
});

export default r;
