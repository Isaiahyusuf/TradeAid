import type { Express } from "express";
import { randomUUID } from "crypto";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { issueSessionTokens, readBearerToken, getSessionUserId, rotateRefreshToken } from "./tokenSession";

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
  // Login endpoint
  app.post("/api/auth/login", async (req: any, res) => {
    try {
      const usernameOrEmail = String(req.body?.username || "").trim();
      if (!usernameOrEmail) {
        return res.status(400).json({ message: "username is required" });
      }

      const user = usernameOrEmail.includes("@")
        ? await authStorage.getUserByEmail(usernameOrEmail)
        : await authStorage.getUserByUsername(usernameOrEmail);

      if (!user) {
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
      const username = String(req.body?.username || "").trim();
      const emailRaw = String(req.body?.email || "").trim();
      const email = emailRaw || null;

      if (!username || !/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username)) {
        return res.status(400).json({ message: "Invalid username format" });
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

      const newUser = await authStorage.upsertUser({
        id: randomUUID(),
        username,
        email,
      });

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
      const username = String(req.query.username || "").trim();
      const valid = !!username && /^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username);
      if (!valid) {
        return res.json({
          username,
          available: false,
          valid: false,
          message: "Username must be 3-20 chars, start with a letter, and use letters/numbers/_",
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

      const nextUsername = req.body?.username ? String(req.body.username).trim() : undefined;
      if (nextUsername) {
        if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(nextUsername)) {
          return res.status(400).json({ message: "Invalid username format" });
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
