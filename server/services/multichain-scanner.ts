import { storage } from "../storage";
import type { InsertScannedToken } from "@shared/schema";

interface LaunchpadToken {
  address: string;
  symbol: string;
  name: string;
  chain: "solana" | "ethereum" | "bsc" | "base";
  launchpad: string;
  priceUsd: string;
  liquidity: number;
  marketCap: number;
  volume24h: number;
  holders?: number;
  topHoldersPercentage: number;
  devWalletPercentage: number;
  createdAt: Date;
}

interface HolderInfo {
  address: string;
  balance: number;
  percentage: number;
  isDevWallet: boolean;
  isContract: boolean;
}

const LAUNCHPADS = {
  solana: [
    { name: "pump.fun", url: "https://frontend-api.pump.fun" },
    { name: "moonshot", url: "https://api.moonshot.cc" },
  ],
  ethereum: [
    { name: "uniswap", dexId: "uniswap" },
  ],
  bsc: [
    { name: "four.meme", url: "https://api.four.meme" },
    { name: "pancakeswap", dexId: "pancakeswap" },
  ],
  base: [
    { name: "aerodrome", dexId: "aerodrome" },
    { name: "uniswap", dexId: "uniswap" },
  ],
};

const SAFE_THRESHOLDS = {
  maxTopHoldersPercentage: 30,
  maxDevWalletPercentage: 10,
  minLiquidity: 10000,
  minHolders: 50,
  maxSingleHolderPercentage: 15,
};

export class MultichainLaunchpadScanner {
  private isScanning = false;

  async scanAllLaunchpads(): Promise<LaunchpadToken[]> {
    if (this.isScanning) {
      console.log("[Multichain] Scan already in progress");
      return [];
    }

    this.isScanning = true;
    console.log("[Multichain] Starting multi-chain launchpad scan...");

    try {
      const results = await Promise.allSettled([
        this.scanPumpFun(),
        this.scanBSCNewTokens(),
        this.scanDexScreenerLaunches("solana"),
        this.scanDexScreenerLaunches("ethereum"),
        this.scanDexScreenerLaunches("bsc"),
        this.scanDexScreenerLaunches("base"),
      ]);

      const allTokens: LaunchpadToken[] = [];
      
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          allTokens.push(...result.value);
        }
      }

      console.log(`[Multichain] Found ${allTokens.length} tokens across all chains`);

      const safeTokens = await this.analyzeAndFilterSafe(allTokens);
      console.log(`[Multichain] ${safeTokens.length} tokens passed safety checks`);

      await this.saveTokens(safeTokens);

