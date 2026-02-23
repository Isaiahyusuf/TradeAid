import { useEffect, useMemo, useState } from "react";
import { Brain, MessageSquare, RefreshCw, Sparkles } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useApproveAssistantConsent,
  useAskAssistant,
  useAssistDecision,
  useAssistantContextOverview,
  useAssistantTradingStatus,
  useAssistantWalletStatus,
  useConfirmAssistantWalletBackup,
  useCreateAssistantWallet,
  useExecuteAssistantTrade,
  useRequestAssistantConsent,
  useRevealAssistantWallet,
  useRevokeAssistantConsent,
} from "@/hooks/use-ai-assistant";
import { SUPPORTED_CHAINS, useChain } from "@/hooks/use-chain";

export default function AssistantPage() {
  const { chain, chainLabel } = useChain();
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [assistContract, setAssistContract] = useState("");
  const [assistPriceChange, setAssistPriceChange] = useState("0");
  const [assistLiquidity, setAssistLiquidity] = useState("10000");
  const [assistConfidence, setAssistConfidence] = useState("55");
  const [assistRugRisk, setAssistRugRisk] = useState("35");
  const [assistantMode, setAssistantMode] = useState<"paper" | "live">("paper");
  const [walletsByChain, setWalletsByChain] = useState<Record<string, string>>({});
  const [confirmationText, setConfirmationText] = useState("I_APPROVE_ASSISTANT_TRADING");
  const [tradeChain, setTradeChain] = useState("solana");
  const [tradeContract, setTradeContract] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeNotional, setTradeNotional] = useState("25");
  const [backupPhraseInput, setBackupPhraseInput] = useState("");
  const [revealPhrase, setRevealPhrase] = useState("I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS");
  const [latestBundle, setLatestBundle] = useState<{ mnemonic: string; addresses_by_chain: Record<string, string>; private_keys_by_chain: Record<string, string>; warning: string; } | null>(null);

  const contextQuery = useAssistantContextOverview(30);
  const askMutation = useAskAssistant();
  const assistMutation = useAssistDecision();
  const tradingStatusQuery = useAssistantTradingStatus();
  const walletStatusQuery = useAssistantWalletStatus();
  const requestConsent = useRequestAssistantConsent();
  const approveConsent = useApproveAssistantConsent();
  const revokeConsent = useRevokeAssistantConsent();
  const executeTrade = useExecuteAssistantTrade();
  const createWallet = useCreateAssistantWallet();
  const confirmBackup = useConfirmAssistantWalletBackup();
  const revealWallet = useRevealAssistantWallet();

  const context = contextQuery.data?.context;
  const trading = tradingStatusQuery.data?.trading;
  const wallet = walletStatusQuery.data?.wallet;
  const enabledChains = SUPPORTED_CHAINS.filter((item) => item !== "all");

  const sortedChains = useMemo(() => {
    const rows = Object.entries(context?.chain_stats || {});
    return rows.sort((a, b) => (b[1]?.trades || 0) - (a[1]?.trades || 0));
  }, [context?.chain_stats]);

  const sortedCalibration = useMemo(() => {
    const rows = Object.entries(context?.confidence_calibration?.by_chain || {});
    return rows.sort((a, b) => Math.abs((b[1]?.confidence_bias || 0)) - Math.abs((a[1]?.confidence_bias || 0)));
  }, [context?.confidence_calibration?.by_chain]);

  useEffect(() => {
    const incoming = trading?.wallets_by_chain || wallet?.addresses_by_chain || {};
    const next: Record<string, string> = {};
    for (const chainName of enabledChains) {
      next[chainName] = String(incoming[chainName] || walletsByChain[chainName] || "");
    }
    setWalletsByChain(next);
    if (trading?.mode === "paper" || trading?.mode === "live") {
      setAssistantMode(trading.mode);
    }
  }, [trading?.wallets_by_chain, trading?.mode, wallet?.addresses_by_chain]);

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

  const handleCreateWallet = async (overwrite: boolean) => {
    try {
      const result = await createWallet.mutateAsync({ overwrite });
      setLatestBundle(result.bundle);
      setBackupPhraseInput("");
      toast({ title: "Wallet created", description: "Store your 12-word phrase and private keys before proceeding." });
    } catch (error) {
      toast({ title: "Wallet creation failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleConfirmBackup = async () => {
    try {
      await confirmBackup.mutateAsync({ mnemonic: backupPhraseInput.trim() });
      toast({ title: "Backup confirmed", description: "Recovery phrase backup recorded." });
    } catch (error) {
      toast({ title: "Backup confirmation failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleRevealWallet = async () => {
    try {
      const result = await revealWallet.mutateAsync({ confirmation_text: revealPhrase.trim() });
      setLatestBundle(result.bundle);
      toast({ title: "Secrets revealed", description: "Keep these keys offline and private." });
    } catch (error) {
      toast({ title: "Reveal failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleRequestAssistantConsent = async () => {
    try {
      await requestConsent.mutateAsync({
        mode: assistantMode,
        wallets_by_chain: walletsByChain,
      });
      toast({ title: "Consent requested", description: "Approve consent to enable assistant trading." });
    } catch (error) {
      toast({ title: "Consent request failed", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    }
  };

  const handleApproveAssistantConsent = async () => {
    const consentId = String(trading?.consent_id || "");
    if (!consentId) {
      toast({ title: "Missing consent", description: "Request consent first.", variant: "destructive" });
      return;
    }
    try {
      await approveConsent.mutateAsync({
        consent_id: consentId,
        confirmation_text: confirmationText,
      });
      toast({ title: "Assistant trading enabled", description: "Permission is active. You can revoke anytime." });
    } catch (error) {
      toast({ title: "Approve failed", description: error instanceof Error ? error.message : "Approval failed", variant: "destructive" });
    }
  };

  const handleRevokeAssistantConsent = async () => {
    try {
      await revokeConsent.mutateAsync();
      toast({ title: "Assistant trading revoked", description: "Assistant no longer has trading permission." });
    } catch (error) {
      toast({ title: "Revoke failed", description: error instanceof Error ? error.message : "Revoke failed", variant: "destructive" });
    }
  };

  const handleExecuteAssistantTrade = async () => {
    const notionalValue = Number(tradeNotional);
    if (!tradeContract.trim() || !Number.isFinite(notionalValue) || notionalValue <= 0) {
      toast({ title: "Invalid trade", description: "Set contract and a valid notional amount.", variant: "destructive" });
      return;
    }
    try {
      await executeTrade.mutateAsync({
        chain: tradeChain,
        contract_address: tradeContract.trim(),
        side: tradeSide,
        notional_usd: notionalValue,
        mode: assistantMode,
      });
      toast({ title: "Trade submitted", description: `Assistant ${tradeSide.toUpperCase()} processed for ${tradeChain}.` });
      setTradeContract("");
    } catch (error) {
      toast({ title: "Trade blocked", description: error instanceof Error ? error.message : "Execution failed", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
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
              <Input placeholder="Contract address (optional)" value={assistContract} onChange={(e) => setAssistContract(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="1h Price %" value={assistPriceChange} onChange={(e) => setAssistPriceChange(e.target.value)} />
                <Input type="number" placeholder="Liquidity USD" value={assistLiquidity} onChange={(e) => setAssistLiquidity(e.target.value)} />
                <Input type="number" placeholder="Confidence 0-100" value={assistConfidence} onChange={(e) => setAssistConfidence(e.target.value)} />
                <Input type="number" placeholder="Rug risk 0-100" value={assistRugRisk} onChange={(e) => setAssistRugRisk(e.target.value)} />
              </div>
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
            {sortedChains.length === 0 ? (
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

        <Card className="solana-card">
          <CardHeader>
            <CardTitle className="text-base">DoctorTrade Wallet Vault</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Generate a real 12-word wallet phrase. Private keys are created per chain and stored encrypted server-side.
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm">Wallet</span>
              <Badge variant={wallet?.has_wallet ? "default" : "outline"}>{wallet?.has_wallet ? "Created" : "Not Created"}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm">Backup</span>
              <Badge variant={wallet?.backup_confirmed ? "default" : "outline"}>{wallet?.backup_confirmed ? "Confirmed" : "Pending"}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => handleCreateWallet(false)} disabled={createWallet.isPending}>
                {createWallet.isPending ? "Creating..." : "Create Wallet"}
              </Button>
              <Button variant="outline" onClick={() => handleCreateWallet(true)} disabled={createWallet.isPending}>
                Overwrite Wallet
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet-backup-phrase">Confirm 12-word phrase backup</Label>
              <Textarea
                id="wallet-backup-phrase"
                placeholder="Paste your 12-word phrase exactly"
                value={backupPhraseInput}
                onChange={(e) => setBackupPhraseInput(e.target.value)}
                className="min-h-[80px]"
              />
              <Button variant="outline" onClick={handleConfirmBackup} disabled={confirmBackup.isPending || !backupPhraseInput.trim()}>
                {confirmBackup.isPending ? "Confirming..." : "Confirm Backup"}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet-reveal-phrase">Reveal secret phrase/private keys</Label>
              <Input
                id="wallet-reveal-phrase"
                value={revealPhrase}
                onChange={(e) => setRevealPhrase(e.target.value)}
                placeholder="I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS"
              />
              <Button variant="outline" onClick={handleRevealWallet} disabled={revealWallet.isPending}>
                {revealWallet.isPending ? "Revealing..." : "Reveal Secrets"}
              </Button>
            </div>

            {latestBundle && (
              <div className="rounded-lg border border-border/60 p-3 space-y-3 bg-muted/20">
                <p className="text-xs text-amber-300">{latestBundle.warning}</p>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">12-word phrase</p>
                  <Textarea readOnly value={latestBundle.mnemonic} className="min-h-[70px]" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(latestBundle.addresses_by_chain || {}).map(([chainName, address]) => (
                    <div key={chainName} className="rounded-md border border-border/60 p-2">
                      <p className="text-xs uppercase text-muted-foreground">{chainName} address</p>
                      <p className="text-xs break-all">{address}</p>
                      <p className="text-xs uppercase text-muted-foreground mt-1">private key</p>
                      <p className="text-xs break-all">{latestBundle.private_keys_by_chain?.[chainName] || "-"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="solana-card">
          <CardHeader>
            <CardTitle className="text-base">DoctorTrade Trading Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Assistant can only trade after explicit consent approval. Configure wallet per chain and revoke anytime.
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm">Status</span>
              <Badge variant={trading?.enabled ? "default" : "outline"}>{trading?.enabled ? "Enabled" : trading?.pending_approval ? "Pending Approval" : "Disabled"}</Badge>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <select
                value={assistantMode}
                onChange={(e) => setAssistantMode(e.target.value as "paper" | "live")}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="paper">Paper</option>
                <option value="live">Live</option>
              </select>
            </div>
            <div className="space-y-3">
              <Label>Wallets By Chain</Label>
              {enabledChains.map((chainName) => (
                <div key={chainName} className="space-y-1">
                  <Label htmlFor={`wallet-${chainName}`} className="text-xs uppercase text-muted-foreground">{chainName}</Label>
                  <Input
                    id={`wallet-${chainName}`}
                    placeholder={`Wallet for ${chainName}`}
                    value={walletsByChain[chainName] || ""}
                    onChange={(e) => setWalletsByChain((prev) => ({ ...prev, [chainName]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="assistant-confirmation">Approval Phrase</Label>
              <Input
                id="assistant-confirmation"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleRequestAssistantConsent} disabled={requestConsent.isPending}>
                {requestConsent.isPending ? "Requesting..." : "Request Consent"}
              </Button>
              <Button variant="outline" onClick={handleApproveAssistantConsent} disabled={approveConsent.isPending || !trading?.pending_approval}>
                {approveConsent.isPending ? "Approving..." : "Approve Consent"}
              </Button>
              <Button variant="outline" onClick={handleRevokeAssistantConsent} disabled={revokeConsent.isPending}>
                {revokeConsent.isPending ? "Revoking..." : "Revoke"}
              </Button>
            </div>
            <div className="rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm font-medium">Execute Assistant Trade</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={tradeChain}
                  onChange={(e) => setTradeChain(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {enabledChains.map((chainName) => (
                    <option key={chainName} value={chainName}>{chainName}</option>
                  ))}
                </select>
                <select
                  value={tradeSide}
                  onChange={(e) => setTradeSide(e.target.value as "buy" | "sell")}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>
              </div>
              <Input placeholder="Contract address" value={tradeContract} onChange={(e) => setTradeContract(e.target.value)} />
              <Input type="number" min={1} step="0.01" placeholder="Notional USD" value={tradeNotional} onChange={(e) => setTradeNotional(e.target.value)} />
              <Button onClick={handleExecuteAssistantTrade} disabled={executeTrade.isPending || !trading?.enabled}>
                {executeTrade.isPending ? "Executing..." : `Execute ${tradeSide.toUpperCase()}`}
              </Button>
              <p className="text-xs text-muted-foreground">Current global chain context: {chain}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
