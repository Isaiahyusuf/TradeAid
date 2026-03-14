import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const isRailwayRuntime = Boolean(
  String(process.env.RAILWAY_ENVIRONMENT || "").trim()
  || String(process.env.RAILWAY_PROJECT_ID || "").trim(),
);

const allowLocalDotenv = String(process.env.ALLOW_LOCAL_DOTENV || "false").trim().toLowerCase() === "true";

if (!isRailwayRuntime && process.env.NODE_ENV !== "production" && allowLocalDotenv) {
  const dotenv = require("dotenv") as typeof import("dotenv");
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set in environment variables (Railway service variables in production).",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

const walletDatabaseUrl = String(
  process.env.RAILWAY_WALLET_DATABASE_URL
  || process.env.WALLET_DATABASE_URL
  || process.env.DATABASE_URL,
).trim();

const tradeDatabaseUrl = String(
  process.env.RAILWAY_TRADE_DATABASE_URL
  || process.env.TRADE_DATABASE_URL
  || process.env.DATABASE_URL,
).trim();

const walletPool = new Pool({ connectionString: walletDatabaseUrl });
const tradePool = new Pool({ connectionString: tradeDatabaseUrl });

export const walletDb = drizzle(walletPool, { schema });
export const tradeDb = drizzle(tradePool, { schema });
