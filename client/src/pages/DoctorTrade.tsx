import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Bot, ShieldAlert, Power, Activity, Wallet, TrendingUp, BarChart3, Radio } from "lucide-react";
import { useDoctorConfig, useDoctorConnectWallet, useDoctorControl, useDoctorRunOnce, useDoctorStatus } from "@/hooks/use-doctortrade";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
  const controlMutation = useDoctorControl();
  const configMutation = useDoctorConfig();
  const connectWalletMutation = useDoctorConnectWallet();
  const runMutation = useDoctorRunOnce();
  const [intervalInput, setIntervalInput] = useState("20");
  const [buyAmountInput, setBuyAmountInput] = useState("0.1");
  const [maxTradesInput, setMaxTradesInput] = useState("12");
  const [tpMultInput, setTpMultInput] = useState("2.0");
  const [minProfitInput, setMinProfitInput] = useState("12");
  const [stopLossInput, setStopLossInput] = useState("6");
  const [trailInput, setTrailInput] = useState("10");
  const viewData = data;
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

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Bot className="w-8 h-8 text-primary" />
              DoctorTrade (Solana Meme Mode)
            </h1>
            <p className="text-muted-foreground">Autonomous Solana trading cockpit with fresh-token feed, risk-gated execution, and live strategy telemetry.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">Solana Only</Badge>
            <Badge variant="outline">Independent Engine</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Risk Locked</Badge>
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
              onClick={() => connectWalletMutation.mutate({ use_existing_wallet: true })}
              disabled={connectWalletMutation.isPending}
            >
              <Wallet className="w-4 h-4 mr-2" /> Connect Existing Wallet
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <Input className="w-28" value={intervalInput} onChange={(e) => setIntervalInput(e.target.value)} placeholder="20" />
              <Button
                variant="outline"
                onClick={() => configMutation.mutate({ scan_interval_seconds: Number(intervalInput) || 20, kill_switch: false })}
                disabled={configMutation.isPending}
              >
                Set Interval
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-card/70 backdrop-blur-sm border-border/60">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 items-end">
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
                onClick={() => configMutation.mutate({
                  buy_amount_sol: Math.max(0.1, Number(buyAmountInput) || 0.1),
                  max_trades_per_day: Number(maxTradesInput) || 12,
                  take_profit_multiplier: Number(tpMultInput) || 2.0,
                  min_profit_pct: Number(minProfitInput) || 12,
                  stop_loss_pct: Number(stopLossInput) || 6,
                  trailing_stop_pct: Number(trailInput) || 10,
                })}
                disabled={configMutation.isPending}
              >
                Save Risk Rules
              </Button>
            </div>
          </div>
        </Card>

        {!viewData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <Card className="p-4"><p className="text-sm text-muted-foreground">Engine</p><p className="text-2xl font-bold">{viewData?.enabled ? "Live" : "Stopped"}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Risk Status</p><p className="text-2xl font-bold">{viewData?.risk_state.paused ? "Paused" : "Active"}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Wallet SOL</p><p className="text-2xl font-bold">{(viewData?.wallet.balance_sol || 0).toFixed(4)}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Open Positions</p><p className="text-2xl font-bold">{viewData?.risk_state.open_positions || 0}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Exposure %</p><p className="text-2xl font-bold">{(viewData?.risk_state.open_exposure_pct || 0).toFixed(2)}%</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Drawdown %</p><p className="text-2xl font-bold">{viewData?.risk_state.drawdown_pct.toFixed(2) || "0.00"}%</p></Card>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <Card className="p-4"><p className="text-sm text-muted-foreground">Wallet Link</p><p className="text-2xl font-bold">{viewData?.trade_controls?.wallet_connected ? "Connected" : "Missing"}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Buy Amount</p><p className="text-2xl font-bold">{(viewData?.trade_controls?.buy_amount_sol || 0.1).toFixed(3)} SOL</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Trades Today</p><p className="text-2xl font-bold">{viewData?.trade_controls?.trades_today || 0}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Daily Trade Cap</p><p className="text-2xl font-bold">{viewData?.trade_controls?.max_trades_per_day || 12}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">2x Target</p><p className="text-2xl font-bold">{(viewData?.trade_controls?.take_profit_multiplier || 2).toFixed(2)}x</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Fallback Profit</p><p className="text-2xl font-bold">{(viewData?.trade_controls?.min_profit_pct || 12).toFixed(1)}%</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Stop Loss</p><p className="text-2xl font-bold">{(viewData?.trade_controls?.stop_loss_pct || 6).toFixed(1)}%</p></Card>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <Card className="p-4"><p className="text-sm text-muted-foreground">Daily PNL</p><p className="text-2xl font-bold">{fmtUsd(viewData?.risk_state.daily_realized_pnl_usd || 0)}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">High-Watermark</p><p className="text-2xl font-bold">{fmtUsd(viewData?.risk_state.high_watermark_usd || 0)}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Strategy</p><p className="text-2xl font-bold capitalize">{(viewData?.strategy_mode || "trending").replace("_", " ")}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Scanner Health</p><p className="text-2xl font-bold">{scannerSuccessRate.toFixed(1)}%</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Fresh Approved</p><p className="text-2xl font-bold">{viewData?.fresh_feed?.approved || 0}</p></Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-4 lg:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4" />Performance Chart</h2>
                  <p className="text-xs text-muted-foreground">Win-rate & drawdown</p>
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
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Wallet className="w-4 h-4" />Wallet & Feed</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Wallet</span><span className="font-mono text-xs">{viewData?.wallet.address || "Not set"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Balance</span><span>{(viewData?.wallet.balance_sol || 0).toFixed(4)} SOL</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fresh detected</span><span>{viewData?.fresh_feed?.detected || 0}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fresh enriched</span><span>{viewData?.fresh_feed?.enriched || 0}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fresh rejected</span><span>{viewData?.fresh_feed?.rejected || 0}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Last cycle</span><span>{fmtTs(viewData?.fresh_feed?.last_cycle_at || undefined)}</span></div>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-4 lg:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4" />Execution Pulse</h2>
                  <p className="text-xs text-muted-foreground">Confidence vs size</p>
                </div>
                <div className="h-56">
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
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Radio className="w-4 h-4" />Live Trade Feed</h2>
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
                  {!viewData?.recent_trades?.length && <p className="text-sm text-muted-foreground">No trade activity yet.</p>}
                </div>
              </Card>
            </div>

            {viewData?.tuning_suggestion && (
              <Card className="p-4 border-accent/30 bg-accent/5">
                <p className="text-sm text-muted-foreground">Tuning Suggestion</p>
                <p className="text-sm font-medium mt-1">{viewData.tuning_suggestion}</p>
              </Card>
            )}

            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3">Current Active Tokens</h2>
              <div className="space-y-2">
                {(viewData?.active_tokens || []).slice(0, 10).map((token) => (
                  <div key={token.address} className="border rounded-md p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{token.symbol}</p>
                      <p className="text-xs text-muted-foreground font-mono">{token.address}</p>
                      <p className="text-xs text-muted-foreground capitalize">Mode {(token as any).strategy_mode || viewData?.strategy_mode || "trending"}</p>
                    </div>
                    <div className="text-sm text-right">
                      <p>Liq {fmtUsd(token.liquidity)}</p>
                      <p>Vol 5m {fmtUsd(token.volume_5m)}</p>
                      <p>Score {token.score}</p>
                    </div>
                  </div>
                ))}
                {!viewData?.active_tokens?.length && <p className="text-sm text-muted-foreground">No active scan tokens yet.</p>}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3">Open Positions</h2>
              <div className="space-y-2">
                {(viewData?.positions || []).map((position) => (
                  <div key={position.address} className="border rounded-md p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{position.symbol}</p>
                      <p className="text-xs text-muted-foreground">Entry ${position.entry_price.toFixed(6)} · Current ${position.current_price.toFixed(6)}</p>
                      <p className="text-xs text-muted-foreground capitalize">Mode {(position as any).strategy_mode || viewData?.strategy_mode || "trending"} · Trail {position.trailing_stop_pct ?? 0}%</p>
                    </div>
                    <div className="text-sm text-right">
                      <p>Liquidity {fmtUsd(position.liquidity)}</p>
                      <p>AI Confidence {position.confidence}</p>
                      <p>Risk {position.risk_status}</p>
                    </div>
                  </div>
                ))}
                {!viewData?.positions?.length && <p className="text-sm text-muted-foreground">No open positions.</p>}
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
