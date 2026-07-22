/**
 * Lightweight migrations for existing SQLite DBs.
 * Safe to run multiple times.
 */
const db = require('./index');
const { v4: uuid } = require('uuid');

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function ensureColumn(table, column, ddl) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`Added ${table}.${column}`);
  }
}

[
  ['operator_id', 'operator_id TEXT'],
  ['status', "status TEXT DEFAULT 'active'"],
  ['address', "address TEXT DEFAULT ''"],
  ['portal_title', "portal_title TEXT DEFAULT 'JM WiFi'"],
  ['coin_value', 'coin_value REAL DEFAULT 1'],
  ['bandwidth_up', "bandwidth_up TEXT DEFAULT '2M'"],
  ['bandwidth_down', "bandwidth_down TEXT DEFAULT '5M'"],
  ['notes', "notes TEXT DEFAULT ''"]
].forEach(([col, ddl]) => ensureColumn('sites', col, ddl));

ensureColumn('vouchers', 'price', 'price REAL DEFAULT 0');
ensureColumn('coin_logs', 'amount', 'amount REAL DEFAULT 1');

[
  ['remaining_seconds', 'remaining_seconds INTEGER'],
  ['pause_mode', 'pause_mode INTEGER DEFAULT 1'],
  ['allow_random_mac', 'allow_random_mac INTEGER DEFAULT 1'],
  ['paused_at', 'paused_at TEXT'],
  ['resumed_at', 'resumed_at TEXT'],
  ['last_active_at', 'last_active_at TEXT'],
  ['pause_reason', 'pause_reason TEXT'],
  ['profile_name', "profile_name TEXT DEFAULT 'jmwifi-pause'"],
  ['auth_password', 'auth_password TEXT']
].forEach(([col, ddl]) => ensureColumn('sessions', col, ddl));

db.exec(`
  CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    status TEXT NOT NULL DEFAULT 'active',
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

  CREATE INDEX IF NOT EXISTS idx_hs_servers_site ON hotspot_servers(site_id);
  CREATE INDEX IF NOT EXISTS idx_hs_profiles_site ON hotspot_profiles(site_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
`);

// Backfill remaining_seconds for old sessions
db.prepare(`
  UPDATE sessions
  SET remaining_seconds = COALESCE(remaining_seconds, minutes_granted * 60),
      pause_mode = COALESCE(pause_mode, 1),
      allow_random_mac = COALESCE(allow_random_mac, 1),
      last_active_at = COALESCE(last_active_at, started_at)
  WHERE remaining_seconds IS NULL
`).run();

// Seed default profiles if empty
const profileCount = db.prepare('SELECT COUNT(*) as c FROM hotspot_profiles').get();
if (profileCount.c === 0) {
  const defaults = [
    ['default', '2M/5M', 'Shared default pause profile'],
    ['jmwifi-pause', '2M/5M', 'Pause on disconnect — no validity'],
    ['KITIFI', '5M/10M', 'Fast profile template']
  ];
  for (const [name, rate, notes] of defaults) {
    db.prepare(`
      INSERT INTO hotspot_profiles (
        id, site_id, name, rate_limit, shared_users, idle_timeout, keepalive_timeout,
        pause_on_disconnect, no_validity, allow_random_mac, notes
      ) VALUES (?, NULL, ?, ?, 1, 'none', '2m', 1, 1, 1, ?)
    `).run(uuid(), name, rate, notes);
  }
  console.log('Seeded default hotspot profiles');
}

const serverCount = db.prepare('SELECT COUNT(*) as c FROM hotspot_servers').get();
if (serverCount.c === 0) {
  const site = db.prepare('SELECT id, vlan_id FROM sites LIMIT 1').get();
  db.prepare(`
    INSERT INTO hotspot_servers (
      id, site_id, name, hs_address, html_directory, login_by, vlan_id, profile_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid(),
    site?.id || null,
    'JMWIFI',
    '10.10.10.1',
    'hotspot',
    'http-pap,mac-cookie',
    site?.vlan_id || 10,
    'jmwifi'
  );
  console.log('Seeded default hotspot server');
}

console.log('Migrations complete');
