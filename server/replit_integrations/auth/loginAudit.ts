import { sql } from "drizzle-orm";
import { db } from "../../db";

type LoginAuditPayload = {
  userId?: string | null;
  username?: string | null;
  email?: string | null;
  method?: string;
  source?: string;
  success?: boolean;
  clientIp?: string | null;
  userAgent?: string | null;
  requestHost?: string | null;
};

let loginAuditReady = false;

export async function ensureLoginAuditTable(): Promise<void> {
  if (loginAuditReady) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS login_audit (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID,
      username TEXT,
      email TEXT,
      method TEXT NOT NULL DEFAULT 'password',
      source TEXT NOT NULL DEFAULT 'api',
      success BOOLEAN NOT NULL DEFAULT TRUE,
      client_ip TEXT,
      user_agent TEXT,
      request_host TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS login_audit_created_at_idx ON login_audit (created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS login_audit_user_id_idx ON login_audit (user_id)`);

  loginAuditReady = true;
}

export function resolveClientIp(req: any): string {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return String(req?.ip || req?.socket?.remoteAddress || "").trim();
}

export async function recordLoginAudit(payload: LoginAuditPayload): Promise<void> {
  await ensureLoginAuditTable();

  const userId = String(payload.userId || "").trim();
  const username = String(payload.username || "").trim();
  const email = String(payload.email || "").trim();
  const method = String(payload.method || "password").trim().toLowerCase() || "password";
  const source = String(payload.source || "api").trim() || "api";
  const success = payload.success !== false;
  const clientIp = String(payload.clientIp || "").trim();
  const userAgent = String(payload.userAgent || "").trim();
  const requestHost = String(payload.requestHost || "").trim();

  await db.execute(sql`
    INSERT INTO login_audit (
      user_id,
      username,
      email,
      method,
      source,
      success,
      client_ip,
      user_agent,
      request_host,
      created_at
    )
    VALUES (
      ${userId ? sql`${userId}::uuid` : sql`NULL`},
      ${username || null},
      ${email || null},
      ${method},
      ${source},
      ${success},
      ${clientIp || null},
      ${userAgent || null},
      ${requestHost || null},
      NOW()
    )
  `);
}
