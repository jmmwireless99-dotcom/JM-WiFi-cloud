/**
 * Lightweight migrations for existing SQLite DBs.
 * Safe to run multiple times.
 */
const db = require('./index');

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

// sites expansions
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

// Create new tables if missing (operators, rate_plans)
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
`);

console.log('Migrations complete');
