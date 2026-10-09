/**
 * Public SOCIAL Park CCTV app update + camera catalog fingerprint.
 * Used by PWA / Android WebView to auto-refresh when VPS has new cams or APK.
 */
import { Router } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';
import { HUB, BASE_PATH } from '../config.js';

const r = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const versionPath = path.join(__dirname, '../../public/soscial/version.json');

function publicBase() {
  const host = HUB() || 'jmtechsolution.cloud';
  const base = BASE_PATH() || '';
  return `https://${host}${base}`;
}

async function readVersionFile() {
  try {
    const raw = await readFile(versionPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      versionName: '1.4.0',
      versionCode: 6,
      webBuild: '1.4.0',
      notes: '',
    };
  }
}

r.get('/update', async (_req, res) => {
  try {
    const ver = await readVersionFile();
    const base = publicBase();
    const { rows } = await pool.query(
      `SELECT id, name, enabled, lan_ip, stream_token
         FROM cameras
        WHERE station_id = 71
        ORDER BY id`
    );
    const ids = rows.map((c) => c.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      versionName: ver.versionName || '1.4.0',
      versionCode: Number(ver.versionCode) || 6,
      webBuild: ver.webBuild || ver.versionName || '1.4.0',
      apkUrl: ver.apkUrl || `${base}/soscial.apk`,
      tvApkUrl: ver.tvApkUrl || `${base}/soscial-tv.apk`,
      webUrl: ver.webUrl || `${base}/soscial/?v=${ver.webBuild || ver.versionName || '1.4.0'}`,
      notes: ver.notes || '',
      releasedAt: ver.releasedAt || null,
      cameras: {
        stationId: 71,
        count: rows.length,
        ids,
        fingerprint: `${rows.length}:${ids.join(',')}`,
        items: rows.map((c) => ({
          id: c.id,
          name: c.name,
          lanIp: c.lan_ip,
        })),
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('soscial update:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default r;
