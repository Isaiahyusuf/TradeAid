import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const isRailwayRuntime = Boolean(
  String(process.env.RAILWAY_ENVIRONMENT || "").trim()
  || String(process.env.RAILWAY_PROJECT_ID || "").trim(),
);

if (!isRailwayRuntime && process.env.NODE_ENV !== "production") {
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
