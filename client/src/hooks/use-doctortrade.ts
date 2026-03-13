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
  timestamp?: string;
};

export type DoctorStatus = {
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
    mint?: string;
    reason?: string;
    preset?: string;
    available_sol?: number;
    required_sol?: number;
    estimated_fee_sol?: number;
  }>;
  trade_controls?: {
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
    gas_priority_lamports?: number;
    live_sell_fraction_pct?: number;
    max_sell_notional_usd?: number;
    snipe_preset?: "conservative" | "momentum_trader" | "balanced" | "aggressive" | "insider" | "in_out_2x" | "custom" | string;
    wallet_connected: boolean;
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
};

export function useDoctorStatus() {
  return useQuery({
    queryKey: ["doctortrade", "status"],
    queryFn: async () => apiGet<DoctorStatus>("/api/doctor/status"),
    enabled: true,
    staleTime: 2000,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    notifyOnChangeProps: ["data", "error"],
    retry: 2,
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
      gas_priority_lamports?: number;
      live_sell_fraction_pct?: number;
      max_sell_notional_usd?: number;
      snipe_preset?: "conservative" | "momentum_trader" | "balanced" | "aggressive" | "insider" | "custom" | string;
    }) => apiPost<DoctorStatus>("/api/doctor/config", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export type DoctorAdvisorMetrics = {
  avg_market_cap_new_tokens: number;
  avg_liquidity: number;
  avg_volume_5m: number;
  avg_price_change_5m: number;
  launch_frequency: number;
  buy_sell_ratio: number;
  rug_rate_last_hour: number;
  top_gainers: Array<{
    symbol: string;
    address: string;
    price_change_5m: number;
    volume_5m: number;
    liquidity: number;
  }>;
};

export type DoctorAdvisor = {
  ok: boolean;
  market_state: "HIGH_FOMO" | "MODERATE_MOMENTUM" | "LOW_VOLUME" | "RUG_HEAVY" | "SIDEWAYS_MARKET" | string;
  recommended_preset: string;
  confidence_score: number;
  reason: string;
  metrics: DoctorAdvisorMetrics;
  updated_at: string;
};

export type DoctorAiAssistantResponse = {
  ok: boolean;
  advisor: Omit<DoctorAdvisor, "ok">;
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

export function useDoctorPresetAdvisor() {
  return useQuery({
    queryKey: ["doctortrade", "advisor"],
    queryFn: () => apiGet<DoctorAdvisor>("/api/doctor/advisor"),
    enabled: true,
    staleTime: 10_000,
    refetchInterval: 45_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useDoctorAiAssistantChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { message: string }) => apiPost<DoctorAiAssistantResponse>("/api/doctor/ai-assistant-chat", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade", "ai-assistant-history"] }),
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
    staleTime: 1_000,
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
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
    mutationFn: (payload?: { private_key?: string; public_address?: string }) =>
      apiPost<DoctorStatus>("/api/doctor/connect-wallet", payload || {}),
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
