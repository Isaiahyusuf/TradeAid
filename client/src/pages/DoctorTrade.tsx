import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Power, Activity, Wallet, TrendingUp, BarChart3, Radio, Copy } from "lucide-react";
import { FaTelegramPlane } from "react-icons/fa";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDoctorConfig, useDoctorConnectWallet, useDoctorControl, useDoctorDirectBuy, useDoctorDirectSell, useDoctorDisconnectWallet, useDoctorResetLearning, useDoctorRunOnce, useDoctorStatus } from "@/hooks/use-doctortrade";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";
import { TokenAvatar } from "@/components/token/TokenAvatar";
import { useLocation } from "wouter";
import { SavingOverlay } from "@/components/ui/saving-overlay";

const DOCTORTRADE_UI_STATUS_CACHE_KEY = "doctortrade.ui.last_status.v1";

function buildDoctorUiStatusSnapshot(status: any) {
  if (!status || typeof status !== "object") return null;
  return {
    user_id: status.user_id ?? null,
    enabled: Boolean(status.enabled),
    kill_switch: Boolean(status.kill_switch),
    scan_interval_seconds: Number(status.scan_interval_seconds || 10),
    last_run_at: status.last_run_at ?? null,
    last_error: status.last_error ?? null,
    wallet: status.wallet || {},
    execution: status.execution || {},
    auto_trade: status.auto_trade || {},
    trade_controls: status.trade_controls || {},
    mate: status.mate || {},
    strategy_mode: status.strategy_mode || "",
    auto_agent: status.auto_agent || {},
    self_evolution: status.self_evolution || {},
    tuning_suggestion: status.tuning_suggestion || null,
    risk_state: status.risk_state || {},
    active_tokens: Array.isArray(status.active_tokens) ? status.active_tokens.slice(0, 25) : [],
    positions: Array.isArray(status.positions) ? status.positions.slice(0, 25) : [],
    recent_trades: Array.isArray(status.recent_trades) ? status.recent_trades.slice(0, 40) : [],
    decision_journal: Array.isArray(status.decision_journal) ? status.decision_journal.slice(0, 40) : [],
    performance: Array.isArray(status.performance) ? status.performance.slice(0, 30) : [],
    sniper_logs: Array.isArray(status.sniper_logs) ? status.sniper_logs.slice(0, 40) : [],
    wallet_tokens: Array.isArray(status.wallet_tokens) ? status.wallet_tokens.slice(0, 25) : [],
    wallet_transactions: Array.isArray(status.wallet_transactions) ? status.wallet_transactions.slice(0, 25) : [],
    cached_at: new Date().toISOString(),
  };
}

function loadDoctorUiStatusSnapshot() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DOCTORTRADE_UI_STATUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return buildDoctorUiStatusSnapshot(parsed);
  } catch {
    return null;
  }
}

