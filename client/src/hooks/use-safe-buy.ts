import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
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
  logo_url?: string | null;
  buy_links: {
    raydium: string;
    jupiter: string;
    dexscreener: string;
  };
  created_at: string;
};

export function useSafeBuy(limit: number = 20) {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["safe-buy", limit],
    queryFn: () => apiGet<{ tokens: SafeBuyItem[]; count: number; near_miss_tokens: SafeBuyItem[]; near_miss_count: number; refreshed_at: string }>(`/api/safe-buy?limit=${limit}`),
    staleTime: 10000,
    refetchInterval: 30000,
    enabled: hasToken,
    retry: 1,
  });
}
