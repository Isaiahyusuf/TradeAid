import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiGet } from "@/lib/api";

export type ScoreResult = {
  id?: string;
  rug_probability: number;
  rug_risk_score?: number;
  liquidity_stability: number;
  holder_distribution: number;
  smart_wallet_signal: number;
  trade_confidence_index: number;
  opportunity_score?: number;
  eligible: boolean;
  eligibility_reason?: string;
  risk_flags?: string[];
  status?: string;
  scored_at?: string;
};

export type DevIntelResult = {
  identity: {
    launch_fingerprint?: string;
    linked_wallet_count: number;
    link_method: string;
  };
  rug_profile: {
    is_rug_dev: boolean;
    linked_launches: number;
    linked_rugs: number;
    rug_ratio_pct: number;
    typical_rug_mcap_usd: number;
    average_rug_mcap_usd: number;
  };
  jeet_checker: {
    avg_jeet_score: number;
    high_jeet_ratio_pct: number;
    too_many_jeets: boolean;
  };
  project_info?: {
    social_links: {
      x?: string | null;
      telegram?: string | null;
      discord?: string | null;
    };
    websites?: string[];
    community_checker?: {
      activity_score: number;
      overall_status: "active" | "moderate" | "low";
      active_platforms: number;
      available_platforms: number;
      summary: string;
      signals: {
        volume_1h: number;
        trades_5m: number;
        trades_1h: number;
        price_change_1h: number;
      };
      platforms: Array<{
        platform: "x" | "telegram" | "discord";
        url?: string | null;
        available: boolean;
        reachable: boolean;
        is_active: boolean;
        status: "active" | "inactive" | "unavailable" | "unreachable";
        status_code?: number | null;
      }>;
    };
  };
  past_launches: Array<{
    contract_address: string;
    symbol?: string;
    name?: string;
    created_at: string;
    market_cap_usd: number;
  }>;
};

export function useScanToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { address: string; chain?: string }) => {
      const response = await apiPost<any>("/api/scoring/score-token", {
        contract_address: data.address,
        chain: data.chain || "solana",
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      if (response?.scores) {
        const normalize = (value: number) => (value > 1 ? value / 100 : value);
        return {
          rug_probability: normalize(response.scores.rug_probability ?? 0),
          rug_risk_score: normalize(response.scores.rug_risk_score ?? response.scores.rug_probability ?? 0),
          liquidity_stability: normalize(response.scores.liquidity_stability ?? 0),
          holder_distribution: normalize(response.scores.holder_distribution ?? 0),
          smart_wallet_signal: normalize(response.scores.smart_wallet_signal ?? 0),
          trade_confidence_index: normalize(response.scores.trade_confidence_index ?? 0),
          opportunity_score: normalize(response.scores.opportunity_score ?? response.scores.trade_confidence_index ?? 0),
          eligible: !!response.eligible,
          eligibility_reason: response.eligibility_reason,
          risk_flags: Array.isArray(response.risk_flags) ? response.risk_flags : [],
          status: response.status,
        } as ScoreResult;
      }

      return response as ScoreResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scoring-history"] });
    },
  });
}

export function useScanHistory(chain?: string, address?: string) {
  return useQuery({
    queryKey: ["scoring-history", chain, address],
    queryFn: () => apiGet<{ history: ScoreResult[] }>(`/api/scoring/history/${chain || "solana"}/${address || ""}`),
    enabled: !!chain && !!address,
  });
}

export function useDevIntel(contractAddress?: string, chain: string = "solana") {
  const normalizedChain = chain === "all" ? "solana" : chain;
  return useQuery({
    queryKey: ["dev-intel", normalizedChain, contractAddress],
    queryFn: () => apiGet<DevIntelResult>(`/api/wallets/dev-intel/${contractAddress}?chain=${normalizedChain}`),
    enabled: !!contractAddress,
    staleTime: 20000,
    retry: 1,
  });
}
