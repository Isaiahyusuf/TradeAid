import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useTokens, useTokenStats } from "@/hooks/use-memetrend";
import { useAlerts } from "@/hooks/use-alerts";
import { useSafeBuy } from "@/hooks/use-safe-buy";
import { 
  TrendingUp, Activity, Eye, ShieldCheck,
  ArrowUpRight, ArrowDownRight, Bell, ExternalLink, Lock, RefreshCw
} from "lucide-react";
import { SiSolana, SiEthereum } from "react-icons/si";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useToast } from "@/hooks/use-toast";

function ChainIcon({ chain }: { chain: string }) {
  const key = String(chain || "").toUpperCase();
  switch (key) {
    case "SOL":
    case "SOLANA":
      return <SiSolana className="w-4 h-4 text-[#9945FF]" />;
    case "ETH":
    case "ETHEREUM":
      return <SiEthereum className="w-4 h-4 text-[#627EEA]" />;
    case "BSC":
    case "BNB":
      return <div className="w-4 h-4 rounded-full bg-[#F3BA2F] flex items-center justify-center text-black font-bold text-[8px]">B</div>;
    case "BASE":
      return <div className="w-4 h-4 rounded-full bg-[#0052FF] flex items-center justify-center text-white font-bold text-[8px]">B</div>;
    default:
      return null;
  }
}

