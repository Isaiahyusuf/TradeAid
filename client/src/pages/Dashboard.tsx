import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { 
  TrendingUp, TrendingDown, Activity, Eye, ShieldCheck, 
  Twitter, Search, Zap, ArrowUpRight, ArrowDownRight,
  Rocket, DollarSign, Users, Clock
} from "lucide-react";
import { SiSolana, SiEthereum } from "react-icons/si";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

type DexToken = {
  symbol: string;
  name: string;
  chain: string;
  dex: string;
  price: string;
  volume: string;
  age: string;
  hype: number;
  dexscreenerPaid: boolean;
};

type TwitterTrend = {
  tag: string;
  mentions: number;
  sentiment: string;
  change: string;
};

type LaunchpadItem = {
  platform: string;
  symbol: string;
  name: string;
  bondingCurve: number;
  holders: number;
  liquidity: string;
  status: string;
};

type TrendingCoin = {
  id: number;
  symbol: string;
  name: string;
  price: string;
  volume24h: string;
  hypeScore: number;
  trend: string;
};

type WalletAlert = {
  id: number;
  walletId: number;
  tokenSymbol: string;
  type: string;
  amount: string;
  price: string;
  timestamp: string;
  walletLabel: string;
};

function ChainIcon({ chain }: { chain: string }) {
  switch (chain) {
    case "SOL":
      return <SiSolana className="w-4 h-4 text-[#9945FF]" />;
    case "ETH":
      return <SiEthereum className="w-4 h-4 text-[#627EEA]" />;
    case "BSC":
      return <div className="w-4 h-4 rounded-full bg-[#F3BA2F] flex items-center justify-center text-black font-bold text-[8px]">B</div>;
    case "BASE":
      return <div className="w-4 h-4 rounded-full bg-[#0052FF] flex items-center justify-center text-white font-bold text-[8px]">B</div>;
    default:
      return null;
  }
}

