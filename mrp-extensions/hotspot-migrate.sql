-- JM Cloud Hotspot — MikroTik sites + VLAN servers (KiTifi-style)
-- Append to /opt/mrp/src/migrate.js runMigrations()

CREATE TABLE IF NOT EXISTS wifi_mikrotik_sites (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL,
  bridge_interface TEXT NOT NULL DEFAULT 'bridge-local',
  mikrotik_host TEXT NOT NULL,
  api_user TEXT NOT NULL DEFAULT 'admin',
  api_password TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wifi_hotspot_servers (
  id SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES wifi_mikrotik_sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vlan_id INTEGER NOT NULL,
  parent_interface TEXT NOT NULL,
  server_profile TEXT NOT NULL DEFAULT 'default',
  idle_timeout_sec INTEGER NOT NULL DEFAULT 600,
  address TEXT NOT NULL,
  ip_start TEXT NOT NULL,
  ip_end TEXT NOT NULL,
  masquerade BOOLEAN NOT NULL DEFAULT true,
  anti_sharing BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, vlan_id),
  UNIQUE (site_id, name)
);

CREATE TABLE IF NOT EXISTS wifi_coin_logs (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES wifi_mikrotik_sites(id) ON DELETE SET NULL,
  device_id TEXT,
  coins INTEGER NOT NULL DEFAULT 1,
  minutes_granted INTEGER NOT NULL DEFAULT 0,
  voucher_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wifi_sessions (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES wifi_mikrotik_sites(id) ON DELETE SET NULL,
  mac_address TEXT NOT NULL,
  username TEXT,
  minutes_granted INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_wifi_hotspot_site ON wifi_hotspot_servers(site_id);
CREATE INDEX IF NOT EXISTS idx_wifi_coin_site ON wifi_coin_logs(site_id);

ALTER TABLE wifi_hotspot_servers ADD COLUMN IF NOT EXISTS last_pushed_at TIMESTAMPTZ;
ALTER TABLE wifi_hotspot_servers ADD COLUMN IF NOT EXISTS push_status TEXT;
