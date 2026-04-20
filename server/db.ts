import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const isRailwayRuntime = Boolean(
  String(process.env.RAILWAY_ENVIRONMENT || "").trim()
  || String(process.env.RAILWAY_PROJECT_ID || "").trim(),
);

const allowLocalDotenv = String(process.env.ALLOW_LOCAL_DOTENV || "false").trim().toLowerCase() === "true";

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return "";
}

if (!isRailwayRuntime && process.env.NODE_ENV !== "production" && allowLocalDotenv) {
  const dotenv = require("dotenv") as typeof import("dotenv");
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

const primaryDatabaseUrl = firstNonEmpty(
  process.env.DATABASE_URL,
  process.env.RAILWAY_WALLET_DATABASE_URL,
  process.env.WALLET_DATABASE_URL,
  process.env.RAILWAY_TRADE_DATABASE_URL,
  process.env.TRADE_DATABASE_URL,
);

if (!primaryDatabaseUrl) {
  throw new Error(
    "No database connection string found. Set DATABASE_URL, RAILWAY_WALLET_DATABASE_URL/WALLET_DATABASE_URL, or RAILWAY_TRADE_DATABASE_URL/TRADE_DATABASE_URL.",
  );
}

const poolMax = Math.max(1, Math.min(12, Number(process.env.DB_POOL_MAX || 4)));
const poolIdleTimeoutMs = Math.max(1000, Number(process.env.DB_POOL_IDLE_TIMEOUT_MS || 10000));
const poolConnectTimeoutMs = Math.max(1000, Number(process.env.DB_POOL_CONNECT_TIMEOUT_MS || 5000));

const buildPool = (connectionString: string) => new Pool({
  connectionString,
  max: poolMax,
  idleTimeoutMillis: poolIdleTimeoutMs,
  connectionTimeoutMillis: poolConnectTimeoutMs,
  keepAlive: true,
});

export const pool = buildPool(primaryDatabaseUrl);
export const db = drizzle(pool, { schema });

const walletDatabaseUrl = firstNonEmpty(
  process.env.RAILWAY_WALLET_DATABASE_URL,
  process.env.WALLET_DATABASE_URL,
  primaryDatabaseUrl,
);

const tradeDatabaseUrl = firstNonEmpty(
  process.env.RAILWAY_TRADE_DATABASE_URL,
  process.env.TRADE_DATABASE_URL,
  primaryDatabaseUrl,
);

const walletPool = walletDatabaseUrl === primaryDatabaseUrl
  ? pool
  : buildPool(walletDatabaseUrl);

const tradePool = tradeDatabaseUrl === primaryDatabaseUrl
  ? pool
  : (tradeDatabaseUrl === walletDatabaseUrl ? walletPool : buildPool(tradeDatabaseUrl));

export const walletDb = drizzle(walletPool, { schema });
export const tradeDb = drizzle(tradePool, { schema });
