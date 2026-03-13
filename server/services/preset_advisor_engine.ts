type AnyRow = Record<string, any>;

export type AdvisorMarketState =
  | "HIGH_FOMO"
  | "MODERATE_MOMENTUM"
  | "LOW_VOLUME"
  | "RUG_HEAVY"
  | "SIDEWAYS_MARKET";

export type AdvisorTopGainer = {
  symbol: string;
  address: string;
  price_change_5m: number;
  volume_5m: number;
  liquidity: number;
};

export type AdvisorMetrics = {
  avg_market_cap_new_tokens: number;
  avg_liquidity: number;
  avg_volume_5m: number;
  avg_price_change_5m: number;
  launch_frequency: number;
  buy_sell_ratio: number;
  rug_rate_last_hour: number;
  top_gainers: AdvisorTopGainer[];
};

export type AdvisorResult = {
  market_state: AdvisorMarketState;
  recommended_preset: string;
  confidence_score: number;
  reason: string;
  metrics: AdvisorMetrics;
  updated_at: string;
};

const nowIso = () => new Date().toISOString();

const safeNum = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const avg = (values: number[]) => {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
};

const round2 = (value: number) => Number(value.toFixed(2));

export const buildPresetAdvisorResult = (params: {
  activeTokens: AnyRow[];
  recentTrades?: AnyRow[];
  sniperLogs?: AnyRow[];
  lookbackMinutes?: number;
}): AdvisorResult => {
  const activeTokens = Array.isArray(params.activeTokens) ? params.activeTokens : [];
  const recentTrades = Array.isArray(params.recentTrades) ? params.recentTrades : [];
  const sniperLogs = Array.isArray(params.sniperLogs) ? params.sniperLogs : [];
  const lookbackMinutes = Math.max(15, Math.trunc(safeNum(params.lookbackMinutes, 60)));
  const nowMs = Date.now();
  const lookbackMs = lookbackMinutes * 60 * 1000;
  const oneHourAgoMs = nowMs - 60 * 60 * 1000;

  const solanaTokens = activeTokens
    .filter((token) => String(token.chain || "solana").toLowerCase() === "solana")
    .map((token) => ({
      symbol: String(token.symbol || "UNKNOWN"),
      address: String(token.address || ""),
      marketCap: safeNum(token.market_cap_usd),
      liquidity: safeNum(token.liquidity),
      volume5m: safeNum(token.volume_5m),
      priceChange5m: safeNum((token as AnyRow).price_change_5m),
      buys5m: safeNum((token as AnyRow).buys_5m),
      sells5m: safeNum((token as AnyRow).sells_5m),
      createdAtMs: (() => {
        const createdAt = String((token as AnyRow).created_at || "");
        const ts = new Date(createdAt).getTime();
        return Number.isFinite(ts) ? ts : 0;
      })(),
      launchSource: String((token as AnyRow).launch_source || (token as AnyRow).source || "unknown").toLowerCase(),
      isHoneypot: Boolean((token as AnyRow).is_honeypot ?? (token as AnyRow).isHoneypot ?? false),
      topHolderPct: safeNum((token as AnyRow).top_holder_pct),
      creatorHoldingPct: safeNum((token as AnyRow).creator_wallet_holding ?? (token as AnyRow).dev_wallet_pct),
      mintAuthorityDisabled: Boolean((token as AnyRow).mint_authority_disabled ?? (token as AnyRow).mintAuthorityDisabled ?? false),
      freezeAuthorityDisabled: Boolean((token as AnyRow).freeze_authority_disabled ?? (token as AnyRow).freezeAuthorityDisabled ?? false),
    }));

  const recentWindowTokens = solanaTokens.filter((token) => {
    if (!token.createdAtMs) return true;
    return nowMs - token.createdAtMs <= lookbackMs;
  });

  const sample = recentWindowTokens.length ? recentWindowTokens : solanaTokens;

  const totalBuys5m = sample.reduce((sum, token) => sum + Math.max(0, token.buys5m), 0);
  const totalSells5m = sample.reduce((sum, token) => sum + Math.max(0, token.sells5m), 0);
  const buySellRatio = totalSells5m > 0 ? totalBuys5m / totalSells5m : (totalBuys5m > 0 ? 3 : 1);

  const launchesInLastHour = solanaTokens.filter((token) => token.createdAtMs > 0 && token.createdAtMs >= oneHourAgoMs);
  const launchFrequency = launchesInLastHour.length;

  const rugSignalsFromLogs = sniperLogs
    .filter((row) => {
      const ts = new Date(String((row as AnyRow).at || (row as AnyRow).timestamp || "")).getTime();
      return Number.isFinite(ts) && ts >= oneHourAgoMs;
    })
    .filter((row) => {
      const reason = String((row as AnyRow).reason || "").toLowerCase();
      const event = String((row as AnyRow).event || "").toLowerCase();
      if (event !== "guard_blocked" && event !== "candidate_rejected") return false;
      return reason.includes("honeypot")
        || reason.includes("rug")
        || reason.includes("mint_authority")
        || reason.includes("freeze_authority")
        || reason.includes("top_holder")
        || reason.includes("creator_wallet")
        || reason.includes("tax")
        || reason.includes("liquidity");
    }).length;

  const rugSignalsFromTokens = launchesInLastHour.filter((token) => {
    return token.isHoneypot
      || !token.mintAuthorityDisabled
      || !token.freezeAuthorityDisabled
      || token.topHolderPct > 30
      || token.creatorHoldingPct > 12;
  }).length;

  const rugDenominator = Math.max(1, launchesInLastHour.length || sample.length || 1);
  const rugRateLastHour = ((rugSignalsFromLogs + rugSignalsFromTokens) / rugDenominator) * 100;

  const metrics: AdvisorMetrics = {
    avg_market_cap_new_tokens: round2(avg(sample.map((token) => token.marketCap))),
    avg_liquidity: round2(avg(sample.map((token) => token.liquidity))),
    avg_volume_5m: round2(avg(sample.map((token) => token.volume5m))),
    avg_price_change_5m: round2(avg(sample.map((token) => token.priceChange5m))),
    launch_frequency: launchFrequency,
    buy_sell_ratio: round2(buySellRatio),
    rug_rate_last_hour: round2(rugRateLastHour),
    top_gainers: sample
      .slice()
      .sort((a, b) => b.priceChange5m - a.priceChange5m)
      .slice(0, 5)
      .map((token) => ({
        symbol: token.symbol,
        address: token.address,
        price_change_5m: round2(token.priceChange5m),
        volume_5m: round2(token.volume5m),
        liquidity: round2(token.liquidity),
      })),
  };

  let marketState: AdvisorMarketState = "SIDEWAYS_MARKET";
  let recommendedPreset = "Momentum Hunter";
  let confidence = 64;
  let reason = "Market is mixed without strong directional pressure, so a balanced strategy is preferred.";

  if (metrics.rug_rate_last_hour > 40) {
    marketState = "RUG_HEAVY";
    recommendedPreset = "Safe Buy";
    confidence = 91;
    reason = "Rug and safety-failure signals are elevated in the last hour. Defensive preset is recommended until quality improves.";
  } else if (
    metrics.avg_volume_5m > 20000
    && metrics.buy_sell_ratio > 1.8
    && metrics.launch_frequency >= 18
    && metrics.avg_price_change_5m > 15
  ) {
    marketState = "HIGH_FOMO";
    recommendedPreset = "In & Out 2x ⚡";
    confidence = 88;
    reason = "Fast launches with strong buy pressure and high short-window volume suggest a high-FOMO environment suited for rapid entries and exits.";
  } else if (
    metrics.avg_volume_5m > 10000
    && metrics.buy_sell_ratio > 1.2
    && metrics.avg_market_cap_new_tokens >= 20000
    && metrics.avg_market_cap_new_tokens <= 400000
    && metrics.avg_price_change_5m >= 8
  ) {
    marketState = "MODERATE_MOMENTUM";
    recommendedPreset = "Momentum Trader 📈";
    confidence = 82;
    reason = "Volume and buy-side pressure are healthy with moderate market caps, which supports quality momentum entries targeting sustained moves.";
  } else if (
    metrics.avg_volume_5m < 6000
    || metrics.launch_frequency < 6
    || metrics.buy_sell_ratio < 0.9
  ) {
    marketState = "LOW_VOLUME";
    recommendedPreset = "Safe Buy";
    confidence = 79;
    reason = "Thin volume and weaker participation increase slippage and trap risk. Defensive selection is safer until liquidity improves.";
  }

  return {
    market_state: marketState,
    recommended_preset: recommendedPreset,
    confidence_score: Math.max(50, Math.min(95, Math.trunc(confidence))),
    reason,
    metrics,
    updated_at: nowIso(),
  };
};
