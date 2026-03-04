import { logStructured } from "./structured-logger";

const AUTO_TRADE_ENABLED = String(process.env.AUTO_TRADE_ENABLED || "false").toLowerCase() === "true";
const AUTO_TRADE_SCORE_THRESHOLD = Number(process.env.AUTO_TRADE_SCORE_THRESHOLD || 80);

export function getAutoTradeConfig() {
  return {
    enabled: AUTO_TRADE_ENABLED,
    scoreThreshold: AUTO_TRADE_SCORE_THRESHOLD,
  };
}

export async function maybeTriggerAutoTrade(params: {
  mintAddress: string;
  symbol: string;
  score: number;
}) {
  const config = getAutoTradeConfig();
  if (!config.enabled) {
    return {
      triggered: false,
      reason: "AUTO_TRADE_DISABLED",
    };
  }

  if (params.score <= config.scoreThreshold) {
    return {
      triggered: false,
      reason: "SCORE_BELOW_THRESHOLD",
      threshold: config.scoreThreshold,
    };
  }

  logStructured("info", "autotrade.triggered", {
    mintAddress: params.mintAddress,
    symbol: params.symbol,
    score: params.score,
    threshold: config.scoreThreshold,
  });

  return {
    triggered: true,
    reason: "TRADE_ATTEMPT_LOGGED",
    threshold: config.scoreThreshold,
  };
}
