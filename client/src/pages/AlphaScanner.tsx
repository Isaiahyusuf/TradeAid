import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  Search, TrendingUp, TrendingDown, Shield, ShieldAlert, ShieldCheck,
  Zap, RefreshCw, Brain, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Target, DollarSign, Activity, Clock, ExternalLink
} from "lucide-react";
import { SiSolana, SiEthereum } from "react-icons/si";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

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

function ChainIcon({ chain }: { chain: string }) {
  switch (chain?.toLowerCase()) {
    case "solana":
      return <SiSolana className="w-4 h-4 text-[#9945FF]" />;
    case "ethereum":
      return <SiEthereum className="w-4 h-4 text-[#627EEA]" />;
    case "base":
      return <div className="w-4 h-4 rounded-full bg-[#0052FF] flex items-center justify-center text-white font-bold text-[8px]">B</div>;
    case "bsc":
      return <div className="w-4 h-4 rounded-full bg-[#F3BA2F] flex items-center justify-center text-black font-bold text-[8px]">B</div>;
    default:
      return <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-xs">{chain?.[0]?.toUpperCase()}</div>;
  }
}

function SafetyBadge({ score, riskLevel }: { score: number; riskLevel: string }) {
  const getColor = () => {
    if (score >= 70) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (score >= 50) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    if (score >= 30) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    return "bg-red-500/20 text-red-400 border-red-500/30";
  };
  
  const getIcon = () => {
    if (score >= 70) return <ShieldCheck className="w-3 h-3" />;
    if (score >= 50) return <Shield className="w-3 h-3" />;
    return <ShieldAlert className="w-3 h-3" />;
  };
  
  return (
    <Badge variant="outline" className={`${getColor()} gap-1`}>
      {getIcon()}
      {score}
    </Badge>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  const getProps = () => {
    switch (signal?.toLowerCase()) {
      case "strong_buy":
        return { color: "bg-emerald-500/20 text-emerald-400", icon: <Zap className="w-3 h-3" /> };
      case "buy":
        return { color: "bg-green-500/20 text-green-400", icon: <ArrowUpRight className="w-3 h-3" /> };
      case "sell":
        return { color: "bg-red-500/20 text-red-400", icon: <ArrowDownRight className="w-3 h-3" /> };
      case "avoid":
        return { color: "bg-red-600/20 text-red-400", icon: <AlertTriangle className="w-3 h-3" /> };
      default:
        return { color: "bg-muted text-muted-foreground", icon: <Activity className="w-3 h-3" /> };
    }
  };
  const { color, icon } = getProps();
  
  return (
    <Badge variant="outline" className={`${color} gap-1`}>
      {icon}
      {signal?.replace("_", " ").toUpperCase() || "HOLD"}
    </Badge>
  );
}

function TokenCard({ token, onAnalyze }: { token: ScannedToken; onAnalyze: () => void }) {
  const priceChange = token.priceChange24h || 0;
  const isPositive = priceChange >= 0;
  const ageHours = token.pairCreatedAt 
    ? Math.round((Date.now() - new Date(token.pairCreatedAt).getTime()) / (1000 * 60 * 60))
    : null;

  return (
    <Card className="hover-elevate transition-all">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <ChainIcon chain={token.chain} />
            <div>
              <div className="font-semibold flex items-center gap-2">
                ${token.symbol}
                {ageHours !== null && ageHours < 24 && (
                  <Badge variant="outline" className="bg-purple-500/20 text-purple-400 text-[10px]">
                    NEW
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{token.name}</div>
            </div>
          </div>
          <SafetyBadge score={token.safetyScore} riskLevel={token.riskLevel} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <div className="text-muted-foreground text-xs">Price</div>
            <div className="font-mono">${parseFloat(token.priceUsd || "0").toFixed(6)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">24h Change</div>
            <div className={`font-mono flex items-center gap-1 ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(priceChange).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Liquidity</div>
            <div className="font-mono">${(token.liquidity / 1000).toFixed(1)}K</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Volume 24h</div>
            <div className="font-mono">${(token.volume24h / 1000).toFixed(1)}K</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-xs">
            <span className="text-emerald-400">{token.buys24h} buys</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-red-400">{token.sells24h} sells</span>
          </div>
          <SignalBadge signal={token.aiSignal} />
        </div>

        {token.aiAnalysis && (
          <div className="text-xs text-muted-foreground mb-3 line-clamp-2">
            {token.aiAnalysis}
          </div>
        )}

        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1 gap-1"
            onClick={onAnalyze}
            data-testid={`button-analyze-${token.address}`}
          >
            <Brain className="w-3 h-3" />
            Deep Analyze
          </Button>
          <Button 
            size="sm" 
            variant="ghost"
            className="gap-1"
            onClick={() => window.open(`https://dexscreener.com/${token.chain}/${token.address}`, "_blank")}
            data-testid={`button-dex-${token.address}`}
          >
            <ExternalLink className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SignalCard({ signal }: { signal: TokenSignal }) {
  const token = signal.token;
  
  return (
    <Card className="hover-elevate border-l-4 border-l-emerald-500">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {token && <ChainIcon chain={token.chain} />}
            <span className="font-semibold">${token?.symbol || "Unknown"}</span>
          </div>
          <SignalBadge signal={signal.signalType} />
        </div>
        
        <div className="grid grid-cols-3 gap-2 text-xs mb-2">
          <div>
            <div className="text-muted-foreground">Entry</div>
            <div className="font-mono text-emerald-400">${parseFloat(signal.entryPrice || "0").toFixed(6)}</div>
          </div>
          {signal.targetPrice && (
            <div>
              <div className="text-muted-foreground">Target</div>
              <div className="font-mono text-blue-400">${parseFloat(signal.targetPrice).toFixed(6)}</div>
            </div>
          )}
          {signal.stopLoss && (
            <div>
              <div className="text-muted-foreground">Stop Loss</div>
              <div className="font-mono text-red-400">${parseFloat(signal.stopLoss).toFixed(6)}</div>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground">Confidence:</span>
          <Progress value={signal.confidence} className="h-2 flex-1" />
          <span className="text-xs font-mono">{signal.confidence}%</span>
        </div>
        
        <p className="text-xs text-muted-foreground">{signal.reasoning}</p>
      </CardContent>
    </Card>
  );
}

export default function AlphaScanner() {
  const [searchQuery, setSearchQuery] = useState("");
  const [scanAddress, setScanAddress] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tokens, isLoading: tokensLoading } = useQuery<ScannedToken[]>({
    queryKey: ["/api/tokens"],
    refetchInterval: 30000,
  });

  const { data: hotTokens, isLoading: hotLoading } = useQuery<ScannedToken[]>({
    queryKey: ["/api/tokens/hot"],
    refetchInterval: 30000,
  });

  const { data: newTokens, isLoading: newLoading } = useQuery<ScannedToken[]>({
    queryKey: ["/api/tokens/new"],
    refetchInterval: 30000,
  });

  const { data: signals, isLoading: signalsLoading } = useQuery<TokenSignal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    refetchInterval: 60000,
  });

  const scanMutation = useMutation({
    mutationFn: async (address: string) => {
      return apiRequest("POST", "/api/tokens/scan", { address });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
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
      toast({ title: "Deep analysis complete!" });
    },
    onError: () => {
      toast({ title: "Analysis failed", variant: "destructive" });
    },
  });

  const scanNowMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/scanner/scan-now", { chain: "solana" });
    },
    onSuccess: () => {
      toast({ title: "Scanning for new tokens...", description: "Results will appear shortly" });
    },
  });

  const filteredTokens = tokens?.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="w-6 h-6 text-yellow-400" />
              Alpha Scanner
            </h1>
            <p className="text-muted-foreground">Discover hot tokens before they pump</p>
          </div>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => scanNowMutation.mutate()}
              disabled={scanNowMutation.isPending}
              data-testid="button-scan-now"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${scanNowMutation.isPending ? "animate-spin" : ""}`} />
              Scan Now
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-500/20">
                <Activity className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats?.totalTokens || 0}</div>
                <div className="text-xs text-muted-foreground">Tokens Scanned</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-emerald-500/20">
                <Target className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats?.activeSignals || 0}</div>
                <div className="text-xs text-muted-foreground">Active Signals</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-purple-500/20">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats?.safeTokens || 0}</div>
                <div className="text-xs text-muted-foreground">Safe Tokens (70+)</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Paste token address..."
                  value={scanAddress}
                  onChange={(e) => setScanAddress(e.target.value)}
                  className="flex-1"
                  data-testid="input-scan-address"
                />
                <Button 
                  onClick={() => scanMutation.mutate(scanAddress)}
                  disabled={!scanAddress || scanMutation.isPending}
                  data-testid="button-scan-address"
                >
                  <Search className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="hot" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="hot" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              Hot Tokens
            </TabsTrigger>
            <TabsTrigger value="new" className="gap-2">
              <Clock className="w-4 h-4" />
              New Launches
            </TabsTrigger>
            <TabsTrigger value="signals" className="gap-2">
              <Zap className="w-4 h-4" />
              Signals
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-2">
              <Activity className="w-4 h-4" />
              All Tokens
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hot">
            {hotLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : hotTokens?.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {hotTokens.map((token) => (
                  <TokenCard 
                    key={token.id} 
                    token={token} 
                    onAnalyze={() => deepAnalyzeMutation.mutate(token.address)}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No hot tokens found yet. Click "Scan Now" to discover tokens!</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="new">
            {newLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-4 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : newTokens?.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {newTokens.map((token) => (
                  <TokenCard 
                    key={token.id} 
                    token={token} 
                    onAnalyze={() => deepAnalyzeMutation.mutate(token.address)}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No new tokens in the last 24 hours</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="signals">
            {signalsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : signals?.length ? (
              <div className="space-y-4">
                {signals.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Zap className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No active signals. Analyze tokens to generate signals!</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="all">
            <div className="mb-4">
              <Input
                placeholder="Search tokens..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
                data-testid="input-search-tokens"
              />
            </div>
            
            {tokensLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-4 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredTokens?.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTokens.map((token) => (
                  <TokenCard 
                    key={token.id} 
                    token={token} 
                    onAnalyze={() => deepAnalyzeMutation.mutate(token.address)}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Search className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No tokens found. Start by clicking "Scan Now"!</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
