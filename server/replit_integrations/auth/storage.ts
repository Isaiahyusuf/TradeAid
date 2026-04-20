import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

const AUTH_DB_MAX_RETRIES = Math.max(1, Number(process.env.AUTH_DB_MAX_RETRIES || 3));
const AUTH_DB_RETRY_DELAY_MS = Math.max(25, Number(process.env.AUTH_DB_RETRY_DELAY_MS || 120));

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
      return await fn();
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

const memoryUsersById = new Map<string, User>();

function cacheUser(user: User | undefined): void {
  if (!user?.id) return;
  memoryUsersById.set(String(user.id), user);
}

function getCachedUserByUsername(username: string): User | undefined {
  const value = String(username || "").trim().toLowerCase();
  if (!value) return undefined;
  for (const user of memoryUsersById.values()) {
    if (String(user.username || "").trim().toLowerCase() === value) return user;
  }
  return undefined;
}

function getCachedUserByEmail(email: string): User | undefined {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return undefined;
  for (const user of memoryUsersById.values()) {
    if (String(user.email || "").trim().toLowerCase() === value) return user;
  }
  return undefined;
}

function toFallbackUser(userData: UpsertUser): User {
  const now = new Date();
  return {
    id: String(userData.id),
    username: String(userData.username || ""),
    email: userData.email ?? null,
    firstName: userData.firstName ?? null,
    lastName: (userData as any).lastName ?? null,
    profileImageUrl: userData.profileImageUrl ?? null,
    notificationsEnabled: (userData as any).notificationsEnabled ?? true,
    hashedPassword: (userData as any).hashedPassword ?? null,
    createdAt: (userData as any).createdAt ?? now,
    updatedAt: now,
  } as User;
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
    try {
      const [user] = await withDbRetry(() => db.select().from(users).where(eq(users.id, id)));
      cacheUser(user);
      return user;
    } catch {
      return memoryUsersById.get(String(id)) as User | undefined;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const value = String(username || "").trim();
    if (!value) return undefined;
    try {
      const [user] = await withDbRetry(() => db
        .select()
        .from(users)
        .where(sql`LOWER(${users.username}) = LOWER(${value})`));
      cacheUser(user);
      return user;
    } catch {
      return getCachedUserByUsername(value);
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const value = String(email || "").trim();
    if (!value) return undefined;
    try {
      const [user] = await withDbRetry(() => db
        .select()
        .from(users)
        .where(sql`LOWER(${users.email}) = LOWER(${value})`));
      cacheUser(user);
      return user;
    } catch {
      return getCachedUserByEmail(value);
    }
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
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
      cacheUser(user);
      return user;
    } catch {
      const fallback = toFallbackUser(userData);
      cacheUser(fallback);
      return fallback;
    }
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    try {
      const [user] = await withDbRetry(() => db
        .update(users)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning());
      cacheUser(user);
      return user;
    } catch {
      const existing = memoryUsersById.get(String(id));
      if (!existing) return undefined;
      const merged = {
        ...existing,
        ...updates,
        updatedAt: new Date(),
      } as User;
      cacheUser(merged);
      return merged;
    }
  }
}

export const authStorage = new AuthStorage();
