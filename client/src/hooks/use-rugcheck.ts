import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiGet } from "@/lib/api";

export type ScoreResult = {
  rug_probability: number;
  liquidity_stability: number;
  holder_distribution: number;
  smart_wallet_signal: number;
  trade_confidence_index: number;
  eligible: boolean;
  eligibility_reason?: string;
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
          liquidity_stability: normalize(response.scores.liquidity_stability ?? 0),
          holder_distribution: normalize(response.scores.holder_distribution ?? 0),
          smart_wallet_signal: normalize(response.scores.smart_wallet_signal ?? 0),
          trade_confidence_index: normalize(response.scores.trade_confidence_index ?? 0),
          eligible: !!response.eligible,
          eligibility_reason: response.eligibility_reason,
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
