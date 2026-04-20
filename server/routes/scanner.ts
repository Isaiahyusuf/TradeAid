import { normalizeChain } from "../utils/chain";
import type { Express, Request, Response } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
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
  stopBackgroundScanner,
  getScannerHealthStatus,
} from "../services/token-scanner";
import { searchTokens, getTokenPairs, getLatestTokenProfiles, getTokenPairsFast, pickBestPair } from "../services/dexscreener";
import { multichainScanner } from "../services/multichain-scanner";
import type { TokenFeedItem, TokenFeedResponse } from "@shared/token-contract";

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

async function buildDexFallbackTokens(chain: string, limit: number): Promise<TokenFeedItem[]> {
  const normalizedChain = String(chain || "solana").toLowerCase();
  const profiles = await getLatestTokenProfiles();
  const chainProfiles = profiles
    .filter((profile) => String(profile.chainId || "").toLowerCase() === normalizedChain)
    .slice(0, Math.max(limit * 2, 20));

  const pairResults = await Promise.all(
    chainProfiles.slice(0, 30).map(async (profile) => {
      const pairs = await getTokenPairsFast(profile.tokenAddress);
      return pickBestPair(pairs, normalizedChain);
    })
  );

  const selectedPairs = pairResults
    .filter((pair): pair is NonNullable<typeof pair> => Boolean(pair))
    .sort((left, right) => Number(right.liquidity?.usd || 0) - Number(left.liquidity?.usd || 0))
    .slice(0, limit);

  return selectedPairs.map((pair, index) => {
    const liquidityUsd = Number(pair.liquidity?.usd || 0);
    const volume24h = Number(pair.volume?.h24 || 0);
    const rugProbability = Number(Math.max(0, Math.min(100, 70 - Math.min(60, liquidityUsd / 1500))).toFixed(2));
    const confidence = Number((100 - rugProbability).toFixed(2));
    const createdAtIso = pair.pairCreatedAt
      ? new Date(pair.pairCreatedAt).toISOString()
      : new Date().toISOString();

    return {
      id: `dex-fallback-${pair.pairAddress || pair.baseToken.address}-${index}`,
      latest_score: {
        rug_probability: rugProbability,
        liquidity_stability: Number(Math.max(0, Math.min(100, (liquidityUsd / 25000) * 100)).toFixed(2)),
        holder_distribution: 50,
        smart_wallet_signal: Number(Math.max(0, Math.min(100, confidence * 0.85)).toFixed(2)),
        trade_confidence_index: confidence,
        eligible: liquidityUsd >= 2000,
        scored_at: createdAtIso,
      },
      contract_address: String(pair.baseToken.address || ""),
      chain: String(pair.chainId || normalizedChain).toLowerCase(),
      name: String(pair.baseToken.name || "Unknown"),
      symbol: String(pair.baseToken.symbol || "UNKNOWN"),
      current_price_usd: Number(pair.priceUsd || 0),
      market_cap_usd: Number(pair.marketCap || pair.fdv || 0),
      liquidity_usd: liquidityUsd,
      volume_5m: Number(pair.volume?.m5 || 0),
      volume_1h: Number(pair.volume?.h1 || 0),
      volume_6h: Number(pair.volume?.h6 || 0),
      price_change_5m: Number(pair.priceChange?.m5 || 0),
      price_change_1h: Number(pair.priceChange?.h1 || 0),
      price_change_6h: Number(pair.priceChange?.h6 || 0),
      buys_1h: Math.max(0, Math.trunc(Number(pair.txns?.h1?.buys || 0))),
      sells_1h: Math.max(0, Math.trunc(Number(pair.txns?.h1?.sells || 0))),
      new_wallets_count: 0,
      top_holders_pct: 0,
      dev_wallet_pct: 0,
      logo_url: pair.info?.imageUrl || null,
      website_url: pair.info?.websites?.[0]?.url || null,
      twitter_url: pair.info?.socials?.find((social) => social.platform === "twitter")?.url || null,
      telegram_url: pair.info?.socials?.find((social) => social.platform === "telegram")?.url || null,
      description: null,
      is_pump_fun: String(pair.dexId || "").toLowerCase().includes("pump"),
      source_platform: pair.dexId || null,
      buy_urls: pair.url ? [pair.url] : undefined,
      holder_count: 0,
      is_mintable: true,
      is_ownership_renounced: false,
      dex_id: String(pair.dexId || "unknown"),
      pair_address: pair.pairAddress || null,
      deployer_wallet: null,
      total_supply: null,
      created_at: createdAtIso,
    };
  });
}

