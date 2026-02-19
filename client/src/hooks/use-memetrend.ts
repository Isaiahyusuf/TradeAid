import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export type TokenItem = {
  id: string;
  contract_address: string;
  chain: string;
  name: string;
  symbol: string;
  market_cap_usd: number;
  liquidity_usd: number;
  holder_count: number;
  is_mintable: boolean;
  is_ownership_renounced: boolean;
  dex_id: string;
  created_at: string;
};

export function useTokens(chain?: string) {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["tokens", chain],
    queryFn: () => apiGet<{ tokens: TokenItem[]; count: number }>(`/api/tokens${chain ? `?chain=${chain}` : ""}`),
    staleTime: 30000,
    refetchInterval: 60000,
    enabled: hasToken,
    retry: 1,
  });
}

export function useTokenStats() {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["token-stats"],
    queryFn: () => apiGet<{ total_tokens: number; by_chain: Record<string, number> }>("/api/tokens/stats/overview"),
    staleTime: 30000,
    refetchInterval: 60000,
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
