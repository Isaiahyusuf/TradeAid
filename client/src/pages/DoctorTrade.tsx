import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Power, Activity, Wallet, TrendingUp, BarChart3, Radio, Copy, BookOpen } from "lucide-react";
import { useDoctorConfig, useDoctorConnectWallet, useDoctorControl, useDoctorDirectBuy, useDoctorDisconnectWallet, useDoctorHealth, useDoctorRunOnce, useDoctorStatus } from "@/hooks/use-doctortrade";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";
import { TokenAvatar } from "@/components/token/TokenAvatar";

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

const DOCTOR_SETTINGS_LOCAL_KEY = "doctortrade.settings.local.v1";
type SnipePreset = "conservative" | "balanced" | "aggressive" | "insider" | "custom";

export default function DoctorTrade() {
    // Only show new launches on Solana (created within 24h and chain is solana)
    // (Declarations moved below after viewData is defined)
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useDoctorStatus();
  const doctorHealth = useDoctorHealth();
  const { toast } = useToast();
  const controlMutation = useDoctorControl();
  const configMutation = useDoctorConfig();
  const connectWalletMutation = useDoctorConnectWallet();
  const disconnectWalletMutation = useDoctorDisconnectWallet();
  const runMutation = useDoctorRunOnce();
  const directBuyMutation = useDoctorDirectBuy();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [intervalInput, setIntervalInput] = useState("20");
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
    setIntervalInput(String(controls.scan_interval_seconds ?? 20));
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

  const persistSettingsLocalBackup = (payload: Record<string, any>) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DOCTOR_SETTINGS_LOCAL_KEY, JSON.stringify(payload));
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
        const raw = window.localStorage.getItem(DOCTOR_SETTINGS_LOCAL_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, any>;
        if (parsed && typeof parsed === "object") {
          hydrateSettingsInputs(parsed);
        }
      } catch {
      }
    }
  }, [viewData?.trade_controls]);

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

  const scannerSuccessRate = Number(viewData?.scanner_health?.overall?.success_rate_pct || 0);
  const walletConnected = Boolean(
    String(viewData?.wallet?.connection_status || "").toLowerCase() === "connected"
    && viewData?.wallet?.private_key_configured
    && String(viewData?.wallet?.address || "").trim(),
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
        snipe_preset: selectedSnipePreset,
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
            snipe_preset: selectedSnipePreset,
            wallet_address: String(viewData?.wallet?.address || ""),
          });
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
          const persistedConnected = Boolean(
            String(status?.wallet?.connection_status || "").toLowerCase() === "connected"
            && status?.wallet?.private_key_configured
            && String(status?.wallet?.address || "").trim(),
          );
          if (!persistedConnected) {
            toast({
              title: "Wallet not persisted",
              description: "Connection response did not include saved wallet credentials. Please retry.",
              variant: "destructive",
            });
            return;
          }
          setPrivateKeyInput("");
          persistSettingsLocalBackup({
            ...(viewData?.trade_controls || {}),
            wallet_address: String(status?.wallet?.address || ""),
          });
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
        });
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
          description: enabledNow ? "Autonomous engine is now active." : "Autonomous engine has been paused.",
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
            {doctorHealth.isError && (
              <Badge variant="destructive">Backend target mismatch</Badge>
            )}
            {doctorHealth.data?.ok && (
              <Badge variant="outline" className="border-green-500/40 text-green-400">Backend Healthy</Badge>
            )}
          </div>
          <div className="mt-3 text-xs text-muted-foreground flex items-center gap-3">
            <span>{isLoading ? "Loading DoctorTrade..." : isFetching ? "Updating live data..." : "Live sync active"}</span>
            <span>Last sync: {lastSyncLabel}</span>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-primary/10 via-card/80 to-accent/10 backdrop-blur-sm border-primary/30 shadow-[0_0_20px_rgba(99,102,241,0.15)] space-y-3 animate-in fade-in-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary animate-pulse" />
            <p className="text-sm font-semibold text-primary">DoctorTrade Manual (In-App)</p>
            <Badge variant="outline" className="ml-auto border-primary/40 text-primary">Quick Guide</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Quick step-by-step guide for setup, wallet connection, execution, and troubleshooting.
          </p>

          <details className="group rounded-md border border-primary/25 bg-background/60 p-3 hover:border-primary/45 transition-colors">
            <summary className="cursor-pointer text-sm font-medium">1) Connect wallet correctly</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              <li>Use <span className="font-medium text-foreground">Connect Existing Wallet</span> or paste private key under Manual Private Key Import.</li>
              <li>After connect, verify <span className="font-medium text-foreground">Connection = Connected</span>.</li>
              <li>Private key is encrypted and persisted until you disconnect or replace it.</li>
            </ul>
          </details>

          <details className="group rounded-md border border-accent/25 bg-background/60 p-3 hover:border-accent/45 transition-colors">
            <summary className="cursor-pointer text-sm font-medium">2) Configure risk controls</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              <li>Pick a preset (Conservative, Balanced, Aggressive, Insider Default).</li>
              <li>Adjust buy size, slippage, daily loss, hold time, and trade limits.</li>
              <li>Click <span className="font-medium text-foreground">Save Settings</span> before starting DoctorTrade.</li>
            </ul>
          </details>

          <details className="group rounded-md border border-primary/25 bg-background/60 p-3 hover:border-primary/45 transition-colors">
            <summary className="cursor-pointer text-sm font-medium">3) Start and monitor</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              <li>Click <span className="font-medium text-foreground">Start DoctorTrade</span> to enable autonomous cycles.</li>
              <li>Use <span className="font-medium text-foreground">Run Cycle</span> for an immediate evaluation pass.</li>
              <li>Use <span className="font-medium text-foreground">Refresh Data</span> to pull latest status and logs.</li>
            </ul>
          </details>

          <details className="group rounded-md border border-accent/25 bg-background/60 p-3 hover:border-accent/45 transition-colors">
            <summary className="cursor-pointer text-sm font-medium">4) Understand sniper rejections</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              <li>If reason ends with <span className="font-medium text-foreground">_conditions_failed</span>, check <span className="font-medium text-foreground">failed_checks</span> in sniper logs.</li>
              <li>Typical checks: liquidity window, buy/sell pressure, and 5m volume.</li>
              <li>Tune settings gradually; avoid over-loosening risk controls.</li>
            </ul>
          </details>

          <details className="group rounded-md border border-primary/25 bg-background/60 p-3 hover:border-primary/45 transition-colors">
            <summary className="cursor-pointer text-sm font-medium">5) Direct Buy behavior</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              <li>Direct Buy opens Wallet swap with token contract prefilled.</li>
              <li>Enter SOL amount and review estimated token output.</li>
              <li>Submit swap from wallet flow.</li>
            </ul>
          </details>
        </Card>

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Address</p>
                <p className="font-medium truncate">{viewData?.wallet?.address || "Not connected"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">SOL Balance</p>
                <p className="font-medium">{Number(viewData?.wallet?.balance_sol || 0).toFixed(4)} SOL</p>
              </div>
              <div>
                <p className="text-muted-foreground">Connection</p>
                <p className="font-medium">
                  {viewData?.wallet?.connection_status === "connected"
                    ? "Connected"
                    : "Disconnected"}
                </p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Private key status: {viewData?.wallet?.private_key_configured ? "Configured (persisted)" : "Not configured"}
            </div>
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
              <Button
                size="sm"
                variant="outline"
                onClick={handleDisconnectWallet}
                disabled={disconnectWalletMutation.isPending || !walletConnected}
              >
                Disconnect Wallet
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Manual Private Key Import</p>
                <Input
                  type="password"
                  value={privateKeyInput}
                  onChange={(event) => setPrivateKeyInput(event.target.value)}
                  placeholder="Paste Solana private key"
                />
              </div>
              <Button
                onClick={handleManualPrivateKeyConnect}
                disabled={connectWalletMutation.isPending}
              >
                Connect Wallet
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
              <Input value={intervalInput} onChange={(e) => setIntervalInput(e.target.value)} placeholder="20" />
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
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet Link</span><span>{walletConnected ? "Connected" : "Missing"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">API Target</span><span className="truncate max-w-[220px] text-right">{viewData?.api_target || "same-origin"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Execution Mode</span><span>LIVE ONLY</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Live Capable</span><span>{viewData?.execution?.live_capable ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span>Solana</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet SOL</span><span>{(viewData?.wallet?.balance_sol || 0).toFixed(4)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Trades Today</span><span>{viewData?.trade_controls?.trades_today || 0}/{viewData?.trade_controls?.max_trades_per_day || 12}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Buy Amount</span><span>{(viewData?.trade_controls?.buy_amount_sol || 0.1).toFixed(3)} SOL</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Stop Loss</span><span>{(viewData?.trade_controls?.stop_loss_pct || 6).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span>{(viewData?.trade_controls?.take_profit_multiplier || 2).toFixed(2)}x</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Scanner Health</span><span>{scannerSuccessRate.toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Max Slippage</span><span>{(viewData?.trade_controls?.max_slippage_pct || 0).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Daily Loss Limit</span><span>${(viewData?.trade_controls?.daily_loss_limit_usd || 0).toFixed(0)}</span></div>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold mb-3">Sniper Logs</h2>
              <div className="mb-2 text-[11px] text-muted-foreground">
                <p>Source: {viewData?.discovery?.dexscreener_primary ? "Dexscreener Primary" : "Mixed"}</p>
                <p>Worker: {viewData?.discovery?.worker_running ? "Running" : "Stopped"} · Poll {viewData?.discovery?.poll_interval_seconds || 7}s</p>
              </div>
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
                  </div>
                ))}
                {!viewData?.wallet_tokens?.length && <p className="text-sm text-muted-foreground">No SPL tokens detected in connected wallet.</p>}
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
