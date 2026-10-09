import { pool } from './db.js';

export async function runMigrations() {
  await pool.query(`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS api_user TEXT NOT NULL DEFAULT 'admin';
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS api_password TEXT NOT NULL DEFAULT '';
  `).catch((e) => console.warn('stations api columns:', e.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zerotier_clients (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      node_id    TEXT NOT NULL UNIQUE,
      zt_ip      TEXT DEFAULT '',
      notes      TEXT DEFAULT '',
      authorized BOOLEAN NOT NULL DEFAULT true,
      status     TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_zerotier_node ON zerotier_clients (node_id);
  `).catch((e) => console.warn('zerotier_clients:', e.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gasoline_sales (
      id              SERIAL PRIMARY KEY,
      vendor          TEXT NOT NULL DEFAULT 'Gasoline Vendo',
      fuel_type       TEXT NOT NULL DEFAULT 'Regular',
      liters          NUMERIC(12,3) NOT NULL CHECK (liters > 0),
      price_per_liter NUMERIC(12,2) NOT NULL CHECK (price_per_liter >= 0),
      amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      payment         TEXT NOT NULL DEFAULT 'Cash',
      notes           TEXT DEFAULT '',
      sold_by         TEXT DEFAULT '',
      sold_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_gasoline_sold_at ON gasoline_sales (sold_at DESC);
  `).catch((e) => console.warn('gasoline_sales:', e.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gasoline_devices (
      id          SERIAL PRIMARY KEY,
      device_id   TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL DEFAULT 'Gasoline Vendo',
      board       TEXT NOT NULL DEFAULT 'JC3248W535',
      notes       TEXT DEFAULT '',
      api_key     TEXT NOT NULL DEFAULT '',
      mqtt_topic  TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled')),
      last_seen   TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_gasoline_devices_status ON gasoline_devices (status);
  `).catch((e) => console.warn('gasoline_devices:', e.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendo_sessions (
      id                  SERIAL PRIMARY KEY,
      device_db_id        INT REFERENCES gasoline_devices(id) ON DELETE SET NULL,
      device_id           TEXT NOT NULL,
      device_name         TEXT DEFAULT '',
      amount_pesos        NUMERIC(14,2) NOT NULL,
      amount_centavos     INT NOT NULL,
      liters              NUMERIC(12,3) NOT NULL,
      price_per_liter     NUMERIC(12,2) NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending','awaiting_payment','paid','dispense_ready',
                            'dispensing','completed','failed','expired'
                          )),
      paymongo_intent_id  TEXT,
      paymongo_method_id  TEXT,
      paymongo_payment_id TEXT,
      qr_image_url        TEXT DEFAULT '',
      client_key          TEXT DEFAULT '',
      error               TEXT DEFAULT '',
      expires_at          TIMESTAMPTZ,
      paid_at             TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_vendo_sessions_device ON vendo_sessions (device_id);
    CREATE INDEX IF NOT EXISTS idx_vendo_sessions_intent ON vendo_sessions (paymongo_intent_id);
    CREATE INDEX IF NOT EXISTS idx_vendo_sessions_status ON vendo_sessions (status);
  `).catch((e) => console.warn('vendo_sessions:', e.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT 'general',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS paymongo_webhook_logs (
      id           SERIAL PRIMARY KEY,
      event_id     TEXT,
      event_type   TEXT NOT NULL DEFAULT 'unknown',
      payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
      signature    TEXT DEFAULT '',
      is_valid     BOOLEAN NOT NULL DEFAULT false,
      duplicate    BOOLEAN NOT NULL DEFAULT false,
      error        TEXT DEFAULT '',
      processed_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_paymongo_event_id
      ON paymongo_webhook_logs (event_id) WHERE event_id IS NOT NULL;
  `).catch((e) => console.warn('system_settings/paymongo logs:', e.message));
  await pool.query(`
    INSERT INTO system_settings (key, value, group_name)
    VALUES ('gasoline_price_per_liter', '65', 'gasoline')
    ON CONFLICT (key) DO NOTHING;
  `).catch(() => {});
  await pool.query(`
    INSERT INTO system_settings (key, value, group_name)
    VALUES ('gasoline_amount_presets', '[50,100,200,500]', 'gasoline')
    ON CONFLICT (key) DO NOTHING;
  `).catch(() => {});
  await pool.query(`
    GRANT ALL ON TABLE zerotier_clients TO mrp;
    GRANT ALL ON TABLE gasoline_sales TO mrp;
    GRANT ALL ON TABLE gasoline_devices TO mrp;
    GRANT ALL ON TABLE vendo_sessions TO mrp;
    GRANT ALL ON TABLE system_settings TO mrp;
    GRANT ALL ON TABLE paymongo_webhook_logs TO mrp;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mrp;
  `).catch(() => {});

  // Allow 'claimed' so /sessions/ready can atomically hand off to MAIN board
  await pool.query(`
    ALTER TABLE vendo_sessions DROP CONSTRAINT IF EXISTS vendo_sessions_status_check;
    ALTER TABLE vendo_sessions ADD CONSTRAINT vendo_sessions_status_check
      CHECK (status IN (
        'pending','awaiting_payment','paid','dispense_ready','claimed',
        'dispensing','completed','failed','expired'
      ));
  `).catch((e) => console.warn('vendo_sessions claimed status:', e.message));

  // Vendo may-ari accounts (username/password for SoftAP-style cloud admin)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendo_owners (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL DEFAULT '',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_vendo_owners_user ON vendo_owners (username);
  `).catch((e) => console.warn('vendo_owners table:', e.message));

  await pool.query(`
    ALTER TABLE gasoline_devices
      ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES vendo_owners(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_gasoline_devices_owner ON gasoline_devices (owner_id);
  `).catch((e) => console.warn('gasoline_devices.owner_id:', e.message));

  await pool.query(`
    GRANT ALL ON TABLE vendo_owners TO mrp;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mrp;
  `).catch(() => {});

  // Camera brand: dahua | hikvision | v380 | other (for V380-style live viewer presets)
  await pool.query(`
    ALTER TABLE cameras ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'dahua';
  `).catch((e) => console.warn('cameras.brand:', e.message));

  // Map pins — Google Maps / Live Wall locations
  await pool.query(`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
    ALTER TABLE cameras ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE cameras ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
    ALTER TABLE gasoline_devices ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE gasoline_devices ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
  `).catch((e) => console.warn('map lat/lng columns:', e.message));

  // Per-device price + flow (NULL = fall back to global / SoftAP)
  await pool.query(`
    ALTER TABLE gasoline_devices
      ADD COLUMN IF NOT EXISTS price_per_liter NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS pulses_per_liter NUMERIC(12,3);
  `).catch((e) => console.warn('gasoline_devices price/flow:', e.message));

  // Isolate sales per board
  await pool.query(`
    ALTER TABLE gasoline_sales ADD COLUMN IF NOT EXISTS device_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_gasoline_sales_device ON gasoline_sales (device_id);
  `).catch((e) => console.warn('gasoline_sales.device_id:', e.message));

  await pool.query(`
    UPDATE gasoline_sales s
       SET device_id = d.device_id
      FROM gasoline_devices d
     WHERE s.device_id IS NULL
       AND (
         s.vendor ILIKE d.name
         OR s.vendor ILIKE d.device_id
         OR s.notes ILIKE '%' || d.device_id || '%'
       );
  `).catch((e) => console.warn('sales device_id backfill:', e.message));

  await pool.query(`
    UPDATE gasoline_sales s
       SET device_id = vs.device_id
      FROM vendo_sessions vs
     WHERE s.device_id IS NULL
       AND s.notes LIKE 'session:' || vs.id::text || '%'
       AND vs.device_id IS NOT NULL;
  `).catch((e) => console.warn('sales device_id session backfill:', e.message));

  // Owner cashout / payout requests (min ₱2000 enforced in API)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendo_payouts (
      id            SERIAL PRIMARY KEY,
      owner_id      INT REFERENCES vendo_owners(id) ON DELETE SET NULL,
      device_id     TEXT,
      amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','cancelled')),
      notes         TEXT NOT NULL DEFAULT '',
      requested_by  TEXT NOT NULL DEFAULT '',
      paid_by       TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at       TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_vendo_payouts_owner ON vendo_payouts (owner_id);
    CREATE INDEX IF NOT EXISTS idx_vendo_payouts_status ON vendo_payouts (status);
    GRANT ALL ON TABLE vendo_payouts TO mrp;
    GRANT USAGE, SELECT ON SEQUENCE vendo_payouts_id_seq TO mrp;
  `).catch((e) => console.warn('vendo_payouts:', e.message));

  await pool.query(`
    INSERT INTO system_settings (key, value, group_name)
    VALUES ('google_maps_api_key', '', 'maps')
    ON CONFLICT (key) DO NOTHING;
  `).catch(() => {});

  // Marketplace — Shopee/Lazada-style seller accounts + products
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_sellers (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL DEFAULT '',
      shop_name     TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_store_sellers_user ON store_sellers (username);

    CREATE TABLE IF NOT EXISTS store_products (
      id          SERIAL PRIMARY KEY,
      seller_id   INT NOT NULL REFERENCES store_sellers(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price       NUMERIC(14,2) NOT NULL CHECK (price >= 0),
      stock       INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
      category    TEXT NOT NULL DEFAULT 'General',
      image_url   TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','draft','sold_out','disabled')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_store_products_seller ON store_products (seller_id);
    CREATE INDEX IF NOT EXISTS idx_store_products_status ON store_products (status);
  `).catch((e) => console.warn('store tables:', e.message));

  await pool.query(`
    GRANT ALL ON TABLE store_sellers TO mrp;
    GRANT ALL ON TABLE store_products TO mrp;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mrp;
  `).catch(() => {});

  // Marketplace buyers + orders (QRPH / COD)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_buyers (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      address       TEXT NOT NULL DEFAULT '',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_store_buyers_user ON store_buyers (username);

    CREATE TABLE IF NOT EXISTS store_orders (
      id                  SERIAL PRIMARY KEY,
      buyer_id            INT NOT NULL REFERENCES store_buyers(id) ON DELETE RESTRICT,
      seller_id           INT NOT NULL REFERENCES store_sellers(id) ON DELETE RESTRICT,
      payment_method      TEXT NOT NULL CHECK (payment_method IN ('qrph','cod')),
      status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending','awaiting_payment','paid','cod_pending',
                            'preparing','shipped','completed','cancelled','failed','expired'
                          )),
      amount_pesos        NUMERIC(14,2) NOT NULL CHECK (amount_pesos >= 0),
      amount_centavos     INT NOT NULL CHECK (amount_centavos >= 0),
      buyer_name          TEXT NOT NULL DEFAULT '',
      buyer_phone         TEXT NOT NULL DEFAULT '',
      buyer_address       TEXT NOT NULL DEFAULT '',
      notes               TEXT NOT NULL DEFAULT '',
      paymongo_intent_id  TEXT,
      paymongo_method_id  TEXT,
      paymongo_payment_id TEXT,
      qr_image_url        TEXT NOT NULL DEFAULT '',
      client_key          TEXT NOT NULL DEFAULT '',
      error               TEXT NOT NULL DEFAULT '',
      paid_at             TIMESTAMPTZ,
      expires_at          TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_store_orders_buyer ON store_orders (buyer_id);
    CREATE INDEX IF NOT EXISTS idx_store_orders_seller ON store_orders (seller_id);
    CREATE INDEX IF NOT EXISTS idx_store_orders_status ON store_orders (status);
    CREATE INDEX IF NOT EXISTS idx_store_orders_intent ON store_orders (paymongo_intent_id);

    CREATE TABLE IF NOT EXISTS store_order_items (
      id              SERIAL PRIMARY KEY,
      order_id        INT NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
      product_id      INT REFERENCES store_products(id) ON DELETE SET NULL,
      product_name    TEXT NOT NULL,
      unit_price      NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
      qty             INT NOT NULL CHECK (qty > 0),
      line_total      NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
      image_url       TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_store_order_items_order ON store_order_items (order_id);
  `).catch((e) => console.warn('store buyers/orders:', e.message));

  await pool.query(`
    GRANT ALL ON TABLE store_buyers TO mrp;
    GRANT ALL ON TABLE store_orders TO mrp;
    GRANT ALL ON TABLE store_order_items TO mrp;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mrp;
  `).catch(() => {});

  // Forex trading platform — per-client login + assigned strategies
  await pool.query(`
    CREATE TABLE IF NOT EXISTS forex_strategies (
      id            SERIAL PRIMARY KEY,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      timeframe     TEXT NOT NULL DEFAULT '',
      risk_level    TEXT NOT NULL DEFAULT '',
      config        JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      sort_order    INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS forex_clients (
      id                  SERIAL PRIMARY KEY,
      username            TEXT NOT NULL UNIQUE,
      password_hash       TEXT NOT NULL,
      display_name        TEXT NOT NULL DEFAULT '',
      notes               TEXT NOT NULL DEFAULT '',
      active_strategy_id  INT REFERENCES forex_strategies(id) ON DELETE SET NULL,
      is_active           BOOLEAN NOT NULL DEFAULT true,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_forex_clients_user ON forex_clients (username);

    CREATE TABLE IF NOT EXISTS forex_client_strategies (
      client_id    INT NOT NULL REFERENCES forex_clients(id) ON DELETE CASCADE,
      strategy_id  INT NOT NULL REFERENCES forex_strategies(id) ON DELETE CASCADE,
      PRIMARY KEY (client_id, strategy_id)
    );
    CREATE INDEX IF NOT EXISTS idx_forex_client_strategies_client ON forex_client_strategies (client_id);
  `).catch((e) => console.warn('forex tables:', e.message));

  await pool.query(`
    GRANT ALL ON TABLE forex_strategies TO mrp;
    GRANT ALL ON TABLE forex_clients TO mrp;
    GRANT ALL ON TABLE forex_client_strategies TO mrp;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mrp;
  `).catch(() => {});

  await pool.query(`
    INSERT INTO forex_strategies (slug, name, description, timeframe, risk_level, config, sort_order)
    VALUES
      ('scalping', 'Scalping', 'M1–M5 quick entries with tight stop-loss.', 'M1 / M5', 'High',
       '{"engineName":"EMA_RSI_Scalp","pairs":["EURUSD","GBPUSD","XAUUSD"],"maxTradesPerDay":8}'::jsonb, 10),
      ('swing', 'Swing Trading', 'Hold positions for hours to days on H4/D1 structure.', 'H4 / D1', 'Medium',
       '{"engineName":"London_Judas_Sweep","pairs":["EURUSD","USDJPY","GBPJPY"],"holdDays":"1-5"}'::jsonb, 20),
      ('trend', 'Trend Following', 'Trade with the trend using EMA and momentum filters.', 'M15 / H1', 'Medium',
       '{"engineName":"EMA_RSI_Scalp","emaFast":21,"emaSlow":50,"pairs":["EURUSD","US30"]}'::jsonb, 30),
      ('breakout', 'Breakout', 'Enter on support/resistance breaks with volume confirmation.', 'M15 / H4', 'Medium-High',
       '{"engineName":"Liquidity_Sweep_SMC","lookbackBars":20,"pairs":["XAUUSD","NAS100"]}'::jsonb, 40),
      ('grid', 'Grid Trading', 'Range-market grid with defined upper/lower bounds.', 'M30 / H1', 'Medium',
       '{"engineName":"manual_only","gridStepPips":15,"maxGrids":6}'::jsonb, 50),
      ('sniper', 'Sniper Entry', 'Precision entries on key levels with strict risk/reward.', 'M5 / M15', 'Low-Medium',
       '{"engineName":"Liquidity_Sweep_SMC","minRR":2,"pairs":["XAUUSD","EURUSD"]}'::jsonb, 60)
    ON CONFLICT (slug) DO NOTHING;
  `).catch((e) => console.warn('forex strategy seed:', e.message));

  await pool.query(`
    UPDATE forex_strategies SET config = config || '{"engineName":"EMA_RSI_Scalp"}'::jsonb
      WHERE slug = 'scalping' AND NOT (config ? 'engineName');
    UPDATE forex_strategies SET config = config || '{"engineName":"London_Judas_Sweep"}'::jsonb
      WHERE slug = 'swing' AND NOT (config ? 'engineName');
    UPDATE forex_strategies SET config = config || '{"engineName":"EMA_RSI_Scalp"}'::jsonb
      WHERE slug = 'trend' AND NOT (config ? 'engineName');
    UPDATE forex_strategies SET config = config || '{"engineName":"Liquidity_Sweep_SMC"}'::jsonb
      WHERE slug = 'breakout' AND NOT (config ? 'engineName');
    UPDATE forex_strategies SET config = config || '{"engineName":"manual_only"}'::jsonb
      WHERE slug = 'grid' AND NOT (config ? 'engineName');
    UPDATE forex_strategies SET config = config || '{"engineName":"Liquidity_Sweep_SMC"}'::jsonb
      WHERE slug = 'sniper' AND NOT (config ? 'engineName');
  `).catch((e) => console.warn('forex strategy engineName backfill:', e.message));

  await pool.query(`
    ALTER TABLE forex_clients ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE forex_clients ADD COLUMN IF NOT EXISTS self_registered BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE forex_clients ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    ALTER TABLE forex_clients ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ;
    UPDATE forex_clients SET email = username WHERE email IS NULL AND username LIKE '%@%';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_forex_clients_email ON forex_clients (email) WHERE email IS NOT NULL;
  `).catch((e) => console.warn('forex_clients email:', e.message));

  await pool.query(`DELETE FROM forex_clients WHERE username = 'demo@gmail.com' OR email = 'demo@gmail.com'`)
    .catch((e) => console.warn('remove demo forex account:', e.message));

  // NVR areas under MikroTik sites (station) — cameras belong to an NVR
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nvr_areas (
      id          SERIAL PRIMARY KEY,
      station_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      notes       TEXT NOT NULL DEFAULT '',
      lat         DOUBLE PRECISION,
      lng         DOUBLE PRECISION,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (station_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_nvr_areas_station ON nvr_areas (station_id);
    ALTER TABLE cameras ADD COLUMN IF NOT EXISTS nvr_area_id INTEGER REFERENCES nvr_areas(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_cameras_nvr ON cameras (nvr_area_id);
  `).catch((e) => console.warn('nvr_areas:', e.message));

  // Dahua / Hikvision NVR device credentials + ports (for MikroTik NAT + RTSP)
  await pool.query(`
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'dahua';
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '';
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS lan_ip TEXT;
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS rtsp_port INTEGER NOT NULL DEFAULT 554;
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS tcp_port INTEGER NOT NULL DEFAULT 37777;
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS rtsp_user TEXT NOT NULL DEFAULT 'admin';
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS rtsp_pass TEXT NOT NULL DEFAULT '';
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS channels INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE nvr_areas ADD COLUMN IF NOT EXISTS firmware TEXT NOT NULL DEFAULT '';
  `).catch((e) => console.warn('nvr_areas device cols:', e.message));

  // Social Park / hotspot Buy Unli — PayMongo QRPH sessions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wifi_pay_sessions (
      id                  SERIAL PRIMARY KEY,
      site_id             INT REFERENCES wifi_mikrotik_sites(id) ON DELETE SET NULL,
      site_name           TEXT NOT NULL DEFAULT '',
      package_id          TEXT NOT NULL,
      package_label       TEXT NOT NULL DEFAULT '',
      amount_pesos        NUMERIC(14,2) NOT NULL,
      amount_centavos     INT NOT NULL,
      uptime_limit        TEXT NOT NULL DEFAULT '20h',
      validity_days       INT NOT NULL DEFAULT 3,
      valid_until         TIMESTAMPTZ,
      mac                 TEXT NOT NULL DEFAULT '',
      link_login          TEXT NOT NULL DEFAULT '',
      link_orig           TEXT NOT NULL DEFAULT '',
      client_ip           TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending','awaiting_payment','paid','ready',
                            'failed','expired'
                          )),
      paymongo_intent_id  TEXT,
      paymongo_method_id  TEXT,
      paymongo_payment_id TEXT,
      qr_image_url        TEXT NOT NULL DEFAULT '',
      client_key          TEXT NOT NULL DEFAULT '',
      hotspot_username    TEXT,
      hotspot_password    TEXT,
      mikrotik_user_id    TEXT NOT NULL DEFAULT '',
      error               TEXT NOT NULL DEFAULT '',
      expires_at          TIMESTAMPTZ,
      paid_at             TIMESTAMPTZ,
      provisioned_at      TIMESTAMPTZ,
      expired_cleaned     BOOLEAN NOT NULL DEFAULT false,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wifi_pay_sessions_site ON wifi_pay_sessions (site_id);
    CREATE INDEX IF NOT EXISTS idx_wifi_pay_sessions_intent ON wifi_pay_sessions (paymongo_intent_id);
    CREATE INDEX IF NOT EXISTS idx_wifi_pay_sessions_status ON wifi_pay_sessions (status);
    CREATE INDEX IF NOT EXISTS idx_wifi_pay_sessions_valid ON wifi_pay_sessions (valid_until)
      WHERE status = 'ready' AND expired_cleaned = false;
  `).catch((e) => console.warn('wifi_pay_sessions:', e.message));

  await pool.query(`
    GRANT ALL ON TABLE wifi_pay_sessions TO mrp;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mrp;
  `).catch(() => {});
}
