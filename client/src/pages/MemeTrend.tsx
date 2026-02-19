import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useTokens, useTokenStats, type TokenItem } from "@/hooks/use-memetrend";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, TrendingUp, Activity, Shield, ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SiSolana, SiEthereum } from "react-icons/si";

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
    case "bnb":
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

export default function MemeTrend() {
  const [chain, setChain] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: tokenData, isLoading } = useTokens(chain);
  const { data: stats } = useTokenStats();

  const tokens = tokenData?.tokens || [];
  const filteredTokens = searchQuery
    ? tokens.filter((t) => {
        const q = searchQuery.toLowerCase();
        return (
          (t.name || "").toLowerCase().includes(q) ||
          (t.symbol || "").toLowerCase().includes(q) ||
          t.contract_address.toLowerCase().includes(q)
        );
      })
    : tokens;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold" data-testid="text-page-title">Token Explorer</h1>
          <p className="text-muted-foreground">Browse and search tokens across all supported chains.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Tokens</p>
                <p className="text-2xl font-bold">{stats?.total_tokens || 0}</p>
              </div>
            </div>
          </Card>
          {stats?.by_chain && Object.entries(stats.by_chain).slice(0, 3).map(([ch, count]) => (
            <Card key={ch} className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <ChainIcon chain={ch} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground capitalize">{ch}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <Select value={chain || "all"} onValueChange={(v) => setChain(v === "all" ? undefined : v)}>
              <SelectTrigger className="w-full md:w-40" data-testid="select-chain-filter">
                <SelectValue placeholder="All Chains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Chains</SelectItem>
                <SelectItem value="solana">Solana</SelectItem>
                <SelectItem value="ethereum">Ethereum</SelectItem>
                <SelectItem value="bsc">BSC</SelectItem>
                <SelectItem value="base">Base</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search by name, symbol, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-tokens"
              />
            </div>
          </div>
        </Card>

        <div className="space-y-2">
          {isLoading ? (
            Array(8).fill(0).map((_, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              </Card>
            ))
          ) : filteredTokens.length === 0 ? (
            <Card className="p-12 text-center">
              <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
              <p className="text-muted-foreground">No tokens found.</p>
            </Card>
          ) : (
            filteredTokens.map((token) => (
              <Card key={token.id} className="p-4 hover-elevate" data-testid={`token-card-${token.id}`}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <ChainIcon chain={token.chain} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{token.symbol || "Unknown"}</span>
                      <span className="text-sm text-muted-foreground">{token.name}</span>
                      <Badge variant="outline" className="text-[10px]">{token.chain}</Badge>
                      {token.is_ownership_renounced && (
                        <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/30">
                          <ShieldCheck className="w-3 h-3 mr-1" /> Renounced
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
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
