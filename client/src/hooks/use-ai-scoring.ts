import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { scoringApi, type TokenScore, type TokenInsight } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export function useTokenScore(contractAddress: string, chain: string = 'solana', enabled: boolean = true) {
  return useQuery({
    queryKey: ['tokenScore', chain, contractAddress],
    queryFn: () => scoringApi.scoreToken(contractAddress, chain),
    enabled: enabled && !!contractAddress,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

export function useTokenInsight(chain: string, contractAddress: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['tokenInsight', chain, contractAddress],
    queryFn: () => scoringApi.getInsight(chain, contractAddress),
    enabled: enabled && !!contractAddress && !!chain,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}

export function useScoreToken() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ contractAddress, chain }: { contractAddress: string; chain?: string }) =>
      scoringApi.scoreToken(contractAddress, chain || 'solana'),
    onSuccess: (data, variables) => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ 
        queryKey: ['tokenScore', variables.chain || 'solana', variables.contractAddress] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['tokenInsight', variables.chain || 'solana', variables.contractAddress] 
      });
      
      toast({
        title: "Token Scored",
        description: `${data.symbol} scored successfully - Rug Risk: ${data.scores.rug_risk_score.toFixed(0)}%`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Scoring Failed",
        description: error.message || "Failed to score token",
        variant: "destructive",
      });
    },
  });
}

export interface ScoreTokenInput {
  contractAddress: string;
  chain?: string;
}
