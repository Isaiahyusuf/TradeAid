// Token types - matching Trade Aid backend
export interface Token {
  id: string;
  contract_address: string;
  chain: string;
  name: string;
  symbol: string;
  market_cap_usd?: number;
  liquidity_usd?: number;
  holder_count?: number;
  is_mintable: boolean;
  is_ownership_renounced: boolean;
  pair_address?: string;
  dex_id?: string;
  deployer_wallet?: string;
  liquidity_created_at?: string;
  created_at: string;
  // Additional fields from scanning
  price_usd?: string;
  volume_24h?: number;
  price_change_24h?: number;
  safety_score?: number;
  risk_level?: string;
  is_honeypot?: boolean;
}

export interface LiquidityEvent {
  event_type: string;
  liquidity_usd: number;
  liquidity_change_pct?: number;
  detected_at: string;
}

export interface TokenDetail extends Token {
  liquidity_events?: LiquidityEvent[];
}

// User/Profile types - matching Trade Aid auth
export interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  is_admin: boolean;
  totp_enabled: boolean;
  device_id?: string;
  // Additional profile fields
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  bio?: string;
  favoriteChain?: string;
  notificationsEnabled?: boolean;
  emailAlertsEnabled?: boolean;
  riskTolerance?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Alert types - matching Trade Aid backend
export interface Alert {
  id: string;
  alert_type: string;
  chain: string;
  severity: string;
  title: string;
  message: string;
  contract_address?: string;
  is_read: boolean;
  created_at: string;
}

// Wallet intelligence types
export interface DeveloperProfile {
  wallet_address: string;
  chain: string;
  total_tokens_deployed: number;
  success_rate: number;
  avg_liquidity_usd: number;
  rug_count: number;
  risk_score: number;
  reputation_tier: string;
  first_seen: string;
  last_activity: string;
}

export interface TraderProfile {
  wallet_address: string;
  chain: string;
  total_trades: number;
  win_rate: number;
  total_profit_usd: number;
  avg_hold_time_hours: number;
  risk_score: number;
  reputation_tier: string;
  first_seen: string;
  last_activity: string;
}

export interface WalletCluster {
  wallet_address: string;
  cluster_id?: string;
  related_wallets: string[];
  similarity_score: number;
  common_tokens: string[];
}

// Legacy types for backward compatibility
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
  id: string;
  symbol: string;
  name: string;
  price: string;
  volume24h: string;
  hypeScore?: number;
  trend?: string;
  market_cap_usd?: number;
  lastUpdated?: string;
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
