import type { Express } from "express";
import type { Server } from "http";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import { storage } from "./storage";
import { db } from "./db";
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
import { fetchFreshPumpfunTokens, normalizeApifyDatasetItems, type FreshTokenItem } from "./services/fresh-token-service";
import { runApifyWorkflowOnce, startApifyWorkflowScheduler } from "./services/apify-workflow";
import { enrichTokenWithHelius } from "./services/helius-enrichment-service";
import { scoreFreshToken } from "./services/token-scoring-engine";
import { getAutoTradeConfig, maybeTriggerAutoTrade } from "./services/auto-trade-hook";
import { logStructured } from "./services/structured-logger";
import { getHeliusRpcUrl, getSolanaConnection, getTokenMintAuthorityInfo, getTokenMintDecimals } from "./services/solana-connection";
import { BONK_MINT, SOL_MINT, detectSupportedBaseMint, refreshRaydiumPools, startRaydiumPoolFetcher } from "./services/raydium-pools";
import { fetchRaydiumQuote, fetchRaydiumSwapPayload, getDoctorTradeBaseAssetMint } from "./services/raydium-swap";
import OpenAI from "openai";
import { sql } from "drizzle-orm";

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

function resolveOpenAiApiKey(): string {
  return String(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY
      || process.env.OPENAI_API_KEY
      || "",
  ).trim();
}

function resolveOpenAiBaseUrl(): string | undefined {
  const value = String(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
      || process.env.OPENAI_BASE_URL
      || "",
  ).trim();
  return value || undefined;
}

function resolveOpenAiOrganization(): string | undefined {
  const value = String(
    process.env.AI_INTEGRATIONS_OPENAI_ORGANIZATION
      || process.env.OPENAI_ORGANIZATION
      || process.env.OPENAI_ORG_ID
      || "",
  ).trim();
  return value || undefined;
}

function resolveOpenAiProject(): string | undefined {
  const value = String(
    process.env.AI_INTEGRATIONS_OPENAI_PROJECT
      || process.env.OPENAI_PROJECT
      || process.env.OPENAI_PROJECT_ID
      || "",
  ).trim();
  return value || undefined;
}

function resolveOpenAiModel(): string {
  return String(
    process.env.AI_INTEGRATIONS_OPENAI_MODEL
      || process.env.OPENAI_MODEL
      || "gpt-4o-mini",
  ).trim();
}

