import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useTokens, useTokenStats } from "@/hooks/use-memetrend";
import { useAlerts } from "@/hooks/use-alerts";
import { 
  TrendingUp, Activity, Eye, ShieldCheck,
  ArrowUpRight, ArrowDownRight, Bell
} from "lucide-react";
import { SiSolana, SiEthereum } from "react-icons/si";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

export default function Dashboard() {
  const { user } = useAuth();
  const { data: tokenData, isLoading: tokensLoading } = useTokens();
  const { data: stats, isLoading: statsLoading } = useTokenStats();
  const { data: alertData, isLoading: alertsLoading } = useAlerts();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-welcome">
              Welcome back{user?.username ? `, ${user.username}` : ""}
            </h1>
            <p className="text-muted-foreground">Your trading command center</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 bg-card/60 backdrop-blur">
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
          <Card className="p-4 bg-card/60 backdrop-blur">
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
          <Card className="p-4 bg-card/60 backdrop-blur">
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
          <Card className="p-4 bg-card/60 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recent Tokens</p>
                <p className="text-2xl font-bold">
                  {tokensLoading ? <Skeleton className="h-7 w-12" /> : (tokenData?.count || 0)}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {stats?.by_chain && Object.keys(stats.by_chain).length > 0 && (
          <Card className="bg-card/60 backdrop-blur p-4">
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
          <Card className="bg-card/60 backdrop-blur overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between gap-2">
              <h3 className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                Recent Tokens
              </h3>
              <Link href="/memetrend">
                <Button variant="ghost" size="sm" data-testid="button-view-all-tokens">View All</Button>
              </Link>
            </div>
            <div className="divide-y divide-border">
              {tokensLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <div key={i} className="p-4 flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </div>
                ))
              ) : (
                tokenData?.tokens?.slice(0, 5).map((token) => (
                  <div key={token.id} className="p-4 flex items-center gap-4 hover-elevate" data-testid={`token-row-${token.id}`}>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center font-bold">
                      <ChainIcon chain={token.chain} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{token.symbol || token.name || "Unknown"}</span>
                        <Badge variant="outline" className="text-[10px]">{token.chain}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{token.contract_address.slice(0, 12)}...</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-sm">{formatNumber(token.market_cap_usd)}</p>
                      <p className="text-xs text-muted-foreground">MCap</p>
                    </div>
                  </div>
                ))
              )}
              {!tokensLoading && (!tokenData?.tokens || tokenData.tokens.length === 0) && (
                <div className="p-8 text-center text-muted-foreground">
                  No tokens found yet. Start scanning!
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
                alertData?.alerts?.slice(0, 5).map((alert) => (
                  <div key={alert.id} className="p-4 flex items-center gap-4 hover-elevate" data-testid={`alert-row-${alert.id}`}>
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{alert.title}</span>
                        <Badge variant="outline" className={cn(
                          "text-[10px]",
                          alert.severity === "high" ? "text-red-400 border-red-400/30" : "text-yellow-400 border-yellow-400/30"
                        )}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{alert.message}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{alert.chain}</Badge>
                  </div>
                ))
              )}
              {!alertsLoading && (!alertData?.alerts || alertData.alerts.length === 0) && (
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
