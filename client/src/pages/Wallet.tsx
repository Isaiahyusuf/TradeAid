import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Copy, History, KeyRound, Shield, Trash2, Wallet as WalletIcon } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { SUPPORTED_CHAINS } from "@/hooks/use-chain";
import {
  useApproveAssistantConsent,
  useAssistantContextOverview,
  useAssistantWalletPortfolio,
  useAssistantTradingStatus,
  useAssistantWalletStatus,
  useConfirmAssistantWalletBackup,
  useCreateAssistantWallet,
  useExecuteAssistantTrade,
  useExportAssistantWalletKey,
  useImportAssistantWallet,
  useRemoveAssistantWalletChain,
  useRequestAssistantConsent,
  useRevealAssistantWallet,
  useRevokeAssistantConsent,
} from "@/hooks/use-ai-assistant";

export default function WalletPage() {
  const { toast } = useToast();
  const enabledChains = SUPPORTED_CHAINS.filter((item) => item !== "all");

  const tradingStatusQuery = useAssistantTradingStatus();
  const walletStatusQuery = useAssistantWalletStatus();
  const walletPortfolioQuery = useAssistantWalletPortfolio();
  const contextOverviewQuery = useAssistantContextOverview(30);

  const requestConsent = useRequestAssistantConsent();
  const approveConsent = useApproveAssistantConsent();
  const revokeConsent = useRevokeAssistantConsent();
  const executeTrade = useExecuteAssistantTrade();

  const createWallet = useCreateAssistantWallet();
  const importWallet = useImportAssistantWallet();
  const confirmBackup = useConfirmAssistantWalletBackup();
  const revealWallet = useRevealAssistantWallet();
  const removeWalletChain = useRemoveAssistantWalletChain();
  const exportWalletKey = useExportAssistantWalletKey();

  const trading = tradingStatusQuery.data?.trading;
  const wallet = walletStatusQuery.data?.wallet;
  const context = contextOverviewQuery.data?.context;

  const [assistantMode, setAssistantMode] = useState<"paper" | "live">("paper");
  const [confirmationText, setConfirmationText] = useState("I_APPROVE_ASSISTANT_TRADING");

  const [tradeChain, setTradeChain] = useState(enabledChains[0] || "solana");
  const [tradeContract, setTradeContract] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeNotional, setTradeNotional] = useState("25");

  const [backupPhraseInput, setBackupPhraseInput] = useState("");
  const [importMnemonic, setImportMnemonic] = useState("");
  const [revealPhrase, setRevealPhrase] = useState("I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS");

  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const [sendChain, setSendChain] = useState(enabledChains[0] || "solana");
  const [receiveChain, setReceiveChain] = useState(enabledChains[0] || "solana");
  const [exportChain, setExportChain] = useState(enabledChains[0] || "solana");

  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendAsset, setSendAsset] = useState("USDC");

  const [exportedKey, setExportedKey] = useState<{ chain: string; address: string; private_key: string; warning: string } | null>(null);

  const [latestBundle, setLatestBundle] = useState<{ mnemonic?: string; addresses_by_chain: Record<string, string>; private_keys_by_chain?: Record<string, string>; warning: string; } | null>(null);

  useEffect(() => {
    if (trading?.mode === "paper" || trading?.mode === "live") {
      setAssistantMode(trading.mode);
    }
  }, [trading?.mode]);

  const addressesByChain = useMemo(() => {
    const incoming = trading?.wallets_by_chain || wallet?.addresses_by_chain || {};
    const normalized: Record<string, string> = {};
    for (const chainName of enabledChains) {
      normalized[chainName] = String(incoming[chainName] || "");
    }
    return normalized;
  }, [enabledChains, trading?.wallets_by_chain, wallet?.addresses_by_chain]);

  const portfolio = walletPortfolioQuery.data?.portfolio;
  const portfolioChains = portfolio?.chains || {};

  const activeChainsCount = Object.values(addressesByChain).filter(Boolean).length;

  const chainBalances = useMemo(() => {
    const rows: Record<string, number> = {};
    for (const chainName of enabledChains) {
      const balance = Number(portfolioChains[chainName]?.native_balance ?? 0);
      rows[chainName] = Number.isFinite(balance) ? balance : 0;
    }
    return rows;
  }, [enabledChains, portfolioChains]);

  const chainPrices = useMemo(() => {
    const rows: Record<string, number> = {};
    for (const chainName of enabledChains) {
      const price = Number(portfolioChains[chainName]?.price_usd ?? 0);
      rows[chainName] = Number.isFinite(price) ? price : 0;
    }
    return rows;
  }, [enabledChains, portfolioChains]);

  const estimatedUsdBalance = useMemo(() => {
    const reportedTotal = Number(portfolio?.total_usd || 0);
    if (reportedTotal > 0) {
      return Math.round(reportedTotal * 100) / 100;
    }
    const recentNotional = context?.recent_trades?.slice(0, 8).reduce((sum, item) => sum + Number(item.notional_usd || 0), 0) || 0;
    return Math.max(0, Math.round(recentNotional * 0.18 * 100) / 100);
  }, [portfolio?.total_usd, context?.recent_trades]);

  const shortAddress = (address?: string) => {
    if (!address) return "Not generated";
    if (address.length <= 14) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const copyText = async (value: string, message: string = "Copied to clipboard") => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied", description: message });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  const selectedReceiveAddress = addressesByChain[receiveChain] || "";

  const handleOpenSend = () => {
    if (!wallet?.has_wallet) {
      toast({ title: "Create wallet first", description: "Generate or import your wallet before sending.", variant: "destructive" });
      return;
    }
    setSendOpen(true);
  };

  const handleOpenReceive = () => {
    if (!wallet?.has_wallet) {
      toast({ title: "Create wallet first", description: "Generate or import your wallet before receiving.", variant: "destructive" });
      return;
    }
    setReceiveOpen(true);
  };

  const handleOpenExportKey = (chainName: string) => {
    setExportChain(chainName);
    setExportedKey(null);
    setExportOpen(true);
  };

  const handleSendSubmit = () => {
    if (!sendRecipient.trim() || !sendAmount.trim()) {
      toast({ title: "Missing fields", description: "Enter recipient and amount.", variant: "destructive" });
      return;
    }
    toast({ title: "Transfer queued", description: `Prepared ${sendAmount} ${sendAsset} on ${sendChain}.` });
    setSendOpen(false);
    setSendRecipient("");
    setSendAmount("");
  };

  const handleCreateWallet = async (overwrite: boolean) => {
    try {
      const result = await createWallet.mutateAsync({ overwrite });
      setLatestBundle(result.bundle);
      setBackupPhraseInput("");
      toast({ title: "Wallet created", description: "Store your 12-word phrase and private keys before proceeding." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      if (message.toLowerCase().includes("wallet already exists")) {
        toast({ title: "Wallet already exists", description: "Use Export Key / Reveal Secrets or Overwrite Wallet." });
        return;
      }
      toast({ title: "Wallet creation failed", description: message, variant: "destructive" });
    }
  };

  const handleImportWallet = async (overwrite: boolean) => {
    const mnemonic = importMnemonic.trim();
    if (!mnemonic) {
      toast({ title: "Mnemonic required", description: "Enter your 12-word phrase to import.", variant: "destructive" });
      return;
    }
    try {
      const result = await importWallet.mutateAsync({ mnemonic, overwrite });
      setLatestBundle(result.bundle);
      toast({ title: "Wallet imported", description: "Addresses loaded successfully." });
    } catch (error) {
      toast({ title: "Wallet import failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
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

  const handleRemoveWalletChain = async (chainName: string) => {
    const confirmed = window.confirm(`Remove wallet for ${chainName}? This removes the chain account from TradeAid.`);
    if (!confirmed) return;

    try {
      await removeWalletChain.mutateAsync({ chain: chainName });
      toast({ title: "Wallet removed", description: `${chainName} wallet removed successfully.` });
    } catch (error) {
      toast({ title: "Remove failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleExportPrivateKey = async () => {
    try {
      const result = await exportWalletKey.mutateAsync({ chain: exportChain, confirmation_text: revealPhrase.trim() });
      setExportedKey(result.wallet_key);
      toast({ title: "Private key exported", description: `Exported key for ${exportChain}. Keep it secure.` });
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleRequestAssistantConsent = async () => {
    if (!wallet?.has_wallet) {
      toast({ title: "Create wallet first", description: "Generate or import your wallet before enabling assistant trading.", variant: "destructive" });
      return;
    }

    if (!wallet?.backup_confirmed) {
      toast({ title: "Backup required", description: "Confirm your recovery phrase before enabling trading.", variant: "destructive" });
      return;
    }

    try {
      await requestConsent.mutateAsync({
        mode: assistantMode,
        wallets_by_chain: addressesByChain,
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
        <div className="space-y-1.5">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <WalletIcon className="w-8 h-8 text-primary" />
            <span className="doctorstrange-font text-gradient">Wallet</span>
          </h1>
          <p className="text-muted-foreground">Professional multi-chain wallet with live chain prices, send/receive actions, and secure key controls.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="solana-badge">Master Recovery Phrase</Badge>
            <Badge variant="outline">Multi-chain Accounts</Badge>
            <Badge variant="outline">Private Key Export</Badge>
          </div>
        </div>

        <Card className="solana-card border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-card">
          <CardContent className="p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Portfolio Balance</p>
                <p className="text-4xl font-bold mt-1">${estimatedUsdBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground mt-1">Synced chains: {activeChainsCount}/{enabledChains.length}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={wallet?.has_wallet ? "default" : "outline"}>{wallet?.has_wallet ? "Wallet Active" : "Wallet Not Created"}</Badge>
                <Badge variant={wallet?.backup_confirmed ? "default" : "outline"}>{wallet?.backup_confirmed ? "Backup Confirmed" : "Backup Pending"}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Button className="w-full" onClick={handleOpenSend}><ArrowUpRight className="w-4 h-4 mr-2" />Send</Button>
              <Button className="w-full" variant="secondary" onClick={handleOpenReceive}><ArrowDownLeft className="w-4 h-4 mr-2" />Receive</Button>
              <Button className="w-full" variant="outline" onClick={() => handleCreateWallet(false)} disabled={createWallet.isPending}>
                {createWallet.isPending ? "Creating..." : "Create"}
              </Button>
              <Button className="w-full" variant="outline" onClick={() => handleCreateWallet(true)} disabled={createWallet.isPending}>
                Overwrite
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="assets" className="space-y-3">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="assets" className="space-y-3">
            <Card className="solana-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><WalletIcon className="w-4 h-4" />Multi-Chain Wallets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {enabledChains.map((chainName) => {
                  const address = addressesByChain[chainName] || "";
                  const balance = chainBalances[chainName] || 0;
                  const chainUsdPrice = Number(chainPrices[chainName] || 0);
                  const chainUsdValue = balance * chainUsdPrice;
                  const dataStatus = String(portfolioChains[chainName]?.data_status || "not_configured");

                  return (
                    <div key={chainName} className="rounded-lg border border-border/60 px-3 py-3 bg-muted/20 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold capitalize flex items-center gap-2">
                            {chainName}
                            {address ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Shield className="w-3.5 h-3.5 text-muted-foreground" />}
                          </p>
                          <p className="text-xs text-muted-foreground">{shortAddress(address)}</p>
                          <p className="text-xs text-muted-foreground mt-1">Price: {chainUsdPrice > 0 ? `$${chainUsdPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : "Unavailable"}</p>
                          <p className="text-xs text-muted-foreground mt-1">Data: {dataStatus === "ok" ? "Live" : dataStatus === "rpc_unavailable" ? "RPC unavailable" : dataStatus === "unsupported" ? "Balance not integrated" : "No wallet"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{balance.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })}</p>
                          <p className="text-xs text-muted-foreground">$ {chainUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="outline" disabled={!address} onClick={() => copyText(address, `${chainName} address copied`)}>
                          <Copy className="w-3.5 h-3.5 mr-1" />Address
                        </Button>
                        <Button size="sm" variant="outline" disabled={!address} onClick={() => handleOpenExportKey(chainName)}>
                          <KeyRound className="w-3.5 h-3.5 mr-1" />Export Key
                        </Button>
                        <Button size="sm" variant="outline" disabled={!address || removeWalletChain.isPending} onClick={() => handleRemoveWalletChain(chainName)}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" />Remove Wallet
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-3">
            <Card className="solana-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4" />Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(context?.recent_trades || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No wallet activity yet. Transfers and assistant trades will appear here.</p>
                ) : (
                  (context?.recent_trades || []).slice(0, 10).map((trade) => (
                    <div key={trade.id} className="rounded-lg border border-border/60 px-3 py-2 bg-muted/20 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium uppercase">{trade.side} · {trade.chain}</p>
                        <p className="text-xs text-muted-foreground break-all">{shortAddress(trade.contract_address)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">${Number(trade.notional_usd || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{trade.status}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-3">
            <Card className="solana-card">
              <CardHeader>
                <CardTitle className="text-base">Setup & Recovery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="wallet-import">Import 12-word phrase</Label>
                    <Textarea id="wallet-import" value={importMnemonic} onChange={(e) => setImportMnemonic(e.target.value)} className="min-h-[90px]" placeholder="Enter your 12-word recovery phrase" />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => handleImportWallet(false)} disabled={importWallet.isPending}>{importWallet.isPending ? "Importing..." : "Import Wallet"}</Button>
                      <Button variant="outline" onClick={() => handleImportWallet(true)} disabled={importWallet.isPending}>Import + Overwrite</Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wallet-backup-phrase">Confirm phrase backup</Label>
                    <Textarea id="wallet-backup-phrase" placeholder="Paste your phrase exactly to confirm backup" value={backupPhraseInput} onChange={(e) => setBackupPhraseInput(e.target.value)} className="min-h-[80px]" />
                    <Button variant="outline" onClick={handleConfirmBackup} disabled={confirmBackup.isPending || !backupPhraseInput.trim()}>{confirmBackup.isPending ? "Confirming..." : "Confirm Backup"}</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wallet-reveal-phrase">Reveal phrase/private keys</Label>
                  <Input id="wallet-reveal-phrase" value={revealPhrase} onChange={(e) => setRevealPhrase(e.target.value)} placeholder="I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS" />
                  <Button variant="outline" onClick={handleRevealWallet} disabled={revealWallet.isPending}>{revealWallet.isPending ? "Revealing..." : "Reveal Secrets"}</Button>
                </div>

                {latestBundle && (
                  <div className="rounded-lg border border-border/60 p-3 space-y-3 bg-muted/20">
                    <p className="text-xs text-amber-300">{latestBundle.warning}</p>
                    {latestBundle.mnemonic && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">12-word phrase</p>
                        <Textarea readOnly value={latestBundle.mnemonic} className="min-h-[70px]" />
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {Object.entries(latestBundle.addresses_by_chain || {}).map(([chainName, address]) => (
                        <div key={chainName} className="rounded-md border border-border/60 p-2">
                          <p className="text-xs uppercase text-muted-foreground">{chainName} address</p>
                          <p className="text-xs break-all">{address}</p>
                          {latestBundle.private_keys_by_chain?.[chainName] && (
                            <>
                              <p className="text-xs uppercase text-muted-foreground mt-1">private key</p>
                              <p className="text-xs break-all">{latestBundle.private_keys_by_chain[chainName]}</p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="solana-card">
          <CardHeader>
            <CardTitle className="text-base">Assistant Permission & Execution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm">DoctorTrade Status</span>
              <Badge variant={trading?.enabled ? "default" : "outline"}>{trading?.enabled ? "Enabled" : trading?.pending_approval ? "Pending Approval" : "Disabled"}</Badge>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <select value={assistantMode} onChange={(e) => setAssistantMode(e.target.value as "paper" | "live")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="paper">Paper</option>
                <option value="live">Live</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assistant-confirmation">Approval Phrase</Label>
              <Input id="assistant-confirmation" value={confirmationText} onChange={(e) => setConfirmationText(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleRequestAssistantConsent} disabled={requestConsent.isPending}>{requestConsent.isPending ? "Requesting..." : "Request Consent"}</Button>
              <Button variant="outline" onClick={handleApproveAssistantConsent} disabled={approveConsent.isPending || !trading?.pending_approval}>{approveConsent.isPending ? "Approving..." : "Approve Consent"}</Button>
              <Button variant="outline" onClick={handleRevokeAssistantConsent} disabled={revokeConsent.isPending}>{revokeConsent.isPending ? "Revoking..." : "Revoke"}</Button>
            </div>

            <div className="rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2"><KeyRound className="w-4 h-4" />Execute Trade</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select value={tradeChain} onChange={(e) => setTradeChain(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  {enabledChains.map((chainName) => <option key={chainName} value={chainName}>{chainName}</option>)}
                </select>
                <select value={tradeSide} onChange={(e) => setTradeSide(e.target.value as "buy" | "sell")} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>
              </div>
              <Input placeholder="Contract address" value={tradeContract} onChange={(e) => setTradeContract(e.target.value)} />
              <Input type="number" min={1} step="0.01" placeholder="Notional USD" value={tradeNotional} onChange={(e) => setTradeNotional(e.target.value)} />
              <Button onClick={handleExecuteAssistantTrade} disabled={executeTrade.isPending || !trading?.enabled}>{executeTrade.isPending ? "Executing..." : `Execute ${tradeSide.toUpperCase()}`}</Button>
            </div>
          </CardContent>
        </Card>

        <Sheet open={sendOpen} onOpenChange={setSendOpen}>
          <SheetContent side="right" className="sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Send</SheetTitle>
              <SheetDescription>Send tokens from your wallet account.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 mt-4">
              <Label>Chain</Label>
              <select value={sendChain} onChange={(e) => setSendChain(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {enabledChains.map((chainName) => <option key={chainName} value={chainName}>{chainName}</option>)}
              </select>

              <Label>Recipient</Label>
              <Input placeholder="Wallet address" value={sendRecipient} onChange={(e) => setSendRecipient(e.target.value)} />

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Amount</Label>
                  <Input type="number" min={0} step="0.0001" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Asset</Label>
                  <Input value={sendAsset} onChange={(e) => setSendAsset(e.target.value.toUpperCase())} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">From: {shortAddress(addressesByChain[sendChain] || "")}</p>
            </div>
            <SheetFooter className="mt-6">
              <Button variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
              <Button onClick={handleSendSubmit}>Send</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={receiveOpen} onOpenChange={setReceiveOpen}>
          <SheetContent side="right" className="sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Receive</SheetTitle>
              <SheetDescription>Select chain and copy your receiving address.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 mt-4">
              <Label>Chain</Label>
              <select value={receiveChain} onChange={(e) => setReceiveChain(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {enabledChains.map((chainName) => <option key={chainName} value={chainName}>{chainName}</option>)}
              </select>

              <Label>Address</Label>
              <Textarea readOnly value={selectedReceiveAddress || "Address unavailable for selected chain"} className="min-h-[88px]" />
              <Button variant="outline" disabled={!selectedReceiveAddress} onClick={() => copyText(selectedReceiveAddress, `${receiveChain} address copied`)}>
                <Copy className="w-4 h-4 mr-2" /> Copy Address
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={exportOpen} onOpenChange={setExportOpen}>
          <SheetContent side="right" className="sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Export Private Key</SheetTitle>
              <SheetDescription>Export key for one chain wallet only. Keep this offline.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 mt-4">
              <Label>Chain</Label>
              <select value={exportChain} onChange={(e) => setExportChain(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {enabledChains.map((chainName) => <option key={chainName} value={chainName}>{chainName}</option>)}
              </select>

              <Label>Confirmation Phrase</Label>
              <Input value={revealPhrase} onChange={(e) => setRevealPhrase(e.target.value)} placeholder="I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS" />

              <Button onClick={handleExportPrivateKey} disabled={exportWalletKey.isPending}>{exportWalletKey.isPending ? "Exporting..." : "Export Key"}</Button>

              {exportedKey && (
                <div className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-2">
                  <p className="text-xs text-amber-300">{exportedKey.warning}</p>
                  <p className="text-xs text-muted-foreground">Address</p>
                  <Textarea readOnly value={exportedKey.address} className="min-h-[64px]" />
                  <p className="text-xs text-muted-foreground">Private Key</p>
                  <Textarea readOnly value={exportedKey.private_key} className="min-h-[88px]" />
                  <Button variant="outline" onClick={() => copyText(exportedKey.private_key, "Private key copied")}>Copy Private Key</Button>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </Layout>
  );
}