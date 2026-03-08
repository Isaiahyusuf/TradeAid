import { useState, useMemo, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTokens, type TokenItem } from "@/hooks/use-memetrend";
import { useAlerts } from "@/hooks/use-alerts";
import { useAIInsight } from "@/hooks/use-ai-insight";
import { useScannerStream, type ScannerStreamEvent } from "@/hooks/use-scanner-stream";
import { 
  Search, Shield, RefreshCw,
  Radar, ExternalLink
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AIScoreBadgePanel } from "@/components/scanner/AIScoreBadgePanel";
import { MetricLabel } from "@/components/scanner/MetricLabel";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useChain } from "@/hooks/use-chain";

function formatNumber(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function normalizePct(value: number) {
  return value > 1 ? value : value * 100;
}

function buildAiInsightFallback(token: TokenItem | null) {
  if (!token?.latest_score) {
    return {
      summary: "AI insight will appear after a token is selected and scored.",
      recommendation: "Watch",
      confidence: 0,
      momentum: "Neutral",
      riskLevel: "Unknown",
    };
  }

  const confidence = normalizePct(token.latest_score.trade_confidence_index);
  const rug = normalizePct(token.latest_score.rug_probability);
  const momentum = token.price_change_1h > 10 ? "Strong Uptrend" : token.price_change_1h < -10 ? "Downtrend" : "Sideways";
  const recommendation = rug > 70 ? "Avoid" : confidence > 65 ? "High Risk Entry" : "Watch";
  const riskLevel = rug > 70 ? "High" : rug > 40 ? "Medium" : "Low";

  return {
    summary: `${token.symbol || token.name} shows ${momentum.toLowerCase()} momentum with ${(token.volume_1h || 0).toFixed(0)} 1h volume. Rug risk ${rug.toFixed(0)}, confidence ${confidence.toFixed(0)}. Recommendation: ${recommendation}.`,
    recommendation,
    confidence,
    momentum,
    riskLevel,
  };
}

export default function AlphaScanner() {
  const { chain, chainLabel } = useChain();
  const chainParam = chain === "all" ? undefined : chain;
  const chainDisplay = chain === "all" ? "All Chains" : chainLabel;
  const routingChain = chain === "all" ? "solana" : chain;
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [sortBy, setSortBy] = useState("ai");
  const [minLiquidity, setMinLiquidity] = useState(0);
  const [scanAddress, setScanAddress] = useState("");
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [tokenTab, setTokenTab] = useState<"all" | "5m" | "20m" | "40m" | "1h" | "5h" | "12h" | "24h">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const ageTabs: Array<{
    key: "5m" | "20m" | "40m" | "1h" | "5h" | "12h" | "24h";
    label: string;
    minAgeMinutes: number;
    maxAgeMinutes: number;
  }> = [
    { key: "5m", label: "5m", minAgeMinutes: 0, maxAgeMinutes: 5 },
    { key: "20m", label: "20m", minAgeMinutes: 5, maxAgeMinutes: 20 },
    { key: "40m", label: "40m", minAgeMinutes: 20, maxAgeMinutes: 40 },
    { key: "1h", label: "1h", minAgeMinutes: 40, maxAgeMinutes: 60 },
    { key: "5h", label: "5h", minAgeMinutes: 60, maxAgeMinutes: 300 },
    { key: "12h", label: "12h", minAgeMinutes: 300, maxAgeMinutes: 720 },
    { key: "24h", label: "24h", minAgeMinutes: 720, maxAgeMinutes: 1440 },
  ];

  const { data: tokenData, isLoading, refetch } = useTokens(chainParam, {
    newOnly: true,
    maxAgeHours: 24,
    prioritizePumpFun: true,
    limit: 120,
  });
  const selectedAgeTab = ageTabs.find((tab) => tab.key === tokenTab);
  const {
    data: ageWindowData,
    isLoading: isAgeWindowLoading,
    refetch: refetchAgeWindow,
  } = useTokens(
    chainParam,
    selectedAgeTab
      ? {
          newOnly: true,
          minAgeMinutes: selectedAgeTab.minAgeMinutes,
          maxAgeMinutes: selectedAgeTab.maxAgeMinutes,
          limit: 20,
        }
      : undefined
  );
  const { data: liveAlerts } = useAlerts({ chain: chainParam });

  const allTokens = tokenData?.tokens || [];
  const ageWindowTokens = ageWindowData?.tokens || [];
  const tokens = tokenTab === "all" ? allTokens : ageWindowTokens;

  const filteredTokens = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const withSearch = tokens.filter((t) =>
      (t.name || "").toLowerCase().includes(q) ||
      (t.symbol || "").toLowerCase().includes(q) ||
      t.contract_address.toLowerCase().includes(q)
    );

    const withLiquidity = withSearch.filter((t) => (t.liquidity_usd || 0) >= minLiquidity);

    const withRisk = withLiquidity.filter((t) => {
      if (riskFilter === "all") return true;
      const rug = t.latest_score ? normalizePct(t.latest_score.rug_probability) : 0;
      if (riskFilter === "safe") return rug <= 35;
      if (riskFilter === "watch") return rug > 35 && rug <= 65;
      if (riskFilter === "risky") return rug > 65;
      return true;
    });

    const sorted = [...withRisk].sort((a, b) => {
      if (sortBy === "volume") return (b.volume_1h || 0) - (a.volume_1h || 0);
      if (sortBy === "price") return (b.price_change_1h || 0) - (a.price_change_1h || 0);
      const aAi = a.latest_score ? normalizePct(a.latest_score.trade_confidence_index) : 0;
      const bAi = b.latest_score ? normalizePct(b.latest_score.trade_confidence_index) : 0;
      return bAi - aAi;
    });

    return sorted;
  }, [tokens, searchQuery, riskFilter, minLiquidity, sortBy]);

  const selectedToken = useMemo(() => {
    if (!selectedTokenId) return null;
    return filteredTokens.find((token) => token.id === selectedTokenId) || null;
  }, [filteredTokens, selectedTokenId]);

  const aiInsightQuery = useAIInsight(selectedToken?.chain || null, selectedToken?.contract_address || null);
  const aiInsight = aiInsightQuery.data?.insight || buildAiInsightFallback(selectedToken);
  const aiRiskLabel = "riskLevel" in aiInsight ? aiInsight.riskLevel : aiInsight.risk_level;

  const onStreamEvent = useCallback((event: ScannerStreamEvent) => {
    if (chain !== "all" && event.chain && String(event.chain).toLowerCase() !== chain) return;

    if (event.type === "new_pair" || event.type === "score_ready" || event.type === "score_update") {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      if (selectedToken?.contract_address) {
        queryClient.invalidateQueries({ queryKey: ["ai-insight", selectedToken.chain, selectedToken.contract_address] });
      }
    }

    if (event.type === "score_update" && Number(event.rug_probability || 0) >= 75) {
      toast({
        title: "High-Risk Token Alert",
        description: `${String(event.symbol || "Token")} updated with elevated rug risk.`,
        variant: "destructive",
      });
    }
  }, [chain, queryClient, selectedToken?.contract_address, toast]);

  const { connected: streamConnected } = useScannerStream(onStreamEvent);

  const handleQuickScore = (address: string, tokenChain?: string) => {
    const target = String(address || "").trim();
    if (!target) return;
    const targetChain = String(tokenChain || routingChain).toLowerCase();
    setLocation(`/rugshield?address=${encodeURIComponent(target)}&chain=${targetChain}&auto=1`);
  };

  const handleScanAddress = () => {
    if (!scanAddress) {
      toast({ title: "Error", description: "Enter a contract address", variant: "destructive" });
      return;
    }
    setLocation(`/rugshield?address=${encodeURIComponent(scanAddress.trim())}&chain=${routingChain}&auto=1`);
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["tokens"], type: "all" }),
        queryClient.refetchQueries({ queryKey: ["alerts"], type: "all" }),
        selectedToken?.contract_address
          ? queryClient.refetchQueries({ queryKey: ["ai-insight", selectedToken.chain, selectedToken.contract_address], type: "all" })
          : Promise.resolve(),
        refetch(),
        refetchAgeWindow(),
      ]);
      setLastRefreshedAt(new Date());
      toast({ title: "Scanner refreshed", description: "Latest tokens and scores loaded." });
    } catch {
      toast({ title: "Refresh failed", description: "Could not refresh scanner data.", variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDirectBuy = (token: TokenItem) => {
    const params = new URLSearchParams();
    params.set("action", "swap");
    params.set("side", "buy");
    params.set("chain", String(token.chain || routingChain).toLowerCase());
    params.set("contract", token.contract_address);
    params.set("amount_sol", "0.1");
    params.set("returnTo", "/alphascanner");
    setLocation(`/wallet?${params.toString()}`);
    toast({ title: "Direct Buy Ready", description: "Opened Wallet swap with token contract prefilled." });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-page-title">
              <Radar className="w-8 h-8 text-primary" />
              Alpha Scanner
            </h1>
            <p className="text-muted-foreground">
              Smart {chainDisplay} scanner with live risk and AI intelligence
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Badge variant="outline" className="solana-badge">Signal Engine</Badge>
              <Badge variant="outline" className="border-accent/30 text-accent">Fast Rotation</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {lastRefreshedAt ? `Last refreshed ${lastRefreshedAt.toLocaleTimeString()}` : "Auto-refresh every 5s is active"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{chainDisplay}</Badge>
            <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} data-testid="button-refresh">
              <RefreshCw className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin")} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm"><MetricLabel label="Total Tokens" tooltip={`Number of tokens currently loaded into the ${chainDisplay} scanner feed.`} /></p>
                <p className="text-2xl font-bold">{allTokens.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm"><MetricLabel label="Live Trades" tooltip="Count of recent scanner alerts and trade events detected in real-time." /></p>
                <p className="text-2xl font-bold">{liveAlerts?.count || 0}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm"><MetricLabel label="Selected Token" tooltip="The token currently focused in detail panels and AI sections." /></p>
                <p className="text-lg font-semibold truncate max-w-[180px]">{selectedToken?.symbol || "--"}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm"><MetricLabel label="Filtered" tooltip="Number of tokens remaining after search, risk, liquidity, and sort filters." /></p>
                <p className="text-2xl font-bold">{filteredTokens.length}</p>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-4 solana-card bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium text-muted-foreground">Quick Score + Filters</p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  placeholder="Contract address to score..."
                  value={scanAddress}
                  onChange={(e) => setScanAddress(e.target.value)}
                  className="pl-10"
                  data-testid="input-scan-address"
                />
              </div>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risk</SelectItem>
                  <SelectItem value="safe">Safe</SelectItem>
                  <SelectItem value="watch">Watch</SelectItem>
                  <SelectItem value="risky">Risky</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                value={minLiquidity}
                onChange={(e) => setMinLiquidity(Number(e.target.value || 0))}
                placeholder="Min liquidity"
              />
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ai">Sort by AI score</SelectItem>
                  <SelectItem value="volume">Sort by volume</SelectItem>
                  <SelectItem value="price">Sort by momentum</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleScanAddress} data-testid="button-score-token">
                <Shield className="w-4 h-4 mr-2" />
                Analyze in RugShield
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-4 solana-card bg-card/70 backdrop-blur-sm border-border/60">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Filter tokens by name, symbol, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-filter-tokens"
            />
          </div>
        </Card>

        <div className="space-y-2">
          <Card className="p-3 solana-card">
            <Tabs value={tokenTab} onValueChange={(value) => setTokenTab(value as "all" | "5m" | "20m" | "40m" | "1h" | "5h" | "12h" | "24h") }>
              <TabsList className="w-full overflow-x-auto justify-start">
                <TabsTrigger className="solana-tab-trigger" value="all" data-testid="tab-all-tokens">All Tokens</TabsTrigger>
                <TabsTrigger className="solana-tab-trigger" value="5m" data-testid="tab-5m-tokens">5m</TabsTrigger>
                <TabsTrigger className="solana-tab-trigger" value="20m" data-testid="tab-20m-tokens">20m</TabsTrigger>
                <TabsTrigger className="solana-tab-trigger" value="40m" data-testid="tab-40m-tokens">40m</TabsTrigger>
                <TabsTrigger className="solana-tab-trigger" value="1h" data-testid="tab-1h-tokens">1h</TabsTrigger>
                <TabsTrigger className="solana-tab-trigger" value="5h" data-testid="tab-5h-tokens">5h</TabsTrigger>
                <TabsTrigger className="solana-tab-trigger" value="12h" data-testid="tab-12h-tokens">12h</TabsTrigger>
                <TabsTrigger className="solana-tab-trigger" value="24h" data-testid="tab-24h-tokens">24h</TabsTrigger>
              </TabsList>
            </Tabs>
          </Card>
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <Card key={i} className="p-4 solana-card">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                </div>
              </Card>
            ))
          ) : tokenTab !== "all" && isAgeWindowLoading ? (
            Array(4).fill(0).map((_, i) => (
              <Card key={`new-${i}`} className="p-4 solana-card">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              </Card>
            ))
          ) : filteredTokens.length === 0 ? (
            <Card className="p-12 text-center solana-card">
              <Radar className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
              <p className="text-lg text-muted-foreground">No {tokenTab === "all" ? "matching" : "projects"} found on {chainDisplay}</p>
              <p className="text-sm text-muted-foreground">
                {tokenTab === "all"
                  ? "Try changing filters or scanning a token address above."
                  : "Only projects in this exact age window are shown (max 20), and it updates every auto-refresh."}
              </p>
            </Card>
          ) : (
            filteredTokens.slice(0, tokenTab === "all" ? filteredTokens.length : 20).map((token) => (
              <Card
                key={token.id}
                className={cn(
                  "p-4 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg border-border/70",
                  selectedToken?.id === token.id && "border-primary/50 bg-gradient-to-r from-primary/10 via-accent/5 to-background"
                )}
                data-testid={`scanner-token-${token.id}`}
                onClick={() => setSelectedTokenId((prev) => (prev === token.id ? null : token.id))}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0">
                    {token.logo_url ? (
                      <img src={token.logo_url} alt={token.symbol || token.name || "token logo"} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <span>{token.symbol?.slice(0, 2) || "TK"}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{token.symbol || "???"}</span>
                      <span className="text-sm text-muted-foreground hidden sm:inline">{token.name}</span>
                      <Badge variant="outline" className="text-[10px]">{token.chain}</Badge>
                      {token.is_pump_fun && <Badge variant="secondary" className="text-[10px]">Pump.fun</Badge>}
                      {token.source_platform && <Badge variant="outline" className="text-[10px]">{token.source_platform}</Badge>}
                      {token.latest_score && (
                        <Badge variant="outline" className="text-[10px]">
                          Score {normalizePct(token.latest_score.trade_confidence_index).toFixed(0)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{token.contract_address}</p>
                  </div>
                  <div className="hidden md:block text-right shrink-0">
                    <p className="font-mono text-sm">{formatNumber(token.market_cap_usd)}</p>
                    <p className="text-xs text-muted-foreground"><MetricLabel label="MCap" tooltip="Estimated market capitalization for this token." className="inline-flex items-center gap-1 text-xs" /></p>
                  </div>
                  <div className="hidden md:block text-right shrink-0">
                    <p className="font-mono text-sm">{formatNumber(token.liquidity_usd)}</p>
                    <p className="text-xs text-muted-foreground"><MetricLabel label="Liquidity" tooltip="Available pool depth for buys and sells." className="inline-flex items-center gap-1 text-xs" /></p>
                  </div>
                  <div className="hidden md:block text-right shrink-0">
                    <p className="font-mono text-sm">{formatNumber(token.volume_1h || 0)}</p>
                    <p className="text-xs text-muted-foreground"><MetricLabel label="Vol 1h" tooltip="USD trade volume recorded over the past hour." className="inline-flex items-center gap-1 text-xs" /></p>
                  </div>
                  <div className="hidden lg:block text-right shrink-0">
                    <p className="font-mono text-sm">{(token.price_change_1h || 0).toFixed(2)}%</p>
                    <p className="text-xs text-muted-foreground"><MetricLabel label="Momentum 1h" tooltip="Percent price change over the past hour." className="inline-flex items-center gap-1 text-xs" /></p>
                  </div>
                  <div className="hidden lg:block text-right shrink-0">
                    <p className="font-mono text-xs">{Math.max(0, Math.floor((Date.now() - new Date(token.created_at).getTime()) / 3600000))}h</p>
                    <p className="text-xs text-muted-foreground">Age</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleQuickScore(token.contract_address, token.chain);
                    }}
                    data-testid={`button-score-${token.id}`}
                  >
                    <Shield className="w-4 h-4" />
                  </Button>
                </div>

                {selectedToken?.id === token.id && (
                  <div className="mt-4 pt-4 border-t border-border/60 space-y-4 data-[state=open]:animate-accordion-down">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div><p className="text-muted-foreground"><MetricLabel label="Price" tooltip="Latest observed USD token price from scanner sources." /></p><p className="font-medium">{token.current_price_usd?.toFixed(6) || "0.000000"}</p></div>
                      <div><p className="text-muted-foreground"><MetricLabel label="Market Cap" tooltip="Estimated fully diluted market capitalization in USD." /></p><p className="font-medium">{formatNumber(token.market_cap_usd || 0)}</p></div>
                      <div><p className="text-muted-foreground"><MetricLabel label="Liquidity" tooltip="Current liquidity depth in the primary detected pool." /></p><p className="font-medium">{formatNumber(token.liquidity_usd || 0)}</p></div>
                      <div><p className="text-muted-foreground"><MetricLabel label="Volume 1h" tooltip="Total traded value over the last 1 hour." /></p><p className="font-medium">{formatNumber(token.volume_1h || 0)}</p></div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge variant="outline">{aiRiskLabel || "Unknown"} Risk</Badge>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => handleDirectBuy(token)}>Direct Buy</Button>
                          <Button size="sm" variant="outline" className="transition-all duration-300 hover:scale-105" onClick={() => window.open(token.buy_urls?.pump_fun || `https://pump.fun/coin/${token.contract_address}`, "_blank")}>Pump.fun <ExternalLink className="w-3 h-3 ml-1" /></Button>
                          <Button size="sm" variant="outline" className="transition-all duration-300 hover:scale-105" onClick={() => window.open(token.buy_urls?.axiom || `https://axiom.trade/t/${token.contract_address}`, "_blank")}>Axiom <ExternalLink className="w-3 h-3 ml-1" /></Button>
                          <Button size="sm" variant="outline" className="transition-all duration-300 hover:scale-105" onClick={() => window.open(token.buy_urls?.gmgn || `https://gmgn.ai/sol/token/${token.contract_address}`, "_blank")}>GMGN <ExternalLink className="w-3 h-3 ml-1" /></Button>
                        </div>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{aiInsight.summary}</p>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <AIScoreBadgePanel token={token} />
                    </div>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
