export interface Token {
  id: number;
  address: string;
  symbol: string;
  name: string;
  chain: string;
  dexId?: string;
  pairAddress?: string;
  priceUsd?: string;
  priceNative?: string;
  liquidity: number;
  marketCap: number;
  volume24h: number;
  priceChange1h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  safetyScore: number;
  isLiquidityLocked: boolean;
  mintAuthorityDisabled: boolean;
  topHoldersPercentage: number;
  isHoneypot: boolean;
  riskLevel: string;
  aiSignal: string;
  aiAnalysis?: string;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
  pairCreatedAt?: string;
  lastScannedAt?: string;
  createdAt?: string;
}

export interface TokenSignal {
  id: number;
  tokenAddress: string;
  signalType: string;
  confidence: number;
  entryPrice?: string;
  targetPrice?: string;
  stopLoss?: string;
  reasoning?: string;
  isActive: boolean;
  createdAt?: string;
  token?: Token;
}

export interface UserProfile {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  username?: string;
  bio?: string;
  favoriteChain: string;
  notificationsEnabled: boolean;
  emailAlertsEnabled: boolean;
  riskTolerance: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TrackedWallet {
  id: number;
  address: string;
  label: string;
  winRate: number;
  totalProfit: string;
}

export interface WalletAlert {
  id: number;
  walletId: number;
  tokenSymbol: string;
  type: string;
  amount: string;
  price: string;
  timestamp?: string;
}

export interface TrendingCoin {
  id: number;
  symbol: string;
  name: string;
  price: string;
  volume24h: string;
  hypeScore: number;
  trend: string;
  lastUpdated?: string;
}

export interface Subscription {
  plan: string;
  status: string;
  expiresAt?: string;
}

export interface UserUsage {
  dailyScans: number;
  dailyDeepAnalyses: number;
  dailySignalViews: number;
  adsViewed: number;
}