function saveDoctorUiStatusSnapshot(status: any) {
  if (typeof window === "undefined") return;
  try {
    const snapshot = buildDoctorUiStatusSnapshot(status);
    if (!snapshot) return;
    window.localStorage.setItem(DOCTORTRADE_UI_STATUS_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
  }
}

function fmtUsd(value: number) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function fmtTs(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtSol(value: number) {
  const numeric = Number.isFinite(value) ? value : 0;
  if (numeric >= 1) return `${numeric.toFixed(4)} SOL`;
  if (numeric >= 0.001) return `${numeric.toFixed(6)} SOL`;
  return `${numeric.toFixed(8)} SOL`;
}

function fmtMint(value?: string) {
  const mint = String(value || "").trim();
  if (!mint) return "-";
  if (mint.length <= 14) return mint;
  return `${mint.slice(0, 6)}...${mint.slice(-6)}`;
}

const TRADEAID_TELEGRAM_BOT_URL = "https://t.me/Tradeaid_bot";

function isDoctorWalletConnected(wallet?: Record<string, any> | null, tradeControls?: Record<string, any> | null) {
  const address = String(wallet?.address || "").trim();
  const statusConnected = String(wallet?.connection_status || "").trim().toLowerCase() === "connected";
  const keyConfigured = Boolean(wallet?.private_key_configured);
  const controlsConnected = Boolean(tradeControls?.wallet_connected);
  return keyConfigured || controlsConnected || (statusConnected && Boolean(address));
}

function isAuthFailureMessage(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("unauthorized")
    || normalized.includes("not authenticated")
    || normalized.includes("invalid refresh token")
    || normalized.includes("session")
    || normalized.includes("401")
  );
}

export default function DoctorTrade() {
  const [, setLocation] = useLocation();
    // Only show new launches on Solana (created within 24h and chain is solana)
    // (Declarations moved below after viewData is defined)
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useDoctorStatus();
  const { toast } = useToast();
  const controlMutation = useDoctorControl();
  const configMutation = useDoctorConfig();
  const connectWalletMutation = useDoctorConnectWallet();
  const disconnectWalletMutation = useDoctorDisconnectWallet();
  const runMutation = useDoctorRunOnce();
  const resetLearningMutation = useDoctorResetLearning();
  const directBuyMutation = useDoctorDirectBuy();
  const directSellMutation = useDoctorDirectSell();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradingModeInput, setTradingModeInput] = useState<"doctor" | "retardio">("doctor");
  const [doctorTab, setDoctorTab] = useState<"trading" | "engine" | "pnl">("trading");
  const [intervalInput, setIntervalInput] = useState("10");
  const [buyAmountInput, setBuyAmountInput] = useState("0.1");
  const [maxTradesInput, setMaxTradesInput] = useState("12");
  const [tpMultInput, setTpMultInput] = useState("2.0");
  const [minProfitInput, setMinProfitInput] = useState("12");
  const [stopLossInput, setStopLossInput] = useState("6");
  const [trailInput, setTrailInput] = useState("10");
  const [minLiquidityInput, setMinLiquidityInput] = useState("20000");
  const [maxSlippageInput, setMaxSlippageInput] = useState("4");
  const [maxSpreadInput, setMaxSpreadInput] = useState("3");
  const [dailyLossInput, setDailyLossInput] = useState("600");
  const [maxConsecutiveLossesInput, setMaxConsecutiveLossesInput] = useState("3");
  const [strongMoveInput, setStrongMoveInput] = useState("40");
  const [maxHoldMinutesInput, setMaxHoldMinutesInput] = useState("180");
  const [minMomentumInput, setMinMomentumInput] = useState("4");
  const [qualityMinSpikeInput, setQualityMinSpikeInput] = useState("12");
  const [qualityMaxHolderInput, setQualityMaxHolderInput] = useState("35");
  const [gasPriorityInput, setGasPriorityInput] = useState("0");
  const [liveSellFractionInput, setLiveSellFractionInput] = useState("50");
  const [maxSellNotionalInput, setMaxSellNotionalInput] = useState("300");
  const [mlLearningEnabledInput, setMlLearningEnabledInput] = useState(true);
  const [mlMinClosedTradesInput, setMlMinClosedTradesInput] = useState("8");
  const [mlLookbackTradesInput, setMlLookbackTradesInput] = useState("40");
  const [mlBonusCapInput, setMlBonusCapInput] = useState("18");
  const [mlSizeMinInput, setMlSizeMinInput] = useState("0.7");
  const [mlSizeMaxInput, setMlSizeMaxInput] = useState("1.2");
  const simpleMode = false;
  const hydratedFromServerRef = useRef(false);
  const [cachedStatus, setCachedStatus] = useState<any>(() => loadDoctorUiStatusSnapshot());

  useEffect(() => {
    if (!data) return;
    const snapshot = buildDoctorUiStatusSnapshot(data);
    if (!snapshot) return;
    setCachedStatus(snapshot);
    saveDoctorUiStatusSnapshot(snapshot);
  }, [data]);

  const viewData = data || cachedStatus;
  const hasData = Boolean(viewData);
  // Only show new launches on Solana (created within 24h and chain is solana)
  const now = Date.now();
  const isHiddenToken = (token: any) => {
    const symbol = String(token?.symbol || "").trim().toLowerCase();
    return symbol === "xmoney" || symbol === "x-money";
  };

  const filterRecentSolana = (tokens: any[] = []) => tokens.filter((token: any) => {
    if (!token.created_at || !token.chain) return false;
    if (isHiddenToken(token)) return false;
    const ageMinutes = (now - new Date(token.created_at).getTime()) / 60000;
    return ageMinutes < 1440 && String(token.chain).toLowerCase() === "solana";
  });
  const tickerTokens = useMemo(
    () => filterRecentSolana(viewData?.active_tokens || []).slice(0, 10),
    [viewData?.active_tokens],
  );
  const safeBuyTokens = useMemo(
    () => (viewData?.active_tokens || [])
      .filter((token: any) => String(token.chain || "solana").toLowerCase() === "solana")
      .filter((token: any) => !isHiddenToken(token))
      .slice(0, 20),
    [viewData?.active_tokens],
  );
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const autoAction = String(searchParams.get("action") || "").trim().toLowerCase();
  const autoBuyContract = String(searchParams.get("contract") || "").trim();
  const autoBuyChain = String(searchParams.get("chain") || "solana").trim().toLowerCase();
  const [autoBuyHandled, setAutoBuyHandled] = useState(false);

  const hydrateSettingsInputs = (controls: Record<string, any>) => {
    const serverMode = String((viewData as any)?.trading_mode || controls.trading_mode || "doctor").toLowerCase();
    setTradingModeInput(serverMode === "retardio" ? "retardio" : "doctor");
    setIntervalInput(String(controls.scan_interval_seconds ?? 10));
    setBuyAmountInput(String(controls.buy_amount_sol ?? 0.1));
    setMaxTradesInput(String(controls.max_trades_per_day ?? 12));
    setTpMultInput(String(controls.take_profit_multiplier ?? 2));
    setMinProfitInput(String(controls.min_profit_pct ?? 12));
    setStopLossInput(String(controls.stop_loss_pct ?? 6));
    setTrailInput(String(controls.trailing_stop_pct ?? 10));
    setMinLiquidityInput(String(controls.min_liquidity_usd ?? 20000));
    setMaxSlippageInput(String(controls.max_slippage_pct ?? 4));
    setMaxSpreadInput(String(controls.max_spread_pct ?? 3));
    setDailyLossInput(String(controls.daily_loss_limit_usd ?? 600));
    setMaxConsecutiveLossesInput(String(controls.max_consecutive_losses ?? 3));
    setStrongMoveInput(String(controls.strong_move_threshold_pct ?? 40));
    setMaxHoldMinutesInput(String(controls.max_hold_minutes ?? 180));
    setMinMomentumInput(String(controls.min_momentum_profit_pct ?? 4));
    setQualityMinSpikeInput(String(controls.quality_min_volume_spike_pct ?? 12));
    setQualityMaxHolderInput(String(controls.quality_max_top_holder_pct ?? 35));
    setGasPriorityInput(String(controls.gas_priority_lamports ?? 0));
    setLiveSellFractionInput(String(controls.live_sell_fraction_pct ?? 50));
    setMaxSellNotionalInput(String(controls.max_sell_notional_usd ?? 300));
    setMlLearningEnabledInput(Boolean(controls.ml_learning_enabled ?? true));
    setMlMinClosedTradesInput(String(controls.ml_min_closed_trades ?? 8));
    setMlLookbackTradesInput(String(controls.ml_lookback_trades ?? 40));
    setMlBonusCapInput(String(controls.ml_bonus_cap_score ?? 18));
    setMlSizeMinInput(String(controls.ml_size_min_multiplier ?? 0.7));
    setMlSizeMaxInput(String(controls.ml_size_max_multiplier ?? 1.2));
  };

  useEffect(() => {
    const controls = viewData?.trade_controls as Record<string, any> | undefined;
    if (controls && !hydratedFromServerRef.current) {
      hydrateSettingsInputs(controls);
      hydratedFromServerRef.current = true;
    }
  }, [viewData?.trade_controls, viewData?.user_id]);

  useEffect(() => {
    if (autoAction !== "buy" || autoBuyHandled || !autoBuyContract) {
      return;
    }

    if (autoBuyChain !== "solana") {
      toast({
        title: "Automatic buy unavailable",
        description: "Automatic buy is currently supported for Solana tokens only.",
        variant: "destructive",
      });
      setAutoBuyHandled(true);
      return;
    }

    directBuyMutation.mutate(
      { contract_address: autoBuyContract, chain: autoBuyChain },
      {
        onSuccess: (response) => {
          const buyAmount = Number(response?.result?.buy_amount_sol || viewData?.trade_controls?.buy_amount_sol || 0.1);
          toast({
            title: "Automatic buy submitted",
            description: `DoctorTrade bought ${buyAmount.toFixed(3)} SOL for the selected token.`,
          });
          setAutoBuyHandled(true);
        },
        onError: (error) => {
          toast({
            title: "Automatic buy failed",
            description: error instanceof Error ? error.message : "Could not execute automatic buy.",
            variant: "destructive",
          });
          setAutoBuyHandled(true);
        },
      }
    );
  }, [autoAction, autoBuyChain, autoBuyContract, autoBuyHandled, directBuyMutation, toast, viewData?.trade_controls?.buy_amount_sol]);

  const performanceSeries = useMemo(
    () =>
      (viewData?.performance || []).slice(0, 12).reverse().map((row, index) => ({
        name: String(index + 1),
        winRate: Number((row?.latest_win_rate ?? row?.win_rate ?? 0) || 0) * 100,
        drawdown: Number((viewData?.risk_state?.drawdown_pct ?? 0) || 0),
      })),
    [viewData?.performance, viewData?.risk_state?.drawdown_pct],
  );

  const tradeSeries = useMemo(
    () =>
      (viewData?.recent_trades || []).slice(0, 16).reverse().map((row, index) => ({
        name: String(index + 1),
        confidence: Number(row?.confidence || 0),
        size: Number(row?.size_pct || 0),
      })),
    [viewData?.recent_trades],
  );

  const pnlRows = useMemo(() => {
    return (viewData?.recent_trades || [])
      .filter((row: any) => {
        const action = String(row?.action || "").toUpperCase();
        return action === "BUY" || action === "SELL";
      })
      .slice(0, 40);
  }, [viewData?.recent_trades]);

  const pnlSummary = useMemo(() => {
    let realizedPnlUsd = 0;
    let realizedPnlPctTotal = 0;
    let realizedCount = 0;
    let wins = 0;
    let losses = 0;

    for (const trade of pnlRows) {
      if (String(trade?.action || "").toUpperCase() !== "SELL") continue;

      const pnlUsd = Number(trade?.pnl_usd || 0);
      const pnlPct = Number(trade?.pnl_pct || 0);
      if (Number.isFinite(pnlUsd)) realizedPnlUsd += pnlUsd;
      if (Number.isFinite(pnlPct)) realizedPnlPctTotal += pnlPct;
      realizedCount += 1;

      if (pnlPct > 0) wins += 1;
      else if (pnlPct < 0) losses += 1;
    }

    const winRatePct = realizedCount > 0 ? (wins / realizedCount) * 100 : 0;
    const avgRealizedPnlPct = realizedCount > 0 ? realizedPnlPctTotal / realizedCount : 0;

    return {
      realizedPnlUsd,
      realizedCount,
      wins,
      losses,
      winRatePct,
      avgRealizedPnlPct,
    };
  }, [pnlRows]);

  const decisionJournalRows = useMemo(() => {
    const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
    return (viewData?.decision_journal || [])
      .filter((row: any) => {
        const token = String(row?.token || "").trim().toLowerCase();
        if (token === "xmoney" || token === "x-money") return false;

        const decision = String(row?.decision || "").trim().toLowerCase();
        if (decision !== "buy" && decision !== "sell" && decision !== "skip") return false;

        const ts = new Date(String(row?.timestamp || "")).getTime();
        if (!Number.isFinite(ts) || ts <= 0) return false;

        return ts >= cutoffMs;
      })
      .slice(0, 16);
  }, [viewData?.decision_journal]);

  const learningState = useMemo(() => {
    return (viewData?.self_evolution as any)?.learning as
      | {
          enabled?: boolean;
          closed_trades?: number;
          trained?: boolean;
          win_rate?: number;
          avg_pnl_pct?: number;
          adaptive_confidence_delta?: number;
          size_multiplier?: number;
          win_profile?: { confidence?: number; volume_5m?: number; liquidity?: number };
          loss_profile?: { confidence?: number; volume_5m?: number; liquidity?: number };
          last_trained_at?: string | null;
        }
      | undefined;
  }, [viewData?.self_evolution]);

  const learningSummary = useMemo(() => {
    const enabled = Boolean(learningState?.enabled);
    const trained = Boolean(learningState?.trained);
    const closedTrades = Math.max(0, Number(learningState?.closed_trades || 0));
    const winRatePct = Math.max(0, Math.min(100, Number((Number(learningState?.win_rate || 0) * 100).toFixed(2))));
    const avgPnlPct = Number(learningState?.avg_pnl_pct || 0);
    const adaptiveConfidenceDelta = Number(learningState?.adaptive_confidence_delta || 0);
    const sizeMultiplier = Number(learningState?.size_multiplier || 1);
    const posture = adaptiveConfidenceDelta > 0
      ? "tightened"
      : adaptiveConfidenceDelta < 0
        ? "relaxed"
        : "neutral";

    const latestMlDecision = decisionJournalRows.find((row: any) => {
      return Number.isFinite(Number((row as any)?.ml_learned_bonus)) || Number.isFinite(Number((row as any)?.ml_size_multiplier));
    }) as (Record<string, any> | undefined);

    const latestBonus = Number(latestMlDecision?.ml_learned_bonus || 0);
    const latestSizeMult = Number(latestMlDecision?.ml_size_multiplier || 0);
    const latestBiasLabel = latestBonus > 0
      ? "positive_bias"
      : latestBonus < 0
        ? "negative_bias"
        : "neutral_bias";

    return {
      enabled,
      trained,
      closedTrades,
      winRatePct,
      avgPnlPct,
      adaptiveConfidenceDelta,
      sizeMultiplier,
      posture,
      latestMlDecision,
      latestBonus,
      latestSizeMult,
      latestBiasLabel,
    };
  }, [decisionJournalRows, learningState]);

  const rejectStats = useMemo(() => {
    const tokens = (viewData?.active_tokens || []) as Array<Record<string, any>>;
    let ageRejected = 0;
    let sourceRejected = 0;
    let safetyRejected = 0;

    for (const token of tokens) {
      const reasons = Array.isArray((token as any)?.reject_reasons) ? (token as any).reject_reasons : [];
      const normalized = reasons.map((reason: any) => String(reason || "").toLowerCase());
      if (normalized.some((reason: string) => reason.includes("age") || reason.includes("old"))) ageRejected += 1;
      if (normalized.some((reason: string) => reason.includes("launch_source") || reason.includes("source"))) sourceRejected += 1;
      if (normalized.some((reason: string) => reason.includes("safety") || reason.includes("dev_commitment") || reason.includes("confidence"))) safetyRejected += 1;
    }

    return { ageRejected, sourceRejected, safetyRejected };
  }, [viewData?.active_tokens]);

  const walletConnected = isDoctorWalletConnected(
    (viewData?.wallet as Record<string, any> | undefined) || null,
    (viewData?.trade_controls as Record<string, any> | undefined) || null,
  );
  const activeTradingMode = String(viewData?.trading_mode || tradingModeInput || "doctor").trim().toLowerCase();
  const isRetardioActive = activeTradingMode === "retardio";
  const isRetardioMode = tradingModeInput === "retardio";
  const autoSnipeReady = Boolean(
    viewData?.enabled &&
    walletConnected &&
    String(viewData?.execution?.mode || "").toLowerCase() === "live" &&
    Boolean(viewData?.execution?.live_capable),
  );
  const autoSnipeStatusLabel = !viewData?.enabled
    ? "Doctor stopped"
    : !walletConnected
      ? "Wallet not connected"
      : String(viewData?.execution?.mode || "").toLowerCase() !== "live"
        ? "Execution mode is not live"
        : !viewData?.execution?.live_capable
          ? "Live wallet credentials missing"
          : (viewData?.active_tokens?.length || 0) <= 0
            ? "Scanning market (no current targets)"
            : "Auto-snipe running";
    const breathingStateClass = !viewData?.enabled
      ? "is-stopped"
      : autoSnipeReady
        ? ""
        : "is-waiting";
    const autoAgentTimeoutMinutes = Math.max(1, Number(viewData?.auto_agent?.no_snipe_timeout_minutes || 10));
    const autoAgentIdleMinutes = Number(viewData?.auto_agent?.no_snipe_for_minutes || 0);
    const autoAgentStatusLabel = !Boolean(viewData?.auto_agent?.enabled)
      ? "Auto-rotate off"
      : `Auto rotate after ${autoAgentTimeoutMinutes}m no-snipe`;
    const autoAgentLastRotateLabel = viewData?.auto_agent?.last_rotate_at
      ? `Last rotate: ${fmtTs(String(viewData?.auto_agent?.last_rotate_at || ""))}`
      : "Last rotate: -";
  const autoTradeBlockLabel = useMemo(() => {
    const reason = String(viewData?.auto_trade?.block_reason || "").trim().toLowerCase();
    if (!reason) return null;
    if (reason === "doctortrade_disabled") return "DoctorTrade is disabled. Start the engine to resume autonomous entries.";
    if (reason === "kill_switch_enabled") return "Kill switch is enabled. Release it from settings to resume trading.";
    if (reason === "wallet_key_not_connected") return "Wallet private key is not connected. Reconnect wallet in settings.";
    if (reason === "max_open_positions_reached") return "Maximum open positions reached. DoctorTrade is waiting for exits.";
    if (reason === "max_trades_reached") return "Daily trade cap reached. Increase limit or wait for reset window.";
    if (reason === "daily_loss_limit_reached") return "Daily loss limit reached. Review risk controls before resuming.";
    if (reason === "max_consecutive_losses_reached") return "Consecutive loss limit reached. Strategy pause is active.";
    return `Auto-trade blocked: ${reason.replace(/_/g, " ")}.`;
  }, [viewData?.auto_trade?.block_reason]);
  const lastSyncLabel = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "-";
  const doctorHeartbeat = useMemo(() => {
    const lastRunTs = new Date(String(viewData?.last_run_at || "")).getTime();
    if (!Number.isFinite(lastRunTs) || lastRunTs <= 0) {
      return {
        stale: false,
        secondsAgo: null as number | null,
      };
    }
    const secondsAgo = Math.max(0, Math.round((Date.now() - lastRunTs) / 1000));
    const scanInterval = Math.max(5, Number(viewData?.scan_interval_seconds || 10));
    return {
      stale: secondsAgo > Math.max(90, scanInterval * 3),
      secondsAgo,
    };
  }, [viewData?.last_run_at, viewData?.scan_interval_seconds]);
  const walletSolBalance = Number(viewData?.wallet?.balance_sol || 0);
  const walletBalanceStale = Boolean((viewData?.wallet as any)?.balance_stale);
  const walletSolLabel = walletConnected && walletBalanceStale ? "Syncing..." : fmtSol(walletSolBalance);
  const walletPrivateKeyConfigured = Boolean(viewData?.wallet?.private_key_configured);
  const doctorSavingInProgress = Boolean(
    controlMutation.isPending
    || configMutation.isPending
    || connectWalletMutation.isPending
    || disconnectWalletMutation.isPending
    || runMutation.isPending
    || resetLearningMutation.isPending
    || directBuyMutation.isPending
    || directSellMutation.isPending,
  );
  const doctorSavingMessage = connectWalletMutation.isPending
    ? "Connecting DoctorTrade wallet..."
    : disconnectWalletMutation.isPending
      ? "Disconnecting DoctorTrade wallet..."
      : controlMutation.isPending
        ? "Updating DoctorTrade engine state..."
        : configMutation.isPending
          ? "Saving DoctorTrade settings..."
          : runMutation.isPending
            ? "Running DoctorTrade cycle..."
            : resetLearningMutation.isPending
              ? "Resetting learning model..."
              : directBuyMutation.isPending
                ? "Submitting buy order..."
                : directSellMutation.isPending
                  ? "Submitting sell order..."
                  : "Applying DoctorTrade changes...";
  const mateState = viewData?.mate;
  const activeMateAgent = useMemo(() => {
    const explicit = String(mateState?.best_agent || "").trim();
    if (explicit) return explicit;

    const fromStrategyMode = String(viewData?.strategy_mode || "").trim();
    if (fromStrategyMode && fromStrategyMode !== "autonomous") return fromStrategyMode;

    const scores = Object.entries(mateState?.scores || {})
      .filter(([name]) => String(name || "").trim().length > 0)
      .map(([name, score]) => ({ name: String(name), score: Number(score || 0) }))
      .sort((a, b) => b.score - a.score);

    if (scores.length > 0) return scores[0].name;
    return "waiting_signal";
  }, [mateState?.best_agent, mateState?.scores, viewData?.strategy_mode]);
  const activeMateAgentLabel = useMemo(() => {
    return activeMateAgent
      .replace(/_agent$/i, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }, [activeMateAgent]);

  const handleDirectSell = (position: any) => {
    const contractAddress = String(position?.address || "").trim();
    if (!contractAddress) {
      toast({
        title: "Sell failed",
        description: "Missing token contract address.",
        variant: "destructive",
      });
      return;
    }

    const configuredFraction = Math.max(1, Math.min(100, Number(viewData?.trade_controls?.live_sell_fraction_pct || 100)));
    directSellMutation.mutate(
      {
        contract_address: contractAddress,
        sell_fraction_pct: configuredFraction,
      },
      {
        onSuccess: (response) => {
          if (!response?.result?.executed) {
            toast({
              title: "Sell blocked",
              description: String(response?.result?.reason || "manual_sell_failed"),
              variant: "destructive",
            });
            return;
          }

          const sold = Number(response?.result?.sold_amount_sol || 0);
          const remaining = Number(response?.result?.remaining_amount_sol || 0);
          toast({
            title: "Quick sell submitted",
            description: `${String(position?.symbol || "TOKEN")} sold ${sold.toFixed(4)} SOL, remaining ${remaining.toFixed(4)} SOL.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Sell failed",
            description: error instanceof Error ? error.message : "Could not execute quick sell.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const saveRiskRules = () => {
    const scanIntervalSeconds = Math.max(5, Math.trunc(Number.parseFloat(intervalInput) || 20));
    const buyAmountSol = Math.max(0.1, Number.parseFloat(buyAmountInput) || 0.1);
    const maxTradesPerDay = Math.max(1, Math.trunc(Number.parseFloat(maxTradesInput) || 12));
    const takeProfitMultiplier = Math.max(1.01, Number.parseFloat(tpMultInput) || 2.0);
    const minProfitPct = Math.max(0.1, Number.parseFloat(minProfitInput) || 12);
      const stopLossPct = Math.max(0.1, Number.parseFloat(stopLossInput) || 6);
    const trailingStopPct = Math.max(0.1, Number.parseFloat(trailInput) || 10);
    const minLiquidityUsd = Math.max(100, Number.parseFloat(minLiquidityInput) || 20000);
    const maxSlippagePct = Math.max(0.1, Number.parseFloat(maxSlippageInput) || 4);
    const maxSpreadPct = Math.max(0.1, Number.parseFloat(maxSpreadInput) || 3);
    const dailyLossLimitUsd = Math.max(10, Number.parseFloat(dailyLossInput) || 600);
    const maxConsecutiveLosses = Math.max(1, Math.trunc(Number.parseFloat(maxConsecutiveLossesInput) || 3));
    const strongMoveThresholdPct = Math.max(5, Number.parseFloat(strongMoveInput) || 40);
    const maxHoldMinutes = Math.max(1, Math.trunc(Number.parseFloat(maxHoldMinutesInput) || 180));
    const minMomentumProfitPct = Math.max(0, Number.parseFloat(minMomentumInput) || 4);
    const qualityMinVolumeSpikePct = Math.max(0, Number.parseFloat(qualityMinSpikeInput) || 12);
    const qualityMaxTopHolderPct = Math.max(1, Number.parseFloat(qualityMaxHolderInput) || 35);
    const gasPriorityLamports = Math.max(0, Math.trunc(Number.parseFloat(gasPriorityInput) || 0));
    const liveSellFractionPct = Math.max(1, Math.min(100, Number.parseFloat(liveSellFractionInput) || 50));
    const maxSellNotionalUsd = Math.max(1, Number.parseFloat(maxSellNotionalInput) || 300);
    const mlMinClosedTrades = Math.max(3, Math.trunc(Number.parseFloat(mlMinClosedTradesInput) || 8));
    const mlLookbackTrades = Math.max(mlMinClosedTrades, Math.trunc(Number.parseFloat(mlLookbackTradesInput) || 40));
    const mlBonusCapScore = Math.max(4, Number.parseFloat(mlBonusCapInput) || 18);
    const mlSizeMinMultiplier = Math.max(0.5, Math.min(1, Number.parseFloat(mlSizeMinInput) || 0.7));
    const mlSizeMaxMultiplier = Math.max(mlSizeMinMultiplier, Number.parseFloat(mlSizeMaxInput) || 1.2);
    configMutation.mutate(
      {
        scan_interval_seconds: scanIntervalSeconds,
        buy_amount_sol: buyAmountSol,
        trading_mode: tradingModeInput,
        max_trades_per_day: maxTradesPerDay,
        take_profit_multiplier: takeProfitMultiplier,
        min_profit_pct: minProfitPct,
        stop_loss_pct: stopLossPct,
        trailing_stop_pct: trailingStopPct,
        min_liquidity_usd: minLiquidityUsd,
        max_slippage_pct: maxSlippagePct,
        max_spread_pct: maxSpreadPct,
        daily_loss_limit_usd: dailyLossLimitUsd,
        max_consecutive_losses: maxConsecutiveLosses,
        strong_move_threshold_pct: strongMoveThresholdPct,
        max_hold_minutes: maxHoldMinutes,
        min_momentum_profit_pct: minMomentumProfitPct,
        quality_min_volume_spike_pct: qualityMinVolumeSpikePct,
        quality_max_top_holder_pct: qualityMaxTopHolderPct,
        gas_priority_lamports: gasPriorityLamports,
        live_sell_fraction_pct: liveSellFractionPct,
        max_sell_notional_usd: maxSellNotionalUsd,
        ml_learning_enabled: mlLearningEnabledInput,
        ml_min_closed_trades: mlMinClosedTrades,
        ml_lookback_trades: mlLookbackTrades,
        ml_bonus_cap_score: mlBonusCapScore,
        ml_size_min_multiplier: mlSizeMinMultiplier,
        ml_size_max_multiplier: mlSizeMaxMultiplier,
      },
      {
        onSuccess: () => {
          setSettingsOpen(false);
          toast({ title: "Risk rules saved", description: "DoctorTrade settings updated." });
        },
        onError: (error) => {
          toast({
            title: "Save failed",
            description: error instanceof Error ? error.message : "Unable to save settings",
            variant: "destructive",
          });
        },
      },
    );
  };

  const saveBasicTradingControls = () => {
    const buyAmountSol = Math.max(0.1, Number(buyAmountInput || 0.1));
    const takeProfitMultiplier = Math.max(1.1, Number(tpMultInput || 1.8));
    const stopLossPct = Math.max(2, Number(stopLossInput || 12));

    configMutation.mutate(
      {
        buy_amount_sol: buyAmountSol,
        trading_mode: tradingModeInput,
        take_profit_multiplier: takeProfitMultiplier,
        stop_loss_pct: stopLossPct,
      },
      {
        onSuccess: () => {
          toast({ title: "Trading controls saved", description: "Buy amount, take profit, and stop loss were updated." });
          void refetch();
        },
        onError: (error) => {
          toast({
            title: "Save failed",
            description: error instanceof Error ? error.message : "Unable to save trading controls",
            variant: "destructive",
          });
        },
      },
    );
  };

  const saveTradingModeOnly = () => {
    configMutation.mutate(
      { trading_mode: tradingModeInput },
      {
        onSuccess: () => {
          toast({
            title: "Trading mode saved",
            description: tradingModeInput === "retardio"
              ? "Retardio mode is now active."
              : "Doctor mode is now active.",
          });
          void refetch();
        },
        onError: (error) => {
          toast({
            title: "Save failed",
            description: error instanceof Error ? error.message : "Unable to save trading mode",
            variant: "destructive",
          });
        },
      },
    );
  };

  const isMissingAppWalletError = (error: unknown) => {
    const message = String((error as any)?.message || "").toLowerCase();
    return (
      message.includes("wallet_private_key_required")
      || (message.includes("connect") && message.includes("wallet first"))
      || (message.includes("no saved") && message.includes("wallet"))
    );
  };

  const promptWalletSetup = () => {
    toast({
      title: "Wallet setup needed",
      description: "DoctorTrade could not load a usable wallet key. Please retry Connect Wallet.",
      variant: "destructive",
    });
  };

  const isTransientConnectError = (error: unknown) => {
    const message = String((error as any)?.message || "").toLowerCase();
    return (
      message.includes("network")
      || message.includes("fetch")
      || message.includes("timeout")
      || message.includes("timed out")
      || message.includes("connection failed")
    );
  };

  const recheckWalletConnection = async (attempts = 20, delayMs = 2000) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const latest = await refetch();
      const connected = isDoctorWalletConnected(
        (latest.data?.wallet as Record<string, any> | undefined) || null,
        (latest.data?.trade_controls as Record<string, any> | undefined) || null,
      );
      if (connected) {
        return true;
      }
    }
    return false;
  };

  const connectWithRetries = async () => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const status = await connectWalletMutation.mutateAsync({ use_existing_wallet: true });
        const persistedConnected = isDoctorWalletConnected(
          (status?.wallet as Record<string, any> | undefined) || null,
          (status?.trade_controls as Record<string, any> | undefined) || null,
        );

        if (persistedConnected) {
          return true;
        }
      } catch (error) {
        if (isMissingAppWalletError(error)) {
          throw error;
        }
        lastError = error;
      }

      const connectedAfterRetry = await recheckWalletConnection(10, 1500);
      if (connectedAfterRetry) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }

    if (lastError) {
      throw lastError;
    }
    return false;
  };

  const ensureDoctorWalletConnected = async () => {
    return await connectWithRetries();
  };

  const handleConnectWallet = () => {
    void (async () => {
      try {
        const connected = await ensureDoctorWalletConnected();
        if (!connected) {
          return;
        }
        toast({ title: "Wallet connected", description: "DoctorTrade linked to your app wallet." });
        void refetch();
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "";
        if (isAuthFailureMessage(rawMessage)) {
          toast({
            title: "Sign in required",
            description: "Your session expired. Sign in again, then retry Connect Wallet.",
            variant: "destructive",
          });
          return;
        }

        if (isMissingAppWalletError(error)) {
          promptWalletSetup();
          return;
        }

        if (isTransientConnectError(error)) {
          const connectedAfterRetry = await recheckWalletConnection(25, 2000);
          if (connectedAfterRetry) {
            toast({ title: "Wallet connected", description: "Connection was delayed but completed successfully." });
            return;
          }

          toast({
            title: "Wallet connection still processing",
            description: "The request took too long to respond, but your wallet may still be syncing. Wait a few seconds and tap Refresh Data.",
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Wallet connection failed",
          description: rawMessage || "Could not connect wallet.",
          variant: "destructive",
        });
      }
    })();
  };

  const handleDisconnectWallet = () => {
    disconnectWalletMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Wallet disconnected", description: "DoctorTrade wallet has been disconnected." });
      },
      onError: (error) => {
        toast({
          title: "Disconnect failed",
          description: error instanceof Error ? error.message : "Unable to disconnect wallet",
          variant: "destructive",
        });
      },
    });
  };

  const handleToggleDoctor = () => {
    if (controlMutation.isPending) {
      return;
    }

    const nextEnabled = !Boolean(viewData?.enabled);
    if (nextEnabled && !walletConnected) {
      void (async () => {
        try {
          const connected = await ensureDoctorWalletConnected();
          if (!connected) {
            promptWalletSetup();
            return;
          }

          toast({ title: "Wallet connected", description: "DoctorTrade linked to your app wallet." });
          controlMutation.mutate(true, {
            onSuccess: (startStatus) => {
              if (!Boolean(startStatus?.enabled)) {
                toast({
                  title: "DoctorTrade did not start",
                  description: String(startStatus?.last_error || "Could not start after wallet connect."),
                  variant: "destructive",
                });
                return;
              }
              toast({ title: "DoctorTrade started", description: "Wallet connected and autonomous trading is now active." });
              void refetch();
            },
            onError: (error) => {
              toast({
                title: "DoctorTrade update failed",
                description: error instanceof Error ? error.message : "Could not update DoctorTrade state.",
                variant: "destructive",
              });
            },
          });
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : "";
          if (isAuthFailureMessage(rawMessage)) {
            toast({
              title: "Sign in required",
              description: "Your session expired. Sign in again, then retry Connect Wallet.",
              variant: "destructive",
            });
            return;
          }

          if (isMissingAppWalletError(error)) {
            promptWalletSetup();
            return;
          }

          if (isTransientConnectError(error)) {
            const connectedAfterRetry = await recheckWalletConnection(25, 2000);
            if (connectedAfterRetry) {
              toast({ title: "Wallet connected", description: "Connection was delayed but completed successfully." });
              controlMutation.mutate(true);
              return;
            }
          }

          toast({
            title: "Wallet connection failed",
            description: rawMessage || "Could not connect wallet.",
            variant: "destructive",
          });
        }
      })();
      return;
    }
    controlMutation.mutate(nextEnabled, {
      onSuccess: (status) => {
        const enabledNow = Boolean(status?.enabled);
        if (nextEnabled && !enabledNow) {
          toast({
            title: "DoctorTrade did not start",
            description: String(status?.last_error || "Check kill switch and wallet connection, then try again."),
            variant: "destructive",
          });
          return;
        }
        toast({
          title: enabledNow ? "DoctorTrade started" : "DoctorTrade stopped",
          description: enabledNow
            ? "Autonomous engine is now active and continues server-side even if you close your browser."
            : "Autonomous engine has been paused.",
        });
        refetch();
      },
      onError: (error) => {
        toast({
          title: "DoctorTrade update failed",
          description: error instanceof Error ? error.message : "Could not update DoctorTrade state.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Layout>
      <div className="relative space-y-6 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -top-16 right-0 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
        <SavingOverlay
          visible={doctorSavingInProgress}
          title="Updating DoctorTrade"
          message={doctorSavingMessage}
        />

        <div className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-950/90 via-slate-900/90 to-emerald-950/80 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.2),transparent_45%)]" />
          <div className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              <Bot className="h-8 w-8 text-cyan-300" />
              DoctorTrade Terminal
            </h1>
            <p className="max-w-2xl text-sm text-slate-300">
              Autonomous trading command center with live watchlist, execution feed, and adaptive risk controls.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Solana Only</Badge>
            <Badge variant="outline">Independent Engine</Badge>
            <Badge variant="outline">Runs Server-Side</Badge>
            <Badge variant="outline" className="border-green-500/40 text-green-400">Trade Mode LIVE ONLY</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Risk Locked</Badge>
            <Badge variant="outline" className={walletConnected ? "border-green-500/40 text-green-400" : "border-yellow-500/40 text-yellow-400"}>
              {walletConnected ? "Wallet Connected" : "Wallet Not Connected"}
            </Badge>
            {!hasData && <Badge variant="outline">Syncing</Badge>}
          </div>
        </div>

        <Card className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Mission Control</p>
            <Badge variant="outline" className={autoSnipeReady ? "border-emerald-400/50 text-emerald-300" : "border-amber-400/50 text-amber-300"}>
              {autoSnipeReady ? "Execution Ready" : "Standby"}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 py-2">
              <p className="text-[11px] text-slate-400">Freshness Window</p>
              <p className="text-sm font-semibold text-slate-100">{Math.max(30, Number(viewData?.trade_controls?.max_token_age_seconds || 90))}s</p>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 py-2">
              <p className="text-[11px] text-slate-400">Age Rejections</p>
              <p className="text-sm font-semibold text-amber-300">{rejectStats.ageRejected}</p>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 py-2">
              <p className="text-[11px] text-slate-400">Source Rejections</p>
              <p className="text-sm font-semibold text-cyan-300">{rejectStats.sourceRejected}</p>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 py-2">
              <p className="text-[11px] text-slate-400">Safety Rejections</p>
              <p className="text-sm font-semibold text-rose-300">{rejectStats.safetyRejected}</p>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border-cyan-500/20 bg-slate-900/70 p-4 backdrop-blur-md">
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              onClick={handleToggleDoctor}
              disabled={controlMutation.isPending}
              variant={viewData?.enabled ? "destructive" : "default"}
            >
              <Power className="w-4 h-4 mr-2" />
              {viewData?.enabled ? "Stop DoctorTrade" : "Start DoctorTrade"}
            </Button>
            {!simpleMode && (
              <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !viewData?.enabled}>
                <Activity className="w-4 h-4 mr-2" /> Run Cycle
              </Button>
            )}
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <Activity className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> {isFetching ? "Syncing..." : "Refresh Data"}
            </Button>
            <Button variant="outline" onClick={() => setLocation("/disclaimer")}>
              Disclaimer
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.open(TRADEAID_TELEGRAM_BOT_URL, "_blank", "noopener,noreferrer");
                }
              }}
            >
              <FaTelegramPlane className="w-4 h-4 mr-2" /> Telegram Bot
            </Button>
            <Button
              variant="outline"
              onClick={handleConnectWallet}
              disabled={connectWalletMutation.isPending || walletConnected}
            >
              <Wallet className="w-4 h-4 mr-2" /> {walletConnected ? "Wallet Connected" : "Connect Wallet"}
            </Button>
            {!walletConnected && (
              <Button
                variant="default"
                onClick={() => setLocation(`/wallet?action=connect&returnTo=${encodeURIComponent("/doctortrade")}`)}
              >
                Create Wallet
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleDisconnectWallet}
              disabled={disconnectWalletMutation.isPending || !walletConnected}
            >
              Disconnect Wallet
            </Button>
          </div>
          <div className="mt-3 text-xs text-muted-foreground flex items-center gap-3">
            <span>{isLoading ? "Loading DoctorTrade..." : isFetching ? "Updating live data..." : "Live sync active"}</span>
            <span>Last sync: {lastSyncLabel}</span>
            <span>Last cycle: {doctorHeartbeat.secondsAgo !== null ? `${doctorHeartbeat.secondsAgo}s ago` : "-"}</span>
              <span>Wallet SOL: {walletSolLabel}</span>
            {doctorHeartbeat.stale && <Badge variant="outline" className="border-yellow-500/40 text-yellow-400">Cycle Delay</Badge>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            DoctorTrade runs on the server. Once started, it continues scanning and executing even when your browser is closed.
          </p>
        </Card>

        {Boolean(viewData?.auto_trade?.blocked) && autoTradeBlockLabel && (
          <Card className="p-3 border-yellow-500/30 bg-yellow-500/5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-yellow-300">Auto-Trade Guardrail Active</p>
              <Badge variant="outline" className="border-yellow-500/40 text-yellow-400">Blocked</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{autoTradeBlockLabel}</p>
          </Card>
        )}

        <Card className="rounded-2xl border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Bot className="w-4 h-4 text-emerald-400" /> MATE Strategy Brain
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Live orchestrator output from the multi-agent trading engine.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className={`doctor-live-breath ${breathingStateClass}`} aria-hidden="true" />
              <div className="text-right">
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">MATE Live</Badge>
                <p className="mt-1 text-[11px] text-muted-foreground">{autoSnipeStatusLabel}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-sm">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">Market Regime</p>
              <p className="font-semibold">{String(mateState?.regime || "Analyzing")}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">Active Agent</p>
              <p className="font-semibold">{activeMateAgentLabel}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className="font-semibold">{Number(mateState?.confidence || 0).toFixed(2)}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Strategy control now comes from MATE orchestrator scoring, not preset profiles.</p>
          {!isRetardioActive ? (
            <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
              <p>{autoAgentStatusLabel}</p>
              <p className="mt-1">Idle since last successful snipe: {autoAgentIdleMinutes.toFixed(1)}m</p>
              <p className="mt-1">{autoAgentLastRotateLabel}</p>
            </div>
          ) : (
            <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
              <p>Retardio mode is active. Strategy profile and preset rotation are managed internally.</p>
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border-cyan-500/20 bg-slate-900/70 p-3 backdrop-blur-md">
          <Tabs value={doctorTab} onValueChange={(value) => setDoctorTab(value as "trading" | "engine" | "pnl")}>
            <TabsList className="grid w-full grid-cols-3 rounded-xl bg-slate-800/70 p-1">
              <TabsTrigger className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100" value="trading">Trading</TabsTrigger>
              <TabsTrigger className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-100" value="engine">Strategy Brain</TabsTrigger>
              <TabsTrigger className="data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-100" value="pnl">PnL</TabsTrigger>
            </TabsList>
          </Tabs>
        </Card>

        {doctorTab === "engine" && (
          <Card className="rounded-2xl border-emerald-500/20 bg-gradient-to-br from-slate-900/85 to-emerald-950/40 p-4 backdrop-blur-md">
            <h3 className="text-sm font-semibold mb-2">MATE Scoring Snapshot</h3>
            <div className="space-y-2 text-sm">
              {Object.entries(mateState?.scores || {}).length ? Object.entries(mateState?.scores || {}).map(([agent, score]) => (
                <div key={agent} className="flex items-center justify-between rounded-md border border-border/60 bg-background/50 px-3 py-2">
                  <span>{agent === activeMateAgent ? `${agent} (active)` : agent}</span>
                  <span>{Number(score || 0).toFixed(3)}</span>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground">Waiting for enough market samples to publish score table.</p>
              )}
            </div>
          </Card>
        )}

        {doctorTab === "pnl" && (
          <Card className="rounded-2xl border-indigo-500/20 bg-gradient-to-br from-slate-900/85 to-indigo-950/40 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold">PnL Tracker</h3>
              <Badge
                variant="outline"
                className={pnlSummary.realizedPnlUsd >= 0 ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}
              >
                Realized {pnlSummary.realizedPnlUsd >= 0 ? "+" : ""}${pnlSummary.realizedPnlUsd.toFixed(2)}
              </Badge>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-3 text-sm">
              <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">Realized PnL</p>
                <p className={pnlSummary.realizedPnlUsd >= 0 ? "font-semibold text-green-400" : "font-semibold text-red-400"}>
                  {pnlSummary.realizedPnlUsd >= 0 ? "+" : ""}${pnlSummary.realizedPnlUsd.toFixed(2)}
                </p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">Closed Trades</p>
                <p className="font-semibold">{pnlSummary.realizedCount}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="font-semibold">{pnlSummary.winRatePct.toFixed(1)}%</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">Wins</p>
                <p className="font-semibold text-green-400">{pnlSummary.wins}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">Losses</p>
                <p className="font-semibold text-red-400">{pnlSummary.losses}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">Avg Closed PnL %</p>
                <p className={pnlSummary.avgRealizedPnlPct >= 0 ? "font-semibold text-green-400" : "font-semibold text-red-400"}>
                  {pnlSummary.avgRealizedPnlPct >= 0 ? "+" : ""}{pnlSummary.avgRealizedPnlPct.toFixed(2)}%
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-80 overflow-auto">
              {pnlRows.slice(0, 20).map((trade: any, index: number) => {
                const action = String(trade?.action || "-").toUpperCase();
                const pnlPct = Number(trade?.pnl_pct || 0);
                const pnlUsd = Number(trade?.pnl_usd || 0);
                const isSell = action === "SELL";
                return (
                  <div key={`${trade.address || "pnl"}-${index}`} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{trade.token || "UNKNOWN"}</p>
                      <Badge variant="outline" className="text-[10px]">{action}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{trade.status || "unknown"} · {trade.reason || "-"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {fmtTs(trade.timestamp)} · {isSell ? "Closed" : "Open/Entry"}
                    </p>
                    {isSell && (
                      <p className={pnlPct >= 0 ? "text-[11px] text-green-400" : "text-[11px] text-red-400"}>
                        PnL {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}% · {pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)}
                      </p>
                    )}
                  </div>
                );
              })}
              {!pnlRows.length && <p className="text-sm text-muted-foreground">No trades available for PnL tracking yet.</p>}
            </div>
          </Card>
        )}

        <SettingsMenuCard
          title="DoctorTrade Settings"
          description="Wallet setup only. Trading strategy is auto-managed."
          open={settingsOpen}
          onToggle={() => setSettingsOpen((prev) => !prev)}
        >
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 mb-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Doctor Wallet</p>
              <Badge variant="outline" className="border-green-500/40 text-green-400">LIVE ONLY</Badge>
            </div>
            {!simpleMode && <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/50 p-2">
              <div>
                <p className="text-xs font-medium">Kill Switch</p>
                <p className="text-[11px] text-muted-foreground">
                  {viewData?.kill_switch ? "Engaged: DoctorTrade is forced OFF" : "Released: DoctorTrade can run"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={viewData?.kill_switch ? "destructive" : "outline"}
                  disabled={configMutation.isPending || Boolean(viewData?.kill_switch)}
                  onClick={() => {
                    configMutation.mutate(
                      { kill_switch: true },
                      {
                        onSuccess: () => {
                          toast({ title: "Kill switch engaged", description: "DoctorTrade has been stopped." });
                        },
                        onError: (error) => {
                          toast({
                            title: "Kill switch update failed",
                            description: error instanceof Error ? error.message : "Unable to update kill switch",
                            variant: "destructive",
                          });
                        },
                      },
                    );
                  }}
                >
                  Engage
                </Button>
                <Button
                  size="sm"
                  variant={!viewData?.kill_switch ? "default" : "outline"}
                  disabled={configMutation.isPending || !Boolean(viewData?.kill_switch)}
                  onClick={() => {
                    configMutation.mutate(
                      { kill_switch: false },
                      {
                        onSuccess: () => {
                          toast({ title: "Kill switch released", description: "You can start DoctorTrade again." });
                        },
                        onError: (error) => {
                          toast({
                            title: "Kill switch update failed",
                            description: error instanceof Error ? error.message : "Unable to update kill switch",
                            variant: "destructive",
                          });
                        },
                      },
                    );
                  }}
                >
                  Release
                </Button>
              </div>
            </div>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Address</p>
                <p className="font-medium truncate">{viewData?.wallet?.address || "Not connected"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">SOL Balance</p>
                <p className="font-medium">{walletSolLabel}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Connection</p>
                <p className="font-medium">{walletConnected ? "Connected" : "Disconnected"}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Private key status: {walletPrivateKeyConfigured ? (walletConnected ? "Configured and connected" : "Configured (pending reconnect)") : "Not configured"}
            </div>
            {walletConnected && (
              <div className="flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs">
                <span className="font-medium text-green-300">Wallet is connected and ready for live execution.</span>
                <Badge variant="outline" className="border-green-500/40 text-green-300">CONNECTED</Badge>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const address = String(viewData?.wallet?.address || "").trim();
                  if (!address) return;
                  navigator.clipboard.writeText(address);
                  toast({ title: "Copied", description: "Wallet address copied." });
                }}
                disabled={!viewData?.wallet?.address}
              >
                <Copy className="w-4 h-4 mr-1" /> Copy Address
              </Button>
              {walletConnected ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDisconnectWallet}
                  disabled={disconnectWalletMutation.isPending}
                >
                  Disconnect Wallet
                </Button>
              ) : null}
            </div>
            {!walletConnected && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
                Connect Wallet uses your saved Wallet tab key automatically. If no wallet is saved yet, you will be redirected to Wallet to create or connect one.
              </div>
            )}
          </div>

          {isRetardioMode && (
            <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
              Retardio is an independent agent. DoctorTrade risk presets and strategy controls are hidden in this mode.
            </div>
          )}

          {!isRetardioMode && (
            <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Core risk defaults stay protected. You can customize only Buy Amount, Take Profit, and Stop Loss.
            </div>
          )}

          <div className="mb-3 rounded-md border border-border/60 bg-background/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Trading Mode</p>
              <Badge variant="outline" className={tradingModeInput === "retardio" ? "border-emerald-500/40 text-emerald-300" : "border-blue-500/40 text-blue-300"}>
                {tradingModeInput === "retardio" ? "Retardio" : "Doctor"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={tradingModeInput === "doctor" ? "default" : "outline"}
                onClick={() => setTradingModeInput("doctor")}
              >
                Doctor Mode
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tradingModeInput === "retardio" ? "default" : "outline"}
                onClick={() => setTradingModeInput("retardio")}
              >
                Retardio Mode
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {tradingModeInput === "retardio"
                ? "Retardio runs independently: selective entries, one active trade, max 2 entries per hour, and autonomous TP/SL management."
                : "Doctor mode uses the existing fast DoctorTrade decision flow."}
            </p>
          </div>

          {!isRetardioMode && simpleMode && (
            <div className="rounded-md border border-border/60 bg-background/50 p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Buy Amount (SOL)</p>
                  <Input value={buyAmountInput} onChange={(e) => setBuyAmountInput(e.target.value)} placeholder="0.1" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Take Profit Multiplier</p>
                  <Input value={tpMultInput} onChange={(e) => setTpMultInput(e.target.value)} placeholder="1.8" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Stop Loss %</p>
                  <Input value={stopLossInput} onChange={(e) => setStopLossInput(e.target.value)} placeholder="12" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={saveBasicTradingControls} disabled={configMutation.isPending}>
                  {configMutation.isPending ? "Saving..." : "Save Trading Controls"}
                </Button>
              </div>
            </div>
          )}

          {!isRetardioMode && !simpleMode && <>
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-2 items-end">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Scan Interval (sec)</p>
              <Input value={intervalInput} onChange={(e) => setIntervalInput(e.target.value)} placeholder="10" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Buy Amount (SOL, min 0.1)</p>
              <Input value={buyAmountInput} onChange={(e) => setBuyAmountInput(e.target.value)} placeholder="0.1" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Trades / 24h</p>
              <Input value={maxTradesInput} onChange={(e) => setMaxTradesInput(e.target.value)} placeholder="12" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Take Profit Multiplier</p>
              <Input value={tpMultInput} onChange={(e) => setTpMultInput(e.target.value)} placeholder="2.0" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Min Profit Sell %</p>
              <Input value={minProfitInput} onChange={(e) => setMinProfitInput(e.target.value)} placeholder="12" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Stop Loss %</p>
              <Input value={stopLossInput} onChange={(e) => setStopLossInput(e.target.value)} placeholder="6" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Trailing Stop %</p>
                <Input value={trailInput} onChange={(e) => setTrailInput(e.target.value)} placeholder="10" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 items-end mt-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Min Liquidity USD</p>
              <Input value={minLiquidityInput} onChange={(e) => setMinLiquidityInput(e.target.value)} placeholder="20000" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Max Slippage %</p>
              <Input value={maxSlippageInput} onChange={(e) => setMaxSlippageInput(e.target.value)} placeholder="4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Max Spread %</p>
              <Input value={maxSpreadInput} onChange={(e) => setMaxSpreadInput(e.target.value)} placeholder="3" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Daily Loss Limit $</p>
              <Input value={dailyLossInput} onChange={(e) => setDailyLossInput(e.target.value)} placeholder="600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Max Consecutive Losses</p>
              <Input value={maxConsecutiveLossesInput} onChange={(e) => setMaxConsecutiveLossesInput(e.target.value)} placeholder="3" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Strong Move %</p>
              <Input value={strongMoveInput} onChange={(e) => setStrongMoveInput(e.target.value)} placeholder="40" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Max Hold Minutes</p>
              <Input value={maxHoldMinutesInput} onChange={(e) => setMaxHoldMinutesInput(e.target.value)} placeholder="180" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Min Momentum Profit %</p>
              <Input value={minMomentumInput} onChange={(e) => setMinMomentumInput(e.target.value)} placeholder="4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Quality Min Spike %</p>
              <Input value={qualityMinSpikeInput} onChange={(e) => setQualityMinSpikeInput(e.target.value)} placeholder="12" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Quality Max Holder %</p>
              <Input value={qualityMaxHolderInput} onChange={(e) => setQualityMaxHolderInput(e.target.value)} placeholder="35" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Gas Priority (lamports)</p>
              <Input value={gasPriorityInput} onChange={(e) => setGasPriorityInput(e.target.value)} placeholder="0" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Live Sell Fraction %</p>
              <Input value={liveSellFractionInput} onChange={(e) => setLiveSellFractionInput(e.target.value)} placeholder="50" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Max Sell Notional $</p>
              <Input value={maxSellNotionalInput} onChange={(e) => setMaxSellNotionalInput(e.target.value)} placeholder="300" />
            </div>
          </div>
          <div className="mt-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Adaptive Learning Controls</p>
              <Button
                size="sm"
                variant={mlLearningEnabledInput ? "default" : "outline"}
                onClick={() => setMlLearningEnabledInput((prev) => !prev)}
              >
                {mlLearningEnabledInput ? "Learning On" : "Learning Off"}
              </Button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Min Closed Trades</p>
                <Input value={mlMinClosedTradesInput} onChange={(e) => setMlMinClosedTradesInput(e.target.value)} placeholder="8" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Lookback Trades</p>
                <Input value={mlLookbackTradesInput} onChange={(e) => setMlLookbackTradesInput(e.target.value)} placeholder="40" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Bonus Cap Score</p>
                <Input value={mlBonusCapInput} onChange={(e) => setMlBonusCapInput(e.target.value)} placeholder="18" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Min Size Mult</p>
                <Input value={mlSizeMinInput} onChange={(e) => setMlSizeMinInput(e.target.value)} placeholder="0.7" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Max Size Mult</p>
                <Input value={mlSizeMaxInput} onChange={(e) => setMlSizeMaxInput(e.target.value)} placeholder="1.2" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={resetLearningMutation.isPending}
                onClick={() => {
                  const confirmed = window.confirm("Reset DoctorTrade learning profile? This clears adaptive statistics and profile memory.");
                  if (!confirmed) {
                    return;
                  }
                  resetLearningMutation.mutate(undefined, {
                    onSuccess: () => {
                      toast({ title: "Learning reset", description: "Adaptive learning profile was reset." });
                    },
                    onError: (error) => {
                      toast({
                        title: "Reset failed",
                        description: error instanceof Error ? error.message : "Unable to reset learning profile.",
                        variant: "destructive",
                      });
                    },
                  });
                }}
              >
                {resetLearningMutation.isPending ? "Resetting..." : "Reset Learning Model"}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex justify-end border-t border-border/40 pt-3">
            <Button
              variant="outline"
              onClick={
                isRetardioMode
                  ? saveTradingModeOnly
                  : (simpleMode ? saveBasicTradingControls : saveRiskRules)
              }
              disabled={configMutation.isPending}
            >
              {isRetardioMode
                ? "Save Trading Mode"
                : (simpleMode ? "Save Trading Controls" : "Save Settings")}
            </Button>
          </div>
          </>}
        </SettingsMenuCard>

        {doctorTab === "trading" && (
          <>
            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-3 backdrop-blur-md">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold">Live Ticker</p>
                <Badge variant="outline" className={autoSnipeReady ? "border-green-500/40 text-green-400" : "border-yellow-500/40 text-yellow-400"}>
                  {autoSnipeReady ? "Auto-Snipe Active" : "Auto-Snipe Waiting"}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">{autoSnipeStatusLabel}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {tickerTokens.map((token) => (
                  <div key={token.address} className="min-w-[180px] rounded-lg border border-slate-700/80 bg-slate-900/80 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TokenAvatar
                          logoUrl={token.logo_url}
                          symbol={token.symbol}
                          name={token.name}
                          className="h-5 w-5 border-none"
                          fallbackClassName="text-[9px]"
                        />
                        <p className="text-xs font-semibold truncate">{token.symbol}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground">S {Math.round(token.score)}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{fmtUsd(token.liquidity)} · {fmtUsd(token.volume_5m)}</p>
                  </div>
                ))}
                {!tickerTokens.length && <p className="text-xs text-muted-foreground">No new Solana launches to snipe (last 24h).</p>}
              </div>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 xl:col-span-3 backdrop-blur-md">
            <h2 className="text-sm font-semibold mb-1">Safe Buys</h2>
            <p className="text-[11px] text-muted-foreground mb-3">{safeBuyTokens.length} candidate{safeBuyTokens.length === 1 ? "" : "s"} ready for review</p>
            <div className="space-y-2 max-h-[640px] overflow-auto">
              {safeBuyTokens.map((token: any) => (
                <div key={token.address} className="rounded-lg border border-slate-700/80 bg-slate-900/80 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <TokenAvatar
                        logoUrl={token.logo_url}
                        symbol={token.symbol}
                        name={token.name}
                        className="h-6 w-6 border-none"
                        fallbackClassName="text-[10px]"
                      />
                      <p className="text-sm font-semibold truncate">{token.symbol}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px]">{Math.round(token.score)}</Badge>
                      <Badge variant="outline" className="text-[10px]">{String(token.safety_tier || token.eligible ? "strict" : "soft")}</Badge>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Liq {fmtUsd(token.liquidity)} · Vol5m {fmtUsd(token.volume_5m)}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{token.address}</p>
                </div>
              ))}
              {safeBuyTokens.length === 0 && <p className="text-sm text-muted-foreground">No safe buys currently surfaced.</p>}
            </div>
          </Card>

          <div className="xl:col-span-6 space-y-4">
            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4" />Performance</h2>
                <p className="text-xs text-muted-foreground">Win-rate vs drawdown</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={performanceSeries.length ? performanceSeries : [{ name: "0", winRate: 0, drawdown: 0 }]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Area isAnimationActive={false} type="monotone" dataKey="winRate" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
                    <Line isAnimationActive={false} type="monotone" dataKey="drawdown" stroke="hsl(var(--destructive))" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4" />Execution Pulse</h2>
                <p className="text-xs text-muted-foreground">Confidence and size</p>
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={tradeSeries.length ? tradeSeries : [{ name: "0", confidence: 0, size: 0 }]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Line isAnimationActive={false} type="monotone" dataKey="confidence" stroke="hsl(var(--chart-2, var(--primary)))" dot={false} />
                    <Line isAnimationActive={false} type="monotone" dataKey="size" stroke="hsl(var(--chart-4, var(--accent)))" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Radio className="w-4 h-4" />Recent Executions</h2>
              <div className="space-y-2 max-h-56 overflow-auto">
                {(viewData?.recent_trades || []).slice(0, 12).map((trade, index) => (
                  <div key={`${trade.address || "row"}-${index}`} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{trade.token || "UNKNOWN"}</p>
                      <Badge variant="outline" className="text-[10px]">{trade.action || "-"}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{trade.status || "unknown"} · conf {Number(trade.confidence ?? 0)}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtTs(trade.timestamp)} · size {Number(trade.size_pct ?? 0).toFixed(2)}%</p>
                  </div>
                ))}
                {!viewData?.recent_trades?.length && <p className="text-sm text-muted-foreground">No execution history yet.</p>}
              </div>
            </Card>

            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <h2 className="text-sm font-semibold mb-3">Decision Journal</h2>
              <div className="space-y-2 max-h-56 overflow-auto">
                {decisionJournalRows.map((row, index) => (
                  <div key={`${row.address || "journal"}-${index}`} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{row.token || "UNKNOWN"}</p>
                      <Badge variant="outline" className="text-[10px]">{row.decision || "-"}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{row.reason || "-"} · conf {row.confidence ?? 0}</p>
                    {(Number.isFinite(Number(row.ml_learned_bonus)) || Number.isFinite(Number(row.ml_size_multiplier))) && (
                      <p className="text-[11px] text-muted-foreground">
                        ML bonus {Number(row.ml_learned_bonus || 0) >= 0 ? "+" : ""}{Number(row.ml_learned_bonus || 0).toFixed(2)}
                        {" · "}
                        size mult {Number(row.ml_size_multiplier || 0) > 0 ? `${Number(row.ml_size_multiplier || 0).toFixed(3)}x` : "n/a"}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">{fmtTs(row.timestamp)} · size {(row.size_pct ?? 0).toFixed(2)}%</p>
                  </div>
                ))}
                {!decisionJournalRows.length && <p className="text-sm text-muted-foreground">No decisions logged yet.</p>}
              </div>
            </Card>
          </div>

          <div className="xl:col-span-3 space-y-4">
            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <h2 className="text-sm font-semibold mb-3">Account</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Engine</span><span>{viewData?.enabled ? "Live" : "Stopped"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Runtime</span><span>Server-side autonomous</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet Link</span><span>{walletConnected ? "Connected" : "Missing"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Execution Mode</span><span>LIVE ONLY</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Live Capable</span><span>{viewData?.execution?.live_capable ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span>Solana</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Trading Mode</span><span>{String(viewData?.trading_mode || "doctor").toUpperCase()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet SOL</span><span>{walletSolLabel}</span></div>
                {!isRetardioActive ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Trades Today</span><span>{viewData?.trade_controls?.trades_today || 0}/{viewData?.trade_controls?.max_trades_per_day || 12}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Buy Amount</span><span>{(viewData?.trade_controls?.buy_amount_sol || 0.1).toFixed(3)} SOL</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Stop Loss</span><span>{(viewData?.trade_controls?.stop_loss_pct || 6).toFixed(1)}%</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span>{(viewData?.trade_controls?.take_profit_multiplier || 2).toFixed(2)}x</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Max Slippage</span><span>{(viewData?.trade_controls?.max_slippage_pct || 0).toFixed(1)}%</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Daily Loss Limit</span><span>${(viewData?.trade_controls?.daily_loss_limit_usd || 0).toFixed(0)}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between"><span className="text-muted-foreground">Retardio Profile</span><span>Managed Internally</span></div>
                )}
              </div>
            </Card>

            <Card className="rounded-2xl border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-slate-900/70 p-4 backdrop-blur-md">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold">Adaptive Learning</h2>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={learningSummary.trained ? "border-cyan-500/40 text-cyan-300" : "border-yellow-500/40 text-yellow-300"}
                  >
                    {learningSummary.trained ? "Trained" : "Collecting Data"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={resetLearningMutation.isPending}
                    onClick={() => {
                      const confirmed = window.confirm("Reset DoctorTrade learning profile? This clears adaptive statistics and profile memory.");
                      if (!confirmed) {
                        return;
                      }
                      resetLearningMutation.mutate(undefined, {
                        onSuccess: () => {
                          toast({ title: "Learning reset", description: "Adaptive learning profile was reset." });
                        },
                        onError: (error) => {
                          toast({
                            title: "Reset failed",
                            description: error instanceof Error ? error.message : "Unable to reset learning profile.",
                            variant: "destructive",
                          });
                        },
                      });
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">ML Enabled</span><span>{learningSummary.enabled ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Closed Trades</span><span>{learningSummary.closedTrades}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Win Rate</span><span>{learningSummary.winRatePct.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avg PnL</span><span>{learningSummary.avgPnlPct.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Risk Posture</span><span className="capitalize">{learningSummary.posture}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Confidence Shift</span><span>{learningSummary.adaptiveConfidenceDelta >= 0 ? "+" : ""}{learningSummary.adaptiveConfidenceDelta.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Size Multiplier</span><span>{learningSummary.sizeMultiplier.toFixed(3)}x</span></div>
              </div>

              <div className="mt-3 rounded-md border border-border/60 bg-background/50 p-2">
                <p className="text-xs font-medium mb-1">Latest ML Bias</p>
                {learningSummary.latestMlDecision ? (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      Token {String(learningSummary.latestMlDecision.token || "UNKNOWN")} was tagged with {learningSummary.latestBiasLabel.replace("_", " ")}.
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Learned bonus {learningSummary.latestBonus >= 0 ? "+" : ""}{learningSummary.latestBonus.toFixed(2)} and effective size {learningSummary.latestSizeMult > 0 ? `${learningSummary.latestSizeMult.toFixed(3)}x` : "n/a"}.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">No learned decision rows yet. Execute more cycles to populate ML explanation.</p>
                )}
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">
                Risk gate is automatically {learningSummary.posture} by shifting minimum confidence by {learningSummary.adaptiveConfidenceDelta >= 0 ? "+" : ""}{learningSummary.adaptiveConfidenceDelta.toFixed(2)} points.
              </p>
            </Card>

            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <h2 className="text-sm font-semibold mb-3">Sniper Logs</h2>
              <div className="space-y-2 max-h-[220px] overflow-auto">
                {(viewData?.sniper_logs || []).slice(0, 12).map((row, index) => (
                  <div key={`${row?.mint || row?.address || "sniper"}-${index}`} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold truncate">{row?.symbol || row?.token || "UNKNOWN"}</p>
                      <Badge variant="outline" className="text-[10px]">{String(row?.event || "-")}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">Mint: {fmtMint(String(row?.mint || row?.address || ""))}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{row?.reason || "-"}</p>
                    <p className="text-[11px] text-muted-foreground">Strategy: {activeMateAgentLabel}</p>
                    {(Number(row?.age_seconds || 0) > 0 || Number(row?.liquidity_sol || 0) > 0 || Number(row?.volume_5m_sol || 0) > 0) && (
                      <p className="text-[11px] text-muted-foreground">
                        Age {Math.max(0, Number(row?.age_seconds || 0)).toFixed(0)}s · LQ {Number(row?.liquidity_sol || 0).toFixed(2)} SOL · Vol5m {Number(row?.volume_5m_sol || 0).toFixed(2)} SOL
                      </p>
                    )}
                    {(Number(row?.buys_5m || 0) > 0 || Number(row?.sells_5m || 0) > 0 || Number(row?.ai_confidence || 0) > 0) && (
                      <p className="text-[11px] text-muted-foreground">
                        Buys/Sells 5m: {Number(row?.buys_5m || 0)} / {Number(row?.sells_5m || 0)} · AI {Number(row?.ai_confidence || 0).toFixed(1)}
                      </p>
                    )}
                    {(Number(row?.required_sol || 0) > 0 || Number(row?.available_sol || 0) > 0) && (
                      <p className="text-[11px] text-muted-foreground">
                        Need {Number(row?.required_sol || 0).toFixed(4)} SOL · Have {Number(row?.available_sol || 0).toFixed(4)} SOL
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">{fmtTs(row?.at)}</p>
                  </div>
                ))}
                {!viewData?.sniper_logs?.length && <p className="text-sm text-muted-foreground">No sniper logs yet.</p>}
              </div>
            </Card>

            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <h2 className="text-sm font-semibold mb-3">Order Ticket</h2>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border p-2">
                    <p className="text-muted-foreground">Buy SOL</p>
                    <p className="font-semibold">{(viewData?.trade_controls?.buy_amount_sol || 0.1).toFixed(3)}</p>
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-muted-foreground">Trades/24h</p>
                    <p className="font-semibold">{viewData?.trade_controls?.max_trades_per_day || 12}</p>
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-muted-foreground">TP Multiplier</p>
                    <p className="font-semibold">{(viewData?.trade_controls?.take_profit_multiplier || 2).toFixed(2)}x</p>
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-muted-foreground">SL %</p>
                    <p className="font-semibold">{(viewData?.trade_controls?.stop_loss_pct || 6).toFixed(1)}%</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" variant="outline" onClick={() => setSettingsOpen(true)}>
                    Open Settings
                  </Button>
                  <Button
                    className="flex-1"
                    variant={viewData?.enabled ? "destructive" : "default"}
                    onClick={handleToggleDoctor}
                    disabled={controlMutation.isPending}
                  >
                    {viewData?.enabled ? "Disarm" : "Arm Sniper"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {autoSnipeReady
                    ? "Sniper is armed and can auto-trade approved fresh tokens."
                    : "Sniper needs engine ON and connected wallet."}
                </p>
              </div>
            </Card>

            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <h2 className="text-sm font-semibold mb-3">Open Positions</h2>
              <div className="space-y-2 max-h-[300px] overflow-auto">
                {(viewData?.positions || []).map((position) => (
                  <div key={position.address} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <TokenAvatar
                          logoUrl={(position as any).logo_url}
                          symbol={position.symbol}
                          name={position.symbol}
                          className="h-6 w-6 border-none"
                          fallbackClassName="text-[10px]"
                        />
                        <p className="text-sm font-semibold truncate">{position.symbol}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{position.risk_status}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Entry ${Number(position.entry_price || 0).toFixed(6)} · Now ${Number(position.current_price || 0).toFixed(6)}</p>
                    <p className="text-[11px] text-muted-foreground">Liq {fmtUsd(Number(position.liquidity || 0))} · Conf {Number(position.confidence || 0)}</p>
                    <p className={`text-[11px] ${Number((position as any).pnl_pct || 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      PnL {Number((position as any).pnl_pct || 0).toFixed(2)}% · Value {fmtUsd(Number((position as any).worth_usd || 0))}
                    </p>
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={directSellMutation.isPending}
                        onClick={() => handleDirectSell(position)}
                      >
                        {directSellMutation.isPending ? "Selling..." : "Quick Sell"}
                      </Button>
                    </div>
                  </div>
                ))}
                {!viewData?.positions?.length && <p className="text-sm text-muted-foreground">No open positions.</p>}
              </div>
            </Card>

            <Card className="rounded-2xl border-slate-700/70 bg-slate-900/75 p-4 backdrop-blur-md">
              <h2 className="text-sm font-semibold mb-3">Wallet Tokens</h2>
              <div className="space-y-2 max-h-[240px] overflow-auto">
                {(viewData?.wallet_tokens || []).map((token) => (
                  <div key={token.mint} className="border rounded-md p-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <TokenAvatar
                        logoUrl={(token as any).logo_url}
                        symbol={(token as any).symbol || token.mint.slice(0, 4)}
                        name={(token as any).name || token.mint}
                        className="h-6 w-6 border-none"
                        fallbackClassName="text-[10px]"
                      />
                      <p className="text-xs font-semibold break-all">{token.mint}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Balance {Number(token.ui_amount || 0).toFixed(6)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {(token as any).symbol ? `${String((token as any).symbol)} · ` : ""}
                      Value {fmtUsd(Number((token as any).worth_usd || 0))}
                    </p>
                  </div>
                ))}
                {!viewData?.wallet_tokens?.length && <p className="text-sm text-muted-foreground">No SPL tokens detected for this wallet yet.</p>}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold mb-3">Wallet Transactions</h2>
              <div className="space-y-2 max-h-[240px] overflow-auto">
                {(viewData?.wallet_transactions || []).map((tx) => (
                  <div key={tx.signature} className="border rounded-md p-2">
                    <p className="text-xs font-semibold break-all">{tx.signature}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtTs(tx.block_time || undefined)} · {String(tx.confirmation_status || "unknown")}</p>
                    {tx.err ? <p className="text-[11px] text-red-500">Failed</p> : <p className="text-[11px] text-emerald-500">Confirmed</p>}
                    {(tx as any).explorer_url ? (
                      <a
                        href={String((tx as any).explorer_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-primary underline"
                      >
                        View on Solscan
                      </a>
                    ) : null}
                  </div>
                ))}
                {!viewData?.wallet_transactions?.length && <p className="text-sm text-muted-foreground">No recent on-chain transactions found.</p>}
              </div>
            </Card>

            {viewData?.tuning_suggestion && (
              <Card className="p-4 border-accent/30 bg-accent/5">
                <p className="text-xs text-muted-foreground">Tuning Suggestion</p>
                <p className="text-sm mt-1">{viewData.tuning_suggestion}</p>
              </Card>
            )}
          </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
