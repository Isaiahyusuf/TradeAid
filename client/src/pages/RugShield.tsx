import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useScanToken, type ScoreResult } from "@/hooks/use-rugcheck";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, AlertTriangle, CheckCircle2, Search, TrendingUp, Activity, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function ScoreGauge({ value, label }: { value: number; label: string }) {
  const getColor = () => {
    if (value >= 70) return "text-green-400 border-green-500";
    if (value >= 40) return "text-yellow-400 border-yellow-500";
    return "text-red-400 border-red-500";
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={cn(
        "w-16 h-16 rounded-full border-4 flex items-center justify-center text-lg font-bold bg-black/30",
        getColor()
      )}>
        {(value * 100).toFixed(0)}
      </div>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}

export default function RugShield() {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("solana");
  const { mutate: scanToken, isPending, data: result } = useScanToken();
  const { toast } = useToast();

  const handleScan = () => {
    if (!address) {
      toast({ title: "Error", description: "Please enter a contract address", variant: "destructive" });
      return;
    }
    scanToken({ address, chain });
  };

  const getOverallScore = (r: ScoreResult) => {
    return Math.round(r.trade_confidence_index * 100);
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-green-500 border-green-500";
    if (score >= 40) return "text-yellow-500 border-yellow-500";
    return "text-red-500 border-red-500";
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-bold" data-testid="text-page-title">Token Risk Scanner</h1>
          <p className="text-muted-foreground">Score any token for rug risk, liquidity stability, and trade confidence.</p>
        </div>

        <Card className="p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <Select value={chain} onValueChange={setChain}>
              <SelectTrigger className="w-full md:w-40" data-testid="select-chain">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solana">Solana</SelectItem>
                <SelectItem value="ethereum">Ethereum</SelectItem>
                <SelectItem value="bsc">BSC</SelectItem>
                <SelectItem value="base">Base</SelectItem>
                <SelectItem value="arbitrum">Arbitrum</SelectItem>
                <SelectItem value="polygon">Polygon</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Enter contract address..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="pl-10"
                data-testid="input-token-address"
              />
            </div>
            <Button 
              onClick={handleScan} 
              disabled={isPending}
              data-testid="button-scan-token"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
              {isPending ? "Scoring..." : "Score Token"}
            </Button>
          </div>
        </Card>

        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-card/60 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-center text-muted-foreground text-sm uppercase tracking-wider">Trade Confidence</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-6">
                <div className={cn(
                  "w-32 h-32 rounded-full border-8 flex items-center justify-center text-4xl font-bold bg-black/30",
                  getScoreColor(getOverallScore(result))
                )}>
                  {getOverallScore(result)}
                </div>
                <div className="mt-4 text-center">
                  <Badge className={cn(
                    result.eligible 
                      ? "bg-green-500/20 text-green-400" 
                      : "bg-red-500/20 text-red-400"
                  )}>
                    {result.eligible ? "Eligible" : "Not Eligible"}
                  </Badge>
                  {result.eligibility_reason && (
                    <p className="text-xs text-muted-foreground mt-2">{result.eligibility_reason}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/60 backdrop-blur md:col-span-2">
              <CardHeader>
                <CardTitle>Risk Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <ScoreGauge value={1 - result.rug_probability} label="Rug Safety" />
                  <ScoreGauge value={result.liquidity_stability} label="Liquidity" />
                  <ScoreGauge value={result.holder_distribution} label="Distribution" />
                  <ScoreGauge value={result.smart_wallet_signal} label="Smart Wallets" />
                </div>

                <div className="mt-6 space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                    {result.rug_probability < 0.3 ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                    )}
                    <div>
                      <p className="font-medium text-sm">Rug Probability</p>
                      <p className="text-xs text-muted-foreground">
                        {(result.rug_probability * 100).toFixed(1)}% chance of rug pull
                      </p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                    {result.liquidity_stability > 0.6 ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />
                    )}
                    <div>
                      <p className="font-medium text-sm">Liquidity Stability</p>
                      <p className="text-xs text-muted-foreground">
                        {(result.liquidity_stability * 100).toFixed(1)}% stability score
                      </p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-blue-500 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">Smart Wallet Activity</p>
                      <p className="text-xs text-muted-foreground">
                        {(result.smart_wallet_signal * 100).toFixed(1)}% smart wallet signal
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {!result && !isPending && (
          <Card className="bg-card/60 backdrop-blur p-12 text-center">
            <Shield className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-semibold text-muted-foreground mb-2">Enter a contract address to score</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Get instant risk analysis including rug probability, liquidity stability, holder distribution, and smart wallet signals.
            </p>
          </Card>
        )}
      </div>
    </Layout>
  );
}
