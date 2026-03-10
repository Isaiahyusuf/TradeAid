import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Bot, CheckCircle2, Copy, History, KeyRound, Settings2, Shield, Trash2, Wallet as WalletIcon } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import { SUPPORTED_CHAINS } from "@/hooks/use-chain";
import { useLocation } from "wouter";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";
import { useDoctorConfig, useDoctorStatus } from "@/hooks/use-doctortrade";
import {
  useApproveAssistantConsent,
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
  useExecuteAssistantTrade,
  useExportAssistantWalletKey,
  useImportAssistantWallet,
  useImportAssistantWalletPrivateKey,
  useRemoveAssistantWalletChain,
  useRequestAssistantConsent,
  useRevealAssistantWallet,
  useRevokeAssistantConsent,
  useTransferAssistantWallet,
} from "@/hooks/use-ai-assistant";

type SupportedWalletChain = (typeof SUPPORTED_CHAINS)[number];

export default function WalletPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const enabledChains = [...SUPPORTED_CHAINS] as SupportedWalletChain[];
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const returnTo = String(searchParams.get("returnTo") || "").trim();
  const walletAction = String(searchParams.get("action") || "").trim().toLowerCase();
  const prefillTradeChain = String(searchParams.get("chain") || "").trim().toLowerCase();
  const prefillTradeContract = String(searchParams.get("contract") || "").trim();
  const prefillTradeAmount = String(searchParams.get("amount") || "").trim();
  const prefillSwapAmountSol = String(searchParams.get("amount_sol") || prefillTradeAmount || "").trim();
  const prefillSwapSide = String(searchParams.get("side") || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";

  const tradingStatusQuery = useAssistantTradingStatus();
  const doctorStatusQuery = useDoctorStatus();
  const doctorConfigMutation = useDoctorConfig();
  const walletStatusQuery = useAssistantWalletStatus();
  const walletPortfolioQuery = useAssistantWalletPortfolio();
  const walletTransactionsQuery = useAssistantWalletTransactions(50);
  const contextOverviewQuery = useAssistantContextOverview(30);

  const requestConsent = useRequestAssistantConsent();
  const approveConsent = useApproveAssistantConsent();
  const revokeConsent = useRevokeAssistantConsent();
  const executeTrade = useExecuteAssistantTrade();

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

  const [assistantMode, setAssistantMode] = useState<"paper" | "live">("paper");
  const [confirmationText, setConfirmationText] = useState("I_APPROVE_ASSISTANT_TRADING");

  const [tradeChain, setTradeChain] = useState<SupportedWalletChain>(enabledChains[0] || "solana");
  const [tradeContract, setTradeContract] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeNotional, setTradeNotional] = useState("25");

  const [backupPhraseInput, setBackupPhraseInput] = useState("");
  const [importMnemonic, setImportMnemonic] = useState("");
  const [importPrivateKey, setImportPrivateKey] = useState("");
  const [revealPhrase, setRevealPhrase] = useState("I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS");

  const [sendOpen, setSendOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [walletSettingsOpen, setWalletSettingsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantRiskSettingsOpen, setAssistantRiskSettingsOpen] = useState(false);
  const [assistantSettingsHydrated, setAssistantSettingsHydrated] = useState(false);
  const [walletTab, setWalletTab] = useState<"assets" | "activity" | "security">("assets");

  const [buyAmountInput, setBuyAmountInput] = useState("0.1");
  const [maxTradesInput, setMaxTradesInput] = useState("12");
  const [tpMultInput, setTpMultInput] = useState("2.0");
  const [minProfitInput, setMinProfitInput] = useState("12");
  const [stopLossInput, setStopLossInput] = useState("6");
  const [trailInput, setTrailInput] = useState("10");
  const [minLiquidityInput, setMinLiquidityInput] = useState("20000");
  const [maxSlippageInput, setMaxSlippageInput] = useState("4");
  const [maxSpreadInput, setMaxSpreadInput] = useState("3");
  const [dailyLossInput, setDailyLossInput] = useState("600");
  const [maxConsecutiveLossesInput, setMaxConsecutiveLossesInput] = useState("3");
  const [liveSellFractionInput, setLiveSellFractionInput] = useState("50");
  const [maxSellNotionalInput, setMaxSellNotionalInput] = useState("300");

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
  const [swapMode, setSwapMode] = useState<"paper" | "live">("live");

  const [exportedKey, setExportedKey] = useState<{ chain: string; address: string; private_key: string; warning: string } | null>(null);
  const walletSettingsScrollRef = useRef<HTMLDivElement | null>(null);

  const [latestBundle, setLatestBundle] = useState<{ mnemonic?: string; addresses_by_chain: Record<string, string>; private_keys_by_chain?: Record<string, string>; warning: string; } | null>(null);

  const scrollWalletSettingsTo = (sectionId: string) => {
    const container = walletSettingsScrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-settings-section="${sectionId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (trading?.mode === "paper" || trading?.mode === "live") {
      setAssistantMode(trading.mode);
    }
  }, [trading?.mode]);

  useEffect(() => {
    if (walletAction === "connect") {
      setWalletTab("assets");
    }
  }, [walletAction, location]);

  useEffect(() => {
    if (walletAction !== "buy") return;
    const requestedChain = enabledChains.includes(prefillTradeChain as SupportedWalletChain)
      ? (prefillTradeChain as SupportedWalletChain)
      : (enabledChains[0] || "solana");
    setWalletTab("assets");
    setAssistantOpen(true);
    setTradeSide("buy");
    setTradeChain(requestedChain);
    if (prefillTradeContract) {
      setTradeContract(prefillTradeContract);
    }
    if (prefillTradeAmount) {
      setTradeNotional(prefillTradeAmount);
    }
  }, [walletAction, prefillTradeChain, prefillTradeContract, prefillTradeAmount, enabledChains]);

  useEffect(() => {
    if (walletAction !== "swap") return;
    setWalletTab("assets");
    setSwapOpen(true);
    setSwapSide(prefillSwapSide);
    if (prefillTradeContract) {
      setSwapTokenMint(prefillTradeContract);
    }
    if (prefillSwapAmountSol) {
      setSwapAmountSol(prefillSwapAmountSol);
    }
  }, [walletAction, prefillTradeContract, prefillSwapAmountSol, prefillSwapSide]);

  useEffect(() => {
    const controls = doctorStatusQuery.data?.trade_controls;
    if (!controls || assistantSettingsHydrated) return;
    setBuyAmountInput(String(controls.buy_amount_sol ?? 0.1));
    setMaxTradesInput(String(controls.max_trades_per_day ?? 12));
    setTpMultInput(String(controls.take_profit_multiplier ?? 2.0));
    setMinProfitInput(String(controls.min_profit_pct ?? 12));
    setStopLossInput(String(controls.stop_loss_pct ?? 6));
    setTrailInput(String(controls.trailing_stop_pct ?? 10));
    setMinLiquidityInput(String(controls.min_liquidity_usd ?? 20000));
    setMaxSlippageInput(String(controls.max_slippage_pct ?? 4));
    setMaxSpreadInput(String(controls.max_spread_pct ?? 3));
    setDailyLossInput(String(controls.daily_loss_limit_usd ?? 600));
    setMaxConsecutiveLossesInput(String(controls.max_consecutive_losses ?? 3));
    setLiveSellFractionInput(String(controls.live_sell_fraction_pct ?? 50));
    setMaxSellNotionalInput(String(controls.max_sell_notional_usd ?? 300));
    setAssistantSettingsHydrated(true);
  }, [assistantSettingsHydrated, doctorStatusQuery.data?.trade_controls]);

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

  const walletSyncing = Boolean(
    tradingStatusQuery.isFetching ||
    doctorStatusQuery.isFetching ||
    walletStatusQuery.isFetching ||
    walletPortfolioQuery.isFetching ||
    walletTransactionsQuery.isFetching ||
    contextOverviewQuery.isFetching,
  );

  const walletInitialLoading = Boolean(
    tradingStatusQuery.isLoading ||
    doctorStatusQuery.isLoading ||
    walletStatusQuery.isLoading ||
    walletPortfolioQuery.isLoading,
  );

  const lastWalletSyncTs = Math.max(
    Number(tradingStatusQuery.dataUpdatedAt || 0),
    Number(doctorStatusQuery.dataUpdatedAt || 0),
    Number(walletStatusQuery.dataUpdatedAt || 0),
    Number(walletPortfolioQuery.dataUpdatedAt || 0),
    Number(walletTransactionsQuery.dataUpdatedAt || 0),
    Number(contextOverviewQuery.dataUpdatedAt || 0),
  );

  const lastWalletSyncLabel = lastWalletSyncTs > 0 ? new Date(lastWalletSyncTs).toLocaleTimeString() : "-";

  const refreshWalletViews = async () => {
    await Promise.allSettled([
      tradingStatusQuery.refetch(),
      doctorStatusQuery.refetch(),
      walletStatusQuery.refetch(),
      walletPortfolioQuery.refetch(),
      walletTransactionsQuery.refetch(),
      contextOverviewQuery.refetch(),
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
    if (!tokenMint) {
      toast({ title: "CA required", description: "Enter a Solana token CA address.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      toast({ title: "Invalid amount", description: "Enter a valid SOL amount for the swap.", variant: "destructive" });
      return;
    }

    try {
      const solPriceUsd = Number(chainPrices.solana || 0);
      const notionalUsd = solPriceUsd > 0 ? amountSol * solPriceUsd : undefined;
      const result = await walletSwap.mutateAsync({
        side: swapSide,
        token_mint: tokenMint,
        amount_sol: amountSol,
        notional_usd: notionalUsd,
        mode: swapMode,
      });
      toast({ title: "Swap submitted", description: `Tx: ${result.trade.tx_hash.slice(0, 10)}...` });
      if (result.trade.explorer_url) {
        window.open(result.trade.explorer_url, "_blank");
      }
      setSwapOpen(false);
      setSwapTokenMint("");
      setSwapAmountSol("0.1");
    } catch (error) {
      toast({ title: "Swap failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    }
  };

  const handleCreateWallet = async (overwrite: boolean) => {
    try {
      const result = await createWallet.mutateAsync({ overwrite });
      setLatestBundle(result.bundle);
      setBackupPhraseInput("");
      toast({ title: "Wallet created", description: "Store your 12-word phrase and private keys before proceeding." });
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
    try {
      const result = await importWallet.mutateAsync({ mnemonic, overwrite });
      setLatestBundle(result.bundle);
      toast({ title: "Wallet imported", description: "Addresses loaded successfully." });
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
    try {
      const result = await importWalletPrivateKey.mutateAsync({ private_key: privateKey, overwrite });
      setLatestBundle(result.bundle);
      toast({ title: "Wallet connected", description: "Private key imported successfully." });
      if (returnTo) {
        setLocation(returnTo);
      }
    } catch (error) {
      toast({ title: "Private key import failed", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
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

  const applyDoctorPreset = (preset: "conservative" | "balanced" | "aggressive") => {
    if (preset === "conservative") {
      setBuyAmountInput("0.1");
      setMaxTradesInput("6");
      setTpMultInput("1.8");
      setMinProfitInput("9");
      setStopLossInput("4");
      setTrailInput("7");
      setMinLiquidityInput("45000");
      setMaxSlippageInput("2.2");
      setMaxSpreadInput("1.8");
      setDailyLossInput("300");
      setMaxConsecutiveLossesInput("2");
      setLiveSellFractionInput("35");
      setMaxSellNotionalInput("180");
    }
    if (preset === "balanced") {
      setBuyAmountInput("0.15");
      setMaxTradesInput("12");
      setTpMultInput("2.0");
      setMinProfitInput("12");
      setStopLossInput("6");
      setTrailInput("10");
      setMinLiquidityInput("20000");
      setMaxSlippageInput("4");
      setMaxSpreadInput("3");
      setDailyLossInput("600");
      setMaxConsecutiveLossesInput("3");
      setLiveSellFractionInput("50");
      setMaxSellNotionalInput("300");
    }
    if (preset === "aggressive") {
      setBuyAmountInput("0.25");
      setMaxTradesInput("20");
      setTpMultInput("2.4");
      setMinProfitInput("15");
      setStopLossInput("8");
      setTrailInput("14");
      setMinLiquidityInput("12000");
      setMaxSlippageInput("6");
      setMaxSpreadInput("5");
      setDailyLossInput("1000");
      setMaxConsecutiveLossesInput("4");
      setLiveSellFractionInput("75");
      setMaxSellNotionalInput("650");
    }
    toast({ title: "Preset loaded", description: `${preset} profile applied. Save to sync DoctorTrade.` });
  };

  const saveAssistantDoctorSettings = () => {
    doctorConfigMutation.mutate(
      {
        buy_amount_sol: Math.max(0.1, Number.parseFloat(buyAmountInput) || 0.1),
        max_trades_per_day: Math.max(1, Math.trunc(Number.parseFloat(maxTradesInput) || 12)),
        take_profit_multiplier: Math.max(1.01, Number.parseFloat(tpMultInput) || 2.0),
        min_profit_pct: Math.max(0.1, Number.parseFloat(minProfitInput) || 12),
        stop_loss_pct: Math.max(0.1, Number.parseFloat(stopLossInput) || 6),
        trailing_stop_pct: Math.max(0.1, Number.parseFloat(trailInput) || 10),
        min_liquidity_usd: Math.max(1000, Number.parseFloat(minLiquidityInput) || 20000),
        max_slippage_pct: Math.max(0.1, Number.parseFloat(maxSlippageInput) || 4),
        max_spread_pct: Math.max(0.1, Number.parseFloat(maxSpreadInput) || 3),
        daily_loss_limit_usd: Math.max(10, Number.parseFloat(dailyLossInput) || 600),
        max_consecutive_losses: Math.max(1, Math.trunc(Number.parseFloat(maxConsecutiveLossesInput) || 3)),
        live_sell_fraction_pct: Math.max(1, Math.min(100, Number.parseFloat(liveSellFractionInput) || 50)),
        max_sell_notional_usd: Math.max(1, Number.parseFloat(maxSellNotionalInput) || 300),
      },
      {
        onSuccess: () => {
          setAssistantRiskSettingsOpen(false);
          toast({ title: "DoctorTrade synced", description: "Wallet assistant settings updated successfully." });
        },
        onError: (error) => {
          toast({
            title: "Save failed",
            description: error instanceof Error ? error.message : "Could not sync settings",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        {walletAction === "connect" && (
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Connect Wallet for DoctorTrade</p>
                <p className="text-xs text-muted-foreground">Create or import your wallet, then return to DoctorTrade.</p>
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
                        <p className="text-xs text-muted-foreground break-all">{shortAddress(trade.to_address || trade.contract_address)}</p>
                        {trade.tx_hash && <p className="text-xs text-muted-foreground break-all">Tx: {shortAddress(trade.tx_hash)}</p>}
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-sm font-semibold">{Number(trade.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} {trade.asset || ""}</p>
                        <p className="text-xs text-muted-foreground">${Number(trade.notional_usd || 0).toLocaleString()}</p>
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
                    <Label htmlFor="wallet-import-pk">Connect by private key</Label>
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
                  </div>

                  <div className="space-y-2 md:col-span-2">
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
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><Bot className="w-4 h-4" />Assistant Permission & Execution</span>
              <Button variant="outline" size="sm" onClick={() => setAssistantOpen(true)}>
                <Settings2 className="w-4 h-4 mr-1" /> Open
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm">DoctorTrade Status</span>
              <Badge variant={trading?.enabled ? "default" : "outline"}>{trading?.enabled ? "Enabled" : trading?.pending_approval ? "Pending Approval" : "Disabled"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Assistant controls are organized in one panel. Tap <span className="font-medium">Open</span> to manage permissions and execution.</p>
          </CardContent>
        </Card>

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
                  <select value={swapMode} onChange={(e) => setSwapMode(e.target.value as "paper" | "live")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="live">Live</option>
                    <option value="paper">Paper</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>CA</Label>
                <Input placeholder="Enter Solana token CA address" value={swapTokenMint} onChange={(e) => setSwapTokenMint(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Amount (SOL)</Label>
                <Input type="number" min={0.0001} step="0.0001" value={swapAmountSol} onChange={(e) => setSwapAmountSol(e.target.value)} />
              </div>

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
                  : "Sell swaps your token CA balance back into SOL."}
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

        <Sheet open={walletSettingsOpen} onOpenChange={setWalletSettingsOpen}>
          <SheetContent side="right" className="sm:max-w-md overflow-hidden">
            <SheetHeader>
              <SheetTitle>Wallet Settings</SheetTitle>
              <SheetDescription>Manage wallet actions and DoctorTrade controls in one panel.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-3 h-[calc(100vh-10rem)] flex flex-col">
              <div className="flex gap-2 overflow-x-auto pb-1">
                <Button size="sm" variant="outline" onClick={() => scrollWalletSettingsTo("wallet-actions")}>Wallet Actions</Button>
                <Button size="sm" variant="outline" onClick={() => scrollWalletSettingsTo("doctortrade")}>DoctorTrade</Button>
              </div>

              <div ref={walletSettingsScrollRef} className="space-y-4 overflow-y-auto pr-1 flex-1">
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

                <div data-settings-section="doctortrade" className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                  <p className="text-sm font-semibold text-primary">DoctorTrade Settings</p>
                  <p className="text-xs text-muted-foreground">Tune DoctorTrade risk controls directly from Wallet.</p>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => applyDoctorPreset("conservative")}>Conservative</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => applyDoctorPreset("balanced")}>Balanced</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => applyDoctorPreset("aggressive")}>Aggressive</Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input placeholder="Buy SOL" value={buyAmountInput} onChange={(e) => setBuyAmountInput(e.target.value)} />
                    <Input placeholder="Trades/24h" value={maxTradesInput} onChange={(e) => setMaxTradesInput(e.target.value)} />
                    <Input placeholder="TP Multiplier" value={tpMultInput} onChange={(e) => setTpMultInput(e.target.value)} />
                    <Input placeholder="Min Profit %" value={minProfitInput} onChange={(e) => setMinProfitInput(e.target.value)} />
                    <Input placeholder="Stop Loss %" value={stopLossInput} onChange={(e) => setStopLossInput(e.target.value)} />
                    <Input placeholder="Trailing Stop %" value={trailInput} onChange={(e) => setTrailInput(e.target.value)} />
                    <Input placeholder="Min Liquidity USD" value={minLiquidityInput} onChange={(e) => setMinLiquidityInput(e.target.value)} />
                    <Input placeholder="Max Slippage %" value={maxSlippageInput} onChange={(e) => setMaxSlippageInput(e.target.value)} />
                    <Input placeholder="Max Spread %" value={maxSpreadInput} onChange={(e) => setMaxSpreadInput(e.target.value)} />
                    <Input placeholder="Daily Loss Limit $" value={dailyLossInput} onChange={(e) => setDailyLossInput(e.target.value)} />
                    <Input placeholder="Max Consecutive Losses" value={maxConsecutiveLossesInput} onChange={(e) => setMaxConsecutiveLossesInput(e.target.value)} />
                    <Input placeholder="Live Sell Fraction %" value={liveSellFractionInput} onChange={(e) => setLiveSellFractionInput(e.target.value)} />
                    <Input placeholder="Max Sell Notional $" value={maxSellNotionalInput} onChange={(e) => setMaxSellNotionalInput(e.target.value)} />
                  </div>

                  <div className="flex justify-end">
                    <Button type="button" variant="outline" onClick={saveAssistantDoctorSettings} disabled={doctorConfigMutation.isPending}>
                      {doctorConfigMutation.isPending ? "Saving..." : "Save DoctorTrade Settings"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
          <SheetContent side="right" className="sm:max-w-md h-dvh overflow-hidden flex flex-col">
            <SheetHeader className="shrink-0">
              <SheetTitle>Assistant Permission & Execution</SheetTitle>
              <SheetDescription>Enable/disable assistant permission and run assistant execution from one place.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 mt-4 overflow-y-auto pr-1 pb-6 flex-1">
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
                <Label htmlFor="assistant-confirmation-sheet">Approval Phrase</Label>
                <Input id="assistant-confirmation-sheet" value={confirmationText} onChange={(e) => setConfirmationText(e.target.value)} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleRequestAssistantConsent} disabled={requestConsent.isPending}>{requestConsent.isPending ? "Requesting..." : "Request Consent"}</Button>
                <Button variant="outline" onClick={handleApproveAssistantConsent} disabled={approveConsent.isPending || !trading?.pending_approval}>{approveConsent.isPending ? "Approving..." : "Approve Consent"}</Button>
                <Button variant="outline" onClick={handleRevokeAssistantConsent} disabled={revokeConsent.isPending}>{revokeConsent.isPending ? "Revoking..." : "Revoke"}</Button>
              </div>

              <SettingsMenuCard
                title="DoctorTrade Risk Presets"
                description="Use the same preset and guardrail controls from DoctorTrade."
                open={assistantRiskSettingsOpen}
                onToggle={() => setAssistantRiskSettingsOpen((prev) => !prev)}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => applyDoctorPreset("conservative")}>Conservative</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => applyDoctorPreset("balanced")}>Balanced</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => applyDoctorPreset("aggressive")}>Aggressive</Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input placeholder="Buy SOL" value={buyAmountInput} onChange={(e) => setBuyAmountInput(e.target.value)} />
                    <Input placeholder="Trades/24h" value={maxTradesInput} onChange={(e) => setMaxTradesInput(e.target.value)} />
                    <Input placeholder="TP Multiplier" value={tpMultInput} onChange={(e) => setTpMultInput(e.target.value)} />
                    <Input placeholder="Min Profit %" value={minProfitInput} onChange={(e) => setMinProfitInput(e.target.value)} />
                    <Input placeholder="Stop Loss %" value={stopLossInput} onChange={(e) => setStopLossInput(e.target.value)} />
                    <Input placeholder="Trailing Stop %" value={trailInput} onChange={(e) => setTrailInput(e.target.value)} />
                    <Input placeholder="Min Liquidity USD" value={minLiquidityInput} onChange={(e) => setMinLiquidityInput(e.target.value)} />
                    <Input placeholder="Max Slippage %" value={maxSlippageInput} onChange={(e) => setMaxSlippageInput(e.target.value)} />
                    <Input placeholder="Max Spread %" value={maxSpreadInput} onChange={(e) => setMaxSpreadInput(e.target.value)} />
                    <Input placeholder="Daily Loss Limit $" value={dailyLossInput} onChange={(e) => setDailyLossInput(e.target.value)} />
                    <Input placeholder="Max Consecutive Losses" value={maxConsecutiveLossesInput} onChange={(e) => setMaxConsecutiveLossesInput(e.target.value)} />
                    <Input placeholder="Live Sell Fraction %" value={liveSellFractionInput} onChange={(e) => setLiveSellFractionInput(e.target.value)} />
                    <Input placeholder="Max Sell Notional $" value={maxSellNotionalInput} onChange={(e) => setMaxSellNotionalInput(e.target.value)} />
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" onClick={saveAssistantDoctorSettings} disabled={doctorConfigMutation.isPending}>
                      {doctorConfigMutation.isPending ? "Saving..." : "Save & Close"}
                    </Button>
                  </div>
                </div>
              </SettingsMenuCard>

              <div className="rounded-lg border border-border/60 p-3 space-y-3">
                <p className="text-sm font-medium flex items-center gap-2"><KeyRound className="w-4 h-4" />Execute Trade</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select value={tradeChain} onChange={(e) => setTradeChain(e.target.value as SupportedWalletChain)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
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
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </Layout>
  );
}