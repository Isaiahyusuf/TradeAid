import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Power, Activity, TrendingUp, BarChart3, Radio, BookOpen } from "lucide-react";
import { useDoctorControl, useDoctorDirectBuy, useDoctorHealth, useDoctorRunOnce, useDoctorStatus } from "@/hooks/use-doctortrade";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

function isDoctorWalletConnected(wallet?: Record<string, any> | null, tradeControls?: Record<string, any> | null) {
  const address = String(wallet?.address || "").trim();
  if (!address) return false;

  const statusConnected = String(wallet?.connection_status || "").trim().toLowerCase() === "connected";
  const keyConfigured = Boolean(wallet?.private_key_configured);
  const controlsConnected = Boolean(tradeControls?.wallet_connected);
  return statusConnected || keyConfigured || controlsConnected;
}

export default function DoctorTrade() {
    // Only show new launches on Solana (created within 24h and chain is solana)
    // (Declarations moved below after viewData is defined)
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useDoctorStatus();
  const doctorHealth = useDoctorHealth();
  const { toast } = useToast();
  const controlMutation = useDoctorControl();
  const runMutation = useDoctorRunOnce();
  const directBuyMutation = useDoctorDirectBuy();
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
            This page now provides execution controls only: start, stop, run cycle, and refresh.
          </p>

          <details className="group rounded-md border border-primary/25 bg-background/60 p-3 hover:border-primary/45 transition-colors">
            <summary className="cursor-pointer text-sm font-medium">1) Start and monitor</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              <li>Click <span className="font-medium text-foreground">Start DoctorTrade</span> to enable autonomous cycles.</li>
              <li>Use <span className="font-medium text-foreground">Run Cycle</span> for an immediate evaluation pass.</li>
              <li>Use <span className="font-medium text-foreground">Refresh Data</span> to pull latest status and logs.</li>
            </ul>
          </details>

          <details className="group rounded-md border border-accent/25 bg-background/60 p-3 hover:border-accent/45 transition-colors">
            <summary className="cursor-pointer text-sm font-medium">2) Troubleshoot quickly</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              <li>If start fails, check the status badges and latest execution message.</li>
              <li>Use <span className="font-medium text-foreground">Refresh Data</span> after each action to confirm current backend state.</li>
              <li>If needed, stop then start DoctorTrade again to re-sync runtime controls.</li>
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

        <Card className="p-4 border-border/60 bg-muted/20">
          <p className="text-sm font-semibold">DoctorTrade Controls Simplified</p>
          <p className="text-xs text-muted-foreground mt-1">
            Per request, wallet and preset/risk settings are hidden from this page. Use only the Start/Stop button to control DoctorTrade.
          </p>
        </Card>

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
