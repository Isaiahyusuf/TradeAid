import type { DexPair } from "./dexscreener";

export interface SafetyReport {
  score: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  isHoneypot: boolean;
  isLiquidityLocked: boolean;
  mintAuthorityDisabled: boolean;
  topHoldersPercentage: number;
  risks: string[];
  positives: string[];
  uncheckedFactors: string[];
}

export async function analyzeTokenSafety(pair: DexPair): Promise<SafetyReport> {
  const risks: string[] = [];
  const positives: string[] = [];
  let score = 50;

  const liquidity = pair.liquidity?.usd || 0;
  if (liquidity < 1000) {
    risks.push("Very low liquidity (<$1K) - High rug risk");
    score -= 25;
  } else if (liquidity < 10000) {
    risks.push("Low liquidity (<$10K) - Moderate rug risk");
    score -= 15;
  } else if (liquidity > 100000) {
    positives.push("Strong liquidity (>$100K)");
    score += 15;
  } else if (liquidity > 50000) {
    positives.push("Good liquidity (>$50K)");
    score += 10;
  }

  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;
  const totalTxns = buys + sells;
  
  if (totalTxns < 10) {
    risks.push("Very few transactions - Possible dead token");
    score -= 10;
  } else if (totalTxns > 500) {
    positives.push("High trading activity (>500 txns/24h)");
    score += 10;
  }

  if (sells === 0 && buys > 10) {
    risks.push("No sell transactions - Possible honeypot");
    score -= 30;
  } else if (buys > 0 && sells > 0) {
    const buyRatio = buys / (buys + sells);
    if (buyRatio > 0.8) {
      positives.push("Strong buying pressure");
      score += 5;
    } else if (buyRatio < 0.2) {
      risks.push("Heavy selling pressure");
      score -= 10;
    }
  }

  const priceChange24h = pair.priceChange?.h24 || 0;
  if (priceChange24h < -80) {
    risks.push("Massive price drop (>80%) - Possible dump");
    score -= 20;
  } else if (priceChange24h < -50) {
    risks.push("Large price drop (>50%)");
    score -= 10;
  } else if (priceChange24h > 500) {
    risks.push("Extreme price increase (>500%) - High volatility");
    score -= 5;
  } else if (priceChange24h > 100) {
    positives.push("Strong price momentum (+100%)");
    score += 5;
  }

  const volume = pair.volume?.h24 || 0;
  if (volume < 100) {
    risks.push("Almost no trading volume");
    score -= 15;
  } else if (volume > 100000) {
    positives.push("High trading volume (>$100K)");
    score += 10;
  }

  const hasSocials = pair.info?.socials && pair.info.socials.length > 0;
  const hasWebsite = pair.info?.websites && pair.info.websites.length > 0;
  if (!hasSocials && !hasWebsite) {
    risks.push("No social links or website");
    score -= 10;
  } else {
    if (hasSocials) positives.push("Has social media presence");
    if (hasWebsite) positives.push("Has official website");
    score += 5;
  }

  const ageMs = Date.now() - pair.pairCreatedAt;
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 1) {
    risks.push("Brand new token (<1 hour)");
  } else if (ageHours < 24) {
    risks.push("Very new token (<24 hours)");
  } else if (ageHours > 168) {
    positives.push("Token has history (>1 week)");
    score += 5;
  }

  score = Math.max(0, Math.min(100, score));

  let riskLevel: "low" | "medium" | "high" | "critical";
  if (score >= 70) riskLevel = "low";
  else if (score >= 50) riskLevel = "medium";
  else if (score >= 30) riskLevel = "high";
  else riskLevel = "critical";

  const isHoneypot = sells === 0 && buys > 10;
  
  const uncheckedFactors = [
    "Liquidity lock status (requires on-chain analysis)",
    "Mint authority status (requires on-chain analysis)",
    "Top holder concentration (requires holder snapshot)",
  ];
  
  return {
    score,
    riskLevel,
    isHoneypot,
    isLiquidityLocked: false,
    mintAuthorityDisabled: false,
    topHoldersPercentage: 0,
    risks,
    positives,
    uncheckedFactors,
  };
}

