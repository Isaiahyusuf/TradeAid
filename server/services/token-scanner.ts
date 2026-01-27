import { db } from "../db";
import { scannedTokens, tokenSignals, userAlerts } from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { discoverHotTokens, getTokenPairs, pairToTokenData, type DexPair } from "./dexscreener";
import { analyzeTokenSafety, calculateSignal } from "./safety-analyzer";
import { analyzeTokenWithAI, generateQuickInsight } from "./ai-analyzer";

export interface ScanResult {
  token: typeof scannedTokens.$inferSelect;
  isNew: boolean;
  signal: typeof tokenSignals.$inferSelect | null;
}

export async function scanAndAnalyzeToken(tokenAddress: string, chain: string = "solana"): Promise<ScanResult | null> {
  try {
    const pairs = await getTokenPairs(tokenAddress);
    if (!pairs.length) return null;

    const pair = pairs.find(p => p.chainId === chain) || pairs[0];
    const safety = await analyzeTokenSafety(pair);
    const basicSignal = calculateSignal(safety, pair);
    
    const tokenData = pairToTokenData(pair);
    
    const existing = await db.select().from(scannedTokens).where(eq(scannedTokens.address, tokenAddress)).limit(1);
    
    let token: typeof scannedTokens.$inferSelect;
    let isNew = false;

    if (existing.length > 0) {
      const [updated] = await db.update(scannedTokens)
        .set({
          ...tokenData,
          safetyScore: safety.score,
          isHoneypot: safety.isHoneypot,
          isLiquidityLocked: safety.isLiquidityLocked,
          mintAuthorityDisabled: safety.mintAuthorityDisabled,
          topHoldersPercentage: safety.topHoldersPercentage,
          riskLevel: safety.riskLevel,
          aiSignal: basicSignal.signal,
          aiAnalysis: basicSignal.reasoning,
          lastScannedAt: new Date(),
        })
        .where(eq(scannedTokens.address, tokenAddress))
        .returning();
      token = updated;
    } else {
      isNew = true;
      const [created] = await db.insert(scannedTokens)
        .values({
          ...tokenData,
          address: tokenAddress,
          symbol: pair.baseToken.symbol,
          name: pair.baseToken.name,
          safetyScore: safety.score,
          isHoneypot: safety.isHoneypot,
          isLiquidityLocked: safety.isLiquidityLocked,
          mintAuthorityDisabled: safety.mintAuthorityDisabled,
          topHoldersPercentage: safety.topHoldersPercentage,
          riskLevel: safety.riskLevel,
          aiSignal: basicSignal.signal,
          aiAnalysis: basicSignal.reasoning,
        })
        .returning();
      token = created;
    }

    let signal = null;
    if (basicSignal.signal === "buy" && basicSignal.confidence >= 60) {
      const [created] = await db.insert(tokenSignals)
        .values({
          tokenAddress,
          signalType: basicSignal.signal,
          confidence: basicSignal.confidence,
          entryPrice: pair.priceUsd,
          reasoning: basicSignal.reasoning,
          isActive: true,
        })
        .returning();
      signal = created;
    }

    return { token, isNew, signal };
  } catch (error) {
    console.error(`Error scanning token ${tokenAddress}:`, error);
    return null;
  }
}

export async function scanHotTokens(chain: string = "solana"): Promise<ScanResult[]> {
  console.log(`[Scanner] Discovering hot tokens on ${chain}...`);
  const hotPairs = await discoverHotTokens(chain);
  console.log(`[Scanner] Found ${hotPairs.length} hot tokens`);
  
  const results: ScanResult[] = [];
  
  for (const pair of hotPairs.slice(0, 20)) {
    const result = await scanAndAnalyzeToken(pair.baseToken.address, chain);
    if (result) {
      results.push(result);
      if (result.isNew) {
        console.log(`[Scanner] New token: ${pair.baseToken.symbol} (Score: ${result.token.safetyScore})`);
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  return results;
}

export async function getTopTokens(limit: number = 20): Promise<(typeof scannedTokens.$inferSelect)[]> {
  return db.select()
    .from(scannedTokens)
    .orderBy(desc(scannedTokens.safetyScore))
    .limit(limit);
}

export async function getNewTokens(hours: number = 24, limit: number = 50): Promise<(typeof scannedTokens.$inferSelect)[]> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return db.select()
    .from(scannedTokens)
    .where(gte(scannedTokens.pairCreatedAt, cutoff))
    .orderBy(desc(scannedTokens.createdAt))
    .limit(limit);
}

export async function getHotSignals(limit: number = 10): Promise<(typeof tokenSignals.$inferSelect)[]> {
  return db.select()
    .from(tokenSignals)
    .where(eq(tokenSignals.isActive, true))
    .orderBy(desc(tokenSignals.createdAt))
    .limit(limit);
}

export async function performDeepAnalysis(tokenAddress: string): Promise<{
  token: typeof scannedTokens.$inferSelect;
  aiAnalysis: Awaited<ReturnType<typeof analyzeTokenWithAI>>;
} | null> {
  const pairs = await getTokenPairs(tokenAddress);
  if (!pairs.length) return null;

  const pair = pairs[0];
  const safety = await analyzeTokenSafety(pair);
  const aiAnalysis = await analyzeTokenWithAI(pair, safety);
  
  const tokenData = pairToTokenData(pair);
  
  const [token] = await db.update(scannedTokens)
    .set({
      ...tokenData,
      safetyScore: safety.score,
      isHoneypot: safety.isHoneypot,
      riskLevel: safety.riskLevel,
      aiSignal: aiAnalysis.signal,
      aiAnalysis: aiAnalysis.summary + " " + aiAnalysis.reasoning,
      lastScannedAt: new Date(),
    })
    .where(eq(scannedTokens.address, tokenAddress))
    .returning();

  if (aiAnalysis.signal === "strong_buy" || aiAnalysis.signal === "buy") {
    await db.insert(tokenSignals).values({
      tokenAddress,
      signalType: aiAnalysis.signal,
      confidence: aiAnalysis.confidence,
      entryPrice: aiAnalysis.entryPrice || pair.priceUsd,
      targetPrice: aiAnalysis.targetPrice,
      stopLoss: aiAnalysis.stopLoss,
      reasoning: aiAnalysis.reasoning,
      isActive: true,
    });
  }

  return { token, aiAnalysis };
}

let scanInterval: NodeJS.Timeout | null = null;

export function startBackgroundScanner(intervalMs: number = 60 * 1000): void {
  if (scanInterval) {
    console.log("[Scanner] Already running");
    return;
  }

  console.log(`[Scanner] Starting background scanner (interval: ${intervalMs / 1000}s)`);
  
  scanInterval = setInterval(async () => {
    try {
      await scanHotTokens("solana");
    } catch (error) {
      console.error("[Scanner] Background scan error:", error);
    }
  }, intervalMs);

  scanHotTokens("solana").catch(console.error);
}

export function stopBackgroundScanner(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log("[Scanner] Stopped");
  }
}
