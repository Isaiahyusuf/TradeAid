import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export type AssistantTradingStatus = {
  enabled: boolean;
  pending_approval: boolean;
  consent_id?: string | null;
  consent_expires_at?: string | null;
  approved_at?: string | null;
  mode: "paper" | "live";
  wallet_address?: string | null;
  wallets_by_chain?: Record<string, string>;
  enabled_chains?: string[];
  risk_limits?: {
    max_notional_usd_per_trade: number;
    max_trades_per_day: number;
    max_daily_loss_usd: number;
  };
  last_revoked_at?: string | null;
};

export type AssistantWalletStatus = {
  has_wallet: boolean;
  backup_confirmed: boolean;
  backup_confirmed_at?: string | null;
  created_at?: string | null;
  addresses_by_chain: Record<string, string>;
  enabled_chains?: string[];
};

export type AssistantWalletBundle = {
  mnemonic?: string;
  addresses_by_chain: Record<string, string>;
  private_keys_by_chain?: Record<string, string>;
  warning: string;
  reveal_confirmation_phrase?: string;
};

export type AssistantWalletKeyExport = {
  chain: string;
  address: string;
  private_key: string;
  warning: string;
};

export type AssistantWalletPortfolioChain = {
  address: string;
  native_symbol: string;
  native_balance: number | null;
  price_usd: number;
  value_usd: number;
  data_status: "ok" | "rpc_unavailable" | "unsupported" | "not_configured" | "rpc_not_configured" | "invalid_address";
};

export type AssistantWalletPortfolio = {
  chains: Record<string, AssistantWalletPortfolioChain>;
  total_usd: number;
  updated_at: string;
};

export type AssistantWalletTransaction = {
  id: string;
  chain: string;
  side: string;
  status: string;
  contract_address: string;
  notional_usd: number;
  quantity?: number | null;
  asset?: string;
  tx_hash?: string;
  explorer_url?: string;
  from_address?: string;
  to_address?: string;
  created_at?: string | null;
};

export type AssistantContextOverview = {
  window_days: number;
  summary: {
    total_trades: number;
    total_notional_usd: number;
    total_pnl_usd: number;
    chain_count: number;
  };
  chain_stats: Record<string, { trades: number; notional_usd: number; pnl_usd: number }>;
  recent_trades: Array<{
    id: string;
    chain: string;
    contract_address: string;
    side: string;
    mode: string;
    status: string;
    notional_usd: number;
    price_usd: number | null;
    fees_usd: number;
    pnl_usd: number;
    created_at: string | null;
  }>;
  market_scores: {
    by_chain: Record<string, { count: number; avg_confidence: number; avg_rug_probability: number }>;
    samples: number;
  };
  confidence_calibration: {
    mode?: string;
    half_life_days?: number;
    global_bias: number;
    lookback_trades: number;
    generated_at?: string;
    by_chain: Record<string, {
      trades: number;
      wins: number;
      losses: number;
      win_rate: number;
      pnl_usd: number;
      weighted_pnl_usd?: number;
      pnl_per_trade_usd: number;
      pnl_yield: number;
      sample_weight: number;
      weighted_trade_mass?: number;
      confidence_bias: number;
      status: "outperforming" | "underperforming" | "neutral";
    }>;
  };
};

export function useAssistantTradingStatus() {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["ai-trading-status"],
    queryFn: () => apiGet<{ trading: AssistantTradingStatus }>("/api/ai/trading/status"),
    enabled: hasToken,
    retry: 1,
  });
}

export function useAssistantWalletStatus() {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["ai-wallet-status"],
    queryFn: () => apiGet<{ wallet: AssistantWalletStatus }>("/api/ai/wallets/status"),
    enabled: hasToken,
    retry: 1,
  });
}

export function useAssistantWalletPortfolio() {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["ai-wallet-portfolio"],
    queryFn: () => apiGet<{ wallet: AssistantWalletStatus; portfolio: AssistantWalletPortfolio }>("/api/ai/wallets/portfolio"),
    enabled: hasToken,
    retry: 1,
    refetchInterval: 30_000,
  });
}

