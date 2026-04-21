import { db } from "../db";
import { scannedTokens, tokenSignals, userAlerts } from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { discoverHotTokens, getNewPairs, getTokenPairs, pairToTokenData, pickBestPair, type DexPair } from "./dexscreener";
import { analyzeTokenSafety, calculateSignal } from "./safety-analyzer";
import { analyzeTokenWithAI, generateQuickInsight } from "./ai-analyzer";

const isMissingTokenSignalsTableError = (error: unknown) => {
  const dbError = error as { code?: string; message?: string };
  return dbError?.code === "42P01" && String(dbError?.message || "").toLowerCase().includes("token_signals");
};

export interface ScanResult {
  token: typeof scannedTokens.$inferSelect;
  isNew: boolean;
  signal: typeof tokenSignals.$inferSelect | null;
}

type ScannerHealthSnapshot = {
  running: boolean;
  inFlight: boolean;
  lastScanAt: string | null;
  lastDurationMs: number;
  candidatesDiscovered: number;
  candidatesProcessed: number;
  successfulScans: number;
  newTokensSaved: number;
  liquidityPositiveCount: number;
  liquidityPositiveRatePct: number;
  cycleCount: number;
};

const scannerHealth: ScannerHealthSnapshot = {
  running: false,
  inFlight: false,
  lastScanAt: null,
  lastDurationMs: 0,
  candidatesDiscovered: 0,
  candidatesProcessed: 0,
  successfulScans: 0,
  newTokensSaved: 0,
  liquidityPositiveCount: 0,
  liquidityPositiveRatePct: 0,
  cycleCount: 0,
};

