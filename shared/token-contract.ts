export type LatestTokenScore = {
  rug_probability: number;
  liquidity_stability: number;
  holder_distribution: number;
  smart_wallet_signal: number;
  trade_confidence_index: number;
  eligible: boolean;
  scored_at: string;
};

export type TokenFeedItem = {
  id: string;
  latest_score?: LatestTokenScore | null;
  contract_address: string;
  chain: string;
  name: string;
  symbol: string;
  current_price_usd: number;
  market_cap_usd: number;
  liquidity_usd: number;
  volume_5m: number;
  volume_1h: number;
  volume_6h: number;
  price_change_5m: number;
  price_change_1h: number;
  price_change_6h: number;
  buys_1h: number;
  sells_1h: number;
  new_wallets_count: number;
  top_holders_pct: number | null;
  dev_wallet_pct: number | null;
  logo_url?: string | null;
  website_url?: string | null;
  twitter_url?: string | null;
  telegram_url?: string | null;
  description?: string | null;
  is_pump_fun?: boolean;
  source_platform?: string | null;
  buy_urls?: {
    pump_fun?: string;
    axiom?: string;
    gmgn?: string;
  };
  holder_count: number;
  is_mintable: boolean;
  is_ownership_renounced: boolean;
  dex_id: string;
  pair_address?: string | null;
  deployer_wallet?: string | null;
  total_supply?: string | null;
  created_at: string;
};

export type TokenFeedResponse = {
  tokens: TokenFeedItem[];
  count: number;
  total: number;
};
