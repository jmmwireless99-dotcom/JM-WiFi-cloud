/**
 * Device online/offline helpers — ESP must POST /api/heartbeat every ~30s.
 */
const db = require('../db');

const DEVICE_TYPES = ['esp8266', 'esp32', 'esp32-s3', 'mikrotik', 'vendo'];
const OFFLINE_AFTER_MINUTES = Number(process.env.DEVICE_OFFLINE_MINUTES || 5);

function isAllowedDeviceType(type) {
  return DEVICE_TYPES.includes(String(type || '').toLowerCase());
}

function findDevice(siteId, { device_id, mac_address } = {}) {
  if (device_id) {
    const byId = db.prepare('SELECT * FROM devices WHERE id = ? AND site_id = ?').get(device_id, siteId);
    if (byId) return byId;
  }
  if (mac_address) {
    return db.prepare('SELECT * FROM devices WHERE site_id = ? AND mac_address = ?').get(siteId, mac_address);
  }
  return null;
}

function touchDevice(deviceId, { name } = {}) {
  db.prepare(`
    UPDATE devices
    SET last_seen = datetime('now'), status = 'online', name = COALESCE(?, name)
    WHERE id = ?
  `).run(name || null, deviceId);
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
}

function registerDevice(siteId, { device_type, mac_address, name }) {
  const type = String(device_type || 'esp32').toLowerCase();
  if (!isAllowedDeviceType(type)) {
    return { error: `device_type must be one of: ${DEVICE_TYPES.join(', ')}` };
  }
  if (!mac_address) return { error: 'mac_address required' };

  const existing = findDevice(siteId, { mac_address });
  if (existing) {
    const device = touchDevice(existing.id, { name: name || existing.name });
    return { device, registered: false };
  }

  const { v4: uuid } = require('uuid');
  const id = uuid();
  db.prepare(`
    INSERT INTO devices (id, site_id, device_type, mac_address, name, last_seen, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 'online')
  `).run(id, siteId, type, mac_address, name || `${type}-${mac_address}`);

  return {
    registered: true,
    device: db.prepare('SELECT * FROM devices WHERE id = ?').get(id)
  };
}

function refreshDeviceStatuses() {
  db.prepare(`
    UPDATE devices SET status = 'offline'
    WHERE status = 'online'
      AND (last_seen IS NULL OR last_seen < datetime('now', '-' || ? || ' minutes'))
  `).run(OFFLINE_AFTER_MINUTES);
}

function offlineReason(lastSeen) {
  if (!lastSeen) return 'Walang heartbeat pa — ESP hindi nakaka-connect sa cloud API';
  const row = db.prepare(`
    SELECT CAST((julianday('now') - julianday(?)) * 86400 AS INTEGER) as sec
  `).get(lastSeen);
  const sec = Number(row?.sec || 999999);
  if (sec < 60) return 'Online (heartbeat OK)';
  if (sec < 3600) return `Offline — walang heartbeat ${Math.floor(sec / 60)} min (limit ${OFFLINE_AFTER_MINUTES} min)`;
  if (sec < 86400) return `Offline — walang heartbeat ${Math.floor(sec / 3600)} oras`;
  return `Offline — walang heartbeat ${Math.floor(sec / 86400)} araw — i-check ESP WiFi/API key/URL`;
}

module.exports = {
  DEVICE_TYPES,
  OFFLINE_AFTER_MINUTES,
  isAllowedDeviceType,
  findDevice,
  touchDevice,
  registerDevice,
  refreshDeviceStatuses,
  offlineReason
};
