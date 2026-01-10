import { useQuery, useMutation } from "@tanstack/react-query";
import { api, type AnalyzeSentimentRequest } from "@shared/routes";

export function useTrendingCoins() {
  return useQuery({
    queryKey: [api.memetrend.list.path],
    queryFn: async () => {
      const res = await fetch(api.memetrend.list.path);
      if (!res.ok) throw new Error('Failed to fetch trending coins');
      return api.memetrend.list.responses[200].parse(await res.json());
    },
  });
}

export function useAnalyzeSentiment() {
  return useMutation({
    mutationFn: async (data: AnalyzeSentimentRequest) => {
      const res = await fetch(api.memetrend.analyze.path, {
        method: api.memetrend.analyze.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to analyze sentiment');
      return api.memetrend.analyze.responses[200].parse(await res.json());
    },
  });
}