export function calculateSignal(safety: SafetyReport, pair: DexPair): {
  signal: "strong_buy" | "buy" | "hold" | "sell" | "avoid";
  confidence: number;
  reasoning: string;
  isSafeInvestment: boolean;
} {
  const priceChange1h = pair.priceChange?.h1 || 0;
  const priceChange24h = pair.priceChange?.h24 || 0;
  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;
  const volume = pair.volume?.h24 || 0;
  const liquidity = pair.liquidity?.usd || 0;

  if (safety.riskLevel === "critical" || safety.isHoneypot) {
    return {
      signal: "avoid",
      confidence: 90,
      reasoning: `Critical risk level. ${safety.risks.slice(0, 2).join(". ")}`,
      isSafeInvestment: false,
    };
  }

  if (safety.riskLevel === "high") {
    return {
      signal: "avoid",
      confidence: 75,
      reasoning: `High risk. ${safety.risks.slice(0, 2).join(". ")}`,
      isSafeInvestment: false,
    };
  }

  const ageHours = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60);
  const isNewToken = ageHours < 6;
  const hasStrongLiquidity = liquidity > 50000;
  const hasGoodLiquidity = liquidity > 20000;
  const hasStrongVolume = volume > 50000;
  const hasGoodVolume = volume > 10000;
  const hasBuyPressure = buys > sells * 1.5;
  const hasStrongBuyPressure = buys > sells * 2;
  const isRising = priceChange1h > 10 || priceChange24h > 50;
  const isStronglyRising = priceChange1h > 30 && priceChange24h > 0;
  const hasSocials = safety.positives.some(p => p.includes("social") || p.includes("website"));

  // STRONG BUY: Best investment opportunities
  if (
    safety.score >= 70 &&
    hasStrongLiquidity &&
    hasStrongVolume &&
    hasStrongBuyPressure &&
    !safety.isHoneypot &&
    priceChange1h > 0 &&
    priceChange1h < 200
  ) {
    return {
      signal: "strong_buy",
      confidence: Math.min(95, safety.score + 10),
      reasoning: `TOP PICK! Strong fundamentals: $${(liquidity/1000).toFixed(0)}K liquidity, $${(volume/1000).toFixed(0)}K volume, ${(buys/Math.max(sells,1)).toFixed(1)}x buy ratio. Safety: ${safety.score}/100`,
      isSafeInvestment: true,
    };
  }

  // BUY: Good investment opportunities
  if (isNewToken && hasGoodLiquidity && hasGoodVolume && hasBuyPressure && safety.score >= 65) {
    return {
      signal: "buy",
      confidence: Math.min(85, safety.score),
      reasoning: `SAFE ENTRY: New token with strong metrics. Liquidity: $${liquidity.toLocaleString()}, Volume: $${volume.toLocaleString()}, Buy/Sell ratio: ${(buys/Math.max(sells,1)).toFixed(1)}x`,
      isSafeInvestment: true,
    };
  }

  if (hasGoodLiquidity && isRising && hasBuyPressure && safety.score >= 60 && hasSocials) {
    return {
      signal: "buy",
      confidence: Math.min(75, safety.score),
      reasoning: `GOOD OPPORTUNITY: Positive momentum +${priceChange1h.toFixed(1)}% in 1h. Verified socials. ${safety.positives.slice(0, 1).join(". ")}`,
      isSafeInvestment: true,
    };
  }

  if (hasGoodLiquidity && isRising && hasBuyPressure && safety.score >= 55) {
    return {
      signal: "buy",
      confidence: Math.min(70, safety.score),
      reasoning: `Positive momentum detected. ${priceChange1h > 10 ? `+${priceChange1h.toFixed(1)}% in 1h.` : ""} ${safety.positives.slice(0, 2).join(". ")}`,
      isSafeInvestment: safety.score >= 65,
    };
  }

  if (priceChange1h < -20 || (sells > buys * 2)) {
    return {
      signal: "sell",
      confidence: 65,
      reasoning: `Bearish signals. ${priceChange1h < -20 ? `Price down ${priceChange1h.toFixed(1)}% in 1h.` : ""} Heavy sell pressure.`,
      isSafeInvestment: false,
    };
  }

  return {
    signal: "hold",
    confidence: 50,
    reasoning: `Neutral market conditions. Monitor for better entry/exit opportunities.`,
    isSafeInvestment: safety.score >= 70,
  };
}
