import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useAnalyzeDeveloper, useAnalyzeTrader, type DeveloperProfile, type TraderProfile } from "@/hooks/use-whalewatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Wallet, TrendingUp, AlertTriangle, CheckCircle2, Loader2, Activity, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useChain } from "@/hooks/use-chain";

function RiskBar({ value, label, invert }: { value: number; label: string; invert?: boolean }) {
  const pct = Math.min(value * 100, 100);
  const isGood = invert ? pct < 40 : pct > 60;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-mono font-medium", isGood ? "text-green-400" : "text-red-400")}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", isGood ? "bg-green-500" : "bg-red-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function WhaleWatch() {
  const { chain, chainLabel } = useChain();
  const [walletAddress, setWalletAddress] = useState("");
  const [analysisType, setAnalysisType] = useState<"developer" | "trader">("trader");
  const { toast } = useToast();

  const devMutation = useAnalyzeDeveloper();
  const traderMutation = useAnalyzeTrader();

  const devResult = devMutation.data as DeveloperProfile | undefined;
  const traderResult = traderMutation.data as TraderProfile | undefined;
  const isPending = devMutation.isPending || traderMutation.isPending;

  const handleAnalyze = () => {
    if (!walletAddress) {
      toast({ title: "Error", description: "Please enter a wallet address", variant: "destructive" });
      return;
    }
    if (analysisType === "developer") {
      devMutation.mutate(
        { wallet_address: walletAddress, chain },
        {
          onError: (error) => {
            toast({
              title: "Analysis failed",
              description: error instanceof Error ? error.message : "Unable to analyze wallet",
              variant: "destructive",
            });
          },
        }
      );
    } else {
      traderMutation.mutate(
        { wallet_address: walletAddress, chain },
        {
          onError: (error) => {
            toast({
              title: "Analysis failed",
              description: error instanceof Error ? error.message : "Unable to analyze wallet",
              variant: "destructive",
            });
          },
        }
      );
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-3xl md:text-4xl font-bold" data-testid="text-page-title">Wallet Intelligence</h1>
          <p className="text-muted-foreground">Analyze {chainLabel} wallets for developer history, trading performance, and risk signals.</p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge variant="outline" className="solana-badge">Whale Signals</Badge>
            <Badge variant="outline">{chainLabel}</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Behavior Tracking</Badge>
          </div>
        </div>

        <Card className="p-6 solana-card bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="w-full md:w-40 h-10 px-3 border border-input rounded-md bg-muted/40 text-sm flex items-center" data-testid="select-chain">
                  {chainLabel}
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  placeholder="Enter wallet address..."
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  className="pl-10"
                  data-testid="input-wallet-address"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <Tabs value={analysisType} onValueChange={(v) => setAnalysisType(v as "developer" | "trader")} className="flex-1">
                <TabsList className="w-full">
                  <TabsTrigger value="trader" className="flex-1 solana-tab-trigger" data-testid="tab-trader">
                    <TrendingUp className="w-4 h-4 mr-2" /> Trader Profile
                  </TabsTrigger>
                  <TabsTrigger value="developer" className="flex-1 solana-tab-trigger" data-testid="tab-developer">
                    <Shield className="w-4 h-4 mr-2" /> Developer Profile
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button onClick={handleAnalyze} disabled={isPending} data-testid="button-analyze-wallet">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wallet className="w-4 h-4 mr-2" />}
                {isPending ? "Analyzing..." : "Analyze Wallet"}
              </Button>
            </div>
          </div>
        </Card>

        {traderResult && analysisType === "trader" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="solana-card animate-fade-in-up">
              <CardHeader>
                <CardTitle className="text-sm uppercase text-muted-foreground tracking-wider">Trader Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <div className={cn(
                    "w-20 h-20 mx-auto rounded-full border-4 flex items-center justify-center text-2xl font-bold bg-black/30",
                    traderResult.win_rate > 60 ? "text-green-400 border-green-500" : traderResult.win_rate > 40 ? "text-yellow-400 border-yellow-500" : "text-red-400 border-red-500"
                  )}>
                    {traderResult.win_rate.toFixed(0)}%
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">Win Rate</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{traderResult.total_trades}</p>
                    <p className="text-xs text-muted-foreground">Total Trades</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{traderResult.profitable_trades}</p>
                    <p className="text-xs text-muted-foreground">Profitable</p>
                  </div>
                </div>
                <Badge className={cn(
                  "w-full justify-center",
                  traderResult.is_smart_wallet ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
                )}>
                  {traderResult.is_smart_wallet ? "Smart Wallet Detected" : "Not a Smart Wallet"}
                </Badge>
              </CardContent>
            </Card>

            <Card className="solana-card md:col-span-2 animate-fade-in-up">
              <CardHeader>
                <CardTitle>Risk Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <RiskBar value={traderResult.trader_risk_index} label="Trader Risk Index" invert />
                <RiskBar value={traderResult.win_rate / 100} label="Win Rate" />
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-1">Total Volume</p>
                    <p className="font-mono font-bold">${traderResult.total_volume_usd.toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-1">PnL</p>
                    <p className={cn("font-mono font-bold", traderResult.pnl_usd >= 0 ? "text-green-400" : "text-red-400")}>
                      ${traderResult.pnl_usd.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                  <Activity className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Chain: {traderResult.chain}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{traderResult.wallet_address}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {devResult && analysisType === "developer" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="solana-card animate-fade-in-up">
              <CardHeader>
                <CardTitle className="text-sm uppercase text-muted-foreground tracking-wider">Developer Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <div className={cn(
                    "w-20 h-20 mx-auto rounded-full border-4 flex items-center justify-center text-2xl font-bold bg-black/30",
                    devResult.dev_risk_index < 0.4 ? "text-green-400 border-green-500" : devResult.dev_risk_index < 0.7 ? "text-yellow-400 border-yellow-500" : "text-red-400 border-red-500"
                  )}>
                    {(devResult.dev_risk_index * 100).toFixed(0)}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">Dev Risk Index</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{devResult.total_tokens_launched}</p>
                    <p className="text-xs text-muted-foreground">Tokens Launched</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-red-400">{devResult.total_rugs}</p>
                    <p className="text-xs text-muted-foreground">Rugs</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="solana-card md:col-span-2 animate-fade-in-up">
              <CardHeader>
                <CardTitle>Risk Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <RiskBar value={devResult.dev_risk_index} label="Developer Risk Index" invert />
                <RiskBar value={devResult.rug_percentage / 100} label="Rug Percentage" invert />
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-1">Wallet Age</p>
                    <p className="font-mono font-bold">{devResult.wallet_age_days} days</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-1">Rug Rate</p>
                    <p className={cn("font-mono font-bold", devResult.rug_percentage < 30 ? "text-green-400" : "text-red-400")}>
                      {devResult.rug_percentage.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <div className="p-3 rounded-lg flex items-center gap-3" >
                  {devResult.rug_percentage < 30 ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                  )}
                  <p className="text-sm">
                    {devResult.rug_percentage < 30
                      ? "This developer has a relatively clean track record."
                      : "This developer has a high rug rate. Exercise extreme caution."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {!devResult && !traderResult && !isPending && (
          <Card className="solana-card p-12 text-center">
            <Wallet className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-semibold text-muted-foreground mb-2">Enter a wallet to analyze</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Get instant intelligence on any wallet including trading performance, developer history, and risk signals.
            </p>
          </Card>
        )}
      </div>
    </Layout>
  );
}
