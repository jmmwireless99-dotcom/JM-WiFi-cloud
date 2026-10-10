// Single round-trip for dashboard — geo + stations + cameras
import { Router } from 'express';
import { pool } from '../db.js';
import { getActiveSessions, getStreamStates, streamPathName } from '../services/provisioner.js';
import { clientBarangayIds, filterGeoForClient } from '../auth.js';
import { HUB, SSTP_PORT, hlsBase } from '../config.js';
import { getPricePerLiter, getAmountPresets } from '../services/paymongo.js';

const r = Router();
const HLS = hlsBase;

function stationView(s, online) {
  const lat = s.lat != null ? Number(s.lat) : null;
  const lng = s.lng != null ? Number(s.lng) : null;
  return {
    id: s.id,
    name: s.name,
    username: s.username,
    sstpServer: HUB(),
    sstpPort: SSTP_PORT(),
    vpnAddress: `${HUB()}:${s.winbox_port}`,
    apiAddress: `${HUB()}:${s.api_port}`,
    apiUser: s.api_user || 'jmcloud',
    apiPasswordConfigured: !!(s.api_password && String(s.api_password).length),
    vpnIp: s.vpn_ip,
    winboxPort: s.winbox_port,
    apiPort: s.api_port,
    status: s.status,
    online: online?.has(s.username) || false,
    created: s.created_at,
    expiration: s.expires_at,
    notes: s.notes,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    cameraCount: Number(s.camera_count || 0),
    nvrCount: Number(s.nvr_count || 0),
  };
}

function cameraView(c, streams) {
  const latOwn = c.lat != null ? Number(c.lat) : null;
  const lngOwn = c.lng != null ? Number(c.lng) : null;
  const stLat = c.station_lat != null ? Number(c.station_lat) : null;
  const stLng = c.station_lng != null ? Number(c.station_lng) : null;
  const lat = Number.isFinite(latOwn) ? latOwn : (Number.isFinite(stLat) ? stLat : null);
  const lng = Number.isFinite(lngOwn) ? lngOwn : (Number.isFinite(stLng) ? stLng : null);
  const nvrLat = c.nvr_lat != null ? Number(c.nvr_lat) : null;
  const nvrLng = c.nvr_lng != null ? Number(c.nvr_lng) : null;
  const latEff = Number.isFinite(lat) ? lat : (Number.isFinite(nvrLat) ? nvrLat : null);
  const lngEff = Number.isFinite(lng) ? lng : (Number.isFinite(nvrLng) ? nvrLng : null);
  return {
    id: c.id, stationId: c.station_id, name: c.name,
    brand: c.brand || 'dahua',
    lanIp: c.lan_ip, rtspPort: c.rtsp_port, rtspPath: c.rtsp_path,
    rtspUser: c.rtsp_user || '', tunnelPort: c.tunnel_port, enabled: c.enabled,
    hlsUrl: `${HLS()}/${streamPathName(c)}/index.m3u8`,
    stream: streams[streamPathName(c)] || null,
    // online = VPN station up + cam enabled. streaming = remux currently warm.
    live: !!(c.enabled && c.station_status === 'active'),
    streaming: !!(streams[streamPathName(c)]?.ready),
    station: c.station_name, stationStatus: c.station_status,
    nvrAreaId: c.nvr_area_id || null,
    nvrName: c.nvr_name || null,
    barangayId: c.barangay_id, barangay: c.barangay_name,
    municipalityId: c.municipality_id, municipality: c.municipality_name,
    cityId: c.city_id, city: c.city_name,
    provinceId: c.province_id, province: c.province_name,
    lat: latEff, lng: lngEff,
    latOwn: Number.isFinite(latOwn) ? latOwn : null,
    lngOwn: Number.isFinite(lngOwn) ? lngOwn : null,
  };
}

