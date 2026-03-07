import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config();

const connectionString = String(process.env.DATABASE_URL || "").trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const { Client } = pg;
const client = new Client({ connectionString });

async function run() {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS tracked_wallets (
      id SERIAL PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      win_rate INTEGER DEFAULT 0,
      total_profit TEXT DEFAULT '0 SOL'
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wallet_alerts (
      id SERIAL PRIMARY KEY,
      wallet_id INTEGER REFERENCES tracked_wallets(id),
      token_symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      amount TEXT NOT NULL,
      price TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS trending_coins (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      price TEXT NOT NULL,
      volume_24h TEXT NOT NULL,
      hype_score INTEGER NOT NULL,
      trend TEXT NOT NULL,
      last_updated TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS scanned_tokens (
      id SERIAL PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'solana',
      dex_id TEXT,
      pair_address TEXT,
      price_usd TEXT,
      price_native TEXT,
      liquidity REAL DEFAULT 0,
      market_cap REAL DEFAULT 0,
      volume_24h REAL DEFAULT 0,
      price_change_1h REAL DEFAULT 0,
      price_change_24h REAL DEFAULT 0,
      buys_24h INTEGER DEFAULT 0,
      sells_24h INTEGER DEFAULT 0,
      safety_score INTEGER NOT NULL DEFAULT 0,
      is_liquidity_locked BOOLEAN NOT NULL DEFAULT FALSE,
      mint_authority_disabled BOOLEAN NOT NULL DEFAULT FALSE,
      top_holders_percentage INTEGER NOT NULL DEFAULT 0,
      dev_wallet_percentage INTEGER NOT NULL DEFAULT 0,
      is_honeypot BOOLEAN NOT NULL DEFAULT FALSE,
      risk_level TEXT DEFAULT 'unknown',
      ai_signal TEXT DEFAULT 'hold',
      ai_analysis TEXT,
      social_links JSONB,
      pair_created_at TIMESTAMP,
      last_scanned_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.end();
  console.log("core tables ensured");
}

run().catch(async (error) => {
  try {
    await client.end();
  } catch {
  }
  throw error;
});
