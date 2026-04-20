import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiGet, apiPost } from "@/lib/api";

export type DoctorToken = {
  symbol: string;
  address: string;
  liquidity: number;
  volume_5m: number;
  score: number;
  price_usd?: number;
  eligible?: boolean;
  safety_tier?: "strict" | "soft" | string;
  reject_reasons?: string[];
};

export type DoctorPosition = {
  symbol: string;
  address: string;
  entry_price: number;
  current_price: number;
  liquidity: number;
  confidence: number;
  size_pct: number;
  risk_status: string;
  trailing_stop_pct?: number;
  pnl_pct?: number;
  worth_usd?: number;
};

export type DoctorRecentTrade = {
  token?: string;
  address?: string;
  action?: string;
  status?: string;
  reason?: string;
  confidence?: number;
  liquidity?: number;
  volume_5m?: number;
  size_pct?: number;
  timestamp?: string;
};

export type DoctorDecisionJournalRow = {
  token?: string;
  address?: string;
  decision?: string;
  reason?: string;
  confidence?: number;
  size_pct?: number;
  strategy_mode?: string;
  ml_learned_bonus?: number;
  ml_size_multiplier?: number;
  timestamp?: string;
};

export type DoctorStatus = {
  trading_mode?: "doctor" | "retardio" | string;
  user_id?: string | null;
  api_target?: string | null;
  enabled: boolean;
  kill_switch: boolean;
  scan_interval_seconds?: number;
  last_run_at?: string | null;
  last_error?: string | null;
  risk_state: {
    drawdown_pct: number;
    daily_realized_pnl_usd: number;
    high_watermark_usd: number;
    open_positions: number;
    open_exposure_pct: number;
    consecutive_losses: number;
    paused: boolean;
    permanent_lock: boolean;
    pause_reason?: string | null;
  };
  wallet: {
    address: string;
    balance_sol: number;
    balance_stale?: boolean;
    separate_wallet_enforced: boolean;
    private_key_configured?: boolean;
    connection_status?: "connected" | "disconnected" | string;
  };
  execution?: {
    mode?: "paper" | "live" | string;
    live_only?: boolean;
    live_capable?: boolean;
    raydium_route_enabled?: boolean;
    jupiter_quote_enabled?: boolean;
    base_asset_mint?: string;
  };
  auto_trade?: {
    blocked?: boolean;
    block_reason?: string | null;
  };
  discovery?: {
    dexscreener_primary?: boolean;
    poll_interval_seconds?: number;
    worker_running?: boolean;
    last_poll_at?: string | null;
    processed_mints?: number;
  };
  sniper_logs?: Array<{
    at?: string;
    event?: string;
    source?: string;
    symbol?: string;
    token?: string;
    mint?: string;
    address?: string;
    pair_address?: string;
    reason?: string;
    preset?: string;
    age_seconds?: number;
    liquidity_sol?: number;
    volume_5m_sol?: number;
    buys_5m?: number;
    sells_5m?: number;
    ai_confidence?: number;
    available_sol?: number;
    required_sol?: number;
    estimated_fee_sol?: number;
  }>;
  trade_controls?: {
    trading_mode?: "doctor" | "retardio" | string;
    retardio?: {
      enabled?: boolean;
      score_threshold?: number;
      max_trades_per_hour?: number;
      min_hold_seconds?: number;
      take_profit_pct?: number;
      stop_loss_pct?: number;
    };
    max_trades_per_day: number;
    trades_today: number;
    min_buy_amount_sol: number;
    buy_amount_sol: number;
    take_profit_multiplier: number;
    min_profit_pct: number;
    stop_loss_pct: number;
    trailing_stop_pct: number;
    min_liquidity_usd?: number;
    max_slippage_pct?: number;
    max_spread_pct?: number;
    daily_loss_limit_usd?: number;
    max_consecutive_losses?: number;
    strong_move_threshold_pct?: number;
    max_hold_minutes?: number;
    min_momentum_profit_pct?: number;
    quality_min_volume_spike_pct?: number;
    quality_max_top_holder_pct?: number;
    min_liquidity_sol?: number;
    max_liquidity_sol?: number;
    min_buys_5m?: number;
    max_sells_5m?: number;
    max_token_age_seconds?: number;
    min_freshness_score?: number;
    allowed_first_seen_sources?: string;
    gas_priority_lamports?: number;
    live_sell_fraction_pct?: number;
    max_sell_notional_usd?: number;
    ml_learning_enabled?: boolean;
    ml_min_closed_trades?: number;
    ml_lookback_trades?: number;
    ml_bonus_cap_score?: number;
    ml_size_min_multiplier?: number;
    ml_size_max_multiplier?: number;
    wallet_connected: boolean;
  };
  mate?: {
    enabled?: boolean;
    best_agent?: string;
    regime?: string;
    confidence?: number;
    scores?: Record<string, number>;
  };
  active_tokens: DoctorToken[];
  positions: DoctorPosition[];
  wallet_tokens?: Array<{
    mint: string;
    ui_amount: number;
    amount_raw?: string;
    decimals?: number;
    symbol?: string;
    name?: string;
    logo_url?: string;
    price_usd?: number;
    worth_usd?: number;
  }>;
  wallet_transactions?: Array<{
    signature: string;
    block_time?: string | null;
    err?: unknown;
    memo?: string | null;
    confirmation_status?: string;
    explorer_url?: string | null;
  }>;
  recent_trades: DoctorRecentTrade[];
  decision_journal?: DoctorDecisionJournalRow[];
  performance?: Array<Record<string, any>>;
  tuning_suggestion?: string | null;
  strategy_mode?: string;
  safety?: {
    api_error_count: number;
    paused: boolean;
    pause_reason?: string | null;
  };
  self_evolution?: {
    cycles: number;
    last_updated_at?: string | null;
    learning?: {
      enabled?: boolean;
      closed_trades?: number;
      trained?: boolean;
      win_rate?: number;
      avg_pnl_pct?: number;
      adaptive_confidence_delta?: number;
      size_multiplier?: number;
      win_profile?: {
        confidence?: number;
        volume_5m?: number;
        liquidity?: number;
      };
      loss_profile?: {
        confidence?: number;
        volume_5m?: number;
        liquidity?: number;
      };
      last_trained_at?: string | null;
    };
  };
  auto_agent?: {
    enabled?: boolean;
    no_snipe_timeout_minutes?: number;
    no_snipe_for_minutes?: number | null;
    last_successful_buy_at?: string | null;
    last_rotate_at?: string | null;
    last_from_preset?: string | null;
    last_to_preset?: string | null;
    last_reason?: string | null;
  };
  fresh_feed?: {
    last_cycle_at?: string | null;
    detected?: number;
    enriched?: number;
    approved?: number;
    rejected?: number;
  };
  scanner_health?: {
    overall?: {
      calls?: number;
      success?: number;
      errors?: number;
      success_rate_pct?: number;
    };
  };
  scanner_ingestion?: {
    tracked_mints?: number;
    pending_launches?: number;
    source_counts?: Array<{ source?: string; count?: number }>;
    watchers?: Array<{ label?: string; programId?: string }>;
    generated_at?: string;
  };
};

