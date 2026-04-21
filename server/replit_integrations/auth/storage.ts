import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

const AUTH_DB_MAX_RETRIES = Math.max(1, Number(process.env.AUTH_DB_MAX_RETRIES || 2));
const AUTH_DB_RETRY_DELAY_MS = Math.max(25, Number(process.env.AUTH_DB_RETRY_DELAY_MS || 80));
const AUTH_DB_QUERY_TIMEOUT_MS = Math.max(250, Number(process.env.AUTH_DB_QUERY_TIMEOUT_MS || 900));

function isTransientDbError(error: unknown): boolean {
  const message = String((error as any)?.message || "").toLowerCase();
  const code = String((error as any)?.code || "").toUpperCase();
  if (code === "ECONNRESET" || code === "ETIMEDOUT") return true;
  return (
    message.includes("econnreset")
    || message.includes("connection terminated unexpectedly")
    || message.includes("connection reset")
    || message.includes("terminating connection")
    || message.includes("timeout expired")
  );
}

async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AUTH_DB_MAX_RETRIES; attempt += 1) {
    try {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error(`auth db query timeout after ${AUTH_DB_QUERY_TIMEOUT_MS}ms`) as Error & { code?: string };
          timeoutError.code = "ETIMEDOUT";
          reject(timeoutError);
        }, AUTH_DB_QUERY_TIMEOUT_MS);
        timer.unref?.();
      });

      try {
        return await Promise.race([fn(), timeoutPromise]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= AUTH_DB_MAX_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, AUTH_DB_RETRY_DELAY_MS * attempt));
    }
  }
  throw lastError;
}

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await withDbRetry(() => db.select().from(users).where(eq(users.id, id)));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const value = String(username || "").trim();
    if (!value) return undefined;
    const [user] = await withDbRetry(() => db
      .select()
      .from(users)
      .where(sql`LOWER(${users.username}) = LOWER(${value})`));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const value = String(email || "").trim();
    if (!value) return undefined;
    const [user] = await withDbRetry(() => db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${value})`));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await withDbRetry(() => db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning());
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await withDbRetry(() => db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning());
    return user;
  }
}

export const authStorage = new AuthStorage();
