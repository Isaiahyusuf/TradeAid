import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

export type DeveloperProfile = {
  wallet_address: string;
  chain: string;
  wallet_age_days: number;
  total_tokens_launched: number;
  total_rugs: number;
  rug_percentage: number;
  dev_risk_index: number;
};

export type TraderProfile = {
  wallet_address: string;
  chain: string;
  total_trades: number;
  profitable_trades: number;
  win_rate: number;
  is_smart_wallet: boolean;
  total_volume_usd: number;
  pnl_usd: number;
  trader_risk_index: number;
};

export function useDeveloperProfile(walletAddress: string) {
  return useQuery({
    queryKey: ["developer", walletAddress],
    queryFn: () => apiGet<DeveloperProfile>(`/api/wallets/developer/${walletAddress}`),
    enabled: !!walletAddress,
  });
}

export function useTraderProfile(walletAddress: string) {
  return useQuery({
    queryKey: ["trader", walletAddress],
    queryFn: () => apiGet<TraderProfile>(`/api/wallets/trader/${walletAddress}`),
    enabled: !!walletAddress,
  });
}

export function useWalletCluster(walletAddress: string) {
  return useQuery({
    queryKey: ["cluster", walletAddress],
    queryFn: () => apiGet(`/api/wallets/cluster/${walletAddress}`),
    enabled: !!walletAddress,
  });
}

export function useAnalyzeDeveloper() {
  return useMutation({
    mutationFn: async (data: { wallet_address: string; chain?: string }) => {
      return apiPost(`/api/wallets/developer/${data.wallet_address}/analyze?chain=${data.chain || "solana"}`);
    },
  });
}

export function useAnalyzeTrader() {
  return useMutation({
    mutationFn: async (data: { wallet_address: string; chain?: string }) => {
      return apiPost(`/api/wallets/trader/${data.wallet_address}/analyze?chain=${data.chain || "solana"}`);
    },
  });
}
