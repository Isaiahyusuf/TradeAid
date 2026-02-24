import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Power, Activity, Wallet, TrendingUp, BarChart3, Radio } from "lucide-react";
import { useDoctorConfig, useDoctorConnectWallet, useDoctorControl, useDoctorRunOnce, useDoctorStatus } from "@/hooks/use-doctortrade";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";

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

export default function DoctorTrade() {
  const { data } = useDoctorStatus();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const controlMutation = useDoctorControl();
  const configMutation = useDoctorConfig();
  const connectWalletMutation = useDoctorConnectWallet();
  const runMutation = useDoctorRunOnce();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [intervalInput, setIntervalInput] = useState("20");
  const [buyAmountInput, setBuyAmountInput] = useState("0.1");
  const [maxTradesInput, setMaxTradesInput] = useState("12");
  const [tpMultInput, setTpMultInput] = useState("2.0");
  const [minProfitInput, setMinProfitInput] = useState("12");
  const [stopLossInput, setStopLossInput] = useState("6");
  const [trailInput, setTrailInput] = useState("10");
  const viewData = data;
  const hasData = Boolean(viewData);

  useEffect(() => {
    if (!viewData?.trade_controls || settingsHydrated) return;
    setIntervalInput(String(viewData.scan_interval_seconds ?? 20));
    setBuyAmountInput(String(viewData.trade_controls.buy_amount_sol ?? 0.1));
    setMaxTradesInput(String(viewData.trade_controls.max_trades_per_day ?? 12));
    setTpMultInput(String(viewData.trade_controls.take_profit_multiplier ?? 2.0));
    setMinProfitInput(String(viewData.trade_controls.min_profit_pct ?? 12));
    setStopLossInput(String(viewData.trade_controls.stop_loss_pct ?? 6));
    setTrailInput(String(viewData.trade_controls.trailing_stop_pct ?? 10));
    setSettingsHydrated(true);
  }, [settingsHydrated, viewData?.trade_controls]);

  const performanceSeries = useMemo(
    () =>
      (viewData?.performance || []).slice(0, 12).reverse().map((row, index) => ({
        name: String(index + 1),
        winRate: Number((row?.latest_win_rate ?? row?.win_rate ?? 0) || 0) * 100,
        drawdown: Number((viewData?.risk_state.drawdown_pct ?? 0) || 0),
      })),
    [viewData?.performance, viewData?.risk_state.drawdown_pct],
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

  const scannerSuccessRate = Number(viewData?.scanner_health?.overall?.success_rate_pct || 0);
  const autoSnipeReady = Boolean(viewData?.enabled && viewData?.trade_controls?.wallet_connected);
  const tickerTokens = useMemo(
    () => (viewData?.active_tokens || []).slice(0, 10),
    [viewData?.active_tokens],
  );

  const saveRiskRules = () => {
    const scanIntervalSeconds = Math.max(5, Math.trunc(Number.parseFloat(intervalInput) || 20));
    const buyAmountSol = Math.max(0.1, Number.parseFloat(buyAmountInput) || 0.1);
    const maxTradesPerDay = Math.max(1, Math.trunc(Number.parseFloat(maxTradesInput) || 12));
    const takeProfitMultiplier = Math.max(1.01, Number.parseFloat(tpMultInput) || 2.0);
    const minProfitPct = Math.max(0.1, Number.parseFloat(minProfitInput) || 12);
    const stopLossPct = Math.max(0.1, Number.parseFloat(stopLossInput) || 6);
    const trailingStopPct = Math.max(0.1, Number.parseFloat(trailInput) || 10);

    configMutation.mutate(
      {
        scan_interval_seconds: scanIntervalSeconds,
        buy_amount_sol: buyAmountSol,
        max_trades_per_day: maxTradesPerDay,
        take_profit_multiplier: takeProfitMultiplier,
        min_profit_pct: minProfitPct,
        stop_loss_pct: stopLossPct,
        trailing_stop_pct: trailingStopPct,
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

  const handleConnectWallet = () => {
    connectWalletMutation.mutate(
      { use_existing_wallet: true },
      {
        onSuccess: () => {
          toast({ title: "Wallet connected", description: "DoctorTrade is now linked to your wallet." });
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : "Wallet connect failed";
          const lower = message.toLowerCase();
          if (
            lower.includes("wallet_setup_required_open_wallet_tab") ||
            lower.includes("no wallet found") ||
            lower.includes("wallet data missing") ||
            lower.includes("wallet not created") ||
            lower.includes("wallet")
          ) {
            setLocation("/wallet?action=connect&returnTo=%2Fdoctortrade");
            return;
          }
          toast({ title: "Wallet connection failed", description: message, variant: "destructive" });
        },
      },
    );
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
            <p className="text-muted-foreground">Axiom-style autonomous Solana trading terminal with live watchlist, execution feed, and risk engine controls.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">Solana Only</Badge>
            <Badge variant="outline">Independent Engine</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Risk Locked</Badge>
            {!hasData && <Badge variant="outline">Syncing</Badge>}
          </div>
        </div>

        <Card className="p-4 bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              onClick={() => controlMutation.mutate(!viewData?.enabled)}
              disabled={controlMutation.isPending}
              variant={viewData?.enabled ? "destructive" : "default"}
            >
              <Power className="w-4 h-4 mr-2" />
              {viewData?.enabled ? "Stop DoctorTrade" : "Start DoctorTrade"}
            </Button>
            <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !viewData?.enabled}>
              <Activity className="w-4 h-4 mr-2" /> Run Cycle
            </Button>
            <Button
              variant="destructive"
              onClick={() => configMutation.mutate({ kill_switch: true })}
              disabled={configMutation.isPending}
            >
              <ShieldAlert className="w-4 h-4 mr-2" /> Kill Switch
            </Button>
            <Button
              variant="outline"
              onClick={handleConnectWallet}
              disabled={connectWalletMutation.isPending}
            >
              <Wallet className="w-4 h-4 mr-2" /> Connect Existing Wallet
            </Button>
          </div>
        </Card>

        <SettingsMenuCard
          title="DoctorTrade Settings"
          description="Configure scan interval, buy size, daily limit, take-profit and stop-loss."
          open={settingsOpen}
          onToggle={() => setSettingsOpen((prev) => !prev)}
        >
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
              <Button
                variant="outline"
                className="self-end"
                onClick={saveRiskRules}
                disabled={configMutation.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </SettingsMenuCard>

        <Card className="p-3 bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold">Live Ticker</p>
            <Badge variant="outline" className={autoSnipeReady ? "border-green-500/40 text-green-400" : "border-yellow-500/40 text-yellow-400"}>
              {autoSnipeReady ? "Auto-Snipe Ready" : "Auto-Snipe Not Ready"}
            </Badge>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tickerTokens.map((token) => (
              <div key={token.address} className="min-w-[180px] border rounded-md px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{token.symbol}</p>
                  <p className="text-[10px] text-muted-foreground">S {Math.round(token.score)}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">{fmtUsd(token.liquidity)} · {fmtUsd(token.volume_5m)}</p>
              </div>
            ))}
            {!tickerTokens.length && <p className="text-xs text-muted-foreground">Waiting for live tokens…</p>}
          </div>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Card className="p-4 xl:col-span-3">
            <h2 className="text-sm font-semibold mb-3">Watchlist</h2>
            <div className="space-y-2 max-h-[640px] overflow-auto">
              {(viewData?.active_tokens || []).slice(0, 18).map((token) => (
                <div key={token.address} className="border rounded-md p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{token.symbol}</p>
                    <Badge variant="outline" className="text-[10px]">{Math.round(token.score)}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Liq {fmtUsd(token.liquidity)} · Vol5m {fmtUsd(token.volume_5m)}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{token.address}</p>
                </div>
              ))}
              {!viewData?.active_tokens?.length && <p className="text-sm text-muted-foreground">Waiting for scanner feed…</p>}
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
                    <p className="text-[11px] text-muted-foreground">{trade.status || "unknown"} · conf {trade.confidence ?? 0}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtTs(trade.timestamp)} · size {(trade.size_pct ?? 0).toFixed(2)}%</p>
                  </div>
                ))}
                {!viewData?.recent_trades?.length && <p className="text-sm text-muted-foreground">No execution history yet.</p>}
              </div>
            </Card>
          </div>

          <div className="xl:col-span-3 space-y-4">
            <Card className="p-4">
              <h2 className="text-sm font-semibold mb-3">Account</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Engine</span><span>{viewData?.enabled ? "Live" : "Stopped"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet Link</span><span>{viewData?.trade_controls?.wallet_connected ? "Connected" : "Missing"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wallet SOL</span><span>{(viewData?.wallet.balance_sol || 0).toFixed(4)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Trades Today</span><span>{viewData?.trade_controls?.trades_today || 0}/{viewData?.trade_controls?.max_trades_per_day || 12}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Buy Amount</span><span>{(viewData?.trade_controls?.buy_amount_sol || 0.1).toFixed(3)} SOL</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Stop Loss</span><span>{(viewData?.trade_controls?.stop_loss_pct || 6).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span>{(viewData?.trade_controls?.take_profit_multiplier || 2).toFixed(2)}x</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Scanner Health</span><span>{scannerSuccessRate.toFixed(1)}%</span></div>
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
                    onClick={() => controlMutation.mutate(!viewData?.enabled)}
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
                      <p className="text-sm font-semibold">{position.symbol}</p>
                      <Badge variant="outline" className="text-[10px]">{position.risk_status}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Entry ${position.entry_price.toFixed(6)} · Now ${position.current_price.toFixed(6)}</p>
                    <p className="text-[11px] text-muted-foreground">Liq {fmtUsd(position.liquidity)} · Conf {position.confidence}</p>
                  </div>
                ))}
                {!viewData?.positions?.length && <p className="text-sm text-muted-foreground">No open positions.</p>}
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
