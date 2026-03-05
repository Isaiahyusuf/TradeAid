import type { Express } from "express";
import type { Server } from "http";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import { storage } from "./storage";
import { api } from "@shared/routes";
import type { TokenFeedItem, TokenFeedResponse } from "@shared/token-contract";
import { z } from "zod";
import { normalizeChain } from "./utils/chain";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import { setupAuth, registerAuthRoutes, isAuthenticated, authStorage } from "./replit_integrations/auth";
import { registerScannerRoutes } from "./routes/scanner";
import { startBackgroundScanner, scanHotTokens } from "./services/token-scanner";
import { multichainScanner } from "./services/multichain-scanner";
import { getNewPairs, getTokenPairs, getTokenPairsFast, getTokenPairsProjectInfo, pairToTokenData } from "./services/dexscreener";
import { FREE_TIER_LIMITS, SUBSCRIPTION_PRICE_USD, SUPPORTED_PAYMENT_CHAINS } from "@shared/schema";
import { cryptoPaymentService } from "./services/crypto-payment";
import { fetchFreshPumpfunTokens } from "./services/fresh-token-service";
import { runApifyWorkflowOnce, startApifyWorkflowScheduler } from "./services/apify-workflow";
import { enrichTokenWithHelius } from "./services/helius-enrichment-service";
import { scoreFreshToken } from "./services/token-scoring-engine";
import { getAutoTradeConfig, maybeTriggerAutoTrade } from "./services/auto-trade-hook";
import { logStructured } from "./services/structured-logger";
import { getHeliusRpcUrl, getSolanaConnection, getTokenMintAuthorityInfo, getTokenMintDecimals } from "./services/solana-connection";
import { BONK_MINT, SOL_MINT, detectSupportedBaseMint, refreshRaydiumPools, startRaydiumPoolFetcher } from "./services/raydium-pools";
import { fetchRaydiumQuote, fetchRaydiumSwapPayload, getDoctorTradeBaseAssetMint } from "./services/raydium-swap";
import OpenAI from "openai";