function resolveOpenAiModelFallbacks(): string[] {
  const preferred = resolveOpenAiModel();
  const models = [
    preferred,
    "gpt-4o-mini",
    "gpt-4.1-mini",
  ].map((item) => String(item || "").trim()).filter(Boolean);
  return Array.from(new Set(models));
}

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: resolveOpenAiApiKey(),
      baseURL: resolveOpenAiBaseUrl(),
      organization: resolveOpenAiOrganization(),
      project: resolveOpenAiProject(),
    });
  }
  return openaiClient;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const nowIso = () => new Date().toISOString();
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

  const apifyIngestItemsStateKey = "apify:fresh:items:v1";

  const getStoredApifyFreshTokens = async (limit = 10): Promise<FreshTokenItem[]> => {
    try {
      const snapshot = await storage.getAppState<{ items?: FreshTokenItem[] }>(apifyIngestItemsStateKey);
      const rows = Array.isArray(snapshot?.items) ? snapshot.items : [];
      return rows.slice(0, Math.max(1, Math.min(500, Math.trunc(limit))));
    } catch {
      return [];
    }
  };

  const getMergedFreshPumpfunTokens = async (limit = 10): Promise<FreshTokenItem[]> => {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const fromApifyApi = await (async () => {
      try {
        return await fetchFreshPumpfunTokens(safeLimit);
      } catch {
        return [] as FreshTokenItem[];
      }
    })();

    const fromIngest = await getStoredApifyFreshTokens(safeLimit);
    if (!fromIngest.length) {
      return fromApifyApi.slice(0, safeLimit);
    }

    const merged = new Map<string, FreshTokenItem>();
    for (const row of [...fromApifyApi, ...fromIngest]) {
      const key = String(row?.mintAddress || "").trim();
      if (!key) continue;
      if (!merged.has(key)) {
        merged.set(key, row);
      }
    }

    return Array.from(merged.values()).slice(0, safeLimit);
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
      const normalizedItems = normalizeApifyDatasetItems(items)
        .slice(0, 500)
        .map((item) => ({
          ...item,
          raw: {
            ...item.raw,
            ingestedAt: new Date().toISOString(),
          },
        }));

      lastApifyIngest = {
        run_id: runId,
        dataset_id: datasetId,
        received_at: new Date().toISOString(),
        received_count: items.length,
      };

      await storage.setAppState(apifyIngestItemsStateKey, {
        run_id: runId,
        dataset_id: datasetId,
        received_at: lastApifyIngest.received_at,
        items: normalizedItems,
      });

      logStructured("info", "apify.dataset_ingested", {
        runId,
        datasetId,
        itemCount: items.length,
        normalizedCount: normalizedItems.length,
      });

      return res.json({
        ok: true,
        received: items.length,
        normalized: normalizedItems.length,
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
      const limitRaw = Number(req.body?.limit || req.query?.limit || process.env.APIFY_DATASET_LIMIT || 10);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 10;
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
    const buyRatioPct = ((buys + 1) / Math.max(1, buys + sells + 2)) * 100;
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
        buys_5m: buys,
        sells_5m: sells,
        buy_ratio_pct: Number(buyRatioPct.toFixed(2)),
        slippage_hint_pct: Number(slippageHint.toFixed(2)),
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

  const buildOpenAiScoreExplanation = async (scorePayload: Record<string, any>) => {
    const apiKey = resolveOpenAiApiKey();
    const enabled = String(process.env.SCORE_TOKEN_OPENAI_ENABLED || "true").trim().toLowerCase() !== "false";
    if (!enabled || !apiKey) {
      return {
        summary: "OpenAI scoring explanation unavailable. Configure OpenAI API access.",
        key_points: ["OpenAI key missing or OpenAI scoring disabled."],
        confidence_adjustment: 0,
        source: "openai_unavailable",
      };
    }

    try {
      const prompt = [
        "You are a crypto trading risk assistant for meme-token sniping.",
        "Analyze this token scoring payload and return concise plain-English guidance.",
        "Return strict JSON with keys: summary (string), key_points (string[] up to 4), confidence_adjustment (number from -10 to 10).",
        "Do not include markdown.",
        JSON.stringify(scorePayload),
      ].join("\n");

      let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>> | null = null;
      let lastError: unknown = null;
      for (const model of resolveOpenAiModelFallbacks()) {
        try {
          completion = await getOpenAI().chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!completion) {
        throw lastError instanceof Error ? lastError : new Error("openai_completion_failed");
      }

      const parsed = JSON.parse(String(completion.choices?.[0]?.message?.content || "{}"));
      const confidenceAdjustment = Math.max(-10, Math.min(10, Number(parsed?.confidence_adjustment || 0)));
      const keyPoints = Array.isArray(parsed?.key_points)
        ? parsed.key_points.map((item: unknown) => String(item || "").trim()).filter(Boolean).slice(0, 4)
        : [];

      return {
        summary: String(parsed?.summary || "AI analysis unavailable.").trim() || "AI analysis unavailable.",
        key_points: keyPoints,
        confidence_adjustment: confidenceAdjustment,
        source: "openai",
      };
    } catch (error) {
      logStructured("warn", "openai.score_explanation_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        summary: "OpenAI scoring explanation request failed.",
        key_points: ["Retry shortly; OpenAI service may be rate-limited or unavailable."],
        confidence_adjustment: 0,
        source: "openai_unavailable",
      };
    }
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
    ownerUserId: "" as string,
    enabled: false,
    killSwitch: false,
    scanIntervalSeconds: Math.max(2, Math.trunc(Number(process.env.DOCTORTRADE_SCAN_INTERVAL_SECONDS || 10))),
    wallet: {
      address: "",
      balanceSol: 0,
      separateWalletEnforced: true,
    },
    controls: {
      snipe_preset: "insider",
      max_trades_per_day: 20,
      trades_today: 0,
      max_open_positions: 3,
      strategy_window_minutes: 5,
      ai_min_signals_required: 4,
      cooldown_minutes_per_mint: 30,
      min_wallet_fee_buffer_sol: 0.02,
      gas_priority_lamports: Math.max(0, Math.trunc(Number(process.env.DOCTORTRADE_PRIORITY_FEE_LAMPORTS || 500000))),
      min_liquidity_sol: 0.05,
      max_liquidity_sol: 500,
      min_buys_5m: 1,
      max_sells_5m: 50,
      max_token_age_seconds: 240,
      live_sell_fraction_pct: 100,
      max_sell_notional_usd: 300,
      max_wallet_allocation_pct: 10,
      min_buy_amount_sol: 0.1,
      buy_amount_sol: 0.1,
      take_profit_multiplier: 1.45,
      min_profit_pct: 45,
      stop_loss_pct: 12,
      trailing_stop_pct: 8,
      min_liquidity_usd: 100,
      max_liquidity_usd: 7500,
      min_market_cap_usd: 1000,
      max_market_cap_usd: 250000,
      min_volume_24h_usd: 100,
      min_token_age_minutes: 0,
      max_token_age_minutes: 2,
      min_lock_hours: 0,
      max_slippage_pct: 20,
      max_spread_pct: 3,
      daily_loss_limit_usd: 600,
      max_consecutive_losses: 3,
      strong_move_threshold_pct: 25,
      max_hold_minutes: 90,
      position_rotation_minutes: 1,
      min_momentum_profit_pct: 4,
      quality_min_volume_spike_pct: 12,
      quality_max_top_holder_pct: 15,
      max_dev_wallet_pct: 8,
      min_unique_buyers: 8,
      min_buy_ratio_pct: 62,
      max_early_spike_pct: 200,
    },
    execution: {
      mode: "live" as "paper" | "live",
    },
    executionAudit: [] as Array<Record<string, any>>,
    boughtMints: [] as string[],
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
  const doctorRuntimeStateKey = "doctortrade.runtime.v1";
  const doctorRuntimeByUserStateKey = "doctortrade.runtime.by_user.v1";
  const doctorPresetByUserStateKey = "doctortrade.preset.by_user.v1";
  const doctorWalletByUserStateKey = "doctortrade.wallets.by_user.v1";

  const encodeBase64 = (value: Uint8Array) => Buffer.from(value).toString("base64");
  const decodeBase64 = (value: string) => Buffer.from(value, "base64");
  const resolveDoctorWalletEncryptionSecret = () => {
    return String(
      process.env.DOCTORTRADE_WALLET_ENCRYPTION_KEY
        || process.env.DOCTORTRADE_ENCRYPTION_KEY
        || process.env.JWT_SECRET
        || process.env.SESSION_SECRET
        || "tradeaid-doctor-wallet-fallback-key",
    ).trim();
  };
  const getDoctorWalletEncryptionKey = () => {
    const secret = resolveDoctorWalletEncryptionSecret();
    return createHash("sha256").update(secret, "utf8").digest();
  };
  const encryptDoctorPrivateKey = (privateKey: string) => {
    const trimmed = String(privateKey || "").trim();
    if (!trimmed) return "";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getDoctorWalletEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `enc:v1:${encodeBase64(iv)}:${encodeBase64(authTag)}:${encodeBase64(encrypted)}`;
  };
  const decryptDoctorPrivateKey = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (!trimmed.startsWith("enc:v1:")) {
      return trimmed;
    }
    const parts = trimmed.split(":");
    if (parts.length !== 5) return "";
    try {
      const iv = decodeBase64(parts[2]);
      const authTag = decodeBase64(parts[3]);
      const encrypted = decodeBase64(parts[4]);
      const decipher = createDecipheriv("aes-256-gcm", getDoctorWalletEncryptionKey(), iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf8").trim();
    } catch {
      return "";
    }
  };

  const deriveWalletPublicKeyFromPrivateKey = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";

    const toAddress = (secret: Uint8Array) => {
      try {
        if (secret.length >= 64) {
          return Keypair.fromSecretKey(secret.slice(0, 64)).publicKey.toBase58();
        }
        if (secret.length === 32) {
          return Keypair.fromSeed(secret).publicKey.toBase58();
        }
      } catch {
      }
      return "";
    };

    try {
      if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed) as number[];
        if (Array.isArray(parsed) && parsed.length >= 32) {
          const fromJson = toAddress(Uint8Array.from(parsed.map((item) => Number(item) & 0xff)));
          if (fromJson) return fromJson;
        }
      }
    } catch {
    }

    try {
      const decoded = bs58Codec.decode(trimmed);
      const fromBs58 = toAddress(decoded);
      if (fromBs58) return fromBs58;
    } catch {
    }

    try {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length >= 32) {
        const fromBase64 = toAddress(new Uint8Array(decoded));
        if (fromBase64) return fromBase64;
      }
    } catch {
    }

    return "";
  };

  const getRequestUserId = (req: any): string => {
    return String(req?.user?.claims?.sub || "").trim();
  };

  const maskDoctorWalletAddress = (address: string) => {
    const normalized = String(address || "").trim();
    if (!normalized) return "";
    if (normalized.length <= 12) return normalized;
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
  };

  const getStoredDoctorWalletsByUser = async (): Promise<Record<string, any>> => {
    try {
      const state = await storage.getAppState<Record<string, any>>(doctorWalletByUserStateKey);
      if (state && typeof state === "object" && !Array.isArray(state)) {
        return state;
      }
      return {};
    } catch {
      return {};
    }
  };

  const setStoredDoctorWalletsByUser = async (value: Record<string, any>) => {
    await storage.setAppState(doctorWalletByUserStateKey, value);
  };

  const getStoredDoctorRuntimesByUser = async (): Promise<Record<string, any>> => {
    try {
      const state = await storage.getAppState<Record<string, any>>(doctorRuntimeByUserStateKey);
      if (state && typeof state === "object" && !Array.isArray(state)) {
        return state;
      }
      return {};
    } catch {
      return {};
    }
  };

  const setStoredDoctorRuntimesByUser = async (value: Record<string, any>) => {
    await storage.setAppState(doctorRuntimeByUserStateKey, value);
  };

  const getStoredDoctorPresetsByUser = async (): Promise<Record<string, string>> => {
    try {
      const state = await storage.getAppState<Record<string, any>>(doctorPresetByUserStateKey);
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        return {};
      }

      const normalized: Record<string, string> = {};
      for (const [userId, preset] of Object.entries(state)) {
        const normalizedUserId = String(userId || "").trim();
        if (!normalizedUserId) continue;
        const normalizedPreset = normalizeDoctorSnipePreset(preset);
        normalized[normalizedUserId] = normalizedPreset;
      }
      return normalized;
    } catch {
      return {};
    }
  };

  const setStoredDoctorPresetsByUser = async (value: Record<string, string>) => {
    await storage.setAppState(doctorPresetByUserStateKey, value);
  };

  const isDoctorAutoTradingEnabledForUser = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      return Boolean(doctorRuntime.enabled) && !Boolean(doctorRuntime.killSwitch);
    }

    try {
      const byUser = await getStoredDoctorRuntimesByUser();
      const userRuntime = byUser[normalizedUserId] as Record<string, any> | undefined;
      if (userRuntime && typeof userRuntime === "object") {
        return Boolean(userRuntime.enabled) && !Boolean(userRuntime.killSwitch);
      }
    } catch {
    }

    return Boolean(doctorRuntime.enabled) && !Boolean(doctorRuntime.killSwitch);
  };

  const loadDoctorWalletForUser = async (userId: string) => {
    const wallets = await getStoredDoctorWalletsByUser();
    const userWallet = wallets[userId] as Record<string, any> | undefined;
    if (!userWallet || typeof userWallet !== "object") {
      return;
    }

    doctorRuntime.wallet.address = String(userWallet.address || "").trim();
    doctorRuntime.wallet.balanceSol = Math.max(0, Number(userWallet.balanceSol || 0));
    doctorRuntime.wallet.separateWalletEnforced = userWallet.separateWalletEnforced !== false;
  };

  const getDoctorWalletSnapshotForUser = async (userId: string) => {
    const wallets = await getStoredDoctorWalletsByUser();
    const userWallet = wallets[userId] as Record<string, any> | undefined;
    const encryptedPrivateKey = String(userWallet?.livePrivateKey || "").trim();
    const decryptedPrivateKey = decryptDoctorPrivateKey(encryptedPrivateKey);
    const hasPrivateKey = Boolean(String(decryptedPrivateKey || "").trim());
    const configuredAddress = String(userWallet?.address || "").trim();
    const derivedAddress = hasPrivateKey
      ? deriveWalletPublicKeyFromPrivateKey(decryptedPrivateKey)
      : "";
    const resolvedAddress = configuredAddress || derivedAddress;
    const autoHydrateBlocked = Boolean(userWallet?.autoHydrateBlocked);

    if (userWallet && resolvedAddress && resolvedAddress !== configuredAddress) {
      wallets[userId] = {
        ...userWallet,
        address: resolvedAddress,
        updatedAt: nowIso(),
      };
      await setStoredDoctorWalletsByUser(wallets);
    }

    return {
      address: resolvedAddress,
      balanceSol: Math.max(0, Number(userWallet?.balanceSol || 0)),
      separateWalletEnforced: userWallet?.separateWalletEnforced !== false,
      privateKeyConfigured: hasPrivateKey,
      autoHydrateBlocked,
      connected: Boolean(resolvedAddress) && hasPrivateKey,
    };
  };

  const isDoctorWalletAutoHydrateBlockedForUser = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return false;
    const wallets = await getStoredDoctorWalletsByUser();
    const userWallet = wallets[normalizedUserId] as Record<string, any> | undefined;
    return Boolean(userWallet?.autoHydrateBlocked);
  };

  const saveDoctorWalletForUser = async (userId: string) => {
    const wallets = await getStoredDoctorWalletsByUser();
    const current = wallets[userId] as Record<string, any> | undefined;
    const normalizedUserId = String(userId || "").trim();
    const runtimeOwnerUserId = String(doctorRuntime.ownerUserId || "").trim();
    const runtimeBelongsToUser = Boolean(normalizedUserId && runtimeOwnerUserId && normalizedUserId === runtimeOwnerUserId);
    const runtimeAddress = String(doctorRuntime.wallet.address || "").trim();
    const existingAddress = String(current?.address || "").trim();
    const resolvedAddress = runtimeBelongsToUser
      ? (runtimeAddress || existingAddress)
      : existingAddress;
    wallets[userId] = {
      address: resolvedAddress,
      balanceSol: Math.max(0, Number(doctorRuntime.wallet.balanceSol || 0)),
      separateWalletEnforced: doctorRuntime.wallet.separateWalletEnforced !== false,
      livePrivateKey: String(current?.livePrivateKey || "").trim(),
      autoHydrateBlocked: Boolean(current?.autoHydrateBlocked),
      updatedAt: nowIso(),
    };
    await setStoredDoctorWalletsByUser(wallets);
  };

  const syncDoctorWalletFromAssistantRuntime = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      return { synced: false, reason: "missing_user_id" } as const;
    }
    return {
      synced: false,
      reason: "manual_wallet_required",
      userId: normalizedUserId,
    } as const;
  };

  const setDoctorLivePrivateKeyForUser = async (userId: string, privateKey: string) => {
    const encryptedPrivateKey = encryptDoctorPrivateKey(privateKey);
    const wallets = await getStoredDoctorWalletsByUser();
    const current = wallets[userId] as Record<string, any> | undefined;
    wallets[userId] = {
      ...(current || {}),
      address: String(doctorRuntime.wallet.address || current?.address || "").trim(),
      balanceSol: Math.max(0, Number(doctorRuntime.wallet.balanceSol ?? current?.balanceSol ?? 0)),
      separateWalletEnforced: (doctorRuntime.wallet.separateWalletEnforced ?? current?.separateWalletEnforced) !== false,
      livePrivateKey: encryptedPrivateKey,
      autoHydrateBlocked: false,
      updatedAt: nowIso(),
    };
    await setStoredDoctorWalletsByUser(wallets);
  };

  const ensureDoctorOwnerAndWalletHydrated = async (preferredUserId?: string) => {
    let hydrated = false;
    const currentOwner = String(preferredUserId || doctorRuntime.ownerUserId || "").trim();
    const currentWalletAddress = String(doctorRuntime.wallet.address || "").trim();

    if (!currentOwner) {
      return false;
    }

    const autoHydrateBlocked = await isDoctorWalletAutoHydrateBlockedForUser(currentOwner);
    if (autoHydrateBlocked) {
      return false;
    }

    if (!doctorRuntime.wallet.address) {
      const wallets = await getStoredDoctorWalletsByUser();
      const ownerWallet = wallets[currentOwner] as Record<string, any> | undefined;
      const ownerWalletAddress = String(ownerWallet?.address || "").trim();
      const ownerPrivateKey = decryptDoctorPrivateKey(String(ownerWallet?.livePrivateKey || "").trim());
      if (ownerWalletAddress && ownerPrivateKey) {
        doctorRuntime.wallet.address = ownerWalletAddress;
        hydrated = true;
      }
    }

    if (hydrated) {
      await persistDoctorRuntime(currentOwner);
    }

    return hydrated;
  };

  const getDoctorLiveWalletCredentials = async (preferredUserId?: string) => {
    const requestedUserId = String(preferredUserId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
    await ensureDoctorOwnerAndWalletHydrated(requestedUserId);

    const ownerUserId = requestedUserId;
    const wallets = await getStoredDoctorWalletsByUser();
    const ownerWallet = ownerUserId ? (wallets[ownerUserId] as Record<string, any> | undefined) : undefined;
    const resolvedWallet = ownerWallet;
    const encryptedPrivateKey = String(resolvedWallet?.livePrivateKey || "").trim();
    const userPrivateKey = decryptDoctorPrivateKey(encryptedPrivateKey);
    const configuredPublicKey = String(resolvedWallet?.address || "").trim();
    const derivedPublicKey = userPrivateKey
      ? deriveWalletPublicKeyFromPrivateKey(userPrivateKey)
      : "";
    const userPublicKey = configuredPublicKey || derivedPublicKey;

    if (ownerUserId && resolvedWallet && userPublicKey && userPublicKey !== configuredPublicKey) {
      wallets[ownerUserId] = {
        ...resolvedWallet,
        address: userPublicKey,
        updatedAt: nowIso(),
      };
      await setStoredDoctorWalletsByUser(wallets);
    }

    if (userPublicKey && userPrivateKey) {
      return {
        walletPublicKey: userPublicKey,
        walletPrivateKey: userPrivateKey,
      };
    }
    return {
      walletPublicKey: "",
      walletPrivateKey: "",
    };
  };

  const isDoctorLiveTradingEnabled = () => {
    return String(process.env.DOCTORTRADE_LIVE_TRADING_ENABLED || "true").toLowerCase() !== "false";
  };

  const isDoctorLiveOnlyMode = () => {
    return String(process.env.DOCTORTRADE_LIVE_ONLY_MODE || process.env.DOCTORTRADE_LIVE_ONLY || "false").trim().toLowerCase() === "true";
  };

  const isDoctorMultiUserMode = () => {
    return String(process.env.DOCTORTRADE_MULTI_USER || "true").toLowerCase() !== "false";
  };

  const isDoctorDexTurboEnabled = () => {
    return String(process.env.DOCTOR_DEX_TURBO || "true").trim().toLowerCase() !== "false";
  };

  const normalizeDoctorSnipePreset = (value: unknown) => {
    const preset = String(value || "").trim().toLowerCase();
    if (preset === "conservative") return "conservative" as const;
    if (preset === "balanced") return "balanced" as const;
    if (preset === "aggressive" || preset === "agressive") return "aggressive" as const;
    if (preset === "custom") return "custom" as const;
    return "insider" as const;
  };

  const getDoctorActiveSnipePreset = () => {
    return normalizeDoctorSnipePreset((doctorRuntime.controls as any).snipe_preset);
  };

  const doctorPresetNumericProfiles: Record<"insider" | "conservative" | "balanced" | "aggressive", Record<string, number>> = {
    insider: {
      max_open_positions: 3,
      take_profit_multiplier: 1.5,
      min_profit_pct: 50,
      stop_loss_pct: 15,
      trailing_stop_pct: 8,
      max_hold_minutes: 120,
      position_rotation_minutes: 1,
      live_sell_fraction_pct: 100,
      max_sell_notional_usd: 300,
      strong_move_threshold_pct: 15,
      min_liquidity_usd: 150,
      max_liquidity_usd: 25000,
      min_market_cap_usd: 2000,
      max_market_cap_usd: 180000,
      min_volume_24h_usd: 2000,
      min_token_age_minutes: 0,
      max_token_age_minutes: 5,
      max_token_age_seconds: 360,
      min_liquidity_sol: 0.15,
      max_liquidity_sol: 200,
      min_buys_5m: 2,
      max_sells_5m: 5,
      min_unique_buyers: 3,
      min_buy_ratio_pct: 58,
      quality_max_top_holder_pct: 25,
      max_dev_wallet_pct: 20,
      ai_min_signals_required: 2,
      min_lock_hours: 0,
      quality_min_volume_spike_pct: 6,
      max_early_spike_pct: 350,
      strategy_window_minutes: 5,
    },
    conservative: {
      max_open_positions: 2,
      take_profit_multiplier: 1.6,
      min_profit_pct: 24,
      stop_loss_pct: 8,
      trailing_stop_pct: 5,
      max_hold_minutes: 120,
      position_rotation_minutes: 5,
      live_sell_fraction_pct: 100,
      max_sell_notional_usd: 500,
      strong_move_threshold_pct: 45,
      min_liquidity_usd: 2000,
      max_liquidity_usd: 20000,
      min_market_cap_usd: 25000,
      max_market_cap_usd: 300000,
      min_volume_24h_usd: 25000,
      min_token_age_minutes: 1,
      max_token_age_minutes: 5,
      max_token_age_seconds: 300,
      min_liquidity_sol: 4,
      max_liquidity_sol: 120,
      min_buys_5m: 6,
      max_sells_5m: 2,
      min_unique_buyers: 30,
      min_buy_ratio_pct: 78,
      quality_max_top_holder_pct: 12,
      max_dev_wallet_pct: 5,
      ai_min_signals_required: 6,
      min_lock_hours: 1,
      quality_min_volume_spike_pct: 18,
      max_early_spike_pct: 140,
      strategy_window_minutes: 5,
    },
    balanced: {
      max_open_positions: 3,
      take_profit_multiplier: 1.8,
      min_profit_pct: 40,
      stop_loss_pct: 12,
      trailing_stop_pct: 7,
      max_hold_minutes: 150,
      position_rotation_minutes: 3,
      live_sell_fraction_pct: 75,
      max_sell_notional_usd: 400,
      strong_move_threshold_pct: 35,
      min_liquidity_usd: 1000,
      max_liquidity_usd: 15000,
      min_market_cap_usd: 15000,
      max_market_cap_usd: 220000,
      min_volume_24h_usd: 12000,
      min_token_age_minutes: 0,
      max_token_age_minutes: 4,
      max_token_age_seconds: 240,
      min_liquidity_sol: 2,
      max_liquidity_sol: 90,
      min_buys_5m: 4,
      max_sells_5m: 2,
      min_unique_buyers: 18,
      min_buy_ratio_pct: 70,
      quality_max_top_holder_pct: 15,
      max_dev_wallet_pct: 7,
      ai_min_signals_required: 5,
      min_lock_hours: 0,
      quality_min_volume_spike_pct: 14,
      max_early_spike_pct: 180,
      strategy_window_minutes: 5,
    },
    aggressive: {
      max_open_positions: 4,
      take_profit_multiplier: 2.2,
      min_profit_pct: 70,
      stop_loss_pct: 20,
      trailing_stop_pct: 10,
      max_hold_minutes: 180,
      position_rotation_minutes: 2,
      live_sell_fraction_pct: 60,
      max_sell_notional_usd: 350,
      strong_move_threshold_pct: 20,
      min_liquidity_usd: 200,
      max_liquidity_usd: 12000,
      min_market_cap_usd: 5000,
      max_market_cap_usd: 250000,
      min_volume_24h_usd: 4000,
      min_token_age_minutes: 0,
      max_token_age_minutes: 3,
      max_token_age_seconds: 180,
      min_liquidity_sol: 0.5,
      max_liquidity_sol: 80,
      min_buys_5m: 2,
      max_sells_5m: 3,
      min_unique_buyers: 5,
      min_buy_ratio_pct: 60,
      quality_max_top_holder_pct: 20,
      max_dev_wallet_pct: 12,
      ai_min_signals_required: 3,
      min_lock_hours: 0,
      quality_min_volume_spike_pct: 8,
      max_early_spike_pct: 260,
      strategy_window_minutes: 4,
    },
  };

  const getDoctorEffectiveControlNumber = (key: string, fallbackValue: number) => {
    const preset = getDoctorActiveSnipePreset();
    if (preset !== "custom") {
      const profileValue = Number((doctorPresetNumericProfiles as Record<string, Record<string, number>>)?.[preset]?.[key]);
      if (Number.isFinite(profileValue)) {
        return profileValue;
      }
    }

    const runtimeValue = Number((doctorRuntime.controls as Record<string, any>)[key]);
    if (Number.isFinite(runtimeValue)) {
      return runtimeValue;
    }
    return fallbackValue;
  };

  const getDoctorEffectiveMaxOpenPositions = () => {
    return Math.max(1, Math.trunc(getDoctorEffectiveControlNumber("max_open_positions", Number(doctorRuntime.controls.max_open_positions || 3))));
  };

  const shouldForceDoctorCustomPreset = (
    activePreset: "insider" | "conservative" | "balanced" | "aggressive" | "custom",
    controlsPayload: Record<string, any>,
  ) => {
    if (activePreset === "custom") return false;
    const profile = (doctorPresetNumericProfiles as Record<string, Record<string, number>>)[activePreset];
    if (!profile) return false;

    const presetSensitiveKeys = [
      "take_profit_multiplier",
      "min_profit_pct",
      "stop_loss_pct",
      "trailing_stop_pct",
      "max_hold_minutes",
    ] as const;

    for (const key of presetSensitiveKeys) {
      if (!Number.isFinite(Number(controlsPayload[key]))) {
        continue;
      }
      const payloadValue = Number(controlsPayload[key]);
      const presetValue = Number(profile[key]);
      if (!Number.isFinite(presetValue)) {
        continue;
      }
      if (Math.abs(payloadValue - presetValue) > 1e-9) {
        return true;
      }
    }
    return false;
  };

  const ensureDoctorLiveExecutionModeIfCapable = async (
    preferredUserId?: string,
    options?: { persistRuntime?: boolean },
  ) => {
    const scopedUserId = String(preferredUserId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
    const shouldPersist = options?.persistRuntime !== false;
    const { walletPublicKey, walletPrivateKey } = await getDoctorLiveWalletCredentials(preferredUserId);
    const liveCapable = isDoctorLiveTradingEnabled() && Boolean(walletPublicKey) && Boolean(walletPrivateKey);
    const liveOnly = isDoctorLiveOnlyMode();
    if (liveOnly) {
      if (doctorRuntime.execution.mode !== "live") {
        doctorRuntime.execution.mode = "live";
        if (shouldPersist) {
          await persistDoctorRuntime(scopedUserId);
        }
      }
      return liveCapable;
    }

    if (liveCapable && doctorRuntime.execution.mode !== "live") {
      doctorRuntime.execution.mode = "live";
      if (shouldPersist) {
        await persistDoctorRuntime(scopedUserId);
      }
      return liveCapable;
    }

    if (!liveCapable && doctorRuntime.execution.mode === "live") {
      doctorRuntime.execution.mode = "paper";
      if (shouldPersist) {
        await persistDoctorRuntime(scopedUserId);
      }
    }

    return liveCapable;
  };

  const clearDoctorWalletForUser = async (userId: string) => {
    const wallets = await getStoredDoctorWalletsByUser();
    const existing = wallets[userId] as Record<string, any> | undefined;
    wallets[userId] = {
      ...(existing || {}),
      address: "",
      balanceSol: 0,
      livePrivateKey: "",
      autoHydrateBlocked: true,
      updatedAt: nowIso(),
    };
    await setStoredDoctorWalletsByUser(wallets);
  };

  const claimDoctorOwnerIfUnowned = (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;
    if (!String(doctorRuntime.ownerUserId || "").trim()) {
      doctorRuntime.ownerUserId = normalizedUserId;
    }
  };

  const isDoctorOwner = (userId: string) => {
    if (!doctorRuntime.ownerUserId) return true;
    return doctorRuntime.ownerUserId === userId;
  };

  let doctorActiveUserId = "";

  const persistDoctorRuntime = async (userId?: string) => {
    const snapshot = JSON.parse(JSON.stringify(doctorRuntime));
    const targetUserId = String(userId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
    try {
      await mkdir(doctorStateDir, { recursive: true });
      if (targetUserId) {
        const runtimeByUser = await getStoredDoctorRuntimesByUser();
        const presetByUser = await getStoredDoctorPresetsByUser();
        presetByUser[targetUserId] = normalizeDoctorSnipePreset((snapshot?.controls as any)?.snipe_preset);
        runtimeByUser[targetUserId] = snapshot;
        await Promise.allSettled([
          storage.setAppState(doctorRuntimeByUserStateKey, runtimeByUser),
          storage.setAppState(doctorPresetByUserStateKey, presetByUser),
          writeFile(doctorStateFile, JSON.stringify(snapshot, null, 2), "utf8"),
          storage.setAppState(doctorRuntimeStateKey, snapshot),
        ]);
      } else {
        await Promise.allSettled([
          writeFile(doctorStateFile, JSON.stringify(snapshot, null, 2), "utf8"),
          storage.setAppState(doctorRuntimeStateKey, snapshot),
        ]);
      }
    } catch {
    }
  };

  const applyDoctorRuntimeSnapshot = (loaded: Record<string, any>) => {
    let normalizedOnLoad = false;

    if (typeof loaded.enabled === "boolean") {
      doctorRuntime.enabled = loaded.enabled;
    }
    if (typeof loaded.ownerUserId === "string") {
      doctorRuntime.ownerUserId = String(loaded.ownerUserId || "").trim();
    }
    if (typeof loaded.killSwitch === "boolean") {
      doctorRuntime.killSwitch = loaded.killSwitch;
    }
    if (Number.isFinite(Number(loaded.scanIntervalSeconds))) {
      doctorRuntime.scanIntervalSeconds = Math.max(2, Math.trunc(Number(loaded.scanIntervalSeconds)));
    }

    const wallet = loaded.wallet as Record<string, any> | undefined;
    if (wallet && typeof wallet === "object") {
      if (typeof wallet.address === "string") {
        doctorRuntime.wallet.address = wallet.address;
      }
      if (Number.isFinite(Number(wallet.balanceSol))) {
        const normalizedBalance = Math.max(0, Number(wallet.balanceSol));
        doctorRuntime.wallet.balanceSol = normalizedBalance;
        if (normalizedBalance !== Number(wallet.balanceSol)) {
          normalizedOnLoad = true;
        }
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

      if (typeof controls.snipe_preset === "string") {
        (doctorRuntime.controls as any).snipe_preset = normalizeDoctorSnipePreset(controls.snipe_preset);
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
      const loadedMode = String((loaded.execution as Record<string, any>).mode || "").trim().toLowerCase();
      doctorRuntime.execution.mode = loadedMode === "paper" ? "paper" : "live";
    }
    if (Array.isArray(loaded.executionAudit)) {
      doctorRuntime.executionAudit = loaded.executionAudit.slice(0, 200);
    }
    if (Array.isArray((loaded as any).boughtMints)) {
      doctorRuntime.boughtMints = (loaded as any).boughtMints
        .map((item: any) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 500);
    }
    if (loaded.lastDecision && typeof loaded.lastDecision === "object") {
      doctorRuntime.lastDecision = loaded.lastDecision as Record<string, any>;
    }

    doctorRuntime.lastRunAt = typeof loaded.lastRunAt === "string" ? loaded.lastRunAt : null;
    doctorRuntime.lastError = typeof loaded.lastError === "string" ? loaded.lastError : null;

    doctorRuntime.controls.buy_amount_sol = Math.max(0.1, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    doctorRuntime.controls.min_buy_amount_sol = Math.max(0.1, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    doctorRuntime.controls.strategy_window_minutes = Math.min(5, Math.max(3, Number(doctorRuntime.controls.strategy_window_minutes || 5)));
    doctorRuntime.controls.min_token_age_minutes = Math.max(0, Number(doctorRuntime.controls.min_token_age_minutes || 0));
    doctorRuntime.controls.max_token_age_minutes = Math.min(10, Math.max(Number(doctorRuntime.controls.min_token_age_minutes || 0), Number(doctorRuntime.controls.max_token_age_minutes || 10)));
    doctorRuntime.controls.max_token_age_seconds = Math.max(30, Number(doctorRuntime.controls.max_token_age_seconds || 240));
    (doctorRuntime.controls as any).snipe_preset = normalizeDoctorSnipePreset((doctorRuntime.controls as any).snipe_preset);
    if (isDoctorDexTurboEnabled() && doctorRuntime.controls.max_token_age_seconds < 120) {
      doctorRuntime.controls.max_token_age_seconds = 120;
    }
    if (doctorRuntime.killSwitch) {
      doctorRuntime.enabled = false;
    }
    if (doctorRuntime.execution.mode === "paper") {
      const normalizedPaperBalance = Math.max(0, Number(doctorRuntime.wallet.balanceSol || 0));
      if (normalizedPaperBalance !== Number(doctorRuntime.wallet.balanceSol || 0)) {
        doctorRuntime.wallet.balanceSol = normalizedPaperBalance;
        normalizedOnLoad = true;
      }
    }

    return normalizedOnLoad;
  };

  const loadDoctorRuntime = async () => {
    try {
      let loaded: Record<string, any> | null = null;

      try {
        const state = await storage.getAppState<Record<string, any>>(doctorRuntimeStateKey);
        if (state && typeof state === "object") {
          loaded = state;
        }
      } catch {
      }

      if (!loaded) {
        const text = await readFile(doctorStateFile, "utf8");
        loaded = JSON.parse(text) as Record<string, any>;
      }

      const normalizedOnLoad = applyDoctorRuntimeSnapshot(loaded);
      if (normalizedOnLoad) {
        await persistDoctorRuntime();
      }
    } catch {
    }
  };

  await loadDoctorRuntime();

  const doctorRuntimeTemplate = JSON.parse(JSON.stringify(doctorRuntime)) as Record<string, any>;

  const hydrateDoctorRuntimeWithDefaults = () => {
    const clone = JSON.parse(JSON.stringify(doctorRuntimeTemplate)) as Record<string, any>;
    Object.keys(doctorRuntime).forEach((key) => {
      (doctorRuntime as any)[key] = clone[key];
    });
  };

  const loadDoctorRuntimeForUser = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;
    const currentRuntimeSnapshot = JSON.parse(JSON.stringify(doctorRuntime)) as Record<string, any>;
    const isCurrentRuntimeForSameUser =
      String(doctorActiveUserId || doctorRuntime.ownerUserId || "").trim() === normalizedUserId;

    let loaded: Record<string, any> | null = null;
    try {
      const byUser = await getStoredDoctorRuntimesByUser();
      const row = byUser[normalizedUserId] as Record<string, any> | undefined;
      if (row && typeof row === "object") {
        loaded = row;
      }
    } catch {
    }

    if (loaded) {
      hydrateDoctorRuntimeWithDefaults();
      applyDoctorRuntimeSnapshot(loaded);
    } else {
      let loadedLegacy = false;
      try {
        const legacy = await storage.getAppState<Record<string, any>>(doctorRuntimeStateKey);
        const legacyOwnerUserId = String((legacy as any)?.ownerUserId || "").trim();
        const canMigrateLegacyToUser = Boolean(
          legacy
          && typeof legacy === "object"
          && legacyOwnerUserId
          && legacyOwnerUserId === normalizedUserId,
        );
        if (canMigrateLegacyToUser && legacy) {
          hydrateDoctorRuntimeWithDefaults();
          applyDoctorRuntimeSnapshot(legacy);
          loadedLegacy = true;
          await persistDoctorRuntime(normalizedUserId);
        }
      } catch {
      }

      if (!loadedLegacy && !isCurrentRuntimeForSameUser) {
        hydrateDoctorRuntimeWithDefaults();
      } else if (!loadedLegacy && isCurrentRuntimeForSameUser) {
        Object.keys(doctorRuntime).forEach((key) => {
          (doctorRuntime as any)[key] = currentRuntimeSnapshot[key];
        });
      }
    }

    // Enforce persisted per-user preset so runtime fallbacks cannot reset to default.
    try {
      const presetsByUser = await getStoredDoctorPresetsByUser();
      const persistedPreset = presetsByUser[normalizedUserId];
      if (persistedPreset) {
        (doctorRuntime.controls as any).snipe_preset = normalizeDoctorSnipePreset(persistedPreset);
      }
    } catch {
    }

    doctorRuntime.ownerUserId = normalizedUserId;
    doctorActiveUserId = normalizedUserId;
    await loadDoctorWalletForUser(normalizedUserId);
  };

  const doctorCycleRunningByUser = new Set<string>();
  let doctorCycleGlobalLock: Promise<void> = Promise.resolve();
  const doctorCycleTimerByUser = new Map<string, NodeJS.Timeout>();
  const doctorSchedulerStateKey = "doctortrade.scheduler.v1";
  const doctorSchedulerInstanceId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  let doctorSchedulerTimer: NodeJS.Timeout | null = null;
  let doctorEarlyScoredCache: { at: number; tokens: Array<Record<string, any>> } | null = null;
  const doctorTradeLogStateKey = "doctortrade.executions.v1";
  const doctorDexWorkerStateKey = "doctortrade.dex.worker.v1";
  let doctorDexWorkerTimer: NodeJS.Timeout | null = null;
  let doctorDexWorkerRunning = false;
  let doctorDexWorkerLastPollAt: string | null = null;
  let doctorWalletBalanceCache: { address: string; at: number; balanceSol: number } | null = null;
  let doctorWalletTokensCache: { address: string; at: number; tokens: Array<Record<string, any>> } | null = null;
  let doctorWalletTransactionsCache: { address: string; at: number; transactions: Array<Record<string, any>> } | null = null;
  const splTokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const splToken2022ProgramId = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const doctorProcessedMints = new Map<string, number>();
  const doctorRejectedMints = new Map<string, number>();
  let doctorSniperLogsByUser = new Map<string, Array<Record<string, any>>>();
  const doctorTickerQueue: Array<Record<string, any>> = [];
  const doctorTickerSeenByMint = new Map<string, number>();

  const formatTickerCompactUsd = (value: number) => {
    const safe = Number(value || 0);
    if (!Number.isFinite(safe) || safe <= 0) return "$0";
    if (safe >= 1_000_000_000) return `$${(safe / 1_000_000_000).toFixed(2)}B`;
    if (safe >= 1_000_000) return `$${(safe / 1_000_000).toFixed(2)}M`;
    if (safe >= 1_000) return `$${(safe / 1_000).toFixed(0)}K`;
    if (safe >= 1) return `$${safe.toFixed(2)}`;
    return `$${safe.toFixed(6)}`;
  };

  const invalidateDoctorWalletCaches = (walletAddress?: string) => {
    const resolvedWallet = String(walletAddress || doctorRuntime.wallet.address || "").trim();
    if (!resolvedWallet) {
      doctorWalletBalanceCache = null;
      doctorWalletTokensCache = null;
      doctorWalletTransactionsCache = null;
      return;
    }

    if (doctorWalletBalanceCache?.address === resolvedWallet) doctorWalletBalanceCache = null;
    if (doctorWalletTokensCache?.address === resolvedWallet) doctorWalletTokensCache = null;
    if (doctorWalletTransactionsCache?.address === resolvedWallet) doctorWalletTransactionsCache = null;
  };

  const getTickerSourceLabel = (source: string, launchSource: string, smartMoney = false) => {
    const normalizedSource = String(source || "").trim().toLowerCase();
    const normalizedLaunchSource = normalizeLaunchSource(String(launchSource || "").trim());
    if (normalizedLaunchSource === "pumpfun") return "Pump.fun";
    if (normalizedSource.includes("dex")) return "DexScreener";
    if (smartMoney) return "Helius Tx";
    return "Doctor AI";
  };

  const getTickerSignalLabel = (context: {
    smartMoney: boolean;
    volume5mUsd: number;
    liquidityUsd: number;
    ageMinutes: number;
    buys5m: number;
    sells5m: number;
  }) => {
    if (context.smartMoney) return "Smart Money";
    if (context.ageMinutes <= 10 && context.liquidityUsd >= 50_000) return "Hot";
    if (context.buys5m >= Math.max(2, context.sells5m * 1.4) && context.volume5mUsd >= 25_000) return "Pumping";
    return "Hot";
  };

  const getTickerSignalPrefix = (signal: string) => {
    if (signal === "Pumping") return "ROCKET";
    if (signal === "Smart Money") return "BRAIN";
    return "FIRE";
  };

  const enqueueDoctorTickerSignal = (payload: {
    mint: string;
    symbol?: string;
    name?: string;
    priceUsd?: number;
    liquidityUsd?: number;
    volume5mUsd?: number;
    ageMinutes?: number;
    buys5m?: number;
    sells5m?: number;
    source?: string;
    launchSource?: string;
    smartMoney?: boolean;
    rejectReasons?: string[];
  }) => {
    const mint = String(payload.mint || "").trim();
    if (!mint) return;

    const blacklistHit = (Array.isArray(payload.rejectReasons) ? payload.rejectReasons : [])
      .some((reason) => /blacklist|blocked|scam/i.test(String(reason || "")));
    if (blacklistHit) return;

    const nowMs = Date.now();
    const dedupeWindowMs = Math.max(5_000, Number(process.env.DOCTOR_TICKER_DEDUPE_MS || 20_000));
    const lastSeenAt = Number(doctorTickerSeenByMint.get(mint) || 0);
    if (nowMs - lastSeenAt < dedupeWindowMs) return;

    const liquidityUsd = Math.max(0, Number(payload.liquidityUsd || 0));
    const volume5mUsd = Math.max(0, Number(payload.volume5mUsd || 0));
    const ageMinutes = Math.max(0, Number(payload.ageMinutes || 0));
    const buys5m = Math.max(0, Number(payload.buys5m || 0));
    const sells5m = Math.max(0, Number(payload.sells5m || 0));
    const smartMoney = Boolean(payload.smartMoney);

    const liquidityFloorUsd = Math.max(1_000, Number(process.env.DOCTOR_TICKER_MIN_LIQUIDITY_USD || 20_000));
    const volumeFloorUsd = Math.max(0, Number(process.env.DOCTOR_TICKER_MIN_VOLUME_5M_USD || 8_000));
    const maxAgeMinutes = Math.max(1, Number(process.env.DOCTOR_TICKER_MAX_AGE_MINUTES || 45));

    const liquidityPass = liquidityUsd >= liquidityFloorUsd;
    const volumeSpikePass = volume5mUsd >= volumeFloorUsd || buys5m >= Math.max(3, sells5m * 1.25);
    const agePass = ageMinutes <= maxAgeMinutes;
    if (!liquidityPass || !volumeSpikePass || !agePass) return;

    const signal = getTickerSignalLabel({ smartMoney, volume5mUsd, liquidityUsd, ageMinutes, buys5m, sells5m });
    const prefix = getTickerSignalPrefix(signal);
    const symbol = String(payload.symbol || "UNKNOWN").trim().toUpperCase();
    const tokenName = String(payload.name || symbol || "TOKEN").trim();
    const sourceLabel = getTickerSourceLabel(String(payload.source || ""), String(payload.launchSource || ""), smartMoney);

    const entry = {
      id: `ticker_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
      mint,
      name: tokenName,
      symbol,
      price_usd: Math.max(0, Number(payload.priceUsd || 0)),
      liquidity_usd: liquidityUsd,
      volume_5m_usd: volume5mUsd,
      age_minutes: Number(ageMinutes.toFixed(1)),
      signal,
      signal_prefix: prefix,
      source: sourceLabel,
      launch_source: normalizeLaunchSource(String(payload.launchSource || "")),
      chart_url: `https://dexscreener.com/solana/${mint}`,
      created_at: nowIso(),
    } as Record<string, any>;

    entry.message = `${prefix} ${entry.symbol} | Price ${formatTickerCompactUsd(entry.price_usd)} | Liquidity ${formatTickerCompactUsd(entry.liquidity_usd)} | Volume(5m) ${formatTickerCompactUsd(entry.volume_5m_usd)} | ${entry.signal}`;

    doctorTickerSeenByMint.set(mint, nowMs);
    doctorTickerQueue.unshift(entry);

    const queueLimit = Math.max(20, Number(process.env.DOCTOR_TICKER_QUEUE_LIMIT || 80));
    if (doctorTickerQueue.length > queueLimit) {
      doctorTickerQueue.splice(queueLimit);
    }

    const seenTtlMs = Math.max(60_000, Number(process.env.DOCTOR_TICKER_SEEN_TTL_MS || 20 * 60 * 1000));
    for (const [seenMint, seenAt] of Array.from(doctorTickerSeenByMint.entries())) {
      if (nowMs - seenAt > seenTtlMs) {
        doctorTickerSeenByMint.delete(seenMint);
      }
    }
  };

  const getDoctorSniperLogsForUser = (userId?: string) => {
    const scopedUserId = String(userId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
    if (!scopedUserId) return [] as Array<Record<string, any>>;
    return doctorSniperLogsByUser.get(scopedUserId) || [];
  };

  const appendDoctorSniperLog = (entry: Record<string, any>, userId?: string) => {
    const scopedUserId = String(userId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
    if (!scopedUserId) return;

    const existing = doctorSniperLogsByUser.get(scopedUserId) || [];
    existing.unshift({
      id: `sniper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: nowIso(),
      preset: getDoctorActiveSnipePreset(),
      user_id: scopedUserId,
      ...entry,
    });
    doctorSniperLogsByUser.set(scopedUserId, existing.slice(0, 200));
  };

  const getDoctorSchedulerState = async (): Promise<Record<string, any>> => {
    try {
      const value = await storage.getAppState<Record<string, any>>(doctorSchedulerStateKey);
      if (value && typeof value === "object") {
        return value;
      }
      return { jobs: {}, lease: {} };
    } catch {
      return { jobs: {}, lease: {} };
    }
  };

  const setDoctorSchedulerState = async (state: Record<string, any>) => {
    await storage.setAppState(doctorSchedulerStateKey, state);
  };

  const upsertDoctorSchedulerJob = async (userId: string, enabled: boolean, intervalSeconds: number, runNow = false) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;
    const state = await getDoctorSchedulerState();
    const jobs = (state.jobs && typeof state.jobs === "object") ? state.jobs as Record<string, any> : {};

    if (!enabled) {
      delete jobs[normalizedUserId];
    } else {
      const existingJob = (jobs[normalizedUserId] && typeof jobs[normalizedUserId] === "object")
        ? jobs[normalizedUserId] as Record<string, any>
        : {};
      const nowMs = Date.now();
      const nextRunAt = runNow
        ? nowMs
        : Number(existingJob.next_run_at || (nowMs + (Math.max(2, intervalSeconds) * 1000)));
      jobs[normalizedUserId] = {
        ...existingJob,
        user_id: normalizedUserId,
        enabled: true,
        interval_seconds: Math.max(2, Math.trunc(intervalSeconds || 20)),
        next_run_at: Math.max(nowMs, nextRunAt),
        updated_at: nowIso(),
      };
    }

    state.jobs = jobs;
    await setDoctorSchedulerState(state);
  };

  const getDoctorSchedulerJobForUser = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return null;
    const state = await getDoctorSchedulerState();
    const jobs = (state.jobs && typeof state.jobs === "object") ? state.jobs as Record<string, any> : {};
    const job = jobs[normalizedUserId];
    if (!job || typeof job !== "object") return null;
    return job as Record<string, any>;
  };

  const acquireDoctorSchedulerLease = async () => {
    const leaseMs = Math.max(2_000, Number(process.env.DOCTOR_SCHEDULER_LEASE_MS || 8_000));
    const nowMs = Date.now();
    const state = await getDoctorSchedulerState();
    const lease = (state.lease && typeof state.lease === "object") ? state.lease as Record<string, any> : {};
    const holder = String(lease.holder || "").trim();
    const expiresAt = Number(lease.expires_at || 0);

    if (holder && holder !== doctorSchedulerInstanceId && expiresAt > nowMs) {
      return { acquired: false, state } as const;
    }

    state.lease = {
      holder: doctorSchedulerInstanceId,
      expires_at: nowMs + leaseMs,
      updated_at: nowIso(),
    };
    await setDoctorSchedulerState(state);
    return { acquired: true, state } as const;
  };

  const runDoctorSchedulerTick = async () => {
    const leaseResult = await acquireDoctorSchedulerLease();
    if (!leaseResult.acquired) return;

    const state = leaseResult.state;
    const jobs = (state.jobs && typeof state.jobs === "object") ? state.jobs as Record<string, any> : {};
    const nowMs = Date.now();

    for (const userId of Object.keys(jobs)) {
      const job = jobs[userId] as Record<string, any>;
      const enabled = Boolean(job?.enabled);
      if (!enabled) {
        delete jobs[userId];
        continue;
      }

      const intervalSeconds = Math.max(2, Math.trunc(Number(job?.interval_seconds || 20)));
      const nextRunAt = Number(job?.next_run_at || 0);
      if (nextRunAt > nowMs) {
        continue;
      }

      const runStartedAt = Date.now();
      const runResult = await runDoctorCycleSafely("auto", userId);
      const runCompletedAtIso = nowIso();
      const runDurationMs = Math.max(0, Date.now() - runStartedAt);
      const previousRunCount = Math.max(0, Math.trunc(Number(job?.run_count || 0)));
      const previousFailCount = Math.max(0, Math.trunc(Number(job?.fail_count || 0)));

      jobs[userId] = {
        ...(job || {}),
        user_id: userId,
        enabled: true,
        interval_seconds: intervalSeconds,
        next_run_at: nowMs + (intervalSeconds * 1000),
        last_run_at: runCompletedAtIso,
        last_run_duration_ms: runDurationMs,
        last_success_at: runResult.ok ? runCompletedAtIso : String(job?.last_success_at || ""),
        last_error: runResult.ok ? null : String(runResult.error || "scheduler_cycle_failed"),
        run_count: previousRunCount + 1,
        fail_count: runResult.ok ? previousFailCount : (previousFailCount + 1),
        updated_at: nowIso(),
      };
    }

    state.jobs = jobs;
    state.lease = {
      holder: doctorSchedulerInstanceId,
      expires_at: Date.now() + Math.max(2_000, Number(process.env.DOCTOR_SCHEDULER_LEASE_MS || 8_000)),
      updated_at: nowIso(),
    };
    await setDoctorSchedulerState(state);
  };

  const startDoctorScheduler = () => {
    if (doctorSchedulerTimer) {
      clearInterval(doctorSchedulerTimer);
      doctorSchedulerTimer = null;
    }
    const pollMs = Math.max(1_000, Math.trunc(Number(process.env.DOCTOR_SCHEDULER_POLL_MS || 2_000)));
    doctorSchedulerTimer = setInterval(async () => {
      await runDoctorSchedulerTick();
    }, pollMs);
    doctorSchedulerTimer.unref?.();
    void runDoctorSchedulerTick();
  };

  const persistDoctorDexWorkerState = async () => {
    try {
      const logsByUser: Record<string, Array<Record<string, any>>> = {};
      doctorSniperLogsByUser.forEach((rows, userId) => {
        if (!userId) return;
        logsByUser[userId] = rows.slice(0, 200);
      });
      const payload = {
        processed_mints: Array.from(doctorProcessedMints.entries()),
        rejected_mints: Array.from(doctorRejectedMints.entries()),
        logs_by_user: logsByUser,
        last_poll_at: doctorDexWorkerLastPollAt,
      };
      await storage.setAppState(doctorDexWorkerStateKey, payload);
    } catch {
    }
  };

  const loadDoctorDexWorkerState = async () => {
    try {
      const payload = await storage.getAppState<Record<string, any>>(doctorDexWorkerStateKey);
      const processed = Array.isArray(payload?.processed_mints) ? payload!.processed_mints : [];
      const rejected = Array.isArray(payload?.rejected_mints) ? payload!.rejected_mints : [];
      const logsByUserPayload = payload?.logs_by_user && typeof payload.logs_by_user === "object"
        ? (payload.logs_by_user as Record<string, any>)
        : null;
      const legacyLogs = Array.isArray(payload?.logs) ? payload!.logs : [];
      doctorDexWorkerLastPollAt = typeof payload?.last_poll_at === "string" ? payload.last_poll_at : null;

      const nowMs = Date.now();
      const maxAgeMs = Math.max(60_000, Number(process.env.DOCTOR_DEX_PROCESSED_TTL_MS || 6 * 60 * 60 * 1000));
      const rejectedRetryMs = Math.max(2_000, Number(process.env.DOCTOR_DEX_REJECTED_RETRY_MS || 20_000));
      for (const row of processed) {
        const mint = String(Array.isArray(row) ? row[0] : "").trim();
        const ts = Number(Array.isArray(row) ? row[1] : 0);
        if (!mint || !Number.isFinite(ts)) continue;
        if (nowMs - ts <= maxAgeMs) {
          doctorProcessedMints.set(mint, ts);
        }
      }
      for (const row of rejected) {
        const mint = String(Array.isArray(row) ? row[0] : "").trim();
        const ts = Number(Array.isArray(row) ? row[1] : 0);
        if (!mint || !Number.isFinite(ts)) continue;
        if (nowMs - ts <= rejectedRetryMs) {
          doctorRejectedMints.set(mint, ts);
        }
      }
      doctorSniperLogsByUser = new Map<string, Array<Record<string, any>>>();
      if (logsByUserPayload) {
        for (const [userId, rows] of Object.entries(logsByUserPayload)) {
          const scopedUserId = String(userId || "").trim();
          if (!scopedUserId || !Array.isArray(rows)) continue;
          doctorSniperLogsByUser.set(scopedUserId, rows.slice(0, 200));
        }
      } else if (legacyLogs.length > 0) {
        const scopedUserId = String(doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
        if (scopedUserId) {
          doctorSniperLogsByUser.set(scopedUserId, legacyLogs.slice(0, 200));
        }
      }
    } catch {
    }
  };

  const estimateLiquiditySolFromPair = (pair: Record<string, any>) => {
    const baseAddress = String(pair?.baseToken?.address || "").trim();
    const quoteAddress = String(pair?.quoteToken?.address || "").trim();
    const baseLiquidity = Number(pair?.liquidity?.base || 0);
    const quoteLiquidity = Number(pair?.liquidity?.quote || 0);
    const liquidityUsd = Number(pair?.liquidity?.usd || 0);
    const solPriceUsd = Math.max(1, Number(process.env.DOCTOR_SOL_PRICE_USD_DEFAULT || 150));

    if (baseAddress === SOL_MINT && Number.isFinite(baseLiquidity) && baseLiquidity > 0) return baseLiquidity;
    if (quoteAddress === SOL_MINT && Number.isFinite(quoteLiquidity) && quoteLiquidity > 0) return quoteLiquidity;
    return Number((liquidityUsd / solPriceUsd).toFixed(6));
  };

  const refreshDoctorWalletBalanceFromChain = async (address?: string, force = false) => {
    const walletAddress = String(address || doctorRuntime.wallet.address || "").trim();
    if (!walletAddress) return doctorRuntime.wallet.balanceSol;

    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(walletAddress);
    } catch {
      return doctorRuntime.wallet.balanceSol;
    }

    const nowMs = Date.now();
    const ttlMs = Math.max(1000, Number(process.env.DOCTOR_WALLET_BALANCE_CACHE_MS || 7000));
    if (!force && doctorWalletBalanceCache && doctorWalletBalanceCache.address === walletAddress && nowMs - doctorWalletBalanceCache.at < ttlMs) {
      doctorRuntime.wallet.balanceSol = doctorWalletBalanceCache.balanceSol;
      return doctorRuntime.wallet.balanceSol;
    }

    const walletBalanceTimeoutMs = Math.max(300, Number(process.env.DOCTOR_WALLET_BALANCE_TIMEOUT_MS || 1200));
    try {
      const lamports = await Promise.race<number>([
        getSolanaConnection().getBalance(pubkey, "processed"),
        new Promise<number>((_resolve, reject) => setTimeout(() => reject(new Error("wallet_balance_timeout")), walletBalanceTimeoutMs)),
      ]);
      const balanceSol = Number((lamports / 1_000_000_000).toFixed(6));
      doctorRuntime.wallet.balanceSol = Math.max(0, balanceSol);
      doctorWalletBalanceCache = {
        address: walletAddress,
        at: nowMs,
        balanceSol: doctorRuntime.wallet.balanceSol,
      };
    } catch {
    }

    return doctorRuntime.wallet.balanceSol;
  };

  const getDoctorLiveTokenBalanceSnapshot = async (walletAddress: string, mintAddress: string) => {
    const resolvedWallet = String(walletAddress || "").trim();
    const resolvedMint = String(mintAddress || "").trim();
    if (!resolvedWallet || !resolvedMint) {
      return {
        uiAmount: 0,
        amountRaw: "0",
        decimals: 0,
      };
    }

    try {
      const ownerPk = new PublicKey(resolvedWallet);
      const mintPk = new PublicKey(resolvedMint);
      const [legacyAccounts, token2022Accounts] = await Promise.all([
        getSolanaConnection().getParsedTokenAccountsByOwner(ownerPk, { mint: mintPk, programId: splTokenProgramId }, "confirmed").catch(() => ({ value: [] as Array<any> })),
        getSolanaConnection().getParsedTokenAccountsByOwner(ownerPk, { mint: mintPk, programId: splToken2022ProgramId }, "confirmed").catch(() => ({ value: [] as Array<any> })),
      ]);
      const mergedAccounts = [...legacyAccounts.value, ...token2022Accounts.value];
      let uiAmount = 0;
      let amountRawBigInt = BigInt(0);
      let decimals = 0;

      for (const entry of mergedAccounts) {
        const tokenAmount = (entry.account.data as any)?.parsed?.info?.tokenAmount as Record<string, any> | undefined;
        const parsedDecimals = Number(tokenAmount?.decimals || 0);
        if (Number.isFinite(parsedDecimals) && parsedDecimals >= 0) {
          decimals = Math.max(decimals, parsedDecimals);
        }
        const parsedRaw = String(tokenAmount?.amount || "0");
        try {
          const raw = BigInt(parsedRaw);
          amountRawBigInt += raw;
          const parsedUi = Number(tokenAmount?.uiAmount ?? tokenAmount?.uiAmountString ?? 0);
          if (Number.isFinite(parsedUi) && parsedUi > 0) {
            uiAmount += parsedUi;
          } else if (parsedDecimals >= 0) {
            uiAmount += Number(raw) / Math.pow(10, parsedDecimals);
          }
        } catch {
        }
      }

      return {
        balanceKnown: true,
        uiAmount: Math.max(0, Number(uiAmount || 0)),
        amountRaw: amountRawBigInt.toString(),
        decimals: Math.max(0, Math.trunc(decimals || 0)),
      };
    } catch {
      return {
        balanceKnown: false,
        uiAmount: 0,
        amountRaw: "0",
        decimals: 0,
      };
    }
  };

  const getDoctorLiveWalletTokenSnapshots = async (walletAddress: string, limit = 20, force = false) => {
    const resolvedWallet = String(walletAddress || "").trim();
    if (!resolvedWallet) return [] as Array<Record<string, any>>;

    const nowMs = Date.now();
    const ttlMs = Math.max(1500, Number(process.env.DOCTOR_WALLET_TOKENS_CACHE_MS || 10_000));
    if (!force && doctorWalletTokensCache && doctorWalletTokensCache.address === resolvedWallet && nowMs - doctorWalletTokensCache.at < ttlMs) {
      return doctorWalletTokensCache.tokens.slice(0, Math.max(1, Math.trunc(limit || 20)));
    }

    try {
      const ownerPk = new PublicKey(resolvedWallet);
      const [legacyAccounts, token2022Accounts] = await Promise.all([
        getSolanaConnection().getParsedTokenAccountsByOwner(ownerPk, { programId: splTokenProgramId }, "confirmed").catch(() => ({ value: [] as Array<any> })),
        getSolanaConnection().getParsedTokenAccountsByOwner(ownerPk, { programId: splToken2022ProgramId }, "confirmed").catch(() => ({ value: [] as Array<any> })),
      ]);
      const mergedAccounts = [...legacyAccounts.value, ...token2022Accounts.value];

      const tokenByMint = new Map<string, { raw: bigint; decimals: number; uiAmount: number }>();
      for (const entry of mergedAccounts) {
        const parsedInfo = (entry.account.data as any)?.parsed?.info as Record<string, any> | undefined;
        const tokenAmount = (parsedInfo?.tokenAmount || {}) as Record<string, any>;
        const mint = String(parsedInfo?.mint || "").trim();
        const amountRaw = String(tokenAmount?.amount || "0");
        const decimals = Math.max(0, Math.trunc(Number(tokenAmount?.decimals || 0)));
        if (!mint) continue;
        let raw = BigInt(0);
        try {
          raw = BigInt(amountRaw);
        } catch {
          continue;
        }
        if (raw <= BigInt(0)) continue;

        const existing = tokenByMint.get(mint) || { raw: BigInt(0), decimals, uiAmount: 0 };
        const parsedUi = Number(tokenAmount?.uiAmount ?? tokenAmount?.uiAmountString ?? 0);
        const uiValue = Number.isFinite(parsedUi) && parsedUi > 0
          ? parsedUi
          : (Number(raw) / Math.pow(10, decimals));
        tokenByMint.set(mint, {
          raw: existing.raw + raw,
          decimals: Math.max(existing.decimals, decimals),
          uiAmount: existing.uiAmount + Math.max(0, uiValue),
        });
      }

      const tokens: Array<Record<string, any>> = Array.from(tokenByMint.entries()).map(([mint, entry]) => {
        const uiAmount = entry.uiAmount > 0
          ? entry.uiAmount
          : (Number(entry.raw) / Math.pow(10, entry.decimals));
        return {
          mint,
          ui_amount: Number(uiAmount.toFixed(9)),
          amount_raw: entry.raw.toString(),
          decimals: entry.decimals,
        };
      });
      tokens.sort((a, b) => Number(b.ui_amount || 0) - Number(a.ui_amount || 0));

      doctorWalletTokensCache = {
        address: resolvedWallet,
        at: nowMs,
        tokens: tokens.slice(0, 80),
      };

      return tokens.slice(0, Math.max(1, Math.trunc(limit || 20)));
    } catch {
      return [] as Array<Record<string, any>>;
    }
  };

  const getDoctorWalletRecentTransactions = async (walletAddress: string, limit = 20, force = false) => {
    const resolvedWallet = String(walletAddress || "").trim();
    if (!resolvedWallet) return [] as Array<Record<string, any>>;

    const nowMs = Date.now();
    const ttlMs = Math.max(2000, Number(process.env.DOCTOR_WALLET_TX_CACHE_MS || 12_000));
    if (!force && doctorWalletTransactionsCache && doctorWalletTransactionsCache.address === resolvedWallet && nowMs - doctorWalletTransactionsCache.at < ttlMs) {
      return doctorWalletTransactionsCache.transactions.slice(0, Math.max(1, Math.trunc(limit || 20)));
    }

    try {
      const ownerPk = new PublicKey(resolvedWallet);
      const signatures = await getSolanaConnection().getSignaturesForAddress(ownerPk, { limit: Math.max(1, Math.min(40, Math.trunc(limit || 20))) }, "confirmed");
      const transactions = signatures.map((item) => ({
        signature: String(item.signature || ""),
        block_time: Number(item.blockTime || 0) > 0 ? new Date(Number(item.blockTime) * 1000).toISOString() : null,
        err: item.err || null,
        memo: item.memo || null,
        confirmation_status: String(item.confirmationStatus || "unknown"),
        explorer_url: String(item.signature || "") ? `https://solscan.io/tx/${item.signature}` : null,
      }));

      doctorWalletTransactionsCache = {
        address: resolvedWallet,
        at: nowMs,
        transactions,
      };

      return transactions;
    } catch {
      return [] as Array<Record<string, any>>;
    }
  };

  const runDoctorCycleSafely = async (trigger: "manual" | "auto", userId?: string) => {
    const normalizedUserId = String(userId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
    if (!normalizedUserId) return { ok: false, error: "missing_user_id" } as const;
    if (doctorCycleRunningByUser.has(normalizedUserId)) return { ok: false, error: "cycle_already_running" } as const;
    doctorCycleRunningByUser.add(normalizedUserId);
    let releaseGlobalLock: () => void = () => {};
    const previousGlobalLock = doctorCycleGlobalLock;
    doctorCycleGlobalLock = new Promise<void>((resolve) => {
      releaseGlobalLock = resolve;
    });
    try {
      await previousGlobalLock;
      await loadDoctorRuntimeForUser(normalizedUserId);
      await executeDoctorCycle(trigger, normalizedUserId);
      await persistDoctorRuntime(normalizedUserId);
      return { ok: true } as const;
    } catch (error) {
      const errorSummary = error instanceof Error
        ? `${String(error.name || "Error").trim()}: ${String(error.message || "").trim()}`.trim()
        : String(error || "").trim();
      doctorRuntime.lastError = errorSummary || "doctor_cycle_failed";
      doctorRuntime.lastDecision = {
        action: "skip",
        reason: doctorRuntime.lastError,
        trigger,
        at: nowIso(),
      };
      await persistDoctorRuntime(normalizedUserId);
      return { ok: false, error: doctorRuntime.lastError } as const;
    } finally {
      releaseGlobalLock();
      doctorCycleRunningByUser.delete(normalizedUserId);
    }
  };

  const stopDoctorCycleForUser = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;
    const existing = doctorCycleTimerByUser.get(normalizedUserId);
    if (existing) {
      clearInterval(existing);
      doctorCycleTimerByUser.delete(normalizedUserId);
    }
    await upsertDoctorSchedulerJob(normalizedUserId, false, 20, false);
  };

  const startDoctorCycleForUser = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;

    await stopDoctorCycleForUser(normalizedUserId);
    await loadDoctorRuntimeForUser(normalizedUserId);
    if (!doctorRuntime.enabled) {
      await upsertDoctorSchedulerJob(normalizedUserId, false, doctorRuntime.scanIntervalSeconds, false);
      return;
    }

    await upsertDoctorSchedulerJob(normalizedUserId, true, doctorRuntime.scanIntervalSeconds, true);
    await runDoctorSchedulerTick();
  };

  const runDoctorDexWorkerPoll = async () => {
    if (doctorDexWorkerRunning) return;
    doctorDexWorkerRunning = true;
    try {
      const nowMs = Date.now();
      const turboSnipeEnabled = String(process.env.DOCTOR_DEX_TURBO || "true").trim().toLowerCase() !== "false";
      const activeSnipePreset = getDoctorActiveSnipePreset();
      const maxPairAgeSeconds = Math.max(30, Number(process.env.DOCTOR_DEX_MAX_PAIR_AGE_SECONDS || 900));
      const minLiquiditySol = Math.max(0, Number(doctorRuntime.controls.min_liquidity_sol || 0.05));
      const effectiveMinLiquiditySol = turboSnipeEnabled ? 0 : minLiquiditySol;
      const maxLiquiditySol = Math.max(minLiquiditySol, Number(doctorRuntime.controls.max_liquidity_sol || 500));
      const minBuys5m = Math.max(1, Math.trunc(Number(doctorRuntime.controls.min_buys_5m || 1)));
      const maxSells5m = Math.max(0, Math.trunc(Number(doctorRuntime.controls.max_sells_5m || 50)));
      const minVolumeSol = Math.max(0, Number(process.env.DOCTOR_DEX_MIN_VOLUME_SOL || 0));
      const solPriceUsd = Math.max(1, Number(process.env.DOCTOR_SOL_PRICE_USD_DEFAULT || 150));
      const processedTtlMs = Math.max(60_000, Number(process.env.DOCTOR_DEX_PROCESSED_TTL_MS || 6 * 60 * 60 * 1000));
      const rejectedRetryMs = Math.max(2_000, Number(process.env.DOCTOR_DEX_REJECTED_RETRY_MS || 20_000));

      for (const [mint, ts] of Array.from(doctorProcessedMints.entries())) {
        if (nowMs - ts > processedTtlMs) {
          doctorProcessedMints.delete(mint);
        }
      }
      for (const [mint, ts] of Array.from(doctorRejectedMints.entries())) {
        if (nowMs - ts > rejectedRetryMs) {
          doctorRejectedMints.delete(mint);
        }
      }

      const pairs = await getNewPairs("solana", 1);
      const freshPairs = pairs
        .filter((pair) => String(pair?.chainId || "").toLowerCase() === "solana")
        .filter((pair) => {
          const createdAt = Number(pair?.pairCreatedAt || 0);
          if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
          return nowMs - createdAt <= maxPairAgeSeconds * 1000;
        })
        .sort((a, b) => Number(b.pairCreatedAt || 0) - Number(a.pairCreatedAt || 0))
        .slice(0, 150);

      for (const pair of freshPairs) {
        const mint = String(pair?.baseToken?.address || "").trim();
        if (!mint || doctorProcessedMints.has(mint)) continue;
        const rejectedAt = doctorRejectedMints.get(mint) || 0;
        if (rejectedAt > 0 && nowMs - rejectedAt <= rejectedRetryMs) {
          continue;
        }

        const liquiditySol = estimateLiquiditySolFromPair(pair as Record<string, any>);
        const buys5m = Number(pair?.txns?.m5?.buys || 0);
        const sells5m = Number(pair?.txns?.m5?.sells || 0);
        const volume5mUsd = Number(pair?.volume?.m5 || 0);
        const volume5mSol = volume5mUsd > 0 ? Number((volume5mUsd / solPriceUsd).toFixed(6)) : 0;
        const ageSeconds = Math.max(0, Math.trunc((nowMs - Number(pair?.pairCreatedAt || nowMs)) / 1000));
        const smartWalletDetected = Number(pair?.boosts?.active || 0) > 0 || (buys5m >= 6 && sells5m <= 1);
        const validLiquidity = liquiditySol >= effectiveMinLiquiditySol && liquiditySol <= maxLiquiditySol;
        const strongBuyDominance = buys5m >= Math.max(minBuys5m * 2, 10) && buys5m >= Math.max(1, sells5m) * 1.5;
        const turboBuyFlow = turboSnipeEnabled && buys5m >= 2 && buys5m >= Math.max(1, sells5m) * 1.2;
        const validPressure = (buys5m >= minBuys5m && sells5m <= maxSells5m) || strongBuyDominance || turboBuyFlow;
        const validVolume = volume5mSol >= minVolumeSol;
        const insiderFastTrack =
          activeSnipePreset === "insider" &&
          (liquiditySol > 0 || volume5mSol > 0 || buys5m >= 1);
        const failedChecks = [
          !validLiquidity ? "liquidity_window_failed" : null,
          !validPressure ? "buy_sell_pressure_failed" : null,
          !validVolume ? "volume_5m_failed" : null,
        ].filter(Boolean) as string[];
        const isCandidate = insiderFastTrack || (validLiquidity && validPressure && validVolume);
        const passReason = `${activeSnipePreset}_conditions_passed`;
        const failReason = `${activeSnipePreset}_conditions_failed`;

        appendDoctorSniperLog({
          event: isCandidate ? "detected" : "rejected",
          source: "dexscreener",
          symbol: String(pair?.baseToken?.symbol || "UNKNOWN"),
          mint,
          pair_address: String(pair?.pairAddress || ""),
          age_seconds: ageSeconds,
          liquidity_sol: liquiditySol,
          buys_5m: buys5m,
          sells_5m: sells5m,
          volume_5m_sol: volume5mSol,
          smart_wallet_detected: smartWalletDetected,
          reason: isCandidate ? passReason : failReason,
          failed_checks: failedChecks,
          preset: activeSnipePreset,
        });

        if (!isCandidate) {
          doctorRejectedMints.set(mint, nowMs);
          continue;
        }

        enqueueDoctorTickerSignal({
          mint,
          symbol: String(pair?.baseToken?.symbol || "UNKNOWN"),
          name: String(pair?.baseToken?.name || pair?.baseToken?.symbol || "TOKEN"),
          priceUsd: Number(pair?.priceUsd || 0),
          liquidityUsd: Number(pair?.liquidity?.usd || 0),
          volume5mUsd: Number(pair?.volume?.m5 || 0),
          ageMinutes: ageSeconds / 60,
          buys5m,
          sells5m,
          source: "dexscreener",
          launchSource: String(pair?.dexId || "dexscreener"),
          smartMoney: smartWalletDetected,
          rejectReasons: failedChecks,
        });

        doctorProcessedMints.set(mint, nowMs);
        doctorRejectedMints.delete(mint);

        const tokenData = pairToTokenData(pair);
        try {
          const existing = await storage.getScannedTokenByAddress(mint);
          if (existing?.id) {
            await storage.updateScannedToken(existing.id, tokenData as any);
          } else {
            await storage.createScannedToken(tokenData as any);
          }
        } catch {
        }
      }

      doctorDexWorkerLastPollAt = nowIso();
      await persistDoctorDexWorkerState();
      await runDoctorSchedulerTick();
    } catch (error) {
      doctorRuntime.lastError = error instanceof Error ? error.message : "doctor_dex_worker_failed";
    } finally {
      doctorDexWorkerRunning = false;
    }
  };

  const startDoctorDexWorker = () => {
    if (doctorDexWorkerTimer) {
      clearInterval(doctorDexWorkerTimer);
      doctorDexWorkerTimer = null;
    }

    const intervalSeconds = Math.max(2, Math.trunc(Number(process.env.DOCTOR_DEX_POLL_SECONDS || 3)));
    doctorDexWorkerTimer = setInterval(async () => {
      await runDoctorDexWorkerPoll();
    }, intervalSeconds * 1000);
    doctorDexWorkerTimer.unref?.();

    void runDoctorDexWorkerPoll();
  };

  const normalizeLaunchSource = (value: string) => {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("pump")) return "pumpfun";
    if (normalized.includes("ray")) return "raydium";
    if (normalized.includes("bonk")) return "bonk";
    if (normalized.includes("dex")) return "dexscreener";
    return "unknown";
  };

  const getAllowedLaunchSources = () => {
    const configuredRaw = String(process.env.DOCTORTRADE_ALLOWED_LAUNCH_SOURCES || "all").trim();
    const configuredItems = configuredRaw
      .split(",")
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);

    const allowAll =
      configuredItems.length === 0 ||
      configuredItems.includes("all") ||
      configuredItems.includes("*") ||
      configuredItems.includes("any");

    const normalized = configuredItems
      .map((item) => normalizeLaunchSource(item))
      .filter((item) => item !== "unknown");

    return {
      allowAll,
      allowed: new Set<string>(normalized),
    };
  };

  const isLaunchSourceAllowed = (launchSource: string) => {
    const { allowAll, allowed } = getAllowedLaunchSources();
    if (allowAll) return true;
    return allowed.has(normalizeLaunchSource(launchSource));
  };

  const getLiquidityLockLaunchGraceSeconds = () => {
    const graceMinutes = Math.max(0, Number(process.env.DOCTOR_LIQUIDITY_LOCK_LAUNCH_GRACE_MINUTES || 5));
    return Math.trunc(graceMinutes * 60);
  };

  const isLiquidityLockSatisfied = (
    requireLiquidityLock: boolean,
    liquidityLocked: boolean,
    ageSeconds: number,
    launchSource: string,
  ) => {
    if (!requireLiquidityLock || liquidityLocked) return true;
    const normalizedSource = normalizeLaunchSource(launchSource);
    const launchGraceSeconds = getLiquidityLockLaunchGraceSeconds();
    if (launchGraceSeconds <= 0) return false;
    const isKnownLaunch = normalizedSource !== "unknown";
    return isKnownLaunch && ageSeconds >= 0 && ageSeconds <= launchGraceSeconds;
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
    const earlyCacheTtlMs = Math.max(1000, Number(process.env.DOCTOR_EARLY_CACHE_MS || 5000));

    if (doctorEarlyScoredCache && nowMs - doctorEarlyScoredCache.at < earlyCacheTtlMs) {
      return doctorEarlyScoredCache.tokens
        .filter((token) => Number(token.age_seconds || 0) <= windowSeconds)
        .slice(0, cappedLimit);
    }

    const scanned = await (async () => {
      try {
        return await storage.getScannedTokens();
      } catch {
        return [] as Array<Record<string, any>>;
      }
    })();
    const scannedTokens = scanned
      .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
      .map((token) => {
        const createdAt = token.createdAt ? new Date(token.createdAt) : new Date();
        const firstSeenAt = Number.isNaN(createdAt.getTime()) ? nowIso() : createdAt.toISOString();
        const launchSource = normalizeLaunchSource(String((token as any).dexId || "scanner"));
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
          liquidity_locked: Boolean((token as any).isLiquidityLocked) || launchSource === "raydium" || launchSource === "bonk",
          launch_source: launchSource,
        };
      })
      .filter((token) => token.mint);

    const apifyTokens = await (async () => {
      const rows = await getMergedFreshPumpfunTokens(10);
      return rows
        .map((token) => {
          const raw = (token.raw || {}) as Record<string, unknown>;
          const createdAtRaw = String(raw.discoveredAt || raw.created_at || raw.createdAt || raw.timestamp || "").trim();
          const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date();
          const firstSeenAt = Number.isNaN(createdAt.getTime()) ? nowIso() : createdAt.toISOString();
          const volume24h = Number(raw.volume24h || raw.volume_24h || 0);
          const launchSource = normalizeLaunchSource(String(raw.sourcePlatform || raw.source_platform || token.eventType || "pumpfun"));
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
            liquidity_locked: Boolean(raw.isLiquidityLocked || raw.liquidity_locked || raw.lpLocked) || launchSource === "raydium" || launchSource === "bonk",
            launch_source: launchSource,
          };
        })
        .filter((token) => token.mint);
    })();

    const dexscreenerTokens = await (async () => {
      try {
        const dexscreenerLookbackHours = 6;
        const dexscreenerMaxPairs = 240;

        const pairs = await getNewPairs("solana", dexscreenerLookbackHours);
        return pairs
          .slice(0, dexscreenerMaxPairs)
          .map((pair) => {
            const token = pairToTokenData(pair);
            const createdAtMs = Number(pair.pairCreatedAt || 0);
            const createdAt = createdAtMs > 0 ? new Date(createdAtMs) : new Date();
            const firstSeenAt = Number.isNaN(createdAt.getTime()) ? nowIso() : createdAt.toISOString();
            const launchSource = normalizeLaunchSource(String(token.dexId || pair.dexId || "dexscreener"));
            return {
              mint: String(token.address || pair.baseToken?.address || "").trim(),
              symbol: String(token.symbol || pair.baseToken?.symbol || "UNKNOWN"),
              name: String(token.name || pair.baseToken?.name || "Unknown"),
              source: "dexscreener",
              first_seen_at: firstSeenAt,
              liquidity_usd: Number(token.liquidity || pair.liquidity?.usd || 0),
              market_cap_usd: Number(token.marketCap || pair.marketCap || pair.fdv || 0),
              volume_24h: Number(token.volume24h || pair.volume?.h24 || 0),
              volume_5m: Number(pair.volume?.m5 || 0),
              buys_5m: Number(pair.txns?.m5?.buys || 0),
              sells_5m: Number(pair.txns?.m5?.sells || 0),
              liquidity_sol: estimateLiquiditySolFromPair(pair as Record<string, any>),
              buy_ratio_pct: Number((((Number(pair.txns?.m5?.buys || 0) + 1) / Math.max(1, Number(pair.txns?.m5?.buys || 0) + Number(pair.txns?.m5?.sells || 0) + 2)) * 100).toFixed(2)),
              holders_count: 0,
              top_holder_pct: 0,
              dev_wallet_pct: 0,
              price_change_1h: Number(pair.priceChange?.h1 || 0),
              price_usd: Number(token.priceUsd || pair.priceUsd || 0),
              liquidity_locked: launchSource === "raydium" || launchSource === "bonk",
              launch_source: launchSource,
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
    for (const token of [...dexscreenerTokens, ...raydiumTokens, ...apifyTokens, ...scannedTokens]) {
      const tokenAny = token as Record<string, any>;
      const mint = String(token.mint || "").trim();
      if (!mint) continue;
      const prev = byMint.get(mint);
      if (!prev) {
        byMint.set(mint, tokenAny);
        continue;
      }
      const prevSeen = new Date(String(prev.first_seen_at || "")).getTime();
      const nextSeen = new Date(String(token.first_seen_at || "")).getTime();
      byMint.set(mint, {
        ...prev,
        ...tokenAny,
        first_seen_at: prevSeen > 0 && nextSeen > 0 ? new Date(Math.min(prevSeen, nextSeen)).toISOString() : prev.first_seen_at,
        liquidity_usd: Math.max(Number(prev.liquidity_usd || 0), Number(tokenAny.liquidity_usd || 0)),
        market_cap_usd: Math.max(Number(prev.market_cap_usd || 0), Number(tokenAny.market_cap_usd || 0)),
        volume_24h: Math.max(Number(prev.volume_24h || 0), Number(tokenAny.volume_24h || 0)),
        volume_5m: Math.max(Number(prev.volume_5m || 0), Number(tokenAny.volume_5m || 0)),
        buys_5m: Math.max(Number(prev.buys_5m || 0), Number(tokenAny.buys_5m || 0)),
        sells_5m: Math.max(Number(prev.sells_5m || 0), Number(tokenAny.sells_5m || 0)),
        buy_ratio_pct: Math.max(Number(prev.buy_ratio_pct || 0), Number(tokenAny.buy_ratio_pct || 0)),
        liquidity_sol: Math.max(Number(prev.liquidity_sol || 0), Number(tokenAny.liquidity_sol || 0)),
        holders_count: Math.max(Number(prev.holders_count || 0), Number(tokenAny.holders_count || 0)),
        top_holder_pct: Number(tokenAny.top_holder_pct || prev.top_holder_pct || 0),
        dev_wallet_pct: Number(tokenAny.dev_wallet_pct || prev.dev_wallet_pct || 0),
        liquidity_locked: Boolean(tokenAny.liquidity_locked || prev.liquidity_locked),
        launch_source: normalizeLaunchSource(String(tokenAny.launch_source || prev.launch_source || prev.source || "unknown")),
        source: prev.source === "apify" || tokenAny.source === "apify" ? "apify+scanner" : prev.source,
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
        const buyRatioPct = Number(token.buy_ratio_pct || 0);
        const liquiditySol = Number(token.liquidity_sol || 0);
        const buys5m = Number(token.buys_5m || 0);
        const sells5m = Number(token.sells_5m || 0);
        const holdersCount = Number(token.holders_count || 0);
        const topHolderPct = Number(token.top_holder_pct || 0);
        const priceChange1h = Number(token.price_change_1h || 0);
        const liquidityLocked = Boolean(token.liquidity_locked);
        const requireLiquidityLock = Math.max(0, Number(doctorRuntime.controls.min_lock_hours ?? 24)) > 0;
        const launchSource = normalizeLaunchSource(String(token.launch_source || token.source || "unknown"));
        const liquidityLockPass = isLiquidityLockSatisfied(requireLiquidityLock, liquidityLocked, ageSeconds, launchSource);

        const freshnessScore = Math.max(0, 40 * (1 - Math.min(ageSeconds, windowSeconds) / Math.max(1, windowSeconds)));
        const liquidityScore = Math.max(0, Math.min(25, (liquidityUsd / 25_000) * 25));
        const holderScore = Math.max(0, Math.min(15, (holdersCount / 500) * 15));
        const concentrationScore = topHolderPct > 0 ? Math.max(0, Math.min(10, ((45 - topHolderPct) / 45) * 10)) : 5;
        const momentumScore = Math.max(0, Math.min(10, ((volume5m / 2500) * 5) + (priceChange1h > 0 ? Math.min(5, priceChange1h / 2) : 0)));
        const confidenceScore = Number((freshnessScore + liquidityScore + holderScore + concentrationScore + momentumScore).toFixed(2));

        const rejectReasons: string[] = [];
        const minBuys5m = Math.max(1, Math.trunc(Number(doctorRuntime.controls.min_buys_5m || 3)));
        const maxSells5m = Math.max(0, Math.trunc(Number(doctorRuntime.controls.max_sells_5m || 1)));
        const maxTokenAgeSecondsControlRaw = Math.max(30, Number(doctorRuntime.controls.max_token_age_seconds || 240));
        const maxTokenAgeSecondsControl = isDoctorDexTurboEnabled()
          ? Math.max(120, maxTokenAgeSecondsControlRaw)
          : maxTokenAgeSecondsControlRaw;
        const minLiquiditySol = Math.max(0.1, Number(doctorRuntime.controls.min_liquidity_sol || 2));
        const maxLiquiditySol = Math.max(minLiquiditySol, Number(doctorRuntime.controls.max_liquidity_sol || 50));
        if (ageSeconds > windowSeconds) rejectReasons.push("outside_window");
        if (ageSeconds > maxTokenAgeSecondsControl) rejectReasons.push("above_sniper_max_age");
        if (ageSeconds < Math.max(0, Math.trunc(Number(doctorRuntime.controls.min_token_age_minutes || 0))) * 60) rejectReasons.push("below_min_age");
        const minLiquidityUsdThreshold = Math.max(100, Number(doctorRuntime.controls.min_liquidity_usd || 300));
        if (liquidityUsd < minLiquidityUsdThreshold) rejectReasons.push("low_liquidity");
        if (liquiditySol > 0 && liquiditySol < minLiquiditySol) rejectReasons.push("below_min_liquidity_sol");
        if (liquiditySol > maxLiquiditySol) rejectReasons.push("above_max_liquidity_sol");
        if (buys5m > 0 && buys5m < minBuys5m) rejectReasons.push("insufficient_buys_5m");
        if (sells5m > maxSells5m) rejectReasons.push("excess_sells_5m");
        if (marketCapUsd < Math.max(1, Number(doctorRuntime.controls.min_market_cap_usd || 15000))) rejectReasons.push("low_market_cap");
        if (volume24h < Math.max(1, Number(doctorRuntime.controls.min_volume_24h_usd || 12000))) rejectReasons.push("low_volume_24h");
        if (Number(token.dev_wallet_pct || 0) <= 0) rejectReasons.push("dev_commitment_missing");
        if (topHolderPct > 65) rejectReasons.push("holder_concentration_high");
        if (!liquidityLockPass) rejectReasons.push("liquidity_not_locked");
        if (buyRatioPct > 0 && buyRatioPct < Math.max(1, Number(doctorRuntime.controls.min_buy_ratio_pct || 65))) rejectReasons.push("buy_ratio_below_threshold");
        if (!isLaunchSourceAllowed(launchSource)) rejectReasons.push("launch_source_not_allowed");
        if (confidenceScore < 45) rejectReasons.push("confidence_below_threshold");

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
    const strictApproved = early
      .filter((token) => Boolean(token.eligible))
      .filter((token) => Number(token.liquidity_usd || 0) >= Number(doctorRuntime.controls.min_liquidity_usd || 0))
      .map((token: any) => {
        const score = Number(token.confidence_score || 0);
        return {
          symbol: String(token.symbol || "UNKNOWN"),
          address: String(token.mint || ""),
          liquidity: Number(token.liquidity_usd || 0),
          volume_5m: Number(token.volume_5m || 0),
          buy_ratio_pct: Number(token.buy_ratio_pct || 0),
          buys_5m: Number(token.buys_5m || 0),
          sells_5m: Number(token.sells_5m || 0),
          liquidity_sol: Number(token.liquidity_sol || 0),
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
          eligible: true,
          safety_tier: "strict",
        };
      })
      .slice(0, 40);

    const targetApproved = Math.max(5, Math.min(15, Math.trunc(Number(process.env.DOCTOR_APPROVED_TARGET || 15))));
    if (strictApproved.length >= targetApproved) {
      return strictApproved;
    }

    const criticalRejectReasons = isDoctorDexTurboEnabled()
      ? new Set<string>([])
      : new Set<string>([
        "low_liquidity",
      ]);

    const strictAddresses = new Set(strictApproved.map((token) => String(token.address || "")));

    const softApproved = early
      .filter((token) => !strictAddresses.has(String((token as any).mint || "")))
      .filter((token) => Number((token as any).liquidity_usd || 0) >= Math.max(100, Number(doctorRuntime.controls.min_liquidity_usd || 300) * 0.5))
      .filter((token: any) => {
        const reasons = Array.isArray(token.reject_reasons) ? token.reject_reasons.map((item: unknown) => String(item || "")) : [];
        return !reasons.some((reason: string) => criticalRejectReasons.has(reason));
      })
      .map((token: any) => {
        const score = Number(token.confidence_score || 0);
        const reasons = Array.isArray(token.reject_reasons) ? token.reject_reasons : [];
        return {
          symbol: String(token.symbol || "UNKNOWN"),
          address: String(token.mint || ""),
          liquidity: Number(token.liquidity_usd || 0),
          volume_5m: Number(token.volume_5m || 0),
          buy_ratio_pct: Number(token.buy_ratio_pct || 0),
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
          reject_reasons: reasons,
          eligible: false,
          safety_tier: "soft",
          soft_reason_count: reasons.length,
        };
      })
      .sort((a, b) => {
        const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(a.soft_reason_count || 0) - Number(b.soft_reason_count || 0);
      })
      .slice(0, Math.max(0, targetApproved - strictApproved.length));

    return [...strictApproved, ...softApproved].slice(0, 40);
  };

  const resolveCurrentPriceUsd = (token: Record<string, any>, fallbackPriceUsd: number) => {
    const tokenPrice = Number(token?.price_usd || 0);
    if (Number.isFinite(tokenPrice) && tokenPrice > 0) return tokenPrice;
    return Number(fallbackPriceUsd || 0);
  };

  const resolveDoctorPositionMarketSnapshot = async (
    mint: string,
    existing: Record<string, any> | null,
  ) => {
    const normalizedMint = String(mint || "").trim();
    if (!normalizedMint) return existing;

    if (existing && Number(existing.price_usd || 0) > 0) {
      return existing;
    }

    try {
      const pairs = await getTokenPairsFast(normalizedMint);
      const bestPair = pairs.find((pair) => String(pair.chainId || "").toLowerCase() === "solana") || pairs[0];
      if (!bestPair) return existing;
      const mapped = pairToTokenData(bestPair);
      return {
        ...(existing || {}),
        address: normalizedMint,
        symbol: String((existing as any)?.symbol || (mapped as any)?.symbol || bestPair.baseToken?.symbol || "UNKNOWN"),
        price_usd: Number((mapped as any)?.priceUsd || bestPair.priceUsd || (existing as any)?.price_usd || 0),
        liquidity: Number((mapped as any)?.liquidity || bestPair?.liquidity?.usd || (existing as any)?.liquidity || 0),
        volume_5m: Number(bestPair?.volume?.m5 || (existing as any)?.volume_5m || 0),
        score: Number((existing as any)?.score || 0),
        holders_count: Number((existing as any)?.holders_count || 0),
        top_holder_pct: Number((existing as any)?.top_holder_pct || 0),
      };
    } catch {
      return existing;
    }
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

  const pruneDoctorRecentExecutionState = (nowMs = Date.now()) => {
    const retentionHours = Math.max(1, Number(process.env.DOCTORTRADE_RECENT_RETENTION_HOURS || 24));
    const retentionMs = retentionHours * 60 * 60 * 1000;
    const isFresh = (value: unknown) => {
      const ts = new Date(String(value || "")).getTime();
      if (!Number.isFinite(ts) || ts <= 0) return false;
      return nowMs - ts <= retentionMs;
    };

    doctorRuntime.recentTrades = doctorRuntime.recentTrades.filter((trade) => isFresh((trade as any).timestamp)).slice(0, 50);
    doctorRuntime.executionAudit = doctorRuntime.executionAudit.filter((item) => isFresh((item as any).at)).slice(0, 200);
    doctorRuntime.decisionJournal = doctorRuntime.decisionJournal.filter((item) => isFresh((item as any).timestamp)).slice(0, 80);

    const rollingDayMs = 24 * 60 * 60 * 1000;
    const activeExecutionMode = String(doctorRuntime.execution.mode || "paper").trim().toLowerCase();
    const buysLast24h = doctorRuntime.recentTrades.filter((trade) => {
      if (String((trade as any).action || "").toUpperCase() !== "BUY") return false;
      const tradeExecutionMode = String((trade as any).execution_mode || "").trim().toLowerCase();
      if (tradeExecutionMode && tradeExecutionMode !== activeExecutionMode) return false;
      const ts = new Date(String((trade as any).timestamp || "")).getTime();
      return Number.isFinite(ts) && ts > 0 && nowMs - ts <= rollingDayMs;
    }).length;
    doctorRuntime.controls.trades_today = buysLast24h;
  };

  const normalizeDoctorPositionExecutionMode = (position: Record<string, any>) => {
    const explicitMode = String((position as any).execution_mode || "").trim().toLowerCase();
    if (explicitMode === "paper" || explicitMode === "live") {
      return explicitMode as "paper" | "live";
    }

    const address = String(position.address || "").trim();
    if (!address) return "live" as const;

    const relatedBuy = doctorRuntime.recentTrades.find((trade) => {
      return String((trade as any).address || "").trim() === address
        && String((trade as any).action || "").toUpperCase() === "BUY";
    });

    const inferredMode = String((relatedBuy as any)?.execution_mode || "").trim().toLowerCase();
    if (inferredMode === "paper" || inferredMode === "live") {
      return inferredMode as "paper" | "live";
    }

    const txHash = String((relatedBuy as any)?.tx_hash || "").trim().toLowerCase();
    if (txHash.startsWith("paper_")) {
      return "paper" as const;
    }

    return "live" as const;
  };

  const getDoctorPositionRotationMinutes = () => {
    const configured = Number((doctorRuntime.controls as any).position_rotation_minutes ?? process.env.DOCTOR_POSITION_ROTATION_MINUTES ?? 1);
    return Math.max(0.25, configured);
  };

  const clampDoctorPaperBalance = () => {
    if (doctorRuntime.execution.mode !== "paper") return;
    const normalized = Math.max(0, Number(doctorRuntime.wallet.balanceSol || 0));
    doctorRuntime.wallet.balanceSol = Number(normalized.toFixed(6));
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

  const normalizeDoctorMint = (value: string) => String(value || "").trim();

  const hasDoctorBoughtMintBefore = (mint: string) => {
    const normalizedMint = normalizeDoctorMint(mint);
    if (!normalizedMint) return false;

    if (Array.isArray(doctorRuntime.boughtMints) && doctorRuntime.boughtMints.includes(normalizedMint)) {
      return true;
    }

    const tradedBefore = doctorRuntime.recentTrades.some((trade) => {
      const action = String((trade as any)?.action || "").trim().toUpperCase();
      const address = normalizeDoctorMint(String((trade as any)?.address || ""));
      return action === "BUY" && address === normalizedMint;
    });
    if (tradedBefore) return true;

    const auditedBefore = doctorRuntime.executionAudit.some((entry) => {
      const action = String((entry as any)?.action || "").trim().toLowerCase();
      const tokenMint = normalizeDoctorMint(String((entry as any)?.mint || ""));
      const status = String((entry as any)?.status || "").trim().toLowerCase();
      return action === "buy" && tokenMint === normalizedMint && (status === "executed" || status === "simulated");
    });
    return auditedBefore;
  };

  const markDoctorMintAsBought = (mint: string) => {
    const normalizedMint = normalizeDoctorMint(mint);
    if (!normalizedMint) return;
    if (!Array.isArray(doctorRuntime.boughtMints)) {
      doctorRuntime.boughtMints = [];
    }
    if (!doctorRuntime.boughtMints.includes(normalizedMint)) {
      doctorRuntime.boughtMints.unshift(normalizedMint);
      doctorRuntime.boughtMints = doctorRuntime.boughtMints.slice(0, 500);
    }
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
      priorityFeeLamports: Math.max(
        0,
        Math.trunc(Number(doctorRuntime.controls.gas_priority_lamports || process.env.DOCTORTRADE_PRIORITY_FEE_LAMPORTS || 0)),
      ),
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

  const deriveSolanaAddressFromPrivateKey = (value: string): string => {
    const secretKey = parseSolanaSecretKey(value);
    if (!secretKey) return "";
    try {
      if (secretKey.length >= 64) {
        return Keypair.fromSecretKey(secretKey.slice(0, 64)).publicKey.toBase58();
      }
      if (secretKey.length === 32) {
        return Keypair.fromSeed(secretKey).publicKey.toBase58();
      }
      return "";
    } catch {
      return "";
    }
  };

  const executeDoctorOrder = async (params: {
    action: "buy" | "sell";
    symbol: string;
    mint: string;
    amountSol: number;
    expectedPriceUsd: number;
    reason: string;
    trigger: "manual" | "auto";
    userId?: string;
    baseMint?: string;
    sellFractionPct?: number;
  }) => {
    if (params.action === "buy" && hasDoctorBoughtMintBefore(params.mint)) {
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
        block_reason: "duplicate_buy_blocked",
      });
      return {
        executed: false,
        status: "blocked",
        reason: "duplicate_buy_blocked",
      } as const;
    }

    const liveEnabled = isDoctorLiveTradingEnabled();
    const liveOnly = isDoctorLiveOnlyMode();
    const scopedUserId = String(params.userId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();

    if (params.trigger === "auto") {
      const autoEnabled = await isDoctorAutoTradingEnabledForUser(scopedUserId);
      if (!autoEnabled) {
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
          block_reason: "doctortrade_disabled",
        });
        return {
          executed: false,
          status: "blocked",
          reason: "doctortrade_disabled",
        } as const;
      }
    }

    const liveCredentials = await getDoctorLiveWalletCredentials(scopedUserId || undefined);
    const hasLiveCredentials = Boolean(String(liveCredentials.walletPublicKey || "").trim())
      && Boolean(String(liveCredentials.walletPrivateKey || "").trim());
    const mode = (liveOnly || doctorRuntime.execution.mode === "live" || hasLiveCredentials) ? "live" : "paper";

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

      const { walletPublicKey, walletPrivateKey } = liveCredentials;
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

          const configuredSellFraction = Math.max(
            1,
            Math.min(100, Number((params.sellFractionPct ?? doctorRuntime.controls.live_sell_fraction_pct) || 100)),
          );
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
          invalidateDoctorWalletCaches(walletPublicKey);
          await refreshDoctorWalletBalanceFromChain(walletPublicKey, true).catch(() => Number(doctorRuntime.wallet.balanceSol || 0));

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
        const feeBufferSol = Math.max(0, Number(doctorRuntime.controls.min_wallet_fee_buffer_sol || 0));
        const estimatedFeeSol = Number((Math.max(0.000005, Number(doctorRuntime.controls.gas_priority_lamports || 0) / 1_000_000_000) + 0.00002).toFixed(6));
        let effectiveAmountSol = Math.max(0, Number(params.amountSol || 0));
        if (tradeBaseMint === SOL_MINT) {
          const availableSol = Math.max(0, Number(doctorRuntime.wallet.balanceSol || 0));
          const maxSpendableSol = Math.max(0, availableSol - feeBufferSol - estimatedFeeSol);
          effectiveAmountSol = Math.min(effectiveAmountSol, maxSpendableSol);
          effectiveAmountSol = Number(effectiveAmountSol.toFixed(6));
          if (effectiveAmountSol < 0.0001) {
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
              block_reason: "insufficient_sol_for_swap_fees",
              router: "raydium",
              available_sol: availableSol,
              required_sol: Number((params.amountSol + feeBufferSol + estimatedFeeSol).toFixed(6)),
            });
            return {
              executed: false,
              status: "blocked",
              reason: "insufficient_sol_for_swap_fees",
            } as const;
          }
        }

        const effectiveAmountLamports = Math.max(1, Math.trunc(effectiveAmountSol * Math.pow(10, baseDecimals)));
        const quote = await fetchJupiterQuote({
          inputMint: tradeBaseMint,
          outputMint: params.mint,
          amountAtomic: effectiveAmountLamports,
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
          trade_amount: effectiveAmountSol,
          entry_price: params.expectedPriceUsd,
          transaction_signature: signature,
          base_asset_mint: tradeBaseMint,
          timestamp: nowIso(),
        });
        invalidateDoctorWalletCaches(walletPublicKey);
        await refreshDoctorWalletBalanceFromChain(walletPublicKey, true).catch(() => Number(doctorRuntime.wallet.balanceSol || 0));
        return {
          executed: true,
          status: "executed",
          txHash: signature,
          executedAmountSol: effectiveAmountSol,
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

    if (params.trigger === "auto") {
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
        block_reason: "auto_trade_requires_live_mode",
      });
      return {
        executed: false,
        status: "blocked",
        reason: "auto_trade_requires_live_mode",
      } as const;
    }

    if (liveOnly) {
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
        block_reason: "live_only_mode_requires_onchain_execution",
      });
      return {
        executed: false,
        status: "blocked",
        reason: "live_only_mode_requires_onchain_execution",
      } as const;
    }

    const paperTxHash = `paper_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    appendDoctorExecutionAudit({
      action: params.action,
      symbol: params.symbol,
      mint: params.mint,
      amount_sol: params.amountSol,
      expected_price_usd: params.expectedPriceUsd,
      expected_notional_usd: Number((params.amountSol * params.expectedPriceUsd).toFixed(2)),
      trigger: params.trigger,
      reason: params.reason,
      status: "simulated",
      router: "paper",
      tx_hash: paperTxHash,
    });
    await appendDoctorTradeLog({
      token_address: params.mint,
      pool_address: null,
      trade_amount: params.amountSol,
      entry_price: params.expectedPriceUsd,
      transaction_signature: paperTxHash,
      base_asset_mint: String(params.baseMint || getDoctorTradeBaseAssetMint()),
      timestamp: nowIso(),
    });

    return {
      executed: true,
      status: "executed",
      txHash: paperTxHash,
      executedAmountSol: params.amountSol,
    } as const;
  };

  const executeDoctorCycle = async (trigger: "manual" | "auto" = "manual", userId?: string) => {
    doctorRuntime.lastRunAt = nowIso();
    const scopedUserId = String(userId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();

    await ensureDoctorOwnerAndWalletHydrated(scopedUserId);
    const liveCredentials = await getDoctorLiveWalletCredentials(scopedUserId);
    const resolvedWalletAddress = String(liveCredentials.walletPublicKey || doctorRuntime.wallet.address || "").trim();
    if (resolvedWalletAddress) {
      doctorRuntime.wallet.address = resolvedWalletAddress;
    }

    await ensureDoctorLiveExecutionModeIfCapable(scopedUserId);
    await refreshDoctorWalletBalanceFromChain();
    clampDoctorPaperBalance();

    // Self-heal transient enabled drift: if auto scheduler is active for this user,
    // runtime should not remain disabled unless kill switch is explicitly on.
    if (!doctorRuntime.enabled && trigger === "auto" && scopedUserId && !doctorRuntime.killSwitch) {
      const schedulerJob = await getDoctorSchedulerJobForUser(scopedUserId);
      if (Boolean(schedulerJob?.enabled)) {
        doctorRuntime.enabled = true;
        doctorRuntime.lastError = null;
      }
    }

    if (!doctorRuntime.enabled) {
      doctorRuntime.lastDecision = { action: "skip", reason: "doctortrade_disabled", trigger, at: nowIso() };
      return { executed: false, reason: "doctortrade_disabled", trigger };
    }
    if (doctorRuntime.killSwitch) {
      doctorRuntime.lastDecision = { action: "skip", reason: "kill_switch_enabled", trigger, at: nowIso() };
      return { executed: false, reason: "kill_switch_enabled", trigger };
    }
    const requiresLiveWallet = isDoctorLiveOnlyMode() || doctorRuntime.execution.mode === "live";
    if (requiresLiveWallet && !doctorRuntime.wallet.address) {
      doctorRuntime.lastDecision = { action: "skip", reason: "live_wallet_credentials_missing", trigger, at: nowIso() };
      return { executed: false, reason: "live_wallet_credentials_missing", trigger };
    }

    const activeTokens = await getDoctorActiveTokens();
    const tokenMap = new Map(activeTokens.map((token) => [String(token.address || ""), token]));
    const nowMs = Date.now();
    pruneDoctorRecentExecutionState(nowMs);

    if (doctorRuntime.execution.mode === "live" && doctorRuntime.positions.length > 0) {
      const retainedPositions: Array<Record<string, any>> = [];
      const liveWalletAddress = String(doctorRuntime.wallet.address || "").trim();
      for (const position of doctorRuntime.positions) {
        const executionMode = normalizeDoctorPositionExecutionMode(position);
        if (executionMode === "paper") {
          const symbol = String(position.symbol || "UNKNOWN");
          const address = String(position.address || "");
          doctorRuntime.decisionJournal.unshift({
            token: symbol,
            address,
            decision: "skip",
            reason: "paper_position_removed_for_live_mode",
            confidence: Number((position as any).confidence || 0),
            size_pct: Number((position as any).size_pct || 0),
            strategy_mode: "autonomous",
            timestamp: nowIso(),
          });
          appendDoctorExecutionAudit({
            action: "sell",
            symbol,
            mint: address,
            amount_sol: Number(position.amount_sol || 0),
            expected_price_usd: Number(position.current_price || position.entry_price || 0),
            expected_notional_usd: 0,
            trigger,
            reason: "paper_position_removed_for_live_mode",
            status: "skipped",
            router: "state_cleanup",
          });
          continue;
        }

        const positionMint = String(position.address || "").trim();
        if (liveWalletAddress && positionMint) {
          const liveBalance = await getDoctorLiveTokenBalanceSnapshot(liveWalletAddress, positionMint);
          if (liveBalance.balanceKnown && !(liveBalance.uiAmount > 0)) {
            const symbol = String(position.symbol || "UNKNOWN");
            doctorRuntime.decisionJournal.unshift({
              token: symbol,
              address: positionMint,
              decision: "skip",
              reason: "live_position_pruned_zero_balance",
              confidence: Number((position as any).confidence || 0),
              size_pct: Number((position as any).size_pct || 0),
              strategy_mode: "autonomous",
              timestamp: nowIso(),
            });
            appendDoctorExecutionAudit({
              action: "sell",
              symbol,
              mint: positionMint,
              amount_sol: Number(position.amount_sol || 0),
              expected_price_usd: Number(position.current_price || position.entry_price || 0),
              expected_notional_usd: 0,
              trigger,
              reason: "live_position_pruned_zero_balance",
              status: "skipped",
              router: "state_cleanup",
            });
            continue;
          }
        }

        retainedPositions.push({
          ...position,
          execution_mode: "live",
        });
      }
      doctorRuntime.positions = retainedPositions.slice(0, 30);
      doctorRuntime.decisionJournal = doctorRuntime.decisionJournal.slice(0, 80);
    }

    const { dailyRealizedPnlUsd, consecutiveLosses } = computeDoctorRiskMetrics(nowMs);

    let sellCount = 0;
    const updatedPositions: Array<Record<string, any>> = [];
    const maxOpenPositions = getDoctorEffectiveMaxOpenPositions();
    const configuredMinProfitPct = Math.max(0.1, getDoctorEffectiveControlNumber("min_profit_pct", Number(doctorRuntime.controls.min_profit_pct || 0)));
    const configuredTakeProfitMultiplier = Math.max(1.01, getDoctorEffectiveControlNumber("take_profit_multiplier", Number(doctorRuntime.controls.take_profit_multiplier || 2)));
    const configuredStopLossPct = Math.max(0.1, getDoctorEffectiveControlNumber("stop_loss_pct", Number(doctorRuntime.controls.stop_loss_pct || 0)));
    const configuredTrailingStopPct = Math.max(0.1, getDoctorEffectiveControlNumber("trailing_stop_pct", Number(doctorRuntime.controls.trailing_stop_pct || 0)));
    const configuredMaxHoldMinutes = Math.max(5, getDoctorEffectiveControlNumber("max_hold_minutes", Number(doctorRuntime.controls.max_hold_minutes || 0)));
    const configuredLiveSellFractionPct = Math.max(1, Math.min(100, getDoctorEffectiveControlNumber("live_sell_fraction_pct", Number(doctorRuntime.controls.live_sell_fraction_pct || 100))));
    const configuredMinMomentumProfitPct = Math.max(0, getDoctorEffectiveControlNumber("min_momentum_profit_pct", Number(doctorRuntime.controls.min_momentum_profit_pct || 0)));
    const configuredStrongMoveThresholdPct = Math.max(1, getDoctorEffectiveControlNumber("strong_move_threshold_pct", Number(doctorRuntime.controls.strong_move_threshold_pct || 40)));
    const configuredMaxTopHolderPct = Math.max(1, getDoctorEffectiveControlNumber("quality_max_top_holder_pct", Number(doctorRuntime.controls.quality_max_top_holder_pct || 24)));
    const takeProfitPct = Math.max(
      configuredMinProfitPct,
      (configuredTakeProfitMultiplier - 1) * 100,
    );
    const firstTakeProfitStagePct = Math.max(
      configuredMinMomentumProfitPct,
      Math.min(30, takeProfitPct * 0.5),
    );
    const secondTakeProfitStagePct = Math.max(
      firstTakeProfitStagePct + 10,
      Math.min(70, takeProfitPct * 0.8),
    );

    for (let positionIndex = 0; positionIndex < doctorRuntime.positions.length; positionIndex += 1) {
      const position = doctorRuntime.positions[positionIndex];
      const positionMint = String(position.address || "").trim();
      const market = await resolveDoctorPositionMarketSnapshot(positionMint, tokenMap.get(positionMint) || null);
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
      const tpStage = Math.max(0, Math.trunc(Number((position as any).tp_stage || 0)));

      let sellReason = "";
      let sellFractionPct = 100;
      if (pnlPct >= secondTakeProfitStagePct && tpStage < 2) {
        sellReason = "take_profit_stage_2_partial";
        sellFractionPct = 50;
      } else if (pnlPct >= firstTakeProfitStagePct && tpStage < 1) {
        sellReason = "take_profit_stage_1_partial";
        sellFractionPct = 40;
      } else if (pnlPct >= takeProfitPct) {
        sellReason = "take_profit_target_hit";
        sellFractionPct = configuredLiveSellFractionPct;
      } else if (pnlPct <= -configuredStopLossPct) {
        sellReason = "stop_loss_hit";
      } else if (
        pnlPct > 0 &&
        drawdownFromPeakPct >= configuredTrailingStopPct
      ) {
        sellReason = "trailing_stop_triggered";
      } else if (
        holdMinutes >= configuredMaxHoldMinutes
      ) {
        sellReason = "max_hold_reached";
      } else if (
        pnlPct >= configuredMinMomentumProfitPct &&
        (
          marketVolume5m <= 0 ||
          marketScore < configuredStrongMoveThresholdPct * 0.7 ||
          (marketHolders > 0 && marketHolders < 120) ||
          (topHolderPct > 0 && topHolderPct > configuredMaxTopHolderPct)
        )
      ) {
        sellReason = "momentum_or_holder_quality_drop";
      } else if (
        doctorRuntime.positions.length >= maxOpenPositions &&
        positionIndex === doctorRuntime.positions.length - 1 &&
        holdMinutes >= getDoctorPositionRotationMinutes()
      ) {
        sellReason = "position_rotation";
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
        userId: scopedUserId,
        baseMint: String((position as any).base_mint || getDoctorTradeBaseAssetMint()),
        sellFractionPct,
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
      clampDoctorPaperBalance();
      sellCount += 1;
      const pnlUsd = Number(((soldAmountSol * currentPrice) - (soldAmountSol * entryPrice)).toFixed(2));
      const remainingAmountSol = Number((amountSol - soldAmountSol).toFixed(9));
      const nextTpStage = sellReason === "take_profit_stage_2_partial"
        ? Math.max(tpStage, 2)
        : sellReason === "take_profit_stage_1_partial"
          ? Math.max(tpStage, 1)
          : tpStage;

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
          tp_stage: nextTpStage,
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
    const cooldownMinutes = Math.max(0, Number(doctorRuntime.controls.cooldown_minutes_per_mint || 0));
    const routeRejectRetryMs = Math.max(10_000, Number(process.env.DOCTOR_ROUTE_REJECTED_RETRY_MS || 120_000));
    const feeBufferSol = Math.max(0, Number(doctorRuntime.controls.min_wallet_fee_buffer_sol || 0));
    const buyAmountSol = Math.max(0.1, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    const activeSnipePreset = getDoctorActiveSnipePreset();
    const maxLiquidityUsd = Math.max(1, getDoctorEffectiveControlNumber("max_liquidity_usd", 500000));
    const maxTokenAgeSeconds = Math.max(60, Math.min(10, Math.trunc(getDoctorEffectiveControlNumber("max_token_age_minutes", 10))) * 60);
    const strictMaxTokenAgeSecondsRaw = Math.max(30, getDoctorEffectiveControlNumber("max_token_age_seconds", 240));
    const strictMaxTokenAgeSeconds = isDoctorDexTurboEnabled()
      ? Math.max(120, strictMaxTokenAgeSecondsRaw)
      : strictMaxTokenAgeSecondsRaw;
    const maxDevWalletPct = Math.max(0, getDoctorEffectiveControlNumber("max_dev_wallet_pct", 3));
    const minUniqueBuyers = Math.max(1, Math.trunc(getDoctorEffectiveControlNumber("min_unique_buyers", 40)));
    const minBuyRatioPct = Math.max(1, getDoctorEffectiveControlNumber("min_buy_ratio_pct", 65));
    const minBuys5m = Math.max(1, Math.trunc(getDoctorEffectiveControlNumber("min_buys_5m", 3)));
    const maxSells5m = Math.max(0, Math.trunc(getDoctorEffectiveControlNumber("max_sells_5m", 1)));
    const minMarketCapUsd = Math.max(1, getDoctorEffectiveControlNumber("min_market_cap_usd", 15000));
    const maxMarketCapUsd = Math.max(minMarketCapUsd, getDoctorEffectiveControlNumber("max_market_cap_usd", 250000));
    const hardMaxMarketCapUsd = Math.max(100_000, Number(process.env.DOCTOR_HARD_MAX_MARKET_CAP_USD || 5_000_000));
    const effectiveMaxMarketCapUsd = Math.min(maxMarketCapUsd, hardMaxMarketCapUsd);
    const hardMinVolume24hUsd = Math.max(1_000, Number(process.env.DOCTOR_HARD_MIN_VOLUME_24H_USD || 12_000));
    const hardMinSafetyScore = Math.max(1, Number(process.env.DOCTOR_HARD_MIN_SAFETY_SCORE || 60));
    const minLiquiditySol = Math.max(0.1, getDoctorEffectiveControlNumber("min_liquidity_sol", 2));
    const maxLiquiditySol = Math.max(minLiquiditySol, getDoctorEffectiveControlNumber("max_liquidity_sol", 50));
    const requireLiquidityLock = Math.max(0, getDoctorEffectiveControlNumber("min_lock_hours", 24)) > 0;
    const openAddresses = new Set(doctorRuntime.positions.map((position) => String(position.address || "")));

    const candidatePool = activeTokens
      .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
      .filter((token) => Number(token.score || 0) >= Math.max(1, getDoctorEffectiveControlNumber("strong_move_threshold_pct", 40)))
      .filter((token) => Number(token.liquidity || 0) >= Math.max(1000, getDoctorEffectiveControlNumber("min_liquidity_usd", 0)))
      .filter((token) => Number(token.liquidity || 0) <= maxLiquidityUsd)
      .filter((token) => {
        const marketCapUsd = Number(token.market_cap_usd || 0);
        return marketCapUsd >= minMarketCapUsd && marketCapUsd <= effectiveMaxMarketCapUsd;
      })
      .filter((token) => Number(token.volume_24h || 0) >= Math.max(1, getDoctorEffectiveControlNumber("min_volume_24h_usd", 12000)))
      .filter((token) => Number(token.age_seconds || 0) >= Math.max(0, Math.trunc(getDoctorEffectiveControlNumber("min_token_age_minutes", 0))) * 60)
      .filter((token) => Number(token.age_seconds || 0) <= Math.min(maxTokenAgeSeconds, strictMaxTokenAgeSeconds))
      .filter((token) => {
        const liquiditySol = Number((token as any).liquidity_sol || 0);
        if (liquiditySol <= 0) return true;
        return liquiditySol >= minLiquiditySol && liquiditySol <= maxLiquiditySol;
      })
      .filter((token) => Number((token as any).buys_5m || 0) >= minBuys5m)
      .filter((token) => Number((token as any).sells_5m || 0) <= maxSells5m)
      .filter((token) => isLiquidityLockSatisfied(requireLiquidityLock, Boolean(token.liquidity_locked), Number(token.age_seconds || 0), String(token.launch_source || token.source || "unknown")))
      .filter((token) => {
        const buyRatioPct = Number(token.buy_ratio_pct || 0);
        return buyRatioPct <= 0 || buyRatioPct >= minBuyRatioPct;
      })
      .filter((token) => {
        const holdersCount = Number(token.holders_count || 0);
        return holdersCount <= 0 || holdersCount >= minUniqueBuyers;
      })
      .filter((token) => {
        const devWalletPct = Number(token.dev_wallet_pct || 0);
        return devWalletPct <= 0 || devWalletPct <= maxDevWalletPct;
      })
      .filter((token) => isLaunchSourceAllowed(String(token.launch_source || token.source || "unknown")))
      .filter((token) => {
        const topHolderPct = Number(token.top_holder_pct || 0);
        if (topHolderPct <= 0) return true;
        return topHolderPct <= Math.max(1, getDoctorEffectiveControlNumber("quality_max_top_holder_pct", 24));
      })
      .sort((a, b) => {
        const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(b.volume_5m || 0) - Number(a.volume_5m || 0);
      });

    const candidatePoolNonOpen = candidatePool
      .filter((token) => !openAddresses.has(String(token.address || "")))
      .filter((token) => {
        const mint = String(token.address || "").trim();
        if (!mint) return false;
        const rejectedAt = doctorRejectedMints.get(mint) || 0;
        if (!rejectedAt) return true;
        return nowMs - rejectedAt > routeRejectRetryMs;
      });
    const allowReentrySnipes = false;

    const getFallbackDetectedCandidate = async () => {
      const passReason = `${activeSnipePreset}_conditions_passed`;
      const legacyPassReason = "insider_conditions_passed";
      const fallbackLogs = getDoctorSniperLogsForUser(scopedUserId)
        .filter((log) => String(log?.event || "") === "detected")
        .filter((log) => {
          const reason = String(log?.reason || "");
          return reason === passReason || reason === legacyPassReason;
        })
        .slice(0, 40);

      for (const log of fallbackLogs) {
        const mint = String(log?.mint || "").trim();
        if (!mint || openAddresses.has(mint)) continue;

        const alreadyBoughtMint = doctorRuntime.recentTrades.find((trade) => {
          return String(trade.action || "").toUpperCase() === "BUY" && String(trade.address || "") === mint;
        });
        if (alreadyBoughtMint) continue;

        const scanned = await (async () => {
          try {
            return await storage.getScannedTokenByAddress(mint);
          } catch {
            return null;
          }
        })();
        if (!scanned) continue;

        const createdAtIso = scanned.createdAt ? new Date(scanned.createdAt).toISOString() : nowIso();
        const createdAtMs = new Date(createdAtIso).getTime();
        const ageSeconds = Number.isFinite(createdAtMs) && createdAtMs > 0
          ? Math.max(0, Math.trunc((nowMs - createdAtMs) / 1000))
          : 0;

        return {
          symbol: String(scanned.symbol || log?.symbol || "UNKNOWN"),
          address: mint,
          liquidity: Number(scanned.liquidity || 0),
          volume_5m: Number((scanned as any).volume5m || 0),
          buy_ratio_pct: Number((scanned as any).buyRatioPct || 0),
          buys_5m: Number((scanned as any).buys5m || log?.buys_5m || 0),
          sells_5m: Number((scanned as any).sells5m || log?.sells_5m || 0),
          liquidity_sol: Number((scanned as any).liquiditySol || log?.liquidity_sol || 0),
          volume_24h: Number(scanned.volume24h || 0),
          market_cap_usd: Number(scanned.marketCap || 0),
          score: Number((scanned as any).score || 75),
          price_usd: Number((scanned as any).priceUsd || 0),
          price_change_1h: Number((scanned as any).priceChange1h || 0),
          age_seconds: ageSeconds,
          chain: "solana",
          created_at: createdAtIso,
          holders_count: Number((scanned as any).holdersCount || 0),
          top_holder_pct: Number((scanned as any).topHoldersPercentage || 0),
          dev_wallet_pct: Number((scanned as any).devWalletPercentage || 0),
          launch_source: String((scanned as any).dexId || log?.source || "dexscreener"),
          liquidity_locked: Boolean((scanned as any).isLiquidityLocked),
          base_mint: String((scanned as any).baseMint || getDoctorTradeBaseAssetMint()),
          risk_level: "MEDIUM",
          source: "dexscreener_detected_signal",
          eligible: true,
          safety_tier: "strict",
        };
      }

      return undefined;
    };

    let buyCandidate: Record<string, any> | undefined = candidatePoolNonOpen[0] || (allowReentrySnipes ? candidatePool[0] : undefined);
    if (!buyCandidate && doctorRuntime.execution.mode === "paper") {
      const softPaperPool = activeTokens
        .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
        .filter((token) => !openAddresses.has(String(token.address || "")))
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      buyCandidate = softPaperPool[0];
      if (buyCandidate) {
        appendDoctorSniperLog({
          event: "candidate_selected",
          source: String((buyCandidate as any).source || "scanner"),
          symbol: String((buyCandidate as any).symbol || "UNKNOWN"),
          mint: String((buyCandidate as any).address || ""),
          reason: "paper_mode_soft_fallback_candidate",
          preset: activeSnipePreset,
        });
      }
    }
    if (!buyCandidate && activeSnipePreset === "insider") {
      const insiderFallbackPool = activeTokens
        .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
        .filter((token) => !openAddresses.has(String(token.address || "")))
        .filter((token) => Number(token.age_seconds || 0) <= strictMaxTokenAgeSeconds)
        .filter((token) => {
          const marketCapUsd = Number(token.market_cap_usd || 0);
          return marketCapUsd >= minMarketCapUsd && marketCapUsd <= maxMarketCapUsd;
        })
        .filter((token) => isLaunchSourceAllowed(String(token.launch_source || token.source || "unknown")))
        .sort((a, b) => {
          const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
          if (scoreDiff !== 0) return scoreDiff;
          return Number(b.volume_5m || 0) - Number(a.volume_5m || 0);
        });

      buyCandidate = insiderFallbackPool[0];
      if (buyCandidate) {
        appendDoctorSniperLog({
          event: "candidate_selected",
          source: String((buyCandidate as any).source || "scanner"),
          symbol: String((buyCandidate as any).symbol || "UNKNOWN"),
          mint: String((buyCandidate as any).address || ""),
          reason: "insider_live_fallback_candidate",
          preset: activeSnipePreset,
        });
      }
    }
    if (!buyCandidate) {
      buyCandidate = await getFallbackDetectedCandidate();
      if (buyCandidate) {
        appendDoctorSniperLog({
          event: "candidate_selected",
          source: String((buyCandidate as any).source || "scanner"),
          symbol: String((buyCandidate as any).symbol || "UNKNOWN"),
          mint: String((buyCandidate as any).address || ""),
          reason: "fallback_detected_signal_candidate",
          preset: activeSnipePreset,
        });
      }
    }

    let aiFallbackUsed = false;
    let aiFallbackDecision: Record<string, any> | null = null;
    const aiFallbackEnabled = String(process.env.DOCTOR_ENABLE_AI_FALLBACK || "true").trim().toLowerCase() !== "false";

    if (!buyCandidate && aiFallbackEnabled) {
      const aiFallbackPool = activeTokens
        .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
        .filter((token) => !openAddresses.has(String(token.address || "")))
        .filter((token) => !hasDoctorBoughtMintBefore(String(token.address || "")))
        .sort((a, b) => {
          const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
          if (scoreDiff !== 0) return scoreDiff;
          return Number(b.volume_5m || 0) - Number(a.volume_5m || 0);
        })
        .slice(0, 8);

      const aiFallbackCandidate = aiFallbackPool.find((token) => {
        const reasons = Array.isArray((token as any).reject_reasons) ? (token as any).reject_reasons : [];
        return String((token as any).safety_tier || "").toLowerCase() === "soft" || reasons.length > 0;
      }) || aiFallbackPool[0];

      if (aiFallbackCandidate) {
        buyCandidate = {
          ...(aiFallbackCandidate as Record<string, any>),
          source: "ai_fallback",
        };
        aiFallbackUsed = true;
        appendDoctorSniperLog({
          event: "candidate_selected",
          source: "ai_fallback",
          symbol: String((buyCandidate as any).symbol || "UNKNOWN"),
          mint: String((buyCandidate as any).address || ""),
          reason: "ai_fallback_candidate_selected",
          preset: activeSnipePreset,
        });
      }
    }

    const evaluatePreTradeGuard = async (
      candidate: Record<string, any> | undefined,
      mode: "strict" | "ai_fallback" = "strict",
    ) => {
      if (!candidate) {
        return { allowed: false, reason: "no_eligible_candidate" };
      }

      const requiresLiveWallet = isDoctorLiveOnlyMode() || doctorRuntime.execution.mode === "live";
      if (requiresLiveWallet) {
        const liveCredentials = await getDoctorLiveWalletCredentials(scopedUserId || undefined);
        const hasWalletPublicKey = Boolean(String(liveCredentials.walletPublicKey || "").trim());
        const hasWalletPrivateKey = Boolean(String(liveCredentials.walletPrivateKey || "").trim());
        if (!hasWalletPublicKey || !hasWalletPrivateKey) {
          return { allowed: false, reason: "wallet_key_not_connected" };
        }
      }

      if (doctorRuntime.positions.length >= maxOpenPositions) {
        return { allowed: false, reason: "max_open_positions_reached" };
      }

      if (String(candidate.chain || "solana").toLowerCase() !== "solana") {
        return { allowed: false, reason: "chain_not_solana" };
      }

      if (mode === "strict") {
        const candidateAgeSeconds = Math.max(0, Number(candidate.age_seconds || 0));
        if (candidateAgeSeconds > strictMaxTokenAgeSeconds) {
          return { allowed: false, reason: "token_too_old_for_sniping" };
        }

        const candidateMarketCapUsd = Number(candidate.market_cap_usd || 0);
        if (candidateMarketCapUsd < minMarketCapUsd) {
          return { allowed: false, reason: "low_market_cap" };
        }
        if (candidateMarketCapUsd > effectiveMaxMarketCapUsd) {
          return { allowed: false, reason: "high_market_cap" };
        }

        const candidateVolume24hUsd = Number(candidate.volume_24h || 0);
        if (candidateVolume24hUsd < hardMinVolume24hUsd) {
          return { allowed: false, reason: "low_volume_hard_floor" };
        }

        const candidateSafetyScore = Number(candidate.score || 0);
        if (candidateSafetyScore < hardMinSafetyScore) {
          return { allowed: false, reason: "low_safety_score" };
        }

        if (!isLaunchSourceAllowed(String(candidate.launch_source || candidate.source || "unknown"))) {
          return { allowed: false, reason: "unsupported_launch_source" };
        }
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

      if (hasDoctorBoughtMintBefore(String(candidate.address || ""))) {
        return { allowed: false, reason: "duplicate_buy_blocked" };
      }

      const baseAssetMint = getDoctorTradeBaseAssetMint();
      if (requiresLiveWallet && baseAssetMint === "So11111111111111111111111111111111111111112") {
        const availableSol = Number(doctorRuntime.wallet.balanceSol || 0);
        const gasPriorityLamports = Math.max(0, Math.trunc(Number(doctorRuntime.controls.gas_priority_lamports || 0)));
        const baseSwapFeeLamports = Math.max(5000, Math.trunc(Number(process.env.DOCTOR_SWAP_BASE_FEE_LAMPORTS || 15000)));
        const estimatedSwapFeeSol = Number(((gasPriorityLamports + baseSwapFeeLamports) / 1_000_000_000).toFixed(6));
        const requiredSol = Number((buyAmountSol + feeBufferSol + estimatedSwapFeeSol).toFixed(6));
        if (availableSol < requiredSol) {
          return {
            allowed: false,
            reason: "insufficient_sol_for_swap_fees",
            available_sol: availableSol,
            required_sol: requiredSol,
            estimated_fee_sol: estimatedSwapFeeSol,
          };
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

      const strategyWindowMinutes = Math.min(5, Math.max(3, getDoctorEffectiveControlNumber("strategy_window_minutes", 5)));
      const strategyWindowSeconds = Math.trunc(strategyWindowMinutes * 60);
      const liquidityMin = Math.max(1000, getDoctorEffectiveControlNumber("min_liquidity_usd", 0));
      const liquidityMax = Math.max(liquidityMin, getDoctorEffectiveControlNumber("max_liquidity_usd", 500000));
      const topHolderMax = Math.max(1, getDoctorEffectiveControlNumber("quality_max_top_holder_pct", 24));
      const maxDevWalletPct = Math.max(0, getDoctorEffectiveControlNumber("max_dev_wallet_pct", 3));
      const minUniqueBuyers = Math.max(1, Math.trunc(getDoctorEffectiveControlNumber("min_unique_buyers", 40)));
      const maxEarlySpikePct = Math.max(50, getDoctorEffectiveControlNumber("max_early_spike_pct", 200));
      const volumeSpikeMinPct = Math.max(1, getDoctorEffectiveControlNumber("quality_min_volume_spike_pct", 12));
      const minTokenAgeSeconds = Math.max(0, Math.trunc(getDoctorEffectiveControlNumber("min_token_age_minutes", 0))) * 60;
      const maxTokenAgeSeconds = Math.max(minTokenAgeSeconds, Math.min(10, Math.trunc(getDoctorEffectiveControlNumber("max_token_age_minutes", 10))) * 60);
      const strictMaxTokenAgeSecondsRaw = Math.max(30, getDoctorEffectiveControlNumber("max_token_age_seconds", 240));
      const strictMaxTokenAgeSeconds = isDoctorDexTurboEnabled()
        ? Math.max(120, strictMaxTokenAgeSecondsRaw)
        : strictMaxTokenAgeSecondsRaw;
      const minVolume24h = Math.max(1, getDoctorEffectiveControlNumber("min_volume_24h_usd", 12000));
      const minMarketCap = Math.max(1, getDoctorEffectiveControlNumber("min_market_cap_usd", 15000));
      const maxMarketCap = Math.min(
        Math.max(minMarketCap, getDoctorEffectiveControlNumber("max_market_cap_usd", 250000)),
        hardMaxMarketCapUsd,
      );
      const requireLiquidityLock = Math.max(0, getDoctorEffectiveControlNumber("min_lock_hours", 24)) > 0;
      const requireFreezeAuthorityDisabled = String(process.env.DOCTOR_REQUIRE_FREEZE_AUTHORITY_DISABLED || "true").trim().toLowerCase() !== "false";
      const strictContractSafety = String(process.env.DOCTOR_STRICT_CONTRACT_SAFETY || "true").trim().toLowerCase() !== "false";
      const strictLiquidityStability = String(process.env.DOCTOR_STRICT_LIQUIDITY_STABILITY || "false").trim().toLowerCase() === "true";
      const allowedLaunchSources = getAllowedLaunchSources();
      const minBuyRatioPct = Math.max(1, getDoctorEffectiveControlNumber("min_buy_ratio_pct", 65));

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
      const scannedToken = contractAddress
        ? await (async () => {
            try {
              return await storage.getScannedTokenByAddress(contractAddress);
            } catch {
              return undefined;
            }
          })()
        : undefined;
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
      const liquidityLockCheck = isLiquidityLockSatisfied(requireLiquidityLock, liquidityLocked, ageSeconds, launchSource);
      const priceChange1h = Number(candidate.price_change_1h || 0);
      const buyRatioPct = Math.max(
        Number(candidate.buy_ratio_pct || 0),
        Number((scoreFallback?.market_data as Record<string, any> | undefined)?.buy_ratio_pct || 0),
      );

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
        ageSeconds <= Math.min(maxTokenAgeSeconds, strictMaxTokenAgeSeconds) &&
        ageSeconds <= strategyWindowSeconds &&
        liquidityUsd > 0 &&
        liquidityUsd <= liquidityMax &&
        marketCapUsd >= minMarketCap &&
        marketCapUsd <= maxMarketCap &&
        volume24h >= minVolume24h &&
        liquidityLockCheck &&
        (allowedLaunchSources.allowAll || allowedLaunchSources.allowed.has(launchSource)) &&
        dexTradable;

      const liquidityStabilityBase =
        liquidityUsd >= liquidityMin &&
        liquidityUsd <= liquidityMax &&
        liquidityLockCheck &&
        !riskFlags.has("NO_LIVE_PAIR_DATA");

      const liquidityStability =
        liquidityStabilityBase &&
        (!strictLiquidityStability || (
        !riskFlags.has("LOW_LIQUIDITY") &&
        !riskFlags.has("THIN_LIQUIDITY") &&
        !riskFlags.has("HIGH_SLIPPAGE")
      ));

      const hasBuyPressure = smartWalletSignal >= 45 && (buyRatioPct <= 0 || buyRatioPct >= minBuyRatioPct);
      const volumeGrowthProxy = volume5m >= Math.max(50, Math.trunc(volumeSpikeMinPct * 10));
      const volumeConsistencyProxy = confidenceSignal >= 45;
      const volumeActivity = volume5m > 0 && hasBuyPressure && volumeGrowthProxy && volumeConsistencyProxy;

      const walletParticipation =
        (holdersCount <= 0 || holdersCount >= minUniqueBuyers) &&
        (topHolderPct <= 0 || topHolderPct <= topHolderMax) &&
        (devWalletPct <= 0 || devWalletPct <= maxDevWalletPct) &&
        !riskFlags.has("SELL_PRESSURE");

      const strictContractSafetyPass =
        !isBlacklisted &&
        !Boolean(scannedToken?.isHoneypot) &&
        (Boolean(scannedToken?.mintAuthorityDisabled) || mintAuthorityInfo.mintAuthorityDisabled || Number(scannedToken?.safetyScore || 0) >= 60 || rugProbability <= 75) &&
        (!requireFreezeAuthorityDisabled || mintAuthorityInfo.freezeAuthorityDisabled) &&
        !riskFlags.has("NO_LIVE_PAIR_DATA");

      const relaxedContractSafetyPass =
        !isBlacklisted &&
        rugProbability <= 80 &&
        !riskFlags.has("NO_LIVE_PAIR_DATA");

      const contractSafety = strictContractSafety ? strictContractSafetyPass : relaxedContractSafetyPass;

      const marketMomentum =
        priceChange1h > -15 &&
        hasBuyPressure &&
        !riskFlags.has("SELL_PRESSURE") &&
        Math.abs(priceChange1h) <= maxEarlySpikePct;

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
        liquidityLockCheck &&
        volume24h >= minVolume24h &&
        marketCapUsd >= minMarketCap &&
        marketCapUsd <= maxMarketCap &&
        (allowedLaunchSources.allowAll || allowedLaunchSources.allowed.has(launchSource)) &&
        !riskFlags.has("NO_LIVE_PAIR_DATA") &&
        (devWalletPct <= 0 || devWalletPct <= maxDevWalletPct) &&
        (buyRatioPct <= 0 || buyRatioPct >= minBuyRatioPct);

      const candidateBuys5m = Number(candidate.buys_5m || 0);
      const candidateSells5m = Number(candidate.sells_5m || 0);
      const candidateLiquiditySol = Number(candidate.liquidity_sol || 0);
      const turboAiPass =
        isDoctorDexTurboEnabled() &&
        ageSeconds <= strictMaxTokenAgeSeconds &&
        dexTradable &&
        !isBlacklisted &&
        liquidityUsd >= 500 &&
        (candidateLiquiditySol <= 0 || candidateLiquiditySol >= 0.15) &&
        candidateBuys5m >= 2 &&
        candidateBuys5m >= Math.max(1, candidateSells5m) * 1.15;

      const checklistProfile = {
        age_window_minutes: `${Math.trunc(minTokenAgeSeconds / 60)}-${Math.trunc(maxTokenAgeSeconds / 60)}`,
        liquidity_window_usd: `${liquidityMin}-${liquidityMax}`,
        min_volume_24h_usd: minVolume24h,
        min_unique_buyers: minUniqueBuyers,
        min_buy_ratio_pct: minBuyRatioPct,
        max_top_holder_pct: topHolderMax,
        max_dev_wallet_pct: maxDevWalletPct,
        min_lock_hours: Math.max(0, getDoctorEffectiveControlNumber("min_lock_hours", 24)),
        lock_launch_grace_minutes: Math.trunc(getLiquidityLockLaunchGraceSeconds() / 60),
        require_freeze_authority_disabled: requireFreezeAuthorityDisabled,
      };

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

      const requiredSignals = Math.max(1, Math.trunc(getDoctorEffectiveControlNumber("ai_min_signals_required", 8)));
      const requireStrictCoreChecks =
        String(process.env.DOCTOR_STRICT_AI_CORE_CHECKS || "false").trim().toLowerCase() === "true";
      const passedSignals = Object.values(checks).filter(Boolean).length;
      const allChecksPassed = Object.values(checks).every(Boolean);
      const multiSignalPassed = passedSignals >= requiredSignals;
      const allowed =
        (
          multiSignalPassed &&
          antiRugDetection &&
          contractSafety &&
          (!requireStrictCoreChecks || (newTokenValidation && liquidityStability))
        ) || turboAiPass;

      const failedReasons = Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([key]) => `${key}_failed`);

      return {
        allowed,
        reason: allowed ? "ok" : (failedReasons[0] || "ai_validation_failed"),
        checks,
        passed_signals: passedSignals,
        required_signals: requiredSignals,
        required_all_checks: requireStrictCoreChecks,
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
          buy_ratio_pct: buyRatioPct,
        },
        checklist_profile: checklistProfile,
        reasons: failedReasons,
        turbo_ai_pass: turboAiPass,
      };
    };

    const evaluateDoctorOpenAiSafetyGate = async (
      candidate: Record<string, any>,
      aiValidation: Record<string, any>,
    ) => {
      const apiKey = resolveOpenAiApiKey();
      if (!apiKey) {
        return {
          allowed: false,
          reason: "openai_api_key_missing",
          source: "openai_unavailable",
        };
      }

      const timeoutMs = Math.max(2000, Number(process.env.DOCTOR_OPENAI_SAFETY_TIMEOUT_MS || 8000));
      const messages = [
        {
          role: "system" as const,
          content: [
            "You are a strict Solana memecoin risk gate.",
            "Your job is to ALLOW only clearly safer early-entry tokens.",
            "If uncertain, deny.",
            "Return JSON only with keys: allow_trade(boolean), risk_level(low|medium|high|critical), reason(string), hard_block_reasons(string[]).",
          ].join(" "),
        },
        {
          role: "user" as const,
          content: JSON.stringify({
            task: "Decide if DoctorTrade can execute a BUY for this token now.",
            candidate: {
              symbol: String(candidate.symbol || "UNKNOWN"),
              address: String(candidate.address || ""),
              market_cap_usd: Number(candidate.market_cap_usd || 0),
              volume_24h_usd: Number(candidate.volume_24h || 0),
              volume_5m_usd: Number(candidate.volume_5m || 0),
              liquidity_usd: Number(candidate.liquidity || 0),
              age_seconds: Number(candidate.age_seconds || 0),
              score: Number(candidate.score || 0),
              launch_source: String(candidate.launch_source || candidate.source || "unknown"),
              buy_ratio_pct: Number(candidate.buy_ratio_pct || 0),
              buys_5m: Number(candidate.buys_5m || 0),
              sells_5m: Number(candidate.sells_5m || 0),
            },
            deterministic_validation: aiValidation,
            policy: {
              default_decision_if_uncertain: "deny",
              never_allow_if_high_or_critical_risk: true,
            },
          }),
        },
      ];

      try {
        let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>> | null = null;
        let lastError: unknown = null;

        for (const model of resolveOpenAiModelFallbacks()) {
          try {
            completion = await Promise.race([
              getOpenAI().chat.completions.create({
                model,
                temperature: 0.1,
                messages,
                response_format: { type: "json_object" },
              }),
              new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("openai_safety_timeout")), timeoutMs)),
            ]);
            if (completion) break;
          } catch (error) {
            lastError = error;
          }
        }

        if (!completion) {
          throw lastError instanceof Error ? lastError : new Error("openai_safety_completion_failed");
        }

        const content = String(completion.choices?.[0]?.message?.content || "{}").trim();
        const parsed = JSON.parse(content || "{}") as Record<string, any>;
        const riskLevel = String(parsed.risk_level || "high").trim().toLowerCase();
        const allowTrade = Boolean(parsed.allow_trade) && riskLevel !== "high" && riskLevel !== "critical";

        return {
          allowed: allowTrade,
          reason: allowTrade ? "openai_safety_approved" : String(parsed.reason || "openai_safety_blocked"),
          risk_level: riskLevel,
          hard_block_reasons: Array.isArray(parsed.hard_block_reasons) ? parsed.hard_block_reasons.map((item) => String(item || "")).filter(Boolean) : [],
          source: "openai",
        };
      } catch (error: any) {
        return {
          allowed: false,
          reason: String(error?.message || "openai_safety_check_failed"),
          source: "openai_unavailable",
        };
      }
    };

    const evaluateDoctorOpenAiFallbackDecision = async (
      candidate: Record<string, any>,
      aiValidation: Record<string, any>,
      contextReason: string,
    ) => {
      const apiKey = resolveOpenAiApiKey();
      if (!apiKey) {
        return {
          allowed: false,
          reason: "openai_api_key_missing",
          source: "openai_unavailable",
          confidence: 0,
        };
      }

      const timeoutMs = Math.max(2000, Number(process.env.DOCTOR_OPENAI_FALLBACK_TIMEOUT_MS || 9000));
      const minConfidence = Math.max(50, Math.min(99, Number(process.env.DOCTOR_AI_FALLBACK_CONFIDENCE_MIN || 78)));
      const messages = [
        {
          role: "system" as const,
          content: [
            "You are an aggressive but risk-aware Solana sniper fallback model.",
            "The token failed deterministic filters. Decide if it is still worth buying now.",
            "Only approve if conviction is high and no obvious rug pattern.",
            "Return JSON only with keys: allow_trade(boolean), confidence(integer 0-100), risk_level(low|medium|high|critical), reason(string), guardrails(string[]).",
          ].join(" "),
        },
        {
          role: "user" as const,
          content: JSON.stringify({
            context_reason: contextReason,
            candidate: {
              symbol: String(candidate.symbol || "UNKNOWN"),
              address: String(candidate.address || ""),
              market_cap_usd: Number(candidate.market_cap_usd || 0),
              volume_24h_usd: Number(candidate.volume_24h || 0),
              volume_5m_usd: Number(candidate.volume_5m || 0),
              liquidity_usd: Number(candidate.liquidity || 0),
              age_seconds: Number(candidate.age_seconds || 0),
              score: Number(candidate.score || 0),
              launch_source: String(candidate.launch_source || candidate.source || "unknown"),
              buy_ratio_pct: Number(candidate.buy_ratio_pct || 0),
              buys_5m: Number(candidate.buys_5m || 0),
              sells_5m: Number(candidate.sells_5m || 0),
              reject_reasons: Array.isArray(candidate.reject_reasons) ? candidate.reject_reasons : [],
            },
            deterministic_validation: aiValidation,
            policy: {
              allow_only_if_confidence_at_least: minConfidence,
              never_allow_high_or_critical_risk: true,
            },
          }),
        },
      ];

      try {
        let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>> | null = null;
        let lastError: unknown = null;

        for (const model of resolveOpenAiModelFallbacks()) {
          try {
            completion = await Promise.race([
              getOpenAI().chat.completions.create({
                model,
                temperature: 0.1,
                messages,
                response_format: { type: "json_object" },
              }),
              new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("openai_fallback_timeout")), timeoutMs)),
            ]);
            if (completion) break;
          } catch (error) {
            lastError = error;
          }
        }

        if (!completion) {
          throw lastError instanceof Error ? lastError : new Error("openai_fallback_completion_failed");
        }

        const content = String(completion.choices?.[0]?.message?.content || "{}").trim();
        const parsed = JSON.parse(content || "{}") as Record<string, any>;
        const confidence = Math.max(0, Math.min(100, Math.trunc(Number(parsed.confidence || 0))));
        const riskLevel = String(parsed.risk_level || "high").trim().toLowerCase();
        const allowTrade = Boolean(parsed.allow_trade) && confidence >= minConfidence && riskLevel !== "high" && riskLevel !== "critical";

        return {
          allowed: allowTrade,
          reason: allowTrade ? "openai_fallback_approved" : String(parsed.reason || "openai_fallback_denied"),
          confidence,
          risk_level: riskLevel,
          guardrails: Array.isArray(parsed.guardrails) ? parsed.guardrails.map((item) => String(item || "")).filter(Boolean) : [],
          source: "openai_fallback",
        };
      } catch (error: any) {
        return {
          allowed: false,
          reason: String(error?.message || "openai_fallback_failed"),
          source: "openai_unavailable",
          confidence: 0,
        };
      }
    };

    const guard = await evaluatePreTradeGuard(buyCandidate, aiFallbackUsed ? "ai_fallback" : "strict");
    const canBuy = guard.allowed;

    let hasBlockingError = false;

    if (buyCandidate && canBuy) {
      const enforceAiValidation =
        String(process.env.DOCTOR_ENFORCE_AI_VALIDATION || "true").trim().toLowerCase() !== "false"
        || doctorRuntime.execution.mode === "live";
      const aiValidation = await evaluateDoctorAiValidation(buyCandidate);
      if (enforceAiValidation && !aiValidation.allowed) {
        const fallbackDecision = aiFallbackEnabled
          ? await evaluateDoctorOpenAiFallbackDecision(
              buyCandidate,
              aiValidation as Record<string, any>,
              "ai_validation_gate",
            )
          : { allowed: false, reason: "ai_fallback_disabled" };

        if (fallbackDecision.allowed) {
          aiFallbackUsed = true;
          aiFallbackDecision = fallbackDecision as Record<string, any>;
          appendDoctorSniperLog({
            event: "detected",
            source: String(buyCandidate.source || "ai_fallback"),
            symbol: String(buyCandidate.symbol || "UNKNOWN"),
            mint: String(buyCandidate.address || ""),
            reason: "ai_fallback_override_approved",
            ai_confidence: Number((fallbackDecision as any).confidence || 0),
          });
        } else {
          appendDoctorSniperLog({
            event: "blocked",
            source: String(buyCandidate.source || "scanner"),
            symbol: String(buyCandidate.symbol || "UNKNOWN"),
            mint: String(buyCandidate.address || ""),
            reason: "ai_validation_gate",
            failed_checks: Array.isArray(aiValidation.reasons) ? aiValidation.reasons : [],
            ai_fallback_reason: String((fallbackDecision as any).reason || "ai_fallback_denied"),
          });
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
            ai_fallback: fallbackDecision,
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
            ai_fallback: fallbackDecision,
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
            ai_fallback: fallbackDecision,
          };
        }
      }

      if (buyCandidate && (!enforceAiValidation || aiValidation.allowed || aiFallbackUsed)) {
      const requireOpenAiSafetyGate =
        doctorRuntime.execution.mode === "live"
        && String(process.env.DOCTOR_REQUIRE_OPENAI_SAFETY_GATE || "true").trim().toLowerCase() !== "false";
      if (requireOpenAiSafetyGate) {
        const openAiSafety = await evaluateDoctorOpenAiSafetyGate(buyCandidate, aiValidation as Record<string, any>);
        if (!openAiSafety.allowed) {
          appendDoctorSniperLog({
            event: "blocked",
            source: String(buyCandidate.source || "scanner"),
            symbol: String(buyCandidate.symbol || "UNKNOWN"),
            mint: String(buyCandidate.address || ""),
            reason: "openai_safety_gate",
            gate_reason: String(openAiSafety.reason || "openai_safety_blocked"),
            risk_level: String((openAiSafety as any).risk_level || "unknown"),
          });
          appendDoctorExecutionAudit({
            action: "buy",
            symbol: String(buyCandidate.symbol || "UNKNOWN"),
            mint: String(buyCandidate.address || ""),
            amount_sol: buyAmountSol,
            expected_price_usd: Number(buyCandidate.price_usd || 0),
            expected_notional_usd: Number((buyAmountSol * Number(buyCandidate.price_usd || 0)).toFixed(2)),
            trigger,
            reason: String(buyCandidate.source || "scanner_signal"),
            status: "blocked",
            block_reason: String((openAiSafety as any).reason || "openai_safety_blocked"),
          });
          doctorRuntime.lastDecision = {
            action: "skip",
            reason: String((openAiSafety as any).reason || "openai_safety_blocked"),
            trigger,
            at: nowIso(),
            token: String(buyCandidate.symbol || "UNKNOWN"),
            mint: String(buyCandidate.address || ""),
          };
          hasBlockingError = true;
          buyCandidate = undefined;
        }
      }

      if (buyCandidate) {
      const tokenPriceUsd = resolveCurrentPriceUsd(buyCandidate, 0);
      const buyReason = aiFallbackUsed
        ? "ai_fallback_signal"
        : String(buyCandidate.source || "scanner_signal");
      const buyExecution = await executeDoctorOrder({
        action: "buy",
        symbol: String(buyCandidate.symbol || "UNKNOWN"),
        mint: String(buyCandidate.address || ""),
        amountSol: buyAmountSol,
        expectedPriceUsd: tokenPriceUsd,
        reason: buyReason,
        trigger,
        userId: scopedUserId,
        baseMint: String(buyCandidate.base_mint || getDoctorTradeBaseAssetMint()),
      });
      if (!buyExecution.executed) {
        const failedMint = String(buyCandidate.address || "").trim();
        if (failedMint && String((buyExecution as any).reason || "").startsWith("raydium_quote_failed_")) {
          doctorRejectedMints.set(failedMint, nowMs);
        }
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
        tp_stage: 0,
        amount_sol: buyAmountSol,
        execution_mode: doctorRuntime.execution.mode,
        base_mint: String(buyCandidate.base_mint || getDoctorTradeBaseAssetMint()),
        opened_at: nowIso(),
        source: String(buyCandidate.source || "scanner"),
      };
      doctorRuntime.positions.unshift(position);
      doctorRuntime.positions = doctorRuntime.positions.slice(0, 30);

      doctorRuntime.wallet.balanceSol = Number((Math.max(0, Number(doctorRuntime.wallet.balanceSol || 0) - buyAmountSol)).toFixed(6));
      clampDoctorPaperBalance();
      doctorRuntime.controls.trades_today = Number(doctorRuntime.controls.trades_today || 0) + 1;
      buyCount += 1;

      doctorRuntime.recentTrades.unshift({
        token: position.symbol,
        address: position.address,
        action: "BUY",
        status: "EXECUTED",
        reason: aiFallbackUsed ? "ai_fallback_signal" : (position.source === "apify" ? "apify_early_launch_signal" : "scanner_signal"),
        confidence: position.confidence,
        liquidity: position.liquidity,
        volume_5m: Number(buyCandidate.volume_5m || 0),
        size_pct: 100,
        notional_usd: Number((buyAmountSol * 160).toFixed(2)),
        execution_mode: doctorRuntime.execution.mode,
        tx_hash: buyExecution.txHash,
        timestamp: nowIso(),
      });
      markDoctorMintAsBought(position.address);

      appendDoctorSniperLog({
        event: "sniped",
        source: String(buyCandidate.source || "scanner"),
        symbol: position.symbol,
        mint: position.address,
        liquidity_sol: Number((buyCandidate as any).liquidity_sol || 0),
        buys_5m: Number((buyCandidate as any).buys_5m || 0),
        sells_5m: Number((buyCandidate as any).sells_5m || 0),
        reason: "doctortrade_buy_executed",
      });

      doctorRuntime.decisionJournal.unshift({
        token: position.symbol,
        address: position.address,
        decision: "buy",
        reason: aiFallbackUsed ? "ai_fallback_signal" : (position.source === "apify" ? "apify_early_launch_signal" : "scanner_signal"),
        confidence: position.confidence,
        size_pct: 100,
        strategy_mode: "autonomous",
        ai_fallback: aiFallbackUsed ? aiFallbackDecision : undefined,
        timestamp: nowIso(),
      });

      doctorRuntime.lastDecision = {
        action: "buy",
        reason: aiFallbackUsed ? "ai_fallback_signal" : (position.source === "apify" ? "apify_early_launch_signal" : "scanner_signal"),
        trigger,
        at: nowIso(),
        token: position.symbol,
        mint: position.address,
        confidence: Number(position.confidence || 0),
        ai_validation: aiValidation,
        ai_fallback: aiFallbackUsed ? aiFallbackDecision : undefined,
      };
      }
      }
      }
    } else {
      if (buyCandidate) {
        appendDoctorSniperLog({
          event: "blocked",
          source: String((buyCandidate as any).source || "scanner"),
          symbol: String((buyCandidate as any).symbol || "UNKNOWN"),
          mint: String((buyCandidate as any).address || ""),
          reason: guard.reason,
          preset: activeSnipePreset,
          available_sol: Number((guard as any).available_sol || 0),
          required_sol: Number((guard as any).required_sol || 0),
          estimated_fee_sol: Number((guard as any).estimated_fee_sol || 0),
        });
        if (guard.reason === "insufficient_sol_for_swap_fees") {
          const available = Number((guard as any).available_sol || 0);
          const required = Number((guard as any).required_sol || 0);
          doctorRuntime.lastError = `Insufficient SOL to cover buy + swap fees. Need ${required.toFixed(4)} SOL, have ${available.toFixed(4)} SOL.`;
          hasBlockingError = true;
          appendDoctorSniperLog({
            event: "notify",
            source: String((buyCandidate as any).source || "scanner"),
            symbol: String((buyCandidate as any).symbol || "UNKNOWN"),
            mint: String((buyCandidate as any).address || ""),
            reason: "no_enough_sol_to_cover_fees",
            preset: activeSnipePreset,
            available_sol: available,
            required_sol: required,
            estimated_fee_sol: Number((guard as any).estimated_fee_sol || 0),
          });
        } else if (guard.reason === "wallet_key_not_connected") {
          doctorRuntime.lastError = "Connect wallet private key before live sniping.";
          hasBlockingError = true;
        }
      }
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
    if (!hasBlockingError) {
      doctorRuntime.lastError = null;
    }

    await persistDoctorRuntime(scopedUserId);

    if (!buyCount && !sellCount) {
      return { executed: false, reason: "no_eligible_action", trigger, buys: 0, sells: 0 };
    }

    return { executed: true, trigger, buys: buyCount, sells: sellCount };
  };

  const buildDoctorStatus = async (userId?: string) => {
    const statusUserId = String(userId || doctorActiveUserId || doctorRuntime.ownerUserId || "").trim();
    await refreshDoctorWalletBalanceFromChain();
    const earlyTokens = await getSolanaEarlyScoredTokens(120, 220);
    const activeTokens = await getDoctorActiveTokens();
    const { dailyRealizedPnlUsd, consecutiveLosses } = computeDoctorRiskMetrics();
    const activeTokenMap = new Map(activeTokens.map((token) => [String(token.address || "").trim(), token]));

    const paused = doctorRuntime.killSwitch;
    const safetyPaused = paused || !doctorRuntime.enabled;

    const liveCredentials = await getDoctorLiveWalletCredentials(statusUserId);
    const liveCapable =
      isDoctorLiveTradingEnabled() &&
      Boolean(String(liveCredentials.walletPublicKey || "").trim()) &&
      Boolean(String(liveCredentials.walletPrivateKey || "").trim());
    const walletSnapshotBase = statusUserId
      ? await getDoctorWalletSnapshotForUser(statusUserId)
      : {
          address: "",
          balanceSol: 0,
          separateWalletEnforced: true,
          privateKeyConfigured: false,
          connected: false,
        };
    const runtimeBelongsToStatusUser = Boolean(
      statusUserId
      && String(doctorRuntime.ownerUserId || "").trim() === statusUserId,
    );
    const runtimeWalletAddress = String(doctorRuntime.wallet.address || "").trim();
    const runtimeWalletBalanceSol = Math.max(0, Number(doctorRuntime.wallet.balanceSol || 0));
    const walletSnapshot = runtimeBelongsToStatusUser
      ? {
          ...walletSnapshotBase,
          address: runtimeWalletAddress || String(walletSnapshotBase.address || "").trim(),
          balanceSol: runtimeWalletBalanceSol,
          separateWalletEnforced: doctorRuntime.wallet.separateWalletEnforced !== false,
          privateKeyConfigured: Boolean(walletSnapshotBase.privateKeyConfigured)
            || Boolean(String(liveCredentials.walletPrivateKey || "").trim()),
          connected: Boolean(runtimeWalletAddress || String(walletSnapshotBase.address || "").trim())
            && (Boolean(walletSnapshotBase.privateKeyConfigured)
              || Boolean(String(liveCredentials.walletPrivateKey || "").trim())),
        }
      : walletSnapshotBase;

    const walletAddress = String(walletSnapshot.address || "").trim();
    const walletConnected = Boolean(walletSnapshot.connected);
    const walletAddressAvailable = Boolean(walletAddress);

    const rawWalletTokens = walletAddressAvailable
      ? await getDoctorLiveWalletTokenSnapshots(walletAddress, 20)
      : [];
    const statusWalletTransactions = walletAddressAvailable
      ? await getDoctorWalletRecentTransactions(walletAddress, 20)
      : [];
    const knownTokenDetailsByMint = new Map<string, Record<string, any>>();
    for (const token of activeTokens) {
      const mint = String((token as any).address || "").trim();
      if (!mint) continue;
      knownTokenDetailsByMint.set(mint, token as Record<string, any>);
    }
    for (const position of doctorRuntime.positions) {
      const mint = String((position as any).address || "").trim();
      if (!mint) continue;
      if (!knownTokenDetailsByMint.has(mint)) {
        knownTokenDetailsByMint.set(mint, position as Record<string, any>);
      }
    }
    const statusWalletTokens = rawWalletTokens.map((token) => {
      const mint = String((token as any).mint || "").trim();
      const details = knownTokenDetailsByMint.get(mint) || {};
      const priceUsd = Number((details as any).price_usd || 0);
      const uiAmount = Number((token as any).ui_amount || 0);
      const worthUsd = Number((uiAmount * Math.max(0, priceUsd)).toFixed(6));
      return {
        ...token,
        symbol: String((details as any).symbol || mint.slice(0, 4) || "TOK"),
        name: String((details as any).name || (details as any).symbol || mint),
        logo_url: String((details as any).logo_url || ""),
        price_usd: priceUsd,
        worth_usd: worthUsd,
      };
    });
    const requiresLiveWallet = isDoctorLiveOnlyMode() || doctorRuntime.execution.mode === "live";
    const maxTradesPerDay = Math.max(1, Math.trunc(Number(doctorRuntime.controls.max_trades_per_day || 1)));
    const maxOpenPositions = getDoctorEffectiveMaxOpenPositions();
    const schedulerJob = statusUserId ? await getDoctorSchedulerJobForUser(statusUserId) : null;
    const schedulerNextRunAtMs = Math.max(0, Number((schedulerJob as any)?.next_run_at || 0));
    const schedulerLagMs = schedulerNextRunAtMs > 0 ? Math.max(0, Date.now() - schedulerNextRunAtMs) : 0;
    const decisionRetentionHours = Math.max(1, Number(process.env.DOCTORTRADE_RECENT_RETENTION_HOURS || 24));
    const decisionRetentionMs = decisionRetentionHours * 60 * 60 * 1000;
    const nowMs = Date.now();
    const filteredDecisionJournal = doctorRuntime.decisionJournal
      .filter((row) => {
        const token = String((row as any)?.token || "").trim().toLowerCase();
        if (token === "xmoney" || token === "x-money") return false;

        const decision = String((row as any)?.decision || "").trim().toLowerCase();
        if (decision !== "buy" && decision !== "sell" && decision !== "skip") return false;

        const timestampMs = new Date(String((row as any)?.timestamp || "")).getTime();
        if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;

        return nowMs - timestampMs <= decisionRetentionMs;
      })
      .slice(0, 60);

    let statusPositions = doctorRuntime.positions.slice(0, 30);
    if (doctorRuntime.execution.mode === "live") {
      const walletForLivePositions = String(walletAddress || "").trim();
      if (!walletForLivePositions) {
        statusPositions = [];
      } else {
        const prices = await fetchChainPricesUsd().catch(() => ({ solana: 0 } as Record<string, number>));
        const solPriceUsd = Math.max(1, Number((prices as any)?.solana || process.env.DOCTOR_SOL_PRICE_USD_DEFAULT || 150));
        const livePositions = statusPositions
          .filter((position) => normalizeDoctorPositionExecutionMode(position) === "live")
          .slice(0, 30);

        const enrichedLivePositions: Array<Record<string, any>> = [];
        for (const position of livePositions) {
          const mint = String(position.address || "").trim();
          if (!mint) {
            continue;
          }

          const tokenBalance = await getDoctorLiveTokenBalanceSnapshot(walletForLivePositions, mint);
          if (tokenBalance.balanceKnown && !(tokenBalance.uiAmount > 0)) {
            continue;
          }

          const marketToken = activeTokenMap.get(mint);
          const entryPriceUsd = Number(position.entry_price || 0);
          const currentPriceUsd = resolveCurrentPriceUsd(marketToken || {}, Number(position.current_price || entryPriceUsd || 0));
          const fallbackAmountTokens = Math.max(0, Number(position.amount_tokens || 0));
          const amountTokens = tokenBalance.balanceKnown ? tokenBalance.uiAmount : fallbackAmountTokens;
          const walletValueUsd = Number((amountTokens * Math.max(0, currentPriceUsd || 0)).toFixed(6));
          const walletValueSol = Number((walletValueUsd / solPriceUsd).toFixed(6));
          const pnlPct = entryPriceUsd > 0 && currentPriceUsd > 0
            ? Number((((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 100).toFixed(2))
            : Number(position.pnl_pct || 0);

          enrichedLivePositions.push({
            ...position,
            execution_mode: "live",
            current_price: Number(currentPriceUsd || 0),
            pnl_pct: pnlPct,
            amount_tokens: Number(amountTokens.toFixed(9)),
            token_decimals: tokenBalance.balanceKnown ? tokenBalance.decimals : Number(position.token_decimals || 0),
            amount_raw: tokenBalance.balanceKnown ? tokenBalance.amountRaw : String(position.amount_raw || "0"),
            worth_usd: walletValueUsd,
            worth_sol: walletValueSol,
            balance_known: tokenBalance.balanceKnown,
          });
        }

        statusPositions = enrichedLivePositions;
      }
    }
    const statusOpenPositions = statusPositions.length;

    let autoTradeBlockReason: string | null = null;
    if (!doctorRuntime.enabled) {
      autoTradeBlockReason = "doctortrade_disabled";
    } else if (doctorRuntime.killSwitch) {
      autoTradeBlockReason = "kill_switch_enabled";
    } else if (requiresLiveWallet && !walletConnected) {
      autoTradeBlockReason = "wallet_key_not_connected";
    } else if (statusOpenPositions >= maxOpenPositions) {
      autoTradeBlockReason = "max_open_positions_reached";
    } else if (Number(doctorRuntime.controls.trades_today || 0) >= maxTradesPerDay) {
      autoTradeBlockReason = "max_trades_reached";
    } else if (dailyRealizedPnlUsd <= -Math.abs(Number(doctorRuntime.controls.daily_loss_limit_usd || 0))) {
      autoTradeBlockReason = "daily_loss_limit_reached";
    } else if (consecutiveLosses >= Math.max(1, Number(doctorRuntime.controls.max_consecutive_losses || 1))) {
      autoTradeBlockReason = "max_consecutive_losses_reached";
    }

    return {
      user_id: statusUserId || null,
      api_target: String(process.env.VITE_API_URL || process.env.TRADE_AID_BACKEND_URL || "").trim() || null,
      enabled: doctorRuntime.enabled,
      kill_switch: doctorRuntime.killSwitch,
      scan_interval_seconds: doctorRuntime.scanIntervalSeconds,
      last_run_at: doctorRuntime.lastRunAt,
      last_error: doctorRuntime.lastError,
      risk_state: {
        drawdown_pct: 0,
        daily_realized_pnl_usd: dailyRealizedPnlUsd,
        high_watermark_usd: 0,
        open_positions: statusOpenPositions,
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
        address: walletAddress,
        balance_sol: walletSnapshot.balanceSol,
        separate_wallet_enforced: walletSnapshot.separateWalletEnforced,
        private_key_configured: Boolean(walletSnapshot.privateKeyConfigured),
        connection_status: walletConnected ? "connected" : "disconnected",
      },
      trade_controls: {
        ...doctorRuntime.controls,
        max_open_positions: getDoctorEffectiveMaxOpenPositions(),
        take_profit_multiplier: Math.max(1.01, getDoctorEffectiveControlNumber("take_profit_multiplier", Number(doctorRuntime.controls.take_profit_multiplier || 2))),
        min_profit_pct: Math.max(0.1, getDoctorEffectiveControlNumber("min_profit_pct", Number(doctorRuntime.controls.min_profit_pct || 0.1))),
        stop_loss_pct: Math.max(0.1, getDoctorEffectiveControlNumber("stop_loss_pct", Number(doctorRuntime.controls.stop_loss_pct || 0.1))),
        trailing_stop_pct: Math.max(0.1, getDoctorEffectiveControlNumber("trailing_stop_pct", Number(doctorRuntime.controls.trailing_stop_pct || 0.1))),
        max_hold_minutes: Math.max(5, getDoctorEffectiveControlNumber("max_hold_minutes", Number(doctorRuntime.controls.max_hold_minutes || 5))),
        position_rotation_minutes: Math.max(1, getDoctorEffectiveControlNumber("position_rotation_minutes", Number(doctorRuntime.controls.position_rotation_minutes || 1))),
        live_sell_fraction_pct: Math.max(1, Math.min(100, getDoctorEffectiveControlNumber("live_sell_fraction_pct", Number(doctorRuntime.controls.live_sell_fraction_pct || 100)))),
        max_sell_notional_usd: Math.max(1, getDoctorEffectiveControlNumber("max_sell_notional_usd", Number(doctorRuntime.controls.max_sell_notional_usd || 1))),
        wallet_connected: walletConnected,
      },
      execution: {
        mode: doctorRuntime.execution.mode,
        live_only: isDoctorLiveOnlyMode(),
        live_capable: liveCapable,
        raydium_route_enabled: true,
        jupiter_quote_enabled: true,
        base_asset_mint: getDoctorTradeBaseAssetMint(),
        bonk_mint: BONK_MINT,
        helius_rpc_url: getHeliusRpcUrl(),
      },
      auto_trade: {
        blocked: Boolean(autoTradeBlockReason),
        block_reason: autoTradeBlockReason,
      },
      scheduler: {
        user_id: statusUserId || null,
        scheduled: Boolean(schedulerJob?.enabled),
        next_run_at: schedulerNextRunAtMs > 0 ? new Date(schedulerNextRunAtMs).toISOString() : null,
        lag_ms: schedulerLagMs,
        run_count: Math.max(0, Math.trunc(Number((schedulerJob as any)?.run_count || 0))),
        fail_count: Math.max(0, Math.trunc(Number((schedulerJob as any)?.fail_count || 0))),
        last_run_at: String((schedulerJob as any)?.last_run_at || "") || null,
        last_success_at: String((schedulerJob as any)?.last_success_at || "") || null,
        last_error: (schedulerJob as any)?.last_error || null,
        lease_holder: doctorSchedulerInstanceId,
      },
      active_tokens: activeTokens,
      positions: statusPositions,
      wallet_tokens: statusWalletTokens,
      wallet_transactions: statusWalletTransactions,
      recent_trades: doctorRuntime.recentTrades.slice(0, 40),
      decision_journal: filteredDecisionJournal,
      performance: doctorRuntime.performance.slice(0, 30),
      execution_audit: doctorRuntime.executionAudit.slice(0, 80),
      sniper_logs: getDoctorSniperLogsForUser(statusUserId).slice(0, 80),
      discovery: {
        dexscreener_primary: true,
        poll_interval_seconds: Math.max(5, Math.trunc(Number(process.env.DOCTOR_DEX_POLL_SECONDS || 7))),
        worker_running: Boolean(doctorDexWorkerTimer),
        last_poll_at: doctorDexWorkerLastPollAt,
        processed_mints: doctorProcessedMints.size,
      },
      last_decision: doctorRuntime.lastDecision,
      tuning_suggestion: activeTokens.length < 5 ? "Lower minimum liquidity or widen scanner scope to increase candidates." : null,
      strategy_mode: getDoctorActiveSnipePreset(),
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
        detected: earlyTokens.length,
        enriched: earlyTokens.length,
        approved: activeTokens.length,
        rejected: Math.max(0, earlyTokens.length - activeTokens.length),
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

  app.get("/api/doctor/ticker", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      await loadDoctorRuntimeForUser(userId);
      const activeTokens = await getDoctorActiveTokens().catch(() => [] as Array<Record<string, any>>);
      const topCandidates = activeTokens.slice(0, 12);
      for (const token of topCandidates) {
        const row = token as Record<string, any>;
        enqueueDoctorTickerSignal({
          mint: String(row.address || "").trim(),
          symbol: String(row.symbol || "UNKNOWN"),
          name: String(row.name || row.symbol || "TOKEN"),
          priceUsd: Number(row.price_usd || 0),
          liquidityUsd: Number(row.liquidity || 0),
          volume5mUsd: Number(row.volume_5m || 0),
          ageMinutes: Math.max(0, Number(row.age_seconds || 0) / 60),
          buys5m: Number(row.buys_5m || 0),
          sells5m: Number(row.sells_5m || 0),
          source: String(row.source || "doctor_engine"),
          launchSource: String(row.launch_source || "unknown"),
          smartMoney: Number(row.buy_ratio_pct || 0) >= 75 && Number(row.buys_5m || 0) >= 4,
          rejectReasons: Array.isArray(row.reject_reasons) ? row.reject_reasons : [],
        });
      }
    } catch {
    }

    const limit = Math.max(5, Math.min(60, Math.trunc(Number(req.query?.limit || 24))));
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    return res.json({
      ok: true,
      items: doctorTickerQueue.slice(0, limit),
      as_of: nowIso(),
    });
  });

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

  app.get("/api/doctor/status", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    await loadDoctorRuntimeForUser(userId);
    const enabledBeforeStatus = Boolean(doctorRuntime.enabled);
    const presetBeforeStatus = normalizeDoctorSnipePreset((doctorRuntime.controls as any).snipe_preset);
    const executionModeBeforeStatus = String(doctorRuntime.execution.mode || "live").trim().toLowerCase() === "paper" ? "paper" : "live";
    await syncDoctorWalletFromAssistantRuntime(userId);
    await refreshDoctorWalletBalanceFromChain(undefined, true);
    await saveDoctorWalletForUser(userId);
    doctorRuntime.enabled = enabledBeforeStatus;
    (doctorRuntime.controls as any).snipe_preset = presetBeforeStatus;
    doctorRuntime.execution.mode = executionModeBeforeStatus;

    // If scheduler is active but enabled drifted false, repair the runtime flag so
    // status and execution behavior stay consistent across refreshes.
    if (!doctorRuntime.enabled && !doctorRuntime.killSwitch) {
      const schedulerJob = await getDoctorSchedulerJobForUser(userId);
      if (Boolean(schedulerJob?.enabled)) {
        doctorRuntime.enabled = true;
        doctorRuntime.lastError = null;
        await persistDoctorRuntime(userId);
      }
    }

    const status = await buildDoctorStatus(userId);
    return res.json(status);
  });

  app.get("/api/doctor/scheduler", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const normalizedUserId = String(userId || "").trim();
    const state = await getDoctorSchedulerState();
    const jobs = (state.jobs && typeof state.jobs === "object") ? state.jobs as Record<string, any> : {};
    const lease = (state.lease && typeof state.lease === "object") ? state.lease as Record<string, any> : {};
    const userJob = jobs[normalizedUserId] as Record<string, any> | undefined;
    const nowMs = Date.now();
    const nextRunAtMs = Math.max(0, Number(userJob?.next_run_at || 0));
    const lagMs = nextRunAtMs > 0 ? Math.max(0, nowMs - nextRunAtMs) : 0;

    const allJobs = Object.values(jobs)
      .filter((item) => item && typeof item === "object") as Array<Record<string, any>>;
    const activeJobs = allJobs.filter((item) => Boolean(item.enabled));
    const overdueJobs = activeJobs.filter((item) => {
      const ts = Number(item.next_run_at || 0);
      return ts > 0 && ts <= nowMs;
    });

    return res.json({
      user: {
        user_id: normalizedUserId,
        scheduled: Boolean(userJob?.enabled),
        interval_seconds: Math.max(2, Math.trunc(Number(userJob?.interval_seconds || 0))) || null,
        next_run_at: nextRunAtMs > 0 ? new Date(nextRunAtMs).toISOString() : null,
        lag_ms: lagMs,
        run_count: Math.max(0, Math.trunc(Number(userJob?.run_count || 0))),
        fail_count: Math.max(0, Math.trunc(Number(userJob?.fail_count || 0))),
        last_run_at: String(userJob?.last_run_at || "") || null,
        last_success_at: String(userJob?.last_success_at || "") || null,
        last_error: userJob?.last_error || null,
      },
      queue: {
        total_jobs: allJobs.length,
        active_jobs: activeJobs.length,
        overdue_jobs: overdueJobs.length,
      },
      lease: {
        holder: String(lease.holder || "") || null,
        is_local_holder: String(lease.holder || "") === doctorSchedulerInstanceId,
        expires_at: Number(lease.expires_at || 0) > 0 ? new Date(Number(lease.expires_at)).toISOString() : null,
      },
      instance_id: doctorSchedulerInstanceId,
    });
  });

  const handleDoctorWalletMap = async (req: any, res: any) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [walletsByUser, runtimesByUser] = await Promise.all([
      getStoredDoctorWalletsByUser(),
      getStoredDoctorRuntimesByUser(),
    ]);

    const allUserIds = Array.from(new Set([
      ...Object.keys(walletsByUser || {}),
      ...Object.keys(runtimesByUser || {}),
    ]));

    const users = allUserIds
      .map((confirmId) => {
        const wallet = (walletsByUser?.[confirmId] || {}) as Record<string, any>;
        const runtime = (runtimesByUser?.[confirmId] || {}) as Record<string, any>;
        const walletAddress = String(wallet.address || "").trim();
        const livePrivateKeyValue = String(wallet.livePrivateKey || "").trim();
        const hasPrivateKey = Boolean(livePrivateKeyValue);

        return {
          confirm_id: confirmId,
          runtime_owner_user_id: String(runtime.ownerUserId || "").trim() || null,
          enabled: Boolean(runtime.enabled),
          execution_mode: String(runtime?.execution?.mode || "").trim() || "paper",
          wallet_address: walletAddress || null,
          wallet_address_masked: walletAddress ? maskDoctorWalletAddress(walletAddress) : null,
          has_private_key: hasPrivateKey,
          auto_hydrate_blocked: Boolean(wallet.autoHydrateBlocked),
          separate_wallet_enforced: wallet.separateWalletEnforced !== false,
          last_run_at: String(runtime.lastRunAt || "").trim() || null,
          last_error: String(runtime.lastError || "").trim() || null,
        };
      })
      .sort((a, b) => a.confirm_id.localeCompare(b.confirm_id));

    const walletAddressToUsers = new Map<string, string[]>();
    for (const item of users) {
      const address = String(item.wallet_address || "").trim();
      if (!address) continue;
      const currentUsers = walletAddressToUsers.get(address) || [];
      currentUsers.push(item.confirm_id);
      walletAddressToUsers.set(address, currentUsers);
    }

    const sharedWallets = Array.from(walletAddressToUsers.entries())
      .filter(([, userIds]) => userIds.length > 1)
      .map(([address, confirmIds]) => ({
        wallet_address: address,
        wallet_address_masked: maskDoctorWalletAddress(address),
        confirm_ids: confirmIds.sort(),
      }))
      .sort((a, b) => a.wallet_address.localeCompare(b.wallet_address));

    return res.json({
      ok: true,
      requested_by_confirm_id: userId,
      runtime_owner_user_id: String(doctorRuntime.ownerUserId || "").trim() || null,
      totals: {
        users: users.length,
        with_wallet: users.filter((item) => Boolean(item.wallet_address)).length,
        with_private_key: users.filter((item) => item.has_private_key).length,
        shared_wallet_groups: sharedWallets.length,
      },
      shared_wallets: sharedWallets,
      users,
      as_of: new Date().toISOString(),
    });
  };

  app.get("/api/doctor/wallet-map", isAuthenticated, handleDoctorWalletMap);
  app.get("/api/doctor/admin/wallet-map", isAuthenticated, handleDoctorWalletMap);

  app.post("/api/doctor/control", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await loadDoctorRuntimeForUser(userId);
    await syncDoctorWalletFromAssistantRuntime(userId);
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ message: "enabled_boolean_required" });
    }
    const requestedEnable = req.body.enabled as boolean;
    const presetBeforeToggle = normalizeDoctorSnipePreset((doctorRuntime.controls as any).snipe_preset);

    const enabled = requestedEnable;
    doctorRuntime.enabled = enabled && !doctorRuntime.killSwitch;
    (doctorRuntime.controls as any).snipe_preset = presetBeforeToggle;
    if (enabled && doctorRuntime.killSwitch) {
      doctorRuntime.lastError = "Cannot enable while kill switch is active";
    }
    await persistDoctorRuntime(userId);

    await stopDoctorCycleForUser(userId);
    if (doctorRuntime.enabled) {
      await ensureDoctorLiveExecutionModeIfCapable(userId);
      await startDoctorCycleForUser(userId);
      // Guard against stale runtime snapshots immediately after start.
      await loadDoctorRuntimeForUser(userId);
      if (!doctorRuntime.killSwitch && !doctorRuntime.enabled) {
        doctorRuntime.enabled = true;
        doctorRuntime.lastError = null;
        await persistDoctorRuntime(userId);
      }
    }

    await saveDoctorWalletForUser(userId);
    return res.json(await buildDoctorStatus(userId));
  });

  app.post("/api/doctor/config", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await loadDoctorRuntimeForUser(userId);

    const payload = req.body || {};
    if (typeof payload.execution_mode === "string") {
      doctorRuntime.execution.mode = String(payload.execution_mode).trim().toLowerCase() === "paper" ? "paper" : "live";
    }
    if (typeof payload.snipe_preset === "string") {
      (doctorRuntime.controls as any).snipe_preset = normalizeDoctorSnipePreset(payload.snipe_preset);
      try {
        const presetsByUser = await getStoredDoctorPresetsByUser();
        presetsByUser[userId] = normalizeDoctorSnipePreset(payload.snipe_preset);
        await setStoredDoctorPresetsByUser(presetsByUser);
      } catch {
      }
    }
    if (typeof payload.kill_switch === "boolean") {
      doctorRuntime.killSwitch = payload.kill_switch;
      if (doctorRuntime.killSwitch) {
        doctorRuntime.enabled = false;
      }
    }
    if (Number.isFinite(Number(payload.scan_interval_seconds))) {
      doctorRuntime.scanIntervalSeconds = Math.max(2, Math.trunc(Number(payload.scan_interval_seconds)));
    }

    const numericKeys = [
      "buy_amount_sol",
      "max_trades_per_day",
      "max_wallet_allocation_pct",
      "take_profit_multiplier",
      "min_profit_pct",
      "max_open_positions",
      "strategy_window_minutes",
      "ai_min_signals_required",
      "cooldown_minutes_per_mint",
      "min_wallet_fee_buffer_sol",
      "min_liquidity_sol",
      "max_liquidity_sol",
      "min_buys_5m",
      "max_sells_5m",
      "max_token_age_seconds",
      "live_sell_fraction_pct",
      "max_sell_notional_usd",
      "gas_priority_lamports",
      "stop_loss_pct",
      "trailing_stop_pct",
      "min_liquidity_usd",
      "max_liquidity_usd",
      "min_market_cap_usd",
      "max_market_cap_usd",
      "min_volume_24h_usd",
      "min_token_age_minutes",
      "max_token_age_minutes",
      "min_lock_hours",
      "max_slippage_pct",
      "max_spread_pct",
      "daily_loss_limit_usd",
      "max_consecutive_losses",
      "strong_move_threshold_pct",
      "max_hold_minutes",
      "position_rotation_minutes",
      "min_momentum_profit_pct",
      "quality_min_volume_spike_pct",
      "quality_max_top_holder_pct",
      "max_dev_wallet_pct",
      "min_unique_buyers",
      "min_buy_ratio_pct",
      "max_early_spike_pct",
    ] as const;

    for (const key of numericKeys) {
      if (Number.isFinite(Number(payload[key]))) {
        (doctorRuntime.controls as any)[key] = Number(payload[key]);
      }
    }

    const presetAfterPayload = normalizeDoctorSnipePreset((doctorRuntime.controls as any).snipe_preset);
    if (shouldForceDoctorCustomPreset(presetAfterPayload, payload)) {
      (doctorRuntime.controls as any).snipe_preset = "custom";
      try {
        const presetsByUser = await getStoredDoctorPresetsByUser();
        presetsByUser[userId] = "custom";
        await setStoredDoctorPresetsByUser(presetsByUser);
      } catch {
      }
    }

    doctorRuntime.controls.max_open_positions = Math.max(1, Math.trunc(Number(doctorRuntime.controls.max_open_positions || 3)));

    doctorRuntime.controls.buy_amount_sol = Math.max(0.1, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    doctorRuntime.controls.min_buy_amount_sol = Math.max(0.1, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    (doctorRuntime.controls as any).snipe_preset = normalizeDoctorSnipePreset((doctorRuntime.controls as any).snipe_preset);
    doctorRuntime.controls.strategy_window_minutes = Math.min(5, Math.max(3, Number(doctorRuntime.controls.strategy_window_minutes || 5)));
    doctorRuntime.controls.min_token_age_minutes = Math.max(0, Number(doctorRuntime.controls.min_token_age_minutes || 0));
    doctorRuntime.controls.max_token_age_minutes = Math.min(10, Math.max(Number(doctorRuntime.controls.min_token_age_minutes || 0), Number(doctorRuntime.controls.max_token_age_minutes || 10)));
    doctorRuntime.controls.max_token_age_seconds = Math.max(30, Number(doctorRuntime.controls.max_token_age_seconds || 240));
    if (isDoctorDexTurboEnabled() && doctorRuntime.controls.max_token_age_seconds < 120) {
      doctorRuntime.controls.max_token_age_seconds = 120;
    }
    await persistDoctorRuntime(userId);

    await stopDoctorCycleForUser(userId);
    if (doctorRuntime.enabled) {
      await ensureDoctorLiveExecutionModeIfCapable(userId);
      await startDoctorCycleForUser(userId);
    }

    await saveDoctorWalletForUser(userId);
    return res.json(await buildDoctorStatus(userId));
  });

  app.post(
    "/api/doctor/connect-wallet",
    (req: any, _res, next) => {
      console.info("[doctor.connect-wallet] incoming", {
        method: req.method,
        path: req.path,
        hasAuthHeader: Boolean(req.headers?.authorization),
        hasSessionUser: Boolean(req.user?.id),
      });
      next();
    },
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = getRequestUserId(req);
        if (!userId) {
          console.warn("[doctor.connect-wallet] denied", { reason: "missing_user_id" });
          return res.status(401).json({ message: "Unauthorized" });
        }
        await loadDoctorRuntimeForUser(userId);

        const payload = req.body || {};
        const explicitAddress = String(payload.public_address || "").trim();
        const explicitPrivateKey = String(payload.private_key || "").trim();
        const walletBalanceTimeoutMs = Math.max(300, Number(process.env.DOCTOR_WALLET_BALANCE_TIMEOUT_MS || 1200));

        console.info("[doctor.connect-wallet] request", {
          userId,
          hasPrivateKey: Boolean(explicitPrivateKey),
          privateKeyLength: explicitPrivateKey.length,
          explicitAddress: explicitAddress || null,
        });

        if (!explicitPrivateKey) {
          console.warn("[doctor.connect-wallet] rejected", {
            userId,
            reason: "manual_private_key_required",
          });
          return res.status(400).json({
            message: "manual_private_key_required",
            detail: "Paste your wallet private key to connect DoctorTrade.",
          });
        }

        let resolvedAddress = explicitAddress;
        if (!resolvedAddress && explicitPrivateKey) {
          resolvedAddress = deriveSolanaAddressFromPrivateKey(explicitPrivateKey);
          if (!resolvedAddress) {
            console.warn("[doctor.connect-wallet] rejected", {
              userId,
              reason: "invalid_private_key_format",
            });
            return res.status(400).json({ message: "Invalid Solana private key format" });
          }
        }

        if (explicitAddress && resolvedAddress && explicitAddress !== resolvedAddress) {
          console.warn("[doctor.connect-wallet] rejected", {
            userId,
            reason: "wallet_address_mismatch",
            explicitAddress,
            resolvedAddress,
          });
          return res.status(400).json({
            message: "wallet_address_mismatch",
            detail: "Provided public address does not match the private key.",
          });
        }

        if (resolvedAddress) {
          doctorRuntime.wallet.address = resolvedAddress;
          try {
            const pubkey = new PublicKey(resolvedAddress);
            const lamports = await Promise.race<number>([
              getSolanaConnection().getBalance(pubkey, "processed"),
              new Promise<number>((_resolve, reject) => setTimeout(() => reject(new Error("wallet_balance_timeout")), walletBalanceTimeoutMs)),
            ]);
            const onchainBalanceSol = Number((lamports / 1_000_000_000).toFixed(6));
            doctorRuntime.wallet.balanceSol = Math.max(0, onchainBalanceSol);
          } catch (error: any) {
            console.warn("[doctor.connect-wallet] balance_refresh_failed", {
              userId,
              walletAddress: resolvedAddress,
              message: String(error?.message || "unknown_error"),
            });
          }
        }

        await setDoctorLivePrivateKeyForUser(userId, explicitPrivateKey);
        console.info("[doctor.connect-wallet] live_private_key_set", {
          userId,
          walletAddress: String(doctorRuntime.wallet.address || "").trim() || null,
        });

        {
          const wallets = await getStoredDoctorWalletsByUser();
          const existing = wallets[userId] as Record<string, any> | undefined;
          wallets[userId] = {
            ...(existing || {}),
            address: String(doctorRuntime.wallet.address || existing?.address || "").trim(),
            balanceSol: Math.max(0, Number(doctorRuntime.wallet.balanceSol ?? existing?.balanceSol ?? 0)),
            separateWalletEnforced: (doctorRuntime.wallet.separateWalletEnforced ?? existing?.separateWalletEnforced) !== false,
            livePrivateKey: String(existing?.livePrivateKey || "").trim(),
            autoHydrateBlocked: false,
            updatedAt: nowIso(),
          };
          await setStoredDoctorWalletsByUser(wallets);
          console.info("[doctor.connect-wallet] wallet_map_persisted", {
            userId,
            walletAddress: String(wallets[userId]?.address || "").trim() || null,
            autoHydrateBlocked: wallets[userId]?.autoHydrateBlocked === true,
          });
        }

        await refreshDoctorWalletBalanceFromChain(doctorRuntime.wallet.address, true);
        doctorRuntime.wallet.balanceSol = Math.max(doctorRuntime.wallet.balanceSol, 0);
        await ensureDoctorLiveExecutionModeIfCapable(userId);
        doctorRuntime.execution.mode = "live";
        doctorRuntime.enabled = true;
        await persistDoctorRuntime(userId);
        console.info("[doctor.connect-wallet] runtime_persisted", {
          userId,
          walletAddress: String(doctorRuntime.wallet.address || "").trim() || null,
          enabled: doctorRuntime.enabled,
          executionMode: doctorRuntime.execution.mode,
        });
        await saveDoctorWalletForUser(userId);
        await startDoctorCycleForUser(userId);
        console.info("[doctor.connect-wallet] cycle_started", {
          userId,
          scanIntervalSeconds: doctorRuntime.scanIntervalSeconds,
        });
        console.info("[doctor.connect-wallet] success", {
          userId,
          walletAddress: String(doctorRuntime.wallet.address || "").trim() || null,
        });
        return res.json(await buildDoctorStatus(userId));
      } catch (error: any) {
        console.error("[doctor.connect-wallet] failed", {
          message: String(error?.message || "unknown_error"),
          stack: String(error?.stack || ""),
        });
        return res.status(500).json({
          message: "wallet_connect_failed",
          detail: "Failed to connect wallet. Please try again.",
        });
      }
    },
  );

  app.post("/api/doctor/disconnect-wallet", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await loadDoctorRuntimeForUser(userId);

    doctorRuntime.wallet.address = "";
    doctorRuntime.wallet.balanceSol = 0;
    doctorRuntime.enabled = false;
    await clearDoctorWalletForUser(userId);
    await persistDoctorRuntime(userId);
    await stopDoctorCycleForUser(userId);
    return res.json(await buildDoctorStatus(userId));
  });

  app.post("/api/doctor/run-once", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await loadDoctorRuntimeForUser(userId);
    await syncDoctorWalletFromAssistantRuntime(userId);
    await ensureDoctorLiveExecutionModeIfCapable(userId);

    const result = await runDoctorCycleSafely("manual", userId);
    await saveDoctorWalletForUser(userId);
    return res.json({ result });
  });

  app.post("/api/doctor/direct-buy", isAuthenticated, async (req: any, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await loadDoctorRuntimeForUser(userId);
    await ensureDoctorLiveExecutionModeIfCapable(userId);

    const contractAddress = String(req.body?.contract_address || req.body?.address || "").trim();
    const symbol = String(req.body?.symbol || "MANUAL").trim() || "MANUAL";
    if (!contractAddress) {
      return res.status(400).json({ result: { executed: false, reason: "contract_address_required" } });
    }
    const requiresLiveWallet = isDoctorLiveOnlyMode() || doctorRuntime.execution.mode === "live";
    if (requiresLiveWallet && !doctorRuntime.wallet.address) {
      const liveCredentials = await getDoctorLiveWalletCredentials(userId);
      const resolvedWalletAddress = String(liveCredentials.walletPublicKey || "").trim();
      if (resolvedWalletAddress) {
        doctorRuntime.wallet.address = resolvedWalletAddress;
      }
    }
    if (requiresLiveWallet && !doctorRuntime.wallet.address) {
      return res.json({ result: { executed: false, reason: "live_wallet_credentials_missing" } });
    }

    const existingPosition = doctorRuntime.positions.find((position) => String(position.address || "") === contractAddress);
    if (existingPosition) {
      return res.json({ result: { executed: false, reason: "token_already_owned" } });
    }

    if (hasDoctorBoughtMintBefore(contractAddress)) {
      return res.json({ result: { executed: false, reason: "duplicate_buy_blocked" } });
    }

    if (doctorRuntime.positions.length >= getDoctorEffectiveMaxOpenPositions()) {
      return res.json({ result: { executed: false, reason: "max_open_positions_reached" } });
    }

    const buyAmount = Math.max(0.1, Number(doctorRuntime.controls.buy_amount_sol || 0.1));
    const activeTokens = await getDoctorActiveTokens();
    const candidate = activeTokens.find((item) => String(item.address || "") === contractAddress);
    const expectedPriceUsd = resolveCurrentPriceUsd(candidate || {}, Number(req.body?.price_usd || 0));

    const buyExecution = await executeDoctorOrder({
      action: "buy",
      symbol,
      mint: contractAddress,
      amountSol: buyAmount,
      expectedPriceUsd,
      reason: "manual_direct_buy",
      trigger: "manual",
      userId,
      baseMint: String((candidate as any)?.base_mint || getDoctorTradeBaseAssetMint()),
    });

    if (!buyExecution.executed) {
      return res.json({
        result: {
          executed: false,
          reason: String((buyExecution as any).reason || "manual_buy_failed"),
        },
      });
    }

    const now = new Date().toISOString();
    const position = {
      symbol,
      address: contractAddress,
      entry_price: expectedPriceUsd,
      current_price: expectedPriceUsd,
      peak_price: expectedPriceUsd,
      liquidity: Number((candidate as any)?.liquidity || 0),
      confidence: Number((candidate as any)?.score || 70),
      size_pct: 100,
      risk_status: String((candidate as any)?.risk_level || "MEDIUM"),
      trailing_stop_pct: Number(doctorRuntime.controls.trailing_stop_pct || 10),
      amount_sol: buyAmount,
      execution_mode: doctorRuntime.execution.mode,
      base_mint: String((candidate as any)?.base_mint || getDoctorTradeBaseAssetMint()),
      opened_at: now,
      source: "manual",
    };

    doctorRuntime.controls.trades_today = Number(doctorRuntime.controls.trades_today || 0) + 1;
    doctorRuntime.positions.unshift(position);
    doctorRuntime.positions = doctorRuntime.positions.slice(0, 30);
    doctorRuntime.wallet.balanceSol = Number((Math.max(0, Number(doctorRuntime.wallet.balanceSol || 0) - buyAmount)).toFixed(6));
    clampDoctorPaperBalance();

    doctorRuntime.recentTrades.unshift({
      token: symbol,
      address: contractAddress,
      action: "BUY",
      status: "EXECUTED",
      reason: "manual_direct_buy",
      confidence: Number((candidate as any)?.score || 70),
      liquidity: Number((candidate as any)?.liquidity || 0),
      volume_5m: Number((candidate as any)?.volume_5m || 0),
      size_pct: 100,
      notional_usd: Number((buyAmount * expectedPriceUsd).toFixed(2)),
      tx_hash: (buyExecution as any).txHash,
      execution_mode: doctorRuntime.execution.mode,
      timestamp: now,
    });
    markDoctorMintAsBought(contractAddress);
    doctorRuntime.decisionJournal.unshift({
      token: symbol,
      address: contractAddress,
      decision: "buy",
      reason: "manual_direct_buy",
      confidence: Number((candidate as any)?.score || 70),
      size_pct: 100,
      strategy_mode: "manual",
      timestamp: now,
    });
    doctorRuntime.recentTrades = doctorRuntime.recentTrades.slice(0, 50);
    doctorRuntime.decisionJournal = doctorRuntime.decisionJournal.slice(0, 80);
    await saveDoctorWalletForUser(userId);
    await persistDoctorRuntime(userId);

    return res.json({
      result: {
        executed: true,
        signature: (buyExecution as any).txHash,
        buy_amount_sol: buyAmount,
      },
    });
  });

  const startDoctorCyclesForEnabledUsers = async () => {
    try {
      const runtimeByUser = await getStoredDoctorRuntimesByUser();
      let userIds = Object.keys(runtimeByUser || {}).filter(Boolean);

      if (userIds.length === 0) {
        const legacy = await storage.getAppState<Record<string, any>>(doctorRuntimeStateKey);
        const legacyOwner = String(legacy?.ownerUserId || "").trim();
        if (legacy && typeof legacy === "object" && legacyOwner) {
          runtimeByUser[legacyOwner] = legacy;
          await setStoredDoctorRuntimesByUser(runtimeByUser);
          userIds = [legacyOwner];
        }
      }

      for (const userId of userIds) {
        const runtime = runtimeByUser[userId] as Record<string, any> | undefined;
        if (runtime && runtime.enabled) {
          await upsertDoctorSchedulerJob(userId, true, Math.max(2, Math.trunc(Number(runtime.scanIntervalSeconds || 10))), false);
        }
      }
    } catch {
    }
  };

  startDoctorScheduler();
  void startDoctorCyclesForEnabledUsers();

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
  let assistantCurrentUserId = "";

  const getAssistantStateKeyForUser = (userId: string) => `${assistantStateKey}:${String(userId || "").trim()}`;

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

  const persistAssistantRuntime = async (userIdOverride?: string) => {
    const userId = String(userIdOverride || assistantCurrentUserId || "").trim();
    if (!userId) {
      return;
    }
    try {
      await storage.setAppState(getAssistantStateKeyForUser(userId), assistantRuntime);
    } catch {
    }
  };

  const loadAssistantRuntime = async (userId: string) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      resetAssistantRuntime();
      assistantCurrentUserId = "";
      return;
    }

    resetAssistantRuntime();
    assistantCurrentUserId = normalizedUserId;

    try {
      const loaded = await storage.getAppState<Record<string, any>>(getAssistantStateKeyForUser(normalizedUserId));
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
  const chainNativeSymbol = (_chain: AssistantChain) => "SOL";

  await loadDoctorDexWorkerState();
  startDoctorDexWorker();

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

  const buildAssistantWalletFromPrivateKey = (privateKeyInput: string) => {
    const secretKey = parseSolanaSecretKey(privateKeyInput);
    if (!secretKey) {
      throw new Error("invalid private key");
    }

    let keypair: Keypair;
    if (secretKey.length >= 64) {
      keypair = Keypair.fromSecretKey(secretKey);
    } else if (secretKey.length === 32) {
      keypair = Keypair.fromSeed(secretKey);
    } else {
      throw new Error("invalid private key");
    }

    const address = keypair.publicKey.toBase58();
    const privateKey = bs58Codec.encode(keypair.secretKey);
    return {
      mnemonic: "",
      addresses_by_chain: { solana: address },
      private_keys_by_chain: { solana: privateKey },
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

  app.use("/api/ai", isAuthenticated, async (req: any, res, next) => {
    try {
      const userId = String(req?.user?.claims?.sub || "").trim();
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      await loadAssistantRuntime(userId);
      return next();
    } catch {
      return res.status(500).json({ message: "Failed to initialize assistant context" });
    }
  });

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

  const fetchSolanaSplTokenPortfolio = async (address: string) => {
    if (!validateAddressForChain("solana", address)) {
      return [] as Array<Record<string, any>>;
    }

    try {
      const ownerPk = new PublicKey(address);
      const tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const accounts = await getSolanaConnection().getParsedTokenAccountsByOwner(ownerPk, { programId: tokenProgram }, "confirmed");
      const activeTokens = await getDoctorActiveTokens().catch(() => [] as Array<Record<string, any>>);
      const activeTokenMap = new Map(activeTokens.map((token) => [String(token.address || "").trim(), token]));

      const rows: Array<Record<string, any>> = [];
      for (const entry of accounts.value) {
        const parsedInfo = (entry.account.data as any)?.parsed?.info as Record<string, any> | undefined;
        const tokenAmount = (parsedInfo?.tokenAmount || {}) as Record<string, any>;
        const mint = String(parsedInfo?.mint || "").trim();
        const uiAmount = Number(tokenAmount?.uiAmount || 0);
        if (!mint || !Number.isFinite(uiAmount) || uiAmount <= 0) continue;

        const amountRaw = String(tokenAmount?.amount || "0");
        const decimals = Math.max(0, Math.trunc(Number(tokenAmount?.decimals || 0)));
        const marketToken = activeTokenMap.get(mint) as Record<string, any> | undefined;
        const resolvedPriceUsd = resolveCurrentPriceUsd(marketToken || {}, 0);
        const valueUsd = Number((uiAmount * Math.max(0, resolvedPriceUsd || 0)).toFixed(6));
        const symbol = String(marketToken?.symbol || marketToken?.token || "").trim() || `${mint.slice(0, 4)}...${mint.slice(-4)}`;

        rows.push({
          mint,
          symbol,
          ui_amount: Number(uiAmount.toFixed(9)),
          amount_raw: amountRaw,
          decimals,
          price_usd: Number((Math.max(0, resolvedPriceUsd || 0)).toFixed(9)),
          value_usd: valueUsd,
        });
      }

      rows.sort((a, b) => {
        const byValue = Number(b.value_usd || 0) - Number(a.value_usd || 0);
        if (Math.abs(byValue) > 0.000001) return byValue;
        return Number(b.ui_amount || 0) - Number(a.ui_amount || 0);
      });

      return rows.slice(0, 200);
    } catch {
      return [] as Array<Record<string, any>>;
    }
  };

  const fetchSolanaOnchainTransactions = async (address: string, limit = 50) => {
    const walletAddress = String(address || "").trim();
    if (!validateAddressForChain("solana", walletAddress)) {
      return [] as Array<Record<string, any>>;
    }

    try {
      const prices = await fetchChainPricesUsd().catch(() => ({ solana: 0 } as Record<string, number>));
      const solPriceUsd = Math.max(0, Number((prices as any)?.solana || 0));
      const activeTokens = await getDoctorActiveTokens().catch(() => [] as Array<Record<string, any>>);
      const activeTokenMap = new Map(activeTokens.map((token) => [String(token.address || "").trim(), token]));
      const ownerPk = new PublicKey(walletAddress);
      const signatures = await getSolanaConnection().getSignaturesForAddress(
        ownerPk,
        { limit: Math.max(1, Math.min(200, Math.trunc(limit || 50))) },
        "confirmed",
      );
      const signatureValues = signatures.map((item) => String(item.signature || "").trim()).filter(Boolean);
      const parsedTransactions = signatureValues.length > 0
        ? await getSolanaConnection().getParsedTransactions(signatureValues, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
        : [];

      return signatures.map((item, index) => {
        const signature = String(item.signature || "").trim();
        const createdAt = Number(item.blockTime || 0) > 0
          ? new Date(Number(item.blockTime) * 1000).toISOString()
          : nowIso();
        const parsed = (parsedTransactions[index] as any) || null;
        const accountKeys = Array.isArray(parsed?.transaction?.message?.accountKeys) ? parsed.transaction.message.accountKeys : [];
        const ownerIndex = accountKeys.findIndex((entry: any) => {
          const key = String(entry?.pubkey?.toBase58?.() || entry?.pubkey || entry || "").trim();
          return key === walletAddress;
        });

        const preBalances = Array.isArray(parsed?.meta?.preBalances) ? parsed.meta.preBalances : [];
        const postBalances = Array.isArray(parsed?.meta?.postBalances) ? parsed.meta.postBalances : [];
        const preLamports = ownerIndex >= 0 ? Number(preBalances[ownerIndex] || 0) : 0;
        const postLamports = ownerIndex >= 0 ? Number(postBalances[ownerIndex] || 0) : 0;
        const solDelta = Number((((postLamports - preLamports) || 0) / 1_000_000_000).toFixed(9));

        const tokenDeltaByMint = new Map<string, number>();
        const applyTokenRows = (rows: any[], factor: number) => {
          for (const row of rows) {
            const owner = String(row?.owner || "").trim();
            if (owner !== walletAddress) continue;
            const mint = String(row?.mint || "").trim();
            if (!mint) continue;
            const uiAmount = Number(
              row?.uiTokenAmount?.uiAmountString
                ?? row?.uiTokenAmount?.uiAmount
                ?? 0,
            );
            const current = Number(tokenDeltaByMint.get(mint) || 0);
            tokenDeltaByMint.set(mint, Number((current + (factor * (Number.isFinite(uiAmount) ? uiAmount : 0))).toFixed(9)));
          }
        };
        applyTokenRows(Array.isArray(parsed?.meta?.postTokenBalances) ? parsed.meta.postTokenBalances : [], 1);
        applyTokenRows(Array.isArray(parsed?.meta?.preTokenBalances) ? parsed.meta.preTokenBalances : [], -1);

        let dominantMint = "";
        let dominantDelta = 0;
        tokenDeltaByMint.forEach((delta, mint) => {
          if (Math.abs(delta) > Math.abs(dominantDelta)) {
            dominantMint = mint;
            dominantDelta = delta;
          }
        });

        const marketToken = dominantMint ? activeTokenMap.get(dominantMint) as Record<string, any> | undefined : undefined;
        const tokenSymbol = dominantMint
          ? (String(marketToken?.symbol || marketToken?.token || "").trim() || `${dominantMint.slice(0, 4)}...${dominantMint.slice(-4)}`)
          : "SOL";
        const tokenPriceUsd = dominantMint ? Math.max(0, Number(resolveCurrentPriceUsd(marketToken || {}, 0) || 0)) : 0;
        const quantity = dominantMint ? Math.abs(dominantDelta) : Math.abs(solDelta);
        const quantityUnit = dominantMint ? "TOKEN" : "SOL";
        const worthSol = dominantMint
          ? (tokenPriceUsd > 0 && solPriceUsd > 0 ? Number(((Math.abs(dominantDelta) * tokenPriceUsd) / solPriceUsd).toFixed(9)) : 0)
          : Math.abs(solDelta);
        const notionalUsd = dominantMint
          ? Number((Math.abs(dominantDelta) * tokenPriceUsd).toFixed(2))
          : Number((Math.abs(solDelta) * solPriceUsd).toFixed(2));
        const txSide = dominantMint
          ? (dominantDelta >= 0 ? "buy" : "sell")
          : (solDelta >= 0 ? "receive" : "send");

        return {
          id: `onchain:${signature}`,
          chain: "solana",
          side: txSide,
          status: item.err ? "failed" : "confirmed",
          source: "onchain",
          contract_address: dominantMint || walletAddress,
          notional_usd: notionalUsd,
          quantity: Number.isFinite(quantity) ? Number(quantity.toFixed(9)) : null,
          quantity_unit: quantityUnit,
          asset: quantityUnit,
          token_symbol: tokenSymbol,
          worth_sol: Number.isFinite(worthSol) ? Number(worthSol.toFixed(9)) : 0,
          tx_hash: signature,
          explorer_url: signature ? chainExplorerTxUrl("solana", signature) : null,
          from_address: walletAddress,
          to_address: walletAddress,
          confirmation_status: String(item.confirmationStatus || "confirmed"),
          created_at: createdAt,
        };
      });
    } catch {
      return [] as Array<Record<string, any>>;
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
              tokens_value_usd: 0,
              spl_tokens: [],
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
              tokens_value_usd: 0,
              spl_tokens: [],
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
              tokens_value_usd: 0,
              spl_tokens: [],
              data_status: "rpc_not_configured",
            },
          ] as const;
        }

        const valueUsd = Number((balance * price_usd).toFixed(2));
        const splTokens = chain === "solana" ? await fetchSolanaSplTokenPortfolio(address) : [];
        const tokensValueUsd = Number(
          splTokens.reduce((sum, token) => sum + Number((token as any).value_usd || 0), 0).toFixed(2),
        );
        return [
          chain,
          {
            address,
            native_symbol,
            native_balance: Number(balance.toFixed(8)),
            price_usd,
            value_usd: valueUsd,
            tokens_value_usd: tokensValueUsd,
            spl_tokens: splTokens,
            data_status: "ok",
          },
        ] as const;
      }),
    );

    const chains = Object.fromEntries(entries);
    const total_usd = Object.values(chains).reduce(
      (sum: number, item: any) => sum + Number(item.value_usd || 0) + Number(item.tokens_value_usd || 0),
      0,
    );
    return res.json({
      wallet: assistantWalletStatus(),
      portfolio: {
        chains,
        total_usd: Number(total_usd.toFixed(2)),
        updated_at: nowIso(),
      },
    });
  });

  app.get("/api/ai/wallets/transactions", async (req, res) => {
    const limitRaw = Number(req.query.limit || 25);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 25;
    const assistantTransactions = assistantRuntime.transactions.slice(0, Math.max(1, limit * 2));
    const solanaAddress = String(assistantRuntime.wallet.addresses_by_chain.solana || "").trim();
    const onchainTransactions = await fetchSolanaOnchainTransactions(solanaAddress, Math.max(1, limit * 2));

    const mergedByKey = new Map<string, Record<string, any>>();
    for (const tx of assistantTransactions) {
      const hashKey = String((tx as any).tx_hash || "").trim();
      const idKey = String((tx as any).id || "").trim();
      const key = hashKey || idKey || `assistant:${Math.random().toString(36).slice(2, 10)}`;
      mergedByKey.set(key, { source: "assistant", ...(tx as Record<string, any>) });
    }
    for (const tx of onchainTransactions) {
      const hashKey = String((tx as any).tx_hash || "").trim();
      const idKey = String((tx as any).id || "").trim();
      const key = hashKey || idKey;
      if (!key) continue;
      if (!mergedByKey.has(key)) {
        mergedByKey.set(key, tx as Record<string, any>);
      }
    }

    const transactions = Array.from(mergedByKey.values())
      .sort((a, b) => {
        const ta = new Date(String((a as any).created_at || 0)).getTime();
        const tb = new Date(String((b as any).created_at || 0)).getTime();
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      })
      .slice(0, limit);

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
    await syncDoctorWalletFromAssistantRuntime(getRequestUserId(req));

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
    await syncDoctorWalletFromAssistantRuntime(getRequestUserId(req));

    return res.json({ wallet: assistantWalletStatus(), bundle: assistantBundle(true) });
  });

  app.post("/api/ai/wallets/import-private-key", async (req, res) => {
    const privateKey = String(req.body?.private_key || "").trim();
    const overwrite = Boolean(req.body?.overwrite);
    if (!privateKey) {
      return res.status(400).json({ message: "private key required" });
    }
    if (assistantRuntime.wallet.has_wallet && !overwrite) {
      return res.status(400).json({ message: "wallet already exists" });
    }

    let walletBundle: ReturnType<typeof buildAssistantWalletFromPrivateKey>;
    try {
      walletBundle = buildAssistantWalletFromPrivateKey(privateKey);
    } catch {
      return res.status(400).json({ message: "invalid private key" });
    }

    assistantRuntime.wallet.has_wallet = true;
    assistantRuntime.wallet.backup_confirmed = true;
    assistantRuntime.wallet.backup_confirmed_at = nowIso();
    assistantRuntime.wallet.created_at = nowIso();
    assistantRuntime.wallet.addresses_by_chain = walletBundle.addresses_by_chain;
    assistantRuntime.wallet.private_keys_by_chain = walletBundle.private_keys_by_chain;
    assistantRuntime.wallet.mnemonic = "";
    assistantRuntime.trading.wallets_by_chain = walletBundle.addresses_by_chain;
    assistantRuntime.trading.wallet_address = walletBundle.addresses_by_chain.solana || null;

    await persistAssistantRuntime();
    await syncDoctorWalletFromAssistantRuntime(getRequestUserId(req));

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
      quantity_unit: "SOL",
      asset,
      token_symbol: asset,
      worth_sol: Number(amount.toFixed(9)),
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

  app.post("/api/ai/wallets/swap", async (req, res) => {
    const side = String(req.body?.side || "buy").toLowerCase() === "sell" ? "sell" : "buy";
    const tokenMint = String(req.body?.token_mint || req.body?.contract_address || "").trim();
    const notionalUsd = Number(req.body?.notional_usd || 0);
    const amountSolInput = Number(req.body?.amount_sol || 0);
    const mode = String(req.body?.mode || "live").toLowerCase() === "paper" ? "paper" : "live";
    const hasNotionalUsd = Number.isFinite(notionalUsd) && notionalUsd > 0;
    const hasAmountSolInput = Number.isFinite(amountSolInput) && amountSolInput > 0;

    if (!tokenMint || (side === "buy" ? (!hasNotionalUsd && !hasAmountSolInput) : !hasNotionalUsd)) {
      return res.status(400).json({ message: "invalid swap payload" });
    }
    if (!validateAddressForChain("solana", tokenMint)) {
      return res.status(400).json({ message: "invalid solana token mint" });
    }
    if (!ensureWalletExists()) {
      return res.status(400).json({ message: "wallet not found" });
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

      const resolvedNotionalUsd = hasNotionalUsd
        ? notionalUsd
        : Math.max(0, amountSolInput * solPriceUsd);

      const connection = getSolanaConnection();
      const slippageBps = Math.max(25, Math.trunc(Number(doctorRuntime.controls.max_slippage_pct || 4) * 100));

      try {
        let quote: Record<string, any>;

        if (side === "buy") {
          const amountSol = hasAmountSolInput
            ? Math.max(0.0001, amountSolInput)
            : Math.max(0.0001, notionalUsd / solPriceUsd);
          const amountLamports = Math.max(1, Math.trunc(amountSol * 1_000_000_000));
          quote = await fetchJupiterQuote({
            inputMint: SOL_MINT,
            outputMint: tokenMint,
            amountAtomic: amountLamports,
            slippageBps,
          });
        } else {
          const ownerPk = new PublicKey(walletAddress);
          const mintPk = new PublicKey(tokenMint);
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
            inputMint: tokenMint,
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
            inputMint: tokenMint,
            outputMint: SOL_MINT,
            amountAtomic: (sellRaw > BigInt(0) ? sellRaw : BigInt(1)).toString(),
            slippageBps,
          });
        }

        const tokenDecimals = await getTokenMintDecimals(tokenMint).catch(() => 6);
        const quoteOutRaw = Number(quote?.outAmount || 0);
        const quoteInRaw = Number(quote?.inAmount || 0);
        const tokenQty = side === "buy"
          ? (quoteOutRaw > 0 ? quoteOutRaw / Math.pow(10, Math.max(0, tokenDecimals)) : 0)
          : (quoteInRaw > 0 ? quoteInRaw / Math.pow(10, Math.max(0, tokenDecimals)) : 0);
        const activeTokens = await getDoctorActiveTokens().catch(() => [] as Array<Record<string, any>>);
        const tokenMeta = activeTokens.find((item) => String(item.address || "").trim() === tokenMint) as Record<string, any> | undefined;
        const tokenSymbol = String(tokenMeta?.symbol || tokenMeta?.token || "").trim() || `${tokenMint.slice(0, 4)}...${tokenMint.slice(-4)}`;
        const worthSol = solPriceUsd > 0 ? Number((resolvedNotionalUsd / solPriceUsd).toFixed(9)) : 0;

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
          id: `swap_${Date.now()}`,
          chain: "solana",
          side,
          status: "executed",
          contract_address: tokenMint,
          notional_usd: Number(resolvedNotionalUsd.toFixed(2)),
          quantity: Number(tokenQty.toFixed(9)),
          quantity_unit: "TOKEN",
          asset: "TOKEN",
          token_symbol: tokenSymbol,
          worth_sol: worthSol,
          tx_hash: signature,
          explorer_url: `https://explorer.solana.com/tx/${signature}`,
          from_address: walletAddress,
          to_address: tokenMint,
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

    let resolvedPaperNotionalUsd = hasNotionalUsd ? notionalUsd : 0;
    if (side === "buy" && !resolvedPaperNotionalUsd && hasAmountSolInput) {
      const prices = await fetchChainPricesUsd();
      const solPriceUsd = Number(prices.solana || 0);
      if (solPriceUsd > 0) {
        resolvedPaperNotionalUsd = amountSolInput * solPriceUsd;
      }
    }

    const txHash = `swap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const prices = await fetchChainPricesUsd().catch(() => ({ solana: 0 } as Record<string, number>));
    const solPriceUsd = Number((prices as any)?.solana || 0);
    const activeTokens = await getDoctorActiveTokens().catch(() => [] as Array<Record<string, any>>);
    const tokenMeta = activeTokens.find((item) => String(item.address || "").trim() === tokenMint) as Record<string, any> | undefined;
    const tokenSymbol = String(tokenMeta?.symbol || tokenMeta?.token || "").trim() || `${tokenMint.slice(0, 4)}...${tokenMint.slice(-4)}`;
    const transaction = {
      id: `swap_${Date.now()}`,
      chain: "solana",
      side,
      status: "executed",
      contract_address: tokenMint,
      notional_usd: Number((resolvedPaperNotionalUsd || 0).toFixed(2)),
      quantity: null,
      quantity_unit: "TOKEN",
      asset: "TOKEN",
      token_symbol: tokenSymbol,
      worth_sol: solPriceUsd > 0 ? Number(((resolvedPaperNotionalUsd || 0) / solPriceUsd).toFixed(9)) : 0,
      tx_hash: txHash,
      explorer_url: `https://explorer.solana.com/tx/${txHash}`,
      from_address: assistantRuntime.wallet.addresses_by_chain.solana || "",
      to_address: tokenMint,
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
        tx_hash: txHash,
        explorer_url: transaction.explorer_url,
      },
    });
  });

  app.post("/api/ai/wallets/swap-quote", async (req, res) => {
    const side = String(req.body?.side || "buy").toLowerCase() === "sell" ? "sell" : "buy";
    const tokenMint = String(req.body?.token_mint || req.body?.contract_address || "").trim();
    const amountSol = Number(req.body?.amount_sol || 0);
    if (side !== "buy") {
      return res.status(400).json({ message: "only buy quote is supported" });
    }
    if (!tokenMint || !validateAddressForChain("solana", tokenMint)) {
      return res.status(400).json({ message: "invalid solana token mint" });
    }
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return res.status(400).json({ message: "invalid amount_sol" });
    }

    const slippageBps = Math.max(25, Math.trunc(Number(doctorRuntime.controls.max_slippage_pct || 4) * 100));
    const inLamports = Math.max(1, Math.trunc(amountSol * 1_000_000_000));

    try {
      const quote = await fetchJupiterQuote({
        inputMint: SOL_MINT,
        outputMint: tokenMint,
        amountAtomic: inLamports,
        slippageBps,
      });
      const outAmountRaw = Number(quote?.outAmount || 0);
      const tokenDecimals = await getTokenMintDecimals(tokenMint).catch(() => 6);
      const outAmountTokens = outAmountRaw > 0
        ? Number((outAmountRaw / Math.pow(10, Math.max(0, tokenDecimals))).toFixed(9))
        : 0;

      return res.json({
        quote: {
          side,
          input_mint: SOL_MINT,
          output_mint: tokenMint,
          input_amount_sol: Number(amountSol.toFixed(9)),
          output_amount_tokens: outAmountTokens,
          output_amount_raw: String(quote?.outAmount || "0"),
          output_decimals: tokenDecimals,
          price_impact_pct: Number(quote?.priceImpactPct || 0),
          route_count: Array.isArray(quote?.routePlan) ? quote.routePlan.length : 0,
          estimate_source: "router_quote",
        },
      });
    } catch (error) {
      try {
        const activeTokens = await getDoctorActiveTokens();
        const token = activeTokens.find((item) => String(item.address || "").trim() === tokenMint);
        const tokenPriceUsd = Number(token?.price_usd || 0);
        const prices = await fetchChainPricesUsd();
        const solPriceUsd = Number(prices.solana || 0);

        if (tokenPriceUsd > 0 && solPriceUsd > 0) {
          const outputAmountTokens = Number(((amountSol * solPriceUsd) / tokenPriceUsd).toFixed(9));
          const tokenDecimals = await getTokenMintDecimals(tokenMint).catch(() => 6);
          return res.json({
            quote: {
              side,
              input_mint: SOL_MINT,
              output_mint: tokenMint,
              input_amount_sol: Number(amountSol.toFixed(9)),
              output_amount_tokens: outputAmountTokens,
              output_amount_raw: "0",
              output_decimals: tokenDecimals,
              price_impact_pct: 0,
              route_count: 0,
              estimate_source: "price_fallback",
            },
          });
        }
      } catch {
      }

      return res.status(502).json({
        message: error instanceof Error ? error.message : "swap quote failed",
      });
    }
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

        const tokenDecimals = await getTokenMintDecimals(contractAddress).catch(() => 6);
        const quoteOutRaw = Number(quote?.outAmount || 0);
        const quoteInRaw = Number(quote?.inAmount || 0);
        const tokenQty = side === "buy"
          ? (quoteOutRaw > 0 ? quoteOutRaw / Math.pow(10, Math.max(0, tokenDecimals)) : 0)
          : (quoteInRaw > 0 ? quoteInRaw / Math.pow(10, Math.max(0, tokenDecimals)) : 0);
        const activeTokens = await getDoctorActiveTokens().catch(() => [] as Array<Record<string, any>>);
        const tokenMeta = activeTokens.find((item) => String(item.address || "").trim() === contractAddress) as Record<string, any> | undefined;
        const tokenSymbol = String(tokenMeta?.symbol || tokenMeta?.token || "").trim() || `${contractAddress.slice(0, 4)}...${contractAddress.slice(-4)}`;
        const worthSol = solPriceUsd > 0 ? Number((notionalUsd / solPriceUsd).toFixed(9)) : 0;

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
          quantity: Number(tokenQty.toFixed(9)),
          quantity_unit: "TOKEN",
          asset: "TOKEN",
          token_symbol: tokenSymbol,
          worth_sol: worthSol,
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
    const prices = await fetchChainPricesUsd().catch(() => ({ solana: 0 } as Record<string, number>));
    const solPriceUsd = Number((prices as any)?.solana || 0);
    const activeTokens = await getDoctorActiveTokens().catch(() => [] as Array<Record<string, any>>);
    const tokenMeta = activeTokens.find((item) => String(item.address || "").trim() === contractAddress) as Record<string, any> | undefined;
    const tokenSymbol = String(tokenMeta?.symbol || tokenMeta?.token || "").trim() || `${contractAddress.slice(0, 4)}...${contractAddress.slice(-4)}`;
    const transaction = {
      id: `trade_${Date.now()}`,
      chain: "solana",
      side,
      status: "executed",
      contract_address: contractAddress,
      notional_usd: Number(notionalUsd.toFixed(2)),
      quantity: null,
      quantity_unit: "TOKEN",
      asset: "TOKEN",
      token_symbol: tokenSymbol,
      worth_sol: solPriceUsd > 0 ? Number((notionalUsd / solPriceUsd).toFixed(9)) : 0,
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
    const apiKey = resolveOpenAiApiKey();
    if (!apiKey) {
      return res.status(503).json({
        assistant: {
          answer: "OpenAI is not configured for this environment.",
          key_points: ["Set OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY."],
          source: "openai_unavailable",
        },
      });
    }

    const messages = [
      { role: "system" as const, content: "You are TradeAid AI assistant. Give practical, concise trading guidance with risk warnings." },
      { role: "user" as const, content: question || "Give a short update on how to safely run meme sniping." },
    ];

    const attempt = async () => {
      let lastError: unknown = null;
      for (const model of resolveOpenAiModelFallbacks()) {
        try {
          return await getOpenAI().chat.completions.create({ model, messages });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("openai_completion_failed");
    };

    return attempt().then((completion) => {
      const answer = String(completion.choices?.[0]?.message?.content || "").trim() || "No response generated.";
      const keyPoints = answer
        .split(/\n|\.|;|\-/g)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4);
      return res.json({
        assistant: {
          answer,
          key_points: keyPoints,
          source: "openai",
        },
      });
    }).catch((error) => {
      logStructured("warn", "openai.ai_ask_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return res.status(502).json({
        assistant: {
          answer: "OpenAI request failed.",
          key_points: ["Retry shortly; OpenAI may be unavailable or rate-limited."],
          source: "openai_unavailable",
        },
      });
    });
  });

  app.post("/api/ai/assist", async (req, res) => {
    const apiKey = resolveOpenAiApiKey();
    if (!apiKey) {
      return res.status(503).json({
        assistant: {
          recommendation: "hold",
          confidence: 0,
          rationale: "OpenAI is not configured for this environment.",
          source: "openai_unavailable",
        },
      });
    }

    try {
      const token = req.body?.token || req.body || {};
      const prompt = [
        "You are TradeAid AI assistant.",
        "Given token context, return strict JSON with keys: recommendation (buy|monitor|hold|sell), confidence (0-100 number), rationale (string, max 2 sentences).",
        "Do not include markdown.",
        JSON.stringify(token),
      ].join("\n");

      let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>> | null = null;
      let lastError: unknown = null;
      for (const model of resolveOpenAiModelFallbacks()) {
        try {
          completion = await getOpenAI().chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!completion) {
        throw lastError instanceof Error ? lastError : new Error("openai_completion_failed");
      }

      const parsed = JSON.parse(String(completion.choices?.[0]?.message?.content || "{}"));
      const recommendationRaw = String(parsed?.recommendation || "monitor").trim().toLowerCase();
      const recommendation = (["buy", "monitor", "hold", "sell"] as const).includes(recommendationRaw as any)
        ? recommendationRaw
        : "monitor";

      return res.json({
        assistant: {
          recommendation,
          confidence: Math.max(0, Math.min(100, Number(parsed?.confidence || 0))),
          rationale: String(parsed?.rationale || "No rationale provided.").trim(),
          source: "openai",
        },
      });
    } catch (error) {
      logStructured("warn", "openai.ai_assist_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return res.status(502).json({
        assistant: {
          recommendation: "hold",
          confidence: 0,
          rationale: "OpenAI request failed.",
          source: "openai_unavailable",
        },
      });
    }
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
      const score = await buildDexScoreFallback(contractAddress, chain);
      const aiExplanation = await buildOpenAiScoreExplanation(score);
      const baseConfidence = Number(score?.scores?.trade_confidence_index || 0);
      const adjustedConfidence = Math.max(0, Math.min(100, baseConfidence + Number(aiExplanation.confidence_adjustment || 0)));
      return res.status(200).json({
        ...score,
        scores: {
          ...(score.scores || {}),
          trade_confidence_index: Number(adjustedConfidence.toFixed(2)),
        },
        ai_explanation: aiExplanation,
      });
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
        const apiKey = resolveOpenAiApiKey();
        if (!apiKey) {
          return {
            status: "error",
            message: "OpenAI is not configured for insight generation.",
            source: "openai_unavailable",
          };
        }

        const score = await buildDexScoreFallback(req.params.contract_address, req.params.chain);
        const safeScores = score.scores || {
          rug_probability: 0,
          trade_confidence_index: 0,
        };
        const safeLiquidity = Number(score.market_data?.liquidity_usd || 0);

        const prompt = [
          "You are TradeAid AI scoring assistant.",
          "Return strict JSON with keys: summary (string) and key_points (array of max 4 short strings).",
          "Do not include markdown.",
          JSON.stringify({
            symbol: score.symbol,
            eligible: score.eligible,
            scores: safeScores,
            liquidity_usd: safeLiquidity,
            risk_flags: score.risk_flags || [],
            source: score.source || {},
          }),
        ].join("\n");

        let insightSummary = "";
        let insightPoints: string[] = [];
        try {
          let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>> | null = null;
          let lastError: unknown = null;
          for (const model of resolveOpenAiModelFallbacks()) {
            try {
              completion = await getOpenAI().chat.completions.create({
                model,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
              });
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (!completion) {
            throw lastError instanceof Error ? lastError : new Error("openai_completion_failed");
          }

          const parsed = JSON.parse(String(completion.choices?.[0]?.message?.content || "{}"));
          insightSummary = String(parsed?.summary || "").trim();
          insightPoints = Array.isArray(parsed?.key_points)
            ? parsed.key_points.map((item: unknown) => String(item || "").trim()).filter(Boolean).slice(0, 4)
            : [];
        } catch (error) {
          logStructured("warn", "openai.scoring_insight_failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return {
            status: "error",
            message: "OpenAI insight generation failed.",
            source: "openai_unavailable",
          };
        }

        return {
          status: "ok",
          token: {
            contract_address: score.contract_address,
            symbol: score.symbol,
            chain: score.chain,
          },
          score: safeScores,
          insight: {
            summary: insightSummary || "OpenAI returned no summary.",
            key_points: insightPoints,
          },
          source: "openai",
        };
      },
    ),
  );

  // Get token list with AI scores
  app.get("/api/safe-buy", async (req, res) => {
    const limitRaw = Number(req.query.limit || 20);
    const requestedLimit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 20;
    const responseLimit = Math.max(5, requestedLimit);

    const toSafeRisk = (value: string) => {
      const normalized = String(value || "").toUpperCase();
      if (normalized.includes("SAFE") || normalized.includes("LOW")) return "Low" as const;
      if (normalized.includes("HIGH")) return "High" as const;
      return "Medium" as const;
    };

    const buildBuyLinks = (contractAddress: string) => ({
      pump_fun: `https://pump.fun/coin/${contractAddress}`,
      raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${contractAddress}`,
      jupiter: `https://jup.ag/swap/SOL-${contractAddress}`,
      dexscreener: `https://dexscreener.com/solana/${contractAddress}`,
    });

    const toSafeBuyItem = (token: Record<string, any>, sourceTier: "strict" | "soft" | "fallback") => {
      const contractAddress = String(token.address || token.contract_address || "").trim();
      const score = Number(token.score || token.safetyScore || 0);
      const liquidityUsd = Number(token.liquidity || token.liquidity_usd || 0);
      const volume5m = Number(token.volume_5m || 0);
      const volume1h = Number(token.volume_1h || Math.max(0, volume5m * 12));
      const holders = Number(token.holders_count || token.holder_count || 0);
      const topHoldersPct = Number(token.top_holder_pct || token.top_holders_pct || 0);
      const devWalletPct = Number(token.dev_wallet_pct || 0);
      const buyRatio = Number(token.buy_ratio_pct || 0);
      const createdAt = String(token.created_at || nowIso());
      const ageSeconds = Number(token.age_seconds || 0);

      const recommendation = score >= 65 && sourceTier !== "fallback" ? "Safe Early Entry" : "Monitor";
      const shortSummary = score >= 65
        ? "High-confidence early token with healthy liquidity profile."
        : "Promising token with improving metrics; monitor before entry.";

      return {
        id: `${sourceTier}_${contractAddress}`,
        contract_address: contractAddress,
        chain: "solana",
        name: String(token.name || token.symbol || "Unknown"),
        symbol: String(token.symbol || "UNKNOWN"),
        market_cap_usd: Number(token.market_cap_usd || token.marketCap || 0),
        liquidity_usd: liquidityUsd,
        volume_5m: volume5m,
        volume_1h: volume1h,
        holder_count: Math.max(0, Math.trunc(holders)),
        safety_score: Math.max(0, Math.min(100, score)),
        risk_level: toSafeRisk(String(token.risk_level || "MEDIUM")),
        short_summary: shortSummary,
        recommendation,
        confidence_score: Math.max(0, Math.min(100, score)),
        trend: Number(token.price_change_1h || 0) > 0.5 ? "up" : Number(token.price_change_1h || 0) < -0.5 ? "down" : "flat",
        recently_added: ageSeconds > 0 ? ageSeconds <= 2 * 60 * 60 : true,
        buy_sell_ratio: buyRatio > 0 ? Number((buyRatio / Math.max(1, 100 - buyRatio)).toFixed(2)) : 0,
        top_holders_pct: topHoldersPct,
        dev_wallet_pct: devWalletPct,
        wallet_growth_rate: Number(token.wallet_growth_rate || 0),
        source_platform: String(token.launch_source || token.source || token.dexId || "scanner"),
        logo_url: String(token.logo_url || token.logoUrl || "") || null,
        buy_links: buildBuyLinks(contractAddress),
        created_at: createdAt,
      };
    };

    const strictCandidates = (await getDoctorActiveTokens())
      .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
      .map((token) => toSafeBuyItem(token, String(token.safety_tier || "strict").toLowerCase() === "soft" ? "soft" : "strict"));

    const earlyCandidates = await getSolanaEarlyScoredTokens(120, 220);
    const usedAddresses = new Set(strictCandidates.map((item) => String(item.contract_address || "")));

    const fillerFromEarly = earlyCandidates
      .filter((token) => {
        const tokenAny = token as any;
        return !usedAddresses.has(String(tokenAny.mint || ""));
      })
      .filter((token) => {
        const tokenAny = token as any;
        return Number(tokenAny.score || 0) >= 40;
      })
      .sort((a, b) => Number((b as any).score || 0) - Number((a as any).score || 0))
      .map((token) => {
        const tokenAny = token as any;
        return (
        toSafeBuyItem(
          {
            address: tokenAny.mint,
            symbol: tokenAny.symbol,
            name: tokenAny.name,
            score: Number(tokenAny.score || 0),
            liquidity: Number(tokenAny.liquidity_usd || 0),
            volume_5m: Number(tokenAny.volume_5m || 0),
            volume_1h: Number(tokenAny.volume_24h || 0) / 24,
            market_cap_usd: Number(tokenAny.market_cap_usd || 0),
            holders_count: Number(tokenAny.holders_count || 0),
            top_holder_pct: Number(tokenAny.top_holder_pct || 0),
            dev_wallet_pct: Number(tokenAny.dev_wallet_pct || 0),
            risk_level: Number(tokenAny.score || 0) >= 65 ? "SAFE" : "MEDIUM",
            launch_source: String(tokenAny.launch_source || "scanner"),
            price_change_1h: Number(tokenAny.price_change_1h || 0),
            age_seconds: Number(tokenAny.age_seconds || 0),
            created_at: tokenAny.created_at || nowIso(),
          },
          "fallback",
        )
      );
      });

    const scannedFallback = await storage.getScannedTokens();
    const fillerFromScanned = scannedFallback
      .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
      .filter((token) => !usedAddresses.has(String(token.address || "")))
      .sort((a, b) => Number(b.safetyScore || 0) - Number(a.safetyScore || 0))
      .map((token) =>
        toSafeBuyItem(
          {
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            score: Number(token.safetyScore || 0),
            liquidity: Number(token.liquidity || 0),
            volume_5m: Number(token.volume24h || 0) / 288,
            volume_1h: Number(token.volume24h || 0) / 24,
            market_cap_usd: Number(token.marketCap || 0),
            holders_count: 0,
            top_holder_pct: Number(token.topHoldersPercentage || 0),
            dev_wallet_pct: Number(token.devWalletPercentage || 0),
            risk_level: String(token.riskLevel || "MEDIUM"),
            launch_source: String(token.dexId || "scanner"),
            price_change_1h: Number(token.priceChange1h || 0),
            age_seconds: 0,
            created_at: nowIso(),
          },
          "fallback",
        ),
      );

    const safeByAddress = new Map<string, any>();
    for (const item of [...strictCandidates, ...fillerFromEarly, ...fillerFromScanned]) {
      const key = String(item.contract_address || "").trim();
      if (!key || safeByAddress.has(key)) continue;
      safeByAddress.set(key, item);
    }
    const allSafeTokens = Array.from(safeByAddress.values());
    const safeTokens = allSafeTokens.slice(0, responseLimit);

    const nearMissByAddress = new Map<string, any>();
    for (const token of earlyCandidates
      .filter((row) => {
        const rowAny = row as any;
        return Number(rowAny.score || 0) >= 40 && Number(rowAny.score || 0) < 50;
      })
      .sort((a, b) => Number((b as any).score || 0) - Number((a as any).score || 0))) {
      const tokenAny = token as any;
      const address = String(tokenAny.mint || "").trim();
      if (!address || safeByAddress.has(address) || nearMissByAddress.has(address)) continue;
      nearMissByAddress.set(
        address,
        toSafeBuyItem(
          {
            address,
            symbol: tokenAny.symbol,
            name: tokenAny.name,
            score: Number(tokenAny.score || 0),
            liquidity: Number(tokenAny.liquidity_usd || 0),
            volume_5m: Number(tokenAny.volume_5m || 0),
            volume_1h: Number(tokenAny.volume_24h || 0) / 24,
            market_cap_usd: Number(tokenAny.market_cap_usd || 0),
            holders_count: Number(tokenAny.holders_count || 0),
            top_holder_pct: Number(tokenAny.top_holder_pct || 0),
            dev_wallet_pct: Number(tokenAny.dev_wallet_pct || 0),
            risk_level: "MEDIUM",
            launch_source: String(tokenAny.launch_source || "scanner"),
            price_change_1h: Number(tokenAny.price_change_1h || 0),
            age_seconds: Number(tokenAny.age_seconds || 0),
            created_at: tokenAny.created_at || nowIso(),
          },
          "fallback",
        ),
      );
    }
    const allNearMissTokens = Array.from(nearMissByAddress.values());
    const nearMissTokens = allNearMissTokens.slice(0, responseLimit);

    return res.json({
      tokens: safeTokens,
      count: safeTokens.length,
      total_count: allSafeTokens.length,
      near_miss_tokens: nearMissTokens,
      near_miss_count: nearMissTokens.length,
      near_miss_total_count: allNearMissTokens.length,
      refreshed_at: nowIso(),
    });
  });

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
        const fresh = await getMergedFreshPumpfunTokens(10);
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
            holdersCount: Number(raw.holdersCount || raw.holder_count || 0),
            mintAuthorityDisabled:
              typeof raw.mintAuthorityDisabled === "boolean"
                ? Boolean(raw.mintAuthorityDisabled)
                : (typeof raw.mintAuthorityActive === "boolean" ? !Boolean(raw.mintAuthorityActive) : undefined),
            topHoldersPercentage: Number(raw.topHoldersPercentage || raw.top_holder_pct || 0),
            devWalletPercentage: Number(raw.devWalletPercentage || raw.dev_wallet_pct || 0),
            logoUrl: logoUrl || null,
            socialLinks: social,
            aiAnalysis: null,
            createdAt,
          };
        });
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
                holdersCount: Number((pair as any)?.info?.holdersCount || 0),
                mintAuthorityDisabled: undefined,
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
        const newerFirst = nextCreated >= prevCreated
          ? { ...previous, ...(token as any) }
          : { ...(token as any), ...previous };

        const merged = {
          ...newerFirst,
          liquidity: Math.max(Number(previous?.liquidity || 0), Number((token as any)?.liquidity || 0)),
          marketCap: Math.max(Number(previous?.marketCap || 0), Number((token as any)?.marketCap || 0)),
          volume24h: Math.max(Number(previous?.volume24h || 0), Number((token as any)?.volume24h || 0)),
          buys24h: Math.max(Number(previous?.buys24h || 0), Number((token as any)?.buys24h || 0)),
          sells24h: Math.max(Number(previous?.sells24h || 0), Number((token as any)?.sells24h || 0)),
          holdersCount: Math.max(Number(previous?.holdersCount || 0), Number((token as any)?.holdersCount || 0)),
          topHoldersPercentage: Math.max(Number(previous?.topHoldersPercentage || 0), Number((token as any)?.topHoldersPercentage || 0)),
          devWalletPercentage: Math.max(Number(previous?.devWalletPercentage || 0), Number((token as any)?.devWalletPercentage || 0)),
          mintAuthorityDisabled:
            typeof previous?.mintAuthorityDisabled === "boolean"
              ? previous.mintAuthorityDisabled
              : (typeof (token as any)?.mintAuthorityDisabled === "boolean" ? (token as any).mintAuthorityDisabled : undefined),
        };

        mergedByAddress.set(key, merged);
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
            holder_count: Math.max(0, Math.trunc(Number(token.holdersCount || 0))),
            is_mintable: Boolean((token as any).mintAuthorityActive === true),
            is_ownership_renounced: Boolean(token.mintAuthorityDisabled === true),
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
  
  // Start background token scanner (fresh pair detection)
  const scannerIntervalMs = Math.max(10_000, Number(process.env.BACKGROUND_SCANNER_INTERVAL_MS || 20_000));
  startBackgroundScanner(scannerIntervalMs);

  // Start periodic multichain launchpad scans
  try {
    const multichainIntervalMs = Math.max(20_000, Number(process.env.MULTICHAIN_SCAN_INTERVAL_MS || 60_000));
    setInterval(() => {
      multichainScanner.scanAllLaunchpads().catch(console.error);
    }, multichainIntervalMs);
    // run once on startup
    multichainScanner.scanAllLaunchpads().catch(console.error);
  } catch (e) {
    console.error("Failed to start multichain scanner:", e);
  }

  // Start Apify workflow scheduler (default 5 minutes, configurable)
  try {
    const apifyIntervalMs = Math.max(60_000, Number(process.env.APIFY_WORKFLOW_INTERVAL_MS || 5 * 60 * 1000));
    startApifyWorkflowScheduler(apifyIntervalMs);
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

      let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>> | null = null;
      let lastError: unknown = null;
      for (const model of resolveOpenAiModelFallbacks()) {
        try {
          completion = await getOpenAI().chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!completion) {
        throw lastError instanceof Error ? lastError : new Error("openai_completion_failed");
      }

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
  try {
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
  } catch (error) {
    console.warn("Skipping tracked wallet seed due to schema availability:", error instanceof Error ? error.message : error);
  }

  try {
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
  } catch (error) {
    console.warn("Skipping trending coin seed due to schema availability:", error instanceof Error ? error.message : error);
  }
}
