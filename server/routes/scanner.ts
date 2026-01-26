import type { Express, Request, Response } from "express";
import { db } from "../db";
import { scannedTokens, tokenSignals, userAlerts, watchlists } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { 
  scanAndAnalyzeToken, 
  scanHotTokens, 
  getTopTokens, 
  getNewTokens, 
  getHotSignals,
  performDeepAnalysis,
  startBackgroundScanner,
  stopBackgroundScanner
} from "../services/token-scanner";
import { searchTokens, getTokenPairs } from "../services/dexscreener";

const scanTokenSchema = z.object({
  address: z.string().min(20, "Invalid token address"),
  chain: z.string().default("solana"),
});

const scanNowSchema = z.object({
  chain: z.string().default("solana"),
});

const startScannerSchema = z.object({
  intervalMinutes: z.number().min(1).max(60).default(5),
});

export function registerScannerRoutes(app: Express): void {
  app.get("/api/tokens", async (req: Request, res: Response) => {
    try {
      const { limit = "50", sort = "safetyScore" } = req.query;
      const tokens = await db.select()
        .from(scannedTokens)
        .orderBy(desc(scannedTokens.safetyScore))
        .limit(parseInt(limit as string));
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching tokens:", error);
      res.status(500).json({ error: "Failed to fetch tokens" });
    }
  });

  app.get("/api/tokens/new", async (req: Request, res: Response) => {
    try {
      const { hours = "24", limit = "50" } = req.query;
      const tokens = await getNewTokens(parseInt(hours as string), parseInt(limit as string));
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching new tokens:", error);
      res.status(500).json({ error: "Failed to fetch new tokens" });
    }
  });

  app.get("/api/tokens/hot", async (req: Request, res: Response) => {
    try {
      const tokens = await db.select()
        .from(scannedTokens)
        .where(and(
          gte(scannedTokens.safetyScore, 50),
          gte(scannedTokens.volume24h, 5000)
        ))
        .orderBy(desc(scannedTokens.volume24h))
        .limit(20);
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching hot tokens:", error);
      res.status(500).json({ error: "Failed to fetch hot tokens" });
    }
  });

  app.get("/api/tokens/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const [token] = await db.select()
        .from(scannedTokens)
        .where(eq(scannedTokens.address, address))
        .limit(1);
      
      if (!token) {
        return res.status(404).json({ error: "Token not found" });
      }
      
      const signals = await db.select()
        .from(tokenSignals)
        .where(eq(tokenSignals.tokenAddress, address))
        .orderBy(desc(tokenSignals.createdAt))
        .limit(5);
      
      res.json({ token, signals });
    } catch (error) {
      console.error("Error fetching token:", error);
      res.status(500).json({ error: "Failed to fetch token" });
    }
  });

  app.post("/api/tokens/scan", async (req: Request, res: Response) => {
    try {
      const parsed = scanTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid request" });
      }
      
      const { address, chain } = parsed.data;
      const result = await scanAndAnalyzeToken(address, chain);
      if (!result) {
        return res.status(404).json({ error: "Token not found on DEX" });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error scanning token:", error);
      res.status(500).json({ error: "Failed to scan token" });
    }
  });

  app.post("/api/tokens/:address/deep-analyze", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const result = await performDeepAnalysis(address);
      
      if (!result) {
        return res.status(404).json({ error: "Token not found" });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error analyzing token:", error);
      res.status(500).json({ error: "Failed to analyze token" });
    }
  });

  app.get("/api/signals", async (req: Request, res: Response) => {
    try {
      const { limit = "20" } = req.query;
      const signals = await getHotSignals(parseInt(limit as string));
      
      const signalsWithTokens = await Promise.all(
        signals.map(async (signal) => {
          const [token] = await db.select()
            .from(scannedTokens)
            .where(eq(scannedTokens.address, signal.tokenAddress))
            .limit(1);
          return { ...signal, token };
        })
      );
      
      res.json(signalsWithTokens);
    } catch (error) {
      console.error("Error fetching signals:", error);
      res.status(500).json({ error: "Failed to fetch signals" });
    }
  });

  app.post("/api/scanner/start", async (req: Request, res: Response) => {
    try {
      const parsed = startScannerSchema.safeParse(req.body);
      const intervalMinutes = parsed.success ? parsed.data.intervalMinutes : 5;
      startBackgroundScanner(intervalMinutes * 60 * 1000);
      res.json({ status: "started", intervalMinutes });
    } catch (error) {
      console.error("Error starting scanner:", error);
      res.status(500).json({ error: "Failed to start scanner" });
    }
  });

  app.post("/api/scanner/stop", async (req: Request, res: Response) => {
    try {
      stopBackgroundScanner();
      res.json({ status: "stopped" });
    } catch (error) {
      console.error("Error stopping scanner:", error);
      res.status(500).json({ error: "Failed to stop scanner" });
    }
  });

  app.post("/api/scanner/scan-now", async (req: Request, res: Response) => {
    try {
      const parsed = scanNowSchema.safeParse(req.body);
      const chain = parsed.success ? parsed.data.chain : "solana";
      res.json({ status: "scanning", message: "Scan started in background" });
      scanHotTokens(chain).catch(console.error);
    } catch (error) {
      console.error("Error triggering scan:", error);
      res.status(500).json({ error: "Failed to trigger scan" });
    }
  });

  app.get("/api/search", async (req: Request, res: Response) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query required" });
      }
      
      const pairs = await searchTokens(q);
      res.json(pairs.slice(0, 20));
    } catch (error) {
      console.error("Error searching:", error);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.get("/api/alerts", async (req: Request, res: Response) => {
    try {
      const alerts = await db.select()
        .from(userAlerts)
        .orderBy(desc(userAlerts.createdAt))
        .limit(50);
      res.json(alerts);
    } catch (error) {
      console.error("Error fetching alerts:", error);
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.patch("/api/alerts/:id/read", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await db.update(userAlerts)
        .set({ isRead: true })
        .where(eq(userAlerts.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking alert as read:", error);
      res.status(500).json({ error: "Failed to update alert" });
    }
  });

  app.get("/api/stats", async (req: Request, res: Response) => {
    try {
      const [tokenCount] = await db.select({ count: sql<number>`count(*)` }).from(scannedTokens);
      const [signalCount] = await db.select({ count: sql<number>`count(*)` }).from(tokenSignals).where(eq(tokenSignals.isActive, true));
      const [safeTokens] = await db.select({ count: sql<number>`count(*)` }).from(scannedTokens).where(gte(scannedTokens.safetyScore, 70));
      
      res.json({
        totalTokens: tokenCount?.count || 0,
        activeSignals: signalCount?.count || 0,
        safeTokens: safeTokens?.count || 0,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });
}
