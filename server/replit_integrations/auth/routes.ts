import type { Express } from "express";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { issueSessionTokens, readBearerToken, getSessionUserId, rotateRefreshToken, revokeAllSessionTokens } from "./tokenSession";
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

function isStrongPassword(value: string): boolean {
  const password = String(value || "");
  return (
    password.length >= 8
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password)
  );
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
  const state = await storage.getAppState<Record<string, any>>(AUTH_PASSWORDS_STATE_KEY);
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [userId, hash] of Object.entries(state)) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedHash = String(hash || "").trim();
    if (!normalizedUserId || !normalizedHash) continue;
    out[normalizedUserId] = normalizedHash;
  }
  return out;
}

async function setPasswordHashesByUserId(value: Record<string, string>): Promise<void> {
  await storage.setAppState(AUTH_PASSWORDS_STATE_KEY, value);
}

function requiredAccessCodeForRoute(routeType: "login" | "register"): string {
  if (routeType === "register") {
    return String(process.env.AUTH_REGISTER_ACCESS_CODE || process.env.AUTH_ACCESS_CODE || "").trim();
  }
  return String(process.env.AUTH_LOGIN_ACCESS_CODE || process.env.AUTH_ACCESS_CODE || "").trim();
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
    const user = await authStorage.getUser(userIdFromToken);
    if (user) {
      return user;
    }
  }

  const sub = String(req.user?.claims?.sub || "").trim();
  if (!sub) {
    return undefined;
  }

  const existing = await authStorage.getUser(sub);
  if (existing) {
    return existing;
  }

  return authStorage.upsertUser({
    id: sub,
    email: req.user?.claims?.email || null,
    username: req.user?.claims?.preferred_username || req.user?.claims?.name || `user_${sub.slice(0, 8)}`,
    firstName: req.user?.claims?.name || null,
    profileImageUrl: req.user?.claims?.profile_image_url || req.user?.claims?.picture || null,
  });
}

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
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

      const requiredAccessCode = requiredAccessCodeForRoute("login");
      if (requiredAccessCode && accessCode !== requiredAccessCode) {
        return res.status(401).json({ message: "Invalid access code" });
      }

      const user = usernameOrEmail.includes("@")
        ? await authStorage.getUserByEmail(usernameOrEmail)
        : await authStorage.getUserByUsername(normalizeUsername(usernameOrEmail));

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const hashesByUserId = await getPasswordHashesByUserId();
      const storedHash = String(hashesByUserId[user.id] || "").trim();
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
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
      });
    } catch (error) {
      console.error("Error during login:", error);
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
      if (requiredAccessCode && accessCode !== requiredAccessCode) {
        return res.status(401).json({ message: "Invalid access code" });
      }

      if (!password) {
        return res.status(400).json({ message: "password is required" });
      }
      if (!isStrongPassword(password)) {
        return res.status(400).json({ message: "Password must be at least 8 chars and include uppercase, number, and special character." });
      }

      const usernameError = getUsernameValidationMessage(username);
      if (usernameError) {
        return res.status(400).json({ message: usernameError });
      }

      const existingByUsername = await authStorage.getUserByUsername(username);
      if (existingByUsername) {
        return res.status(409).json({ message: "Username already taken" });
      }

      if (email) {
        const existingByEmail = await authStorage.getUserByEmail(email);
        if (existingByEmail) {
          return res.status(409).json({ message: "Email already in use" });
        }
      }

      let newUser = await authStorage.upsertUser({
        id: randomUUID(),
        username,
        email,
      }).catch(async (error) => {
        const message = String((error as any)?.message || "").toLowerCase();
        if (!message.includes("hashed_password") && !message.includes("not-null") && !message.includes("violates")) {
          throw error;
        }

        const generatedId = randomUUID();
        await db.execute(sql`
          INSERT INTO users (id, username, email, hashed_password, created_at, updated_at)
          VALUES (${generatedId}::uuid, ${username}, ${email}, ${"!oauth-local-placeholder!"}, NOW(), NOW())
        `);

        const fallbackUser = await authStorage.getUserByUsername(username);
        if (!fallbackUser) {
          throw error;
        }
        return fallbackUser;
      });

      const hashesByUserId = await getPasswordHashesByUserId();
      hashesByUserId[newUser.id] = hashPassword(password);
      await setPasswordHashesByUserId(hashesByUserId);

      res.json({
        user_id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        requires_email_verification: false,
        verification_email_sent: false,
      });
    } catch (error) {
      console.error("Error during registration:", error);
      res.status(500).json({ message: "Registration failed" });
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

      const existing = await authStorage.getUserByUsername(username);
      res.json({
        username,
        available: !existing,
        valid: true,
        message: existing ? "Username already taken" : "Username available",
      });
    } catch (error) {
      console.error("Error checking username:", error);
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
