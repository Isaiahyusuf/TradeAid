import axios from "axios";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const BONK_MINT = String(process.env.BONK_MINT || "DezXAZ8z7PnrnRJjz3wXBoRgixCa6Jf6x6f8wQf9fWq").trim();

export type RaydiumPoolSnapshot = {
  poolAddress: string;
  baseMint: string;
  quoteMint: string;
  baseSymbol: string;
  quoteSymbol: string;
  liquidityUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  topHoldersPct: number;
  devWalletPct: number;
  liquidityLocked: boolean;
  launchSource: "pumpfun" | "raydium" | "bonk" | "unknown";
  createdAtIso: string;
};

type RaydiumCache = {
  fetchedAt: number;
  pools: RaydiumPoolSnapshot[];
};

const cache: RaydiumCache = {
  fetchedAt: 0,
  pools: [],
};

let isFetching = false;

function normalizeSource(value: string): RaydiumPoolSnapshot["launchSource"] {
  const v = String(value || "").toLowerCase();
  if (v.includes("pump")) return "pumpfun";
  if (v.includes("ray")) return "raydium";
  if (v.includes("bonk")) return "bonk";
  return "unknown";
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function detectLiquidityLocked(input: Record<string, unknown>): boolean | null {
  const direct = [
    input.liquidityLocked,
    input.liquidity_locked,
    input.lpLocked,
    input.isLocked,
    input.locked,
  ];

  for (const value of direct) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (normalized === "true" || normalized === "yes" || normalized === "locked") return true;
      if (normalized === "false" || normalized === "no" || normalized === "unlocked") return false;
    }
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
  }

  const lpLockPct = toNumber(input.lpLockPct ?? input.lp_lock_pct ?? input.lockPercent ?? input.lock_percent, NaN);
  if (Number.isFinite(lpLockPct)) {
    return lpLockPct >= 50;
  }

  return null;
}

function parseRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.pools)) return payload.pools;
  return [];
}

function mapPool(row: Record<string, unknown>): RaydiumPoolSnapshot | null {
  const baseMint = String(row.baseMint || row.base_mint || row.mintA || row.tokenMint0 || "").trim();
  const quoteMint = String(row.quoteMint || row.quote_mint || row.mintB || row.tokenMint1 || "").trim();
  const poolAddress = String(row.id || row.poolAddress || row.ammId || row.address || "").trim();
  if (!poolAddress || !baseMint || !quoteMint) return null;

  const createdAtRaw = String(row.poolOpenTime || row.createdAt || row.created_at || row.openTime || "").trim();
  const createdAtDate = (() => {
    if (!createdAtRaw) return new Date();
    const numeric = Number(createdAtRaw);
    if (Number.isFinite(numeric) && numeric > 0) {
      const epochMs = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      return new Date(epochMs);
    }
    return new Date(createdAtRaw);
  })();
  const createdAtIso = Number.isNaN(createdAtDate.getTime()) ? new Date().toISOString() : createdAtDate.toISOString();

  const sourceRaw = String(row.launchpad || row.source || row.dexId || row.dex_id || row.platform || "");
  const launchSource = normalizeSource(sourceRaw || "raydium");

  const lockState = detectLiquidityLocked(row);

  return {
    poolAddress,
    baseMint,
    quoteMint,
    baseSymbol: String(row.baseSymbol || row.base_symbol || row.symbolA || row.symbol0 || "").trim() || "UNKNOWN",
    quoteSymbol: String(row.quoteSymbol || row.quote_symbol || row.symbolB || row.symbol1 || "").trim() || "UNKNOWN",
    liquidityUsd: toNumber(row.liquidityUsd ?? row.liquidity_usd ?? row.tvl ?? row.liquidity),
    marketCapUsd: toNumber(row.marketCapUsd ?? row.market_cap_usd ?? row.mcap ?? row.fdv),
    volume24hUsd: toNumber(row.volume24h ?? row.volume_24h ?? (row as any)?.day?.volume ?? row.volume),
    topHoldersPct: toNumber(row.topHoldersPct ?? row.top_holders_pct ?? row.topHolderPct ?? row.top_holder_pct),
    devWalletPct: toNumber(row.devWalletPct ?? row.dev_wallet_pct ?? row.devPct ?? row.dev_pct),
    liquidityLocked: lockState ?? (launchSource === "raydium" || launchSource === "bonk"),
    launchSource,
    createdAtIso,
  };
}

async function fetchRaydiumFromEndpoints(): Promise<RaydiumPoolSnapshot[]> {
  const endpoints = [
    "https://api-v3.raydium.io/pools/info/list?poolType=all&poolSortField=default&sortType=desc&pageSize=200&page=1",
    "https://api-v3.raydium.io/pools/info/mint?mint1=So11111111111111111111111111111111111111112",
  ];

  const responses = await Promise.allSettled(
    endpoints.map((url) => axios.get(url, { timeout: 7000 }).then((r) => r.data)),
  );

  const rows: any[] = [];
  for (const item of responses) {
    if (item.status !== "fulfilled") continue;
    rows.push(...parseRows(item.value));
  }

  const mapped = rows
    .map((row) => mapPool((row || {}) as Record<string, unknown>))
    .filter((row): row is RaydiumPoolSnapshot => Boolean(row));

  const deduped = new Map<string, RaydiumPoolSnapshot>();
  for (const row of mapped) {
    deduped.set(row.poolAddress, row);
  }
  return Array.from(deduped.values());
}

export async function refreshRaydiumPools(force = false): Promise<RaydiumPoolSnapshot[]> {
  const ttlMs = Math.max(10_000, Number(process.env.RAYDIUM_POOL_CACHE_MS || 30_000));
  const stale = Date.now() - cache.fetchedAt > ttlMs;
  if (!force && !stale && cache.pools.length > 0) {
    return cache.pools;
  }

  if (isFetching) {
    return cache.pools;
  }

  isFetching = true;
  try {
    const pools = await fetchRaydiumFromEndpoints();
    cache.fetchedAt = Date.now();
    if (pools.length > 0) {
      cache.pools = pools;
    }
  } catch {
  } finally {
    isFetching = false;
  }

  return cache.pools;
}

export function getRaydiumPoolsSnapshot(): RaydiumPoolSnapshot[] {
  return cache.pools;
}

export function startRaydiumPoolFetcher(): void {
  const intervalMs = Math.max(20_000, Math.min(60_000, Number(process.env.RAYDIUM_POOL_FETCH_INTERVAL_MS || 30_000)));
  setInterval(() => {
    refreshRaydiumPools().catch(() => undefined);
  }, intervalMs);
}

export function detectSupportedBaseMint(pool: RaydiumPoolSnapshot): { baseMint: string; tokenMint: string } | null {
  const mints = [pool.baseMint, pool.quoteMint];
  if (mints.includes(SOL_MINT)) {
    const tokenMint = pool.baseMint === SOL_MINT ? pool.quoteMint : pool.baseMint;
    return { baseMint: SOL_MINT, tokenMint };
  }
  if (mints.includes(BONK_MINT)) {
    const tokenMint = pool.baseMint === BONK_MINT ? pool.quoteMint : pool.baseMint;
    return { baseMint: BONK_MINT, tokenMint };
  }
  return null;
}
