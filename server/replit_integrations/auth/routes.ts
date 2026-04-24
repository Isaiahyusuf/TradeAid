import type { Express } from "express";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { issueSessionTokens, readBearerToken, getSessionUserId, rotateRefreshToken, revokeAllSessionTokens } from "./tokenSession";
import { ensureLoginAuditTable, recordLoginAudit, resolveClientIp } from "./loginAudit";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { storage } from "../../storage";

const USERNAME_PATTERN = /^[a-z][a-z0-9._]{1,22}[a-z0-9]$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "app",
  "help",
  "info",
  "login",
  "logout",
  "me",
  "root",
  "security",
  "settings",
  "support",
  "system",
  "tradeaid",
  "doctortrade",
  "user",
  "users",
]);

const AUTH_PASSWORDS_STATE_KEY = "auth.password_hashes.v1";
const AUTH_FRESH_RESET_STATE_KEY = "auth.fresh_reset.v1";
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEYLEN_BYTES = 64;
const PASSWORD_MAX_BYTES = 72;
const AUTH_EMERGENCY_FALLBACK_ENABLED = String(process.env.AUTH_EMERGENCY_FALLBACK_ENABLED || "true").trim().toLowerCase() !== "false";
const AUTH_FAST_STATE_TIMEOUT_MS = Math.max(300, Number(process.env.AUTH_FAST_STATE_TIMEOUT_MS || 1200));
const AUTH_PASSWORD_HASH_CACHE_TTL_MS = Math.max(5_000, Number(process.env.AUTH_PASSWORD_HASH_CACHE_TTL_MS || 60_000));
const AUTH_DB_MAX_RETRIES = Math.max(0, Number(process.env.AUTH_DB_MAX_RETRIES || 2));
const AUTH_DB_RETRY_DELAY_MS = Math.max(50, Number(process.env.AUTH_DB_RETRY_DELAY_MS || 100));

const emergencyUsersById = new Map<string, any>();
const emergencyUserIdByUsername = new Map<string, string>();
const emergencyUserIdByEmail = new Map<string, string>();
const emergencyPasswordHashesByUserId = new Map<string, string>();
let cachedPasswordHashesByUserId: Record<string, string> | null = null;
let cachedPasswordHashesLoadedAtMs = 0;

async function withAuthFastTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutError = new Error(`auth_fast_timeout_${AUTH_FAST_STATE_TIMEOUT_MS}ms`) as Error & { code?: string };
      timeoutError.code = "ETIMEDOUT";
      reject(timeoutError);
    }, AUTH_FAST_STATE_TIMEOUT_MS);
    timer.unref?.();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isDbConnectivityError(error: unknown): boolean {
  const message = String((error as any)?.message || "").toLowerCase();
  const code = String((error as any)?.code || "").toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"].includes(code)) return true;
  return (
    message.includes("econnreset")
    || message.includes("connection terminated unexpectedly")
    || message.includes("connection reset")
    || message.includes("timeout")
    || message.includes("enotfound")
  );
}

async function withAuthDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= AUTH_DB_MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isDbConnectivityError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt >= AUTH_DB_MAX_RETRIES) {
        break;
      }
      const delayMs = AUTH_DB_RETRY_DELAY_MS * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("auth_db_unavailable");
}

function cacheEmergencyUser(user: any | undefined): void {
  if (!AUTH_EMERGENCY_FALLBACK_ENABLED || !user?.id) return;
  const id = String(user.id);
  const username = String(user.username || "").trim().toLowerCase();
  const email = String(user.email || "").trim().toLowerCase();
  emergencyUsersById.set(id, { ...user });
  if (username) emergencyUserIdByUsername.set(username, id);
  if (email) emergencyUserIdByEmail.set(email, id);
}

function getEmergencyUserById(userId: string): any | undefined {
  if (!AUTH_EMERGENCY_FALLBACK_ENABLED) return undefined;
  return emergencyUsersById.get(String(userId || "").trim());
}

function getEmergencyUserByUsername(username: string): any | undefined {
  if (!AUTH_EMERGENCY_FALLBACK_ENABLED) return undefined;
  const key = String(username || "").trim().toLowerCase();
  if (!key) return undefined;
  const userId = emergencyUserIdByUsername.get(key);
  return userId ? emergencyUsersById.get(userId) : undefined;
}

