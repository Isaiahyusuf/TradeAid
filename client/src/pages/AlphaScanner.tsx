import { useState, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTokens, useTokenStats, type TokenItem } from "@/hooks/use-memetrend";
import { useScanToken, type ScoreResult } from "@/hooks/use-rugcheck";
import { 
  Search, TrendingUp, Shield, ShieldCheck,
  RefreshCw, AlertTriangle, Activity,
  Loader2, Radar, Eye
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SiSolana, SiEthereum } from "react-icons/si";
import { Link } from "wouter";

function ChainIcon({ chain }: { chain: string }) {
  const key = String(chain || "").toLowerCase();
  switch (key) {
    case "solana":
    case "sol":
      return <SiSolana className="w-4 h-4 text-[#9945FF]" />;
    case "ethereum":
    case "eth":
      return <SiEthereum className="w-4 h-4 text-[#627EEA]" />;
    case "bsc":
      return <div className="w-4 h-4 rounded-full bg-[#F3BA2F] flex items-center justify-center text-black font-bold text-[8px]">B</div>;
    default:
      return <Activity className="w-4 h-4" />;
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

export default function AlphaScanner() {
  const [searchQuery, setSearchQuery] = useState("");
  const [scanAddress, setScanAddress] = useState("");
  const { toast } = useToast();

  const { data: tokenData, isLoading, refetch } = useTokens("solana");
  const { data: stats } = useTokenStats();
  const { mutate: scoreToken, isPending: isScoring, data: scoreResult } = useScanToken();

  const tokens = tokenData?.tokens || [];

  const filteredTokens = useMemo(() => {
    if (!searchQuery) return tokens;
    const q = searchQuery.toLowerCase();
    return tokens.filter((t) =>
      (t.name || "").toLowerCase().includes(q) ||
      (t.symbol || "").toLowerCase().includes(q) ||
      t.contract_address.toLowerCase().includes(q)
    );
  }, [tokens, searchQuery]);

  const handleQuickScore = (address: string) => {
    scoreToken(
      { address, chain: "solana" },
      {
        onError: (error) => {
          toast({
            title: "Score failed",
            description: error instanceof Error ? error.message : "Unable to score token",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleScanAddress = () => {
    if (!scanAddress) {
      toast({ title: "Error", description: "Enter a contract address", variant: "destructive" });
      return;
    }
    scoreToken(
      { address: scanAddress, chain: "solana" },
      {
        onError: (error) => {
          toast({
            title: "Score failed",
            description: error instanceof Error ? error.message : "Unable to score token",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-page-title">
              <Radar className="w-8 h-8 text-primary" />
              Alpha Scanner
            </h1>
            <p className="text-muted-foreground mt-1">
              Discover and score tokens in real-time
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Tokens</p>
                <p className="text-2xl font-bold">{stats?.total_tokens || 0}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Chains Active</p>
                <p className="text-2xl font-bold">{Object.keys(stats?.by_chain || {}).length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">On {chain}</p>
                <p className="text-sm text-muted-foreground">On Solana</p>
                <p className="text-2xl font-bold">{tokens.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Radar className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Filtered</p>
                <p className="text-2xl font-bold">{filteredTokens.length}</p>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium text-muted-foreground">Quick Score a Token</p>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="w-full md:w-40 h-10 px-3 border border-input rounded-md bg-muted/40 text-sm flex items-center" data-testid="select-chain">
                Solana
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  placeholder="Enter contract address to score..."
                  value={scanAddress}
                  onChange={(e) => setScanAddress(e.target.value)}
                  className="pl-10"
                  data-testid="input-scan-address"
                />
              </div>
              <Button onClick={handleScanAddress} disabled={isScoring} data-testid="button-score-token">
                {isScoring ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
                {isScoring ? "Scoring..." : "Score"}
              </Button>
            </div>
          </div>
        </Card>

        {scoreResult && (
          <Card className="p-6 border-primary/30">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Score Result
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className={cn(
                  "text-2xl font-bold",
                  scoreResult.trade_confidence_index > 0.7 ? "text-green-400" : scoreResult.trade_confidence_index > 0.4 ? "text-yellow-400" : "text-red-400"
                )}>
                  {(scoreResult.trade_confidence_index * 100).toFixed(0)}
                </div>
                <p className="text-xs text-muted-foreground">Confidence</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className={cn("text-2xl font-bold", scoreResult.rug_probability < 0.3 ? "text-green-400" : "text-red-400")}>
                  {(scoreResult.rug_probability * 100).toFixed(0)}%
                </div>
                <p className="text-xs text-muted-foreground">Rug Risk</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold">{(scoreResult.liquidity_stability * 100).toFixed(0)}%</div>
                <p className="text-xs text-muted-foreground">Liquidity</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold">{(scoreResult.holder_distribution * 100).toFixed(0)}%</div>
                <p className="text-xs text-muted-foreground">Distribution</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <Badge className={cn(
                  scoreResult.eligible ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                )}>
                  {scoreResult.eligible ? "Eligible" : "Not Eligible"}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">{scoreResult.eligibility_reason || "Status"}</p>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-4">
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
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <Card key={i} className="p-4">
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
          ) : filteredTokens.length === 0 ? (
            <Card className="p-12 text-center">
              <Radar className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
              <p className="text-lg text-muted-foreground">No tokens found on Solana</p>
              <p className="text-sm text-muted-foreground">Try changing the chain or scanning a token address above.</p>
            </Card>
          ) : (
            filteredTokens.map((token) => (
              <Card key={token.id} className="p-4 hover-elevate" data-testid={`scanner-token-${token.id}`}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0">
                    <ChainIcon chain={token.chain} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{token.symbol || "???"}</span>
                      <span className="text-sm text-muted-foreground hidden sm:inline">{token.name}</span>
                      <Badge variant="outline" className="text-[10px]">{token.chain}</Badge>
                      {token.latest_score && (
                        <Badge variant="outline" className="text-[10px]">
                          Score {normalizePct(token.latest_score.trade_confidence_index).toFixed(0)}
                        </Badge>
                      )}
                      {token.is_ownership_renounced && (
                        <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/30">
                          <ShieldCheck className="w-3 h-3 mr-1" /> Safe
                        </Badge>
                      )}
                      {token.is_mintable && (
                        <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-400/30">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Mintable
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{token.contract_address}</p>
                  </div>
                  <div className="hidden md:block text-right shrink-0">
                    <p className="font-mono text-sm">{formatNumber(token.market_cap_usd)}</p>
                    <p className="text-xs text-muted-foreground">MCap</p>
                  </div>
                  <div className="hidden md:block text-right shrink-0">
                    <p className="font-mono text-sm">{formatNumber(token.liquidity_usd)}</p>
                    <p className="text-xs text-muted-foreground">Liquidity</p>
                  </div>
                  <div className="hidden lg:block text-right shrink-0">
                    <p className="font-mono text-sm">{token.holder_count.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Holders</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleQuickScore(token.contract_address)}
                    disabled={isScoring}
                    data-testid={`button-score-${token.id}`}
                  >
                    <Shield className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