export default function Dashboard() {
  const { user } = useAuth();

  const { data: dexTokens, isLoading: dexLoading } = useQuery<DexToken[]>({
    queryKey: ["/api/dex/new-tokens"],
  });

  const { data: twitterTrends, isLoading: twitterLoading } = useQuery<TwitterTrend[]>({
    queryKey: ["/api/twitter/trends"],
  });

  const { data: launchpads, isLoading: launchpadsLoading } = useQuery<LaunchpadItem[]>({
    queryKey: ["/api/launchpads/recent"],
  });

  const { data: trendingCoins, isLoading: trendingLoading } = useQuery<TrendingCoin[]>({
    queryKey: ["/api/memetrend/list"],
  });

  const { data: whaleAlerts, isLoading: alertsLoading } = useQuery<WalletAlert[]>({
    queryKey: ["/api/whalewatch/alerts"],
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome back{user?.firstName ? `, ${user.firstName}` : ""}
            </h1>
            <p className="text-muted-foreground">Your memecoin trading command center</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/subscription">
              <Button variant="outline" data-testid="button-upgrade">
                <Zap className="w-4 h-4 mr-2" />
                Upgrade to Pro
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 bg-card/60 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tokens Scanned</p>
                <p className="text-2xl font-bold">247</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-card/60 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Eye className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Whales Tracked</p>
                <p className="text-2xl font-bold">12</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-card/60 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Alerts</p>
                <p className="text-2xl font-bold">8</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-card/60 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Trending Now</p>
                <p className="text-2xl font-bold">{trendingCoins?.length || 0}</p>
              </div>
            </div>
          </Card>
        </div>

        <Tabs defaultValue="dex" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-card/60">
            <TabsTrigger value="dex" data-testid="tab-dex">
              <Search className="w-4 h-4 mr-2" />
              DEX Scanner
            </TabsTrigger>
            <TabsTrigger value="twitter" data-testid="tab-twitter">
              <Twitter className="w-4 h-4 mr-2" />
              Twitter
            </TabsTrigger>
            <TabsTrigger value="launchpads" data-testid="tab-launchpads">
              <Rocket className="w-4 h-4 mr-2" />
              Launchpads
            </TabsTrigger>
            <TabsTrigger value="whales" data-testid="tab-whales">
              <Eye className="w-4 h-4 mr-2" />
              Whale Alerts
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="dex" className="mt-4">
            <Card className="bg-card/60 backdrop-blur overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold">New Token Launches</h3>
                <Badge variant="outline" className="text-xs">Live</Badge>
              </div>
              <div className="divide-y divide-border">
                {dexLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <div key={i} className="p-4 flex items-center gap-4">
                      <Skeleton className="w-10 h-10 rounded-lg" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-20 ml-auto" />
                    </div>
                  ))
                ) : (
                  dexTokens?.map((token, i) => (
                    <div key={i} className="p-4 flex items-center gap-4 hover:bg-white/5 transition-colors" data-testid={`dex-token-${i}`}>
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <ChainIcon chain={token.chain} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate">{token.symbol}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">{token.dex}</Badge>
                            {token.dexscreenerPaid && (
                              <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px] shrink-0">
                                <DollarSign className="w-3 h-3 mr-0.5" />
                                Paid
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{token.name}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm">${token.price}</p>
                        <p className="text-xs text-muted-foreground">{token.volume}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {token.age}
                        </div>
                        <div className={`text-xs ${token.hype > 80 ? "text-green-400" : token.hype > 60 ? "text-yellow-400" : "text-muted-foreground"}`}>
                          Hype: {token.hype}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="twitter" className="mt-4">
            <Card className="bg-card/60 backdrop-blur overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold">Trending on Crypto Twitter</h3>
                <Badge variant="outline" className="text-xs">Real-time</Badge>
              </div>
              <div className="divide-y divide-border">
                {twitterLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <div key={i} className="p-4 flex items-center gap-4">
                      <Skeleton className="h-5 w-24" />
                      <Skeleton className="h-4 w-20 ml-auto" />
                    </div>
                  ))
                ) : (
                  twitterTrends?.map((trend, i) => (
                    <div key={i} className="p-4 flex items-center gap-4 hover:bg-white/5 transition-colors" data-testid={`twitter-trend-${i}`}>
                      <div className="flex-1">
                        <span className="font-semibold text-cyan-400">{trend.tag}</span>
                        <p className="text-sm text-muted-foreground">{trend.mentions.toLocaleString()} mentions</p>
                      </div>
                      <Badge className={trend.sentiment === "BULLISH" ? "bg-green-500/20 text-green-400" : trend.sentiment === "BEARISH" ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}>
                        {trend.sentiment}
                      </Badge>
                      <div className={`flex items-center gap-1 font-mono ${trend.change.startsWith("+") ? "text-green-400" : "text-red-400"}`}>
                        {trend.change.startsWith("+") ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        {trend.change}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="launchpads" className="mt-4">
            <Card className="bg-card/60 backdrop-blur overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold">Launchpad Activity</h3>
                <Badge variant="outline" className="text-xs">Pump.fun & More</Badge>
              </div>
              <div className="divide-y divide-border">
                {launchpadsLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <div key={i} className="p-4 flex items-center gap-4">
                      <Skeleton className="w-10 h-10 rounded-lg" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-20 ml-auto" />
                    </div>
                  ))
                ) : (
                  launchpads?.map((item, i) => (
                    <div key={i} className="p-4 flex items-center gap-4 hover:bg-white/5 transition-colors" data-testid={`launchpad-${i}`}>
                      <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center">
                        <Rocket className="w-5 h-5 text-pink-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{item.symbol}</span>
                          <Badge variant="outline" className="text-[10px]">{item.platform}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{item.name}</p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-sm">
                          <Users className="w-3 h-3 text-muted-foreground" />
                          {item.holders}
                        </div>
                        <p className="text-xs text-muted-foreground">{item.liquidity}</p>
                      </div>
                      <div className="text-right">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${item.bondingCurve >= 80 ? "bg-green-500" : item.bondingCurve >= 50 ? "bg-yellow-500" : "bg-primary"}`}
                            style={{ width: `${item.bondingCurve}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{item.bondingCurve}% bonded</p>
                      </div>
                      <Badge className={item.status === "graduated" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}>
                        {item.status}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="whales" className="mt-4">
            <Card className="bg-card/60 backdrop-blur overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold">Recent Whale Activity</h3>
                <Link href="/whalewatch">
                  <Button variant="ghost" size="sm" data-testid="button-view-all-whales">View All</Button>
                </Link>
              </div>
              <div className="divide-y divide-border">
                {alertsLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <div key={i} className="p-4 flex items-center gap-4">
                      <Skeleton className="w-10 h-10 rounded-lg" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-20 ml-auto" />
                    </div>
                  ))
                ) : (
                  whaleAlerts?.slice(0, 5).map((alert, i) => (
                    <div key={i} className="p-4 flex items-center gap-4 hover:bg-white/5 transition-colors" data-testid={`whale-alert-${i}`}>
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${alert.type === "BUY" ? "bg-green-500/10" : "bg-red-500/10"}`}>
                        {alert.type === "BUY" ? <ArrowUpRight className="w-5 h-5 text-green-500" /> : <ArrowDownRight className="w-5 h-5 text-red-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{alert.tokenSymbol}</span>
                          <Badge className={alert.type === "BUY" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}>
                            {alert.type}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{alert.walletLabel}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm">{alert.amount}</p>
                        <p className="text-xs text-muted-foreground">@ {alert.price}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-card/60 backdrop-blur overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-500" />
                Hot Memecoins
              </h3>
              <Link href="/memetrend">
                <Button variant="ghost" size="sm" data-testid="button-view-memetrend">View All</Button>
              </Link>
            </div>
            <div className="divide-y divide-border">
              {trendingLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <div key={i} className="p-4 flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </div>
                ))
              ) : (
                trendingCoins?.slice(0, 5).map((coin, i) => (
                  <div key={coin.id} className="p-4 flex items-center gap-4 hover:bg-white/5 transition-colors" data-testid={`trending-coin-${i}`}>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center font-bold">
                      {coin.symbol.replace("$", "").charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{coin.symbol}</span>
                        {coin.trend === "UP" && <TrendingUp className="w-4 h-4 text-green-400" />}
                        {coin.trend === "DOWN" && <TrendingDown className="w-4 h-4 text-red-400" />}
                      </div>
                      <p className="text-sm text-muted-foreground">{coin.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono">${coin.price}</p>
                      <p className="text-xs text-muted-foreground">{coin.volume24h}</p>
                    </div>
                    <div className="w-12 text-center">
                      <div className={`text-sm font-bold ${coin.hypeScore >= 80 ? "text-green-400" : coin.hypeScore >= 60 ? "text-yellow-400" : "text-muted-foreground"}`}>
                        {coin.hypeScore}
                      </div>
                      <p className="text-[10px] text-muted-foreground">HYPE</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="bg-card/60 backdrop-blur">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-green-500" />
                Quick Scan
              </h3>
            </div>
            <div className="p-6 text-center">
              <p className="text-muted-foreground mb-4">Check any token's safety score instantly</p>
              <Link href="/rugshield">
                <Button className="w-full" data-testid="button-scan-token">
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Scan a Token
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
