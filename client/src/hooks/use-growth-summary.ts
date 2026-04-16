import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export type GrowthCandidate = {
  symbol: string;
  address: string;
  chain: string;
  safety_score: number;
  liquidity_usd: number;
  rationale: string;
};

export type GrowthSummary = {
  ok: boolean;
  generated_at: string;
  candidates: GrowthCandidate[];
  risk_mix: {
    low: number;
    medium: number;
    high: number;
  };
  recommendations: string[];
};

export function useGrowthSummary() {
  return useQuery({
    queryKey: ["growth-summary"],
    queryFn: () => apiGet<GrowthSummary>("/api/growth/summary"),
    staleTime: 120000,
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    enabled: true,
    retry: 1,
  });
}
