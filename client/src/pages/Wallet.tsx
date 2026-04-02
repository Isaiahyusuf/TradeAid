import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Copy, History, KeyRound, Loader2, Settings2, Shield, Trash2, Wallet as WalletIcon } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { SUPPORTED_CHAINS } from "@/hooks/use-chain";
import { useLocation } from "wouter";
import { TokenAvatar } from "@/components/token/TokenAvatar";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";
import {
  useAssistantWalletSwap,
  useAssistantWalletSwapQuote,
  useAssistantContextOverview,
  useAssistantWalletTransactions,
  useAssistantWalletPortfolio,
  useAssistantTradingStatus,
  useAssistantWalletStatus,
  useConfirmAssistantWalletBackup,
  useCreateAssistantWallet,
  useDeleteAssistantWallet,
  useExportAssistantWalletKey,
  useImportAssistantWallet,
  useImportAssistantWalletPrivateKey,
  useRemoveAssistantWalletChain,
  useRevealAssistantWallet,
  useTransferAssistantWallet,
} from "@/hooks/use-ai-assistant";
import { useDoctorStatus } from "@/hooks/use-doctortrade";

type SupportedWalletChain = (typeof SUPPORTED_CHAINS)[number];

export default function WalletPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const enabledChains = [...SUPPORTED_CHAINS] as SupportedWalletChain[];
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const returnTo = String(searchParams.get("returnTo") || "").trim();
  const walletAction = String(searchParams.get("action") || "").trim().toLowerCase();
  const prefillSwapTokenMint = String(searchParams.get("contract") || "").trim();
  const prefillSwapAmountSol = String(searchParams.get("amount_sol") || searchParams.get("amount") || "").trim();
  const prefillSwapSide = String(searchParams.get("side") || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
  const [walletTab, setWalletTab] = useState<"assets" | "activity" | "security">("assets");

  const tradingStatusQuery = useAssistantTradingStatus();
  const walletStatusQuery = useAssistantWalletStatus();
  const walletPortfolioQuery = useAssistantWalletPortfolio();
  const walletTransactionsQuery = useAssistantWalletTransactions(50, walletTab === "activity");
  const contextOverviewQuery = useAssistantContextOverview(30, walletTab === "activity");
  const doctorStatusQuery = useDoctorStatus();

  const createWallet = useCreateAssistantWallet();
  const importWallet = useImportAssistantWallet();
  const importWalletPrivateKey = useImportAssistantWalletPrivateKey();
  const confirmBackup = useConfirmAssistantWalletBackup();
  const revealWallet = useRevealAssistantWallet();
  const removeWalletChain = useRemoveAssistantWalletChain();
  const deleteWallet = useDeleteAssistantWallet();
  const exportWalletKey = useExportAssistantWalletKey();
  const transferWallet = useTransferAssistantWallet();
  const walletSwap = useAssistantWalletSwap();

  const trading = tradingStatusQuery.data?.trading;
  const wallet = walletStatusQuery.data?.wallet;
  const context = contextOverviewQuery.data?.context;

  const [importMnemonic, setImportMnemonic] = useState("");
  const [importPrivateKey, setImportPrivateKey] = useState("");

  const [sendOpen, setSendOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [walletSettingsOpen, setWalletSettingsOpen] = useState(false);
  const [securitySetupOpen, setSecuritySetupOpen] = useState(false);
  const [securityBackupOpen, setSecurityBackupOpen] = useState(false);
  const [securityRecoveryOpen, setSecurityRecoveryOpen] = useState(false);

  const [sendChain, setSendChain] = useState<SupportedWalletChain>(enabledChains[0] || "solana");
  const [receiveChain, setReceiveChain] = useState<SupportedWalletChain>(enabledChains[0] || "solana");
  const [exportChain, setExportChain] = useState<SupportedWalletChain>(enabledChains[0] || "solana");
  const [settingsChain, setSettingsChain] = useState<SupportedWalletChain>(enabledChains[0] || "solana");

  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendAsset, setSendAsset] = useState("SOL");
  const [swapSide, setSwapSide] = useState<"buy" | "sell">("buy");
  const [swapTokenMint, setSwapTokenMint] = useState("");
  const [swapAmountSol, setSwapAmountSol] = useState("0.1");
  const [swapSellAmountTokens, setSwapSellAmountTokens] = useState("");
  const swapMode = "live" as const;

  const [exportedKey, setExportedKey] = useState<{ chain: string; address: string; private_key: string; warning: string } | null>(null);

  const [latestBundle, setLatestBundle] = useState<{ mnemonic?: string; addresses_by_chain: Record<string, string>; private_keys_by_chain?: Record<string, string>; warning: string; } | null>(null);

  useEffect(() => {
    if (walletAction === "connect") {
      setWalletTab("security");
      setSecuritySetupOpen(true);
    }
  }, [walletAction, location]);

  useEffect(() => {
    if (walletAction !== "swap") return;
    setWalletTab("assets");
    setSwapOpen(true);
    setSwapSide(prefillSwapSide);
    if (prefillSwapTokenMint) {
      setSwapTokenMint(prefillSwapTokenMint);
    }
    if (prefillSwapAmountSol) {
      setSwapAmountSol(prefillSwapAmountSol);
    }
  }, [walletAction, prefillSwapTokenMint, prefillSwapAmountSol, prefillSwapSide]);

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
  const portfolioUpdatedAt = portfolio?.updated_at ? new Date(portfolio.updated_at).toLocaleString() : "-";
  const solanaPortfolioTokens = useMemo(
    () => ((portfolioChains as any)?.solana?.spl_tokens || []) as Array<{
      mint: string;
      symbol: string;
      name?: string;
      logo_url?: string;
      ui_amount: number;
      price_usd?: number;
      value_usd: number;
      decimals?: number;
    }>,
    [portfolioChains],
  );
  const doctorWalletTokens = useMemo(
    () => ((doctorStatusQuery.data?.wallet_tokens || []) as Array<any>).map((token) => ({
      mint: String(token?.mint || "").trim(),
      symbol: String(token?.symbol || "").trim() || "TOKEN",
      name: String(token?.name || token?.symbol || "Token").trim(),
      logo_url: String(token?.logo_url || "").trim(),
      ui_amount: Number(token?.ui_amount || 0),
      price_usd: Number(token?.price_usd || 0),
      value_usd: Number(token?.worth_usd || 0),
      decimals: Math.max(0, Math.trunc(Number(token?.decimals || 0))),
    })).filter((token) => Boolean(token.mint) && Number(token.ui_amount || 0) > 0),
    [doctorStatusQuery.data?.wallet_tokens],
  );
  const usingDoctorWalletTokenFallback = solanaPortfolioTokens.length === 0 && doctorWalletTokens.length > 0;
  const solanaSplTokens = useMemo(
    () => (usingDoctorWalletTokenFallback ? doctorWalletTokens : solanaPortfolioTokens),
    [usingDoctorWalletTokenFallback, doctorWalletTokens, solanaPortfolioTokens],
  );

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
    const displayedTokenValueUsd = solanaSplTokens.reduce((sum, token) => sum + Number((token as any).value_usd || 0), 0);
    if (reportedTotal > 0) {
      const adjustedTotal = usingDoctorWalletTokenFallback
        ? reportedTotal + displayedTokenValueUsd
        : reportedTotal;
      return Math.round(adjustedTotal * 100) / 100;
    }
    const recentNotional = context?.recent_trades?.slice(0, 8).reduce((sum, item) => sum + Number(item.notional_usd || 0), 0) || 0;
    return Math.max(0, Math.round(Math.max(displayedTokenValueUsd, recentNotional * 0.18) * 100) / 100);
  }, [portfolio?.total_usd, solanaSplTokens, usingDoctorWalletTokenFallback, context?.recent_trades]);

  const selectedSellTokenBalance = useMemo(() => {
    const mint = String(swapTokenMint || "").trim();
    if (!mint || swapSide !== "sell") return 0;
    const token = solanaSplTokens.find((item) => String(item.mint || "").trim() === mint);
    return Number(token?.ui_amount || 0);
  }, [solanaSplTokens, swapSide, swapTokenMint]);

  const walletSyncing = Boolean(
    tradingStatusQuery.isFetching ||
    walletStatusQuery.isFetching ||
    walletPortfolioQuery.isFetching ||
    walletTransactionsQuery.isFetching ||
    contextOverviewQuery.isFetching ||
    doctorStatusQuery.isFetching,
  );

  const walletInitialLoading = Boolean(
    tradingStatusQuery.isLoading ||
    walletStatusQuery.isLoading ||
    walletPortfolioQuery.isLoading ||
    doctorStatusQuery.isLoading,
  );

  const lastWalletSyncTs = Math.max(
    Number(tradingStatusQuery.dataUpdatedAt || 0),
    Number(walletStatusQuery.dataUpdatedAt || 0),
    Number(walletPortfolioQuery.dataUpdatedAt || 0),
    Number(walletTransactionsQuery.dataUpdatedAt || 0),
    Number(contextOverviewQuery.dataUpdatedAt || 0),
    Number(doctorStatusQuery.dataUpdatedAt || 0),
  );

  const lastWalletSyncLabel = lastWalletSyncTs > 0 ? new Date(lastWalletSyncTs).toLocaleTimeString() : "-";

  const refreshWalletViews = async () => {
    await Promise.allSettled([
      tradingStatusQuery.refetch(),
      walletStatusQuery.refetch(),
      walletPortfolioQuery.refetch(),
      walletTransactionsQuery.refetch(),
      contextOverviewQuery.refetch(),
      doctorStatusQuery.refetch(),
    ]);
  };

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
  const solanaAddress = String(addressesByChain.solana || "").trim();
  const walletConnected = Boolean(wallet?.has_wallet && solanaAddress);
  const walletExists = Boolean(wallet?.has_wallet || solanaAddress);
  const savingInProgress = Boolean(
    createWallet.isPending
    || importWallet.isPending
    || importWalletPrivateKey.isPending
    || confirmBackup.isPending
    || revealWallet.isPending
    || removeWalletChain.isPending
    || deleteWallet.isPending
    || exportWalletKey.isPending
    || transferWallet.isPending
    || walletSwap.isPending,
  );
  const savingMessage = importWalletPrivateKey.isPending
    ? "Connecting private key..."
    : createWallet.isPending
      ? "Creating wallet..."
      : importWallet.isPending
        ? "Importing wallet..."
        : transferWallet.isPending
          ? "Sending transaction..."
          : walletSwap.isPending
            ? "Submitting swap..."
            : deleteWallet.isPending
              ? "Deleting wallet..."
              : "Saving wallet settings...";
  const swapAmountSolValue = Number(swapAmountSol);
  const swapQuoteQuery = useAssistantWalletSwapQuote(
    {
      side: swapSide,
      token_mint: swapTokenMint.trim(),
      amount_sol: Number.isFinite(swapAmountSolValue) && swapAmountSolValue > 0 ? swapAmountSolValue : 0,
    },
    swapOpen &&
      swapSide === "buy" &&
      Boolean(swapTokenMint.trim()) &&
      Number.isFinite(swapAmountSolValue) &&
      swapAmountSolValue > 0,
  );
  const swapQuoteSource = String((swapQuoteQuery.data as any)?.quote?.estimate_source || "router_quote").trim().toLowerCase();
  const swapQuoteIsFallback = swapQuoteSource === "price_fallback";

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

  const handleOpenSwap = () => {
    if (!wallet?.has_wallet) {
      toast({ title: "Create wallet first", description: "Generate or import your wallet before swapping.", variant: "destructive" });
      return;
    }
    setSwapOpen(true);
  };

  const handleOpenExportKey = (chainName: string) => {
    setExportChain(chainName as SupportedWalletChain);
    setExportedKey(null);
    setExportOpen(true);
  };

  const handleOpenWalletSettings = (chainName: string) => {
    setSettingsChain(chainName as SupportedWalletChain);
    setWalletSettingsOpen(true);
  };

  const handleSendSubmit = async () => {
    if (!sendRecipient.trim() || !sendAmount.trim()) {
      toast({ title: "Missing fields", description: "Enter recipient and amount.", variant: "destructive" });
      return;
    }
    const amountNumber = Number(sendAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast({ title: "Invalid amount", description: "Enter a valid transfer amount.", variant: "destructive" });
      return;
    }
    if (sendAsset.toUpperCase() !== "SOL") {
      toast({ title: "Unsupported asset", description: "Live transfer currently supports SOL only.", variant: "destructive" });
      return;
    }

    try {
      const result = await transferWallet.mutateAsync({
        chain: sendChain,
        recipient_address: sendRecipient.trim(),
        amount: amountNumber,
        asset: sendAsset.toUpperCase(),
      });
      await refreshWalletViews();
      toast({ title: "Transfer submitted", description: `Tx: ${result.transfer.tx_hash.slice(0, 10)}...` });
      if (result.transfer.explorer_url) {
        window.open(result.transfer.explorer_url, "_blank");
      }
      setSendOpen(false);
      setSendRecipient("");
      setSendAmount("");
    } catch (error) {
      toast({ title: "Transfer failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleSwapSubmit = async () => {
    const tokenMint = swapTokenMint.trim();
    const amountSol = Number(swapAmountSol);
    const sellTokenAmount = Number(swapSellAmountTokens);
    if (!tokenMint) {
      toast({ title: "CA required", description: "Enter a Solana token CA address.", variant: "destructive" });
      return;
    }
    if (swapSide === "buy" && (!Number.isFinite(amountSol) || amountSol <= 0)) {
      toast({ title: "Invalid amount", description: "Enter a valid SOL amount for the swap.", variant: "destructive" });
      return;
    }
    if (swapSide === "sell" && (!Number.isFinite(sellTokenAmount) || sellTokenAmount <= 0)) {
      toast({ title: "Invalid amount", description: "Enter token amount to swap back to SOL.", variant: "destructive" });
      return;
    }

    try {
      const solPriceUsd = Number(chainPrices.solana || 0);
      const notionalUsd = swapSide === "buy" && solPriceUsd > 0 ? amountSol * solPriceUsd : undefined;
      const result = await walletSwap.mutateAsync({
        side: swapSide,
        token_mint: tokenMint,
        amount_sol: swapSide === "buy" ? amountSol : undefined,
        sell_token_amount: swapSide === "sell" ? sellTokenAmount : undefined,
        notional_usd: notionalUsd,
        mode: swapMode,
      });
      await refreshWalletViews();
      toast({ title: "Swap submitted", description: `Tx: ${result.trade.tx_hash.slice(0, 10)}...` });
      if (result.trade.explorer_url) {
        window.open(result.trade.explorer_url, "_blank");
      }
      setSwapOpen(false);
      setSwapTokenMint("");
      setSwapAmountSol("0.1");
      setSwapSellAmountTokens("");
    } catch (error) {
      toast({ title: "Swap failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleQuickSwapToSol = async (token: { mint: string; symbol?: string; ui_amount?: number }) => {
    if (!wallet?.has_wallet) {
      toast({ title: "Create wallet first", description: "Generate or import your wallet before swapping.", variant: "destructive" });
      return;
    }
    const mint = String(token.mint || "").trim();
    if (!mint) {
      toast({ title: "Swap failed", description: "Token mint is missing.", variant: "destructive" });
      return;
    }
    const amount = Number(token.ui_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "No balance", description: "This token has no spendable balance.", variant: "destructive" });
      return;
    }

    setSwapSide("sell");
    setSwapTokenMint(mint);
    setSwapSellAmountTokens(amount.toString());
    setSwapOpen(true);
  };

  const applySellPercent = (percent: number) => {
    const p = Math.max(1, Math.min(100, Number(percent || 0)));
    const balance = Math.max(0, Number(selectedSellTokenBalance || 0));
    if (!(balance > 0)) return;
    const amount = (balance * p) / 100;
    setSwapSellAmountTokens(String(Number(amount.toFixed(9))));
  };

  const handleCreateWallet = async (overwrite: boolean) => {
    await Promise.allSettled([
      queryClient.cancelQueries({ queryKey: ["ai-wallet-portfolio"] }),
      queryClient.cancelQueries({ queryKey: ["ai-wallet-transactions"] }),
      queryClient.cancelQueries({ queryKey: ["ai-context-overview"] }),
      queryClient.cancelQueries({ queryKey: ["ai-wallet-status"] }),
      queryClient.cancelQueries({ queryKey: ["ai-trading-status"] }),
    ]);

    try {
      const result = await createWallet.mutateAsync({ overwrite });
      setLatestBundle(result.bundle);
      await refreshWalletViews();
      toast({ title: "Wallet created", description: "Wallet is ready. Secret reveal/export is restricted by security policy." });
      if (returnTo) {
        setLocation(returnTo);
      }
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
    await Promise.allSettled([
      queryClient.cancelQueries({ queryKey: ["ai-wallet-portfolio"] }),
      queryClient.cancelQueries({ queryKey: ["ai-wallet-transactions"] }),
      queryClient.cancelQueries({ queryKey: ["ai-context-overview"] }),
      queryClient.cancelQueries({ queryKey: ["ai-wallet-status"] }),
      queryClient.cancelQueries({ queryKey: ["ai-trading-status"] }),
    ]);

    try {
      const result = await importWallet.mutateAsync({ mnemonic, overwrite });
      setLatestBundle(result.bundle);
      await refreshWalletViews();
      toast({ title: "Wallet imported", description: "Addresses loaded successfully. Secret reveal/export is restricted by default." });
      if (returnTo) {
        setLocation(returnTo);
      }
    } catch (error) {
      toast({ title: "Wallet import failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleImportWalletPrivateKey = async (overwrite: boolean) => {
    const privateKey = importPrivateKey.trim();
    if (!privateKey) {
      toast({ title: "Private key required", description: "Enter your Solana private key to import.", variant: "destructive" });
      return;
    }
    await Promise.allSettled([
      queryClient.cancelQueries({ queryKey: ["ai-wallet-portfolio"] }),
      queryClient.cancelQueries({ queryKey: ["ai-wallet-transactions"] }),
      queryClient.cancelQueries({ queryKey: ["ai-context-overview"] }),
      queryClient.cancelQueries({ queryKey: ["ai-wallet-status"] }),
      queryClient.cancelQueries({ queryKey: ["ai-trading-status"] }),
    ]);

    try {
      const result = await importWalletPrivateKey.mutateAsync({ private_key: privateKey, overwrite });
      setLatestBundle(result.bundle);
      await refreshWalletViews();
      toast({ title: "Wallet connected", description: "Private key imported securely." });
      if (returnTo) {
        setLocation(returnTo);
      }
    } catch (error) {
      toast({ title: "Private key import failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleConfirmBackup = async () => {
    if (!wallet?.has_wallet) {
      toast({ title: "Wallet required", description: "Connect your private key or import phrase first.", variant: "destructive" });
      return;
    }
    if (wallet?.backup_confirmed) {
      toast({ title: "Backup already confirmed", description: "Your wallet backup is already marked as confirmed." });
      return;
    }

    try {
      await confirmBackup.mutateAsync();
      await refreshWalletViews();
      toast({ title: "Backup confirmed", description: "Recovery phrase backup recorded." });
    } catch (error) {
      toast({ title: "Backup confirmation failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleRevealWallet = async () => {
    if (!wallet?.has_wallet) {
      toast({ title: "Wallet required", description: "Connect your private key or import phrase first.", variant: "destructive" });
      return;
    }

    try {
      const result = await revealWallet.mutateAsync();
      setLatestBundle(result.bundle);
      await refreshWalletViews();
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

  const handleDeleteWholeWallet = async () => {
    const confirmed = window.confirm("Delete the entire wallet and all linked chain accounts? This action cannot be undone.");
    if (!confirmed) return;

    try {
      await deleteWallet.mutateAsync();
      setLatestBundle(null);
      setExportedKey(null);
      setSendOpen(false);
      setReceiveOpen(false);
      setExportOpen(false);
      setWalletSettingsOpen(false);
      toast({ title: "Wallet deleted", description: "You can now create a brand new wallet." });
    } catch (error) {
      toast({ title: "Delete failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleExportPrivateKey = async () => {
    try {
      const result = await exportWalletKey.mutateAsync({ chain: exportChain });
      setExportedKey(result.wallet_key);
      toast({ title: "Private key exported", description: `Exported key for ${exportChain}. Keep it secure.` });
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {savingInProgress && (
          <div className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-[1px] flex items-center justify-center px-4">
            <div className="rounded-xl border border-border/60 bg-card shadow-xl p-5 w-full max-w-sm">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-semibold">Please wait</p>
                  <p className="text-xs text-muted-foreground">{savingMessage}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {walletAction === "connect" && (
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Wallet Setup</p>
                <p className="text-xs text-muted-foreground">Create or import your wallet in this tab. DoctorTrade linking is managed on the DoctorTrade page.</p>
              </div>
              {returnTo && (
                <Button variant="outline" onClick={() => setLocation(returnTo)}>
                  Back to DoctorTrade
                </Button>
              )}
            </div>
          </Card>
        )}

        <div className="space-y-1.5">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <WalletIcon className="w-8 h-8 text-primary" />
            <span className="doctorstrange-font text-gradient">Wallet</span>
          </h1>
          <p className="text-muted-foreground">Professional Solana wallet with live pricing, send/receive actions, and secure key controls.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="solana-badge">Master Recovery Phrase</Badge>
            <Badge variant="outline">Solana Account</Badge>
            <Badge variant="outline">Private Key Export</Badge>
            <Badge variant={walletConnected ? "default" : "outline"} className={walletConnected ? "border-green-500/40 bg-green-500/15 text-green-300" : ""}>
              {walletConnected ? "Private Key Connected" : "Private Key Not Connected"}
            </Badge>
            <Badge variant="outline" className={walletSyncing ? "border-yellow-500/40 text-yellow-400" : "border-green-500/40 text-green-400"}>
              {walletInitialLoading ? "Loading..." : walletSyncing ? "Syncing..." : "Live Sync"}
            </Badge>
            <Button variant="outline" size="sm" onClick={refreshWalletViews} disabled={walletSyncing}>
              {walletSyncing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Last sync: {lastWalletSyncLabel}</p>
        </div>

        <Card className="solana-card border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-card">
          <CardContent className="p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Portfolio Balance</p>
                <p className="text-4xl font-bold mt-1">${estimatedUsdBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground mt-1">Synced chains: {activeChainsCount}/{enabledChains.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Portfolio updated: {portfolioUpdatedAt}</p>
                <p className="text-xs text-muted-foreground mt-1">DoctorTrade wallet: {walletConnected ? `Connected (${shortAddress(solanaAddress)})` : "Not connected"}</p>
                {usingDoctorWalletTokenFallback && (
                  <p className="text-xs text-amber-400 mt-1">Using DoctorTrade token snapshot while wallet indexing catches up.</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={wallet?.has_wallet ? "default" : "outline"}>{wallet?.has_wallet ? "Wallet Active" : "Wallet Not Created"}</Badge>
                <Badge variant={wallet?.backup_confirmed ? "default" : "outline"}>{wallet?.backup_confirmed ? "Backup Confirmed" : "Backup Pending"}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Button className="w-full" onClick={handleOpenSend}><ArrowUpRight className="w-4 h-4 mr-2" />Send</Button>
              <Button className="w-full" variant="secondary" onClick={handleOpenReceive}><ArrowDownLeft className="w-4 h-4 mr-2" />Receive</Button>
              <Button className="w-full" variant="secondary" onClick={handleOpenSwap}>Swap</Button>
              <Button className="w-full" variant="outline" onClick={() => handleCreateWallet(false)} disabled={createWallet.isPending}>
                {createWallet.isPending ? "Creating..." : "Create"}
              </Button>
              <Button className="w-full" variant="outline" onClick={() => handleCreateWallet(true)} disabled={createWallet.isPending}>
                Overwrite
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={walletTab} onValueChange={(value) => setWalletTab(value as "assets" | "activity" | "security")} className="space-y-3">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="activity">Transactions</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="assets" className="space-y-3">
            <Card className="solana-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><WalletIcon className="w-4 h-4" />Solana Wallet</CardTitle>
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
                          <Badge variant={address ? "default" : "outline"} className="mt-1 text-[10px]">
                            {address ? "Connected" : "Not Connected"}
                          </Badge>
                          <p className="text-xs text-muted-foreground">{shortAddress(address)}</p>
                          <p className="text-xs text-muted-foreground mt-1">Price: {chainUsdPrice > 0 ? `$${chainUsdPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : "Unavailable"}</p>
                          <p className="text-xs text-muted-foreground mt-1">Data: {dataStatus === "ok" ? "Live" : dataStatus === "rpc_unavailable" ? "RPC unavailable" : dataStatus === "rpc_not_configured" ? "RPC not configured" : dataStatus === "invalid_address" ? "Invalid address" : dataStatus === "unsupported" ? "Balance not integrated" : "No wallet"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{balance.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })} {portfolioChains[chainName]?.native_symbol || ""}</p>
                          <p className="text-xs text-muted-foreground">$ {chainUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="outline" disabled={!address} onClick={() => copyText(address, `${chainName} address copied`)}>
                          <Copy className="w-3.5 h-3.5 mr-1" />Address
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" disabled={!address}>
                              <Settings2 className="w-3.5 h-3.5 mr-1" />Settings
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => handleOpenWalletSettings(chainName)}>
                              <KeyRound className="w-3.5 h-3.5 mr-2" />
                              Wallet Security
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="solana-card">
              <CardHeader>
                <CardTitle className="text-base">Token Holdings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {solanaSplTokens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No token holdings detected yet. Bought tokens will appear here automatically.</p>
                ) : (
                  solanaSplTokens.map((token) => {
                    const tokenAmount = Number(token.ui_amount || 0);
                    const tokenValueUsd = Number(token.value_usd || 0);
                    const tokenPriceUsd = Number((token as any).price_usd || 0);
                    const tokenName = String((token as any).name || token.symbol || "Token");
                    return (
                      <div key={token.mint} className="rounded-lg border border-border/60 px-3 py-2 bg-muted/20 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2">
                          <TokenAvatar
                            logoUrl={(token as any).logo_url}
                            symbol={token.symbol}
                            name={tokenName}
                            className="h-8 w-8 border-none"
                            fallbackClassName="text-[10px]"
                          />
                          <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{String(token.symbol || "TOKEN")}</p>
                          <p className="text-xs text-muted-foreground truncate">{tokenName}</p>
                          <p className="text-[11px] text-muted-foreground break-all">{shortAddress(token.mint)}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold">{tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 9 })}</p>
                          <p className="text-[11px] text-muted-foreground">{tokenPriceUsd > 0 ? `$${tokenPriceUsd.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 9 })}` : "Price unavailable"}</p>
                          <p className="text-xs text-muted-foreground">$ {tokenValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 h-7 px-2 text-[11px]"
                            disabled={walletSwap.isPending || tokenAmount <= 0}
                            onClick={() => handleQuickSwapToSol(token)}
                          >
                            Swap to SOL
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-3">
            <Card className="solana-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4" />Transaction History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(walletTransactionsQuery.data?.transactions || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transactions yet. Real transfers and assistant trades will appear here when executed.</p>
                ) : (
                  (walletTransactionsQuery.data?.transactions || []).slice(0, 20).map((trade) => (
                    <div key={trade.id} className="rounded-lg border border-border/60 px-3 py-2 bg-muted/20 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium uppercase">{trade.side} · {trade.chain}</p>
                        <p className="text-xs text-muted-foreground">Token: {String(trade.token_symbol || trade.asset || "SOL")}</p>
                        <p className="text-xs text-muted-foreground break-all">{shortAddress(trade.to_address || trade.contract_address || trade.tx_hash)}</p>
                        {trade.tx_hash && <p className="text-xs text-muted-foreground break-all">Tx: {shortAddress(trade.tx_hash)}</p>}
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-sm font-semibold">{Number(trade.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 9 })} {trade.quantity_unit || trade.asset || ""}</p>
                        <p className="text-xs text-muted-foreground">Worth: {Number(trade.worth_sol || 0).toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL</p>
                        <p className="text-xs text-muted-foreground">{Number(trade.notional_usd || 0) > 0 ? `$${Number(trade.notional_usd || 0).toLocaleString()}` : "On-chain activity"}</p>
                        <p className="text-xs text-muted-foreground">{trade.status}</p>
                        {trade.explorer_url && (
                          <Button size="sm" variant="outline" onClick={() => window.open(trade.explorer_url, "_blank")}>View Tx</Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-3">
            <SettingsMenuCard
              title="Security Setup"
              description="Create or import wallet credentials."
              open={securitySetupOpen}
              onToggle={() => setSecuritySetupOpen((prev) => !prev)}
            >
              <div className="space-y-4">
                {walletExists ? (
                  <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="default" className="border-green-500/40 bg-green-500/15 text-green-300">
                        Wallet already exists
                      </Badge>
                      {solanaAddress && <span className="text-muted-foreground">{shortAddress(solanaAddress)}</span>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This account already has a wallet. Import fields are hidden to prevent accidental overwrite. Delete wallet first if you want to import a new phrase or private key.
                    </p>
                  </div>
                ) : (
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
                      <Label htmlFor="wallet-import-pk">Connect by private key</Label>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant={walletConnected ? "default" : "outline"} className={walletConnected ? "border-green-500/40 bg-green-500/15 text-green-300" : ""}>
                          {walletConnected ? "Connected" : "Not Connected"}
                        </Badge>
                        {walletConnected && <span className="text-muted-foreground">{shortAddress(solanaAddress)}</span>}
                      </div>
                      <Textarea
                        id="wallet-import-pk"
                        value={importPrivateKey}
                        onChange={(e) => setImportPrivateKey(e.target.value)}
                        className="min-h-[90px]"
                        placeholder="Paste Solana private key (base58, base64, or JSON array)"
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => handleImportWalletPrivateKey(false)} disabled={importWalletPrivateKey.isPending}>
                          {importWalletPrivateKey.isPending ? "Connecting..." : "Connect Key"}
                        </Button>
                        <Button variant="outline" onClick={() => handleImportWalletPrivateKey(true)} disabled={importWalletPrivateKey.isPending}>
                          Connect + Overwrite
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Private-key import marks backup as confirmed automatically.</p>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-2">
                  <p className="text-sm font-medium">Delete Existing App Wallet</p>
                  <p className="text-xs text-muted-foreground">
                    This removes all wallet data stored in the app for your account. This action cannot be undone.
                  </p>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteWholeWallet}
                    disabled={deleteWallet.isPending || !wallet?.has_wallet}
                  >
                    {deleteWallet.isPending ? "Deleting..." : "Delete Wallet"}
                  </Button>
                </div>
              </div>
            </SettingsMenuCard>

            <SettingsMenuCard
              title="Backup Confirmation"
              description="Mark your recovery phrase backup as confirmed."
              open={securityBackupOpen}
              onToggle={() => setSecurityBackupOpen((prev) => !prev)}
            >
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">No phrase input required.</p>
                <Button variant="outline" onClick={handleConfirmBackup} disabled={confirmBackup.isPending}>{confirmBackup.isPending ? "Confirming..." : "Confirm Backup"}</Button>
              </div>
            </SettingsMenuCard>

            <SettingsMenuCard
              title="Recovery & Reveal"
              description="Reveal phrase and private keys instantly."
              open={securityRecoveryOpen}
              onToggle={() => setSecurityRecoveryOpen((prev) => !prev)}
            >
              <div className="space-y-2">
                <Button variant="outline" onClick={handleRevealWallet} disabled={revealWallet.isPending}>{revealWallet.isPending ? "Revealing..." : "Reveal Secrets"}</Button>
              </div>

              {latestBundle && (
                <div className="rounded-lg border border-border/60 p-3 space-y-3 bg-muted/20 mt-3">
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
            </SettingsMenuCard>
          </TabsContent>
        </Tabs>

        <Sheet open={sendOpen} onOpenChange={setSendOpen}>
          <SheetContent side="right" className="sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Send</SheetTitle>
              <SheetDescription>Transfer flow UI is ready. Live on-chain transfer execution is being finalized.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 mt-4">
              <Label>Chain</Label>
              <select value={sendChain} onChange={(e) => setSendChain(e.target.value as SupportedWalletChain)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
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

              <p className="text-xs text-muted-foreground">Live transfers currently support `SOL` on `solana` chain.</p>

              <p className="text-xs text-muted-foreground">From: {shortAddress(addressesByChain[sendChain] || "")}</p>
            </div>
            <SheetFooter className="mt-6">
              <Button variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
              <Button onClick={handleSendSubmit} disabled={transferWallet.isPending}>{transferWallet.isPending ? "Sending..." : "Send"}</Button>
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
              <select value={receiveChain} onChange={(e) => setReceiveChain(e.target.value as SupportedWalletChain)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
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

        <Sheet open={swapOpen} onOpenChange={setSwapOpen}>
          <SheetContent side="right" className="sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Swap</SheetTitle>
              <SheetDescription>Swap SOL and Solana tokens directly from your in-app wallet.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Side</Label>
                  <select value={swapSide} onChange={(e) => setSwapSide(e.target.value as "buy" | "sell")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="buy">Buy Token</option>
                    <option value="sell">Sell Token</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Mode</Label>
                  <div className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm flex items-center">Live</div>
                </div>
              </div>

              <div className="space-y-1">
                <Label>CA</Label>
                <Input placeholder="Enter Solana token CA address" value={swapTokenMint} onChange={(e) => setSwapTokenMint(e.target.value)} />
              </div>

              {swapSide === "buy" ? (
                <div className="space-y-1">
                  <Label>Amount (SOL)</Label>
                  <Input type="number" min={0.0001} step="0.0001" value={swapAmountSol} onChange={(e) => setSwapAmountSol(e.target.value)} />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Amount ({String(solanaSplTokens.find((t) => String(t.mint || "").trim() === String(swapTokenMint || "").trim())?.symbol || "TOKEN")})</Label>
                    <span className="text-[11px] text-muted-foreground">Balance: {selectedSellTokenBalance.toLocaleString(undefined, { maximumFractionDigits: 9 })}</span>
                  </div>
                  <Input type="number" min={0.000000001} step="0.000000001" value={swapSellAmountTokens} onChange={(e) => setSwapSellAmountTokens(e.target.value)} />
                  <div className="grid grid-cols-4 gap-2">
                    <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => applySellPercent(25)}>25%</Button>
                    <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => applySellPercent(50)}>50%</Button>
                    <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => applySellPercent(75)}>75%</Button>
                    <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => applySellPercent(100)}>100%</Button>
                  </div>
                </div>
              )}

              {swapSide === "buy" && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
                  {swapQuoteQuery.isLoading ? (
                    <p className="text-muted-foreground">Fetching quote…</p>
                  ) : swapQuoteQuery.data?.quote ? (
                    <>
                      <p>
                        Estimated receive: <span className="font-medium text-foreground">{Number(swapQuoteQuery.data.quote.output_amount_tokens || 0).toLocaleString(undefined, { maximumFractionDigits: 9 })}</span>
                      </p>
                      {swapQuoteIsFallback ? (
                        <p className="text-amber-300">Estimate uses token price fallback (router quote unavailable right now).</p>
                      ) : (
                        <p className="text-muted-foreground">
                          Price impact: {Number(swapQuoteQuery.data.quote.price_impact_pct || 0).toFixed(4)}% · Routes: {Number(swapQuoteQuery.data.quote.route_count || 0)}
                        </p>
                      )}
                    </>
                  ) : swapQuoteQuery.isError ? (
                    <p className="text-red-400">Quote unavailable for this token/amount right now.</p>
                  ) : (
                    <p className="text-muted-foreground">Enter token CA and SOL amount to preview output.</p>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {swapSide === "buy"
                  ? "Buy uses SOL input and shows estimated token output before submitting."
                  : "Sell swaps selected token amount back to SOL. Use 25/50/75/100 shortcuts like Phantom."}
              </p>
            </div>
            <SheetFooter className="mt-6">
              <Button variant="outline" onClick={() => setSwapOpen(false)}>Cancel</Button>
              <Button onClick={handleSwapSubmit} disabled={walletSwap.isPending}>{walletSwap.isPending ? "Swapping..." : "Swap"}</Button>
            </SheetFooter>
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
              <select value={exportChain} onChange={(e) => setExportChain(e.target.value as SupportedWalletChain)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {enabledChains.map((chainName) => <option key={chainName} value={chainName}>{chainName}</option>)}
              </select>

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

        <Sheet open={walletSettingsOpen} onOpenChange={setWalletSettingsOpen}>
          <SheetContent side="right" className="sm:max-w-md overflow-hidden">
            <SheetHeader>
              <SheetTitle>Wallet Settings</SheetTitle>
              <SheetDescription>Manage wallet actions in one panel.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-3 h-[calc(100vh-10rem)] flex flex-col">
              <div className="flex gap-2 overflow-x-auto pb-1">
                <Button size="sm" variant="outline">Wallet Actions</Button>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1 flex-1">
                <div data-settings-section="wallet-actions" className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                  <p className="text-sm font-semibold">Wallet Actions</p>
                  <div>
                    <Label>Chain</Label>
                    <select value={settingsChain} onChange={(e) => setSettingsChain(e.target.value as SupportedWalletChain)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1">
                      {enabledChains.map((chainName) => <option key={chainName} value={chainName}>{chainName}</option>)}
                    </select>
                  </div>

                  <Button variant="outline" onClick={() => { setWalletSettingsOpen(false); handleOpenExportKey(settingsChain); }}>
                    <KeyRound className="w-4 h-4 mr-2" /> Export Private Key
                  </Button>

                  <Button variant="outline" onClick={() => handleRemoveWalletChain(settingsChain)} disabled={removeWalletChain.isPending || !addressesByChain[settingsChain]}>
                    <Trash2 className="w-4 h-4 mr-2" /> Remove Wallet
                  </Button>

                  <Button variant="destructive" onClick={handleDeleteWholeWallet} disabled={deleteWallet.isPending || !wallet?.has_wallet}>
                    <Trash2 className="w-4 h-4 mr-2" /> {deleteWallet.isPending ? "Deleting..." : "Delete Entire Wallet"}
                  </Button>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

      </div>
    </Layout>
  );
}