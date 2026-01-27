import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  Search, TrendingUp, TrendingDown, Shield, ShieldAlert, ShieldCheck,
  Zap, RefreshCw, Brain, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Target, DollarSign, Activity, Clock, ExternalLink, Crown, Flame,
  Rocket, Eye, Lock, Sparkles, ChevronRight, Filter, BarChart3
} from "lucide-react";
import { useState, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ChainTabs, ChainBadge, CHAINS, type Chain } from "@/components/ChainTabs";
import { AdBanner } from "@/components/AdBanner";
import { UsageSummary, UsageMeter } from "@/components/UsageMeter";
import { useAuth } from "@/hooks/use-auth";
import { FREE_TIER_LIMITS } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type ScannedToken = {
  id: number;
  address: string;
  symbol: string;
  name: string;
  chain: string;
  priceUsd: string;
  liquidity: number;
  marketCap: number;
  volume24h: number;
  priceChange1h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  safetyScore: number;
  isHoneypot: boolean;
  riskLevel: string;
  aiSignal: string;
  aiAnalysis: string;
  pairCreatedAt: string;
  socialLinks: { twitter?: string; telegram?: string; website?: string };
};

type TokenSignal = {
  id: number;
  tokenAddress: string;
  signalType: string;
  confidence: number;
  entryPrice: string;
  targetPrice: string;
  stopLoss: string;
  reasoning: string;
  token?: ScannedToken;
};

type Stats = {
  totalTokens: number;
  activeSignals: number;
  safeTokens: number;
};