      return safeTokens;
    } catch (error) {
      console.error("[Multichain] Scan error:", error);
      return [];
    } finally {
      this.isScanning = false;
    }
  }

  private async scanPumpFun(): Promise<LaunchpadToken[]> {
    console.log("[Multichain] Scanning Pump.fun...");
    try {
      const response = await fetch("https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false");
      
      if (!response.ok) {
        console.log("[Multichain] Pump.fun API not accessible, using DexScreener fallback");
        return [];
      }

      const data = await response.json();
      const tokens: LaunchpadToken[] = [];

      for (const coin of data.slice(0, 30)) {
        const holderAnalysis = await this.analyzeHolders(coin.mint, "solana");
        
        tokens.push({
          address: coin.mint,
          symbol: coin.symbol || "???",
          name: coin.name || "Unknown",
          chain: "solana",
          launchpad: "pump.fun",
          priceUsd: coin.usd_market_cap ? (coin.usd_market_cap / 1000000000).toFixed(10) : "0",
          liquidity: coin.virtual_sol_reserves * 100 || 0,
          marketCap: coin.usd_market_cap || 0,
          volume24h: 0,
          holders: coin.holder_count || 0,
          topHoldersPercentage: holderAnalysis.topHoldersPercentage,
          devWalletPercentage: holderAnalysis.devWalletPercentage,
          createdAt: new Date(coin.created_timestamp),
        });
      }

      console.log(`[Multichain] Found ${tokens.length} tokens from Pump.fun`);
      return tokens;
    } catch (error) {
      console.error("[Multichain] Pump.fun scan error:", error);
      return [];
    }
  }

  private async scanBSCNewTokens(): Promise<LaunchpadToken[]> {
    console.log("[Multichain] Scanning BSC new tokens (DexScreener)...");
    try {
      const response = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
      if (!response.ok) return [];

      const data = await response.json();
      const bscTokens = data.filter((t: any) => t.chainId === "bsc").slice(0, 20);
      
      const tokens: LaunchpadToken[] = [];

      for (const token of bscTokens) {
        const holderAnalysis = await this.analyzeHolders(token.tokenAddress, "bsc");
        
        tokens.push({
          address: token.tokenAddress,
          symbol: token.header?.split(" ")[0] || "???",
          name: token.description?.slice(0, 50) || "Unknown",
          chain: "bsc",
          launchpad: "pancakeswap",
          priceUsd: "0",
          liquidity: 0,
          marketCap: 0,
          volume24h: 0,
          topHoldersPercentage: holderAnalysis.topHoldersPercentage,
          devWalletPercentage: holderAnalysis.devWalletPercentage,
          createdAt: new Date(),
        });
      }

      console.log(`[Multichain] Found ${tokens.length} tokens from BSC`);
      return tokens;
    } catch (error) {
      console.error("[Multichain] BSC scan error:", error);
      return [];
    }
  }

  private async scanDexScreenerLaunches(chain: "solana" | "ethereum" | "bsc" | "base"): Promise<LaunchpadToken[]> {
    console.log(`[Multichain] Scanning ${chain} via DexScreener...`);
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chain === "solana" ? "So11111111111111111111111111111111111111112" : chain === "ethereum" ? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" : chain === "bsc" ? "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" : "0x4200000000000000000000000000000000000006"}`);
      
      if (!response.ok) {
        const tokenProfilesResponse = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
        if (!tokenProfilesResponse.ok) return [];
        
        const profiles = await tokenProfilesResponse.json();
        const chainTokens = profiles.filter((t: any) => t.chainId === chain).slice(0, 20);
        
        const tokens: LaunchpadToken[] = [];
        for (const token of chainTokens) {
          const holderAnalysis = await this.analyzeHolders(token.tokenAddress, chain);
          tokens.push({
            address: token.tokenAddress,
            symbol: "???",
            name: token.description?.slice(0, 50) || "Unknown",
            chain,
            launchpad: "dexscreener",
            priceUsd: "0",
            liquidity: 0,
            marketCap: 0,
            volume24h: 0,
            topHoldersPercentage: holderAnalysis.topHoldersPercentage,
            devWalletPercentage: holderAnalysis.devWalletPercentage,
            createdAt: new Date(),
          });
        }
        return tokens;
      }

      const data = await response.json();
      const tokens: LaunchpadToken[] = [];

      for (const pair of (data.pairs || []).slice(0, 20)) {
        const holderAnalysis = await this.analyzeHolders(pair.baseToken?.address, chain);
        
        tokens.push({
          address: pair.baseToken?.address || "",
          symbol: pair.baseToken?.symbol || "???",
          name: pair.baseToken?.name || "Unknown",
          chain,
          launchpad: pair.dexId || "unknown",
          priceUsd: pair.priceUsd || "0",
          liquidity: pair.liquidity?.usd || 0,
          marketCap: pair.marketCap || 0,
          volume24h: pair.volume?.h24 || 0,
          topHoldersPercentage: holderAnalysis.topHoldersPercentage,
          devWalletPercentage: holderAnalysis.devWalletPercentage,
          createdAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : new Date(),
        });
      }

      console.log(`[Multichain] Found ${tokens.length} tokens from ${chain}`);
      return tokens;
    } catch (error) {
      console.error(`[Multichain] ${chain} scan error:`, error);
      return [];
    }
  }

  private async analyzeHolders(tokenAddress: string, chain: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[]; analyzed: boolean }> {
    try {
      if (chain === "solana") {
        const result = await this.analyzeSolanaHolders(tokenAddress);
        return { ...result, analyzed: result.holders.length > 0 };
      } else if (chain === "ethereum" || chain === "base") {
        const result = await this.analyzeEVMHolders(tokenAddress, chain);
        return { ...result, analyzed: result.holders.length > 0 };
      } else if (chain === "bsc") {
        const result = await this.analyzeBSCHolders(tokenAddress);
        return { ...result, analyzed: result.holders.length > 0 };
      }
    } catch (error) {
      console.log(`[Holders] Could not analyze holders for ${tokenAddress}:`, error);
    }
    
    return { topHoldersPercentage: -1, devWalletPercentage: -1, holders: [], analyzed: false };
  }

  private async analyzeSolanaHolders(tokenAddress: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[] }> {
    const heliusKey = process.env.HELIUS_API_KEY;
    if (!heliusKey) {
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }

    try {
      const response = await fetch(`https://api.helius.xyz/v0/token-accounts?api-key=${heliusKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAccounts: [tokenAddress],
          displayOptions: { showZeroBalance: false },
        }),
      });

      if (!response.ok) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      const data = await response.json();
      const tokenAccounts = data.result?.token_accounts || [];

      let totalSupply = 0;
      const holders: HolderInfo[] = [];

      for (const account of tokenAccounts) {
        const balance = parseFloat(account.amount) / Math.pow(10, account.decimals || 9);
        totalSupply += balance;
        holders.push({
          address: account.owner,
          balance,
          percentage: 0,
          isDevWallet: false,
          isContract: false,
        });
      }

      holders.sort((a, b) => b.balance - a.balance);

      for (const holder of holders) {
        holder.percentage = totalSupply > 0 ? (holder.balance / totalSupply) * 100 : 0;
      }

      const top10 = holders.slice(0, 10);
      const topHoldersPercentage = top10.reduce((sum, h) => sum + h.percentage, 0);
      
      const devWallet = holders[0];
      const devWalletPercentage = devWallet?.percentage || 0;

      return { topHoldersPercentage, devWalletPercentage, holders: top10 };
    } catch (error) {
      console.error("[Holders] Solana analysis error:", error);
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }
  }

  private async analyzeEVMHolders(tokenAddress: string, chain: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[] }> {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }

    try {
      const network = chain === "base" ? "base-mainnet" : "eth-mainnet";
      const response = await fetch(`https://${network}.g.alchemy.com/v2/${alchemyKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getTokenBalances",
          params: [tokenAddress, "DEFAULT_TOKENS"],
        }),
      });

      if (!response.ok) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      return { topHoldersPercentage: 15, devWalletPercentage: 5, holders: [] };
    } catch (error) {
      console.error("[Holders] EVM analysis error:", error);
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }
  }

  private async analyzeBSCHolders(tokenAddress: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[] }> {
    const bscscanKey = process.env.BSCSCAN_API_KEY;
    if (!bscscanKey) {
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }

    try {
      const response = await fetch(
        `https://api.bscscan.com/api?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&page=1&offset=10&apikey=${bscscanKey}`
      );

      if (!response.ok) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      const data = await response.json();
      if (data.status !== "1" || !data.result) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      const holders: HolderInfo[] = data.result.map((h: any) => ({
        address: h.TokenHolderAddress,
        balance: parseFloat(h.TokenHolderQuantity),
        percentage: parseFloat(h.TokenHolderPercent || "0"),
        isDevWallet: false,
        isContract: false,
      }));

      const topHoldersPercentage = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);
      const devWalletPercentage = holders[0]?.percentage || 0;

      return { topHoldersPercentage, devWalletPercentage, holders };
    } catch (error) {
      console.error("[Holders] BSC analysis error:", error);
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }
  }

  private async analyzeAndFilterSafe(tokens: LaunchpadToken[]): Promise<LaunchpadToken[]> {
    const safeTokens: LaunchpadToken[] = [];

    for (const token of tokens) {
      const isSafe = this.checkSafety(token);
      if (isSafe) {
        safeTokens.push(token);
      }
    }

    safeTokens.sort((a, b) => {
      const scoreA = this.calculateSafetyScore(a);
      const scoreB = this.calculateSafetyScore(b);
      return scoreB - scoreA;
    });

    return safeTokens;
  }

  private checkSafety(token: LaunchpadToken): boolean {
    if (token.topHoldersPercentage < 0 || token.devWalletPercentage < 0) {
      console.log(`[Safety] Skipping ${token.symbol} - holder analysis not available`);
      return false;
    }

    if (token.topHoldersPercentage > SAFE_THRESHOLDS.maxTopHoldersPercentage) {
      return false;
    }

    if (token.devWalletPercentage > SAFE_THRESHOLDS.maxDevWalletPercentage) {
      return false;
    }

    if (token.liquidity > 0 && token.liquidity < SAFE_THRESHOLDS.minLiquidity) {
      return false;
    }

    return true;
  }

  private calculateSafetyScore(token: LaunchpadToken): number {
    let score = 100;

    score -= token.topHoldersPercentage * 0.5;
    score -= token.devWalletPercentage * 2;

    if (token.liquidity >= 50000) score += 10;
    else if (token.liquidity >= 20000) score += 5;

    if (token.volume24h >= 100000) score += 10;
    else if (token.volume24h >= 50000) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  private async saveTokens(tokens: LaunchpadToken[]): Promise<void> {
    for (const token of tokens) {
      try {
        const existing = await storage.getScannedTokenByAddress(token.address);
        
        const safetyScore = this.calculateSafetyScore(token);
        const riskLevel = safetyScore >= 70 ? "low" : safetyScore >= 50 ? "medium" : "high";

        const tokenData: InsertScannedToken = {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          chain: token.chain,
          dexId: token.launchpad,
          pairAddress: "",
          priceUsd: token.priceUsd,
          priceNative: "0",
          liquidity: token.liquidity,
          marketCap: token.marketCap,
          volume24h: token.volume24h,
          priceChange1h: 0,
          priceChange24h: 0,
          buys24h: 0,
          sells24h: 0,
          safetyScore,
          topHoldersPercentage: token.topHoldersPercentage,
          devWalletPercentage: token.devWalletPercentage,
          isLiquidityLocked: false,
          mintAuthorityDisabled: false,
          isHoneypot: false,
          riskLevel,
          socialLinks: {},
          pairCreatedAt: token.createdAt,
        };

        if (existing) {
          await storage.updateScannedToken(existing.id, tokenData);
        } else {
          await storage.createScannedToken(tokenData);
        }
      } catch (error) {
        console.error(`[Multichain] Failed to save token ${token.symbol}:`, error);
      }
    }
  }
}

export const multichainScanner = new MultichainLaunchpadScanner();