export type DoctorScannerIngestionDebug = {
  runtime?: {
    trackedMintCount?: number;
    pendingPumpLaunches?: number;
    sourceCounts?: Array<{ source?: string; count?: number }>;
    additionalProgramWatchers?: Array<{ label?: string; programId?: string }>;
    recentMints?: Array<{
      mint?: string;
      firstSeenAt?: string;
      firstSeenBy?: string;
      bestSource?: string;
      bestWeight?: number;
    }>;
    generatedAt?: string;
  };
  recentTokens?: Array<{
    id?: string;
    address?: string;
    symbol?: string;
    dexId?: string;
    createdAt?: string | null;
    firstSeenAt?: string | null;
    firstSeenSource?: string | null;
    bestSource?: string | null;
    sourceWeight?: number | null;
    freshnessScore?: number | null;
  }>;
  dbWarning?: string | null;
};

export function useDoctorStatus() {
  return useQuery({
    queryKey: ["doctortrade", "status"],
    queryFn: async () => apiGet<DoctorStatus>("/api/doctor/status"),
    enabled: true,
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    notifyOnChangeProps: ["data", "error"],
    retry: 1,
  });
}

export function useDoctorControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => apiPost<DoctorStatus>("/api/doctor/control", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export function useDoctorConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      trading_mode?: "doctor" | "retardio";
      scan_interval_seconds?: number;
      kill_switch?: boolean;
      buy_amount_sol?: number;
      max_trades_per_day?: number;
      take_profit_multiplier?: number;
      min_profit_pct?: number;
      stop_loss_pct?: number;
      trailing_stop_pct?: number;
      min_liquidity_usd?: number;
      max_slippage_pct?: number;
      max_spread_pct?: number;
      daily_loss_limit_usd?: number;
      max_consecutive_losses?: number;
      strong_move_threshold_pct?: number;
      max_hold_minutes?: number;
      min_momentum_profit_pct?: number;
      quality_min_volume_spike_pct?: number;
      quality_max_top_holder_pct?: number;
      min_freshness_score?: number;
      allowed_first_seen_sources?: string;
      gas_priority_lamports?: number;
      live_sell_fraction_pct?: number;
      max_sell_notional_usd?: number;
      ml_learning_enabled?: boolean;
      ml_min_closed_trades?: number;
      ml_lookback_trades?: number;
      ml_bonus_cap_score?: number;
      ml_size_min_multiplier?: number;
      ml_size_max_multiplier?: number;
    }) => apiPost<DoctorStatus>("/api/doctor/config", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export function useDoctorResetLearning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<DoctorStatus>("/api/doctor/learning/reset", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export type DoctorAiAssistantResponse = {
  ok: boolean;
  advisor: {
    market_state?: string;
    confidence_score?: number;
    reason?: string;
  };
  assistant_name?: string;
  user_name?: string;
  memory_count?: number;
  chat: {
    answer: string;
    model: string;
    generated_at: string;
    risk_notice: string;
  };
};

export type DoctorAiAssistantHistoryMessage = {
  role: "user" | "assistant";
  text: string;
  at?: string;
};

export type DoctorAiAssistantHistoryResponse = {
  ok: boolean;
  assistant_name: string;
  user_name: string;
  messages: DoctorAiAssistantHistoryMessage[];
};

export function useDoctorAiAssistantChat() {
  return useMutation({
    mutationFn: (payload: { message: string }) => apiPost<DoctorAiAssistantResponse>("/api/doctor/ai-assistant-chat", payload),
  });
}

export function useDoctorAiAssistantHistory() {
  return useQuery({
    queryKey: ["doctortrade", "ai-assistant-history"],
    queryFn: () => apiGet<DoctorAiAssistantHistoryResponse>("/api/doctor/ai-assistant-history"),
    enabled: true,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useDoctorAiAssistantClearHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<DoctorAiAssistantHistoryResponse>("/api/doctor/ai-assistant-history", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade", "ai-assistant-history"] }),
  });
}

export type DoctorHealth = {
  ok: boolean;
  service: string;
  version: string;
  features?: Record<string, boolean>;
};

export type DoctorTickerItem = {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  price_usd: number;
  liquidity_usd: number;
  volume_5m_usd: number;
  age_minutes: number;
  signal: string;
  signal_prefix: string;
  source: string;
  chart_url?: string;
  message: string;
  created_at: string;
};

export function useDoctorTicker(limit = 24) {
  return useQuery({
    queryKey: ["doctortrade", "ticker", limit],
    queryFn: () => apiGet<{ ok: boolean; items: DoctorTickerItem[]; as_of: string }>(`/api/doctor/ticker?limit=${limit}`),
    enabled: true,
    staleTime: 12_000,
    refetchInterval: 12_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useDoctorScannerIngestionDebug(limit = 12) {
  return useQuery({
    queryKey: ["doctortrade", "scanner-ingestion-debug", limit],
    queryFn: () => apiGet<DoctorScannerIngestionDebug>(`/api/scanner/ingestion-debug?limit=${limit}`),
    enabled: true,
    staleTime: 12_000,
    refetchInterval: 12_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useDoctorHealth() {
  return useQuery({
    queryKey: ["doctortrade", "health"],
    queryFn: () => apiGet<DoctorHealth>("/api/doctor/health"),
    enabled: true,
    staleTime: 30000,
    retry: 1,
  });
}

export function useDoctorConnectWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload?: { private_key?: string; public_address?: string; use_existing_wallet?: boolean }) =>
      apiFetch<DoctorStatus>("/api/doctor/connect-wallet", {
        method: "POST",
        body: JSON.stringify(payload || {}),
        timeoutMs: 120_000,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export function useDoctorCreateAppWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ wallet?: { has_wallet?: boolean } }>("/api/ai/wallets/create", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export function useDoctorDisconnectWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<DoctorStatus>("/api/doctor/disconnect-wallet", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export function useDoctorRunOnce() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost("/api/doctor/run-once", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export function useDoctorDirectBuy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { contract_address: string; chain?: string }) =>
      apiPost<{ result: { executed: boolean; reason?: string; signature?: string; buy_amount_sol?: number } }>("/api/doctor/direct-buy", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export function useDoctorDirectSell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { contract_address: string; sell_fraction_pct?: number }) =>
      apiPost<{ result: { executed: boolean; reason?: string; signature?: string; sold_amount_sol?: number; remaining_amount_sol?: number } }>("/api/doctor/direct-sell", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}