function getEmergencyUserByEmail(email: string): any | undefined {
  if (!AUTH_EMERGENCY_FALLBACK_ENABLED) return undefined;
  const key = String(email || "").trim().toLowerCase();
  if (!key) return undefined;
  const userId = emergencyUserIdByEmail.get(key);
  return userId ? emergencyUsersById.get(userId) : undefined;
}

function isStrongPassword(value: string): boolean {
  const password = String(value || "");
  return (
    password.length >= 8
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password)
  );
}

function passwordByteLength(value: string): number {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function getPasswordValidationMessage(value: string): string | null {
  const password = String(value || "");
  if (!password) {
    return "password is required";
  }
  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
    return `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer.`;
  }
  if (!isStrongPassword(password)) {
    return "Password must be at least 8 chars and include uppercase, number, and special character.";
  }
  return null;
}

function hashPassword(plainText: string): string {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derived = scryptSync(String(plainText || ""), salt, PASSWORD_KEYLEN_BYTES);
  return `scrypt:v1:${salt.toString("base64")}:${derived.toString("base64")}`;
}

function verifyPassword(plainText: string, stored: string): boolean {
  const value = String(stored || "").trim();
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== "v1") {
    return false;
  }

  try {
    const salt = Buffer.from(parts[2], "base64");
    const expected = Buffer.from(parts[3], "base64");
    const actual = scryptSync(String(plainText || ""), salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function getPasswordHashesByUserId(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const [userId, hash] of emergencyPasswordHashesByUserId.entries()) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedHash = String(hash || "").trim();
    if (!normalizedUserId || !normalizedHash) continue;
    merged[normalizedUserId] = normalizedHash;
  }

  const nowMs = Date.now();
  if (cachedPasswordHashesByUserId && (nowMs - cachedPasswordHashesLoadedAtMs) <= AUTH_PASSWORD_HASH_CACHE_TTL_MS) {
    for (const [userId, hash] of Object.entries(cachedPasswordHashesByUserId)) {
      const normalizedUserId = String(userId || "").trim();
      const normalizedHash = String(hash || "").trim();
      if (!normalizedUserId || !normalizedHash) continue;
      merged[normalizedUserId] = normalizedHash;
    }
    return merged;
  }

  try {
    const state = await withAuthFastTimeout(storage.getAppState<Record<string, any>>(AUTH_PASSWORDS_STATE_KEY));
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      cachedPasswordHashesByUserId = {};
      cachedPasswordHashesLoadedAtMs = nowMs;
      return merged;
    }
    const snapshot: Record<string, string> = {};
    for (const [userId, hash] of Object.entries(state)) {
      const normalizedUserId = String(userId || "").trim();
      const normalizedHash = String(hash || "").trim();
      if (!normalizedUserId || !normalizedHash) continue;
      merged[normalizedUserId] = normalizedHash;
      snapshot[normalizedUserId] = normalizedHash;
    }
    cachedPasswordHashesByUserId = snapshot;
    cachedPasswordHashesLoadedAtMs = nowMs;
    return merged;
  } catch {
    return merged;
  }
}

async function setPasswordHashesByUserId(value: Record<string, string>): Promise<void> {
  const snapshot: Record<string, string> = {};
  for (const [userId, hash] of Object.entries(value || {})) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedHash = String(hash || "").trim();
    if (!normalizedUserId || !normalizedHash) continue;
    emergencyPasswordHashesByUserId.set(normalizedUserId, normalizedHash);
    snapshot[normalizedUserId] = normalizedHash;
  }
  cachedPasswordHashesByUserId = snapshot;
  cachedPasswordHashesLoadedAtMs = Date.now();
  try {
    await withAuthFastTimeout(storage.setAppState(AUTH_PASSWORDS_STATE_KEY, value));
  } catch {
  }
}

