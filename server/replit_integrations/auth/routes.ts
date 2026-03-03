import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Login endpoint
  app.post("/api/auth/login", async (req: any, res) => {
    try {
      // For now, return a mock response since Replit Auth handles the actual auth
      // In production, integrate with your auth system
      const user = await authStorage.getUser(req.user?.claims?.sub || "temp-user");
      res.json({ 
        access_token: "mock-token",
        user: user || { id: "temp-user", username: "demo" }
      });
    } catch (error) {
      console.error("Error during login:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Register endpoint
  app.post("/api/auth/register", async (req: any, res) => {
    try {
      res.json({ 
        user_id: "temp-user",
        username: req.body.username || "new-user",
        email: req.body.email
      });
    } catch (error) {
      console.error("Error during registration:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Check username endpoint
  app.get("/api/auth/check-username", async (req: any, res) => {
    try {
      const username = req.query.username;
      res.json({ 
        username,
        available: true,
        valid: username && /^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username),
        message: "Username available"
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
      const user = req.user || {};
      res.json({
        user_id: user.claims?.sub || "guest",
        username: user.claims?.preferred_username || "guest",
        email: user.claims?.email || "",
        is_admin: false,
        totp_enabled: false,
        email_verified: true,
        display_name: user.claims?.name || ""
      });
    } catch (error) {
      console.error("Error fetching user info:", error);
      res.status(500).json({ message: "Failed to fetch user" });
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
