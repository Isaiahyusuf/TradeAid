import { ArrowDownRight, ArrowUpRight, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { type SafeBuyItem } from "@/hooks/use-safe-buy";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";

function formatNumber(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function SafeBuyCard({ item }: { item: SafeBuyItem }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [amountSol, setAmountSol] = useState("0.1");
  const scoreTone = item.safety_score >= 85 ? "text-green-400 border-green-400/40" : item.safety_score >= 75 ? "text-primary border-primary/40" : "text-yellow-400 border-yellow-400/40";
  const riskTone = item.risk_level === "Low" ? "text-green-400 border-green-400/40" : item.risk_level === "Medium" ? "text-yellow-400 border-yellow-400/40" : "text-red-400 border-red-400/40";

  const handleDirectBuy = () => {
    const requestedChain = String(item.chain || "solana").trim().toLowerCase();
    const params = new URLSearchParams();
    params.set("action", "buy");
    params.set("chain", requestedChain || "solana");
    params.set("contract", item.contract_address);
    params.set("amount", String(amountSol || "0.1"));
    setLocation(`/doctortrade?${params.toString()}`);
    toast({ title: "Direct Buy Ready", description: "Redirected to DoctorTrade using your connected Doctor wallet." });
  };

  return (
    <Card
      className={cn(
        "bg-card/60 backdrop-blur border-border/70 transition-all duration-300 hover:-translate-y-0.5 hover-elevate animate-in fade-in-0 max-h-[calc(100vh-8rem)] overflow-hidden flex flex-col",
        item.safety_score >= 85 && "border-green-400/50 shadow-[0_0_24px_rgba(34,197,94,0.15)]"
      )}
      data-testid={`safe-buy-card-${item.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
              {item.logo_url ? (
                <img src={item.logo_url} alt={item.symbol || item.name || "token logo"} className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg truncate">{item.symbol || item.name || "Unknown"}</CardTitle>
              <p className="text-xs text-muted-foreground truncate">{item.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {item.recently_added && <Badge variant="secondary">Recently Added</Badge>}
            <Badge variant="outline" className={scoreTone}>Safety {item.safety_score.toFixed(0)}</Badge>
            <Badge variant="outline" className={riskTone}>{item.risk_level}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 overflow-y-auto scroll-smooth flex-1">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div><p className="text-muted-foreground">Market Cap</p><p className="font-medium">{formatNumber(item.market_cap_usd)}</p></div>
          <div><p className="text-muted-foreground">Liquidity</p><p className="font-medium">{formatNumber(item.liquidity_usd)}</p></div>
          <div><p className="text-muted-foreground">Volume 5m</p><p className="font-medium">{formatNumber(item.volume_5m)}</p></div>
          <div><p className="text-muted-foreground">Volume 1h</p><p className="font-medium">{formatNumber(item.volume_1h)}</p></div>
          <div><p className="text-muted-foreground">Holders</p><p className="font-medium">{item.holder_count.toLocaleString()}</p></div>
          <div><p className="text-muted-foreground">Buy/Sell</p><p className="font-medium">{(item.buy_sell_ratio ?? 0).toFixed(2)}</p></div>
          <div><p className="text-muted-foreground">Top Holders</p><p className="font-medium">{(item.top_holders_pct ?? 0).toFixed(2)}%</p></div>
          <div><p className="text-muted-foreground">Dev Wallet</p><p className="font-medium">{(item.dev_wallet_pct ?? 0).toFixed(2)}%</p></div>
          <div><p className="text-muted-foreground">Wallet Growth</p><p className="font-medium">{(item.wallet_growth_rate ?? 0).toFixed(0)}</p></div>
          <div><p className="text-muted-foreground">Source</p><p className="font-medium capitalize">{item.source_platform ?? "-"}</p></div>
          <div><p className="text-muted-foreground">Chain</p><p className="font-medium uppercase">{item.chain}</p></div>
          <div>
            <p className="text-muted-foreground">Safety Trend</p>
            <p className="font-medium flex items-center gap-1">
              {item.trend === "up" ? <ArrowUpRight className="w-4 h-4 text-green-400" /> : item.trend === "down" ? <ArrowDownRight className="w-4 h-4 text-red-400" /> : <span className="text-muted-foreground">•</span>}
              {item.trend === "up" ? "Improving" : item.trend === "down" ? "Declining" : "Stable"}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/20 p-2">
          <p className="text-[11px] text-muted-foreground">Contract</p>
          <p className="text-xs font-mono break-all">{item.contract_address}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground leading-relaxed">{item.short_summary}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{item.recommendation}</Badge>
            <Badge variant="outline">Confidence {item.confidence_score.toFixed(0)}</Badge>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 -mx-2 px-2 py-2 bg-card/95 backdrop-blur border-t border-border/60">
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2">
            <Input
              value={amountSol}
              onChange={(event) => setAmountSol(event.target.value)}
              className="h-9 w-24"
              inputMode="decimal"
              placeholder="0.1"
              aria-label="SOL amount"
            />
            <Button size="sm" onClick={handleDirectBuy}>Direct Buy</Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => window.open(item.buy_links.pump_fun || `https://pump.fun/coin/${item.contract_address}`, "_blank")}>Buy on Pump.fun <ExternalLink className="w-3 h-3 ml-1" /></Button>
            <Button size="sm" variant="outline" onClick={() => window.open(item.buy_links.raydium, "_blank")}>Buy on Raydium <ExternalLink className="w-3 h-3 ml-1" /></Button>
            <Button size="sm" variant="outline" onClick={() => window.open(item.buy_links.jupiter, "_blank")}>Buy on Jupiter <ExternalLink className="w-3 h-3 ml-1" /></Button>
            <Button size="sm" variant="outline" onClick={() => setLocation(`/rugshield?address=${encodeURIComponent(item.contract_address)}&auto=1`)}>Analyze in RugShield</Button>
            <Button size="sm" variant="outline" onClick={() => window.open(item.buy_links.dexscreener, "_blank")}>View DexScreener <ExternalLink className="w-3 h-3 ml-1" /></Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(item.contract_address);
                toast({ title: "Copied", description: "Contract address copied" });
              }}
            >
              Copy Contract <Copy className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
