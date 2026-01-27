import type { InsertScannedToken } from "@shared/schema";

const DEX_API_BASE = "https://api.dexscreener.com";

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: { h24: number; h6?: number; h1?: number; m5?: number };
  priceChange: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd: number; base: number; quote: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { platform: string; handle?: string; url?: string }[];
  };
  boosts?: { active: number };
}

export interface TokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: { label: string; url: string }[];
}

async function fetchWithRetry<T>(url: string, retries = 3): Promise<T | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) {
        console.error(`DexScreener API error: ${url}`, e);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

export async function getLatestTokenProfiles(): Promise<TokenProfile[]> {
  const data = await fetchWithRetry<TokenProfile[]>(`${DEX_API_BASE}/token-profiles/latest/v1`);
  return data || [];
}

export async function getLatestBoostedTokens(): Promise<TokenProfile[]> {
  const data = await fetchWithRetry<TokenProfile[]>(`${DEX_API_BASE}/token-boosts/latest/v1`);
  return data || [];
}

export async function getTopBoostedTokens(): Promise<TokenProfile[]> {
  const data = await fetchWithRetry<TokenProfile[]>(`${DEX_API_BASE}/token-boosts/top/v1`);
  return data || [];
}

export async function getTokenPairs(tokenAddress: string): Promise<DexPair[]> {
  const data = await fetchWithRetry<{ pairs: DexPair[] }>(`${DEX_API_BASE}/latest/dex/tokens/${tokenAddress}`);
  return data?.pairs || [];
}

export async function getPairsByChain(chainId: string, pairAddress: string): Promise<DexPair | null> {
  const data = await fetchWithRetry<{ pair: DexPair }>(`${DEX_API_BASE}/latest/dex/pairs/${chainId}/${pairAddress}`);
  return data?.pair || null;
}

export async function searchTokens(query: string): Promise<DexPair[]> {
  const data = await fetchWithRetry<{ pairs: DexPair[] }>(`${DEX_API_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
  return data?.pairs || [];
}

export async function getNewPairs(chain: string = "solana", maxAgeHours: number = 24): Promise<DexPair[]> {
  const profiles = await getLatestTokenProfiles();
  const chainProfiles = profiles.filter(p => p.chainId === chain);
  
  const allPairs: DexPair[] = [];
  const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  
  for (const profile of chainProfiles.slice(0, 20)) {
    const pairs = await getTokenPairs(profile.tokenAddress);
    const newPairs = pairs.filter(p => p.pairCreatedAt > cutoffTime && p.chainId === chain);
    allPairs.push(...newPairs);
    await new Promise(r => setTimeout(r, 100));
  }
  
  return allPairs;
}

export async function discoverHotTokens(chain: string = "solana"): Promise<DexPair[]> {
  const [latestProfiles, boosted, topBoosted] = await Promise.all([
    getLatestTokenProfiles(),
    getLatestBoostedTokens(),
    getTopBoostedTokens(),
  ]);
  
  const allProfiles = Array.from(new Map([...latestProfiles, ...boosted, ...topBoosted].map(p => [p.tokenAddress, p])).values());
  const chainProfiles = allProfiles.filter(p => p.chainId === chain);
  
  const hotPairs: DexPair[] = [];
  
  for (const profile of chainProfiles.slice(0, 30)) {
    const pairs = await getTokenPairs(profile.tokenAddress);
    if (pairs.length > 0) {
      const bestPair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (bestPair && (bestPair.liquidity?.usd || 0) > 1000) {
        hotPairs.push(bestPair);
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  
  return hotPairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
}

export function pairToTokenData(pair: DexPair): Partial<InsertScannedToken> {
  const socials = pair.info?.socials || [];
  const twitter = socials.find(s => s.platform === "twitter")?.handle || socials.find(s => s.platform === "twitter")?.url;
  const telegram = socials.find(s => s.platform === "telegram")?.handle || socials.find(s => s.platform === "telegram")?.url;
  const website = pair.info?.websites?.[0]?.url;

  return {
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    chain: pair.chainId,
    dexId: pair.dexId,
    pairAddress: pair.pairAddress,
    priceUsd: pair.priceUsd,
    priceNative: pair.priceNative,
    liquidity: pair.liquidity?.usd || 0,
    marketCap: pair.marketCap || pair.fdv || 0,
    volume24h: pair.volume?.h24 || 0,
    priceChange1h: pair.priceChange?.h1 || 0,
    priceChange24h: pair.priceChange?.h24 || 0,
    buys24h: pair.txns?.h24?.buys || 0,
    sells24h: pair.txns?.h24?.sells || 0,
    socialLinks: { twitter, telegram, website },
    pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : undefined,
  };
}
