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
      return apiPost<ScoreResult>("/api/scoring/score-token", {
        contract_address: data.address,
        chain: data.chain || "solana",
      });
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
