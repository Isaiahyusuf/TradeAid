import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { normalizeChain } from "./utils/chain";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import { setupAuth, registerAuthRoutes, isAuthenticated, authStorage } from "./replit_integrations/auth";
import { registerScannerRoutes } from "./routes/scanner";
import { startBackgroundScanner, scanHotTokens } from "./services/token-scanner";
import { multichainScanner } from "./services/multichain-scanner";
import { getTokenPairs } from "./services/dexscreener";
import { FREE_TIER_LIMITS, SUBSCRIPTION_PRICE_USD, SUPPORTED_PAYMENT_CHAINS } from "@shared/schema";
import { cryptoPaymentService } from "./services/crypto-payment";
import { fetchFreshPumpfunTokens } from "./services/fresh-token-service";
import { enrichTokenWithHelius } from "./services/helius-enrichment-service";
import { scoreFreshToken } from "./services/token-scoring-engine";
import { getAutoTradeConfig, maybeTriggerAutoTrade } from "./services/auto-trade-hook";
import { logStructured } from "./services/structured-logger";
import OpenAI from "openai";

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
  // Setup auth FIRST (required before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // Register AI integration routes
  registerChatRoutes(app);
  registerImageRoutes(app);
  
  // Register token scanner routes (new powerful scanner)
  registerScannerRoutes(app);

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
    const pairs = await getTokenPairs(contractAddress);
    const filtered = pairs.filter((pair) => {
      const pairChain = normalizeDexChain(String(pair.chainId || ""));
      return requestedChain === "all" ? true : pairChain === requestedChain;
    });
    const ranked = (filtered.length ? filtered : pairs).sort(
      (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0),
    );
    const pair = ranked[0];
    if (!pair) {
      return { error: "Token not found", eligible: false };
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
    const pairs = await getTokenPairs(contractAddress);
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
    if (!pythonApiBase) {
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

      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method === "GET" ? undefined : JSON.stringify(req.body || {}),
      });

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
      min_buy_amount_sol: 0.1,
      buy_amount_sol: 0.1,
      take_profit_multiplier: 2,
      min_profit_pct: 12,
      stop_loss_pct: 6,
      trailing_stop_pct: 10,
      min_liquidity_usd: 20000,
      max_slippage_pct: 4,
      max_spread_pct: 3,
      daily_loss_limit_usd: 600,
      max_consecutive_losses: 3,
      strong_move_threshold_pct: 40,
      max_hold_minutes: 180,
      min_momentum_profit_pct: 4,
      quality_min_volume_spike_pct: 12,
      quality_max_top_holder_pct: 35,
    },
    recentTrades: [] as Array<Record<string, any>>,
    decisionJournal: [] as Array<Record<string, any>>,
    performance: [] as Array<Record<string, any>>,
    lastRunAt: null as string | null,
    lastError: null as string | null,
  };

  const buildDoctorStatus = async () => {
    const tokens = await storage.getScannedTokens();
    const activeTokens = tokens
      .map((token) => {
        const liquidity = Number(token.liquidity || 0);
        const volume24h = Number(token.volume24h || 0);
        const volume5m = Number((volume24h / 288).toFixed(2));
        const score = Number(token.safetyScore || 0);
        return {
          symbol: String(token.symbol || "UNKNOWN"),
          address: String(token.address || ""),
          liquidity,
          volume_5m: volume5m,
          score,
          price_usd: Number(token.priceUsd || 0),
          chain: String(token.chain || "solana"),
          created_at: token.createdAt ? new Date(token.createdAt).toISOString() : null,
        };
      })
      .filter((token) => token.liquidity >= Number(doctorRuntime.controls.min_liquidity_usd || 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

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
        daily_realized_pnl_usd: 0,
        high_watermark_usd: 0,
        open_positions: 0,
        open_exposure_pct: 0,
        consecutive_losses: 0,
        paused,
        permanent_lock: false,
        pause_reason: paused ? "kill_switch_enabled" : null,
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
      active_tokens: activeTokens,
      positions: [],
      recent_trades: doctorRuntime.recentTrades.slice(0, 40),
      decision_journal: doctorRuntime.decisionJournal.slice(0, 60),
      performance: doctorRuntime.performance.slice(0, 30),
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
        detected: tokens.length,
        enriched: tokens.length,
        approved: activeTokens.length,
        rejected: Math.max(0, tokens.length - activeTokens.length),
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
    return res.json(await buildDoctorStatus());
  });

  app.post("/api/doctor/config", async (req, res) => {
    const payload = req.body || {};
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
      "stop_loss_pct",
      "trailing_stop_pct",
      "min_liquidity_usd",
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
    return res.json(await buildDoctorStatus());
  });

  app.post("/api/doctor/run-once", async (_req, res) => {
    const status = await buildDoctorStatus();
    doctorRuntime.lastRunAt = new Date().toISOString();

    if (!doctorRuntime.enabled) {
      return res.json({ result: { executed: false, reason: "doctortrade_disabled" } });
    }
    if (doctorRuntime.killSwitch) {
      return res.json({ result: { executed: false, reason: "kill_switch_enabled" } });
    }
    if (!doctorRuntime.wallet.address) {
      return res.json({ result: { executed: false, reason: "wallet_not_connected" } });
    }

    const minScore = Math.max(1, Number(doctorRuntime.controls.strong_move_threshold_pct || 40));
    const candidate = (status.active_tokens || []).find((token: any) => Number(token.score || 0) >= minScore);
    if (!candidate) {
      return res.json({ result: { executed: false, reason: "no_eligible_token" } });
    }

    const buyAmount = Number(doctorRuntime.controls.buy_amount_sol || 0.1);
    const signature = `paper_${Date.now()}_${String(candidate.symbol || "token").toLowerCase()}`;
    const now = new Date().toISOString();

    doctorRuntime.controls.trades_today = Number(doctorRuntime.controls.trades_today || 0) + 1;
    doctorRuntime.recentTrades.unshift({
      token: candidate.symbol,
      address: candidate.address,
      action: "BUY",
      status: "EXECUTED",
      reason: "strong_move_signal",
      confidence: candidate.score,
      liquidity: candidate.liquidity,
      volume_5m: candidate.volume_5m,
      size_pct: 100,
      notional_usd: Number((buyAmount * 160).toFixed(2)),
      timestamp: now,
    });
    doctorRuntime.decisionJournal.unshift({
      token: candidate.symbol,
      address: candidate.address,
      decision: "buy",
      reason: "strong_move_signal",
      confidence: candidate.score,
      size_pct: 100,
      strategy_mode: "balanced",
      timestamp: now,
    });
    doctorRuntime.performance.unshift({
      cycle: doctorRuntime.performance.length + 1,
      latest_win_rate: 0.65,
      weighted_trade_mass: Number((buyAmount * 100).toFixed(2)),
      pnl_per_trade_usd: 0,
      updated_at: now,
    });

    doctorRuntime.recentTrades = doctorRuntime.recentTrades.slice(0, 50);
    doctorRuntime.decisionJournal = doctorRuntime.decisionJournal.slice(0, 80);
    doctorRuntime.performance = doctorRuntime.performance.slice(0, 40);

    return res.json({
      result: {
        executed: true,
        signature,
        buy_amount_sol: buyAmount,
      },
    });
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

    return res.json({
      result: {
        executed: true,
        signature,
        buy_amount_sol: buyAmount,
      },
    });
  });

  app.post("/api/scoring/score-token", async (req, res) =>
    proxyToPythonApi(req, res, "/api/scoring/score-token", async () => {
      const body = req.body || {};
      const contractAddress = String(body.contract_address || body.address || "").trim();
      const chain = String(body.chain || "all").trim().toLowerCase();
      if (!contractAddress) {
        return { error: "Contract address required", eligible: false };
      }
      return buildDexScoreFallback(contractAddress, chain);
    }),
  );

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

  app.get("/api/tokens", isAuthenticated, async (req, res) => {
    const buildLocalTokenPayload = async () => {
      const all = await storage.getScannedTokens();
      const now = Date.now();

      const chainParam = String(req.query.chain || "all").toLowerCase();
      const newOnly = String(req.query.new_only || "false").toLowerCase() === "true";
      const maxAgeHours = Number(req.query.max_age_hours || 0);
      const minAgeMinutes = Number(req.query.min_age_minutes || 0);
      const maxAgeMinutes = Number(req.query.max_age_minutes || 0);
      const limitRaw = Number(req.query.limit || 50);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;

      const baseRows = all.length
        ? all
        : (await (async () => {
            try {
              const fresh = await fetchFreshPumpfunTokens(40);
              return fresh.map((token, index) => {
                const raw = (token.raw || {}) as Record<string, unknown>;
                const sourcePlatform = String(raw.sourcePlatform || raw.source_platform || raw.platform || token.eventType || "pumpfun");
                const priceUsd = Number(raw.priceUsd || raw.price_usd || raw.usdPrice || 0);
                const marketCapUsd = Number(raw.marketCapUsd || raw.market_cap_usd || raw.marketCap || 0);
                const createdAtRaw = String(raw.discoveredAt || raw.created_at || raw.createdAt || raw.timestamp || "").trim();
                const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date();
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
                  volume24h: 0,
                  priceChange1h: 0,
                  priceChange24h: 0,
                  buys24h: 0,
                  sells24h: 0,
                  safetyScore: Number(scoreFreshToken({
                    liquidityUsd: Number(token.liquidityUsd || 0),
                    holdersCount: 0,
                    mintAuthorityActive: true,
                    freezeAuthorityActive: true,
                  }).score || 0),
                  mintAuthorityDisabled: false,
                  topHoldersPercentage: 0,
                  devWalletPercentage: 0,
                  socialLinks: social,
                  aiAnalysis: null,
                  createdAt,
                };
              });
            } catch {
              return [];
            }
          })());

      const filtered = baseRows.filter((token) => {
        const tokenChain = String(token.chain || "solana").toLowerCase();
        if (chainParam !== "all" && tokenChain !== chainParam) return false;

        const createdAtTs = token.createdAt ? new Date(token.createdAt).getTime() : now;
        const ageMinutes = Math.max(0, (now - createdAtTs) / 60000);
        if (newOnly && ageMinutes > 24 * 60) return false;
        if (Number.isFinite(maxAgeHours) && maxAgeHours > 0 && ageMinutes > maxAgeHours * 60) return false;
        if (Number.isFinite(minAgeMinutes) && minAgeMinutes > 0 && ageMinutes < minAgeMinutes) return false;
        if (Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 && ageMinutes > maxAgeMinutes) return false;

        return true;
      });

      const tokens = filtered
        .sort((a, b) => {
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

      return { tokens, count: tokens.length, total: tokens.length };
    };

    if (!pythonApiBase) {
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

      return res.json(await buildLocalTokenPayload());
    } catch {
      return res.json(await buildLocalTokenPayload());
    }
  });

  app.get("/api/tokens/project-info/:chain/:contract_address", async (req, res) => {
    const { chain, contract_address } = req.params;
    return proxyToPythonApi(
      req,
      res,
      `/api/tokens/project-info/${encodeURIComponent(chain)}/${encodeURIComponent(contract_address)}`,
      async () => buildDexProjectInfoFallback(contract_address, chain),
    );
  });
  
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
