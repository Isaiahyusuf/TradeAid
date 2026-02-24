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

  const readCached = (): DoctorStatus | undefined => {
    if (typeof window === "undefined") return undefined;
    try {
      const raw = window.localStorage.getItem(DOCTOR_STATUS_CACHE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Partial<DoctorStatus>;
      if (!parsed || typeof parsed !== "object") {
        window.localStorage.removeItem(DOCTOR_STATUS_CACHE_KEY);
        return undefined;
      }
      if (typeof parsed.enabled !== "boolean") {
        window.localStorage.removeItem(DOCTOR_STATUS_CACHE_KEY);
        return undefined;
      }
      const tradeControls =
        parsed.trade_controls && typeof parsed.trade_controls === "object"
          ? {
              max_trades_per_day: Number((parsed.trade_controls as any).max_trades_per_day || 12),
              trades_today: Number((parsed.trade_controls as any).trades_today || 0),
              min_buy_amount_sol: Number((parsed.trade_controls as any).min_buy_amount_sol || 0.1),
              buy_amount_sol: Number((parsed.trade_controls as any).buy_amount_sol || 0.1),
              take_profit_multiplier: Number((parsed.trade_controls as any).take_profit_multiplier || 2),
              min_profit_pct: Number((parsed.trade_controls as any).min_profit_pct || 12),
              stop_loss_pct: Number((parsed.trade_controls as any).stop_loss_pct || 6),
              trailing_stop_pct: Number((parsed.trade_controls as any).trailing_stop_pct || 10),
              min_liquidity_usd: Number((parsed.trade_controls as any).min_liquidity_usd || 20000),
              max_slippage_pct: Number((parsed.trade_controls as any).max_slippage_pct || 4),
              max_spread_pct: Number((parsed.trade_controls as any).max_spread_pct || 3),
              daily_loss_limit_usd: Number((parsed.trade_controls as any).daily_loss_limit_usd || 600),
              max_consecutive_losses: Number((parsed.trade_controls as any).max_consecutive_losses || 3),
              strong_move_threshold_pct: Number((parsed.trade_controls as any).strong_move_threshold_pct || 40),
              max_hold_minutes: Number((parsed.trade_controls as any).max_hold_minutes || 180),
              min_momentum_profit_pct: Number((parsed.trade_controls as any).min_momentum_profit_pct || 4),
              quality_min_volume_spike_pct: Number((parsed.trade_controls as any).quality_min_volume_spike_pct || 12),
              quality_max_top_holder_pct: Number((parsed.trade_controls as any).quality_max_top_holder_pct || 35),
              wallet_connected: Boolean((parsed.trade_controls as any).wallet_connected),
            }
          : undefined;

      const activeTokens = Array.isArray(parsed.active_tokens)
        ? parsed.active_tokens
            .filter((item) => Boolean(item) && typeof item === "object")
            .map((item) => item as Record<string, unknown>)
            .map((item) => ({
              symbol: String(item.symbol || "UNKNOWN"),
              address: String(item.address || ""),
              liquidity: Number(item.liquidity || 0),
              volume_5m: Number(item.volume_5m || 0),
              score: Number(item.score || 0),
              price_usd: Number(item.price_usd || 0),
            }))
        : [];

      const positions = Array.isArray(parsed.positions)
        ? parsed.positions
            .filter((item) => Boolean(item) && typeof item === "object")
            .map((item) => item as Record<string, unknown>)
            .map((item) => ({
              symbol: String(item.symbol || "UNKNOWN"),
              address: String(item.address || ""),
              entry_price: Number(item.entry_price || 0),
              current_price: Number(item.current_price || 0),
              liquidity: Number(item.liquidity || 0),
              confidence: Number(item.confidence || 0),
              size_pct: Number(item.size_pct || 0),
              risk_status: String(item.risk_status || "active"),
              trailing_stop_pct: Number(item.trailing_stop_pct || 0),
            }))
        : [];

      const recentTrades = Array.isArray(parsed.recent_trades)
        ? parsed.recent_trades
            .filter((item) => Boolean(item) && typeof item === "object")
            .map((item) => item as Record<string, unknown>)
            .map((item) => ({
              token: String(item.token || ""),
              address: String(item.address || ""),
              action: String(item.action || ""),
              status: String(item.status || ""),
              reason: String(item.reason || ""),
              confidence: Number(item.confidence || 0),
              liquidity: Number(item.liquidity || 0),
              volume_5m: Number(item.volume_5m || 0),
              size_pct: Number(item.size_pct || 0),
              timestamp: String(item.timestamp || ""),
            }))
        : [];

      const decisionJournal = Array.isArray(parsed.decision_journal)
        ? parsed.decision_journal
            .filter((item) => Boolean(item) && typeof item === "object")
            .map((item) => item as Record<string, unknown>)
            .map((item) => ({
              token: String(item.token || ""),
              address: String(item.address || ""),
              decision: String(item.decision || ""),
              reason: String(item.reason || ""),
              confidence: Number(item.confidence || 0),
              size_pct: Number(item.size_pct || 0),
              strategy_mode: String(item.strategy_mode || ""),
              timestamp: String(item.timestamp || ""),
            }))
        : [];

      return {
        enabled: Boolean(parsed.enabled),
        kill_switch: Boolean(parsed.kill_switch),
        scan_interval_seconds: Number(parsed.scan_interval_seconds || 20),
        last_run_at: parsed.last_run_at || null,
        last_error: parsed.last_error || null,
        risk_state: {
          drawdown_pct: Number(parsed.risk_state?.drawdown_pct || 0),
          daily_realized_pnl_usd: Number(parsed.risk_state?.daily_realized_pnl_usd || 0),
          high_watermark_usd: Number(parsed.risk_state?.high_watermark_usd || 0),
          open_positions: Number(parsed.risk_state?.open_positions || 0),
          open_exposure_pct: Number(parsed.risk_state?.open_exposure_pct || 0),
          consecutive_losses: Number(parsed.risk_state?.consecutive_losses || 0),
          paused: Boolean(parsed.risk_state?.paused),
          permanent_lock: Boolean(parsed.risk_state?.permanent_lock),
          pause_reason: parsed.risk_state?.pause_reason || null,
        },
        wallet: {
          address: String(parsed.wallet?.address || ""),
          balance_sol: Number(parsed.wallet?.balance_sol || 0),
          separate_wallet_enforced: Boolean(parsed.wallet?.separate_wallet_enforced),
        },
        trade_controls: tradeControls,
        active_tokens: activeTokens,
        positions,
        recent_trades: recentTrades,
        decision_journal: decisionJournal,
        performance: Array.isArray(parsed.performance) ? parsed.performance : [],
        tuning_suggestion: parsed.tuning_suggestion || null,
        strategy_mode: parsed.strategy_mode,
        safety: parsed.safety,
        self_evolution: parsed.self_evolution,
        fresh_feed: parsed.fresh_feed,
        scanner_health: parsed.scanner_health,
      };
    } catch {
      window.localStorage.removeItem(DOCTOR_STATUS_CACHE_KEY);
      return undefined;
    }
  };

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
