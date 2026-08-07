const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'jmwifi.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    mikrotik_host TEXT,
    mikrotik_user TEXT DEFAULT 'admin',
    mikrotik_pass TEXT,
    hotspot_profile TEXT DEFAULT 'jmwifi',
    vlan_id INTEGER DEFAULT 10,
    rate_per_hour REAL DEFAULT 10,
    minutes_per_coin INTEGER DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    device_type TEXT NOT NULL CHECK(device_type IN ('esp8266', 'mikrotik')),
    mac_address TEXT,
    name TEXT,
    last_seen TEXT,
    status TEXT DEFAULT 'offline',
    config_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    code TEXT UNIQUE NOT NULL,
    minutes INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    used_by_mac TEXT,
    used_at TEXT,
    source TEXT DEFAULT 'coin',
    device_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    mac_address TEXT NOT NULL,
    ip_address TEXT,
    username TEXT,
    voucher_id TEXT REFERENCES vouchers(id),
    minutes_granted INTEGER,
    started_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS coin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL REFERENCES sites(id),
    device_id TEXT REFERENCES devices(id),
    coins INTEGER NOT NULL DEFAULT 1,
    minutes_granted INTEGER NOT NULL,
    voucher_code TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
  CREATE INDEX IF NOT EXISTS idx_sessions_mac ON sessions(mac_address);
  CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);
`);

// Seed demo site if empty
const siteCount = db.prepare('SELECT COUNT(*) as c FROM sites').get();
if (siteCount.c === 0) {
  const { v4: uuid } = require('uuid');
  const siteId = uuid();
  const apiKey = uuid().replace(/-/g, '');

  db.prepare(`
    INSERT INTO sites (id, name, api_key, mikrotik_host, minutes_per_coin, rate_per_hour)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(siteId, 'Demo Hotspot', apiKey, '192.168.88.1', 5, 10);

  console.log('Demo site created:');
  console.log('  Site ID:', siteId);
  console.log('  API Key:', apiKey);
}

db.close();
console.log('Database initialized at', dbPath);
