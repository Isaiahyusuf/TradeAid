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
  tokens_value_usd?: number;
  spl_tokens?: Array<{
    mint: string;
    symbol: string;
    ui_amount: number;
    amount_raw: string;
    decimals: number;
    price_usd: number;
    value_usd: number;
  }>;
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
  source?: "assistant" | "onchain" | string;
  contract_address: string;
  notional_usd: number;
  quantity?: number | null;
  quantity_unit?: string;
  asset?: string;
  token_symbol?: string;
  worth_sol?: number;
  tx_hash?: string;
  explorer_url?: string;
  from_address?: string;
  to_address?: string;
  confirmation_status?: string;
  created_at?: string | null;
};

export type AssistantProfitJarStatus = {
  enabled: boolean;
  allocation_pct: number;
  reserve_sol: number;
  min_transfer_sol: number;
  wallet_address?: string;
  wallet_created: boolean;
  wallet_balance_sol?: number;
  wallet_balance_usd?: number;
  wallet_balance_state?: "ok" | "not_created" | "unavailable" | string;
  wallet_balance_updated_at?: string;
  total_swept_usd: number;
  total_swept_sol: number;
  pending_count: number;
  failed_count: number;
  ledger_count: number;
};

export type AssistantProfitJarLedgerRow = {
  id: string;
  type: "sweep" | "withdraw" | string;
  status: "queued" | "submitted" | "confirmed" | "failed" | string;
  source_trade_id?: string | null;
  source_side?: "buy" | "sell" | string | null;
  source_token_mint?: string | null;
  source_realized_profit_usd?: number;
  transfer_amount_sol?: number;
  transfer_amount_usd?: number;
  tx_hash?: string | null;
  explorer_url?: string | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
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
  const { hasToken, user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-trading-status", userScope],
    queryFn: () => apiGet<{ trading: AssistantTradingStatus }>("/api/ai/trading/status"),
    enabled: hasToken,
    retry: 1,
    refetchInterval: hasToken ? 5_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAssistantWalletStatus() {
  const { hasToken, user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-wallet-status", userScope],
    queryFn: () => apiGet<{ wallet: AssistantWalletStatus }>("/api/ai/wallets/status"),
    enabled: hasToken,
    retry: 1,
    refetchInterval: hasToken ? 4_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAssistantWalletPortfolio() {
  const { hasToken, user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-wallet-portfolio", userScope],
    queryFn: () => apiGet<{ wallet: AssistantWalletStatus; portfolio: AssistantWalletPortfolio }>("/api/ai/wallets/portfolio"),
    enabled: hasToken,
    retry: 1,
    refetchInterval: hasToken ? 4_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAssistantWalletTransactions(limit: number = 25, enabled = true) {
  const { hasToken, user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-wallet-transactions", userScope, limit],
    queryFn: () => apiGet<{ transactions: AssistantWalletTransaction[]; count: number }>(`/api/ai/wallets/transactions?limit=${limit}`),
    enabled: hasToken && enabled,
    retry: 1,
    refetchInterval: hasToken && enabled ? 4_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAssistantProfitJarStatus(enabled = true) {
  const { hasToken, user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-profit-jar-status", userScope],
    queryFn: () => apiGet<{ profit_jar: AssistantProfitJarStatus }>("/api/ai/profit-jar/status"),
    enabled: hasToken && enabled,
    retry: 1,
    refetchInterval: hasToken && enabled ? 4_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAssistantProfitJarLedger(limit = 50, enabled = true) {
  const { hasToken, user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-profit-jar-ledger", userScope, limit],
    queryFn: () => apiGet<{ ledger: AssistantProfitJarLedgerRow[]; count: number }>(`/api/ai/profit-jar/ledger?limit=${limit}`),
    enabled: hasToken && enabled,
    retry: 1,
    refetchInterval: hasToken && enabled ? 5_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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
    mutationFn: async () =>
      apiPost<{ wallet: AssistantWalletStatus }>("/api/ai/wallets/confirm-backup", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
    },
  });
}

export function useRevealAssistantWallet() {
  return useMutation({
    mutationFn: async () =>
      apiPost<{ wallet: AssistantWalletStatus; bundle: AssistantWalletBundle }>("/api/ai/wallets/reveal", {}),
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

export function useImportAssistantWalletPrivateKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { private_key: string; overwrite?: boolean }) =>
      apiPost<{ wallet: AssistantWalletStatus; bundle: AssistantWalletBundle }>("/api/ai/wallets/import-private-key", payload),
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

export function useDeleteAssistantWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiPost<{ ok: boolean; wallet: AssistantWalletStatus; trading: AssistantTradingStatus; message: string }>("/api/ai/wallets/delete", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-trading-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["ai-context-overview"] });
    },
  });
}

export function useExportAssistantWalletKey() {
  return useMutation({
    mutationFn: async (payload: { chain: string }) =>
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

export function useCreateAssistantProfitJarWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { overwrite?: boolean }) =>
      apiPost<{ profit_jar: AssistantProfitJarStatus }>("/api/ai/profit-jar/wallet/create", payload || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-ledger"] });
    },
  });
}

export function useImportAssistantProfitJarWalletPrivateKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { private_key: string; overwrite?: boolean }) =>
      apiPost<{ profit_jar: AssistantProfitJarStatus }>("/api/ai/profit-jar/wallet/import-private-key", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-ledger"] });
    },
  });
}

export function useExportAssistantProfitJarWalletKey() {
  return useMutation({
    mutationFn: async () =>
      apiPost<{ wallet_key: AssistantWalletKeyExport }>("/api/ai/profit-jar/wallet/export-key", {}),
  });
}

export function useDeleteAssistantProfitJarWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiPost<{ ok: boolean; message: string; profit_jar: AssistantProfitJarStatus }>("/api/ai/profit-jar/wallet/delete", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-ledger"] });
    },
  });
}

export function useUpdateAssistantProfitJarSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      enabled: boolean;
      allocation_pct: number;
      reserve_sol: number;
      min_transfer_sol: number;
    }) => apiPost<{ profit_jar: AssistantProfitJarStatus }>("/api/ai/profit-jar/settings", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-ledger"] });
    },
  });
}

export function useWithdrawAssistantProfitJar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { recipient_address: string; amount_sol: number }) =>
      apiPost<{ withdraw: { tx_hash: string; explorer_url: string; amount_sol: number }; profit_jar: AssistantProfitJarStatus }>("/api/ai/profit-jar/withdraw", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-profit-jar-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
    },
  });
}

export function useAssistantWalletSwap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      side: "buy" | "sell";
      token_mint: string;
      notional_usd?: number;
      amount_sol?: number;
      sell_token_amount?: number;
      sell_all?: boolean;
      mode?: "paper" | "live";
    }) => apiPost<{ trade: { id: string; chain: string; mode: string; side: string; status: string; tx_hash: string; explorer_url: string } }>("/api/ai/wallets/swap", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["ai-context-overview"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
    },
  });
}

export function useAssistantWalletBurn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      token_mint: string;
      amount_tokens?: number;
      symbol?: string;
      value_usd?: number;
    }) => apiPost<{
      burn: {
        tx_hash: string;
        explorer_url: string;
        status: string;
        token_mint: string;
        amount_tokens: number;
      };
    }>("/api/ai/wallets/burn", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["ai-context-overview"] });
      queryClient.invalidateQueries({ queryKey: ["ai-wallet-status"] });
    },
  });
}

export function useAssistantWalletSwapQuote(
  params: {
    side: "buy" | "sell";
    token_mint: string;
    amount_sol: number;
  },
  enabled = true,
) {
  const { user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-wallet-swap-quote", userScope, params.side, params.token_mint, params.amount_sol],
    queryFn: () => apiPost<{
      quote: {
        side: string;
        input_mint: string;
        output_mint: string;
        input_amount_sol: number;
        output_amount_tokens: number;
        output_amount_raw: string;
        output_decimals: number;
        price_impact_pct: number;
        route_count: number;
      };
    }>("/api/ai/wallets/swap-quote", params),
    enabled,
    staleTime: 10_000,
    refetchInterval: false,
    retry: 1,
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

export function useAssistantContextOverview(days: number = 30, enabled = true) {
  const { hasToken, user } = useAuth();
  const userScope = String(user?.user_id || "anonymous").trim();
  return useQuery({
    queryKey: ["ai-context-overview", userScope, days],
    queryFn: () => apiGet<{ context: AssistantContextOverview; user_id: string }>(`/api/ai/context/overview?days=${days}`),
    enabled: hasToken && enabled,
    retry: 1,
    refetchInterval: hasToken && enabled ? 5_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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