const bs58Codec = (() => {
  type Bs58Codec = {
    encode: (data: Uint8Array) => string;
    decode: (value: string) => Uint8Array;
  };

  const moduleValue = bs58 as unknown as {
    encode?: Bs58Codec["encode"];
    decode?: Bs58Codec["decode"];
    default?: Partial<Bs58Codec>;
  };

  if (typeof moduleValue?.encode === "function" && typeof moduleValue?.decode === "function") {
    return moduleValue as Bs58Codec;
  }
  if (typeof moduleValue?.default?.encode === "function" && typeof moduleValue?.default?.decode === "function") {
    return moduleValue.default as Bs58Codec;
  }
  throw new Error("bs58 codec is not available");
})();

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const serviceStartedAt = Date.now();
  const observability = {
    requestsTotal: 0,
    apiRequests: 0,
    api4xx: 0,
    api5xx: 0,
    lastRequestAt: null as string | null,
    lastErrorAt: null as string | null,
    bridgeFallbacks: 0,
    bridgeEmptyResponses: 0,
    bridgeErrors: 0,
  };

  app.use((req, res, next) => {
    const incomingRequestId = String(req.headers["x-request-id"] || "").trim();
    const requestId = incomingRequestId || randomUUID();
    res.setHeader("x-request-id", requestId);
    (res.locals as Record<string, unknown>).requestId = requestId;

    const startedAt = Date.now();
    res.on("finish", () => {
      observability.requestsTotal += 1;
      observability.lastRequestAt = new Date().toISOString();

      if (!req.path.startsWith("/api")) {
        return;
      }

      observability.apiRequests += 1;
      if (res.statusCode >= 500) {
        observability.api5xx += 1;
        observability.lastErrorAt = new Date().toISOString();
        logStructured("error", "api.request_failed", {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        });
      } else if (res.statusCode >= 400) {
        observability.api4xx += 1;
      }
    });

    next();
  });

  // Setup auth FIRST (required before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // Register AI integration routes
  registerChatRoutes(app);
  registerImageRoutes(app);
  
  // Register token scanner routes (new powerful scanner)
  registerScannerRoutes(app);

  let lastApifyIngest: {
    run_id: string | null;
    dataset_id: string | null;
    received_at: string | null;
    received_count: number;
  } = {
    run_id: null,
    dataset_id: null,
    received_at: null,
    received_count: 0,
  };

  app.post("/api/fresh/apify-ingest", async (req, res) => {
    try {
      const expectedKey = String(process.env.TRADEAID_APIFY_INGEST_KEY || "").trim();
      const providedKey = String(req.headers["x-tradeaid-ingest-key"] || "").trim();
      if (expectedKey && providedKey !== expectedKey) {
        return res.status(401).json({ ok: false, message: "Unauthorized" });
      }

      const runId = String(req.body?.run_id || "").trim() || null;
      const datasetId = String(req.body?.dataset_id || "").trim() || null;
      const items = Array.isArray(req.body?.items) ? req.body.items : [];

      lastApifyIngest = {
        run_id: runId,
        dataset_id: datasetId,
        received_at: new Date().toISOString(),
        received_count: items.length,
      };

      logStructured("info", "apify.dataset_ingested", {
        runId,
        datasetId,
        itemCount: items.length,
      });

      return res.json({
        ok: true,
        received: items.length,
        run_id: runId,
        dataset_id: datasetId,
        received_at: lastApifyIngest.received_at,
      });
    } catch (error) {
      logStructured("error", "apify.dataset_ingest_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return res.status(500).json({ ok: false, message: "Failed to ingest Apify dataset" });
    }
  });

  app.get("/api/fresh/apify-ingest/status", (_req, res) => {
    return res.json({
      ok: true,
      ingest: lastApifyIngest,
    });
  });

  app.post("/api/fresh/apify-sync/run", async (req, res) => {
    try {
      const limitRaw = Number(req.body?.limit || req.query?.limit || process.env.APIFY_DATASET_LIMIT || 100);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 100;
      const result = await runApifyWorkflowOnce(limit);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: error instanceof Error ? error.message : "Failed to run Apify workflow",
      });
    }
  });

  app.get("/process-fresh", async (req, res) => {
    const limitRaw = Number(req.query.limit || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

    try {
      const freshTokens = await fetchFreshPumpfunTokens(limit);
      const processed: Array<Record<string, unknown>> = [];

      for (const token of freshTokens) {
        const enrichment = await enrichTokenWithHelius(token.mintAddress);

        const scoreResult = scoreFreshToken({
          liquidityUsd: Number(token.liquidityUsd || 0),
          holdersCount: Number(enrichment.holdersCount || 0),
          mintAuthorityActive: enrichment.authorities.mintAuthorityActive,
          freezeAuthorityActive: enrichment.authorities.freezeAuthorityActive,
        });

        const autoTrade = await maybeTriggerAutoTrade({
          mintAddress: token.mintAddress,
          symbol: token.symbol,
          score: scoreResult.score,
        });

        logStructured("info", "fresh_token.scored", {
          mintAddress: token.mintAddress,
          symbol: token.symbol,
          score: scoreResult.score,
          riskLevel: scoreResult.riskLevel,
          autoTradeTriggered: autoTrade.triggered,
        });

        processed.push({
          token,
          enrichment,
          scoring: scoreResult,
          autoTrade,
        });
      }

      return res.json({
        ok: true,
        fetched: freshTokens.length,
        processedAt: new Date().toISOString(),
        autoTrade: getAutoTradeConfig(),
        items: processed,
      });
    } catch (error) {
      logStructured("error", "fresh_token.process_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return res.status(500).json({
        ok: false,
        message: error instanceof Error ? error.message : "Failed to process fresh tokens",
      });
    }
  });

  const pythonApiBase = String(
    process.env.TRADE_AID_BACKEND_URL || process.env.BACKEND_URL || process.env.VITE_API_URL || "",
  ).replace(/\/$/, "");

  const getRequestHost = (req: any) => {
    const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
    const host = String(req.headers?.host || "").split(",")[0].trim();
    return (forwardedHost || host).toLowerCase();
  };

  const isBridgeLoopbackForRequest = (req: any) => {
    if (!pythonApiBase) return false;
    try {
      const target = new URL(pythonApiBase);
      const requestHost = getRequestHost(req);
      return Boolean(requestHost) && requestHost === String(target.host || "").toLowerCase();
    } catch {
      return false;
    }
  };

  const normalizeDexChain = (chain: string) => {
    const normalized = String(chain || "").toLowerCase().trim();
    const map: Record<string, string> = {
      eth: "ethereum",
      bnb: "bsc",
      avax: "avalanche",
      matic: "polygon",
    };
    return map[normalized] || normalized;
  };

  const buildDexScoreFallback = async (contractAddress: string, chain: string) => {
    const requestedChain = normalizeDexChain(chain || "all");
    let pairs: any[] = [];
    try {
      pairs = await getTokenPairsFast(contractAddress);
    } catch {
      pairs = [];
    }
    const filtered = pairs.filter((pair) => {
      const pairChain = normalizeDexChain(String(pair.chainId || ""));
      return requestedChain === "all" ? true : pairChain === requestedChain;
    });
    const ranked = (filtered.length ? filtered : pairs).sort(
      (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0),
    );
    const pair = ranked[0];
    if (!pair) {
      return {
        contract_address: contractAddress,
        chain: requestedChain === "all" ? "solana" : requestedChain,
        symbol: "UNKNOWN",
        name: "Unknown Token",
        eligible: false,
        eligibility_reason: "token_not_found",
        risk_flags: ["NO_LIVE_PAIR_DATA"],
        status: "indexing",
        scores: {
          rug_probability: 95,
          liquidity_stability: 0,
          holder_distribution: 0,
          smart_wallet_signal: 0,
          trade_confidence_index: 0,
          rug_risk_score: 95,
          opportunity_score: 0,
        },
        market_data: {
          market_cap_usd: 0,
          liquidity_usd: 0,
          holder_count: 0,
        },
        source: {
          provider: "dexscreener",
          pair_address: "",
          dex_id: "",
          url: "",
        },
        scored_at: new Date().toISOString(),
      };
    }

    const liquidityUsd = Number(pair.liquidity?.usd || 0);
    const volume5m = Number(pair.volume?.m5 || 0);
    const volume1h = Number(pair.volume?.h1 || 0);
    const buys = Number(pair.txns?.m5?.buys || 0);
    const sells = Number(pair.txns?.m5?.sells || 0);
    const buySellRatio = (buys + 1) / (sells + 1);
    const slippageHint = Math.max(0, Math.min(10, (volume5m / Math.max(liquidityUsd, 1)) * 100));

    let rug = 50;
    const riskFlags: string[] = [];
    if (liquidityUsd < 2000) {
      rug += 25;
      riskFlags.push("LOW_LIQUIDITY");
    } else if (liquidityUsd < 10000) {
      rug += 10;
      riskFlags.push("THIN_LIQUIDITY");
    }
    if (buySellRatio < 0.9) {
      rug += 8;
      riskFlags.push("SELL_PRESSURE");
    }
    if (slippageHint > 3) {
      rug += 8;
      riskFlags.push("HIGH_SLIPPAGE");
    }
    rug = Math.max(5, Math.min(99, rug));

    let opportunity = 30;
    if (liquidityUsd > 10000) opportunity += 18;
    if (volume1h > 0 && volume5m > volume1h / 12) opportunity += 18;
    if (buySellRatio > 1.15) opportunity += 15;
    opportunity = Math.max(0, Math.min(100, opportunity));
    const confidence = Math.max(0, Math.min(100, opportunity - Math.max(0, (rug - 50) * 0.6)));

    const resolvedChain = normalizeDexChain(String(pair.chainId || requestedChain || "solana"));
    const eligible = rug <= 85 && liquidityUsd >= 2000;

    return {
      contract_address: contractAddress,
      chain: resolvedChain,
      symbol: String(pair.baseToken?.symbol || "UNKNOWN"),
      name: String(pair.baseToken?.name || "DexScreener Token"),
      eligible,
      eligibility_reason: eligible ? null : rug > 85 ? "rug_risk_above_85" : "liquidity_below_2k",
      risk_flags: riskFlags,
      status: "dex_live",
      scores: {
        rug_probability: Number(rug.toFixed(2)),
        liquidity_stability: Number(Math.max(0, Math.min(100, (liquidityUsd / 25000) * 100)).toFixed(2)),
        holder_distribution: Number(Math.max(0, Math.min(100, 100 - Math.min(slippageHint * 10, 90))).toFixed(2)),
        smart_wallet_signal: Number(Math.max(0, Math.min(100, buySellRatio * 40)).toFixed(2)),
        trade_confidence_index: Number(confidence.toFixed(2)),
        rug_risk_score: Number(rug.toFixed(2)),
        opportunity_score: Number(opportunity.toFixed(2)),
      },
      market_data: {
        market_cap_usd: Number(pair.marketCap || pair.fdv || 0),
        liquidity_usd: liquidityUsd,
        holder_count: 0,
      },
      source: {
        provider: "dexscreener",
        pair_address: String(pair.pairAddress || ""),
        dex_id: String(pair.dexId || ""),
        url: String(pair.url || ""),
      },
      scored_at: new Date().toISOString(),
    };
  };

  const buildDexProjectInfoFallback = async (contractAddress: string, chain: string) => {
    const requestedChain = normalizeDexChain(chain || "all");
    const pairs = await getTokenPairsProjectInfo(contractAddress);
    const filtered = pairs.filter((pair) => {
      const pairChain = normalizeDexChain(String(pair.chainId || ""));
      return requestedChain === "all" ? true : pairChain === requestedChain;
    });
    const ranked = (filtered.length ? filtered : pairs).sort(
      (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0),
    );
    const pair = ranked[0];
    if (!pair) {
      return { status: "indexing", message: "Indexing token..." };
    }

    const socials = pair.info?.socials || [];
    const socialLinks = {
      x: socials.find((item) => String(item.platform || "").toLowerCase().includes("twitter"))?.url || null,
      telegram: socials.find((item) => String(item.platform || "").toLowerCase().includes("telegram"))?.url || null,
      discord: socials.find((item) => String(item.platform || "").toLowerCase().includes("discord"))?.url || null,
    };

    return {
      status: "ok",
      project_info: {
        symbol: String(pair.baseToken?.symbol || "UNKNOWN"),
        name: String(pair.baseToken?.name || "Dex Token"),
        chain: normalizeDexChain(String(pair.chainId || requestedChain || "solana")),
        dex_id: String(pair.dexId || ""),
        pair_address: String(pair.pairAddress || ""),
        price_usd: Number(pair.priceUsd || 0),
        liquidity_usd: Number(pair.liquidity?.usd || 0),
        market_cap_usd: Number(pair.marketCap || 0),
        fdv: Number(pair.fdv || 0),
        volume_24h: Number(pair.volume?.h24 || 0),
        price_change_24h: Number(pair.priceChange?.h24 || 0),
        pair_url: String(pair.url || ""),
        websites: (pair.info?.websites || []).map((item) => item.url).filter(Boolean),
        social_links: socialLinks,
      },
    };
  };

  async function proxyToPythonApi(
    req: any,
    res: any,
    targetPath: string,
    fallback?: () => Promise<any>,
  ) {
    if (!pythonApiBase || isBridgeLoopbackForRequest(req)) {
      observability.bridgeFallbacks += 1;
      if (fallback) {
        return res.status(200).json(await fallback());
      }
      return res.status(503).json({
        message: "Backend bridge is not configured. Set TRADE_AID_BACKEND_URL or VITE_API_URL.",
      });
    }

    try {
      const targetUrl = `${pythonApiBase}${targetPath}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const auth = String(req.headers.authorization || "").trim();
      if (auth) {
        headers.Authorization = auth;
      }

      const controller = new AbortController();
      const isScoringRequest = targetPath.startsWith("/api/scoring/");
      const isProjectInfoRequest = targetPath.startsWith("/api/tokens/project-info/");
      const bridgeTimeoutEnvRaw = isScoringRequest
        ? Number(process.env.BRIDGE_TIMEOUT_SCORING_MS || process.env.BRIDGE_TIMEOUT_MS || 3000)
        : isProjectInfoRequest
          ? Number(process.env.BRIDGE_TIMEOUT_PROJECT_INFO_MS || process.env.BRIDGE_TIMEOUT_MS || 2500)
        : Number(process.env.BRIDGE_TIMEOUT_MS || 12000);
      const bridgeTimeoutEnv = Number.isFinite(bridgeTimeoutEnvRaw)
        ? bridgeTimeoutEnvRaw
        : (isScoringRequest ? 3000 : (isProjectInfoRequest ? 2500 : 12000));
      const bridgeTimeoutMs = Math.max(2000, bridgeTimeoutEnv);
      const timeout = setTimeout(() => controller.abort(), bridgeTimeoutMs);

      let response: Response;
      try {
        response = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: req.method === "GET" ? undefined : JSON.stringify(req.body || {}),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const text = await response.text();
      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }

      if ((!response.ok || payload?.error) && fallback) {
        const fallbackPayload = await fallback();
        if (!fallbackPayload?.error) {
          return res.status(200).json(fallbackPayload);
        }
      }

      return res.status(response.status).json(payload ?? {});
    } catch (error) {
      if (fallback) {
        try {
          const fallbackPayload = await fallback();
          return res.status(200).json(fallbackPayload);
        } catch {
        }
      }
      return res.status(502).json({
        message: error instanceof Error ? error.message : "Proxy request failed",
      });
    }
  }

  const doctorRuntime = {
    enabled: false,
    killSwitch: false,
    scanIntervalSeconds: 20,
    wallet: {
      address: "",
      balanceSol: 0,
      separateWalletEnforced: true,
    },
    controls: {
      max_trades_per_day: 12,
      trades_today: 0,
      max_open_positions: 5,
      strategy_window_minutes: 120,
      ai_min_signals_required: 6,
      cooldown_minutes_per_mint: 30,
      min_wallet_fee_buffer_sol: 0.02,
      live_sell_fraction_pct: 50,
      max_sell_notional_usd: 300,
      min_buy_amount_sol: 0.1,
      buy_amount_sol: 0.1,
      take_profit_multiplier: 2,
      min_profit_pct: 12,
      stop_loss_pct: 6,
      trailing_stop_pct: 10,
      min_liquidity_usd: 10000,
      min_market_cap_usd: 15000,
      min_volume_24h_usd: 12000,
      min_token_age_minutes: 15,
      max_slippage_pct: 4,
      max_spread_pct: 3,
      daily_loss_limit_usd: 600,
      max_consecutive_losses: 3,
      strong_move_threshold_pct: 40,
      max_hold_minutes: 180,
      min_momentum_profit_pct: 4,
      quality_min_volume_spike_pct: 12,
      quality_max_top_holder_pct: 24,
    },
    execution: {
      mode: "paper" as "paper" | "live",
    },
    executionAudit: [] as Array<Record<string, any>>,
    positions: [] as Array<Record<string, any>>,
    recentTrades: [] as Array<Record<string, any>>,
    decisionJournal: [] as Array<Record<string, any>>,
    performance: [] as Array<Record<string, any>>,
    lastDecision: null as Record<string, any> | null,
    lastRunAt: null as string | null,
    lastError: null as string | null,
  };

  const doctorStateDir = resolve(process.cwd(), "server", "state");
  const doctorStateFile = resolve(doctorStateDir, "doctortrade.runtime.json");

  const persistDoctorRuntime = async () => {
    try {
      await mkdir(doctorStateDir, { recursive: true });
      await writeFile(doctorStateFile, JSON.stringify(doctorRuntime, null, 2), "utf8");
    } catch {
    }
  };

  const loadDoctorRuntime = async () => {
    try {
      const text = await readFile(doctorStateFile, "utf8");
      const loaded = JSON.parse(text) as Record<string, any>;

      if (typeof loaded.enabled === "boolean") {
        doctorRuntime.enabled = loaded.enabled;
      }
      if (typeof loaded.killSwitch === "boolean") {
        doctorRuntime.killSwitch = loaded.killSwitch;
      }
      if (Number.isFinite(Number(loaded.scanIntervalSeconds))) {
        doctorRuntime.scanIntervalSeconds = Math.max(5, Math.trunc(Number(loaded.scanIntervalSeconds)));
      }

      const wallet = loaded.wallet as Record<string, any> | undefined;
      if (wallet && typeof wallet === "object") {
        if (typeof wallet.address === "string") {
          doctorRuntime.wallet.address = wallet.address;
        }
        if (Number.isFinite(Number(wallet.balanceSol))) {
          doctorRuntime.wallet.balanceSol = Number(wallet.balanceSol);
        }
        if (typeof wallet.separateWalletEnforced === "boolean") {
          doctorRuntime.wallet.separateWalletEnforced = wallet.separateWalletEnforced;
        }
      }

      const controls = loaded.controls as Record<string, any> | undefined;
      if (controls && typeof controls === "object") {
        for (const key of Object.keys(doctorRuntime.controls) as Array<keyof typeof doctorRuntime.controls>) {
          if (Number.isFinite(Number(controls[key]))) {
            (doctorRuntime.controls as any)[key] = Number(controls[key]);
          }
        }
      }

      if (Array.isArray(loaded.recentTrades)) {
        doctorRuntime.recentTrades = loaded.recentTrades.slice(0, 50);
      }
      if (Array.isArray(loaded.positions)) {
        doctorRuntime.positions = loaded.positions.slice(0, 30);
      }
      if (Array.isArray(loaded.decisionJournal)) {
        doctorRuntime.decisionJournal = loaded.decisionJournal.slice(0, 80);
      }
      if (Array.isArray(loaded.performance)) {
        doctorRuntime.performance = loaded.performance.slice(0, 40);
      }
      if (loaded.execution && typeof loaded.execution === "object") {
        const mode = String((loaded.execution as Record<string, any>).mode || "paper").toLowerCase();
        doctorRuntime.execution.mode = mode === "live" ? "live" : "paper";
      }
      if (Array.isArray(loaded.executionAudit)) {
        doctorRuntime.executionAudit = loaded.executionAudit.slice(0, 200);
      }
      if (loaded.lastDecision && typeof loaded.lastDecision === "object") {
        doctorRuntime.lastDecision = loaded.lastDecision as Record<string, any>;
      }

      doctorRuntime.lastRunAt = typeof loaded.lastRunAt === "string" ? loaded.lastRunAt : null;
      doctorRuntime.lastError = typeof loaded.lastError === "string" ? loaded.lastError : null;

      doctorRuntime.controls.min_buy_amount_sol = Math.max(0.05, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
      if (doctorRuntime.killSwitch) {
        doctorRuntime.enabled = false;
      }
    } catch {
    }
  };

  await loadDoctorRuntime();

  let doctorCycleRunning = false;
  let doctorCycleTimer: NodeJS.Timeout | null = null;
  let doctorEarlyScoredCache: { at: number; tokens: Array<Record<string, any>> } | null = null;
  const doctorTradeLogStateKey = "doctortrade.executions.v1";

  const normalizeLaunchSource = (value: string) => {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("pump")) return "pumpfun";
    if (normalized.includes("ray")) return "raydium";
    if (normalized.includes("bonk")) return "bonk";
    return "unknown";
  };

  const getAllowedLaunchSources = () => {
    const configured = String(process.env.DOCTORTRADE_ALLOWED_LAUNCH_SOURCES || "pumpfun,raydium,bonk")
      .split(",")
      .map((item) => normalizeLaunchSource(item))
      .filter((item) => item !== "unknown");
    return new Set(configured.length > 0 ? configured : ["pumpfun", "raydium", "bonk"]);
  };

  const appendDoctorTradeLog = async (entry: Record<string, any>) => {
    try {
      const current = await storage.getAppState<Array<Record<string, any>>>(doctorTradeLogStateKey);
      const rows = Array.isArray(current) ? current.slice(0, 499) : [];
      rows.unshift({
        id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        created_at: nowIso(),
        ...entry,
      });
      await storage.setAppState(doctorTradeLogStateKey, rows);
    } catch {
    }
  };

  const getSolanaEarlyScoredTokens = async (windowMinutes = 120, limit = 200) => {
    const nowMs = Date.now();
    const windowSeconds = Math.max(60, Math.trunc(windowMinutes * 60));
    const cappedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));

    if (doctorEarlyScoredCache && nowMs - doctorEarlyScoredCache.at < 20_000) {
      return doctorEarlyScoredCache.tokens
        .filter((token) => Number(token.age_seconds || 0) <= windowSeconds)
        .slice(0, cappedLimit);
    }

    const scanned = await storage.getScannedTokens();
    const scannedTokens = scanned
      .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
      .map((token) => {
        const createdAt = token.createdAt ? new Date(token.createdAt) : new Date();
        const firstSeenAt = Number.isNaN(createdAt.getTime()) ? nowIso() : createdAt.toISOString();
        return {
          mint: String(token.address || "").trim(),
          symbol: String(token.symbol || "UNKNOWN"),
          name: String(token.name || token.symbol || "Unknown"),
          source: "scanner",
          first_seen_at: firstSeenAt,
          liquidity_usd: Number(token.liquidity || 0),
          market_cap_usd: Number(token.marketCap || 0),
          volume_24h: Number(token.volume24h || 0),
          volume_5m: Number((Number(token.volume24h || 0) / 288).toFixed(2)),
          holders_count: Number((token as any).holdersCount || (token as any).holders || 0),
          top_holder_pct: Number((token as any).topHoldersPercentage || (token as any).topHolderPct || 0),
          dev_wallet_pct: Number((token as any).devWalletPercentage || 0),
          price_change_1h: Number(token.priceChange1h || 0),
          price_usd: Number(token.priceUsd || 0),
          liquidity_locked: Boolean((token as any).isLiquidityLocked),
          launch_source: normalizeLaunchSource(String((token as any).dexId || "scanner")),
        };
      })
      .filter((token) => token.mint);

    const apifyTokens = await (async () => {
      try {
        const rows = await fetchFreshPumpfunTokens(80);
        return rows
          .map((token) => {
            const raw = (token.raw || {}) as Record<string, unknown>;
            const createdAtRaw = String(raw.discoveredAt || raw.created_at || raw.createdAt || raw.timestamp || "").trim();
            const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date();
            const firstSeenAt = Number.isNaN(createdAt.getTime()) ? nowIso() : createdAt.toISOString();
            const volume24h = Number(raw.volume24h || raw.volume_24h || 0);
            return {
              mint: String(token.mintAddress || "").trim(),
              symbol: String(token.symbol || token.name || "UNKNOWN"),
              name: String(token.name || token.symbol || "Unknown"),
              source: "apify",
              first_seen_at: firstSeenAt,
              liquidity_usd: Number(token.liquidityUsd || raw.liquidityUsd || raw.liquidity_usd || raw.liquidity || 0),
              market_cap_usd: Number(raw.marketCapUsd || raw.market_cap_usd || raw.marketCap || 0),
              volume_24h: volume24h,
              volume_5m: Number((volume24h / 288).toFixed(2)),
              holders_count: Number(raw.holdersCount || raw.holder_count || 0),
              top_holder_pct: Number(raw.topHoldersPercentage || raw.top_holder_pct || 0),
              dev_wallet_pct: Number(raw.devWalletPercentage || raw.dev_wallet_pct || 0),
              price_change_1h: Number(raw.priceChange1h || raw.price_change_1h || 0),
              price_usd: Number(raw.priceUsd || raw.price_usd || raw.usdPrice || 0),
              liquidity_locked: Boolean(raw.isLiquidityLocked || raw.liquidity_locked || raw.lpLocked),
              launch_source: normalizeLaunchSource(String(raw.sourcePlatform || raw.source_platform || token.eventType || "pumpfun")),
            };
          })
          .filter((token) => token.mint);
      } catch {
        return [] as Array<Record<string, any>>;
      }
    })();

    const raydiumTokens = await (async () => {
      try {
        const pools = await refreshRaydiumPools();
        return pools
          .map((pool) => {
            const baseRoute = detectSupportedBaseMint(pool);
            if (!baseRoute) return null;
            const createdAt = new Date(pool.createdAtIso);
            const firstSeenAt = Number.isNaN(createdAt.getTime()) ? nowIso() : createdAt.toISOString();
            return {
              mint: String(baseRoute.tokenMint || "").trim(),
              symbol: "UNKNOWN",
              name: "Raydium Pool Token",
              source: "raydium",
              first_seen_at: firstSeenAt,
              liquidity_usd: Number(pool.liquidityUsd || 0),
              market_cap_usd: Number(pool.marketCapUsd || 0),
              volume_24h: Number(pool.volume24hUsd || 0),
              volume_5m: Number((Number(pool.volume24hUsd || 0) / 288).toFixed(2)),
              holders_count: 0,
              top_holder_pct: Number(pool.topHoldersPct || 0),
              dev_wallet_pct: Number(pool.devWalletPct || 0),
              price_change_1h: 0,
              price_usd: 0,
              liquidity_locked: Boolean(pool.liquidityLocked),
              launch_source: normalizeLaunchSource(pool.launchSource),
              pool_address: pool.poolAddress,
              base_mint: baseRoute.baseMint,
            };
          })
          .filter((token) => Boolean((token as any)?.mint)) as Array<Record<string, any>>;
      } catch {
        return [] as Array<Record<string, any>>;
      }
    })();

    const byMint = new Map<string, Record<string, any>>();
    for (const token of [...scannedTokens, ...apifyTokens, ...raydiumTokens]) {
      const mint = String(token.mint || "").trim();
      if (!mint) continue;
      const prev = byMint.get(mint);
      if (!prev) {
        byMint.set(mint, token);
        continue;
      }
      const prevSeen = new Date(String(prev.first_seen_at || "")).getTime();
      const nextSeen = new Date(String(token.first_seen_at || "")).getTime();
      byMint.set(mint, {
        ...prev,
        ...token,
        first_seen_at: prevSeen > 0 && nextSeen > 0 ? new Date(Math.min(prevSeen, nextSeen)).toISOString() : prev.first_seen_at,
        liquidity_usd: Math.max(Number(prev.liquidity_usd || 0), Number(token.liquidity_usd || 0)),
        market_cap_usd: Math.max(Number(prev.market_cap_usd || 0), Number(token.market_cap_usd || 0)),
        volume_24h: Math.max(Number(prev.volume_24h || 0), Number(token.volume_24h || 0)),
        volume_5m: Math.max(Number(prev.volume_5m || 0), Number(token.volume_5m || 0)),
        holders_count: Math.max(Number(prev.holders_count || 0), Number(token.holders_count || 0)),
        top_holder_pct: Number(token.top_holder_pct || prev.top_holder_pct || 0),
        dev_wallet_pct: Number(token.dev_wallet_pct || prev.dev_wallet_pct || 0),
        liquidity_locked: Boolean(token.liquidity_locked || prev.liquidity_locked),
        launch_source: normalizeLaunchSource(String(token.launch_source || prev.launch_source || prev.source || "unknown")),
        source: prev.source === "apify" || token.source === "apify" ? "apify+scanner" : prev.source,
      });
    }

    const scored = Array.from(byMint.values())
      .map((token) => {
        const firstSeenMs = new Date(String(token.first_seen_at || "")).getTime();
        const ageSeconds = Number.isFinite(firstSeenMs) && firstSeenMs > 0 ? Math.max(0, Math.trunc((nowMs - firstSeenMs) / 1000)) : 0;
        const liquidityUsd = Number(token.liquidity_usd || 0);
        const marketCapUsd = Number(token.market_cap_usd || 0);
        const volume24h = Number(token.volume_24h || 0);
        const volume5m = Number(token.volume_5m || 0);
        const holdersCount = Number(token.holders_count || 0);
        const topHolderPct = Number(token.top_holder_pct || 0);
        const priceChange1h = Number(token.price_change_1h || 0);
        const liquidityLocked = Boolean(token.liquidity_locked);
        const launchSource = normalizeLaunchSource(String(token.launch_source || token.source || "unknown"));

        const freshnessScore = Math.max(0, 40 * (1 - Math.min(ageSeconds, windowSeconds) / Math.max(1, windowSeconds)));
        const liquidityScore = Math.max(0, Math.min(25, (liquidityUsd / 25_000) * 25));
        const holderScore = Math.max(0, Math.min(15, (holdersCount / 500) * 15));
        const concentrationScore = topHolderPct > 0 ? Math.max(0, Math.min(10, ((45 - topHolderPct) / 45) * 10)) : 5;
        const momentumScore = Math.max(0, Math.min(10, ((volume5m / 2500) * 5) + (priceChange1h > 0 ? Math.min(5, priceChange1h / 2) : 0)));
        const confidenceScore = Number((freshnessScore + liquidityScore + holderScore + concentrationScore + momentumScore).toFixed(2));

        const rejectReasons: string[] = [];
        if (ageSeconds > windowSeconds) rejectReasons.push("outside_window");
        if (ageSeconds < Math.max(1, Math.trunc(Number(doctorRuntime.controls.min_token_age_minutes || 15))) * 60) rejectReasons.push("below_min_age");
        if (liquidityUsd < 2000) rejectReasons.push("low_liquidity");
        if (marketCapUsd < Math.max(1, Number(doctorRuntime.controls.min_market_cap_usd || 15000))) rejectReasons.push("low_market_cap");
        if (volume24h < Math.max(1, Number(doctorRuntime.controls.min_volume_24h_usd || 12000))) rejectReasons.push("low_volume_24h");
        if (topHolderPct > 45) rejectReasons.push("holder_concentration_high");
        if (!liquidityLocked) rejectReasons.push("liquidity_not_locked");
        if (!getAllowedLaunchSources().has(launchSource)) rejectReasons.push("launch_source_not_allowed");
        if (confidenceScore < 55) rejectReasons.push("confidence_below_threshold");

        return {
          ...token,
          chain: "solana",
          launch_source: launchSource,
          liquidity_locked: liquidityLocked,
          age_seconds: ageSeconds,
          confidence_score: confidenceScore,
          eligible: rejectReasons.length === 0,
          reject_reasons: rejectReasons,
        };
      })
      .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
        return a.age_seconds - b.age_seconds;
      });

    doctorEarlyScoredCache = { at: nowMs, tokens: scored };
    return scored.filter((token) => Number(token.age_seconds || 0) <= windowSeconds).slice(0, cappedLimit);
  };

  const getDoctorActiveTokens = async () => {
    const early = await getSolanaEarlyScoredTokens(120, 220);
    return early
      .filter((token) => Boolean(token.eligible))
      .filter((token) => Number(token.liquidity_usd || 0) >= Number(doctorRuntime.controls.min_liquidity_usd || 0))
      .map((token: any) => {
        const score = Number(token.confidence_score || 0);
        return {
          symbol: String(token.symbol || "UNKNOWN"),
          address: String(token.mint || ""),
          liquidity: Number(token.liquidity_usd || 0),
          volume_5m: Number(token.volume_5m || 0),
          volume_24h: Number(token.volume_24h || 0),
          market_cap_usd: Number(token.market_cap_usd || 0),
          score,
          price_usd: Number((token as any).price_usd || 0),
          price_change_1h: Number((token as any).price_change_1h || 0),
          age_seconds: Number((token as any).age_seconds || 0),
          chain: "solana",
          created_at: String(token.first_seen_at || nowIso()),
          holders_count: Number(token.holders_count || 0),
          top_holder_pct: Number(token.top_holder_pct || 0),
          dev_wallet_pct: Number(token.dev_wallet_pct || 0),
          launch_source: String(token.launch_source || "unknown"),
          liquidity_locked: Boolean(token.liquidity_locked),
          pool_address: String((token as any).pool_address || ""),
          base_mint: String((token as any).base_mint || ""),
          risk_level: score >= 70 ? "SAFE" : score >= 45 ? "MEDIUM" : "HIGH RISK",
          source: String(token.source || "solana_early"),
          reject_reasons: token.reject_reasons || [],
        };
      })
      .slice(0, 40);
  };

  const resolveCurrentPriceUsd = (token: Record<string, any>, fallbackPriceUsd: number) => {
    const tokenPrice = Number(token?.price_usd || 0);
    if (Number.isFinite(tokenPrice) && tokenPrice > 0) return tokenPrice;
    return Number(fallbackPriceUsd || 0);
  };

  const computeDoctorRiskMetrics = (nowMs = Date.now()) => {
    const todaysSellTrades = doctorRuntime.recentTrades.filter((trade) => {
      if (String(trade.action || "").toUpperCase() !== "SELL") return false;
      const ts = new Date(String(trade.timestamp || "")).getTime();
      if (!Number.isFinite(ts) || ts <= 0) return false;
      return new Date(ts).toDateString() === new Date(nowMs).toDateString();
    });

    const dailyRealizedPnlUsd = Number(
      todaysSellTrades.reduce((sum, trade) => sum + Number(trade.pnl_usd || 0), 0).toFixed(2),
    );

    const recentSellTrades = doctorRuntime.recentTrades
      .filter((trade) => String(trade.action || "").toUpperCase() === "SELL")
      .slice(0, 20);

    let consecutiveLosses = 0;
    for (const trade of recentSellTrades) {
      const pnlUsd = Number(trade.pnl_usd || 0);
      if (pnlUsd < 0) {
        consecutiveLosses += 1;
      } else {
        break;
      }
    }

    return {
      dailyRealizedPnlUsd,
      consecutiveLosses,
    };
  };

  const appendDoctorExecutionAudit = (entry: Record<string, any>) => {
    doctorRuntime.executionAudit.unshift({
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: nowIso(),
      mode: doctorRuntime.execution.mode,
      ...entry,
    });
    doctorRuntime.executionAudit = doctorRuntime.executionAudit.slice(0, 200);
  };

  const fetchJupiterQuote = async (params: {
    inputMint: string;
    outputMint: string;
    amountAtomic: number | string;
    slippageBps: number;
  }) => {
    return fetchRaydiumQuote({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amountAtomic: params.amountAtomic,
      slippageBps: params.slippageBps,
    });
  };

  const fetchJupiterSwapPayload = async (params: {
    quoteResponse: Record<string, any>;
    userPublicKey: string;
  }) => {
    return fetchRaydiumSwapPayload({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      priorityFeeLamports: Number(process.env.DOCTORTRADE_PRIORITY_FEE_LAMPORTS || 0),
    });
  };

  const parseSolanaSecretKey = (value: string): Uint8Array | null => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;

    try {
      if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed) as number[];
        if (Array.isArray(parsed) && parsed.length >= 32) {
          return Uint8Array.from(parsed.map((item) => Number(item) & 0xff));
        }
      }
    } catch {
    }

    try {
      const decoded = bs58Codec.decode(trimmed);
      if (decoded.length >= 32) return decoded;
    } catch {
    }

    try {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length >= 32) return new Uint8Array(decoded);
    } catch {
    }

    return null;
  };

  const executeDoctorOrder = async (params: {
    action: "buy" | "sell";
    symbol: string;
    mint: string;
    amountSol: number;
    expectedPriceUsd: number;
    reason: string;
    trigger: "manual" | "auto";
    baseMint?: string;
  }) => {
    const liveEnabled = String(process.env.DOCTORTRADE_LIVE_TRADING_ENABLED || "").toLowerCase() === "true";
    const mode = doctorRuntime.execution.mode;

    if (mode === "live") {
      if (!liveEnabled) {
        appendDoctorExecutionAudit({
          action: params.action,
          symbol: params.symbol,
          mint: params.mint,
          amount_sol: params.amountSol,
          expected_price_usd: params.expectedPriceUsd,
          expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
          trigger: params.trigger,
          reason: params.reason,
          status: "blocked",
          block_reason: "live_mode_not_enabled",
        });
        return {
          executed: false,
          status: "blocked",
          reason: "live_mode_not_enabled",
        } as const;
      }

      const walletPublicKey = String(process.env.DOCTORTRADE_LIVE_WALLET_PUBLIC_KEY || "").trim();
      const walletPrivateKey = String(process.env.DOCTORTRADE_LIVE_WALLET_PRIVATE_KEY || "").trim();
      const slippageBps = Math.max(25, Math.trunc(Number(doctorRuntime.controls.max_slippage_pct || 1) * 100));
      const tradeBaseMint = [SOL_MINT, BONK_MINT].includes(String(params.baseMint || "").trim())
        ? String(params.baseMint || "").trim()
        : getDoctorTradeBaseAssetMint();
      const baseDecimals = await getTokenMintDecimals(tradeBaseMint).catch(() => (
        tradeBaseMint === BONK_MINT ? Math.max(0, Number(process.env.BONK_DECIMALS || 5)) : 9
      ));
      const amountLamports = Math.max(1, Math.trunc(params.amountSol * Math.pow(10, baseDecimals)));

      if (params.action === "sell") {
        if (!walletPublicKey) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_wallet_public_key_missing",
            router: "raydium",
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_wallet_public_key_missing",
          } as const;
        }

        if (!walletPrivateKey) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_wallet_private_key_missing",
            router: "raydium",
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_wallet_private_key_missing",
          } as const;
        }

        const secretKey = parseSolanaSecretKey(walletPrivateKey);
        if (!secretKey) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_wallet_private_key_invalid",
            router: "raydium",
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_wallet_private_key_invalid",
          } as const;
        }

        try {
          const connection = getSolanaConnection();
          const ownerPk = new PublicKey(walletPublicKey);
          const mintPk = new PublicKey(params.mint);
          const accounts = await connection.getParsedTokenAccountsByOwner(ownerPk, { mint: mintPk }, "confirmed");

          const tokenAmounts = accounts.value.map((entry) => {
            const tokenAmount = (entry.account.data as any)?.parsed?.info?.tokenAmount;
            return {
              raw: String(tokenAmount?.amount || "0"),
              decimals: Number(tokenAmount?.decimals || 0),
            };
          });
          const decimals = Number(tokenAmounts[0]?.decimals || 0);
          const totalRaw = tokenAmounts.reduce((sum, item) => {
            try {
              return sum + BigInt(item.raw || "0");
            } catch {
              return sum;
            }
          }, BigInt(0));

          if (totalRaw <= BigInt(0)) {
            appendDoctorExecutionAudit({
              action: params.action,
              symbol: params.symbol,
              mint: params.mint,
              amount_sol: params.amountSol,
              expected_price_usd: params.expectedPriceUsd,
              expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
              trigger: params.trigger,
              reason: params.reason,
              status: "blocked",
              block_reason: "live_sell_balance_zero",
              router: "raydium",
            });
            return {
              executed: false,
              status: "blocked",
              reason: "live_sell_balance_zero",
            } as const;
          }

          const configuredSellFraction = Math.max(1, Math.min(100, Number(doctorRuntime.controls.live_sell_fraction_pct || 100)));
          const maxSellNotionalUsd = Math.max(1, Number(doctorRuntime.controls.max_sell_notional_usd || Number.POSITIVE_INFINITY));
          const expectedNotionalUsd = Math.max(0, Number(params.amountSol * params.expectedPriceUsd || 0));
          const notionalFractionCap = Number.isFinite(maxSellNotionalUsd) && expectedNotionalUsd > 0
            ? Math.min(1, maxSellNotionalUsd / expectedNotionalUsd)
            : 1;
          const sellFraction = Math.max(0.01, Math.min(1, (configuredSellFraction / 100) * notionalFractionCap));
          const scale = BigInt(1_000_000);
          const scaledFraction = BigInt(Math.max(1, Math.floor(sellFraction * 1_000_000)));
          let sellRawAmount = (totalRaw * scaledFraction) / scale;
          if (sellRawAmount <= BigInt(0)) {
            sellRawAmount = BigInt(1);
          }
          if (sellRawAmount > totalRaw) {
            sellRawAmount = totalRaw;
          }
          const sellRawAmountString = sellRawAmount.toString();
          const executedAmountSol = Number((params.amountSol * Number(scaledFraction) / 1_000_000).toFixed(9));

          const quote = await fetchJupiterQuote({
            inputMint: params.mint,
            outputMint: tradeBaseMint,
            amountAtomic: sellRawAmountString,
            slippageBps,
          });

          const routePlan = Array.isArray(quote?.routePlan) ? quote.routePlan : [];
          const outAmount = Number(quote?.outAmount || 0);
          const priceImpactPct = Number(quote?.priceImpactPct || 0);

          const swapPayload = await fetchJupiterSwapPayload({
            quoteResponse: quote,
            userPublicKey: walletPublicKey,
          });

          if (!swapPayload?.swapTransaction) {
            appendDoctorExecutionAudit({
              action: params.action,
              symbol: params.symbol,
              mint: params.mint,
              amount_sol: params.amountSol,
              expected_price_usd: params.expectedPriceUsd,
              expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
              trigger: params.trigger,
              reason: params.reason,
              status: "blocked",
              block_reason: "live_swap_transaction_missing",
              router: "raydium",
            });
            return {
              executed: false,
              status: "blocked",
              reason: "live_swap_transaction_missing",
            } as const;
          }

          const keypair = Keypair.fromSecretKey(secretKey);
          const derivedPublicKey = keypair.publicKey.toBase58();
          if (walletPublicKey && derivedPublicKey !== walletPublicKey) {
            appendDoctorExecutionAudit({
              action: params.action,
              symbol: params.symbol,
              mint: params.mint,
              amount_sol: params.amountSol,
              expected_price_usd: params.expectedPriceUsd,
              expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
              trigger: params.trigger,
              reason: params.reason,
              status: "blocked",
              block_reason: "live_wallet_public_key_mismatch",
              router: "raydium",
              configured_public_key: walletPublicKey,
              derived_public_key: derivedPublicKey,
            });
            return {
              executed: false,
              status: "blocked",
              reason: "live_wallet_public_key_mismatch",
            } as const;
          }

          const swapTxBytes = Buffer.from(String(swapPayload.swapTransaction), "base64");
          const versioned = VersionedTransaction.deserialize(swapTxBytes);
          versioned.sign([keypair]);

          const signature = await connection.sendRawTransaction(versioned.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
          const latestBlockhash = await connection.getLatestBlockhash("confirmed");
          await connection.confirmTransaction(
            {
              signature,
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            "confirmed",
          );

          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "executed",
            router: "raydium",
            tx_hash: signature,
            explorer_url: `https://solscan.io/tx/${signature}`,
            quote_out_amount: outAmount,
            quote_price_impact_pct: priceImpactPct,
            route_hops: routePlan.length,
            sell_amount_raw: sellRawAmountString,
            sell_amount_decimals: decimals,
            sell_fraction_pct: Number(((Number(scaledFraction) / 1_000_000) * 100).toFixed(2)),
            max_sell_notional_usd: Number.isFinite(maxSellNotionalUsd) ? maxSellNotionalUsd : null,
          });

          await appendDoctorTradeLog({
            token_address: params.mint,
            pool_address: null,
            trade_amount: executedAmountSol,
            entry_price: params.expectedPriceUsd,
            transaction_signature: signature,
            base_asset_mint: tradeBaseMint,
            timestamp: nowIso(),
          });

          return {
            executed: true,
            status: "executed",
            txHash: signature,
            executedAmountSol,
          } as const;
        } catch (error) {
          const message = error instanceof Error ? error.message : "jupiter_live_sell_failed";
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: message,
            router: "raydium",
          });
          return {
            executed: false,
            status: "blocked",
            reason: message,
          } as const;
        }
      }

      try {
        const quote = await fetchJupiterQuote({
          inputMint: tradeBaseMint,
          outputMint: params.mint,
          amountAtomic: amountLamports,
          slippageBps,
        });

        const routePlan = Array.isArray(quote?.routePlan) ? quote.routePlan : [];
        const outAmount = Number(quote?.outAmount || 0);
        const priceImpactPct = Number(quote?.priceImpactPct || 0);

        if (!walletPublicKey) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_wallet_public_key_missing",
            router: "raydium",
            quote_out_amount: outAmount,
            quote_price_impact_pct: priceImpactPct,
            route_hops: routePlan.length,
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_wallet_public_key_missing",
          } as const;
        }

        const swapPayload = await fetchJupiterSwapPayload({
          quoteResponse: quote,
          userPublicKey: walletPublicKey,
        });

        if (!walletPrivateKey) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_wallet_private_key_missing",
            router: "raydium",
            quote_out_amount: outAmount,
            quote_price_impact_pct: priceImpactPct,
            route_hops: routePlan.length,
            swap_tx_present: Boolean(swapPayload?.swapTransaction),
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_wallet_private_key_missing",
          } as const;
        }

        const secretKey = parseSolanaSecretKey(walletPrivateKey);
        if (!secretKey) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_wallet_private_key_invalid",
            router: "raydium",
            quote_out_amount: outAmount,
            quote_price_impact_pct: priceImpactPct,
            route_hops: routePlan.length,
            swap_tx_present: Boolean(swapPayload?.swapTransaction),
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_wallet_private_key_invalid",
          } as const;
        }

        if (!swapPayload?.swapTransaction) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_swap_transaction_missing",
            router: "raydium",
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_swap_transaction_missing",
          } as const;
        }

        const keypair = Keypair.fromSecretKey(secretKey);
        const derivedPublicKey = keypair.publicKey.toBase58();
        if (walletPublicKey && derivedPublicKey !== walletPublicKey) {
          appendDoctorExecutionAudit({
            action: params.action,
            symbol: params.symbol,
            mint: params.mint,
            amount_sol: params.amountSol,
            expected_price_usd: params.expectedPriceUsd,
            expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
            trigger: params.trigger,
            reason: params.reason,
            status: "blocked",
            block_reason: "live_wallet_public_key_mismatch",
            router: "raydium",
            configured_public_key: walletPublicKey,
            derived_public_key: derivedPublicKey,
          });
          return {
            executed: false,
            status: "blocked",
            reason: "live_wallet_public_key_mismatch",
          } as const;
        }

        const connection = getSolanaConnection();
        const swapTxBytes = Buffer.from(String(swapPayload.swapTransaction), "base64");
        const versioned = VersionedTransaction.deserialize(swapTxBytes);
        versioned.sign([keypair]);

        const signature = await connection.sendRawTransaction(versioned.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        const latestBlockhash = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          "confirmed",
        );

        appendDoctorExecutionAudit({
          action: params.action,
          symbol: params.symbol,
          mint: params.mint,
          amount_sol: params.amountSol,
          expected_price_usd: params.expectedPriceUsd,
          expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
          trigger: params.trigger,
          reason: params.reason,
          status: "executed",
          router: "raydium",
          tx_hash: signature,
          explorer_url: `https://solscan.io/tx/${signature}`,
          quote_out_amount: outAmount,
          quote_price_impact_pct: priceImpactPct,
          route_hops: routePlan.length,
        });
        await appendDoctorTradeLog({
          token_address: params.mint,
          pool_address: null,
          trade_amount: params.amountSol,
          entry_price: params.expectedPriceUsd,
          transaction_signature: signature,
          base_asset_mint: tradeBaseMint,
          timestamp: nowIso(),
        });
        return {
          executed: true,
          status: "executed",
          txHash: signature,
        } as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : "jupiter_live_preflight_failed";
        appendDoctorExecutionAudit({
          action: params.action,
          symbol: params.symbol,
          mint: params.mint,
          amount_sol: params.amountSol,
          expected_price_usd: params.expectedPriceUsd,
          expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
          trigger: params.trigger,
          reason: params.reason,
          status: "blocked",
          block_reason: message,
          router: "raydium",
        });
        return {
          executed: false,
          status: "blocked",
          reason: message,
          executedAmountSol: 0,
        } as const;
      }
    }

    const txHash = `paper_${params.action}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    appendDoctorExecutionAudit({
      action: params.action,
      symbol: params.symbol,
      mint: params.mint,
      amount_sol: params.amountSol,
      expected_price_usd: params.expectedPriceUsd,
      expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
      trigger: params.trigger,
      reason: params.reason,
      status: "executed",
      tx_hash: txHash,
    });

    await appendDoctorTradeLog({
      token_address: params.mint,
      pool_address: null,
      trade_amount: params.amountSol,
      entry_price: params.expectedPriceUsd,
      transaction_signature: txHash,
      base_asset_mint: getDoctorTradeBaseAssetMint(),
      timestamp: nowIso(),
    });

    return {
      executed: true,
      status: "executed",
      txHash,
      executedAmountSol: params.amountSol,
    } as const;
  };

  const executeDoctorCycle = async (trigger: "manual" | "auto" = "manual") => {
    doctorRuntime.lastRunAt = nowIso();

    if (!doctorRuntime.enabled) {
      doctorRuntime.lastDecision = { action: "skip", reason: "doctortrade_disabled", trigger, at: nowIso() };
      return { executed: false, reason: "doctortrade_disabled", trigger };
    }
    if (doctorRuntime.killSwitch) {
      doctorRuntime.lastDecision = { action: "skip", reason: "kill_switch_enabled", trigger, at: nowIso() };
      return { executed: false, reason: "kill_switch_enabled", trigger };
    }
    if (!doctorRuntime.wallet.address) {
      doctorRuntime.lastDecision = { action: "skip", reason: "wallet_not_connected", trigger, at: nowIso() };
      return { executed: false, reason: "wallet_not_connected", trigger };
    }

    const activeTokens = await getDoctorActiveTokens();
    const tokenMap = new Map(activeTokens.map((token) => [String(token.address || ""), token]));
    const nowMs = Date.now();

    const { dailyRealizedPnlUsd, consecutiveLosses } = computeDoctorRiskMetrics(nowMs);

    let sellCount = 0;
    const updatedPositions: Array<Record<string, any>> = [];
    const takeProfitPct = Math.max(
      Number(doctorRuntime.controls.min_profit_pct || 0),
      (Math.max(1.01, Number(doctorRuntime.controls.take_profit_multiplier || 2)) - 1) * 100,
    );

    for (const position of doctorRuntime.positions) {
      const market = tokenMap.get(String(position.address || "")) || null;
      const entryPrice = Number(position.entry_price || 0);
      const currentPrice = resolveCurrentPriceUsd(market || {}, entryPrice);
      const peakPrice = Math.max(Number(position.peak_price || entryPrice || currentPrice || 0), currentPrice || 0);
      const holdMinutes = Math.max(0, (nowMs - new Date(String(position.opened_at || nowIso())).getTime()) / 60000);
      const pnlPct = entryPrice > 0 && currentPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
      const drawdownFromPeakPct = peakPrice > 0 && currentPrice > 0 ? ((peakPrice - currentPrice) / peakPrice) * 100 : 0;
      const marketVolume5m = Number(market?.volume_5m || 0);
      const marketHolders = Number(market?.holders_count || 0);
      const marketScore = Number(market?.score || 0);
      const topHolderPct = Number(market?.top_holder_pct || 0);

      let sellReason = "";
      if (pnlPct >= takeProfitPct) {
        sellReason = "take_profit_reached";
      } else if (pnlPct <= -Math.max(0.1, Number(doctorRuntime.controls.stop_loss_pct || 0))) {
        sellReason = "stop_loss_hit";
      } else if (
        pnlPct > 0 &&
        drawdownFromPeakPct >= Math.max(0.1, Number(doctorRuntime.controls.trailing_stop_pct || 0))
      ) {
        sellReason = "trailing_stop_triggered";
      } else if (
        holdMinutes >= Math.max(5, Number(doctorRuntime.controls.max_hold_minutes || 0)) &&
        pnlPct >= Math.max(0, Number(doctorRuntime.controls.min_momentum_profit_pct || 0))
      ) {
        sellReason = "max_hold_reached";
      } else if (
        pnlPct >= Math.max(0, Number(doctorRuntime.controls.min_momentum_profit_pct || 0)) &&
        (
          marketVolume5m <= 0 ||
          marketScore < Math.max(1, Number(doctorRuntime.controls.strong_move_threshold_pct || 40)) * 0.7 ||
          (marketHolders > 0 && marketHolders < 120) ||
          (topHolderPct > 0 && topHolderPct > Math.max(1, Number(doctorRuntime.controls.quality_max_top_holder_pct || 24)))
        )
      ) {
        sellReason = "momentum_or_holder_quality_drop";
      }

      if (!sellReason) {
        updatedPositions.push({
          ...position,
          current_price: currentPrice,
          peak_price: peakPrice,
          last_seen_at: nowIso(),
          pnl_pct: Number(pnlPct.toFixed(2)),
        });
        continue;
      }

      const amountSol = Number(position.amount_sol || 0);
      const sellExecution = await executeDoctorOrder({
        action: "sell",
        symbol: String(position.symbol || "UNKNOWN"),
        mint: String(position.address || ""),
        amountSol,
        expectedPriceUsd: currentPrice,
        reason: sellReason,
        trigger,
        baseMint: String((position as any).base_mint || getDoctorTradeBaseAssetMint()),
      });
      if (!sellExecution.executed) {
        updatedPositions.push({
          ...position,
          current_price: currentPrice,
          peak_price: peakPrice,
          last_seen_at: nowIso(),
          pnl_pct: Number(pnlPct.toFixed(2)),
        });
        doctorRuntime.lastDecision = {
          action: "skip",
          reason: sellExecution.reason,
          trigger,
          at: nowIso(),
          token: String(position.symbol || "UNKNOWN"),
          mint: String(position.address || ""),
        };
        continue;
      }
      const soldAmountSol = Math.max(0, Math.min(amountSol, Number((sellExecution as any).executedAmountSol || amountSol)));
      const estimatedExitSol = entryPrice > 0 && currentPrice > 0 ? soldAmountSol * (currentPrice / entryPrice) : soldAmountSol;
      doctorRuntime.wallet.balanceSol = Number((Number(doctorRuntime.wallet.balanceSol || 0) + Math.max(0, estimatedExitSol)).toFixed(6));
      sellCount += 1;
      const pnlUsd = Number(((soldAmountSol * currentPrice) - (soldAmountSol * entryPrice)).toFixed(2));
      const remainingAmountSol = Number((amountSol - soldAmountSol).toFixed(9));

      doctorRuntime.recentTrades.unshift({
        token: position.symbol,
        address: position.address,
        action: "SELL",
        status: "EXECUTED",
        reason: sellReason,
        confidence: Number(market?.score || position.confidence || 0),
        liquidity: Number(market?.liquidity || position.liquidity || 0),
        volume_5m: Number(market?.volume_5m || 0),
        size_pct: Number(position.size_pct || 100) * (amountSol > 0 ? soldAmountSol / amountSol : 1),
        notional_usd: Number((soldAmountSol * currentPrice).toFixed(2)),
        pnl_pct: Number(pnlPct.toFixed(2)),
        pnl_usd: pnlUsd,
        execution_mode: doctorRuntime.execution.mode,
        tx_hash: sellExecution.txHash,
        timestamp: nowIso(),
      });

      doctorRuntime.decisionJournal.unshift({
        token: position.symbol,
        address: position.address,
        decision: "sell",
        reason: sellReason,
        confidence: Number(market?.score || position.confidence || 0),
        size_pct: Number(position.size_pct || 100) * (amountSol > 0 ? soldAmountSol / amountSol : 1),
        strategy_mode: "autonomous",
        timestamp: nowIso(),
      });

      if (remainingAmountSol > 0.000001) {
        updatedPositions.push({
          ...position,
          amount_sol: remainingAmountSol,
          current_price: currentPrice,
          peak_price: peakPrice,
          last_seen_at: nowIso(),
          pnl_pct: Number(pnlPct.toFixed(2)),
        });
      }
    }

    doctorRuntime.positions = updatedPositions.slice(0, 30);

    let buyCount = 0;
    const maxTradesPerDay = Math.max(1, Math.trunc(Number(doctorRuntime.controls.max_trades_per_day || 1)));
    const maxOpenPositions = Math.max(1, Math.trunc(Number(doctorRuntime.controls.max_open_positions || 5)));
    const cooldownMinutes = Math.max(0, Number(doctorRuntime.controls.cooldown_minutes_per_mint || 0));
    const feeBufferSol = Math.max(0, Number(doctorRuntime.controls.min_wallet_fee_buffer_sol || 0));
    const buyAmountSol = Math.max(0.01, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    const openAddresses = new Set(doctorRuntime.positions.map((position) => String(position.address || "")));

    const buyCandidate = activeTokens
      .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
      .filter((token) => !openAddresses.has(String(token.address || "")))
      .filter((token) => Number(token.score || 0) >= Math.max(1, Number(doctorRuntime.controls.strong_move_threshold_pct || 40)))
      .filter((token) => Number(token.liquidity || 0) >= Math.max(1000, Number(doctorRuntime.controls.min_liquidity_usd || 0)))
      .filter((token) => Number(token.market_cap_usd || 0) >= Math.max(1, Number(doctorRuntime.controls.min_market_cap_usd || 15000)))
      .filter((token) => Number(token.volume_24h || 0) >= Math.max(1, Number(doctorRuntime.controls.min_volume_24h_usd || 12000)))
      .filter((token) => Number(token.age_seconds || 0) >= Math.max(1, Math.trunc(Number(doctorRuntime.controls.min_token_age_minutes || 15))) * 60)
      .filter((token) => Boolean(token.liquidity_locked))
      .filter((token) => getAllowedLaunchSources().has(normalizeLaunchSource(String(token.launch_source || token.source || "unknown"))))
      .filter((token) => {
        const topHolderPct = Number(token.top_holder_pct || 0);
        if (topHolderPct <= 0) return true;
        return topHolderPct <= Math.max(1, Number(doctorRuntime.controls.quality_max_top_holder_pct || 24));
      })
      .sort((a, b) => {
        const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(b.volume_5m || 0) - Number(a.volume_5m || 0);
      })[0];

    const evaluatePreTradeGuard = (candidate: Record<string, any> | undefined) => {
      if (!candidate) {
        return { allowed: false, reason: "no_eligible_candidate" };
      }

      if (doctorRuntime.positions.length >= maxOpenPositions) {
        return { allowed: false, reason: "max_open_positions_reached" };
      }

      if (Number(doctorRuntime.controls.trades_today || 0) >= maxTradesPerDay) {
        return { allowed: false, reason: "max_trades_reached" };
      }

      if (dailyRealizedPnlUsd <= -Math.abs(Number(doctorRuntime.controls.daily_loss_limit_usd || 0))) {
        return { allowed: false, reason: "daily_loss_limit_reached" };
      }

      if (consecutiveLosses >= Math.max(1, Number(doctorRuntime.controls.max_consecutive_losses || 1))) {
        return { allowed: false, reason: "max_consecutive_losses_reached" };
      }

      const recentSameMintBuy = doctorRuntime.recentTrades.find((trade) => {
        if (String(trade.action || "").toUpperCase() !== "BUY") return false;
        if (String(trade.address || "") !== String(candidate.address || "")) return false;
        const ts = new Date(String(trade.timestamp || "")).getTime();
        if (!Number.isFinite(ts) || ts <= 0) return false;
        return nowMs - ts <= cooldownMinutes * 60_000;
      });
      if (recentSameMintBuy) {
        return { allowed: false, reason: "mint_cooldown_active" };
      }

      const baseAssetMint = getDoctorTradeBaseAssetMint();
      if (baseAssetMint === "So11111111111111111111111111111111111111112") {
        const availableSol = Number(doctorRuntime.wallet.balanceSol || 0);
        if (availableSol < buyAmountSol + feeBufferSol) {
          return { allowed: false, reason: "insufficient_wallet_balance_with_fee_buffer" };
        }
      }

      return { allowed: true, reason: "ok" };
    };

    const evaluateDoctorAiValidation = async (candidate: Record<string, any> | undefined) => {
      if (!candidate) {
        return {
          allowed: false,
          reason: "ai_validation_no_candidate",
          checks: {
            new_token_validation: false,
            liquidity_stability: false,
            volume_activity: false,
            wallet_participation: false,
            contract_safety: false,
            market_momentum: false,
            whale_activity: false,
            anti_rug_detection: false,
          },
          passed_signals: 0,
          required_signals: Math.max(1, Math.trunc(Number(doctorRuntime.controls.ai_min_signals_required || 8))),
          required_all_checks: true,
          all_checks_passed: false,
          checked_at: nowIso(),
          age_seconds: 0,
          token: null,
          reasons: ["no_candidate"],
        };
      }

      const strategyWindowMinutes = Math.max(5, Number(doctorRuntime.controls.strategy_window_minutes || 120));
      const strategyWindowSeconds = Math.trunc(strategyWindowMinutes * 60);
      const liquidityMin = Math.max(1000, Number(doctorRuntime.controls.min_liquidity_usd || 0));
      const topHolderMax = Math.max(1, Number(doctorRuntime.controls.quality_max_top_holder_pct || 24));
      const volumeSpikeMinPct = Math.max(1, Number(doctorRuntime.controls.quality_min_volume_spike_pct || 12));
      const minTokenAgeSeconds = Math.max(1, Math.trunc(Number(doctorRuntime.controls.min_token_age_minutes || 15))) * 60;
      const minVolume24h = Math.max(1, Number(doctorRuntime.controls.min_volume_24h_usd || 12000));
      const minMarketCap = Math.max(1, Number(doctorRuntime.controls.min_market_cap_usd || 15000));
      const allowedLaunchSources = getAllowedLaunchSources();

      const createdAtMs = new Date(String(candidate.created_at || nowIso())).getTime();
      const fallbackAgeSeconds = Number.isFinite(createdAtMs) && createdAtMs > 0
        ? Math.max(0, Math.trunc((nowMs - createdAtMs) / 1000))
        : strategyWindowSeconds + 1;
      const ageSeconds = Math.max(0, Number(candidate.age_seconds || fallbackAgeSeconds));

      const contractAddress = String(candidate.address || "").trim();
      const tokenBlacklist = new Set(
        String(process.env.DOCTORTRADE_TOKEN_BLACKLIST || "")
          .split(",")
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      );
      const isBlacklisted = tokenBlacklist.has(contractAddress);
      const scoreFallback = contractAddress
        ? await buildDexScoreFallback(contractAddress, "solana")
        : null;
      const scannedToken = contractAddress ? await storage.getScannedTokenByAddress(contractAddress) : undefined;
      const mintAuthorityInfo = contractAddress
        ? await getTokenMintAuthorityInfo(contractAddress)
        : { mintAuthorityDisabled: false, freezeAuthorityDisabled: false };

      const fallbackScores = (scoreFallback?.scores || {}) as Record<string, any>;
      const fallbackFlags = Array.isArray(scoreFallback?.risk_flags)
        ? scoreFallback!.risk_flags.map((flag: unknown) => String(flag || "").toUpperCase())
        : [];
      const riskFlags = new Set<string>(fallbackFlags);

      const liquidityUsd = Math.max(
        Number(candidate.liquidity || 0),
        Number(scoreFallback?.market_data?.liquidity_usd || 0),
      );
      const marketCapUsd = Number(candidate.market_cap_usd || 0);
      const volume24h = Number(candidate.volume_24h || 0);
      const volume5m = Number(candidate.volume_5m || 0);
      const holdersCount = Number(candidate.holders_count || 0);
      const topHolderPct = Math.max(
        Number(candidate.top_holder_pct || 0),
        Number(scannedToken?.topHoldersPercentage || 0),
      );
      const devWalletPct = Number(scannedToken?.devWalletPercentage || 0);
      const launchSource = normalizeLaunchSource(String(candidate.launch_source || candidate.source || "unknown"));
      const liquidityLocked = Boolean(candidate.liquidity_locked || scannedToken?.isLiquidityLocked);
      const priceChange1h = Number(candidate.price_change_1h || 0);

      const smartWalletSignal = Number(fallbackScores.smart_wallet_signal || 0);
      const confidenceSignal = Number(fallbackScores.trade_confidence_index || candidate.score || 0);
      const rugProbability = Number(fallbackScores.rug_probability || 95);

      const dexTradable = Boolean(
        scoreFallback?.source?.pair_address ||
        scoreFallback?.status === "dex_live" ||
        String(scoreFallback?.source?.provider || "").toLowerCase() === "dexscreener",
      );

      const newTokenValidation =
        ageSeconds >= minTokenAgeSeconds &&
        ageSeconds <= strategyWindowSeconds &&
        liquidityUsd > 0 &&
        marketCapUsd >= minMarketCap &&
        volume24h >= minVolume24h &&
        liquidityLocked &&
        allowedLaunchSources.has(launchSource) &&
        dexTradable;

      const liquidityStability =
        liquidityUsd >= liquidityMin &&
        liquidityLocked &&
        !riskFlags.has("LOW_LIQUIDITY") &&
        !riskFlags.has("THIN_LIQUIDITY") &&
        !riskFlags.has("HIGH_SLIPPAGE") &&
        !riskFlags.has("NO_LIVE_PAIR_DATA");

      const hasBuyPressure = smartWalletSignal >= 45;
      const volumeGrowthProxy = volume5m >= Math.max(50, Math.trunc(volumeSpikeMinPct * 10));
      const volumeConsistencyProxy = confidenceSignal >= 45;
      const volumeActivity = volume5m > 0 && hasBuyPressure && volumeGrowthProxy && volumeConsistencyProxy;

      const walletParticipation =
        holdersCount >= 25 &&
        topHolderPct > 0 &&
        topHolderPct <= topHolderMax &&
        (devWalletPct <= 0 || devWalletPct <= 20) &&
        !riskFlags.has("SELL_PRESSURE");

      const contractSafety =
        !isBlacklisted &&
        !Boolean(scannedToken?.isHoneypot) &&
        (Boolean(scannedToken?.mintAuthorityDisabled) || mintAuthorityInfo.mintAuthorityDisabled || Number(scannedToken?.safetyScore || 0) >= 60 || rugProbability <= 75) &&
        mintAuthorityInfo.freezeAuthorityDisabled &&
        !riskFlags.has("NO_LIVE_PAIR_DATA");

      const marketMomentum =
        priceChange1h > 0 &&
        hasBuyPressure &&
        !riskFlags.has("SELL_PRESSURE") &&
        Math.abs(priceChange1h) <= 120;

      const whaleActivity =
        topHolderPct > 0 &&
        topHolderPct <= topHolderMax &&
        smartWalletSignal >= 50 &&
        confidenceSignal >= 50 &&
        !riskFlags.has("SELL_PRESSURE");

      const antiRugDetection =
        !isBlacklisted &&
        !riskFlags.has("LOW_LIQUIDITY") &&
        !riskFlags.has("THIN_LIQUIDITY") &&
        !riskFlags.has("SELL_PRESSURE") &&
        rugProbability <= 85 &&
        liquidityLocked &&
        volume24h >= minVolume24h &&
        marketCapUsd >= minMarketCap &&
        allowedLaunchSources.has(launchSource) &&
        !riskFlags.has("NO_LIVE_PAIR_DATA") &&
        (devWalletPct <= 0 || devWalletPct <= 25);

      const checks = {
        new_token_validation: newTokenValidation,
        liquidity_stability: liquidityStability,
        volume_activity: volumeActivity,
        wallet_participation: walletParticipation,
        contract_safety: contractSafety,
        market_momentum: marketMomentum,
        whale_activity: whaleActivity,
        anti_rug_detection: antiRugDetection,
      };

      const requiredSignals = Math.max(1, Math.trunc(Number(doctorRuntime.controls.ai_min_signals_required || 8)));
      const passedSignals = Object.values(checks).filter(Boolean).length;
      const allChecksPassed = Object.values(checks).every(Boolean);
      const multiSignalPassed = passedSignals >= requiredSignals;
      const allowed =
        multiSignalPassed &&
        antiRugDetection &&
        newTokenValidation &&
        liquidityStability &&
        contractSafety;

      const failedReasons = Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([key]) => `${key}_failed`);

      return {
        allowed,
        reason: allowed ? "ok" : (failedReasons[0] || "ai_validation_failed"),
        checks,
        passed_signals: passedSignals,
        required_signals: requiredSignals,
        required_all_checks: true,
        all_checks_passed: allChecksPassed,
        checked_at: nowIso(),
        age_seconds: ageSeconds,
        token: {
          symbol: String(candidate.symbol || "UNKNOWN"),
          address: contractAddress,
          launch_source: launchSource,
          liquidity_locked: liquidityLocked,
          liquidity_usd: liquidityUsd,
          market_cap_usd: marketCapUsd,
          volume_24h: volume24h,
          volume_5m: volume5m,
          holders_count: holdersCount,
          top_holder_pct: topHolderPct,
          dev_wallet_pct: devWalletPct,
          price_change_1h: priceChange1h,
          rug_probability: rugProbability,
          smart_wallet_signal: smartWalletSignal,
          confidence_signal: confidenceSignal,
        },
        reasons: failedReasons,
      };
    };

    const guard = evaluatePreTradeGuard(buyCandidate);
    const canBuy = guard.allowed;

    if (buyCandidate && canBuy) {
      const aiValidation = await evaluateDoctorAiValidation(buyCandidate);
      if (!aiValidation.allowed) {
        appendDoctorExecutionAudit({
          action: "buy",
          symbol: String(buyCandidate.symbol || "UNKNOWN"),
          mint: String(buyCandidate.address || ""),
          amount_sol: buyAmountSol,
          expected_price_usd: Number(buyCandidate.price_usd || 0),
          expected_notional_usd: Number((buyAmountSol * Number(buyCandidate.price_usd || 0)).toFixed(2)),
          trigger,
          reason: "ai_validation_gate",
          status: "blocked",
          block_reason: aiValidation.reason,
          ai_validation: aiValidation,
        });
        doctorRuntime.decisionJournal.unshift({
          token: String(buyCandidate.symbol || "UNKNOWN"),
          address: String(buyCandidate.address || ""),
          decision: "skip",
          reason: "ai_validation_gate",
          confidence: Number(buyCandidate.score || 0),
          size_pct: 0,
          strategy_mode: "autonomous",
          ai_validation: aiValidation,
          timestamp: nowIso(),
        });
        doctorRuntime.lastDecision = {
          action: "skip",
          reason: aiValidation.reason,
          trigger,
          at: nowIso(),
          token: String(buyCandidate.symbol || "UNKNOWN"),
          mint: String(buyCandidate.address || ""),
          ai_validation: aiValidation,
        };
      } else {
      const tokenPriceUsd = resolveCurrentPriceUsd(buyCandidate, 0);
      const buyExecution = await executeDoctorOrder({
        action: "buy",
        symbol: String(buyCandidate.symbol || "UNKNOWN"),
        mint: String(buyCandidate.address || ""),
        amountSol: buyAmountSol,
        expectedPriceUsd: tokenPriceUsd,
        reason: String(buyCandidate.source || "scanner_signal"),
        trigger,
        baseMint: String(buyCandidate.base_mint || getDoctorTradeBaseAssetMint()),
      });
      if (!buyExecution.executed) {
        doctorRuntime.lastDecision = {
          action: "skip",
          reason: buyExecution.reason,
          trigger,
          at: nowIso(),
          token: String(buyCandidate.symbol || "UNKNOWN"),
          mint: String(buyCandidate.address || ""),
        };
      } else {
      const position = {
        symbol: String(buyCandidate.symbol || "UNKNOWN"),
        address: String(buyCandidate.address || ""),
        entry_price: tokenPriceUsd,
        current_price: tokenPriceUsd,
        peak_price: tokenPriceUsd,
        liquidity: Number(buyCandidate.liquidity || 0),
        confidence: Number(buyCandidate.score || 0),
        size_pct: 100,
        risk_status: String(buyCandidate.risk_level || "MEDIUM"),
        trailing_stop_pct: Number(doctorRuntime.controls.trailing_stop_pct || 10),
        amount_sol: buyAmountSol,
        base_mint: String(buyCandidate.base_mint || getDoctorTradeBaseAssetMint()),
        opened_at: nowIso(),
        source: String(buyCandidate.source || "scanner"),
      };
      doctorRuntime.positions.unshift(position);
      doctorRuntime.positions = doctorRuntime.positions.slice(0, 30);

      doctorRuntime.wallet.balanceSol = Number((Number(doctorRuntime.wallet.balanceSol || 0) - buyAmountSol).toFixed(6));
      doctorRuntime.controls.trades_today = Number(doctorRuntime.controls.trades_today || 0) + 1;
      buyCount += 1;

      doctorRuntime.recentTrades.unshift({
        token: position.symbol,
        address: position.address,
        action: "BUY",
        status: "EXECUTED",
        reason: position.source === "apify" ? "apify_early_launch_signal" : "scanner_signal",
        confidence: position.confidence,
        liquidity: position.liquidity,
        volume_5m: Number(buyCandidate.volume_5m || 0),
        size_pct: 100,
        notional_usd: Number((buyAmountSol * 160).toFixed(2)),
        execution_mode: doctorRuntime.execution.mode,
        tx_hash: buyExecution.txHash,
        timestamp: nowIso(),
      });

      doctorRuntime.decisionJournal.unshift({
        token: position.symbol,
        address: position.address,
        decision: "buy",
        reason: position.source === "apify" ? "apify_early_launch_signal" : "scanner_signal",
        confidence: position.confidence,
        size_pct: 100,
        strategy_mode: "autonomous",
        timestamp: nowIso(),
      });

      doctorRuntime.lastDecision = {
        action: "buy",
        reason: position.source === "apify" ? "apify_early_launch_signal" : "scanner_signal",
        trigger,
        at: nowIso(),
        token: position.symbol,
        mint: position.address,
        confidence: Number(position.confidence || 0),
        ai_validation: aiValidation,
      };
      }
      }
    } else {
      doctorRuntime.lastDecision = { action: "skip", reason: guard.reason, trigger, at: nowIso() };
    }

    if (sellCount > 0) {
      doctorRuntime.lastDecision = {
        action: "sell",
        reason: "position_exit_rule_triggered",
        trigger,
        at: nowIso(),
        count: sellCount,
      };
    }

    doctorRuntime.recentTrades = doctorRuntime.recentTrades.slice(0, 50);
    doctorRuntime.decisionJournal = doctorRuntime.decisionJournal.slice(0, 80);
    doctorRuntime.performance.unshift({
      cycle: doctorRuntime.performance.length + 1,
      latest_win_rate: 0.65,
      weighted_trade_mass: Number((buyAmountSol * 100).toFixed(2)),
      pnl_per_trade_usd: 0,
      trigger,
      buys: buyCount,
      sells: sellCount,
      updated_at: nowIso(),
    });
    doctorRuntime.performance = doctorRuntime.performance.slice(0, 40);
    doctorRuntime.lastError = null;

    await persistDoctorRuntime();

    if (!buyCount && !sellCount) {
      return { executed: false, reason: "no_eligible_action", trigger, buys: 0, sells: 0 };
    }

    return { executed: true, trigger, buys: buyCount, sells: sellCount };
  };

  const buildDoctorStatus = async () => {
    const activeTokens = await getDoctorActiveTokens();
    const { dailyRealizedPnlUsd, consecutiveLosses } = computeDoctorRiskMetrics();

    const paused = doctorRuntime.killSwitch;
    const safetyPaused = paused || !doctorRuntime.enabled;

    return {
      enabled: doctorRuntime.enabled,
      kill_switch: doctorRuntime.killSwitch,
      scan_interval_seconds: doctorRuntime.scanIntervalSeconds,
      last_run_at: doctorRuntime.lastRunAt,
      last_error: doctorRuntime.lastError,
      risk_state: {
        drawdown_pct: 0,
        daily_realized_pnl_usd: dailyRealizedPnlUsd,
        high_watermark_usd: 0,
        open_positions: doctorRuntime.positions.length,
        open_exposure_pct: 0,
        consecutive_losses: consecutiveLosses,
        paused,
        permanent_lock: false,
        pause_reason: paused
          ? "kill_switch_enabled"
          : (dailyRealizedPnlUsd <= -Math.abs(Number(doctorRuntime.controls.daily_loss_limit_usd || 0))
            ? "daily_loss_limit_reached"
            : (consecutiveLosses >= Math.max(1, Number(doctorRuntime.controls.max_consecutive_losses || 1))
              ? "max_consecutive_losses_reached"
              : null)),
      },
      wallet: {
        address: doctorRuntime.wallet.address,
        balance_sol: doctorRuntime.wallet.balanceSol,
        separate_wallet_enforced: doctorRuntime.wallet.separateWalletEnforced,
      },
      trade_controls: {
        ...doctorRuntime.controls,
        wallet_connected: Boolean(doctorRuntime.wallet.address),
      },
      execution: {
        mode: doctorRuntime.execution.mode,
        live_capable:
          String(process.env.DOCTORTRADE_LIVE_TRADING_ENABLED || "").toLowerCase() === "true" &&
          Boolean(String(process.env.DOCTORTRADE_LIVE_WALLET_PUBLIC_KEY || "").trim()) &&
          Boolean(String(process.env.DOCTORTRADE_LIVE_WALLET_PRIVATE_KEY || "").trim()),
        raydium_route_enabled: true,
        jupiter_quote_enabled: true,
        base_asset_mint: getDoctorTradeBaseAssetMint(),
        bonk_mint: BONK_MINT,
        helius_rpc_url: getHeliusRpcUrl(),
      },
      active_tokens: activeTokens,
      positions: doctorRuntime.positions.slice(0, 30),
      recent_trades: doctorRuntime.recentTrades.slice(0, 40),
      decision_journal: doctorRuntime.decisionJournal.slice(0, 60),
      performance: doctorRuntime.performance.slice(0, 30),
      execution_audit: doctorRuntime.executionAudit.slice(0, 80),
      last_decision: doctorRuntime.lastDecision,
      tuning_suggestion: activeTokens.length < 5 ? "Lower minimum liquidity or widen scanner scope to increase candidates." : null,
      strategy_mode: "balanced",
      safety: {
        api_error_count: doctorRuntime.lastError ? 1 : 0,
        paused: safetyPaused,
        pause_reason: safetyPaused ? (doctorRuntime.killSwitch ? "kill_switch_enabled" : "doctortrade_disabled") : null,
      },
      self_evolution: {
        cycles: doctorRuntime.performance.length,
        last_updated_at: doctorRuntime.lastRunAt,
      },
      fresh_feed: {
        last_cycle_at: doctorRuntime.lastRunAt,
        detected: activeTokens.length,
        enriched: activeTokens.length,
        approved: activeTokens.length,
        rejected: 0,
      },
      scanner_health: {
        overall: {
          calls: Math.max(1, doctorRuntime.performance.length),
          success: Math.max(1, doctorRuntime.performance.length),
          errors: doctorRuntime.lastError ? 1 : 0,
          success_rate_pct: doctorRuntime.lastError ? 75 : 100,
        },
      },
    };
  };

  app.get("/api/doctor/health", async (_req, res) => {
    return res.json({
      ok: true,
      service: "doctortrade-local",
      version: "1.0.0",
      features: {
        local_fallback: true,
        direct_buy: true,
        autonomous_mode: true,
      },
    });
  });

  app.get("/api/doctor/status", async (_req, res) => {
    return res.json(await buildDoctorStatus());
  });

  app.post("/api/doctor/control", async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    doctorRuntime.enabled = enabled && !doctorRuntime.killSwitch;
    if (enabled && doctorRuntime.killSwitch) {
      doctorRuntime.lastError = "Cannot enable while kill switch is active";
    }
    await persistDoctorRuntime();

    if (doctorCycleTimer) {
      clearInterval(doctorCycleTimer);
      doctorCycleTimer = null;
    }
    if (doctorRuntime.enabled) {
      if (!doctorCycleRunning) {
        doctorCycleRunning = true;
        try {
          await executeDoctorCycle("auto");
        } finally {
          doctorCycleRunning = false;
        }
      }

      doctorCycleTimer = setInterval(async () => {
        if (doctorCycleRunning) return;
        doctorCycleRunning = true;
        try {
          await executeDoctorCycle("auto");
        } finally {
          doctorCycleRunning = false;
        }
      }, Math.max(5, doctorRuntime.scanIntervalSeconds) * 1000);
      doctorCycleTimer.unref?.();
    }

    return res.json(await buildDoctorStatus());
  });

  app.post("/api/doctor/config", async (req, res) => {
    const payload = req.body || {};
    if (typeof payload.execution_mode === "string") {
      const mode = String(payload.execution_mode || "").toLowerCase();
      doctorRuntime.execution.mode = mode === "live" ? "live" : "paper";
    }
    if (typeof payload.kill_switch === "boolean") {
      doctorRuntime.killSwitch = payload.kill_switch;
      if (doctorRuntime.killSwitch) {
        doctorRuntime.enabled = false;
      }
    }
    if (Number.isFinite(Number(payload.scan_interval_seconds))) {
      doctorRuntime.scanIntervalSeconds = Math.max(5, Math.trunc(Number(payload.scan_interval_seconds)));
    }

    const numericKeys = [
      "buy_amount_sol",
      "max_trades_per_day",
      "take_profit_multiplier",
      "min_profit_pct",
      "max_open_positions",
      "strategy_window_minutes",
      "ai_min_signals_required",
      "cooldown_minutes_per_mint",
      "min_wallet_fee_buffer_sol",
      "live_sell_fraction_pct",
      "max_sell_notional_usd",
      "stop_loss_pct",
      "trailing_stop_pct",
      "min_liquidity_usd",
      "min_market_cap_usd",
      "min_volume_24h_usd",
      "min_token_age_minutes",
      "max_slippage_pct",
      "max_spread_pct",
      "daily_loss_limit_usd",
      "max_consecutive_losses",
      "strong_move_threshold_pct",
      "max_hold_minutes",
      "min_momentum_profit_pct",
      "quality_min_volume_spike_pct",
      "quality_max_top_holder_pct",
    ] as const;

    for (const key of numericKeys) {
      if (Number.isFinite(Number(payload[key]))) {
        (doctorRuntime.controls as any)[key] = Number(payload[key]);
      }
    }

    doctorRuntime.controls.min_buy_amount_sol = Math.max(0.05, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    await persistDoctorRuntime();

    if (doctorCycleTimer) {
      clearInterval(doctorCycleTimer);
      doctorCycleTimer = null;
    }
    if (doctorRuntime.enabled) {
      doctorCycleTimer = setInterval(async () => {
        if (doctorCycleRunning) return;
        doctorCycleRunning = true;
        try {
          await executeDoctorCycle("auto");
        } finally {
          doctorCycleRunning = false;
        }
      }, Math.max(5, doctorRuntime.scanIntervalSeconds) * 1000);
      doctorCycleTimer.unref?.();
    }

    return res.json(await buildDoctorStatus());
  });

  app.post("/api/doctor/connect-wallet", async (req, res) => {
    const payload = req.body || {};
    const explicitAddress = String(payload.public_address || "").trim();
    const useExistingWallet = Boolean(payload.use_existing_wallet);

    if (explicitAddress) {
      doctorRuntime.wallet.address = explicitAddress;
    } else if (useExistingWallet && !doctorRuntime.wallet.address) {
      doctorRuntime.wallet.address = "sim-wallet-local";
    }

    doctorRuntime.wallet.balanceSol = Math.max(doctorRuntime.wallet.balanceSol, 1.25);
    await persistDoctorRuntime();
    return res.json(await buildDoctorStatus());
  });

  app.post("/api/doctor/disconnect-wallet", async (_req, res) => {
    doctorRuntime.wallet.address = "";
    await persistDoctorRuntime();
    return res.json(await buildDoctorStatus());
  });

  app.post("/api/doctor/run-once", async (_req, res) => {
    const result = await executeDoctorCycle("manual");
    return res.json({ result });
  });

  app.post("/api/doctor/direct-buy", async (req, res) => {
    const contractAddress = String(req.body?.contract_address || req.body?.address || "").trim();
    if (!contractAddress) {
      return res.status(400).json({ result: { executed: false, reason: "contract_address_required" } });
    }
    if (!doctorRuntime.wallet.address) {
      return res.json({ result: { executed: false, reason: "wallet_not_connected" } });
    }

    const buyAmount = Number(doctorRuntime.controls.buy_amount_sol || 0.1);
    const signature = `paper_buy_${Date.now()}`;
    const now = new Date().toISOString();

    doctorRuntime.controls.trades_today = Number(doctorRuntime.controls.trades_today || 0) + 1;
    doctorRuntime.recentTrades.unshift({
      token: String(req.body?.symbol || "MANUAL"),
      address: contractAddress,
      action: "BUY",
      status: "EXECUTED",
      reason: "manual_direct_buy",
      confidence: 70,
      liquidity: 0,
      volume_5m: 0,
      size_pct: 100,
      notional_usd: Number((buyAmount * 160).toFixed(2)),
      timestamp: now,
    });
    doctorRuntime.decisionJournal.unshift({
      token: String(req.body?.symbol || "MANUAL"),
      address: contractAddress,
      decision: "buy",
      reason: "manual_direct_buy",
      confidence: 70,
      size_pct: 100,
      strategy_mode: "manual",
      timestamp: now,
    });
    doctorRuntime.recentTrades = doctorRuntime.recentTrades.slice(0, 50);
    doctorRuntime.decisionJournal = doctorRuntime.decisionJournal.slice(0, 80);
    await persistDoctorRuntime();

    return res.json({
      result: {
        executed: true,
        signature,
        buy_amount_sol: buyAmount,
      },
    });
  });

  if (doctorRuntime.enabled) {
    if (!doctorCycleRunning) {
      doctorCycleRunning = true;
      executeDoctorCycle("auto")
        .catch(() => undefined)
        .finally(() => {
          doctorCycleRunning = false;
        });
    }

    doctorCycleTimer = setInterval(async () => {
      if (doctorCycleRunning) return;
      doctorCycleRunning = true;
      try {
        await executeDoctorCycle("auto");
      } finally {
        doctorCycleRunning = false;
      }
    }, Math.max(5, doctorRuntime.scanIntervalSeconds) * 1000);
    doctorCycleTimer.unref?.();
  }

  const assistantChains = ["solana"] as const;
  type AssistantChain = (typeof assistantChains)[number];
  const assistantDefaultRiskLimits = {
    max_notional_usd_per_trade: 100,
    max_trades_per_day: 12,
    max_daily_loss_usd: 300,
  };

  const assistantRuntime = {
    wallet: {
      has_wallet: false,
      backup_confirmed: false,
      backup_confirmed_at: null as string | null,
      created_at: null as string | null,
      addresses_by_chain: {} as Record<string, string>,
      enabled_chains: [...assistantChains] as string[],
      mnemonic: "",
      private_keys_by_chain: {} as Record<string, string>,
    },
    trading: {
      enabled: false,
      pending_approval: false,
      consent_id: null as string | null,
      consent_expires_at: null as string | null,
      approved_at: null as string | null,
      mode: "paper" as "paper" | "live",
      wallet_address: null as string | null,
      wallets_by_chain: {} as Record<string, string>,
      enabled_chains: [...assistantChains] as string[],
      risk_limits: { ...assistantDefaultRiskLimits },
      last_revoked_at: null as string | null,
    },
    transactions: [] as Array<Record<string, any>>,
  };

  const assistantStateKey = "assistant.runtime.v1";

  const resetAssistantRuntime = () => {
    assistantRuntime.wallet.has_wallet = false;
    assistantRuntime.wallet.backup_confirmed = false;
    assistantRuntime.wallet.backup_confirmed_at = null;
    assistantRuntime.wallet.created_at = null;
    assistantRuntime.wallet.addresses_by_chain = {};
    assistantRuntime.wallet.enabled_chains = [...assistantChains];
    assistantRuntime.wallet.mnemonic = "";
    assistantRuntime.wallet.private_keys_by_chain = {};

    assistantRuntime.trading.enabled = false;
    assistantRuntime.trading.pending_approval = false;
    assistantRuntime.trading.consent_id = null;
    assistantRuntime.trading.consent_expires_at = null;
    assistantRuntime.trading.approved_at = null;
    assistantRuntime.trading.mode = "paper";
    assistantRuntime.trading.wallet_address = null;
    assistantRuntime.trading.wallets_by_chain = {};
    assistantRuntime.trading.enabled_chains = [...assistantChains];
    assistantRuntime.trading.risk_limits = { ...assistantDefaultRiskLimits };
    assistantRuntime.trading.last_revoked_at = null;

    assistantRuntime.transactions = [];
  };

  const persistAssistantRuntime = async () => {
    try {
      await storage.setAppState(assistantStateKey, assistantRuntime);
    } catch {
    }
  };

  const loadAssistantRuntime = async () => {
    try {
      const loaded = await storage.getAppState<Record<string, any>>(assistantStateKey);
      if (!loaded || typeof loaded !== "object") {
        return;
      }

      const wallet = loaded.wallet as Record<string, any> | undefined;
      if (wallet && typeof wallet === "object") {
        assistantRuntime.wallet.has_wallet = Boolean(wallet.has_wallet);
        assistantRuntime.wallet.backup_confirmed = Boolean(wallet.backup_confirmed);
        assistantRuntime.wallet.backup_confirmed_at = typeof wallet.backup_confirmed_at === "string" ? wallet.backup_confirmed_at : null;
        assistantRuntime.wallet.created_at = typeof wallet.created_at === "string" ? wallet.created_at : null;
        assistantRuntime.wallet.addresses_by_chain =
          wallet.addresses_by_chain && typeof wallet.addresses_by_chain === "object"
            ? wallet.addresses_by_chain as Record<string, string>
            : {};
        assistantRuntime.wallet.enabled_chains = ["solana"];
        assistantRuntime.wallet.mnemonic = typeof wallet.mnemonic === "string" ? wallet.mnemonic : "";
        assistantRuntime.wallet.private_keys_by_chain =
          wallet.private_keys_by_chain && typeof wallet.private_keys_by_chain === "object"
            ? wallet.private_keys_by_chain as Record<string, string>
            : {};

        assistantRuntime.wallet.addresses_by_chain = {
          solana: String(assistantRuntime.wallet.addresses_by_chain.solana || "").trim(),
        };
        assistantRuntime.wallet.private_keys_by_chain = {
          solana: String(assistantRuntime.wallet.private_keys_by_chain.solana || "").trim(),
        };
      }

      const trading = loaded.trading as Record<string, any> | undefined;
      if (trading && typeof trading === "object") {
        assistantRuntime.trading.enabled = Boolean(trading.enabled);
        assistantRuntime.trading.pending_approval = Boolean(trading.pending_approval);
        assistantRuntime.trading.consent_id = typeof trading.consent_id === "string" ? trading.consent_id : null;
        assistantRuntime.trading.consent_expires_at = typeof trading.consent_expires_at === "string" ? trading.consent_expires_at : null;
        assistantRuntime.trading.approved_at = typeof trading.approved_at === "string" ? trading.approved_at : null;
        assistantRuntime.trading.mode = String(trading.mode || "paper").toLowerCase() === "live" ? "live" : "paper";
        assistantRuntime.trading.wallet_address = typeof trading.wallet_address === "string" ? trading.wallet_address : null;
        assistantRuntime.trading.wallets_by_chain =
          trading.wallets_by_chain && typeof trading.wallets_by_chain === "object"
            ? trading.wallets_by_chain as Record<string, string>
            : {};
        assistantRuntime.trading.enabled_chains = ["solana"];
        const riskLimits = trading.risk_limits as Record<string, any> | undefined;
        assistantRuntime.trading.risk_limits = {
          max_notional_usd_per_trade: Number(riskLimits?.max_notional_usd_per_trade || assistantDefaultRiskLimits.max_notional_usd_per_trade),
          max_trades_per_day: Number(riskLimits?.max_trades_per_day || assistantDefaultRiskLimits.max_trades_per_day),
          max_daily_loss_usd: Number(riskLimits?.max_daily_loss_usd || assistantDefaultRiskLimits.max_daily_loss_usd),
        };
        assistantRuntime.trading.last_revoked_at = typeof trading.last_revoked_at === "string" ? trading.last_revoked_at : null;
      }

      if (Array.isArray(loaded.transactions)) {
        assistantRuntime.transactions = loaded.transactions.slice(0, 200);
      }

      assistantRuntime.trading.wallets_by_chain = {
        solana: String(assistantRuntime.wallet.addresses_by_chain.solana || "").trim(),
      };
      assistantRuntime.trading.wallet_address = assistantRuntime.wallet.addresses_by_chain.solana || null;
    } catch {
    }
  };

  const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
  const normalizeMnemonic = (value: string) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const generateMnemonic = () => bip39.generateMnemonic(128);
  const nowIso = () => new Date().toISOString();
  const chainNativeSymbol = (_chain: AssistantChain) => "SOL";

  const chainExplorerTxUrl = (_chain: AssistantChain, txHash: string) => `https://explorer.solana.com/tx/${txHash}`;

  const deriveSolanaWalletFromMnemonic = (mnemonic: string) => {
    const normalized = normalizeMnemonic(mnemonic);
    if (!bip39.validateMnemonic(normalized)) {
      throw new Error("invalid mnemonic");
    }
    const seed = bip39.mnemonicToSeedSync(normalized);
    const derived = derivePath(SOLANA_DERIVATION_PATH, seed.toString("hex"));
    const keypair = Keypair.fromSeed(derived.key.slice(0, 32));
    return {
      address: keypair.publicKey.toBase58(),
      privateKey: bs58Codec.encode(keypair.secretKey),
      mnemonic: normalized,
    };
  };

  const buildAssistantWalletFromMnemonic = (mnemonicInput: string) => {
    const solanaWallet = deriveSolanaWalletFromMnemonic(mnemonicInput);
    const addresses_by_chain = { solana: solanaWallet.address };
    const private_keys_by_chain = { solana: solanaWallet.privateKey };
    return {
      mnemonic: solanaWallet.mnemonic,
      addresses_by_chain,
      private_keys_by_chain,
    };
  };

  const validateAddressForChain = (chain: string, address: string) => {
    const value = String(address || "").trim();
    if (!value) return false;
    if (chain !== "solana") return false;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  };

  const defaultRpcUrls: Record<AssistantChain, string> = {
    solana: "https://api.mainnet-beta.solana.com",
  };

  const getRpcUrlForChain = (chain: AssistantChain) => {
    const envMap: Record<AssistantChain, string> = {
      solana: String(process.env.SOLANA_RPC_URL || process.env.HELIUS_RPC_URL || "").trim(),
    };
    return envMap[chain] || defaultRpcUrls[chain];
  };

  await loadAssistantRuntime();

  let priceCache: { ts: number; data: Record<AssistantChain, number> } | null = null;
  const fetchChainPricesUsd = async (): Promise<Record<AssistantChain, number>> => {
    if (priceCache && Date.now() - priceCache.ts < 60_000) {
      return priceCache.data;
    }

    const empty: Record<AssistantChain, number> = {
      solana: 0,
    };

    const withTimeout = async (url: string, timeoutMs = 8000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: { "Accept": "application/json", "User-Agent": "TradeAid/1.0" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`http_${response.status}`);
        }
        return response;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      const [geckoRes, compareRes] = await Promise.allSettled([
        withTimeout("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"),
        withTimeout("https://min-api.cryptocompare.com/data/pricemulti?fsyms=SOL&tsyms=USD"),
      ]);

      let geckoPayload: Record<string, { usd?: number }> = {};
      if (geckoRes.status === "fulfilled") {
        geckoPayload = (await geckoRes.value.json()) as Record<string, { usd?: number }>;
      }

      let comparePayload: Record<string, { USD?: number }> = {};
      if (compareRes.status === "fulfilled") {
        comparePayload = (await compareRes.value.json()) as Record<string, { USD?: number }>;
      }

      const pick = (...values: unknown[]) => {
        for (const value of values) {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
          }
        }
        return 0;
      };

      const prices: Record<AssistantChain, number> = {
        solana: pick(geckoPayload?.solana?.usd, comparePayload?.SOL?.USD),
      };

      const hasAnyLivePrice = Object.values(prices).some((value) => value > 0);
      if (hasAnyLivePrice) {
        priceCache = { ts: Date.now(), data: prices };
        return prices;
      }

      if (priceCache) {
        return priceCache.data;
      }
      return empty;
    } catch {
      if (priceCache) {
        return priceCache.data;
      }
      return empty;
    }
  };

  const fetchNativeBalance = async (chain: AssistantChain, address: string): Promise<number | null> => {
    if (!validateAddressForChain(chain, address)) {
      return null;
    }

    const rpcUrl = getRpcUrlForChain(chain);
    if (!rpcUrl) {
      return null;
    }

    try {
      if (chain !== "solana") {
        return null;
      }

      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
      });
      const payload = (await response.json()) as { result?: { value?: number } };
      const lamports = Number(payload?.result?.value || 0);
      return Number((lamports / 1_000_000_000).toFixed(9));
    } catch {
      return null;
    }
  };

  const ensureWalletExists = () => assistantRuntime.wallet.has_wallet && Object.values(assistantRuntime.wallet.addresses_by_chain).some(Boolean);

  const assistantWalletStatus = () => ({
    has_wallet: assistantRuntime.wallet.has_wallet,
    backup_confirmed: assistantRuntime.wallet.backup_confirmed,
    backup_confirmed_at: assistantRuntime.wallet.backup_confirmed_at,
    created_at: assistantRuntime.wallet.created_at,
    addresses_by_chain: assistantRuntime.wallet.addresses_by_chain,
    enabled_chains: assistantRuntime.wallet.enabled_chains,
  });

  const assistantTradingStatus = () => ({
    ...assistantRuntime.trading,
    wallets_by_chain: assistantRuntime.wallet.addresses_by_chain,
    wallet_address: assistantRuntime.wallet.addresses_by_chain.solana || null,
  });

  const assistantBundle = (includePrivate = true) => ({
    mnemonic: assistantRuntime.wallet.mnemonic,
    addresses_by_chain: assistantRuntime.wallet.addresses_by_chain,
    private_keys_by_chain: includePrivate ? assistantRuntime.wallet.private_keys_by_chain : undefined,
    warning: "Never share your recovery phrase or private keys. Store offline.",
    reveal_confirmation_phrase: "I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS",
  });

  app.get("/api/ai/wallets/status", (_req, res) => {
    return res.json({ wallet: assistantWalletStatus() });
  });

  app.get("/api/ai/trading/status", (_req, res) => {
    return res.json({ trading: assistantTradingStatus() });
  });

  app.get("/api/ai/wallets/portfolio", async (_req, res) => {
    const prices = await fetchChainPricesUsd();
    const entries = await Promise.all(
      assistantChains.map(async (chain) => {
        const address = assistantRuntime.wallet.addresses_by_chain[chain] || "";
        const native_symbol = chainNativeSymbol(chain);
        const price_usd = Number(prices[chain] || 0);

        if (!address) {
          return [
            chain,
            {
              address,
              native_symbol,
              native_balance: null,
              price_usd,
              value_usd: 0,
              data_status: "not_configured",
            },
          ] as const;
        }

        if (!validateAddressForChain(chain, address)) {
          return [
            chain,
            {
              address,
              native_symbol,
              native_balance: null,
              price_usd,
              value_usd: 0,
              data_status: "invalid_address",
            },
          ] as const;
        }

        const balance = await fetchNativeBalance(chain, address);
        if (balance === null) {
          return [
            chain,
            {
              address,
              native_symbol,
              native_balance: null,
              price_usd,
              value_usd: 0,
              data_status: "rpc_not_configured",
            },
          ] as const;
        }

        const valueUsd = Number((balance * price_usd).toFixed(2));
        return [
          chain,
          {
            address,
            native_symbol,
            native_balance: Number(balance.toFixed(8)),
            price_usd,
            value_usd: valueUsd,
            data_status: "ok",
          },
        ] as const;
      }),
    );

    const chains = Object.fromEntries(entries);
    const total_usd = Object.values(chains).reduce((sum: number, item: any) => sum + Number(item.value_usd || 0), 0);
    return res.json({
      wallet: assistantWalletStatus(),
      portfolio: {
        chains,
        total_usd: Number(total_usd.toFixed(2)),
        updated_at: nowIso(),
      },
    });
  });

  app.get("/api/ai/wallets/transactions", (req, res) => {
    const limitRaw = Number(req.query.limit || 25);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 25;
    const transactions = assistantRuntime.transactions.slice(0, limit);
    return res.json({ transactions, count: transactions.length });
  });

  app.post("/api/ai/wallets/create", async (req, res) => {
    const overwrite = Boolean(req.body?.overwrite);
    if (assistantRuntime.wallet.has_wallet && !overwrite) {
      return res.status(400).json({ message: "wallet already exists" });
    }

    const mnemonic = generateMnemonic();
    const walletBundle = buildAssistantWalletFromMnemonic(mnemonic);

    assistantRuntime.wallet.has_wallet = true;
    assistantRuntime.wallet.backup_confirmed = false;
    assistantRuntime.wallet.backup_confirmed_at = null;
    assistantRuntime.wallet.created_at = nowIso();
    assistantRuntime.wallet.addresses_by_chain = walletBundle.addresses_by_chain;
    assistantRuntime.wallet.private_keys_by_chain = walletBundle.private_keys_by_chain;
    assistantRuntime.wallet.mnemonic = walletBundle.mnemonic;
    assistantRuntime.trading.wallets_by_chain = walletBundle.addresses_by_chain;
    assistantRuntime.trading.wallet_address = walletBundle.addresses_by_chain.solana || null;

    await persistAssistantRuntime();

    return res.json({ wallet: assistantWalletStatus(), bundle: assistantBundle(true) });
  });

  app.post("/api/ai/wallets/import", async (req, res) => {
    const mnemonic = normalizeMnemonic(String(req.body?.mnemonic || ""));
    const overwrite = Boolean(req.body?.overwrite);
    if (!mnemonic) {
      return res.status(400).json({ message: "mnemonic required" });
    }
    if (!bip39.validateMnemonic(mnemonic)) {
      return res.status(400).json({ message: "invalid mnemonic" });
    }
    if (assistantRuntime.wallet.has_wallet && !overwrite) {
      return res.status(400).json({ message: "wallet already exists" });
    }

    let walletBundle: ReturnType<typeof buildAssistantWalletFromMnemonic>;
    try {
      walletBundle = buildAssistantWalletFromMnemonic(mnemonic);
    } catch {
      return res.status(400).json({ message: "invalid mnemonic" });
    }

    assistantRuntime.wallet.has_wallet = true;
    assistantRuntime.wallet.backup_confirmed = false;
    assistantRuntime.wallet.backup_confirmed_at = null;
    assistantRuntime.wallet.created_at = nowIso();
    assistantRuntime.wallet.addresses_by_chain = walletBundle.addresses_by_chain;
    assistantRuntime.wallet.private_keys_by_chain = walletBundle.private_keys_by_chain;
    assistantRuntime.wallet.mnemonic = walletBundle.mnemonic;
    assistantRuntime.trading.wallets_by_chain = walletBundle.addresses_by_chain;
    assistantRuntime.trading.wallet_address = walletBundle.addresses_by_chain.solana || null;

    await persistAssistantRuntime();

    return res.json({ wallet: assistantWalletStatus(), bundle: assistantBundle(true) });
  });

  app.post("/api/ai/wallets/confirm-backup", async (req, res) => {
    const mnemonic = String(req.body?.mnemonic || "").trim();
    if (!ensureWalletExists()) {
      return res.status(400).json({ message: "wallet not found" });
    }
    if (!mnemonic || mnemonic !== assistantRuntime.wallet.mnemonic) {
      return res.status(400).json({ message: "mnemonic mismatch" });
    }
    assistantRuntime.wallet.backup_confirmed = true;
    assistantRuntime.wallet.backup_confirmed_at = nowIso();
    await persistAssistantRuntime();
    return res.json({ wallet: assistantWalletStatus() });
  });

  app.post("/api/ai/wallets/delete", async (_req, res) => {
    resetAssistantRuntime();
    await persistAssistantRuntime();
    return res.json({
      ok: true,
      wallet: assistantWalletStatus(),
      trading: assistantTradingStatus(),
      message: "wallet deleted",
    });
  });

  app.post("/api/ai/wallets/reveal", (req, res) => {
    const confirmation = String(req.body?.confirmation_text || "").trim();
    if (confirmation !== "I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS") {
      return res.status(400).json({ message: "invalid confirmation text" });
    }
    if (!ensureWalletExists()) {
      return res.status(400).json({ message: "wallet not found" });
    }
    return res.json({ wallet: assistantWalletStatus(), bundle: assistantBundle(true) });
  });

  app.post("/api/ai/wallets/remove-chain", async (req, res) => {
    const chain = String(req.body?.chain || "").toLowerCase();
    if (!assistantChains.includes(chain as AssistantChain)) {
      return res.status(400).json({ message: "unsupported chain" });
    }
    if (chain === "solana") {
      return res.status(400).json({ message: "solana cannot be removed" });
    }
    delete assistantRuntime.wallet.addresses_by_chain[chain];
    delete assistantRuntime.wallet.private_keys_by_chain[chain];
    assistantRuntime.trading.wallets_by_chain = assistantRuntime.wallet.addresses_by_chain;
    assistantRuntime.trading.wallet_address = assistantRuntime.wallet.addresses_by_chain.solana || null;
    await persistAssistantRuntime();
    return res.json({ wallet: assistantWalletStatus(), trading: assistantTradingStatus() });
  });

  app.post("/api/ai/wallets/export-key", (req, res) => {
    const chain = String(req.body?.chain || "").toLowerCase();
    const confirmation = String(req.body?.confirmation_text || "").trim();
    if (chain !== "solana") {
      return res.status(400).json({ message: "unsupported chain" });
    }
    if (confirmation !== "I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS") {
      return res.status(400).json({ message: "invalid confirmation text" });
    }
    const address = assistantRuntime.wallet.addresses_by_chain[chain];
    const privateKey = assistantRuntime.wallet.private_keys_by_chain[chain];
    if (!address || !privateKey) {
      return res.status(404).json({ message: "wallet key not found for chain" });
    }
    return res.json({
      wallet_key: {
        chain,
        address,
        private_key: privateKey,
        warning: "Never share your private key.",
      },
    });
  });

  app.post("/api/ai/wallets/transfer", async (req, res) => {
    const chain = String(req.body?.chain || "solana").toLowerCase();
    const recipient = String(req.body?.recipient_address || "").trim();
    const amount = Number(req.body?.amount || 0);
    const asset = String(req.body?.asset || chainNativeSymbol((chain as AssistantChain) || "solana")).toUpperCase();
    if (!ensureWalletExists()) {
      return res.status(400).json({ message: "wallet not found" });
    }
    if (chain !== "solana") {
      return res.status(400).json({ message: "unsupported chain" });
    }
    if (!recipient || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "invalid transfer payload" });
    }
    if (!validateAddressForChain(chain, recipient)) {
      return res.status(400).json({ message: "recipient address does not match selected chain" });
    }

    const senderAddress = assistantRuntime.wallet.addresses_by_chain[chain] || "";
    if (!senderAddress || !validateAddressForChain(chain, senderAddress)) {
      return res.status(400).json({ message: "wallet address invalid for selected chain" });
    }

    const nativeSymbol = chainNativeSymbol(chain as AssistantChain);
    if (asset !== nativeSymbol) {
      return res.status(400).json({ message: `unsupported asset for ${chain}. use ${nativeSymbol}` });
    }

    const balance = await fetchNativeBalance(chain as AssistantChain, senderAddress);
    if (balance === null) {
      return res.status(503).json({ message: `unable to fetch ${chain} balance from rpc` });
    }
    if (amount > balance) {
      return res.status(400).json({ message: `insufficient ${nativeSymbol} balance`, available_balance: balance });
    }

    const senderPrivateKey = String(assistantRuntime.wallet.private_keys_by_chain.solana || "").trim();
    if (!senderPrivateKey) {
      return res.status(400).json({ message: "solana private key is missing for wallet" });
    }

    const secretKey = parseSolanaSecretKey(senderPrivateKey);
    if (!secretKey) {
      return res.status(400).json({ message: "stored solana private key is invalid" });
    }

    const keypair = Keypair.fromSecretKey(secretKey);
    if (keypair.publicKey.toBase58() !== senderAddress) {
      return res.status(400).json({ message: "wallet address/private key mismatch" });
    }

    const rpcUrl = getRpcUrlForChain("solana");
    const connection = new Connection(rpcUrl, "confirmed");
    const lamports = Math.max(1, Math.trunc(amount * 1_000_000_000));

    let txHash = "";
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const transferTx = new Transaction({
        feePayer: keypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(recipient),
          lamports,
        }),
      );

      transferTx.sign(keypair);
      txHash = await connection.sendRawTransaction(transferTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction(
        {
          signature: txHash,
          blockhash,
          lastValidBlockHeight,
        },
        "confirmed",
      );
    } catch (error) {
      return res.status(502).json({
        message: error instanceof Error ? error.message : "solana transfer failed",
      });
    }

    const prices = await fetchChainPricesUsd();
    const chainPrice = Number(prices[chain as AssistantChain] || 0);
    const transaction = {
      id: `transfer_${Date.now()}`,
      chain,
      side: "transfer",
      status: "confirmed",
      contract_address: asset,
      notional_usd: Number((amount * chainPrice).toFixed(2)),
      quantity: amount,
      asset,
      tx_hash: txHash,
      explorer_url: chainExplorerTxUrl(chain as AssistantChain, txHash),
      from_address: senderAddress,
      to_address: recipient,
      created_at: nowIso(),
    };
    assistantRuntime.transactions.unshift(transaction);
    assistantRuntime.transactions = assistantRuntime.transactions.slice(0, 200);
    await persistAssistantRuntime();

    return res.json({
      transfer: {
        transaction_id: transaction.id,
        tx_hash: txHash,
        explorer_url: transaction.explorer_url,
        status: "confirmed",
      },
    });
  });

  app.post("/api/ai/trading/consent/request", async (req, res) => {
    const mode = String(req.body?.mode || "paper").toLowerCase() === "live" ? "live" : "paper";
    const consentId = `consent_${Date.now().toString(36)}`;
    assistantRuntime.trading.mode = mode;
    assistantRuntime.trading.pending_approval = true;
    assistantRuntime.trading.enabled = false;
    assistantRuntime.trading.consent_id = consentId;
    assistantRuntime.trading.consent_expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await persistAssistantRuntime();
    return res.json({
      consent_id: consentId,
      trading: assistantTradingStatus(),
    });
  });

  app.post("/api/ai/trading/consent/approve", async (req, res) => {
    const consentId = String(req.body?.consent_id || "").trim();
    const confirmation = String(req.body?.confirmation_text || "").trim();
    if (!consentId || consentId !== assistantRuntime.trading.consent_id) {
      return res.status(400).json({ message: "invalid consent id" });
    }
    if (confirmation !== "I_APPROVE_ASSISTANT_TRADING") {
      return res.status(400).json({ message: "invalid confirmation text" });
    }
    assistantRuntime.trading.pending_approval = false;
    assistantRuntime.trading.enabled = true;
    assistantRuntime.trading.approved_at = nowIso();
    await persistAssistantRuntime();
    return res.json({ trading: assistantTradingStatus() });
  });

  app.post("/api/ai/trading/consent/revoke", async (_req, res) => {
    assistantRuntime.trading.enabled = false;
    assistantRuntime.trading.pending_approval = false;
    assistantRuntime.trading.last_revoked_at = nowIso();
    await persistAssistantRuntime();
    return res.json({ trading: assistantTradingStatus() });
  });

  app.post("/api/ai/trading/execute", async (req, res) => {
    const chain = String(req.body?.chain || "solana").toLowerCase();
    const contractAddress = String(req.body?.contract_address || "").trim();
    const side = String(req.body?.side || "buy").toLowerCase() === "sell" ? "sell" : "buy";
    const notionalUsd = Number(req.body?.notional_usd || 0);
    const mode = String(req.body?.mode || assistantRuntime.trading.mode || "paper").toLowerCase() === "live" ? "live" : "paper";

    if (chain !== "solana") {
      return res.status(400).json({ message: "unsupported chain" });
    }

    if (!contractAddress || !Number.isFinite(notionalUsd) || notionalUsd <= 0) {
      return res.status(400).json({ message: "invalid trade payload" });
    }

    if (!validateAddressForChain("solana", contractAddress)) {
      return res.status(400).json({ message: "invalid solana token mint" });
    }

    if (!ensureWalletExists()) {
      return res.status(400).json({ message: "wallet not found" });
    }

    if (!assistantRuntime.trading.enabled) {
      return res.status(403).json({ message: "assistant trading is disabled" });
    }

    const walletAddress = String(assistantRuntime.wallet.addresses_by_chain.solana || "").trim();
    const walletPrivateKey = String(assistantRuntime.wallet.private_keys_by_chain.solana || "").trim();
    if (!walletAddress || !walletPrivateKey) {
      return res.status(400).json({ message: "assistant solana wallet is not fully configured" });
    }

    if (mode === "live") {
      const secretKey = parseSolanaSecretKey(walletPrivateKey);
      if (!secretKey) {
        return res.status(400).json({ message: "stored solana private key is invalid" });
      }

      const keypair = Keypair.fromSecretKey(secretKey);
      if (keypair.publicKey.toBase58() !== walletAddress) {
        return res.status(400).json({ message: "wallet address/private key mismatch" });
      }

      const prices = await fetchChainPricesUsd();
      const solPriceUsd = Number(prices.solana || 0);
      if (!(solPriceUsd > 0)) {
        return res.status(503).json({ message: "solana price unavailable" });
      }

      const connection = getSolanaConnection();
      const slippageBps = Math.max(25, Math.trunc(Number(doctorRuntime.controls.max_slippage_pct || 4) * 100));

      try {
        let quote: Record<string, any>;

        if (side === "buy") {
          const amountSol = Math.max(0.0001, notionalUsd / solPriceUsd);
          const amountLamports = Math.max(1, Math.trunc(amountSol * 1_000_000_000));
          quote = await fetchJupiterQuote({
            inputMint: SOL_MINT,
            outputMint: contractAddress,
            amountAtomic: amountLamports,
            slippageBps,
          });
        } else {
          const ownerPk = new PublicKey(walletAddress);
          const mintPk = new PublicKey(contractAddress);
          const accounts = await connection.getParsedTokenAccountsByOwner(ownerPk, { mint: mintPk }, "confirmed");
          const totalRaw = accounts.value.reduce((sum, entry) => {
            const amountRaw = String((entry.account.data as any)?.parsed?.info?.tokenAmount?.amount || "0");
            try {
              return sum + BigInt(amountRaw);
            } catch {
              return sum;
            }
          }, BigInt(0));

          if (totalRaw <= BigInt(0)) {
            return res.status(400).json({ message: "insufficient token balance for sell" });
          }

          const fullQuote = await fetchJupiterQuote({
            inputMint: contractAddress,
            outputMint: SOL_MINT,
            amountAtomic: totalRaw.toString(),
            slippageBps,
          });
          const fullOutLamports = Number(fullQuote?.outAmount || 0);
          const fullOutSol = fullOutLamports > 0 ? fullOutLamports / 1_000_000_000 : 0;
          const fullOutUsd = fullOutSol * solPriceUsd;
          const sellFraction = fullOutUsd > 0 ? Math.max(0.01, Math.min(1, notionalUsd / fullOutUsd)) : 1;
          const scaledFraction = BigInt(Math.max(1, Math.floor(sellFraction * 1_000_000)));
          const sellRaw = (totalRaw * scaledFraction) / BigInt(1_000_000);

          quote = await fetchJupiterQuote({
            inputMint: contractAddress,
            outputMint: SOL_MINT,
            amountAtomic: (sellRaw > BigInt(0) ? sellRaw : BigInt(1)).toString(),
            slippageBps,
          });
        }

        const swapPayload = await fetchJupiterSwapPayload({
          quoteResponse: quote,
          userPublicKey: walletAddress,
        });

        if (!swapPayload?.swapTransaction) {
          return res.status(502).json({ message: "swap payload missing transaction" });
        }

        const swapTxBytes = Buffer.from(String(swapPayload.swapTransaction), "base64");
        const versioned = VersionedTransaction.deserialize(swapTxBytes);
        versioned.sign([keypair]);

        const signature = await connection.sendRawTransaction(versioned.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        const latestBlockhash = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          "confirmed",
        );

        const transaction = {
          id: `trade_${Date.now()}`,
          chain: "solana",
          side,
          status: "executed",
          contract_address: contractAddress,
          notional_usd: Number(notionalUsd.toFixed(2)),
          quantity: null,
          asset: "TOKEN",
          tx_hash: signature,
          explorer_url: `https://explorer.solana.com/tx/${signature}`,
          from_address: walletAddress,
          to_address: contractAddress,
          created_at: nowIso(),
          mode,
        };
        assistantRuntime.transactions.unshift(transaction);
        assistantRuntime.transactions = assistantRuntime.transactions.slice(0, 200);
        await persistAssistantRuntime();

        return res.json({
          trade: {
            id: transaction.id,
            chain: "solana",
            mode,
            side,
            status: "executed",
            tx_hash: signature,
            explorer_url: transaction.explorer_url,
          },
        });
      } catch (error) {
        return res.status(502).json({
          message: error instanceof Error ? error.message : "live swap failed",
        });
      }
    }

    const txHash = `trade_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const transaction = {
      id: `trade_${Date.now()}`,
      chain: "solana",
      side,
      status: "executed",
      contract_address: contractAddress,
      notional_usd: Number(notionalUsd.toFixed(2)),
      quantity: null,
      asset: "TOKEN",
      tx_hash: txHash,
      explorer_url: `https://explorer.solana.com/tx/${txHash}`,
      from_address: assistantRuntime.wallet.addresses_by_chain[chain] || assistantRuntime.wallet.addresses_by_chain.solana || "",
      to_address: contractAddress,
      created_at: nowIso(),
      mode,
    };
    assistantRuntime.transactions.unshift(transaction);
    assistantRuntime.transactions = assistantRuntime.transactions.slice(0, 200);
    await persistAssistantRuntime();

    return res.json({
      trade: {
        id: transaction.id,
        chain,
        mode,
        side,
        status: "executed",
        tx_hash: txHash,
        explorer_url: transaction.explorer_url,
      },
    });
  });

  app.get("/api/ai/context/overview", (req, res) => {
    const daysRaw = Number(req.query.days || 30);
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, Math.trunc(daysRaw))) : 30;
    const recent = assistantRuntime.transactions.slice(0, 20);
    const totalNotional = recent.reduce((sum, item) => sum + Number(item.notional_usd || 0), 0);

    return res.json({
      user_id: "local-user",
      context: {
        window_days: days,
        summary: {
          total_trades: recent.length,
          total_notional_usd: Number(totalNotional.toFixed(2)),
          total_pnl_usd: 0,
          chain_count: Object.keys(assistantRuntime.wallet.addresses_by_chain).length,
        },
        chain_stats: {},
        recent_trades: recent.map((item) => ({
          id: String(item.id || ""),
          chain: String(item.chain || "solana"),
          contract_address: String(item.contract_address || ""),
          side: String(item.side || "buy"),
          mode: String(item.mode || assistantRuntime.trading.mode),
          status: String(item.status || "executed"),
          notional_usd: Number(item.notional_usd || 0),
          price_usd: null,
          fees_usd: 0,
          pnl_usd: 0,
          created_at: String(item.created_at || nowIso()),
        })),
        market_scores: {
          by_chain: {},
          samples: 0,
        },
        confidence_calibration: {
          global_bias: 0,
          lookback_trades: recent.length,
          by_chain: {},
        },
      },
    });
  });

  app.post("/api/ai/ask", (req, res) => {
    const question = String(req.body?.question || "").trim();
    return res.json({
      assistant: {
        answer: question ? `Assistant response: ${question}` : "Ask a specific trading question to get guidance.",
        key_points: [
          "Prefer low-rug, high-liquidity tokens",
          "Use strict risk limits before switching to live mode",
          "Review wallet backup and consent status regularly",
        ],
        source: "local-fallback",
      },
    });
  });

  app.post("/api/ai/assist", (_req, res) => {
    return res.json({
      assistant: {
        recommendation: "monitor",
        confidence: 62,
        rationale: "Moderate setup quality; wait for stronger momentum confirmation.",
      },
    });
  });

  app.post("/api/scoring/score-token", async (req, res) => {
    const body = req.body || {};
    const contractAddress = String(body.contract_address || body.address || body.token || "").trim();
    const chain = "solana";
    const useBridge = String(process.env.SCORE_TOKEN_USE_BRIDGE || "false").trim().toLowerCase() === "true";

    if (!contractAddress) {
      return res.status(200).json({ error: "Contract address required", eligible: false });
    }

    if (!useBridge) {
      return res.status(200).json(await buildDexScoreFallback(contractAddress, chain));
    }

    return proxyToPythonApi(req, res, "/api/scoring/score-token", async () =>
      buildDexScoreFallback(contractAddress, chain),
    );
  });

  // AI Scoring Insight Endpoint
  app.get("/api/scoring/insight/:chain/:contract_address", isAuthenticated, async (req, res) =>
    proxyToPythonApi(
      req,
      res,
      `/api/scoring/insight/${encodeURIComponent(req.params.chain)}/${encodeURIComponent(req.params.contract_address)}`,
      async () => {
        const score = await buildDexScoreFallback(req.params.contract_address, req.params.chain);
        const safeScores = score.scores || {
          rug_probability: 0,
          trade_confidence_index: 0,
        };
        const safeLiquidity = Number(score.market_data?.liquidity_usd || 0);
        return {
          status: "ok",
          token: {
            contract_address: score.contract_address,
            symbol: score.symbol,
            chain: score.chain,
          },
          score: safeScores,
          insight: {
            summary: `${score.symbol} is ${score.eligible ? 'eligible' : 'not eligible'} for trading with a rug risk of ${safeScores.rug_probability}%.`,
            key_points: [
              `Rug Risk: ${safeScores.rug_probability}%`,
              `Confidence Index: ${safeScores.trade_confidence_index}%`,
              `Liquidity: $${safeLiquidity.toLocaleString()}`,
            ],
          },
        };
      },
    ),
  );

  // Get token list with AI scores
  app.get("/api/tokens/stats/overview", async (_req, res) => {
    const tokens = await storage.getScannedTokens();
    const byChain = tokens.reduce<Record<string, number>>((acc, token) => {
      const chain = String(token.chain || "unknown").toLowerCase();
      acc[chain] = (acc[chain] || 0) + 1;
      return acc;
    }, {});

    res.json({
      total_tokens: tokens.length,
      by_chain: byChain,
    });
  });

  app.get("/api/system/health", async (_req, res) => {
    const tokens = await storage.getScannedTokens();
    const autoTradeConfig = getAutoTradeConfig();
    const bridgeConfigured = Boolean(pythonApiBase);
    const uptimeSeconds = Math.round((Date.now() - serviceStartedAt) / 1000);

    res.json({
      ok: true,
      service: "tradeaid-node-backend",
      time: new Date().toISOString(),
      uptime_seconds: uptimeSeconds,
      token_feed: {
        scanned_count: tokens.length,
        fresh_apify_configured: Boolean(String(process.env.APIFY_TOKEN || "").trim()),
      },
      api_metrics: {
        requests_total: observability.requestsTotal,
        api_requests: observability.apiRequests,
        api_4xx: observability.api4xx,
        api_5xx: observability.api5xx,
        last_request_at: observability.lastRequestAt,
        last_error_at: observability.lastErrorAt,
      },
      bridge: {
        configured: bridgeConfigured,
        target: bridgeConfigured ? pythonApiBase : null,
        fallback_count: observability.bridgeFallbacks,
        empty_response_count: observability.bridgeEmptyResponses,
        error_count: observability.bridgeErrors,
      },
      doctortrade: {
        local_fallback_enabled: true,
      },
      auto_trade: {
        enabled: autoTradeConfig.enabled,
        score_threshold: autoTradeConfig.scoreThreshold,
      },
    });
  });

  app.get("/api/tokens/solana/early", async (req, res) => {
    const windowMinutesRaw = Number(req.query.window_minutes || 30);
    const limitRaw = Number(req.query.limit || 100);
    const windowMinutes = Number.isFinite(windowMinutesRaw) ? Math.max(1, Math.min(1440, Math.trunc(windowMinutesRaw))) : 30;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, Math.trunc(limitRaw))) : 100;
    const filtered = await getSolanaEarlyScoredTokens(windowMinutes, limit);

    return res.json({
      ok: true,
      chain: "solana",
      window_minutes: windowMinutes,
      count: filtered.length,
      total_candidates: filtered.length,
      snapshot_at: new Date().toISOString(),
      cached: doctorEarlyScoredCache ? Date.now() - doctorEarlyScoredCache.at < 20_000 : false,
      tokens: filtered,
    });
  });

  app.get("/api/tokens/solana/fresh", async (req, res) => {
    const maxAgeHoursRaw = Number(req.query.max_age_hours || 24);
    const limitRaw = Number(req.query.limit || 50);
    const maxAgeHours = Number.isFinite(maxAgeHoursRaw) ? Math.max(1, Math.min(168, Math.trunc(maxAgeHoursRaw))) : 24;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;

    try {
      const pairs = await getNewPairs("solana", maxAgeHours);
      const ranked = [...pairs]
        .sort((a, b) => Number(b.pairCreatedAt || 0) - Number(a.pairCreatedAt || 0))
        .slice(0, limit);

      const tokens = ranked.map((pair) => {
        const token = pairToTokenData(pair);
        return {
          address: String(token.address || pair.baseToken.address || ""),
          symbol: String(token.symbol || pair.baseToken.symbol || "UNKNOWN"),
          name: String(token.name || pair.baseToken.name || "Unknown"),
          chain: "solana",
          dexId: String(token.dexId || pair.dexId || "dexscreener"),
          pairAddress: String(token.pairAddress || pair.pairAddress || ""),
          priceUsd: String(token.priceUsd || pair.priceUsd || "0"),
          liquidity: Number(token.liquidity || 0),
          marketCap: Number(token.marketCap || 0),
          volume24h: Number(token.volume24h || 0),
          priceChange1h: Number(token.priceChange1h || 0),
          launched_at: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null,
          pair_url: pair.url,
        };
      });

      return res.json({
        ok: true,
        chain: "solana",
        source: "dexscreener",
        max_age_hours: maxAgeHours,
        count: tokens.length,
        snapshot_at: nowIso(),
        tokens,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: error instanceof Error ? error.message : "Failed to fetch fresh Solana launches",
      });
    }
  });

  let tokenFeedResponseCache: { key: string; at: number; payload: TokenFeedResponse } | null = null;

  app.get("/api/tokens", async (req, res) => {
    const tokenFeedCacheTtlMs = Math.max(1000, Number(process.env.TOKEN_FEED_CACHE_MS || 15000));
    const buildLocalTokenPayload = async (): Promise<TokenFeedResponse> => {
      const cacheKey = JSON.stringify({
        chain: "solana",
        new_only: String(req.query.new_only || "false").toLowerCase(),
        max_age_hours: String(req.query.max_age_hours || ""),
        min_age_minutes: String(req.query.min_age_minutes || ""),
        max_age_minutes: String(req.query.max_age_minutes || ""),
        limit: String(req.query.limit || "50"),
      });
      if (tokenFeedResponseCache && tokenFeedResponseCache.key === cacheKey && Date.now() - tokenFeedResponseCache.at < tokenFeedCacheTtlMs) {
        return tokenFeedResponseCache.payload;
      }

      const all = await storage.getScannedTokens();
      const now = Date.now();

      const chainParam = "solana";
      const newOnly = String(req.query.new_only || "false").toLowerCase() === "true";
      const maxAgeHours = Number(req.query.max_age_hours || 0);
      const minAgeMinutes = Number(req.query.min_age_minutes || 0);
      const maxAgeMinutes = Number(req.query.max_age_minutes || 0);
      const limitRaw = Number(req.query.limit || 50);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;
      const effectiveMaxAgeHours = Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : 24;

      const freshRows = await (async () => {
        try {
          const fresh = await fetchFreshPumpfunTokens(60);
          return fresh.map((token, index) => {
            const raw = (token.raw || {}) as Record<string, unknown>;
            const sourcePlatform = String(raw.sourcePlatform || raw.source_platform || raw.platform || token.eventType || "pumpfun");
            const priceUsd = Number(raw.priceUsd || raw.price_usd || raw.usdPrice || 0);
            const marketCapUsd = Number(raw.marketCapUsd || raw.market_cap_usd || raw.marketCap || 0);
            const createdAtRaw = String(raw.discoveredAt || raw.created_at || raw.createdAt || raw.timestamp || "").trim();
            const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date();
            const logoUrl = String(raw.logoUrl || raw.logo_url || raw.imageUrl || raw.image || "").trim();
            const social = {
              twitter: String(raw.twitterUrl || raw.twitter || raw.x || "").trim() || undefined,
              telegram: String(raw.telegramUrl || raw.telegram || "").trim() || undefined,
              website: String(raw.websiteUrl || raw.website || "").trim() || undefined,
            };
            return {
              id: -(index + 1),
              address: token.mintAddress,
              symbol: token.symbol,
              name: token.name,
              chain: "solana",
              dexId: sourcePlatform || "pumpfun",
              pairAddress: null,
              priceUsd: String(priceUsd || 0),
              liquidity: Number(token.liquidityUsd || 0),
              marketCap: Number(marketCapUsd || 0),
              volume24h: Number(raw.volume24h || raw.volume_24h || 0),
              priceChange1h: Number(raw.priceChange1h || raw.price_change_1h || 0),
              priceChange24h: Number(raw.priceChange24h || raw.price_change_24h || 0),
              buys24h: Number(raw.buys24h || raw.buys_24h || 0),
              sells24h: Number(raw.sells24h || raw.sells_24h || 0),
              safetyScore: Number(scoreFreshToken({
                liquidityUsd: Number(token.liquidityUsd || 0),
                holdersCount: Number(raw.holdersCount || raw.holder_count || 0),
                mintAuthorityActive: true,
                freezeAuthorityActive: true,
              }).score || 0),
              mintAuthorityDisabled: false,
              topHoldersPercentage: Number(raw.topHoldersPercentage || raw.top_holder_pct || 0),
              devWalletPercentage: Number(raw.devWalletPercentage || raw.dev_wallet_pct || 0),
              logoUrl: logoUrl || null,
              socialLinks: social,
              aiAnalysis: null,
              createdAt,
            };
          });
        } catch {
          return [];
        }
      })();

      const dexsFreshRows = await (async () => {
        try {
          const dexChain = normalizeDexChain(chainParam || "solana");
          const pairs = await getNewPairs(dexChain, effectiveMaxAgeHours);
          return pairs
            .sort((a, b) => Number(b.pairCreatedAt || 0) - Number(a.pairCreatedAt || 0))
            .slice(0, Math.max(limit * 3, 150))
            .map((pair, index) => {
              const token = pairToTokenData(pair);
              const createdAt = token.pairCreatedAt || (pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : new Date());
              return {
                id: -(1000 + index + 1),
                address: String(token.address || pair.baseToken?.address || ""),
                symbol: String(token.symbol || pair.baseToken?.symbol || "UNKNOWN"),
                name: String(token.name || pair.baseToken?.name || "Unknown"),
                chain: String(token.chain || pair.chainId || dexChain || "solana").toLowerCase(),
                dexId: String(token.dexId || pair.dexId || "dexscreener"),
                pairAddress: String(token.pairAddress || pair.pairAddress || ""),
                priceUsd: String(token.priceUsd || pair.priceUsd || "0"),
                liquidity: Number(token.liquidity || 0),
                marketCap: Number(token.marketCap || 0),
                volume24h: Number(token.volume24h || 0),
                priceChange1h: Number(token.priceChange1h || 0),
                priceChange24h: Number(token.priceChange24h || pair.priceChange?.h24 || 0),
                buys24h: Number(pair.txns?.h24?.buys || token.buys24h || 0),
                sells24h: Number(pair.txns?.h24?.sells || token.sells24h || 0),
                safetyScore: Number(Math.max(0, Math.min(100, (token.liquidity || 0) >= 2000 ? 70 : 40))),
                mintAuthorityDisabled: false,
                topHoldersPercentage: 0,
                devWalletPercentage: 0,
                logoUrl: String(pair.info?.imageUrl || "").trim() || null,
                socialLinks: {
                  website: pair.info?.websites?.[0]?.url || undefined,
                  twitter: pair.info?.socials?.find((item) => String(item.platform || "").toLowerCase().includes("twitter"))?.url || undefined,
                  telegram: pair.info?.socials?.find((item) => String(item.platform || "").toLowerCase().includes("telegram"))?.url || undefined,
                },
                aiAnalysis: null,
                createdAt,
              };
            });
        } catch {
          return [];
        }
      })();

      const mergedByAddress = new Map<string, any>();
      const sourceRows = newOnly && dexsFreshRows.length > 0
        ? [...dexsFreshRows, ...freshRows]
        : [...all, ...freshRows, ...dexsFreshRows];

      for (const token of sourceRows) {
        const key = String((token as any)?.address || "").trim();
        if (!key) continue;
        const previous = mergedByAddress.get(key);
        if (!previous) {
          mergedByAddress.set(key, token);
          continue;
        }
        const prevCreated = previous?.createdAt ? new Date(previous.createdAt).getTime() : 0;
        const nextCreated = (token as any)?.createdAt ? new Date((token as any).createdAt).getTime() : 0;
        if (nextCreated >= prevCreated) {
          mergedByAddress.set(key, { ...previous, ...(token as any) });
        }
      }
      const baseRows = Array.from(mergedByAddress.values());

      const filtered = baseRows.filter((token) => {
        const tokenChain = String(token.chain || "solana").toLowerCase();
        if (tokenChain !== chainParam) return false;

        const createdAtTs = token.createdAt ? new Date(token.createdAt).getTime() : now;
        const ageMinutes = Math.max(0, (now - createdAtTs) / 60000);
        if (newOnly && ageMinutes > 24 * 60) return false;
        if (Number.isFinite(maxAgeHours) && maxAgeHours > 0 && ageMinutes > maxAgeHours * 60) return false;
        if (Number.isFinite(minAgeMinutes) && minAgeMinutes > 0 && ageMinutes < minAgeMinutes) return false;
        if (Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 && ageMinutes > maxAgeMinutes) return false;

        return true;
      });

      const tokens: TokenFeedItem[] = filtered
        .sort((a, b) => {
          if (newOnly) {
            const bCreated = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
            const aCreated = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
            if (bCreated !== aCreated) return bCreated - aCreated;
            return Number(b.liquidity || 0) - Number(a.liquidity || 0);
          }
          const bScore = Number(b.safetyScore || 0);
          const aScore = Number(a.safetyScore || 0);
          if (bScore !== aScore) return bScore - aScore;
          const bLiquidity = Number(b.liquidity || 0);
          const aLiquidity = Number(a.liquidity || 0);
          return bLiquidity - aLiquidity;
        })
        .slice(0, limit)
        .map((token) => {
          const liquidityUsd = Number(token.liquidity || 0);
          const safetyScore = Number(token.safetyScore || 0);
          const volume1h = Number(token.volume24h || 0) / 24;
          const volume5m = Number(token.volume24h || 0) / 288;
          const volume6h = Number(token.volume24h || 0) / 4;
          const chain = String(token.chain || "solana").toLowerCase();
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
            chain,
            name: String(token.name || "Unknown"),
            symbol: String(token.symbol || "UNKNOWN"),
            current_price_usd: Number(token.priceUsd || 0),
            market_cap_usd: Number(token.marketCap || 0),
            liquidity_usd: liquidityUsd,
            volume_5m: Number(volume5m.toFixed(2)),
            volume_1h: Number(volume1h.toFixed(2)),
            volume_6h: Number(volume6h.toFixed(2)),
            price_change_5m: Number((Number(token.priceChange1h || 0) / 12).toFixed(2)),
            price_change_1h: Number(token.priceChange1h || 0),
            price_change_6h: Number((Number(token.priceChange24h || 0) / 4).toFixed(2)),
            buys_1h: Math.max(0, Math.trunc(Number(token.buys24h || 0) / 24)),
            sells_1h: Math.max(0, Math.trunc(Number(token.sells24h || 0) / 24)),
            new_wallets_count: 0,
            top_holders_pct: Number(token.topHoldersPercentage || 0),
            dev_wallet_pct: Number(token.devWalletPercentage || 0),
            logo_url: token.logoUrl || token.logo_url || null,
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
          } satisfies TokenFeedItem;
        });

      const payload: TokenFeedResponse = { tokens, count: tokens.length, total: tokens.length };
      tokenFeedResponseCache = { key: cacheKey, at: Date.now(), payload };
      return payload;
    };

    const preferLocalFreshFeed =
      String(req.query.new_only || "false").toLowerCase() === "true" ||
      (Number.isFinite(Number(req.query.max_age_hours || 0)) && Number(req.query.max_age_hours || 0) > 0);

    if (preferLocalFreshFeed || !pythonApiBase || isBridgeLoopbackForRequest(req)) {
      observability.bridgeFallbacks += 1;
      return res.json(await buildLocalTokenPayload());
    }

    try {
      const targetUrl = `${pythonApiBase}/api/tokens`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const auth = String(req.headers.authorization || "").trim();
      if (auth) headers.Authorization = auth;

      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      const bridgeUrl = queryString ? `${targetUrl}?${queryString}` : targetUrl;
      const response = await fetch(bridgeUrl, { method: "GET", headers });
      const payload = await response.json().catch(() => null);
      const bridgedTokens = Array.isArray(payload?.tokens) ? payload.tokens : [];

      if (response.ok && bridgedTokens.length > 0) {
        return res.status(response.status).json(payload);
      }

      if (response.ok) {
        observability.bridgeEmptyResponses += 1;
      } else {
        observability.bridgeErrors += 1;
      }
      observability.bridgeFallbacks += 1;
      return res.json(await buildLocalTokenPayload());
    } catch {
      observability.bridgeErrors += 1;
      observability.bridgeFallbacks += 1;
      return res.json(await buildLocalTokenPayload());
    }
  });

  app.get("/api/growth/summary", async (_req, res) => {
    const tokens = await storage.getScannedTokens();
    const ranked = [...tokens]
      .sort((a, b) => Number(b.safetyScore || 0) - Number(a.safetyScore || 0))
      .slice(0, 8)
      .map((token) => ({
        symbol: token.symbol,
        address: token.address,
        chain: token.chain,
        safety_score: Number(token.safetyScore || 0),
        liquidity_usd: Number(token.liquidity || 0),
        rationale:
          Number(token.safetyScore || 0) >= 80
            ? "High safety signal with favorable liquidity"
            : "Watchlist candidate; monitor score and liquidity trend",
      }));

    const riskMix = tokens.reduce(
      (acc, token) => {
        const score = Number(token.safetyScore || 0);
        if (score >= 80) acc.low += 1;
        else if (score >= 55) acc.medium += 1;
        else acc.high += 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0 },
    );

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      candidates: ranked,
      risk_mix: riskMix,
      recommendations: [
        "Increase scanner coverage when low-risk candidates are below 5",
        "Prioritize tokens with safety >= 80 and liquidity >= 20k",
        "Avoid high-risk bucket entries unless manually reviewed",
      ],
    });
  });

  app.get("/api/tokens/project-info/:chain/:contract_address", async (req, res) => {
    const { contract_address } = req.params;
    const useBridge = String(process.env.TOKEN_PROJECT_INFO_USE_BRIDGE || "false").trim().toLowerCase() === "true";
    if (!useBridge) {
      return res.status(200).json(await buildDexProjectInfoFallback(contract_address, "solana"));
    }
    return proxyToPythonApi(
      req,
      res,
      `/api/tokens/project-info/${encodeURIComponent("solana")}/${encodeURIComponent(contract_address)}`,
      async () => buildDexProjectInfoFallback(contract_address, "solana"),
    );
  });

  try {
    await refreshRaydiumPools(true);
    startRaydiumPoolFetcher();
  } catch {
  }
  
  // Start background token scanner (scans every 60 seconds for fresh tokens)
  startBackgroundScanner(60 * 1000);

  // Start periodic multichain launchpad scans (every 5 minutes)
  try {
    setInterval(() => {
      multichainScanner.scanAllLaunchpads().catch(console.error);
    }, 5 * 60 * 1000);
    // run once on startup
    multichainScanner.scanAllLaunchpads().catch(console.error);
  } catch (e) {
    console.error("Failed to start multichain scanner:", e);
  }

  // Start Apify workflow scheduler (every 30 minutes)
  try {
    startApifyWorkflowScheduler(30 * 60 * 1000);
  } catch (e) {
    console.error("Failed to start Apify workflow scheduler:", e);
  }

  // === RugShield ===
  app.post(api.rugcheck.scan.path, async (req, res) => {
    try {
      const { address } = api.rugcheck.scan.input.parse(req.body);
      
      // Mock scan with realistic-looking data
      const symbols = ["BONK", "WIF", "POPCAT", "TRUMP", "PEPE", "DOGE", "SHIB", "FLOKI"];
      const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
      const isGood = Math.random() > 0.35;
      
      const mockResult = {
        address,
        symbol: `$${randomSymbol}`,
        name: randomSymbol,
        safetyScore: isGood ? Math.floor(Math.random() * 20 + 80) : Math.floor(Math.random() * 45),
        isLiquidityLocked: isGood,
        mintAuthorityDisabled: isGood,
        topHoldersPercentage: isGood ? Math.floor(Math.random() * 20 + 10) : Math.floor(Math.random() * 40 + 50),
        isHoneypot: !isGood,
      };

      const result = await storage.createScannedToken(mockResult);
      res.json(result);
    } catch (err) {
      res.status(400).json({ message: "Invalid request" });
    }
  });

  app.get(api.rugcheck.history.path, async (req, res) => {
    const history = await storage.getScannedTokens();
    res.json(history);
  });

  // === WhaleWatch ===
  app.get(api.whalewatch.wallets.list.path, async (req, res) => {
    const wallets = await storage.getTrackedWallets();
    res.json(wallets);
  });

  app.post(api.whalewatch.wallets.create.path, async (req, res) => {
    try {
      const input = api.whalewatch.wallets.create.input.parse(req.body);
      const wallet = await storage.createTrackedWallet(input);
      res.status(201).json(wallet);
    } catch (err) {
      res.status(400).json({ message: "Invalid request" });
    }
  });

  app.delete(api.whalewatch.wallets.delete.path, async (req, res) => {
    await storage.deleteTrackedWallet(Number(req.params.id));
    res.status(204).send();
  });

  app.get(api.whalewatch.alerts.list.path, async (req, res) => {
    const alerts = await storage.getWalletAlerts();
    res.json(alerts);
  });

  // === MemeTrend ===
  app.get(api.memetrend.list.path, async (req, res) => {
    const coins = await storage.getTrendingCoins();
    res.json(coins);
  });

  app.post(api.memetrend.analyze.path, async (req, res) => {
    try {
      const { symbol } = api.memetrend.analyze.input.parse(req.body);
      
      const prompt = `Analyze the sentiment for the memecoin ${symbol}. 
      Assume there is high social media activity. 
      Provide a JSON response with: 
      - sentiment: "BULLISH", "BEARISH", or "NEUTRAL"
      - score: number between 0-100
      - summary: A short witty summary of why (max 2 sentences).`;

      const completion = await getOpenAI().chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || "{}");
      
      res.json({
        sentiment: aiResponse.sentiment || "NEUTRAL",
        score: aiResponse.score || 50,
        summary: aiResponse.summary || "No data available.",
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "AI Analysis failed" });
    }
  });

  // === Subscription ===
  app.get("/api/subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const subscription = await storage.getSubscription(userId);
      res.json(subscription || { plan: "free", status: "active" });
    } catch (err) {
      res.status(500).json({ message: "Failed to get subscription" });
    }
  });

  
  app.get("/api/usage", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const usage = await storage.getUsage(userId);
      res.json({ ...usage, limits: FREE_TIER_LIMITS });
    } catch (err) {
      res.status(500).json({ message: "Failed to get usage" });
    }
  });

  app.post("/api/usage/increment", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { type } = req.body;
      const validTypes = ["scans", "analyses", "signals", "ads"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: "Invalid usage type" });
      }
      const usage = await storage.incrementUsage(userId, type);
      res.json(usage);
    } catch (err) {
      res.status(400).json({ message: "Failed to increment usage" });
    }
  });

  // === Crypto Payment Verification ===
  app.get("/api/payment/amounts", async (req, res) => {
    try {
      const amounts = await cryptoPaymentService.calculatePaymentAmounts();
      const addresses = cryptoPaymentService.getPaymentAddresses();
      res.json({ 
        amounts, 
        addresses,
        priceUsd: SUBSCRIPTION_PRICE_USD,
        supportedChains: SUPPORTED_PAYMENT_CHAINS 
      });
    } catch (err) {
      console.error("Failed to get payment amounts:", err);
      res.status(500).json({ message: "Failed to get payment amounts" });
    }
  });

  app.post("/api/payment/verify", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { chain, txHash } = req.body;

      if (!chain || !txHash) {
        return res.status(400).json({ message: "Chain and txHash are required" });
      }

      // Normalize and verify chain is Solana-only
      const normalizedChain = normalizeChain(chain);
      if (normalizedChain !== "solana") {
        return res.status(400).json({ message: "Only Solana payments are supported" });
      }

      const existingPayment = await storage.getPaymentByTxHash(txHash);
      if (existingPayment) {
        return res.status(400).json({ 
          message: "Transaction already submitted",
          status: existingPayment.status 
        });
      }

      const amounts = await cryptoPaymentService.calculatePaymentAmounts();
      const expectedAmount = amounts.find(a => a.chain === normalizedChain.toUpperCase())?.amount || "0";

      const paymentRecord = await storage.createPaymentRecord({
        userId,
        chain: normalizedChain.toUpperCase(),
        txHash,
        amount: "0",
        expectedAmount,
        status: "pending",
      });

      const verification = await cryptoPaymentService.verifyTransaction(normalizedChain, txHash);

      if (verification.isValid) {
        await storage.updatePaymentRecord(paymentRecord.id, {
          status: "verified",
          amount: String(verification.amount),
          senderAddress: verification.from,
          recipientAddress: verification.to,
          verifiedAt: new Date(),
        });

        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);

        await storage.createSubscription({
          userId,
          plan: "pro",
          paymentMethod: chain.toUpperCase(),
          txHash,
          status: "active",
          expiresAt,
        });

        res.json({
          success: true,
          message: "Payment verified! Your Pro subscription is now active.",
          verification,
        });
      } else {
        await storage.updatePaymentRecord(paymentRecord.id, {
          status: "failed",
          verificationError: verification.error,
          amount: String(verification.amount || 0),
          senderAddress: verification.from,
          recipientAddress: verification.to,
        });

        res.status(400).json({
          success: false,
          message: verification.error || "Payment verification failed",
          verification,
        });
      }
    } catch (err) {
      console.error("Payment verification error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });

  app.get("/api/payment/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const payments = await storage.getUserPayments(userId);
      res.json(payments);
    } catch (err) {
      res.status(500).json({ message: "Failed to get payment history" });
    }
  });

  // === DEX Scanner (New Feature) ===
  app.get("/api/dex/new-tokens", async (req, res) => {
    // Mock new tokens from multiple DEXes
    const mockTokens = [
      { symbol: "$MOODENG", name: "Moo Deng", chain: "solana", dex: "Raydium", price: "0.00012", volume: "$2.3M", age: "2h", hype: 92, dexscreenerPaid: true },
      { symbol: "$GOAT", name: "Goatseus Maximus", chain: "solana", dex: "Jupiter", price: "0.45", volume: "$15M", age: "4h", hype: 88, dexscreenerPaid: true },
      { symbol: "$BRETT", name: "Brett", chain: "base", dex: "Uniswap", price: "0.12", volume: "$8M", age: "1d", hype: 75, dexscreenerPaid: false },
      { symbol: "$SIGMA", name: "Sigma", chain: "ethereum", dex: "Uniswap", price: "0.0023", volume: "$1.2M", age: "3h", hype: 82, dexscreenerPaid: true },
      { symbol: "$NEIRO", name: "Neiro", chain: "ethereum", dex: "Uniswap", price: "0.0015", volume: "$5M", age: "12h", hype: 70, dexscreenerPaid: false },
      { symbol: "$CAT", name: "Cat in Dogs World", chain: "solana", dex: "Pump.fun", price: "0.00008", volume: "$890K", age: "30m", hype: 95, dexscreenerPaid: true },
    ];
    res.json(mockTokens);
  });

  // === Twitter Trends ===
  app.get("/api/twitter/trends", async (req, res) => {
    // Mock Twitter trends
    const mockTrends = [
      { tag: "#BONK", mentions: 15420, sentiment: "BULLISH", change: "+45%" },
      { tag: "#WIF", mentions: 12300, sentiment: "BULLISH", change: "+28%" },
      { tag: "#MOODENG", mentions: 8900, sentiment: "BULLISH", change: "+120%" },
      { tag: "#GOAT", mentions: 7500, sentiment: "NEUTRAL", change: "+15%" },
      { tag: "#TRUMP", mentions: 45000, sentiment: "BULLISH", change: "+89%" },
    ];
    res.json(mockTrends);
  });

  // === Launchpad Scanner ===
  app.get("/api/launchpads/recent", async (req, res) => {
    try {
      // Prefer recent saved scanned tokens that came from launchpads (pump.fun first)
      const tokens = await storage.getScannedTokens();

      // Map stored tokens into a compact launchpad view
      const launches = tokens
        .filter((t: any) => t.dexId && String(t.chain).toLowerCase() === "solana")
        .slice(0, 20)
        .map((t: any) => ({
          platform: t.dexId || "launchpad",
          symbol: t.symbol || "$UNK",
          name: t.name || "Unknown",
          bondingCurve: Math.round((t.liquidity || 0) / 1000),
          holders: t.topHoldersPercentage || 0,
          liquidity: `$${t.liquidity || 0}`,
          status: t.riskLevel || "unknown",
        }));

      // If no launchpad tokens saved yet, return a small seed set
      if (launches.length === 0) {
        return res.json([
          { platform: "Pump.fun", symbol: "$NEWDOG", name: "New Dog Coin", bondingCurve: 85, holders: 1234, liquidity: "$45K", status: "graduated" },
          { platform: "Pump.fun", symbol: "$MOON", name: "To The Moon", bondingCurve: 45, holders: 567, liquidity: "$12K", status: "bonding" },
        ]);
      }

      res.json(launches);
    } catch (err) {
      console.error("Error fetching launchpads:", err);
      res.status(500).json({ error: "Failed to fetch recent launchpads" });
    }
  });

  // === User Profile ===
  const profileUpdateSchema = z.object({
    username: z.string().min(1).max(50).optional(),
    bio: z.string().max(500).optional(),
    favoriteChain: z.enum(["solana", "ethereum", "bsc", "base"]).optional(),
    notificationsEnabled: z.boolean().optional(),
    emailAlertsEnabled: z.boolean().optional(),
    riskTolerance: z.enum(["low", "medium", "high"]).optional(),
  });

  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (err) {
      res.status(500).json({ message: "Failed to get profile" });
    }
  });

  app.patch("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const existingUser = await authStorage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }

      const updates: any = {};
      if (parsed.data.username !== undefined) updates.username = parsed.data.username;
      if (parsed.data.bio !== undefined) updates.bio = parsed.data.bio;
      if (parsed.data.favoriteChain !== undefined) updates.favoriteChain = parsed.data.favoriteChain;
      if (parsed.data.notificationsEnabled !== undefined) updates.notificationsEnabled = parsed.data.notificationsEnabled;
      if (parsed.data.emailAlertsEnabled !== undefined) updates.emailAlertsEnabled = parsed.data.emailAlertsEnabled;
      if (parsed.data.riskTolerance !== undefined) updates.riskTolerance = parsed.data.riskTolerance;

      const user = await authStorage.updateUser(userId, updates);
      res.json(user);
    } catch (err) {
      console.error("Profile update error:", err);
      res.status(400).json({ message: "Failed to update profile" });
    }
  });

  // === Seed Data ===
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const wallets = await storage.getTrackedWallets();
  if (wallets.length === 0) {
    await storage.createTrackedWallet({
      address: "HN7cABPNH...k8j2xZp",
      label: "Smart Money Alpha",
      winRate: 87,
      totalProfit: "1,250 SOL"
    });
    await storage.createTrackedWallet({
      address: "Ab9qPmL...xY3zKvM",
      label: "Insider Whale",
      winRate: 92,
      totalProfit: "3,400 SOL"
    });
    await storage.createTrackedWallet({
      address: "Fg4rTyU...nM8pQwE",
      label: "Degen King",
      winRate: 78,
      totalProfit: "890 SOL"
    });
    
    const allWallets = await storage.getTrackedWallets();
    if (allWallets.length > 0) {
      await storage.createWalletAlert({
        walletId: allWallets[0].id,
        tokenSymbol: "$BONK",
        type: "BUY",
        amount: "150 SOL",
        price: "0.0000123",
      });
      await storage.createWalletAlert({
        walletId: allWallets[1].id,
        tokenSymbol: "$WIF",
        type: "BUY",
        amount: "500 SOL",
        price: "2.34",
      });
      await storage.createWalletAlert({
        walletId: allWallets[0].id,
        tokenSymbol: "$MOODENG",
        type: "SELL",
        amount: "80 SOL",
        price: "0.00015",
      });
    }
  }

  const trends = await storage.getTrendingCoins();
  if (trends.length === 0) {
    await storage.createTrendingCoin({
      symbol: "$BONK",
      name: "Bonk",
      price: "0.0000234",
      volume24h: "$145M",
      hypeScore: 95,
      trend: "UP",
    });
    await storage.createTrendingCoin({
      symbol: "$WIF",
      name: "dogwifhat",
      price: "2.89",
      volume24h: "$320M",
      hypeScore: 92,
      trend: "UP",
    });
    await storage.createTrendingCoin({
      symbol: "$POPCAT",
      name: "Popcat",
      price: "0.78",
      volume24h: "$45M",
      hypeScore: 78,
      trend: "UP",
    });
    await storage.createTrendingCoin({
      symbol: "$MOODENG",
      name: "Moo Deng",
      price: "0.00018",
      volume24h: "$12M",
      hypeScore: 88,
      trend: "UP",
    });
    await storage.createTrendingCoin({
      symbol: "$GOAT",
      name: "Goatseus Maximus",
      price: "0.56",
      volume24h: "$89M",
      hypeScore: 85,
      trend: "FLAT",
    });
  }
}