export async function scanAndAnalyzeToken(tokenAddress: string, chain: string = "solana"): Promise<ScanResult | null> {
  try {
    const pairs = await getTokenPairs(tokenAddress);
    if (!pairs.length) return null;

    const pair = pickBestPair(pairs, chain) || pairs[0];
    const safety = await analyzeTokenSafety(pair);
    const basicSignal = calculateSignal(safety, pair);
    
    const tokenData = pairToTokenData(pair);
    
    const existing = await db.select().from(scannedTokens).where(eq(scannedTokens.address, tokenAddress)).limit(1);
    
    let token: typeof scannedTokens.$inferSelect;
    let isNew = false;

    if (existing.length > 0) {
      const previous = existing[0];
      const safeTokenData = {
        ...tokenData,
        liquidity: Number(tokenData.liquidity || 0) > 0 ? tokenData.liquidity : previous.liquidity,
        marketCap: Number(tokenData.marketCap || 0) > 0 ? tokenData.marketCap : previous.marketCap,
        volume24h: Number(tokenData.volume24h || 0) > 0 ? tokenData.volume24h : previous.volume24h,
      };
      const [updated] = await db.update(scannedTokens)
        .set({
          ...safeTokenData,
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
      try {
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
      } catch (error) {
        if (!isMissingTokenSignalsTableError(error)) {
          throw error;
        }
      }
    }

    return { token, isNew, signal };
  } catch (error) {
    console.error(`Error scanning token ${tokenAddress}:`, error);
    return null;
  }
}

export async function scanHotTokens(chain: string = "solana"): Promise<ScanResult[]> {
  const startedAt = Date.now();
  console.log(`[Scanner] Discovering hot tokens on ${chain}...`);
  const [hotPairs, newPairs] = await Promise.all([
    discoverHotTokens(chain),
    getNewPairs(chain, 6),
  ]);

  const mergedMap = new Map<string, DexPair>();
  for (const pair of [...newPairs, ...hotPairs]) {
    const address = String(pair.baseToken?.address || "").trim();
    if (!address) continue;
    const existingPair = mergedMap.get(address);
    if (!existingPair) {
      mergedMap.set(address, pair);
      continue;
    }
    const existingLiquidity = Number(existingPair.liquidity?.usd || 0);
    const nextLiquidity = Number(pair.liquidity?.usd || 0);
    if (nextLiquidity >= existingLiquidity) {
      mergedMap.set(address, pair);
    }
  }
  const candidatePairs = Array.from(mergedMap.values())
    .sort((left, right) => {
      const leftCreated = Number(left?.pairCreatedAt || 0);
      const rightCreated = Number(right?.pairCreatedAt || 0);
      if (rightCreated !== leftCreated) return rightCreated - leftCreated;
      return Number(right?.liquidity?.usd || 0) - Number(left?.liquidity?.usd || 0);
    });
  const positiveLiquidityPairs = candidatePairs.filter((pair) => Number(pair.liquidity?.usd || 0) > 0);
  scannerHealth.candidatesDiscovered = candidatePairs.length;
  scannerHealth.liquidityPositiveCount = positiveLiquidityPairs.length;
  scannerHealth.liquidityPositiveRatePct = candidatePairs.length > 0
    ? Number(((positiveLiquidityPairs.length / candidatePairs.length) * 100).toFixed(2))
    : 0;
  console.log(`[Scanner] Found ${candidatePairs.length} hot/new token candidates`);
  
  const results: ScanResult[] = [];
  let processed = 0;
  let successful = 0;
  let newSaved = 0;
  
  const maxPairsPerCycle = Math.max(10, Math.min(100, Number(process.env.SCANNER_MAX_PAIRS_PER_CYCLE || 50)));
  const interPairDelayMs = Math.max(0, Number(process.env.SCANNER_INTER_PAIR_DELAY_MS || 75));

  for (const pair of candidatePairs.slice(0, maxPairsPerCycle)) {
    processed += 1;
    const result = await scanAndAnalyzeToken(pair.baseToken.address, chain);
    if (result) {
      results.push(result);
      successful += 1;
      if (result.isNew) {
        newSaved += 1;
        console.log(`[Scanner] New token: ${pair.baseToken.symbol} (Score: ${result.token.safetyScore})`);
      }
    }
    if (interPairDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, interPairDelayMs));
    }
  }

  scannerHealth.lastScanAt = new Date().toISOString();
  scannerHealth.lastDurationMs = Date.now() - startedAt;
  scannerHealth.candidatesProcessed = processed;
  // Track successful scan cycles (not per-token successes) for reliable health ratio.
  scannerHealth.successfulScans = Math.max(0, Number(scannerHealth.successfulScans || 0)) + 1;
  scannerHealth.newTokensSaved = newSaved;
  scannerHealth.cycleCount += 1;
  
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
  try {
    return await db.select()
      .from(tokenSignals)
      .where(eq(tokenSignals.isActive, true))
      .orderBy(desc(tokenSignals.createdAt))
      .limit(limit);
  } catch (error) {
    if (isMissingTokenSignalsTableError(error)) {
      return [];
    }
    throw error;
  }
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
    try {
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
    } catch (error) {
      if (!isMissingTokenSignalsTableError(error)) {
        throw error;
      }
    }
  }

  return { token, aiAnalysis };
}

let scanInterval: NodeJS.Timeout | null = null;
let scanInFlight = false;

export function startBackgroundScanner(intervalMs: number = 60 * 1000): void {
  if (scanInterval) {
    console.log("[Scanner] Already running");
    return;
  }

  console.log(`[Scanner] Starting background scanner (interval: ${intervalMs / 1000}s)`);
  scannerHealth.running = true;
  
  const runScan = async () => {
    if (scanInFlight) {
      console.log("[Scanner] Previous scan still running, skipping tick");
      return;
    }
    scanInFlight = true;
    scannerHealth.inFlight = true;
    try {
      await scanHotTokens("solana");
    } catch (error) {
      console.error("[Scanner] Background scan error:", error);
    } finally {
      scanInFlight = false;
      scannerHealth.inFlight = false;
    }
  };

  scanInterval = setInterval(runScan, intervalMs);

  runScan().catch(console.error);
}

export function stopBackgroundScanner(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    scannerHealth.running = false;
    scannerHealth.inFlight = false;
    console.log("[Scanner] Stopped");
  }
}

export function getScannerHealthStatus(): ScannerHealthSnapshot {
  return {
    ...scannerHealth,
    inFlight: Boolean(scanInFlight),
    running: Boolean(scanInterval),
  };
}
