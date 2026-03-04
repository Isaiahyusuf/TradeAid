const { Client } = require('pg');
const conn = 'postgresql://postgres:XWQZRFpSXlECPJOwQkyuNnJnALxRQzLE@hopper.proxy.rlwy.net:17726/railway';
const ddl = `
CREATE TABLE IF NOT EXISTS scanned_tokens (
  id serial PRIMARY KEY,
  address text NOT NULL UNIQUE,
  symbol text NOT NULL,
  name text NOT NULL,
  chain text NOT NULL DEFAULT 'solana',
  dex_id text,
  pair_address text,
  price_usd text,
  price_native text,
  liquidity real DEFAULT 0,
  market_cap real DEFAULT 0,
  volume_24h real DEFAULT 0,
  price_change_1h real DEFAULT 0,
  price_change_24h real DEFAULT 0,
  buys_24h integer DEFAULT 0,
  sells_24h integer DEFAULT 0,
  safety_score integer NOT NULL DEFAULT 0,
  is_liquidity_locked boolean NOT NULL DEFAULT false,
  mint_authority_disabled boolean NOT NULL DEFAULT false,
  top_holders_percentage integer NOT NULL DEFAULT 0,
  dev_wallet_percentage integer NOT NULL DEFAULT 0,
  is_honeypot boolean NOT NULL DEFAULT false,
  risk_level text DEFAULT 'unknown',
  ai_signal text DEFAULT 'hold',
  ai_analysis text,
  social_links jsonb,
  pair_created_at timestamp,
  last_scanned_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlists (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  token_address text NOT NULL,
  alert_on_price_up real,
  alert_on_price_down real,
  alert_on_volume real,
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_alerts (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  token_address text,
  alert_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_signals (
  id serial PRIMARY KEY,
  token_address text NOT NULL,
  signal_type text NOT NULL,
  confidence integer DEFAULT 0,
  entry_price text,
  target_price text,
  stop_loss text,
  reasoning text,
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trending_coins (
  id serial PRIMARY KEY,
  symbol text NOT NULL,
  name text NOT NULL,
  price text NOT NULL,
  volume_24h text NOT NULL,
  hype_score integer NOT NULL,
  trend text NOT NULL,
  last_updated timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id serial PRIMARY KEY,
  user_id text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  payment_method text,
  tx_hash text,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_records (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  chain text NOT NULL,
  tx_hash text NOT NULL UNIQUE,
  amount text NOT NULL,
  expected_amount text NOT NULL,
  sender_address text,
  recipient_address text,
  status text NOT NULL DEFAULT 'pending',
  verification_error text,
  verified_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_usage (
  id serial PRIMARY KEY,
  user_id text NOT NULL UNIQUE,
  daily_scans integer DEFAULT 0,
  daily_deep_analyses integer DEFAULT 0,
  daily_signal_views integer DEFAULT 0,
  ads_viewed integer DEFAULT 0,
  last_reset_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now()
);
`;

(async () => {
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(ddl);
  console.log('Tables ensured');
  await client.end();
})().catch(err => { console.error(err); process.exit(1); });