r.get('/', async (req, res) => {
  try {
    const [p, c, m, b, counts, stations, cameras, nvrs, ztClients, gasSum, online, streams] = await Promise.all([
      pool.query('SELECT * FROM provinces ORDER BY name'),
      pool.query('SELECT * FROM cities ORDER BY name'),
      pool.query('SELECT * FROM municipalities ORDER BY name'),
      pool.query('SELECT * FROM barangays ORDER BY name'),
      pool.query(`SELECT b.id AS barangay_id, COUNT(cam.id)::int AS cameras
                    FROM barangays b
                    LEFT JOIN cameras cam ON cam.barangay_id = b.id
                   GROUP BY b.id`),
      pool.query(`SELECT s.*,
                         (SELECT COUNT(*) FROM cameras cam WHERE cam.station_id = s.id) AS camera_count,
                         (SELECT COUNT(*) FROM nvr_areas n WHERE n.station_id = s.id) AS nvr_count
                    FROM stations s ORDER BY s.id`),
      pool.query(`SELECT c.*, s.name AS station_name, s.status AS station_status,
                         s.lat AS station_lat, s.lng AS station_lng,
                         n.name AS nvr_name, n.lat AS nvr_lat, n.lng AS nvr_lng,
                         b.name AS barangay_name, b.municipality_id,
                         m.name AS municipality_name, m.city_id,
                         ci.name AS city_name, ci.province_id,
                         p.name AS province_name
                    FROM cameras c
                    JOIN stations s ON s.id = c.station_id
                    LEFT JOIN nvr_areas n ON n.id = c.nvr_area_id
                    LEFT JOIN barangays b ON b.id = c.barangay_id
                    LEFT JOIN municipalities m ON m.id = b.municipality_id
                    LEFT JOIN cities ci ON ci.id = m.city_id
                    LEFT JOIN provinces p ON p.id = ci.province_id
                   ORDER BY s.name, COALESCE(n.name, ''), c.name, c.id`),
      pool.query(`SELECT n.*, s.name AS station_name,
                         (SELECT COUNT(*)::int FROM cameras cam WHERE cam.nvr_area_id = n.id) AS camera_count
                    FROM nvr_areas n
                    JOIN stations s ON s.id = n.station_id
                   ORDER BY s.name, n.name, n.id`).catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM zerotier_clients ORDER BY id').catch(() => ({ rows: [] })),
      pool.query(`
        SELECT
          COUNT(*)::int AS sales_count,
          COALESCE(SUM(liters),0)::float AS total_liters,
          COALESCE(SUM(amount),0)::float AS total_amount,
          COALESCE(SUM(amount) FILTER (WHERE sold_at::date = CURRENT_DATE),0)::float AS today_amount,
          COALESCE(SUM(liters) FILTER (WHERE sold_at::date = CURRENT_DATE),0)::float AS today_liters,
          COUNT(*) FILTER (WHERE sold_at::date = CURRENT_DATE)::int AS today_count
        FROM gasoline_sales
      `).catch(() => ({ rows: [{}] })),
      getActiveSessions(),
      getStreamStates(),
    ]);

    const allowed = clientBarangayIds(req);
    let geo = {
      provinces: p.rows,
      cities: c.rows,
      municipalities: m.rows,
      barangays: b.rows,
      counts: Object.fromEntries(counts.rows.map(x => [x.barangay_id, x])),
    };
    let cameraRows = cameras.rows;
    if (allowed !== null) {
      geo = filterGeoForClient(geo, allowed);
      const set = new Set(allowed);
      cameraRows = cameraRows.filter(row => set.has(row.barangay_id));
    }

    res.json({
      user: {
        role: req.user.role,
        displayName: req.user.displayName || req.user.sub,
        barangayIds: allowed || [],
        canPlayback: req.user.role === 'admin',
        canManageAccounts: req.user.role === 'admin',
      },
      config: {
        sstpServer: HUB(),
        sstpPort: SSTP_PORT(),
        zerotierNetworkId: process.env.ZEROTIER_NETWORK_ID || null,
      },
      geo,
      stations: allowed === null ? stations.rows.map(s => stationView(s, online)) : [],
      cameras: cameraRows.map(c => cameraView(c, streams)),
      nvrs: allowed === null ? nvrs.rows.map(n => ({
        id: n.id,
        stationId: n.station_id,
        stationName: n.station_name,
        name: n.name,
        notes: n.notes || '',
        brand: n.brand || 'dahua',
        model: n.model || '',
        lanIp: n.lan_ip || null,
        rtspPort: n.rtsp_port != null ? Number(n.rtsp_port) : 554,
        tcpPort: n.tcp_port != null ? Number(n.tcp_port) : 37777,
        rtspUser: n.rtsp_user || 'admin',
        hasRtspPass: !!(n.rtsp_pass && String(n.rtsp_pass).length),
        channels: n.channels != null ? Number(n.channels) : 0,
        firmware: n.firmware || '',
        lat: n.lat != null ? Number(n.lat) : null,
        lng: n.lng != null ? Number(n.lng) : null,
        cameraCount: Number(n.camera_count || 0),
        created: n.created_at,
      })) : [],
      zerotierClients: allowed === null ? ztClients.rows.map(z => ({
        id: z.id,
        name: z.name,
        nodeId: z.node_id,
        ztIp: z.zt_ip || '',
        notes: z.notes || '',
        authorized: z.authorized,
        status: z.status,
        created: z.created_at,
      })) : [],
      gasoline: allowed === null ? {
        salesCount: gasSum.rows[0]?.sales_count || 0,
        totalLiters: gasSum.rows[0]?.total_liters || 0,
        totalAmount: gasSum.rows[0]?.total_amount || 0,
        todayAmount: gasSum.rows[0]?.today_amount || 0,
        todayLiters: gasSum.rows[0]?.today_liters || 0,
        todayCount: gasSum.rows[0]?.today_count || 0,
        pricePerLiter: await getPricePerLiter().catch(() => 65),
        presets: await getAmountPresets().catch(() => [50, 100, 200, 500]),
      } : null,
    });
  } catch (e) {
    console.error('dashboard failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default r;
