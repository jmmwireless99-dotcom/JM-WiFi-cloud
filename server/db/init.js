const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');

const dbPath = path.join(__dirname, 'jmwifi.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'operator', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    operator_id TEXT REFERENCES operators(id),
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    address TEXT DEFAULT '',
    portal_title TEXT DEFAULT 'JM WiFi',
    mikrotik_host TEXT,
    mikrotik_user TEXT DEFAULT 'admin',
    mikrotik_pass TEXT,
    hotspot_profile TEXT DEFAULT 'jmwifi',
    vlan_id INTEGER DEFAULT 10,
    rate_per_hour REAL DEFAULT 10,
    minutes_per_coin INTEGER DEFAULT 5,
    coin_value REAL DEFAULT 1,
    bandwidth_up TEXT DEFAULT '2M',
    bandwidth_down TEXT DEFAULT '5M',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rate_plans (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 1,
    minutes INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    device_type TEXT NOT NULL CHECK(device_type IN ('esp8266', 'mikrotik', 'vendo')),
    mac_address TEXT,
    name TEXT,
    last_seen TEXT,
    status TEXT DEFAULT 'offline',
    config_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    minutes INTEGER NOT NULL,
    price REAL DEFAULT 0,
    used INTEGER DEFAULT 0,
    used_by_mac TEXT,
    used_at TEXT,
    source TEXT DEFAULT 'coin',
    device_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    mac_address TEXT NOT NULL,
    ip_address TEXT,
    username TEXT,
    voucher_id TEXT REFERENCES vouchers(id),
    minutes_granted INTEGER,
    remaining_seconds INTEGER,
    started_at TEXT DEFAULT (datetime('now')),
    last_active_at TEXT,
    resumed_at TEXT,
    paused_at TEXT,
    pause_reason TEXT,
    expires_at TEXT,
    status TEXT DEFAULT 'active',
    pause_mode INTEGER DEFAULT 1,
    allow_random_mac INTEGER DEFAULT 1,
    profile_name TEXT DEFAULT 'jmwifi-pause',
    auth_password TEXT
  );

  CREATE TABLE IF NOT EXISTS hotspot_servers (
    id TEXT PRIMARY KEY,
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hs_address TEXT DEFAULT '0.0.0.0',
    html_directory TEXT DEFAULT 'hotspot',
    login_by TEXT DEFAULT 'http-pap,mac-cookie',
    interface_name TEXT DEFAULT 'bridge-hotspot',
    vlan_id INTEGER DEFAULT 10,
    dns_name TEXT DEFAULT 'jmwifi.local',
    profile_name TEXT DEFAULT 'jmwifi',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hotspot_profiles (
    id TEXT PRIMARY KEY,
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rate_limit TEXT DEFAULT '2M/5M',
    shared_users INTEGER DEFAULT 1,
    session_timeout TEXT DEFAULT '',
    idle_timeout TEXT DEFAULT 'none',
    keepalive_timeout TEXT DEFAULT '2m',
    pause_on_disconnect INTEGER DEFAULT 1,
    no_validity INTEGER DEFAULT 1,
    allow_random_mac INTEGER DEFAULT 1,
    mac_cookie INTEGER DEFAULT 1,
    transparent_proxy INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS coin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(id),
    coins INTEGER NOT NULL DEFAULT 1,
    amount REAL NOT NULL DEFAULT 1,
    minutes_granted INTEGER NOT NULL,
    voucher_code TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
  CREATE INDEX IF NOT EXISTS idx_vouchers_site ON vouchers(site_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_mac ON sessions(mac_address);
  CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id);
  CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);
  CREATE INDEX IF NOT EXISTS idx_coin_logs_site ON coin_logs(site_id);
  CREATE INDEX IF NOT EXISTS idx_coin_logs_created ON coin_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_sites_operator ON sites(operator_id);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Seed default admin if empty
const opCount = db.prepare('SELECT COUNT(*) as c FROM operators').get();
if (opCount.c === 0) {
  const adminId = uuid();
  const email = process.env.ADMIN_EMAIL || 'admin@jmtechsolution.cloud';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare(`
    INSERT INTO operators (id, email, password_hash, name, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(adminId, email, hashPassword(password), 'JM Admin', 'admin');
  console.log('Default admin created:');
  console.log('  Email:', email);
  console.log('  Password:', password);
  console.log('  CHANGE THIS PASSWORD after first login!');
}

// Seed demo vendo if empty
const siteCount = db.prepare('SELECT COUNT(*) as c FROM sites').get();
if (siteCount.c === 0) {
  const admin = db.prepare('SELECT id FROM operators LIMIT 1').get();
  const siteId = uuid();
  const apiKey = uuid().replace(/-/g, '');

  db.prepare(`
    INSERT INTO sites (id, operator_id, name, api_key, mikrotik_host, minutes_per_coin, rate_per_hour, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(siteId, admin?.id || null, 'Demo Vendo 1', apiKey, '192.168.88.1', 5, 10, 'Sample Location');

  const plans = [
    ['5 Min', 1, 5, 1, 1],
    ['30 Min', 5, 30, 5, 2],
    ['1 Hour', 10, 60, 10, 3],
    ['3 Hours', 25, 180, 25, 4]
  ];
  for (const [name, coins, minutes, price, sort] of plans) {
    db.prepare(`
      INSERT INTO rate_plans (id, site_id, name, coins, minutes, price, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), siteId, name, coins, minutes, price, sort);
  }

  db.prepare(`
    INSERT INTO hotspot_servers (
      id, site_id, name, hs_address, html_directory, login_by, vlan_id, profile_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), siteId, 'JMWIFI', '10.10.10.1', 'hotspot', 'http-pap,mac-cookie', 10, 'jmwifi');

  for (const [name, rate, notes] of [
    ['jmwifi-pause', '2M/5M', 'Pause on disconnect — no validity'],
    ['default', '2M/5M', 'Default'],
    ['KITIFI', '5M/10M', 'Fast profile']
  ]) {
    db.prepare(`
      INSERT INTO hotspot_profiles (
        id, site_id, name, rate_limit, shared_users, idle_timeout, keepalive_timeout,
        pause_on_disconnect, no_validity, allow_random_mac, notes
      ) VALUES (?, ?, ?, ?, 1, 'none', '2m', 1, 1, 1, ?)
    `).run(uuid(), siteId, name, rate, notes);
  }

  console.log('Demo vendo created:');
  console.log('  Site ID:', siteId);
  console.log('  API Key:', apiKey);
}

db.close();
console.log('Database initialized at', dbPath);
