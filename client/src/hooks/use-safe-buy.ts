import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";

export type SafeBuyItem = {
  id: string;
  contract_address: string;
  chain: string;
  name: string;
  symbol: string;
  market_cap_usd: number;
  liquidity_usd: number;
  volume_5m: number;
  volume_1h: number;
  holder_count: number;
  safety_score: number;
  risk_level: "Low" | "Medium" | "High";
  short_summary: string;
  recommendation: "Safe Early Entry" | "Monitor" | "Avoid" | string;
  confidence_score: number;
  trend: "up" | "down" | "flat";
  recently_added: boolean;
  buy_sell_ratio?: number;
  top_holders_pct?: number;
  dev_wallet_pct?: number;
  wallet_growth_rate?: number;
  source_platform?: string | null;
  logo_url?: string | null;
  buy_links: {
    pump_fun?: string;
    raydium: string;
    jupiter: string;
    dexscreener: string;
  };
  created_at: string;
};

export function useSafeBuy(
  limit: number = 20,
  options?: {
    chain?: string;
    chains?: string[];
  }
) {
  const chain = (options?.chain || "all").trim().toLowerCase();
  const chainList = (options?.chains || []).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("chain", chain || "all");
  if (chain === "custom" && chainList.length) {
    params.set("chains", chainList.join(","));
  }

  return useQuery({
    queryKey: ["safe-buy", limit, chain, chainList.join(",")],
    queryFn: () => apiGet<{
      tokens: SafeBuyItem[];
      count: number;
      total_count: number;
      near_miss_tokens: SafeBuyItem[];
      near_miss_count: number;
      near_miss_total_count: number;
      refreshed_at: string;
    }>(`/api/safe-buy?${params.toString()}`),
    staleTime: 10000,
    refetchInterval: 30000,
    enabled: true,
    retry: 1,
  });
}