export function useAssistantWalletTransactions(limit: number = 25) {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["ai-wallet-transactions", limit],
    queryFn: () => apiGet<{ transactions: AssistantWalletTransaction[]; count: number }>(`/api/ai/wallets/transactions?limit=${limit}`),
    enabled: hasToken,
    retry: 1,
    refetchInterval: 20_000,
  });
}

export function useCreateAssistantWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { overwrite?: boolean }) =>
      apiPost<{ wallet: AssistantWalletStatus; bundle: AssistantWalletBundle }>("/api/ai/wallets/create", payload || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-trading-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
    },
  });
}

export function useConfirmAssistantWalletBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { mnemonic: string }) =>
      apiPost<{ wallet: AssistantWalletStatus }>("/api/ai/wallets/confirm-backup", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
    },
  });
}

export function useRevealAssistantWallet() {
  return useMutation({
    mutationFn: async (payload: { confirmation_text: string }) =>
      apiPost<{ wallet: AssistantWalletStatus; bundle: AssistantWalletBundle }>("/api/ai/wallets/reveal", payload),
  });
}

export function useImportAssistantWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { mnemonic: string; overwrite?: boolean }) =>
      apiPost<{ wallet: AssistantWalletStatus; bundle: AssistantWalletBundle }>("/api/ai/wallets/import", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-trading-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
    },
  });
}

export function useRemoveAssistantWalletChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { chain: string }) =>
      apiPost<{ wallet: AssistantWalletStatus; trading: AssistantTradingStatus }>("/api/ai/wallets/remove-chain", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-trading-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
    },
  });
}

export function useExportAssistantWalletKey() {
  return useMutation({
    mutationFn: async (payload: { chain: string; confirmation_text: string }) =>
      apiPost<{ wallet_key: AssistantWalletKeyExport }>("/api/ai/wallets/export-key", payload),
  });
}

export function useTransferAssistantWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { chain: string; recipient_address: string; amount: number; asset: string }) =>
      apiPost<{ transfer: { transaction_id: string; tx_hash: string; explorer_url: string; status: string } }>("/api/ai/wallets/transfer", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["ai-context-overview"] });
    },
  });
}

export function useRequestAssistantConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      wallet_address?: string;
      wallets_by_chain?: Record<string, string>;
      mode: "paper" | "live";
      risk_limits?: {
        max_notional_usd_per_trade?: number;
        max_trades_per_day?: number;
        max_daily_loss_usd?: number;
      };
    }) => apiPost("/api/ai/trading/consent/request", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-trading-status"] });
    },
  });
}

export function useApproveAssistantConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { consent_id: string; confirmation_text: string }) =>
      apiPost("/api/ai/trading/consent/approve", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-trading-status"] });
    },
  });
}

export function useRevokeAssistantConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => apiPost("/api/ai/trading/consent/revoke"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-trading-status"] });
    },
  });
}

export function useExecuteAssistantTrade() {
  return useMutation({
    mutationFn: async (payload: {
      chain: string;
      contract_address: string;
      side: "buy" | "sell";
      notional_usd: number;
      mode?: "paper" | "live";
      decision_context?: Record<string, unknown>;
    }) => apiPost("/api/ai/trading/execute", payload),
  });
}

export function useAssistantContextOverview(days: number = 30) {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["ai-context-overview", days],
    queryFn: () => apiGet<{ context: AssistantContextOverview; user_id: string }>(`/api/ai/context/overview?days=${days}`),
    enabled: hasToken,
    retry: 1,
  });
}

export function useAskAssistant() {
  return useMutation({
    mutationFn: async (payload: { question: string; context?: Record<string, unknown> }) =>
      apiPost<{ assistant: { answer: string; key_points: string[]; source: string } }>("/api/ai/ask", payload),
  });
}

export function useAssistDecision() {
  return useMutation({
    mutationFn: async (payload: {
      market: Record<string, unknown>;
      risk?: {
        max_risk_per_trade_pct?: number;
        max_daily_loss_pct?: number;
        max_trades_per_day?: number;
      };
      mode?: "paper" | "live";
    }) => apiPost<{ assistant: Record<string, unknown> }>("/api/ai/assist", payload),
  });
}
