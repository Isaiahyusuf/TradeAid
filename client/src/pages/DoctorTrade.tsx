import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Power, Activity, Wallet, TrendingUp, BarChart3, Radio, Copy, BookOpen } from "lucide-react";
import { useDoctorConfig, useDoctorConnectWallet, useDoctorControl, useDoctorDirectBuy, useDoctorDirectSell, useDoctorDisconnectWallet, useDoctorRunOnce, useDoctorStatus } from "@/hooks/use-doctortrade";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";
import { TokenAvatar } from "@/components/token/TokenAvatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useLocation } from "wouter";

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

const DOCTOR_SETTINGS_LOCAL_KEY_PREFIX = "doctortrade.settings.local.v2";
const DOCTOR_SETTINGS_LOCAL_KEY_LEGACY = "doctortrade.settings.local.v1";
type SnipePreset = "conservative" | "balanced" | "aggressive" | "insider" | "custom";

function getDoctorSettingsLocalKey(userId?: string | null) {
  const normalizedUserId = String(userId || "").trim() || "anonymous";
  return `${DOCTOR_SETTINGS_LOCAL_KEY_PREFIX}:${normalizedUserId}`;
}

function isDoctorWalletConnected(wallet?: Record<string, any> | null, tradeControls?: Record<string, any> | null) {
  const address = String(wallet?.address || "").trim();
  if (!address) return false;

  const statusConnected = String(wallet?.connection_status || "").trim().toLowerCase() === "connected";
  const keyConfigured = Boolean(wallet?.private_key_configured);
  const controlsConnected = Boolean(tradeControls?.wallet_connected);
  return statusConnected || keyConfigured || controlsConnected;
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
  const directBuyMutation = useDoctorDirectBuy();
  const directSellMutation = useDoctorDirectSell();
  const [guideOpen, setGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [presetMode, setPresetMode] = useState<"default" | "custom">("default");
  const [selectedSnipePreset, setSelectedSnipePreset] = useState<SnipePreset>("insider");
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const hydratedFromLocalRef = useRef(false);
  const hydratedFromServerRef = useRef(false);
  const viewData = data;
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

  const normalizePreset = (value: unknown): SnipePreset => {
    const preset = String(value || "").trim().toLowerCase();
    if (preset === "conservative") return "conservative";
    if (preset === "balanced") return "balanced";
    if (preset === "aggressive" || preset === "agressive") return "aggressive";
    if (preset === "custom") return "custom";
    return "insider";
  };

  const hydrateSettingsInputs = (controls: Record<string, any>) => {
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
    const preset = normalizePreset(controls.snipe_preset);
    setSelectedSnipePreset(preset);
    setPresetMode(preset === "custom" ? "custom" : "default");
  };

  const persistSettingsLocalBackup = (payload: Record<string, any>, userId?: string | null) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(getDoctorSettingsLocalKey(userId), JSON.stringify(payload));
    } catch {
    }
  };

  useEffect(() => {
    const controls = viewData?.trade_controls as Record<string, any> | undefined;
    if (controls && !hydratedFromServerRef.current) {
      hydrateSettingsInputs(controls);
      hydratedFromServerRef.current = true;
      return;
    }

    if (!controls && !hydratedFromLocalRef.current && typeof window !== "undefined") {
      hydratedFromLocalRef.current = true;
      try {
        const runtimeUserId = String(viewData?.user_id || "").trim();
        // Do not hydrate from local fallback until we know which user is signed in.
        if (!runtimeUserId) {
          return;
        }
        const scopedRaw = window.localStorage.getItem(getDoctorSettingsLocalKey(runtimeUserId));
        const legacyRaw = window.localStorage.getItem(DOCTOR_SETTINGS_LOCAL_KEY_LEGACY);
        const candidatePayloads = [scopedRaw, legacyRaw].filter(Boolean) as string[];

        for (const raw of candidatePayloads) {
          const parsed = JSON.parse(raw) as Record<string, any>;
          if (!parsed || typeof parsed !== "object") continue;
          const parsedUserId = String(parsed.user_id || "").trim();
          // Never apply fallback values that are not explicitly owned by this user.
          if (!parsedUserId || runtimeUserId !== parsedUserId) continue;
          hydrateSettingsInputs(parsed);
          break;
        }
      } catch {
      }
    }
  }, [viewData?.trade_controls, viewData?.user_id]);

  useEffect(() => {
    const controls = viewData?.trade_controls as Record<string, any> | undefined;
    if (!controls) return;
    const presetFromServer = normalizePreset(controls.snipe_preset);
    setSelectedSnipePreset((prev) => (prev === presetFromServer ? prev : presetFromServer));
    setPresetMode(presetFromServer === "custom" ? "custom" : "default");
  }, [viewData?.trade_controls?.snipe_preset]);

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

  const walletConnected = isDoctorWalletConnected(
    (viewData?.wallet as Record<string, any> | undefined) || null,
    (viewData?.trade_controls as Record<string, any> | undefined) || null,
  );
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
  const lastSyncLabel = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "-";
  const walletSolBalance = Number(viewData?.wallet?.balance_sol || 0);
  const walletPrivateKeyConfigured = Boolean(viewData?.wallet?.private_key_configured);

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
    const maxHoldMinutes = Math.max(5, Math.trunc(Number.parseFloat(maxHoldMinutesInput) || 180));
    const minMomentumProfitPct = Math.max(0, Number.parseFloat(minMomentumInput) || 4);
    const qualityMinVolumeSpikePct = Math.max(0, Number.parseFloat(qualityMinSpikeInput) || 12);
    const qualityMaxTopHolderPct = Math.max(1, Number.parseFloat(qualityMaxHolderInput) || 35);
    const gasPriorityLamports = Math.max(0, Math.trunc(Number.parseFloat(gasPriorityInput) || 0));
    const liveSellFractionPct = Math.max(1, Math.min(100, Number.parseFloat(liveSellFractionInput) || 50));
    const maxSellNotionalUsd = Math.max(1, Number.parseFloat(maxSellNotionalInput) || 300);
    const presetDefaultBuyAmount: Record<Exclude<SnipePreset, "custom">, number> = {
      conservative: 0.1,
      balanced: 0.15,
      aggressive: 0.25,
      insider: 0.3,
    };
    const selectedPresetBeforeSave = selectedSnipePreset;
    const manualBuyOverrideDetected = selectedPresetBeforeSave !== "custom"
      && Math.abs(
        buyAmountSol - presetDefaultBuyAmount[selectedPresetBeforeSave as Exclude<SnipePreset, "custom">]
      ) > 0.000001;
    const presetForSave: SnipePreset = manualBuyOverrideDetected ? "custom" : selectedPresetBeforeSave;
    if (manualBuyOverrideDetected) {
      setPresetMode("custom");
      setSelectedSnipePreset("custom");
    }

    configMutation.mutate(
      {
        scan_interval_seconds: scanIntervalSeconds,
        buy_amount_sol: buyAmountSol,
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
        snipe_preset: presetForSave,
      },
      {
        onSuccess: () => {
          persistSettingsLocalBackup({
            scan_interval_seconds: scanIntervalSeconds,
            buy_amount_sol: buyAmountSol,
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
            snipe_preset: presetForSave,
            user_id: String(viewData?.user_id || ""),
            wallet_address: String(viewData?.wallet?.address || ""),
          }, viewData?.user_id);
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

  const applyPreset = (preset: Exclude<SnipePreset, "custom">) => {
    setSelectedSnipePreset(preset);
    setPresetMode("default");
    if (preset === "conservative") {
      setBuyAmountInput("0.1");
      setMaxTradesInput("6");
      setTpMultInput("1.8");
      setMinProfitInput("9");
      setStopLossInput("4");
      setTrailInput("7");
      setMinLiquidityInput("45000");
      setMaxSlippageInput("2.2");
      setMaxSpreadInput("1.8");
      setDailyLossInput("300");
      setMaxConsecutiveLossesInput("2");
      setStrongMoveInput("32");
      setMaxHoldMinutesInput("120");
      setMinMomentumInput("3");
      setQualityMinSpikeInput("18");
      setQualityMaxHolderInput("28");
      setLiveSellFractionInput("35");
      setMaxSellNotionalInput("180");
    }
    if (preset === "balanced") {
      setBuyAmountInput("0.15");
      setMaxTradesInput("12");
      setTpMultInput("2.0");
      setMinProfitInput("12");
      setStopLossInput("6");
      setTrailInput("10");
      setMinLiquidityInput("20000");
      setMaxSlippageInput("4");
      setMaxSpreadInput("3");
      setDailyLossInput("600");
      setMaxConsecutiveLossesInput("3");
      setStrongMoveInput("40");
      setMaxHoldMinutesInput("180");
      setMinMomentumInput("4");
      setQualityMinSpikeInput("12");
      setQualityMaxHolderInput("35");
      setLiveSellFractionInput("50");
      setMaxSellNotionalInput("300");
    }
    if (preset === "aggressive") {
      setBuyAmountInput("0.25");
      setMaxTradesInput("20");
      setTpMultInput("2.4");
      setMinProfitInput("15");
      setStopLossInput("8");
      setTrailInput("14");
      setMinLiquidityInput("12000");
      setMaxSlippageInput("6");
      setMaxSpreadInput("5");
      setDailyLossInput("1000");
      setMaxConsecutiveLossesInput("4");
      setStrongMoveInput("50");
      setMaxHoldMinutesInput("240");
      setMinMomentumInput("5");
      setQualityMinSpikeInput("8");
      setQualityMaxHolderInput("40");
      setLiveSellFractionInput("75");
      setMaxSellNotionalInput("650");
    }
    if (preset === "insider") {
      setBuyAmountInput("0.3");
      setMaxTradesInput("20");
      setTpMultInput("2.0");
      setMinProfitInput("100");
      setStopLossInput("35");
      setTrailInput("10");
      setMinLiquidityInput("300");
      setMaxSlippageInput("20");
      setMaxSpreadInput("10");
      setDailyLossInput("1000");
      setMaxConsecutiveLossesInput("5");
      setStrongMoveInput("45");
      setMaxHoldMinutesInput("120");
      setMinMomentumInput("8");
      setQualityMinSpikeInput("12");
      setQualityMaxHolderInput("15");
      setGasPriorityInput("500000");
      setLiveSellFractionInput("50");
      setMaxSellNotionalInput("10000");
    }
    configMutation.mutate(
      { snipe_preset: preset },
      {
        onSuccess: () => {
          toast({ title: "Preset applied", description: `${preset} preset is now active.` });
        },
        onError: (error) => {
          toast({
            title: "Preset save failed",
            description: error instanceof Error ? error.message : "Could not persist preset.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleManualPrivateKeyConnect = () => {
    const trimmedPrivateKey = String(privateKeyInput || "").trim();
    if (!trimmedPrivateKey) {
      toast({
        title: "Private key required",
        description: "Paste a Solana private key to connect DoctorTrade wallet.",
        variant: "destructive",
      });
      return;
    }

    const confirmed = window.confirm(
      "Private keys grant full wallet access.\n\nTradeAid encrypts keys before storage and decrypts only in memory for transaction signing. You are responsible for key security.\n\nConnect this wallet now?",
    );
    if (!confirmed) {
      return;
    }

    connectWalletMutation.mutate(
      { private_key: trimmedPrivateKey },
      {
        onSuccess: (status) => {
          const persistedConnected = isDoctorWalletConnected(
            (status?.wallet as Record<string, any> | undefined) || null,
            (status?.trade_controls as Record<string, any> | undefined) || null,
          );
          if (!persistedConnected) {
            toast({
              title: "Wallet not persisted",
              description: "Wallet connection is pending sync. Refreshing live status now.",
              variant: "destructive",
            });
            void refetch();
          }
          setPrivateKeyInput("");
          persistSettingsLocalBackup({
            ...(viewData?.trade_controls || {}),
            wallet_address: String(status?.wallet?.address || ""),
            user_id: String(viewData?.user_id || ""),
          }, viewData?.user_id);
          toast({ title: "Wallet connected", description: "DoctorTrade wallet connected from private key." });
        },
        onError: (error) => {
          toast({
            title: "Wallet connection failed",
            description: error instanceof Error ? error.message : "Could not connect wallet.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleConnectWallet = () => {
    setSettingsOpen(true);
    toast({
      title: "Private key required",
      description: "Use Manual Private Key Import in the settings panel to connect your DoctorTrade wallet.",
    });
  };

  const handleDisconnectWallet = () => {
    disconnectWalletMutation.mutate(undefined, {
      onSuccess: () => {
        persistSettingsLocalBackup({
          ...(viewData?.trade_controls || {}),
          wallet_address: "",
          user_id: String(viewData?.user_id || ""),
        }, viewData?.user_id);
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
    const nextEnabled = !Boolean(viewData?.enabled);
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
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Bot className="w-8 h-8 text-primary" />
              DoctorTrade Terminal
            </h1>
            <p className="text-muted-foreground">Autonomous multi-chain trading terminal with live watchlist, execution feed, and risk engine controls.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">Solana Only</Badge>
            <Badge variant="outline">Independent Engine</Badge>
            <Badge variant="outline">Runs Server-Side</Badge>
            <Badge variant="outline" className="border-green-500/40 text-green-400">Trade Mode LIVE ONLY</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Risk Locked</Badge>
            {!hasData && <Badge variant="outline">Syncing</Badge>}
          </div>
        </div>

        <Card className="p-4 bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              onClick={handleToggleDoctor}
              disabled={controlMutation.isPending}
              variant={viewData?.enabled ? "destructive" : "default"}
            >
              <Power className="w-4 h-4 mr-2" />
              {viewData?.enabled ? "Stop DoctorTrade" : "Start DoctorTrade"}
            </Button>
            <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !viewData?.enabled}>
              <Activity className="w-4 h-4 mr-2" /> Run Cycle
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <Activity className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> {isFetching ? "Syncing..." : "Refresh Data"}
            </Button>
            <Button variant="outline" onClick={() => setLocation("/disclaimer")}>
              Disclaimer
            </Button>
            <Button
              variant="outline"
              onClick={handleConnectWallet}
              disabled={connectWalletMutation.isPending || walletConnected}
            >
              <Wallet className="w-4 h-4 mr-2" /> {walletConnected ? "Wallet Connected" : "Use Private Key Below"}
            </Button>
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
            <span>Wallet SOL: {fmtSol(walletSolBalance)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            DoctorTrade runs on the server. Once started, it continues scanning and executing even when your browser is closed.
          </p>
        </Card>

        <SettingsMenuCard
          title="DoctorTrade Operating Guide"
          description="Professional quick-reference for setup, controls, and safe execution."
          open={guideOpen}
          onToggle={() => setGuideOpen((prev) => !prev)}
        >
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-primary animate-pulse" />
            <Badge variant="outline" className="border-primary/40 text-primary">Updated 2026</Badge>
          </div>

          <Accordion type="single" collapsible className="rounded-md border border-primary/25 bg-background/60 px-3">
            <AccordionItem value="setup" className="border-border/60">
              <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">1) First-time setup</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                <ul className="space-y-1 list-disc pl-5">
                  <li>Connect using <span className="font-medium text-foreground">Connect Existing Wallet</span> or Manual Private Key Import.</li>
                  <li>Confirm the wallet shows <span className="font-medium text-foreground">Connected</span> before trading.</li>
                  <li>Review buy size, slippage, and risk guardrails before enabling automation.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="controls" className="border-border/60">
              <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">2) Risk controls and presets</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                <ul className="space-y-1 list-disc pl-5">
                  <li>Start with a preset: Conservative, Balanced, Aggressive, or Insider Default.</li>
                  <li>Set daily loss cap, max trades, stop loss, take profit, and max hold time.</li>
                  <li>Press <span className="font-medium text-foreground">Save Settings</span> after every config change.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="operations" className="border-border/60">
              <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">3) Daily operating flow</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                <ul className="space-y-1 list-disc pl-5">
                  <li>Use <span className="font-medium text-foreground">Start DoctorTrade</span> to begin autonomous cycles.</li>
                  <li>Use <span className="font-medium text-foreground">Run Cycle</span> for immediate one-pass execution.</li>
                  <li>Use <span className="font-medium text-foreground">Refresh Data</span> to inspect live status, decisions, and positions.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="troubleshooting" className="border-border/60">
              <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">4) Troubleshooting and rejection reasons</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                <ul className="space-y-1 list-disc pl-5">
                  <li>If entries are skipped, inspect sniper logs for <span className="font-medium text-foreground">failed_checks</span>.</li>
                  <li>Common blockers: liquidity floor, spread cap, volume filter, or buy/sell pressure checks.</li>
                  <li>Adjust thresholds incrementally and avoid disabling multiple safeguards at once.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="security" className="border-b-0">
              <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">5) Security and emergency controls</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                <ul className="space-y-1 list-disc pl-5">
                  <li>Use the <span className="font-medium text-foreground">Kill Switch</span> for immediate forced stop.</li>
                  <li>Disconnect wallet when rotating keys or ending a trading session.</li>
                  <li>DoctorTrade is an assistive tool, not a profit guarantee. Review the Disclaimer page before trading.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </SettingsMenuCard>

        <SettingsMenuCard
          title="DoctorTrade Settings"
          description="Configure live-only trading, wallet session, and risk controls."
          open={settingsOpen}
          onToggle={() => setSettingsOpen((prev) => !prev)}
        >
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 mb-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Doctor Wallet</p>
              <Badge variant="outline" className="border-green-500/40 text-green-400">LIVE ONLY</Badge>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/50 p-2">
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
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Address</p>
                <p className="font-medium truncate">{viewData?.wallet?.address || "Not connected"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">SOL Balance</p>
                <p className="font-medium">{fmtSol(walletSolBalance)}</p>
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
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Manual Private Key Import</p>
                <Input
                  type="password"
                  value={privateKeyInput}
                  onChange={(event) => setPrivateKeyInput(event.target.value)}
                  placeholder="Paste Solana private key"
                  disabled={walletConnected}
                />
              </div>
              <Button
                onClick={handleManualPrivateKeyConnect}
                disabled={connectWalletMutation.isPending || walletConnected}
              >
                {walletConnected ? "Wallet Connected" : "Connect Wallet"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Warning: Private keys grant full wallet access. TradeAid encrypts keys before storage and decrypts only in memory to sign transactions.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-3 overflow-x-auto">
            <Button variant="outline" size="sm" onClick={() => applyPreset("conservative")}>Conservative</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("balanced")}>Balanced</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("aggressive")}>Aggressive</Button>
            <Button
              variant={presetMode === "default" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                applyPreset("insider");
              }}
            >
              Insider
            </Button>
            <Button
              variant={presetMode === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setPresetMode("custom");
                setSelectedSnipePreset("custom");
                configMutation.mutate(
                  { snipe_preset: "custom" },
                  {
                    onSuccess: () => {
                      toast({ title: "Preset applied", description: "custom preset is now active." });
                    },
                    onError: (error) => {
                      toast({
                        title: "Preset save failed",
                        description: error instanceof Error ? error.message : "Could not persist preset.",
                        variant: "destructive",
                      });
                    },
                  },
                );
              }}
            >
              Custom
            </Button>
          </div>
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
          <div className="mt-3 flex justify-end sticky bottom-0 bg-card/95 backdrop-blur py-2 border-t border-border/40">
            <Button
              variant="outline"
              onClick={saveRiskRules}
              disabled={configMutation.isPending}
            >
              Save Settings
            </Button>
          </div>
        </SettingsMenuCard>

        <Card className="p-3 bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold">Live Ticker</p>
            <Badge variant="outline" className={autoSnipeReady ? "border-green-500/40 text-green-400" : "border-yellow-500/40 text-yellow-400"}>
              {autoSnipeReady ? "Auto-Snipe Active" : "Auto-Snipe Waiting"}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">{autoSnipeStatusLabel}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tickerTokens.map((token) => (
              <div key={token.address} className="min-w-[180px] border rounded-md px-2 py-1.5">
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
            <Card className="p-4 xl:col-span-3">
            <h2 className="text-sm font-semibold mb-1">Safe Buys</h2>
            <p className="text-[11px] text-muted-foreground mb-3">{safeBuyTokens.length} candidate{safeBuyTokens.length === 1 ? "" : "s"} ready for review</p>
            <div className="space-y-2 max-h-[640px] overflow-auto">
              {safeBuyTokens.map((token: any) => (
                <div key={token.address} className="border rounded-md p-2">
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
            <Card className="p-4">
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

            <Card className="p-4">
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

            <Card className="p-4">
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

            <Card className="p-4">
              <h2 className="text-sm font-semibold mb-3">Decision Journal</h2>
              <div className="space-y-2 max-h-56 overflow-auto">
                {decisionJournalRows.map((row, index) => (
                  <div key={`${row.address || "journal"}-${index}`} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{row.token || "UNKNOWN"}</p>
                      <Badge variant="outline" className="text-[10px]">{row.decision || "-"}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{row.reason || "-"} · conf {row.confidence ?? 0}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtTs(row.timestamp)} · size {(row.size_pct ?? 0).toFixed(2)}%</p>
                  </div>
                ))}
                {!decisionJournalRows.length && <p className="text-sm text-muted-foreground">No decisions logged yet.</p>}
              </div>
            </Card>
          </div>

          <div className="xl:col-span-3 space-y-4">
            <Card className="p-4">
              <h2 className="text-sm font-semibold mb-3">Account</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Engine</span><span>{viewData?.enabled ? "Live" : "Stopped"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Runtime</span><span>Server-side autonomous</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet Link</span><span>{walletConnected ? "Connected" : "Missing"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Execution Mode</span><span>LIVE ONLY</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Live Capable</span><span>{viewData?.execution?.live_capable ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span>Solana</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet SOL</span><span>{fmtSol(walletSolBalance)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Trades Today</span><span>{viewData?.trade_controls?.trades_today || 0}/{viewData?.trade_controls?.max_trades_per_day || 12}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Buy Amount</span><span>{(viewData?.trade_controls?.buy_amount_sol || 0.1).toFixed(3)} SOL</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Stop Loss</span><span>{(viewData?.trade_controls?.stop_loss_pct || 6).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span>{(viewData?.trade_controls?.take_profit_multiplier || 2).toFixed(2)}x</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Max Slippage</span><span>{(viewData?.trade_controls?.max_slippage_pct || 0).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Daily Loss Limit</span><span>${(viewData?.trade_controls?.daily_loss_limit_usd || 0).toFixed(0)}</span></div>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold mb-3">Sniper Logs</h2>
              <div className="space-y-2 max-h-[220px] overflow-auto">
                {(viewData?.sniper_logs || []).slice(0, 12).map((row, index) => (
                  <div key={`${row?.mint || "sniper"}-${index}`} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold truncate">{row?.symbol || "UNKNOWN"}</p>
                      <Badge variant="outline" className="text-[10px]">{String(row?.event || "-")}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{row?.reason || "-"}</p>
                    <p className="text-[11px] text-muted-foreground">Preset: {String(row?.preset || viewData?.trade_controls?.snipe_preset || "insider")}</p>
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

            <Card className="p-4">
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

            <Card className="p-4">
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

            <Card className="p-4">
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
      </div>
    </Layout>
  );
}