async function ensurePasswordHashTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth_password_hashes (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getPersistentPasswordHash(userId: string): Promise<string> {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return "";

  try {
    await withAuthFastTimeout(ensurePasswordHashTable());
    const result = await withAuthFastTimeout(db.execute(sql`
      SELECT password_hash
      FROM auth_password_hashes
      WHERE user_id = ${normalizedUserId}
      LIMIT 1
    `));
    const rows = (result as any)?.rows as Array<{ password_hash?: string }> | undefined;
    const value = String(rows?.[0]?.password_hash || "").trim();
    if (value) {
      emergencyPasswordHashesByUserId.set(normalizedUserId, value);
    }
    return value;
  } catch {
    return String(emergencyPasswordHashesByUserId.get(normalizedUserId) || "").trim();
  }
}

async function setPersistentPasswordHash(userId: string, passwordHash: string): Promise<void> {
  const normalizedUserId = String(userId || "").trim();
  const normalizedHash = String(passwordHash || "").trim();
  if (!normalizedUserId || !normalizedHash) return;
  emergencyPasswordHashesByUserId.set(normalizedUserId, normalizedHash);

  try {
    await ensurePasswordHashTable();
    await db.execute(sql`
      INSERT INTO auth_password_hashes (user_id, password_hash, updated_at)
      VALUES (${normalizedUserId}, ${normalizedHash}, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW()
    `);
  } catch {
  }
}

function requiredAccessCodeForRoute(routeType: "login" | "register"): string {
  const genericAccessCode = String(
    process.env.AUTH_ACCESS_CODE
    || process.env.ACCESS_CODE
    || process.env.TRADEAID_ACCESS_CODE
    || "",
  ).trim();

  if (routeType === "register") {
    return String(process.env.AUTH_REGISTER_ACCESS_CODE || genericAccessCode).trim();
  }
  return String(process.env.AUTH_LOGIN_ACCESS_CODE || genericAccessCode).trim();
}

function mapRegistrationError(error: unknown): { status: number; message: string } {
  const raw = String((error as any)?.message || "").toLowerCase();
  if (!raw) {
    return { status: 500, message: "Registration failed" };
  }

  if (
    raw.includes("users_username_key")
    || (raw.includes("duplicate") && raw.includes("username"))
    || raw.includes("username already")
  ) {
    return { status: 409, message: "Username already taken" };
  }

  if (
    raw.includes("users_email_key")
    || (raw.includes("duplicate") && raw.includes("email"))
    || raw.includes("email already")
  ) {
    return { status: 409, message: "Email already in use" };
  }

  if (raw.includes("invalid access code")) {
    return { status: 401, message: "Invalid access code" };
  }

  if (
    raw.includes("password must")
    || raw.includes("invalid password format")
    || raw.includes("weak password")
  ) {
    return { status: 400, message: "Invalid password format" };
  }

  return { status: 500, message: "Registration failed" };
}

function isAccessCodeValid(provided: string, required: string): boolean {
  const normalizedProvided = String(provided || "").trim();
  const normalizedRequired = String(required || "").trim();
  const providedBuffer = Buffer.from(normalizedProvided);
  const requiredBuffer = Buffer.from(normalizedRequired);

  if (!normalizedRequired || providedBuffer.length !== requiredBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(providedBuffer, requiredBuffer);
  } catch {
    return false;
  }
}

async function runFreshUserResetIfConfigured(): Promise<void> {
  const forceReset = String(process.env.AUTH_FORCE_FRESH_USERS || "false").trim().toLowerCase() === "true";
  if (!forceReset) return;

  const marker = await storage.getAppState<Record<string, any>>(AUTH_FRESH_RESET_STATE_KEY);
  if (String(marker?.done || "").trim() === "true") {
    return;
  }

  await db.execute(sql`TRUNCATE TABLE sessions, users RESTART IDENTITY CASCADE`);
  await setPasswordHashesByUserId({});
  revokeAllSessionTokens();
  await storage.setAppState(AUTH_FRESH_RESET_STATE_KEY, {
    done: "true",
    at: new Date().toISOString(),
    reason: "forced_fresh_users",
  });
}

function normalizeUsername(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function emergencyUserIdForUsername(value: string): string {
  return `emergency:${normalizeUsername(value)}`;
}

function createEmergencyFallbackUser(username: string): any {
  const normalizedUsername = normalizeUsername(username);
  return {
    id: emergencyUserIdForUsername(normalizedUsername),
    username: normalizedUsername,
    email: `${normalizedUsername}@tradeaid.local`,
    firstName: null,
    profileImageUrl: null,
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function getUsernameValidationMessage(value: string): string | null {
  if (!value) {
    return "Username is required.";
  }
  if (!USERNAME_PATTERN.test(value)) {
    return "Use 3-24 chars: lowercase letters, numbers, dot or underscore; must start with a letter and end with a letter/number.";
  }
  if (value.includes("..") || value.includes("__") || value.includes("._") || value.includes("_.")) {
    return "Username cannot contain consecutive dots/underscores.";
  }
  if (RESERVED_USERNAMES.has(value)) {
    return "That username is reserved.";
  }
  return null;
}

function toFrontendUser(user: any) {
  return {
    user_id: user.id,
    username: user.username || "",
    email: user.email || "",
    is_admin: false,
    totp_enabled: false,
    email_verified: true,
    display_name: user.firstName || "",
    avatar_url: user.profileImageUrl || "",
    telemetry_opt_in: Boolean(user.notificationsEnabled ?? true),
  };
}

async function resolveUserFromRequest(req: any) {
  const accessToken = readBearerToken(req);
  const userIdFromToken = getSessionUserId(accessToken, "access");
  if (userIdFromToken) {
    let user: any;
    try {
      user = await authStorage.getUser(userIdFromToken);
      cacheEmergencyUser(user);
    } catch (error) {
      if (!isDbConnectivityError(error)) throw error;
      user = getEmergencyUserById(userIdFromToken);
    }
    if (user) {
      return user;
    }
  }

  const sub = String(req.user?.claims?.sub || "").trim();
  if (!sub) {
    return undefined;
  }

  let existing: any;
  try {
    existing = await authStorage.getUser(sub);
    cacheEmergencyUser(existing);
  } catch (error) {
    if (!isDbConnectivityError(error)) throw error;
    existing = getEmergencyUserById(sub);
  }
  if (existing) {
    return existing;
  }

  const profile = {
    id: sub,
    email: req.user?.claims?.email || null,
    username: req.user?.claims?.preferred_username || req.user?.claims?.name || `user_${sub.slice(0, 8)}`,
    firstName: req.user?.claims?.name || null,
    profileImageUrl: req.user?.claims?.profile_image_url || req.user?.claims?.picture || null,
  };

  try {
    const created = await authStorage.upsertUser(profile);
    cacheEmergencyUser(created);
    return created;
  } catch (error) {
    if (!isDbConnectivityError(error)) throw error;
    const fallbackUser = {
      ...profile,
      notificationsEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    cacheEmergencyUser(fallbackUser);
    return fallbackUser;
  }
}

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  ensurePasswordHashTable().catch((error) => {
    console.error("[auth] failed to ensure password hash table", error);
  });
  ensureLoginAuditTable().catch((error) => {
    console.error("[auth] failed to ensure login audit table", error);
  });

  runFreshUserResetIfConfigured().catch((error) => {
    console.error("[auth] failed to perform forced fresh-user reset", error);
  });

  // Login endpoint
  app.post("/api/auth/login", async (req: any, res) => {
    try {
      const usernameOrEmail = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");
      const accessCode = String(req.body?.access_code || "").trim();
      if (!usernameOrEmail) {
        return res.status(400).json({ message: "username is required" });
      }
      if (!password) {
        return res.status(400).json({ message: "password is required" });
      }
      if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
        return res.status(400).json({ message: `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer.` });
      }

      const requiredAccessCode = requiredAccessCodeForRoute("login");
      if (requiredAccessCode && !isAccessCodeValid(accessCode, requiredAccessCode)) {
        return res.status(401).json({ message: "Invalid access code" });
      }

      let user: any;
      const normalizedUsername = usernameOrEmail.includes("@") ? "" : normalizeUsername(usernameOrEmail);
      try {
        user = await withAuthDbRetry(() => (
          usernameOrEmail.includes("@")
            ? authStorage.getUserByEmail(usernameOrEmail)
            : authStorage.getUserByUsername(normalizedUsername)
        ));
        cacheEmergencyUser(user);
      } catch (error) {
        if (!isDbConnectivityError(error)) throw error;
        user = usernameOrEmail.includes("@")
          ? getEmergencyUserByEmail(usernameOrEmail)
          : getEmergencyUserByUsername(normalizedUsername);
        if (!user) {
          if (!usernameOrEmail.includes("@") && AUTH_EMERGENCY_FALLBACK_ENABLED && normalizedUsername) {
            const hashesByUserId = await getPasswordHashesByUserId();
            const emergencyUserId = emergencyUserIdForUsername(normalizedUsername);
            let emergencyHash = String(hashesByUserId[emergencyUserId] || "").trim();
            if (!emergencyHash) {
              emergencyHash = await getPersistentPasswordHash(emergencyUserId);
              if (emergencyHash) {
                hashesByUserId[emergencyUserId] = emergencyHash;
                await setPasswordHashesByUserId(hashesByUserId);
              }
            }
            if (emergencyHash) {
              user = createEmergencyFallbackUser(normalizedUsername);
              cacheEmergencyUser(user);
            }
          }
          if (!user) {
            return res.status(503).json({
              message: "Authentication database is temporarily unavailable. Please retry in a moment.",
              code: "auth_db_unavailable",
            });
          }
        }
      }

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const hashesByUserId = await getPasswordHashesByUserId();
      let storedHash = String(hashesByUserId[user.id] || "").trim();
      if (!storedHash) {
        const persistentHash = await getPersistentPasswordHash(user.id);
        if (persistentHash) {
          storedHash = persistentHash;
          hashesByUserId[user.id] = persistentHash;
          await setPasswordHashesByUserId(hashesByUserId);
        }
      }
      if (!storedHash) {
        try {
          await db.execute(sql`DELETE FROM users WHERE id = ${user.id}`);
        } catch {
        }
        return res.status(401).json({
          message: "Account reset required. Please create a new account.",
          code: "fresh_signup_required",
        });
      }

      const passwordOk = verifyPassword(password, storedHash);
      if (!passwordOk) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const tokens = issueSessionTokens(user.id);
      cacheEmergencyUser(user);
      if (storedHash) {
        emergencyPasswordHashesByUserId.set(String(user.id), storedHash);
      }
      try {
        await recordLoginAudit({
          userId: user.id,
          username: user.username || "",
          email: user.email || "",
          method: "password",
          source: "/api/auth/login",
          success: true,
          clientIp: resolveClientIp(req),
          userAgent: String(req.headers?.["user-agent"] || ""),
          requestHost: String(req.headers?.host || req.hostname || ""),
        });
      } catch {
      }
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
        emergency_mode: false,
      });
    } catch (error) {
      console.error("Error during login:", error);
      if (isDbConnectivityError(error) && AUTH_EMERGENCY_FALLBACK_ENABLED) {
        return res.status(503).json({ message: "Database temporarily unavailable. Retry in a moment.", emergency_mode: true });
      }
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Register endpoint
  app.post("/api/auth/register", async (req: any, res) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const emailRaw = String(req.body?.email || "").trim();
      const password = String(req.body?.password || "");
      const accessCode = String(req.body?.access_code || "").trim();
      const email = emailRaw || `${username}@tradeaid.local`;

      const requiredAccessCode = requiredAccessCodeForRoute("register");
      if (requiredAccessCode && !isAccessCodeValid(accessCode, requiredAccessCode)) {
        return res.status(401).json({ message: "Invalid access code" });
      }

      const passwordValidationMessage = getPasswordValidationMessage(password);
      if (passwordValidationMessage) {
        return res.status(400).json({ message: passwordValidationMessage });
      }

      const usernameError = getUsernameValidationMessage(username);
      if (usernameError) {
        return res.status(400).json({ message: usernameError });
      }

      let hashesByUserId = await getPasswordHashesByUserId();
      const emergencyUserId = emergencyUserIdForUsername(username);
      if (String(hashesByUserId[emergencyUserId] || "").trim()) {
        return res.status(409).json({ message: "Username already taken" });
      }
      const purgeGhostUserIfNeeded = async (user: any | undefined): Promise<boolean> => {
        if (!user?.id) return false;
        const existingHash = String(hashesByUserId[user.id] || "").trim() || await getPersistentPasswordHash(user.id);
        if (existingHash) return false;

        try {
          await db.execute(sql`DELETE FROM users WHERE id = ${user.id}`);
        } catch {
          return false;
        }

        delete hashesByUserId[user.id];
        await setPasswordHashesByUserId(hashesByUserId);
        return true;
      };

      let existingByUsername: any;
      try {
        existingByUsername = await withAuthDbRetry(() => authStorage.getUserByUsername(username));
        cacheEmergencyUser(existingByUsername);
      } catch (error) {
        if (!isDbConnectivityError(error)) throw error;
        existingByUsername = getEmergencyUserByUsername(username);
      }
      if (existingByUsername) {
        const purged = await purgeGhostUserIfNeeded(existingByUsername);
        if (!purged) {
          return res.status(409).json({ message: "Username already taken" });
        }
      }

      if (email) {
        let existingByEmail: any;
        try {
          existingByEmail = await withAuthDbRetry(() => authStorage.getUserByEmail(email));
          cacheEmergencyUser(existingByEmail);
        } catch (error) {
          if (!isDbConnectivityError(error)) throw error;
          existingByEmail = getEmergencyUserByEmail(email);
        }
        if (existingByEmail) {
          const purged = await purgeGhostUserIfNeeded(existingByEmail);
          if (!purged) {
            return res.status(409).json({ message: "Email already in use" });
          }
        }
      }

      let emergencyMode = false;
      let newUser: any;
      try {
        newUser = await withAuthDbRetry(() => authStorage.upsertUser({
          id: randomUUID(),
          username,
          email,
        }));
      } catch (error) {
        if (isDbConnectivityError(error)) {
          if (!AUTH_EMERGENCY_FALLBACK_ENABLED) {
            return res.status(503).json({
              message: "Authentication database is temporarily unavailable. Please retry in a moment.",
              code: "auth_db_unavailable",
            });
          }
          emergencyMode = true;
          const fallbackUser = {
            id: emergencyUserIdForUsername(username),
            username,
            email,
            firstName: null,
            profileImageUrl: null,
            notificationsEnabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          cacheEmergencyUser(fallbackUser);
          newUser = fallbackUser;
        } else {
          const message = String((error as any)?.message || "").toLowerCase();
          if (!message.includes("hashed_password") && !message.includes("not-null") && !message.includes("violates")) {
            throw error;
          }

          const generatedId = randomUUID();
          await withAuthDbRetry(() => db.execute(sql`
            INSERT INTO users (id, username, email, hashed_password, created_at, updated_at)
            VALUES (${generatedId}::uuid, ${username}, ${email}, ${"!oauth-local-placeholder!"}, NOW(), NOW())
          `));

          const fallbackUser = await withAuthDbRetry(() => authStorage.getUserByUsername(username));
          if (!fallbackUser) {
            throw error;
          }
          newUser = fallbackUser;
        }
      }

      cacheEmergencyUser(newUser);

      hashesByUserId = await getPasswordHashesByUserId();
      const nextHash = hashPassword(password);
      hashesByUserId[newUser.id] = nextHash;
      await setPasswordHashesByUserId(hashesByUserId);
      await setPersistentPasswordHash(newUser.id, nextHash);
      emergencyPasswordHashesByUserId.set(String(newUser.id), nextHash);

      res.json({
        user_id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        requires_email_verification: false,
        verification_email_sent: false,
        emergency_mode: emergencyMode,
      });
    } catch (error) {
      console.error("Error during registration:", error);
      if (isDbConnectivityError(error)) {
        return res.status(503).json({
          message: "Authentication database is temporarily unavailable. Please retry in a moment.",
          code: "auth_db_unavailable",
        });
      }
      const mapped = mapRegistrationError(error);
      res.status(mapped.status).json({ message: mapped.message });
    }
  });

  // Check username endpoint
  app.get("/api/auth/check-username", async (req: any, res) => {
    try {
      const username = normalizeUsername(req.query.username);
      const usernameError = getUsernameValidationMessage(username);
      if (usernameError) {
        return res.json({
          username,
          available: false,
          valid: false,
          message: usernameError,
        });
      }

      let existing: any;
      try {
        existing = await authStorage.getUserByUsername(username);
        cacheEmergencyUser(existing);
      } catch (error) {
        if (!isDbConnectivityError(error)) throw error;
        existing = getEmergencyUserByUsername(username);
      }
      const hashesByUserId = await getPasswordHashesByUserId();
      const hasEmergencyRegistration = Boolean(String(hashesByUserId[emergencyUserIdForUsername(username)] || "").trim());
      res.json({
        username,
        available: !existing && !hasEmergencyRegistration,
        valid: true,
        message: existing || hasEmergencyRegistration ? "Username already taken" : "Username available",
        emergency_mode: false,
      });
    } catch (error) {
      console.error("Error checking username:", error);
      if (isDbConnectivityError(error) && AUTH_EMERGENCY_FALLBACK_ENABLED) {
        return res.json({
          username: normalizeUsername(req.query.username),
          available: !getEmergencyUserByUsername(normalizeUsername(req.query.username)),
          valid: true,
          message: "Username availability (emergency mode)",
          emergency_mode: true,
        });
      }
      res.status(500).json({ message: "Check failed" });
    }
  });

  // Verify email endpoint
  app.post("/api/auth/verify-email", async (req: any, res) => {
    try {
      res.json({ verified: true });
    } catch (error) {
      console.error("Error verifying email:", error);
      res.status(500).json({ message: "Verification failed" });
    }
  });

  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get user info at /api/auth/me endpoint
  app.get("/api/auth/me", async (req: any, res) => {
    try {
      const user = await resolveUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      res.json(toFrontendUser(user));
    } catch (error) {
      console.error("Error fetching user info:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/refresh", async (req: any, res) => {
    try {
      const refreshToken = String(req.body?.refresh_token || "").trim();
      if (!refreshToken) {
        return res.status(400).json({ message: "refresh_token is required" });
      }

      const tokens = rotateRefreshToken(refreshToken);
      if (!tokens) {
        return res.status(401).json({ message: "Invalid refresh token" });
      }

      return res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
      });
    } catch (error) {
      console.error("Error refreshing token:", error);
      return res.status(500).json({ message: "Refresh failed" });
    }
  });

  app.patch("/api/auth/profile", async (req: any, res) => {
    try {
      const user = await resolveUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const nextUsername = req.body?.username ? normalizeUsername(req.body.username) : undefined;
      if (nextUsername) {
        const usernameError = getUsernameValidationMessage(nextUsername);
        if (usernameError) {
          return res.status(400).json({ message: usernameError });
        }
        const existing = await authStorage.getUserByUsername(nextUsername);
        if (existing && existing.id !== user.id) {
          return res.status(409).json({ message: "Username already taken" });
        }
      }

      const updated = await authStorage.updateUser(user.id, {
        username: nextUsername,
        firstName: req.body?.display_name ? String(req.body.display_name).trim() : undefined,
        profileImageUrl: req.body?.avatar_url ? String(req.body.avatar_url).trim() : undefined,
        notificationsEnabled: typeof req.body?.telemetry_opt_in === "boolean" ? req.body.telemetry_opt_in : undefined,
      });

      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.json(toFrontendUser(updated));
    } catch (error) {
      console.error("Error updating profile:", error);
      return res.status(500).json({ message: "Profile update failed" });
    }
  });

  // Resend verification email
  app.post("/api/auth/resend-verification", async (req: any, res) => {
    try {
      res.json({ sent: true });
    } catch (error) {
      console.error("Error resending verification:", error);
      res.status(500).json({ message: "Resend failed" });
    }
  });

  // Request password reset code
  app.post("/api/auth/forgot-password/request-code", async (req: any, res) => {
    try {
      res.json({ sent: true });
    } catch (error) {
      console.error("Error requesting password reset:", error);
      res.status(500).json({ message: "Request failed" });
    }
  });

  // Confirm password reset
  app.post("/api/auth/forgot-password/confirm", async (req: any, res) => {
    try {
      res.json({ reset: true });
    } catch (error) {
      console.error("Error confirming password reset:", error);
      res.status(500).json({ message: "Reset failed" });
    }
  });
}
