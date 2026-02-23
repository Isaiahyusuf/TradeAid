import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export type TokenItem = {
  id: string;
  latest_score?: {
    rug_probability: number;
    liquidity_stability: number;
    holder_distribution: number;
    smart_wallet_signal: number;
    trade_confidence_index: number;
    eligible: boolean;
    scored_at: string;
  } | null;
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
  created_at: string;
};

export function useTokens(
  chain?: string,
  options?: {
    newOnly?: boolean;
    maxAgeHours?: number;
    prioritizePumpFun?: boolean;
    minAgeMinutes?: number;
    maxAgeMinutes?: number;
    limit?: number;
  }
) {
  const { hasToken } = useAuth();
  const queryString = new URLSearchParams();
  if (chain) queryString.set("chain", chain);
  if (options?.newOnly) queryString.set("new_only", "true");
  if (options?.maxAgeHours) queryString.set("max_age_hours", String(options.maxAgeHours));
  if (options?.prioritizePumpFun) queryString.set("prioritize_pump_fun", "true");
  if (typeof options?.minAgeMinutes === "number") queryString.set("min_age_minutes", String(options.minAgeMinutes));
  if (typeof options?.maxAgeMinutes === "number") queryString.set("max_age_minutes", String(options.maxAgeMinutes));
  if (typeof options?.limit === "number") queryString.set("limit", String(options.limit));
  const qs = queryString.toString();

  return useQuery({
    queryKey: [
      "tokens",
      chain,
      options?.newOnly,
      options?.maxAgeHours,
      options?.prioritizePumpFun,
      options?.minAgeMinutes,
      options?.maxAgeMinutes,
      options?.limit,
    ],
    queryFn: () => apiGet<{ tokens: TokenItem[]; count: number }>(`/api/tokens${qs ? `?${qs}` : ""}`),
    staleTime: 5000,
    refetchInterval: 5000,
    enabled: hasToken,
    retry: 1,
  });
}

export function useTokenStats() {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["token-stats"],
    queryFn: () => apiGet<{ total_tokens: number; by_chain: Record<string, number> }>("/api/tokens/stats/overview"),
    staleTime: 5000,
    refetchInterval: 5000,
    enabled: hasToken,
    retry: 1,
  });
}

export function useTokenDetail(chain: string, address: string) {
  return useQuery({
    queryKey: ["token-detail", chain, address],
    queryFn: () => apiGet(`/api/tokens/${chain}/${address}`),
    enabled: !!chain && !!address,
  });
}