function formatNumber(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function normalizePct(value: number) {
  return value > 1 ? value : value * 100;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [tokenTab, setTokenTab] = useState<"all" | "5m" | "20m" | "40m" | "1h" | "5h" | "12h" | "24h">("all");
  const { toast } = useToast();
  const qc = useQueryClient();

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

  const selectedAgeTab = ageTabs.find((tab) => tab.key === tokenTab);
  const { data: tokenData, isLoading: tokensLoading, error: tokensError } = useTokens(undefined, {
    newOnly: true,
    maxAgeHours: 24,
    prioritizePumpFun: true,
    limit: 100,
  });
  const { data: ageWindowData, isLoading: ageWindowLoading } = useTokens(
    undefined,
    selectedAgeTab
      ? {
          newOnly: true,
          minAgeMinutes: selectedAgeTab.minAgeMinutes,
          maxAgeMinutes: selectedAgeTab.maxAgeMinutes,
          limit: 20,
        }
      : undefined
  );
  const { data: stats, isLoading: statsLoading, error: statsError } = useTokenStats();
  const { data: alertData, isLoading: alertsLoading, error: alertsError } = useAlerts();
  const { data: safeBuyData, isLoading: safeBuyLoading } = useSafeBuy(5);
  const hasError = tokensError || statsError || alertsError;
  const displayTokens = tokenTab === "all" ? (tokenData?.tokens || []) : (ageWindowData?.tokens || []).slice(0, 20);
  const dedupedAlerts = useMemo(() => {
    const rows = alertData?.alerts || [];
    const seen = new Set<string>();
    const unique: typeof rows = [];
    for (const row of rows) {
      const key = `${row.alert_type}|${row.title}|${row.message}|${row.contract_address || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
      if (unique.length >= 5) break;
    }
    return unique;
  }, [alertData?.alerts]);
  const topSafeBuy = useMemo(() => {
    const rows = safeBuyData?.tokens || [];
    if (!rows.length) return null;
    return [...rows].sort((a, b) => b.safety_score - a.safety_score)[0];
  }, [safeBuyData?.tokens]);
  const selectedToken = useMemo(() => {
    if (!selectedTokenId) return null;
    return displayTokens.find((token) => token.id === selectedTokenId) || null;
  }, [displayTokens, selectedTokenId]);
  const intelligenceMetrics = useMemo(() => {
    const allTokens = tokenData?.tokens || [];
    const scored = allTokens.filter((token) => token.latest_score);
    const lowRisk = scored.filter((token) => normalizePct(token.latest_score!.rug_probability) <= 35).length;
    const mediumRisk = scored.filter((token) => {
      const rug = normalizePct(token.latest_score!.rug_probability);
      return rug > 35 && rug <= 65;
    }).length;
    const highRisk = scored.length - lowRisk - mediumRisk;

    const setupQualified = scored.filter((token) => {
      const confidence = normalizePct(token.latest_score!.trade_confidence_index);
      const rug = normalizePct(token.latest_score!.rug_probability);
      return confidence >= 60 && rug <= 45 && (token.price_change_1h || 0) >= -5;
    }).length;
    const setupWinRate = scored.length ? (setupQualified / scored.length) * 100 : 0;

    const bucketLabels = ["5m", "20m", "40m", "1h", "5h", "12h", "24h"] as const;
    const bucketMinutes = [5, 20, 40, 60, 300, 720, 1440];
    const bucketCounts = bucketLabels.map((label, index) => {
      const min = index === 0 ? 0 : bucketMinutes[index - 1];
      const max = bucketMinutes[index];
      const count = allTokens.filter((token) => {
        const ageMinutes = (Date.now() - new Date(token.created_at).getTime()) / 60000;
        return ageMinutes >= min && ageMinutes < max;
      }).length;
      return { label, count };
    });
    const bestWindow = bucketCounts.sort((a, b) => b.count - a.count)[0] || { label: "5m", count: 0 };

    return {
      lowRisk,
      mediumRisk,
      highRisk,
      setupWinRate,
      bestWindow,
      scoredCount: scored.length,
    };
  }, [tokenData?.tokens]);

  const retryAll = () => {
    qc.refetchQueries({ queryKey: ["tokens"] });
    qc.refetchQueries({ queryKey: ["token-stats"] });
    qc.refetchQueries({ queryKey: ["alerts"] });
    qc.refetchQueries({ queryKey: ["safe-buy"] });
  };

  const handleTiltMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) / rect.width;
    const pointerY = (event.clientY - rect.top) / rect.height;
    const rotateY = (pointerX - 0.5) * 10;
    const rotateX = (0.5 - pointerY) * 10;

    element.style.setProperty("--card-rotate-x", `${rotateX.toFixed(2)}deg`);
    element.style.setProperty("--card-rotate-y", `${rotateY.toFixed(2)}deg`);
    element.style.setProperty("--card-glow-x", `${(pointerX * 100).toFixed(2)}%`);
    element.style.setProperty("--card-glow-y", `${(pointerY * 100).toFixed(2)}%`);
  };

  const handleTiltLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    element.style.setProperty("--card-rotate-x", "0deg");
    element.style.setProperty("--card-rotate-y", "0deg");
    element.style.setProperty("--card-glow-x", "50%");
    element.style.setProperty("--card-glow-y", "50%");
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-welcome">
              Welcome back{user?.username ? `, ${user.username}` : ""}
            </h1>
            <p className="text-muted-foreground">Your trading command center</p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Badge variant="outline" className="solana-badge">All Chains Pulse</Badge>
              <Badge variant="outline" className="border-accent/30 text-accent">Live Intelligence</Badge>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={retryAll} data-testid="button-refresh-dashboard">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Data
          </Button>
        </div>

        {hasError && (
          <Card className="p-4 bg-destructive/10 border-destructive/20">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-destructive">
                Could not load some data. The server may be temporarily unavailable.
              </p>
              <Button
                variant="outline"
                size="sm"
                data-testid="button-retry-dashboard"
                onClick={retryAll}
              >
                Retry
              </Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 solana-card wow-tilt-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Tokens</p>
                <p className="text-2xl font-bold" data-testid="text-total-tokens">
                  {statsLoading ? <Skeleton className="h-7 w-12" /> : (stats?.total_tokens || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4 solana-card wow-tilt-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Eye className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Chains</p>
                <p className="text-2xl font-bold" data-testid="text-chains">
                  {statsLoading ? <Skeleton className="h-7 w-12" /> : Object.keys(stats?.by_chain || {}).length}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4 solana-card wow-tilt-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Bell className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Alerts</p>
                <p className="text-2xl font-bold" data-testid="text-alerts-count">
                  {alertsLoading ? <Skeleton className="h-7 w-12" /> : (alertData?.count || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4 solana-card wow-tilt-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Lock className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Safe Buy</p>
                <p className="text-2xl font-bold">
                  {safeBuyLoading ? <Skeleton className="h-7 w-12" /> : (safeBuyData?.count || 0)}
                </p>
              </div>
            </div>
          </Card>
        </div>

        <Card className="solana-card wow-tilt-card p-4 border-primary/20 animate-soft-pulse" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                Safe Buy Pulse
              </h3>
              <p className="text-sm text-muted-foreground">
                {topSafeBuy
                  ? `Top candidate: ${topSafeBuy.symbol || topSafeBuy.name} · Safety ${topSafeBuy.safety_score.toFixed(0)} · ${topSafeBuy.risk_level} risk`
                  : "No strict Safe Buy candidates right now. Monitoring Near Miss opportunities."}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">Safe: {safeBuyData?.count || 0}</Badge>
              <Badge variant="outline">Near Miss: {safeBuyData?.near_miss_count || 0}</Badge>
              <Link href="/safebuy">
                <Button size="sm" variant="outline" data-testid="button-open-safe-buy">Open Safe Buy</Button>
              </Link>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4 solana-card wow-tilt-card" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <p className="text-sm text-muted-foreground">Setup Win Rate (Est.)</p>
            <p className="text-2xl font-bold">{intelligenceMetrics.setupWinRate.toFixed(0)}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              Based on confidence, rug-risk, and short-term momentum across scored tokens.
            </p>
          </Card>
          <Card className="p-4 solana-card wow-tilt-card" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <p className="text-sm text-muted-foreground">Risk Distribution</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="text-green-400 border-green-400/30">Low {intelligenceMetrics.lowRisk}</Badge>
              <Badge variant="outline" className="text-yellow-400 border-yellow-400/30">Medium {intelligenceMetrics.mediumRisk}</Badge>
              <Badge variant="outline" className="text-red-400 border-red-400/30">High {intelligenceMetrics.highRisk}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Scored Universe: {intelligenceMetrics.scoredCount}</p>
          </Card>
          <Card className="p-4 solana-card wow-tilt-card" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <p className="text-sm text-muted-foreground">Best Time Window</p>
            <p className="text-2xl font-bold">{intelligenceMetrics.bestWindow.label}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Highest concentration of active opportunities currently appears in this age bucket.
            </p>
          </Card>
        </div>

        {stats?.by_chain && Object.keys(stats.by_chain).length > 0 && (
          <Card className="solana-card p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Tokens by Chain
            </h3>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.by_chain).map(([chain, count]) => (
                <div key={chain} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
                  <ChainIcon chain={chain} />
                  <span className="text-sm font-medium capitalize">{chain}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {selectedAlert && (
            <Card className="lg:col-span-2 p-4 solana-card">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Live Selection</p>
                  <div>
                    <p className="font-semibold">{selectedAlert.title}</p>
                    <p className="text-xs text-muted-foreground break-words leading-relaxed">{selectedAlert.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setSelectedAlert(null); }}>
                    Clear
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <Card className="solana-card overflow-hidden border-primary/20">
            <div className="p-4 border-b border-border flex items-center justify-between gap-2">
              <h3 className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                Recent Tokens
              </h3>
              <Link href="/memetrend">
                <Button variant="ghost" size="sm" data-testid="button-view-all-tokens">View All</Button>
              </Link>
            </div>
            <div className="px-4 py-3 border-b border-border">
              <Tabs value={tokenTab} onValueChange={(value) => setTokenTab(value as "all" | "5m" | "20m" | "40m" | "1h" | "5h" | "12h" | "24h") }>
                <TabsList className="w-full overflow-x-auto justify-start">
                  <TabsTrigger className="solana-tab-trigger" value="all">All Tokens</TabsTrigger>
                  <TabsTrigger className="solana-tab-trigger" value="5m">5m</TabsTrigger>
                  <TabsTrigger className="solana-tab-trigger" value="20m">20m</TabsTrigger>
                  <TabsTrigger className="solana-tab-trigger" value="40m">40m</TabsTrigger>
                  <TabsTrigger className="solana-tab-trigger" value="1h">1h</TabsTrigger>
                  <TabsTrigger className="solana-tab-trigger" value="5h">5h</TabsTrigger>
                  <TabsTrigger className="solana-tab-trigger" value="12h">12h</TabsTrigger>
                  <TabsTrigger className="solana-tab-trigger" value="24h">24h</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="divide-y divide-border">
              {(tokenTab === "all" ? tokensLoading : ageWindowLoading) ? (
                Array(5).fill(0).map((_, i) => (
                  <div key={i} className="p-4 flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </div>
                ))
              ) : (
                displayTokens.slice(0, 8).map((token) => (
                  <div
                    key={token.id}
                    className={cn(
                      "p-4 cursor-pointer transition-all duration-300 hover:bg-primary/5 hover:-translate-y-0.5",
                      selectedToken?.id === token.id && "bg-gradient-to-r from-primary/10 via-accent/5 to-background"
                    )}
                    data-testid={`token-row-${token.id}`}
                    onClick={() => {
                      setSelectedTokenId((prev) => (prev === token.id ? null : token.id));
                      setSelectedAlert(null);
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center font-bold shrink-0">
                        {token.logo_url ? (
                          <img src={token.logo_url} alt={token.symbol || token.name || "token logo"} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <ChainIcon chain={token.chain} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{token.symbol || token.name || "Unknown"}</span>
                          <Badge variant="outline" className="text-[10px]">{token.chain}</Badge>
                          {token.is_pump_fun && <Badge variant="secondary" className="text-[10px]">Pump.fun</Badge>}
                          {token.latest_score && (
                            <Badge variant="outline" className="text-[10px]">
                              Safety {normalizePct(100 - token.latest_score.rug_probability).toFixed(0)}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{token.contract_address.slice(0, 12)}...</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm">{formatNumber(token.market_cap_usd)}</p>
                        <p className="text-xs text-muted-foreground">MCap</p>
                      </div>
                    </div>

                    {selectedToken?.id === token.id && (
                      <div className="w-full mt-4 pt-4 border-t border-border/60 space-y-4 data-[state=open]:animate-accordion-down">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div><p className="text-muted-foreground">Price</p><p className="font-medium">{token.current_price_usd?.toFixed(6) || "0.000000"}</p></div>
                          <div><p className="text-muted-foreground">Liquidity</p><p className="font-medium">{formatNumber(token.liquidity_usd || 0)}</p></div>
                          <div><p className="text-muted-foreground">Vol 1h</p><p className="font-medium">{formatNumber(token.volume_1h || 0)}</p></div>
                          <div><p className="text-muted-foreground">Momentum</p><p className="font-medium">{(token.price_change_1h || 0).toFixed(2)}%</p></div>
                        </div>

                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex flex-wrap gap-2">
                            {token.latest_score && (
                              <Badge variant="secondary" className="animate-pulse">Safety {normalizePct(100 - token.latest_score.rug_probability).toFixed(0)}</Badge>
                            )}
                            <Badge variant="outline" className="font-mono text-[10px]">{token.contract_address}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="transition-all duration-300 hover:scale-105"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigator.clipboard.writeText(token.contract_address);
                                toast({ title: "Copied", description: "Contract address copied" });
                              }}
                            >
                              Copy
                            </Button>
                            <Button size="sm" variant="outline" className="transition-all duration-300 hover:scale-105" onClick={(event) => { event.stopPropagation(); window.open(token.buy_urls?.pump_fun || `https://pump.fun/coin/${token.contract_address}`, "_blank"); }}>Pump.fun <ExternalLink className="w-3 h-3 ml-1" /></Button>
                            <Button size="sm" variant="outline" className="transition-all duration-300 hover:scale-105" onClick={(event) => { event.stopPropagation(); window.open(token.buy_urls?.axiom || `https://axiom.trade/t/${token.contract_address}`, "_blank"); }}>Axiom <ExternalLink className="w-3 h-3 ml-1" /></Button>
                            <Button size="sm" variant="outline" className="transition-all duration-300 hover:scale-105" onClick={(event) => { event.stopPropagation(); window.open(token.buy_urls?.gmgn || `https://gmgn.ai/sol/token/${token.contract_address}`, "_blank"); }}>GMGN <ExternalLink className="w-3 h-3 ml-1" /></Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
              {!(tokenTab === "all" ? tokensLoading : ageWindowLoading) && displayTokens.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  {tokenTab === "all" ? "No tokens found yet. Start scanning!" : "No projects found in this exact age window yet."}
                </div>
              )}
            </div>
          </Card>

          <Card className="bg-card/60 backdrop-blur overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between gap-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Bell className="w-4 h-4 text-orange-500" />
                Recent Alerts
              </h3>
            </div>
            <div className="divide-y divide-border">
              {alertsLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <div key={i} className="p-4 flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-lg" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </div>
                ))
              ) : (
                dedupedAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={cn(
                      "p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 hover-elevate cursor-pointer",
                      selectedAlert?.id === alert.id && "bg-muted/40"
                    )}
                    data-testid={`alert-row-${alert.id}`}
                    onClick={() => {
                      setSelectedAlert((prev) => (prev?.id === alert.id ? null : alert));
                      setSelectedTokenId(null);
                    }}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center",
                      alert.severity === "high" ? "bg-red-500/10" : alert.severity === "medium" ? "bg-yellow-500/10" : "bg-blue-500/10"
                    )}>
                      {alert.severity === "high" ? (
                        <ArrowDownRight className="w-5 h-5 text-red-500" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5 text-yellow-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 w-full">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm break-words">{alert.title}</span>
                        <Badge variant="outline" className={cn(
                          "text-[10px]",
                          alert.severity === "high" ? "text-red-400 border-red-400/30" : "text-yellow-400 border-yellow-400/30"
                        )}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground break-words leading-relaxed">
                        {alert.message}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0 self-start sm:self-center uppercase">
                      {alert.chain}
                    </Badge>
                  </div>
                ))
              )}
              {!alertsLoading && dedupedAlerts.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No alerts yet.
                </div>
              )}
            </div>
          </Card>
        </div>

        <Card className="bg-card/60 backdrop-blur p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-green-500" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link href="/rugshield">
              <Button className="w-full" data-testid="button-quick-scan">
                <ShieldCheck className="w-4 h-4 mr-2" />
                Score a Token
              </Button>
            </Link>
            <Link href="/whalewatch">
              <Button variant="outline" className="w-full" data-testid="button-quick-whale">
                <Eye className="w-4 h-4 mr-2" />
                Analyze a Wallet
              </Button>
            </Link>
            <Link href="/scanner">
              <Button variant="outline" className="w-full" data-testid="button-quick-scanner">
                <Activity className="w-4 h-4 mr-2" />
                Alpha Scanner
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
