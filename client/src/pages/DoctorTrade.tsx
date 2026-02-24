import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Bot, ShieldAlert, Power, Activity } from "lucide-react";
import { useDoctorConfig, useDoctorControl, useDoctorRunOnce, useDoctorStatus } from "@/hooks/use-doctortrade";
import { useState } from "react";

function fmtUsd(value: number) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function DoctorTrade() {
  const { data, isLoading } = useDoctorStatus();
  const controlMutation = useDoctorControl();
  const configMutation = useDoctorConfig();
  const runMutation = useDoctorRunOnce();
  const [intervalInput, setIntervalInput] = useState("20");

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Bot className="w-8 h-8 text-primary" />
              DoctorTrade (Solana Meme Mode)
            </h1>
            <p className="text-muted-foreground">Autonomous, isolated Solana meme scanner with strict anti-rug and kill switch controls.</p>
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
              onClick={() => controlMutation.mutate(!data?.enabled)}
              disabled={controlMutation.isPending}
              variant={data?.enabled ? "destructive" : "default"}
            >
              <Power className="w-4 h-4 mr-2" />
              {data?.enabled ? "Stop DoctorTrade" : "Start DoctorTrade"}
            </Button>
            <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !data?.enabled}>
              <Activity className="w-4 h-4 mr-2" /> Run Cycle
            </Button>
            <Button
              variant="destructive"
              onClick={() => configMutation.mutate({ kill_switch: true })}
              disabled={configMutation.isPending}
            >
              <ShieldAlert className="w-4 h-4 mr-2" /> Kill Switch
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

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <Card className="p-4"><p className="text-sm text-muted-foreground">Drawdown %</p><p className="text-2xl font-bold">{data?.risk_state.drawdown_pct.toFixed(2) || "0.00"}%</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Risk Status</p><p className="text-2xl font-bold">{data?.risk_state.paused ? "Paused" : "Active"}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Open Positions</p><p className="text-2xl font-bold">{data?.risk_state.open_positions || 0}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Exposure %</p><p className="text-2xl font-bold">{(data?.risk_state.open_exposure_pct || 0).toFixed(2)}%</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Wallet SOL</p><p className="text-2xl font-bold">{(data?.wallet.balance_sol || 0).toFixed(4)}</p></Card>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-4"><p className="text-sm text-muted-foreground">Daily PNL</p><p className="text-2xl font-bold">{fmtUsd(data?.risk_state.daily_realized_pnl_usd || 0)}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">High-Watermark</p><p className="text-2xl font-bold">{fmtUsd(data?.risk_state.high_watermark_usd || 0)}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Strategy Mode</p><p className="text-2xl font-bold capitalize">{(data?.strategy_mode || "trending").replace("_", " ")}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Safety API Errors</p><p className="text-2xl font-bold">{data?.safety?.api_error_count || 0}</p></Card>
            </div>

            {data?.tuning_suggestion && (
              <Card className="p-4 border-accent/30 bg-accent/5">
                <p className="text-sm text-muted-foreground">Tuning Suggestion</p>
                <p className="text-sm font-medium mt-1">{data.tuning_suggestion}</p>
              </Card>
            )}

            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3">Current Active Tokens</h2>
              <div className="space-y-2">
                {(data?.active_tokens || []).slice(0, 10).map((token) => (
                  <div key={token.address} className="border rounded-md p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{token.symbol}</p>
                      <p className="text-xs text-muted-foreground font-mono">{token.address}</p>
                      <p className="text-xs text-muted-foreground capitalize">Mode {(token as any).strategy_mode || data?.strategy_mode || "trending"}</p>
                    </div>
                    <div className="text-sm text-right">
                      <p>Liq {fmtUsd(token.liquidity)}</p>
                      <p>Vol 5m {fmtUsd(token.volume_5m)}</p>
                      <p>Score {token.score}</p>
                    </div>
                  </div>
                ))}
                {!data?.active_tokens?.length && <p className="text-sm text-muted-foreground">No active scan tokens yet.</p>}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3">Open Positions</h2>
              <div className="space-y-2">
                {(data?.positions || []).map((position) => (
                  <div key={position.address} className="border rounded-md p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{position.symbol}</p>
                      <p className="text-xs text-muted-foreground">Entry ${position.entry_price.toFixed(6)} · Current ${position.current_price.toFixed(6)}</p>
                      <p className="text-xs text-muted-foreground capitalize">Mode {(position as any).strategy_mode || data?.strategy_mode || "trending"}</p>
                    </div>
                    <div className="text-sm text-right">
                      <p>Liquidity {fmtUsd(position.liquidity)}</p>
                      <p>AI Confidence {position.confidence}</p>
                      <p>Risk {position.risk_status}</p>
                    </div>
                  </div>
                ))}
                {!data?.positions?.length && <p className="text-sm text-muted-foreground">No open positions.</p>}
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
