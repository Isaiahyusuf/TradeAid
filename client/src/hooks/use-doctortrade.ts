import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const DOCTOR_STATUS_CACHE_KEY = "doctortrade:status:snapshot:v1";

export type DoctorToken = {
  symbol: string;
  address: string;
  liquidity: number;
  volume_5m: number;
  score: number;
  price_usd?: number;
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
  };
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
    live_sell_fraction_pct?: number;
    max_sell_notional_usd?: number;
    wallet_connected: boolean;
  };
  active_tokens: DoctorToken[];
  positions: DoctorPosition[];
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
  const { hasToken } = useAuth();

    // Cloud sync: always fetch from backend, no localStorage fallback
    const readCached = (): DoctorStatus | undefined => undefined;

  return useQuery({
    queryKey: ["doctortrade", "status"],
    queryFn: async () => {
      const payload = await apiGet<DoctorStatus>("/api/doctor/status");
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(DOCTOR_STATUS_CACHE_KEY, JSON.stringify(payload));
        } catch {
        }
      }
      return payload;
    },
    initialData: readCached,
    enabled: hasToken,
    placeholderData: (previousData) => previousData,
    staleTime: 5000,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
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
      live_sell_fraction_pct?: number;
      max_sell_notional_usd?: number;
    }) => apiPost<DoctorStatus>("/api/doctor/config", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctortrade"] }),
  });
}

export type DoctorHealth = {
  ok: boolean;
  service: string;
  version: string;
  features?: Record<string, boolean>;
};

export function useDoctorHealth() {
  const { hasToken } = useAuth();
  return useQuery({
    queryKey: ["doctortrade", "health"],
    queryFn: () => apiGet<DoctorHealth>("/api/doctor/health"),
    enabled: hasToken,
    staleTime: 30000,
    retry: 1,
  });
}

export function useDoctorConnectWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload?: { private_key?: string; public_address?: string; use_existing_wallet?: boolean }) =>
      apiPost<DoctorStatus>("/api/doctor/connect-wallet", payload || { use_existing_wallet: true }),
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