export function registerScannerRoutes(app: Express): void {
  app.use(["/api/tokens", "/api/signals", "/api/scanner", "/api/search", "/api/alerts", "/api/stats"], isAuthenticated);

  app.get("/api/tokens", async (req: Request, res: Response) => {
    try {
      const { limit = "50", chain = "all" } = req.query;
      const normalizedChain = String(chain || "all").trim().toLowerCase();
      const parsedLimit = Math.max(1, Math.min(100, parseInt(limit as string) || 50));

      let tokens: typeof scannedTokens.$inferSelect[] = [];
      try {
        tokens = await db.select()
          .from(scannedTokens)
          .orderBy(desc(scannedTokens.safetyScore))
          .limit(parsedLimit);
      } catch {
        if (normalizedChain === "all") {
          const fallback = await buildDexFallbackTokens("solana", parsedLimit);
          const payload: TokenFeedResponse = {
            tokens: fallback,
            count: fallback.length,
            total: fallback.length,
          };
          return res.json(payload);
        }

        const fallback = await buildDexFallbackTokens(normalizedChain, parsedLimit);
        const payload: TokenFeedResponse = {
          tokens: fallback,
          count: fallback.length,
          total: fallback.length,
        };
        return res.json(payload);
      }

      const filtered = normalizedChain === "all"
        ? tokens
        : tokens.filter((token) => String(token.chain || "").toLowerCase() === normalizedChain);

      const mapped: TokenFeedItem[] = filtered.map((token) => {
        const safetyScore = Number(token.safetyScore || 0);
        const liquidityUsd = Number(token.liquidity || 0);
        const volume24h = Number(token.volume24h || 0);
        const createdAtIso = token.createdAt ? new Date(token.createdAt).toISOString() : new Date().toISOString();

        return {
          id: String(token.id),
          latest_score: {
            rug_probability: Number(Math.max(0, Math.min(100, 100 - safetyScore)).toFixed(2)),
            liquidity_stability: Number(Math.max(0, Math.min(100, (liquidityUsd / 25000) * 100)).toFixed(2)),
            holder_distribution: Number(Math.max(0, 100 - Number(token.topHoldersPercentage || 0)).toFixed(2)),
            smart_wallet_signal: Number(Math.max(0, Math.min(100, safetyScore * 0.9)).toFixed(2)),
            trade_confidence_index: Number(Math.max(0, Math.min(100, safetyScore)).toFixed(2)),
            eligible: safetyScore >= 55 && liquidityUsd >= 2000,
            scored_at: createdAtIso,
          },
          contract_address: String(token.address || ""),
          chain: String(token.chain || "solana").toLowerCase(),
          name: String(token.name || "Unknown"),
          symbol: String(token.symbol || "UNKNOWN"),
          current_price_usd: Number(token.priceUsd || 0),
          market_cap_usd: Number(token.marketCap || 0),
          liquidity_usd: liquidityUsd,
          volume_5m: Number((volume24h / 288).toFixed(2)),
          volume_1h: Number((volume24h / 24).toFixed(2)),
          volume_6h: Number((volume24h / 4).toFixed(2)),
          price_change_5m: Number((Number(token.priceChange1h || 0) / 12).toFixed(2)),
          price_change_1h: Number(token.priceChange1h || 0),
          price_change_6h: Number((Number(token.priceChange24h || 0) / 4).toFixed(2)),
          buys_1h: Math.max(0, Math.trunc(Number(token.buys24h || 0) / 24)),
          sells_1h: Math.max(0, Math.trunc(Number(token.sells24h || 0) / 24)),
          new_wallets_count: 0,
          top_holders_pct: Number(token.topHoldersPercentage || 0),
          dev_wallet_pct: Number(token.devWalletPercentage || 0),
          logo_url: null,
          website_url: token.socialLinks?.website || null,
          twitter_url: token.socialLinks?.twitter || null,
          telegram_url: token.socialLinks?.telegram || null,
          description: token.aiAnalysis || null,
          is_pump_fun: String(token.dexId || "").toLowerCase().includes("pump"),
          source_platform: token.dexId || null,
          buy_urls: undefined,
          holder_count: 0,
          is_mintable: !Boolean(token.mintAuthorityDisabled),
          is_ownership_renounced: Boolean(token.mintAuthorityDisabled),
          dex_id: String(token.dexId || "unknown"),
          pair_address: token.pairAddress || null,
          deployer_wallet: null,
          total_supply: null,
          created_at: createdAtIso,
        };
      });

      const payload: TokenFeedResponse = {
        tokens: mapped,
        count: mapped.length,
        total: mapped.length,
      };

      res.json(payload);
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

  app.get("/api/tokens/safe-picks", async (req: Request, res: Response) => {
    try {
      const tokens = await db.select()
        .from(scannedTokens)
        .where(and(
          gte(scannedTokens.safetyScore, 65),
          gte(scannedTokens.liquidity, 20000),
          gte(scannedTokens.volume24h, 10000),
          sql`${scannedTokens.aiSignal} IN ('buy', 'strong_buy')`
        ))
        .orderBy(desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h))
        .limit(10);
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching safe picks:", error);
      res.status(500).json({ error: "Failed to fetch safe picks" });
    }
  });

  app.get("/api/tokens/:address([1-9A-HJ-NP-Za-km-z]{20,64})", async (req: Request, res: Response) => {
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
      const normalizedChain = normalizeChain(chain);
      const result = await scanAndAnalyzeToken(address, normalizedChain);
      if (!result) {
        return res.status(404).json({ error: "Token not found on DEX" });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error scanning token:", error);
      res.status(500).json({ error: "Failed to scan token" });
    }
  });

  app.post("/api/tokens/:address([1-9A-HJ-NP-Za-km-z]{20,64})/deep-analyze", async (req: Request, res: Response) => {
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
      const chain = normalizeChain(parsed.success ? parsed.data.chain : "solana");
      res.json({ status: "scanning", message: "Scan started in background" });
      scanHotTokens(chain).catch(console.error);
    } catch (error) {
      console.error("Error triggering scan:", error);
      res.status(500).json({ error: "Failed to trigger scan" });
    }
  });

  app.get("/api/scanner/health", async (_req: Request, res: Response) => {
    try {
      const health = getScannerHealthStatus();
      res.json(health);
    } catch (error) {
      console.error("Error fetching scanner health:", error);
      res.status(500).json({ error: "Failed to fetch scanner health" });
    }
  });

  app.get("/api/scanner/ingestion-debug", async (req: Request, res: Response) => {
    try {
      const limitRaw = Number(req.query.limit || 20);
      const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20));

      const runtime = multichainScanner.getIngestionDiagnostics(limit);
      const recentScanned = await db.select()
        .from(scannedTokens)
        .where(eq(scannedTokens.chain, "solana"))
        .orderBy(desc(scannedTokens.createdAt))
        .limit(limit);

      const recentTokens = recentScanned.map((token) => {
        const social = (token.socialLinks || {}) as Record<string, unknown>;
        return {
          id: token.id,
          address: token.address,
          symbol: token.symbol,
          dexId: token.dexId,
          createdAt: token.createdAt ? new Date(token.createdAt).toISOString() : null,
          firstSeenAt: typeof social.firstSeenAt === "string" ? social.firstSeenAt : null,
          firstSeenSource: typeof social.firstSeenSource === "string" ? social.firstSeenSource : null,
          bestSource: typeof social.bestSource === "string" ? social.bestSource : null,
          sourceWeight: typeof social.sourceWeight === "number" ? social.sourceWeight : null,
          freshnessScore: typeof social.freshnessScore === "number" ? social.freshnessScore : null,
        };
      });

      res.json({
        runtime,
        recentTokens,
      });
    } catch (error) {
      console.error("Error fetching scanner ingestion debug:", error);
      res.status(500).json({ error: "Failed to fetch scanner ingestion debug" });
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
      const userId = String((req as any)?.user?.claims?.sub || "").trim();
      const alerts = await db.select()
        .from(userAlerts)
        .where(eq(userAlerts.userId, userId))
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
      const userId = String((req as any)?.user?.claims?.sub || "").trim();
      await db.update(userAlerts)
        .set({ isRead: true })
        .where(and(eq(userAlerts.id, id), eq(userAlerts.userId, userId)));
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

  app.post("/api/scanner/multichain", async (req: Request, res: Response) => {
    try {
      res.json({ status: "scanning", message: "Multi-chain scan started" });
      multichainScanner.scanAllLaunchpads().catch(console.error);
    } catch (error) {
      console.error("Error triggering multichain scan:", error);
      res.status(500).json({ error: "Failed to trigger scan" });
    }
  });

  app.get("/api/tokens/by-chain/:chain", async (req: Request, res: Response) => {
    try {
      const { chain } = req.params;
      const { minSafetyScore = "50" } = req.query;
      
      const tokens = await db.select()
        .from(scannedTokens)
        .where(and(
          eq(scannedTokens.chain, chain),
          gte(scannedTokens.safetyScore, parseInt(minSafetyScore as string))
        ))
        .orderBy(desc(scannedTokens.safetyScore))
        .limit(50);
      
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching chain tokens:", error);
      res.status(500).json({ error: "Failed to fetch tokens by chain" });
    }
  });

  app.get("/api/tokens/safe-launchpad", async (req: Request, res: Response) => {
    try {
      const { chain, maxTopHolders = "30", maxDevWallet = "10" } = req.query;
      
      let query = db.select()
        .from(scannedTokens)
        .where(and(
          gte(scannedTokens.safetyScore, 60),
          sql`${scannedTokens.topHoldersPercentage} <= ${parseInt(maxTopHolders as string)}`,
          sql`${scannedTokens.devWalletPercentage} <= ${parseInt(maxDevWallet as string)}`,
          gte(scannedTokens.liquidity, 10000)
        ))
        .orderBy(desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h))
        .limit(50);
      
      const tokens = await query;
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching safe launchpad tokens:", error);
      res.status(500).json({ error: "Failed to fetch safe tokens" });
    }
  });
}
