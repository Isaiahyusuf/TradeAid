import { useEffect, useState } from "react";
import { KeyRound, Wallet as WalletIcon } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { SUPPORTED_CHAINS } from "@/hooks/use-chain";
import {
  useApproveAssistantConsent,
  useAssistantTradingStatus,
  useAssistantWalletStatus,
  useConfirmAssistantWalletBackup,
  useCreateAssistantWallet,
  useExecuteAssistantTrade,
  useImportAssistantWallet,
  useRequestAssistantConsent,
  useRevealAssistantWallet,
  useRevokeAssistantConsent,
} from "@/hooks/use-ai-assistant";

export default function WalletPage() {
  const { toast } = useToast();
  const enabledChains = SUPPORTED_CHAINS.filter((item) => item !== "all");

  const tradingStatusQuery = useAssistantTradingStatus();
  const walletStatusQuery = useAssistantWalletStatus();
  const requestConsent = useRequestAssistantConsent();
  const approveConsent = useApproveAssistantConsent();
  const revokeConsent = useRevokeAssistantConsent();
  const executeTrade = useExecuteAssistantTrade();
  const createWallet = useCreateAssistantWallet();
  const importWallet = useImportAssistantWallet();
  const confirmBackup = useConfirmAssistantWalletBackup();
  const revealWallet = useRevealAssistantWallet();

  const trading = tradingStatusQuery.data?.trading;
  const wallet = walletStatusQuery.data?.wallet;

  const [assistantMode, setAssistantMode] = useState<"paper" | "live">("paper");
  const [walletsByChain, setWalletsByChain] = useState<Record<string, string>>({});
  const [confirmationText, setConfirmationText] = useState("I_APPROVE_ASSISTANT_TRADING");
  const [tradeChain, setTradeChain] = useState("solana");
  const [tradeContract, setTradeContract] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeNotional, setTradeNotional] = useState("25");

  const [backupPhraseInput, setBackupPhraseInput] = useState("");
  const [importMnemonic, setImportMnemonic] = useState("");
  const [revealPhrase, setRevealPhrase] = useState("I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS");
  const [latestBundle, setLatestBundle] = useState<{ mnemonic?: string; addresses_by_chain: Record<string, string>; private_keys_by_chain?: Record<string, string>; warning: string; } | null>(null);

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
        <div className="space-y-1.5">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <WalletIcon className="w-8 h-8 text-primary" />
            <span className="doctorstrange-font text-gradient">Wallet</span>
          </h1>
          <p className="text-muted-foreground">Create or import wallet (Trust-wallet style), manage recovery phrase, and control trading permission.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="solana-badge">12-word Recovery Phrase</Badge>
            <Badge variant="outline">Private Keys per Chain</Badge>
            <Badge variant="outline">Encrypted Storage</Badge>
          </div>
        </div>

        <Card className="solana-card">
          <CardHeader>
            <CardTitle className="text-base">Wallet Vault</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                {createWallet.isPending ? "Creating..." : "Create New Wallet"}
              </Button>
              <Button variant="outline" onClick={() => handleCreateWallet(true)} disabled={createWallet.isPending}>
                Overwrite Wallet
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet-import">Import 12-word phrase</Label>
              <Textarea
                id="wallet-import"
                value={importMnemonic}
                onChange={(e) => setImportMnemonic(e.target.value)}
                className="min-h-[90px]"
                placeholder="enter twelve word phrase"
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleImportWallet(false)} disabled={importWallet.isPending}>
                  {importWallet.isPending ? "Importing..." : "Import Wallet"}
                </Button>
                <Button variant="outline" onClick={() => handleImportWallet(true)} disabled={importWallet.isPending}>
                  Import + Overwrite
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet-backup-phrase">Confirm phrase backup</Label>
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
              <Label htmlFor="wallet-reveal-phrase">Reveal phrase/private keys</Label>
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

        <Card className="solana-card">
          <CardHeader>
            <CardTitle className="text-base">Trading Permission & Execution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm">DoctorTrade Status</span>
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
              <Input id="assistant-confirmation" value={confirmationText} onChange={(e) => setConfirmationText(e.target.value)} />
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
              <p className="text-sm font-medium flex items-center gap-2"><KeyRound className="w-4 h-4" />Execute Trade</p>
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
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
