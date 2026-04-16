import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export type AIInsight = {
  summary: string;
  risk_level: string;
  momentum_analysis: string;
  recommendation: string;
  confidence_score: number;
  source?: string;
  generated_at?: string;
};

export function useAIInsight(chain: string | null, contractAddress: string | null) {
  return useQuery({
    queryKey: ["ai-insight", chain, contractAddress],
    queryFn: () => apiGet<{ token: { contract_address: string; symbol: string; chain: string }; insight: AIInsight }>(`/api/scoring/insight/${chain}/${contractAddress}`),
    enabled: !!chain && !!contractAddress,
    staleTime: 120000,
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