function SafetyScore({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const getColor = () => {
    if (score >= 70) return { bg: "bg-emerald-500", text: "text-emerald-400", ring: "ring-emerald-500/30" };
    if (score >= 50) return { bg: "bg-amber-500", text: "text-amber-400", ring: "ring-amber-500/30" };
    if (score >= 30) return { bg: "bg-orange-500", text: "text-orange-400", ring: "ring-orange-500/30" };
    return { bg: "bg-red-500", text: "text-red-400", ring: "ring-red-500/30" };
  };
  
  const colors = getColor();
  const sizeClasses = {
    sm: "w-10 h-10 text-sm",
    md: "w-12 h-12 text-base",
    lg: "w-16 h-16 text-lg",
  };

  return (
    <div className={cn(
      "relative rounded-full flex items-center justify-center font-bold ring-2",
      sizeClasses[size],
      colors.text,
      colors.ring
    )}>
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="3"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          className={colors.bg}
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={`${score}, 100`}
          strokeLinecap="round"
        />
      </svg>
      <span className="relative z-10">{score}</span>
    </div>
  );
}

function SignalBadge({ signal, size = "sm" }: { signal: string; size?: "sm" | "md" }) {
  const getProps = () => {
    switch (signal?.toLowerCase()) {
      case "strong_buy":
        return { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: <Zap className="w-3 h-3" />, label: "STRONG BUY" };
      case "buy":
        return { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: <ArrowUpRight className="w-3 h-3" />, label: "BUY" };
      case "sell":
        return { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: <ArrowDownRight className="w-3 h-3" />, label: "SELL" };
      case "avoid":
        return { color: "bg-red-600/20 text-red-400 border-red-600/30", icon: <AlertTriangle className="w-3 h-3" />, label: "AVOID" };
      default:
        return { color: "bg-muted text-muted-foreground border-muted", icon: <Activity className="w-3 h-3" />, label: "HOLD" };
    }
  };
  const { color, icon, label } = getProps();
  
  return (
    <Badge variant="outline" className={cn(color, "gap-1", size === "md" && "px-3 py-1")}>
      {icon}
      {label}
    </Badge>
  );
}

function TokenRow({ token, onAnalyze, isPro, canAnalyze }: { 
  token: ScannedToken; 
  onAnalyze: () => void; 
  isPro: boolean;
  canAnalyze: boolean;
}) {
  const priceChange = token.priceChange24h || 0;
  const isPositive = priceChange >= 0;
  const ageHours = token.pairCreatedAt 
    ? Math.round((Date.now() - new Date(token.pairCreatedAt).getTime()) / (1000 * 60 * 60))
    : null;
  const isNew = ageHours !== null && ageHours < 24;

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  return (
    <div className="group flex items-center gap-4 p-4 rounded-xl bg-card/50 hover:bg-card border border-transparent hover:border-border transition-all">
      <SafetyScore score={token.safetyScore} size="sm" />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <ChainBadge chain={token.chain as Chain} />
          <span className="font-bold truncate">${token.symbol}</span>
          {isNew && (
            <Badge variant="outline" className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">
              <Rocket className="w-3 h-3 mr-1" /> NEW
            </Badge>
          )}
          {token.isHoneypot && (
            <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">
              <AlertTriangle className="w-3 h-3 mr-1" /> HONEYPOT
            </Badge>
          )}
        </div>
        <div className="text-sm text-muted-foreground truncate">{token.name}</div>
      </div>

      <div className="hidden md:flex flex-col items-end text-right min-w-[100px]">
        <div className="font-mono text-sm">
          ${parseFloat(token.priceUsd || "0").toFixed(token.priceUsd && parseFloat(token.priceUsd) < 0.01 ? 8 : 4)}
        </div>
        <div className={cn(
          "flex items-center gap-1 text-xs",
          isPositive ? "text-emerald-400" : "text-red-400"
        )}>
          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {isPositive ? "+" : ""}{priceChange.toFixed(1)}%
        </div>
      </div>

      <div className="hidden lg:flex flex-col items-end text-right min-w-[80px]">
        <div className="text-sm text-muted-foreground">Liquidity</div>
        <div className="font-mono text-sm">{formatNumber(token.liquidity)}</div>
      </div>

      <div className="hidden lg:flex flex-col items-end text-right min-w-[80px]">
        <div className="text-sm text-muted-foreground">Vol 24h</div>
        <div className="font-mono text-sm">{formatNumber(token.volume24h)}</div>
      </div>

      <SignalBadge signal={token.aiSignal} />

      <Button 
        size="sm" 
        variant="outline"
        onClick={onAnalyze}
        disabled={!isPro && !canAnalyze}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        data-testid={`button-analyze-${token.address}`}
      >
        {!isPro && !canAnalyze ? <Lock className="w-4 h-4" /> : <Brain className="w-4 h-4" />}
      </Button>
    </div>
  );
}

function SignalCard({ signal, isPro }: { signal: TokenSignal; isPro: boolean }) {
  const token = signal.token;
  if (!token) return null;

  return (
    <Card className="overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
      <CardContent className="relative p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChainBadge chain={token.chain as Chain} />
            <span className="font-bold">${token.symbol}</span>
          </div>
          <SignalBadge signal={signal.signalType} size="md" />
        </div>
        
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-2 rounded-lg bg-muted/50">
            <div className="text-[10px] text-muted-foreground mb-1">Entry</div>
            <div className="font-mono text-sm text-emerald-400">
              ${parseFloat(signal.entryPrice || "0").toFixed(6)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <div className="text-[10px] text-muted-foreground mb-1">Target</div>
            <div className="font-mono text-sm text-primary">
              {signal.targetPrice ? `$${parseFloat(signal.targetPrice).toFixed(6)}` : "-"}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <div className="text-[10px] text-muted-foreground mb-1">Stop</div>
            <div className="font-mono text-sm text-red-400">
              {signal.stopLoss ? `$${parseFloat(signal.stopLoss).toFixed(6)}` : "-"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">Confidence</div>
            <Progress value={signal.confidence} className="w-20 h-1.5" />
            <span className="text-xs font-medium">{signal.confidence}%</span>
          </div>
          <Button size="sm" variant="ghost" className="h-7" asChild>
            <a href={`https://dexscreener.com/search?q=${signal.tokenAddress}`} target="_blank" rel="noopener noreferrer">
              View <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </Button>
        </div>

        {!isPro && (
          <div className="pt-2 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="w-3 h-3" />
              <span>Full analysis available for Pro members</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, icon: Icon, trend, color }: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
  color: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-10", color)} />
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between mb-2">
          <div className={cn("p-2 rounded-lg", color.replace("from-", "bg-").split(" ")[0] + "/20")}>
            <Icon className={cn("w-5 h-5", color.replace("from-", "text-").split(" ")[0])} />
          </div>
          {trend && (
            <Badge variant="outline" className="text-xs">
              {trend}
            </Badge>
          )}
        </div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{title}</div>
      </CardContent>
    </Card>
  );
}

export default function AlphaScanner() {
  const [selectedChain, setSelectedChain] = useState<Chain>("solana");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanAddress, setScanAddress] = useState("");
  const [activeTab, setActiveTab] = useState("hot");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const { data: subscription } = useQuery<{ plan: string; status: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });
  
  const { data: usageData } = useQuery<{ dailyScans: number; dailyDeepAnalyses: number; dailySignalViews: number }>({
    queryKey: ["/api/usage"],
    enabled: !!user,
  });
  
  const isPro = subscription?.plan === "pro" && subscription?.status === "active";
  const usage = usageData || { dailyScans: 0, dailyDeepAnalyses: 0, dailySignalViews: 0 };

  const { data: tokens = [], isLoading: tokensLoading } = useQuery<ScannedToken[]>({
    queryKey: ["/api/tokens"],
    refetchInterval: 30000,
  });

  const { data: signals = [], isLoading: signalsLoading } = useQuery<TokenSignal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    refetchInterval: 60000,
  });

  const { data: safePicks = [] } = useQuery<ScannedToken[]>({
    queryKey: ["/api/tokens/safe-picks"],
    refetchInterval: 30000,
  });

  const { data: newTokens = [] } = useQuery<ScannedToken[]>({
    queryKey: ["/api/tokens/new", { hours: 6 }],
    refetchInterval: 15000,
  });

  const incrementUsageMutation = useMutation({
    mutationFn: async (type: "scans" | "analyses" | "signals" | "ads") => {
      return apiRequest("POST", "/api/usage/increment", { type });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (address: string) => {
      return apiRequest("POST", "/api/tokens/scan", { address, chain: selectedChain });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
      if (!isPro && user) incrementUsageMutation.mutate("scans");
      toast({ title: "Token scanned successfully!" });
      setScanAddress("");
    },
    onError: () => {
      toast({ title: "Failed to scan token", variant: "destructive" });
    },
  });

  const deepAnalyzeMutation = useMutation({
    mutationFn: async (address: string) => {
      return apiRequest("POST", `/api/tokens/${address}/deep-analyze`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      if (!isPro && user) incrementUsageMutation.mutate("analyses");
      toast({ title: "AI Analysis complete!" });
    },
    onError: () => {
      toast({ title: "Analysis failed", variant: "destructive" });
    },
  });

  const scanNowMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/scanner/scan-now", { chain: selectedChain });
    },
    onSuccess: () => {
      toast({ title: "Scanning for new tokens...", description: "Results will appear shortly" });
    },
  });

  const filteredTokens = useMemo(() => {
    let result = tokens.filter(t => t.chain === selectedChain);
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => 
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      );
    }

    switch (activeTab) {
      case "hot":
        return result.filter(t => t.safetyScore >= 50 && t.volume24h > 5000).sort((a, b) => b.volume24h - a.volume24h);
      case "new":
        return result.filter(t => {
          const age = t.pairCreatedAt ? (Date.now() - new Date(t.pairCreatedAt).getTime()) / (1000 * 60 * 60) : 999;
          return age < 24;
        }).sort((a, b) => new Date(b.pairCreatedAt).getTime() - new Date(a.pairCreatedAt).getTime());
      case "safe":
        return result.filter(t => t.safetyScore >= 70).sort((a, b) => b.safetyScore - a.safetyScore);
      case "risky":
        return result.filter(t => t.safetyScore < 50).sort((a, b) => a.safetyScore - b.safetyScore);
      default:
        return result.sort((a, b) => b.safetyScore - a.safetyScore);
    }
  }, [tokens, selectedChain, searchQuery, activeTab]);

  const chainInfo = CHAINS.find(c => c.id === selectedChain);
  const canAnalyze = isPro || usage.dailyDeepAnalyses < FREE_TIER_LIMITS.dailyDeepAnalyses;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Flame className="w-8 h-8 text-primary" />
              Alpha Scanner
              {!isPro && (
                <Badge variant="outline" className="text-xs">FREE</Badge>
              )}
            </h1>
            <p className="text-muted-foreground mt-1">
              Real-time token discovery across {chainInfo?.launchpad} and more
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {!isPro && (
              <Link href="/subscription">
                <Button className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600">
                  <Crown className="w-4 h-4 mr-2" />
                  Upgrade to Pro
                </Button>
              </Link>
            )}
            <Button 
              variant="outline" 
              onClick={() => scanNowMutation.mutate()}
              disabled={scanNowMutation.isPending}
              data-testid="button-scan-now"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", scanNowMutation.isPending && "animate-spin")} />
              Scan Now
            </Button>
          </div>
        </div>

        {!isPro && <AdBanner variant="inline" />}

        <ChainTabs value={selectedChain} onChange={setSelectedChain} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard 
            title="Tokens Scanned" 
            value={stats?.totalTokens || 0} 
            icon={BarChart3}
            color="from-primary to-emerald-500"
          />
          <StatCard 
            title="Active Signals" 
            value={stats?.activeSignals || 0} 
            icon={Zap}
            color="from-amber-500 to-orange-500"
          />
          <StatCard 
            title="Safe Tokens" 
            value={stats?.safeTokens || 0} 
            icon={ShieldCheck}
            color="from-emerald-500 to-teal-500"
          />
          <StatCard 
            title={chainInfo?.launchpad || "Launchpad"} 
            value={filteredTokens.length} 
            icon={Rocket}
            trend="Live"
            color="from-purple-500 to-pink-500"
          />
        </div>

        {newTokens.length > 0 && (
          <Card className="border-2 border-purple-500/50 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-purple-400">
                <Rocket className="w-6 h-6" />
                Newest Launches - Just Dropped
                <Badge className="bg-purple-500 text-white animate-pulse">LIVE</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Fresh tokens launched in the last 6 hours - act fast!
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                {newTokens.slice(0, 8).map((token) => {
                  const ageMs = token.pairCreatedAt ? Date.now() - new Date(token.pairCreatedAt).getTime() : 0;
                  const ageMinutes = Math.floor(ageMs / 60000);
                  const ageText = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ago`;
                  
                  return (
                    <div 
                      key={token.id}
                      className="p-3 rounded-lg border border-purple-500/30 bg-background/50 hover-elevate"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-bold">{token.symbol}</div>
                        <Badge variant="outline" className="text-xs text-purple-400 border-purple-400">
                          <Clock className="w-3 h-3 mr-1" />
                          {ageText}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mb-2">{token.name}</div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Score:</span>
                        <span className={cn(
                          "font-medium",
                          token.safetyScore >= 70 ? "text-emerald-400" : 
                          token.safetyScore >= 50 ? "text-amber-400" : "text-red-400"
                        )}>
                          {token.safetyScore}/100
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-1">
                        <span className="text-muted-foreground">1h:</span>
                        <span className={cn(
                          "font-medium",
                          token.priceChange1h >= 0 ? "text-emerald-400" : "text-red-400"
                        )}>
                          {token.priceChange1h >= 0 ? "+" : ""}{token.priceChange1h.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {safePicks.length > 0 && (
          <Card className="border-2 border-emerald-500/50 bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="w-6 h-6" />
                Top Safe Picks - Recommended Investments
                <Badge className="bg-emerald-500 text-white">AI Selected</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Tokens with high safety scores, strong liquidity, and positive momentum
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {safePicks.slice(0, 6).map((token) => (
                  <div 
                    key={token.id}
                    className="p-4 rounded-lg border border-emerald-500/30 bg-background/50 hover-elevate"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-lg">{token.symbol}</div>
                        <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
                          {token.aiSignal === "strong_buy" ? "STRONG BUY" : "BUY"}
                        </Badge>
                      </div>
                      <SafetyScore score={token.safetyScore} size="sm" />
                    </div>
                    <div className="text-sm text-muted-foreground mb-2">{token.name}</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Liquidity:</span>
                        <span className="ml-1 font-medium">${(token.liquidity / 1000).toFixed(1)}K</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Volume:</span>
                        <span className="ml-1 font-medium">${(token.volume24h / 1000).toFixed(1)}K</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">1h Change:</span>
                        <span className={cn(
                          "ml-1 font-medium",
                          token.priceChange1h >= 0 ? "text-emerald-400" : "text-red-400"
                        )}>
                          {token.priceChange1h >= 0 ? "+" : ""}{token.priceChange1h.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      className="w-full mt-3 bg-emerald-500 hover:bg-emerald-600"
                      onClick={() => deepAnalyzeMutation.mutate(token.address)}
                      disabled={deepAnalyzeMutation.isPending || (!isPro && !canAnalyze)}
                      data-testid={`button-analyze-safe-${token.id}`}
                    >
                      <Brain className="w-3 h-3 mr-1" />
                      Deep Analyze
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search tokens..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                      data-testid="input-search-tokens"
                    />
                  </div>
                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid grid-cols-4 h-9">
                      <TabsTrigger value="hot" className="text-xs" data-testid="tab-hot">
                        <Flame className="w-3 h-3 mr-1" /> Hot
                      </TabsTrigger>
                      <TabsTrigger value="new" className="text-xs" data-testid="tab-new">
                        <Rocket className="w-3 h-3 mr-1" /> New
                      </TabsTrigger>
                      <TabsTrigger value="safe" className="text-xs" data-testid="tab-safe">
                        <ShieldCheck className="w-3 h-3 mr-1" /> Safe
                      </TabsTrigger>
                      <TabsTrigger value="risky" className="text-xs" data-testid="tab-risky">
                        <AlertTriangle className="w-3 h-3 mr-1" /> Risky
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {tokensLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 rounded-xl" />
                    ))
                  ) : filteredTokens.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No tokens found for this chain</p>
                      <Button 
                        variant="outline" 
                        className="mt-4"
                        onClick={() => scanNowMutation.mutate()}
                      >
                        Scan for tokens
                      </Button>
                    </div>
                  ) : (
                    filteredTokens.slice(0, 15).map((token) => (
                      <TokenRow
                        key={token.id}
                        token={token}
                        onAnalyze={() => deepAnalyzeMutation.mutate(token.address)}
                        isPro={isPro}
                        canAnalyze={canAnalyze}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Manual Token Scan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  <Input
                    placeholder="Enter token address..."
                    value={scanAddress}
                    onChange={(e) => setScanAddress(e.target.value)}
                    className="flex-1 font-mono text-sm"
                    data-testid="input-scan-address"
                  />
                  <Button
                    onClick={() => scanMutation.mutate(scanAddress)}
                    disabled={!scanAddress || scanMutation.isPending || (!isPro && usage.dailyScans >= FREE_TIER_LIMITS.dailyScans)}
                    data-testid="button-scan-token"
                  >
                    {scanMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : !isPro && usage.dailyScans >= FREE_TIER_LIMITS.dailyScans ? (
                      <Lock className="w-4 h-4" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    Scan
                  </Button>
                </div>
                {!isPro && (
                  <div className="mt-3">
                    <UsageMeter type="scans" used={usage.dailyScans} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {!isPro && (
              <UsageSummary usage={usage} isPro={isPro} />
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-400" />
                  Hot Signals
                  {!isPro && (
                    <Badge variant="outline" className="text-xs ml-auto">
                      {usage.dailySignalViews}/{FREE_TIER_LIMITS.dailySignalViews}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {signalsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 rounded-xl" />
                  ))
                ) : signals.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Zap className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No active signals</p>
                  </div>
                ) : (
                  signals.slice(0, isPro ? 10 : FREE_TIER_LIMITS.dailySignalViews).map((signal) => (
                    <SignalCard key={signal.id} signal={signal} isPro={isPro} />
                  ))
                )}

                {!isPro && signals.length > FREE_TIER_LIMITS.dailySignalViews && (
                  <Link href="/subscription">
                    <Button variant="outline" className="w-full">
                      <Lock className="w-4 h-4 mr-2" />
                      Unlock {signals.length - FREE_TIER_LIMITS.dailySignalViews} more signals
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>

            {!isPro && <AdBanner variant="sidebar" />}

            <Card className="bg-gradient-to-br from-primary/10 via-accent/10 to-purple-500/10 border-primary/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/20">
                    <Crown className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">Go Pro</div>
                    <div className="text-xs text-muted-foreground">Unlimited everything</div>
                  </div>
                </div>
                <ul className="space-y-2 text-sm mb-4">
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Unlimited token scans
                  </li>
                  <li className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-400" />
                    Unlimited AI analyses
                  </li>
                  <li className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    All premium signals
                  </li>
                  <li className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-pink-400" />
                    No advertisements
                  </li>
                </ul>
                <Link href="/subscription">
                  <Button className="w-full" data-testid="button-go-pro">
                    View Plans
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
