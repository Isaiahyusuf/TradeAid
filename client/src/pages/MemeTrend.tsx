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
import { useToast } from "@/hooks/use-toast";
import { useChain } from "@/hooks/use-chain";

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

function normalizePct(value: number) {
  return value > 1 ? value : value * 100;
}

export default function MemeTrend() {
  const { chain, chainLabel } = useChain();
  const [selectedToken, setSelectedToken] = useState<TokenItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: tokenData, isLoading } = useTokens(chain, {
    newOnly: false,
    prioritizePumpFun: true,
    limit: 150,
  });
  const { data: stats } = useTokenStats();
  const { toast } = useToast();

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

  const renderLogo = (token: TokenItem) => {
    if (token.logo_url) {
      return (
        <img
          src={token.logo_url}
          alt={`${token.symbol || token.name || "token"} logo`}
          className="w-10 h-10 rounded-full object-cover border border-border/50"
          onError={(event) => {
            const target = event.currentTarget;
            target.style.display = "none";
          }}
        />
      );
    }
    return null;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-3xl md:text-4xl font-bold" data-testid="text-page-title">Token Explorer</h1>
          <p className="text-muted-foreground">Browse and search tokens on {chainLabel}.</p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge variant="outline" className="solana-badge">Market Map</Badge>
            <Badge variant="outline">{chainLabel}</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Discovery Mode</Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
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
            <Card key={ch} className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
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

        <Card className="p-4 solana-card bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="w-full md:w-40 h-10 px-3 border border-input rounded-md bg-muted/40 text-sm flex items-center" data-testid="select-chain-filter">
              {chainLabel}
            </div>
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

        {selectedToken && (
          <Card className="p-4 solana-card bg-card/70 backdrop-blur-sm border-border/60">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0">
                  {renderLogo(selectedToken) || <ChainIcon chain={selectedToken.chain} />}
                </div>
                <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Selected Token</p>
                <h3 className="text-xl font-semibold">{selectedToken.symbol || selectedToken.name || "Unknown"}</h3>
                <p className="text-xs text-muted-foreground font-mono break-all">{selectedToken.contract_address}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{selectedToken.chain}</Badge>
                <Badge variant="secondary">{formatNumber(selectedToken.market_cap_usd)} MCap</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedToken.contract_address);
                    toast({ title: "Copied", description: "Contract address copied" });
                  }}
                >
                  Copy Address
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-xs">
              <div className="rounded-md border border-border/60 p-2">Price: ${Number(selectedToken.current_price_usd || 0).toLocaleString()}</div>
              <div className="rounded-md border border-border/60 p-2">Liq: {formatNumber(selectedToken.liquidity_usd)}</div>
              <div className="rounded-md border border-border/60 p-2">Vol 1h: {formatNumber(selectedToken.volume_1h)}</div>
              <div className="rounded-md border border-border/60 p-2">Vol 6h: {formatNumber(selectedToken.volume_6h)}</div>
              <div className="rounded-md border border-border/60 p-2">1h: {normalizePct(selectedToken.price_change_1h).toFixed(2)}%</div>
              <div className="rounded-md border border-border/60 p-2">6h: {normalizePct(selectedToken.price_change_6h).toFixed(2)}%</div>
              <div className="rounded-md border border-border/60 p-2">Buys 1h: {selectedToken.buys_1h}</div>
              <div className="rounded-md border border-border/60 p-2">Sells 1h: {selectedToken.sells_1h}</div>
              <div className="rounded-md border border-border/60 p-2">Holders: {selectedToken.holder_count.toLocaleString()}</div>
              <div className="rounded-md border border-border/60 p-2">DEX: {selectedToken.dex_id || "-"}</div>
              <div className="rounded-md border border-border/60 p-2">Source: {selectedToken.source_platform || "-"}</div>
              <div className="rounded-md border border-border/60 p-2">Supply: {selectedToken.total_supply || "-"}</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-xs">
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-muted-foreground mb-1">Deployer</p>
                <p className="font-mono break-all">{selectedToken.deployer_wallet || "-"}</p>
              </div>
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-muted-foreground mb-1">Pair</p>
                <p className="font-mono break-all">{selectedToken.pair_address || "-"}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-2">
              {selectedToken.website_url && (
                <a href={selectedToken.website_url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><ExternalLink className="w-3 h-3 mr-1" /> Website</Button>
                </a>
              )}
              {selectedToken.twitter_url && (
                <a href={selectedToken.twitter_url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><ExternalLink className="w-3 h-3 mr-1" /> X/Twitter</Button>
                </a>
              )}
              {selectedToken.telegram_url && (
                <a href={selectedToken.telegram_url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><ExternalLink className="w-3 h-3 mr-1" /> Telegram</Button>
                </a>
              )}
            </div>

            {selectedToken.description && (
              <div className="mt-2 rounded-md border border-border/60 p-2 text-xs text-muted-foreground">
                {selectedToken.description}
              </div>
            )}
          </Card>
        )}

        <div className="space-y-2">
          {isLoading ? (
            Array(8).fill(0).map((_, i) => (
              <Card key={i} className="p-4 solana-card">
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
            <Card className="p-12 text-center solana-card">
              <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
              <p className="text-muted-foreground">No tokens found.</p>
            </Card>
          ) : (
            filteredTokens.map((token) => (
              <Card
                key={token.id}
                className={cn("p-4 hover-elevate cursor-pointer solana-card", selectedToken?.id === token.id && "border-primary/40")}
                data-testid={`token-card-${token.id}`}
                onClick={() => setSelectedToken(token)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {renderLogo(token) || <ChainIcon chain={token.chain} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{token.symbol || "Unknown"}</span>
                      <span className="text-sm text-muted-foreground">{token.name}</span>
                      <Badge variant="outline" className="text-[10px]">{token.chain}</Badge>
                      {token.latest_score && (
                        <Badge variant="outline" className="text-[10px]">
                          Score {normalizePct(token.latest_score.trade_confidence_index).toFixed(0)}
                        </Badge>
                      )}
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
                    {token.source_platform && (
                      <p className="text-[11px] text-muted-foreground truncate">Source: {token.source_platform}</p>
                    )}
                    <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-1 text-[11px] text-muted-foreground">
                      <span>Price ${Number(token.current_price_usd || 0).toLocaleString()}</span>
                      <span>Liq {formatNumber(token.liquidity_usd || 0)}</span>
                      <span>Vol 1h {formatNumber(token.volume_1h || 0)}</span>
                      <span>1h {normalizePct(token.price_change_1h).toFixed(2)}%</span>
                      <span>Buys {token.buys_1h}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm">{formatNumber(token.market_cap_usd)}</p>
                    <p className="text-xs text-muted-foreground">MCap</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm">{formatNumber(token.liquidity_usd)}</p>
                    <p className="text-xs text-muted-foreground">Liquidity</p>
                  </div>
                  <div className="text-right shrink-0">
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
