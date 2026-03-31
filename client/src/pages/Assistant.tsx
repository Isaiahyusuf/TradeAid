import { useMemo, useState } from "react";
import { Brain, MessageSquare, RefreshCw, Sparkles } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";
import {
  useAskAssistant,
  useAssistDecision,
  useAssistantContextOverview,
} from "@/hooks/use-ai-assistant";
import { useChain } from "@/hooks/use-chain";
import { SavingOverlay } from "@/components/ui/saving-overlay";

export default function AssistantPage() {
  const { chain, chainLabel } = useChain();
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [assistContract, setAssistContract] = useState("");
  const [assistPriceChange, setAssistPriceChange] = useState("0");
  const [assistLiquidity, setAssistLiquidity] = useState("10000");
  const [assistConfidence, setAssistConfidence] = useState("55");
  const [assistRugRisk, setAssistRugRisk] = useState("35");
  const [assistSettingsOpen, setAssistSettingsOpen] = useState(false);

  const contextQuery = useAssistantContextOverview(30);
  const askMutation = useAskAssistant();
  const assistMutation = useAssistDecision();

  const context = contextQuery.data?.context;
  const assistantSavingInProgress = askMutation.isPending || assistMutation.isPending;
  const assistantSavingMessage = askMutation.isPending
    ? "DoctorTrade is thinking..."
    : assistMutation.isPending
      ? "Analyzing market setup..."
      : "Saving...";

  const sortedChains = useMemo(() => {
    const rows = Object.entries(context?.chain_stats || {});
    return rows.sort((a, b) => (b[1]?.trades || 0) - (a[1]?.trades || 0));
  }, [context?.chain_stats]);

  const sortedCalibration = useMemo(() => {
    const rows = Object.entries(context?.confidence_calibration?.by_chain || {});
    return rows.sort((a, b) => Math.abs((b[1]?.confidence_bias || 0)) - Math.abs((a[1]?.confidence_bias || 0)));
  }, [context?.confidence_calibration?.by_chain]);

  const askAssistant = async () => {
    const text = question.trim();
    if (!text) {
      toast({ title: "Question required", description: "Enter a question for DoctorTrade.", variant: "destructive" });
      return;
    }
    try {
      await askMutation.mutateAsync({ question: text });
    } catch (error) {
      toast({ title: "DoctorTrade error", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    }
  };

  const runDecisionAssist = async () => {
    const payload = {
      market: {
        chain,
        contract_address: assistContract.trim() || "manual-input",
        price_change_1h: Number(assistPriceChange) || 0,
        liquidity_usd: Number(assistLiquidity) || 0,
        trade_confidence_index: Number(assistConfidence) || 0,
        rug_probability: Number(assistRugRisk) || 0,
      },
      mode: "paper" as const,
      risk: {
        max_risk_per_trade_pct: 1,
        max_daily_loss_pct: 4,
        max_trades_per_day: 8,
      },
    };

    try {
      await assistMutation.mutateAsync(payload);
    } catch (error) {
      toast({ title: "Assist failed", description: error instanceof Error ? error.message : "Could not run decision assist", variant: "destructive" });
    }
  };

  const applyAssistPresets = () => {
    setAssistSettingsOpen(false);
    toast({ title: "Presets applied", description: "Decision Assist settings updated." });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <SavingOverlay
          visible={assistantSavingInProgress}
          title="Working On It"
          message={assistantSavingMessage}
        />

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Brain className="w-8 h-8 text-primary doctorstrange-sigil" />
              <span className="doctorstrange-font text-gradient">DoctorTrade</span>
            </h1>
            <p className="text-muted-foreground">Cross-chain trading intelligence with history-aware reasoning.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{chainLabel}</Badge>
            <Badge variant="outline" className="solana-badge doctorstrange-font">History-Aware</Badge>
            <Button variant="outline" onClick={() => contextQuery.refetch()} disabled={contextQuery.isFetching}>
              <RefreshCw className={`w-4 h-4 mr-2 ${contextQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh Context
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Total Trades (30d)</p>
            <p className="text-2xl font-bold">{context?.summary.total_trades || 0}</p>
          </Card>
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Total Notional</p>
            <p className="text-2xl font-bold">${(context?.summary.total_notional_usd || 0).toLocaleString()}</p>
          </Card>
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Total PNL</p>
            <p className="text-2xl font-bold">${(context?.summary.total_pnl_usd || 0).toLocaleString()}</p>
          </Card>
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Active Chains</p>
            <p className="text-2xl font-bold">{context?.summary.chain_count || 0}</p>
          </Card>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Calibration Bias (Global)</p>
            <p className="text-2xl font-bold">{(context?.confidence_calibration?.global_bias || 0).toFixed(2)}</p>
          </Card>
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Calibration Lookback</p>
            <p className="text-2xl font-bold">{context?.confidence_calibration?.lookback_trades || 0}</p>
            <p className="text-[11px] text-muted-foreground">
              Half-life: {Number(context?.confidence_calibration?.half_life_days || 7).toFixed(1)}d
            </p>
          </Card>
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Selected Chain Bias</p>
            <p className="text-2xl font-bold">
              {(
                context?.confidence_calibration?.by_chain?.[chain]?.confidence_bias ||
                context?.confidence_calibration?.global_bias ||
                0
              ).toFixed(2)}
            </p>
          </Card>
          <Card className="p-4 solana-card">
            <p className="text-xs text-muted-foreground">Selected Chain Win Rate</p>
            <p className="text-2xl font-bold">
              {((context?.confidence_calibration?.by_chain?.[chain]?.win_rate || 0) * 100).toFixed(1)}%
            </p>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card className="solana-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4" />Ask DoctorTrade</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask DoctorTrade about market risk, chain conditions, or trade strategy..."
                className="min-h-[120px]"
              />
              <Button onClick={askAssistant} disabled={askMutation.isPending}>
                {askMutation.isPending ? "Thinking..." : "Ask"}
              </Button>
              {askMutation.data?.assistant && (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
                  <p className="text-sm">{String(askMutation.data.assistant.answer || "")}</p>
                  <div className="space-y-1">
                    {(askMutation.data.assistant.key_points || []).map((item, index) => (
                      <p key={`${item}-${index}`} className="text-xs text-muted-foreground">• {item}</p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="solana-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" />Decision Assist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SettingsMenuCard
                title="Decision Assist Presets"
                description="Set default market assumptions for assist decisions."
                open={assistSettingsOpen}
                onToggle={() => setAssistSettingsOpen((prev) => !prev)}
              >
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="assist-contract">Contract address (optional)</Label>
                    <Input id="assist-contract" placeholder="Contract address" value={assistContract} onChange={(e) => setAssistContract(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" placeholder="1h Price %" value={assistPriceChange} onChange={(e) => setAssistPriceChange(e.target.value)} />
                    <Input type="number" placeholder="Liquidity USD" value={assistLiquidity} onChange={(e) => setAssistLiquidity(e.target.value)} />
                    <Input type="number" placeholder="Confidence 0-100" value={assistConfidence} onChange={(e) => setAssistConfidence(e.target.value)} />
                    <Input type="number" placeholder="Rug risk 0-100" value={assistRugRisk} onChange={(e) => setAssistRugRisk(e.target.value)} />
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={applyAssistPresets}>Apply Presets</Button>
                  </div>
                </div>
              </SettingsMenuCard>
              <Button onClick={runDecisionAssist} disabled={assistMutation.isPending}>
                {assistMutation.isPending ? "Analyzing..." : "Run Assist"}
              </Button>
              {assistMutation.data?.assistant && (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
                  <p className="text-sm">{String((assistMutation.data.assistant as Record<string, unknown>).summary || "")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Action: {String((assistMutation.data.assistant as Record<string, unknown>).action || "WAIT")}</Badge>
                    <Badge variant="outline">Confidence: {String((assistMutation.data.assistant as Record<string, unknown>).confidence || 0)}</Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="solana-card">
          <CardHeader>
            <CardTitle className="text-base">Cross-Chain History Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contextQuery.isFetching && !context ? (
              <p className="text-sm text-muted-foreground">Loading context…</p>
            ) : contextQuery.isError ? (
              <div className="space-y-2">
                <p className="text-sm text-red-400">Context failed to load.</p>
                <Button variant="outline" size="sm" onClick={() => contextQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : sortedChains.length === 0 ? (
              <p className="text-sm text-muted-foreground">No trade history yet. DoctorTrade will learn as trading data accumulates.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedChains.map(([chainName, row]) => (
                  <div key={chainName} className="rounded-lg border border-border/60 p-3 bg-muted/20">
                    <p className="text-sm font-semibold capitalize">{chainName}</p>
                    <p className="text-xs text-muted-foreground">Trades: {row.trades}</p>
                    <p className="text-xs text-muted-foreground">Notional: ${row.notional_usd.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">PNL: ${row.pnl_usd.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="solana-card">
          <CardHeader>
            <CardTitle className="text-base">Confidence Calibration by Chain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sortedCalibration.length === 0 ? (
              <p className="text-sm text-muted-foreground">No trade outcomes yet. Calibration activates as data accumulates.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedCalibration.map(([chainName, row]) => (
                  <div key={chainName} className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold capitalize">{chainName}</p>
                      <Badge variant="outline">{row.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Bias: {row.confidence_bias.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Win rate: {(row.win_rate * 100).toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">Trades: {row.trades}</p>
                    <p className="text-xs text-muted-foreground">Weighted samples: {(row.weighted_trade_mass || 0).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">PnL/Trade: ${row.pnl_per_trade_usd.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
