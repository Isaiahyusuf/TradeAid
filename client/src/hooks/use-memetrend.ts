import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import type { TokenFeedItem, TokenFeedResponse } from "@shared/token-contract";

export type TokenItem = TokenFeedItem;

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
  if (chain && chain !== "all") queryString.set("chain", chain);
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
    queryFn: () => apiGet<TokenFeedResponse>(`/api/tokens${qs ? `?${qs}` : ""}`),
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
