export type TokenRiskLevel = "SAFE" | "MEDIUM" | "HIGH RISK";

export interface TokenScoreInput {
  liquidityUsd: number;
  holdersCount: number;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
}

export interface TokenScoreResult {
  score: number;
  riskLevel: TokenRiskLevel;
  reasons: string[];
}

const LIQUIDITY_THRESHOLD = Number(process.env.FRESH_SCORE_LIQUIDITY_THRESHOLD || 10000);
const HOLDERS_THRESHOLD = Number(process.env.FRESH_SCORE_HOLDERS_THRESHOLD || 200);

export function scoreFreshToken(input: TokenScoreInput): TokenScoreResult {
  const reasons: string[] = [];
  let score = 50;

  if (input.liquidityUsd > LIQUIDITY_THRESHOLD) {
    score += 20;
    reasons.push(`liquidity_above_threshold:${LIQUIDITY_THRESHOLD}`);
  } else {
    reasons.push(`liquidity_below_threshold:${LIQUIDITY_THRESHOLD}`);
  }

  if (input.holdersCount > HOLDERS_THRESHOLD) {
    score += 20;
    reasons.push(`holders_above_threshold:${HOLDERS_THRESHOLD}`);
  } else {
    reasons.push(`holders_below_threshold:${HOLDERS_THRESHOLD}`);
  }

  if (input.mintAuthorityActive) {
    score -= 25;
    reasons.push("mint_authority_active");
  }

  if (input.freezeAuthorityActive) {
    score -= 20;
    reasons.push("freeze_authority_active");
  }

  score = Math.max(0, Math.min(100, score));

  const riskLevel: TokenRiskLevel =
    score >= 70 ? "SAFE" :
    score >= 45 ? "MEDIUM" :
    "HIGH RISK";

  return {
    score,
    riskLevel,
    reasons,
  };
}
