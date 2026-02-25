import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Layout } from "@/components/Layout";
import { SafeBuyCard } from "@/components/safe-buy/SafeBuyCard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useSafeBuy } from "@/hooks/use-safe-buy";
import { useScannerStream } from "@/hooks/use-scanner-stream";
import { useChain, SUPPORTED_CHAINS, type AppChain } from "@/hooks/use-chain";
import { SettingsMenuCard } from "@/components/settings/SettingsMenuCard";
import { Dialog, DialogContent } from "@/components/ui/dialog";

function formatNumber(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function SafeBuy() {
  const { chain, setChain } = useChain();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chainFilter, setChainFilter] = useState<string>(chain);
  const [customChains, setCustomChains] = useState("solana,ethereum");
  const [draftChainFilter, setDraftChainFilter] = useState<string>(chain);
  const [draftCustomChains, setDraftCustomChains] = useState("solana,ethereum");
  const parsedCustomChains = customChains
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const { data, isLoading } = useSafeBuy(20, {
    chain: chainFilter,
    chains: parsedCustomChains,
  });

  useScannerStream((event) => {
    const type = String(event?.type || "").toLowerCase();
    if (["new_pair", "score_ready", "score_update", "safe_buy_update"].includes(type)) {
      queryClient.invalidateQueries({ queryKey: ["safe-buy"] });
    }
  });

  const safeTokens = data?.tokens || [];
  const nearMissTokens = data?.near_miss_tokens || [];

  const avgSafety = useMemo(() => {
    if (!safeTokens.length) return 0;
    return safeTokens.reduce((sum, token) => sum + token.safety_score, 0) / safeTokens.length;
  }, [safeTokens]);

  useEffect(() => {
    setChainFilter(chain);
    setDraftChainFilter(chain);
  }, [chain]);

  const applySafeBuySettings = () => {
    setChainFilter(draftChainFilter);
    setCustomChains(draftCustomChains);
    if ((SUPPORTED_CHAINS as readonly string[]).includes(draftChainFilter)) {
      setChain(draftChainFilter as AppChain);
    }
    setSettingsOpen(false);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-safe-buy-title">
              <ShieldCheck className="w-8 h-8 text-primary" />
              🔒 Safe Buy
            </h1>
            <p className="text-muted-foreground">
              AI-filtered multi-chain early tokens with strict safety logic and 30s live refresh.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="solana-badge">Auto Refresh 30s</Badge>
            <Badge variant="outline" className="uppercase">{chainFilter === "all" || chainFilter === "custom" ? chainFilter : chain}</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Min Safety 50</Badge>
            <Badge variant="outline">Risk Low/Medium</Badge>
          </div>
        </div>

        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-lg w-full">
            <SettingsMenuCard
              title="Safe Buy Settings"
              description="Adjust chain scope and custom chain presets. Assistant Trade is only for Solana tokens. Other chains require manual buy."
              open={settingsOpen}
              onToggle={() => setSettingsOpen(false)}
            >
              <div className="max-h-72 overflow-y-auto pr-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Select
                    value={draftChainFilter}
                    onValueChange={(value) => setDraftChainFilter(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select chain scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Chains</SelectItem>
                      <SelectItem value="solana">Solana</SelectItem>
                      <SelectItem value="ethereum">Ethereum</SelectItem>
                      <SelectItem value="bsc">BSC</SelectItem>
                      <SelectItem value="base">Base</SelectItem>
                      <SelectItem value="arbitrum">Arbitrum</SelectItem>
                      <SelectItem value="avalanche">Avalanche</SelectItem>
                      <SelectItem value="polygon">Polygon</SelectItem>
                      <SelectItem value="custom">Custom (comma separated)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={draftCustomChains}
                    onChange={(event) => setDraftCustomChains(event.target.value)}
                    placeholder="solana,ethereum,bsc"
                    disabled={draftChainFilter !== "custom"}
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button variant="outline" onClick={applySafeBuySettings}>Apply Settings</Button>
                </div>
              </div>
            </SettingsMenuCard>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <p className="text-sm text-muted-foreground">Safe Tokens</p>
            <p className="text-2xl font-bold">{safeTokens.length}</p>
          </Card>
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <p className="text-sm text-muted-foreground">Average Safety</p>
            <p className="text-2xl font-bold">{avgSafety.toFixed(0)}</p>
          </Card>
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <p className="text-sm text-muted-foreground">Highest Safety</p>
            <p className="text-2xl font-bold">{safeTokens.length ? Math.max(...safeTokens.map((token) => token.safety_score)).toFixed(0) : "0"}</p>
          </Card>
          <Card className="p-4 solana-card animate-fade-in-up bg-card/70 backdrop-blur-sm border-border/60">
            <p className="text-sm text-muted-foreground">Total 1h Volume</p>
            <p className="text-2xl font-bold">{formatNumber(safeTokens.reduce((sum, token) => sum + token.volume_1h, 0))}</p>
          </Card>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {Array(6).fill(0).map((_, index) => (
              <Card key={index} className="p-4">
                <div className="space-y-3">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              </Card>
            ))}
          </div>
        ) : safeTokens.length === 0 ? (
          <Card className="p-12 text-center solana-card">
            <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
            <p className="text-lg font-medium">No Safe Buy candidates right now</p>
            <p className="text-sm text-muted-foreground mt-2">
              The engine is actively filtering tokens and will auto-add only high-confidence early-stage opportunities.
            </p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {safeTokens.map((item) => (
                <SafeBuyCard key={item.id} item={item} />
              ))}
            </div>

            {nearMissTokens.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Near Miss (40-49)</h2>
                  <Badge variant="outline">Monitor Zone</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  These tokens narrowly missed Safe Buy criteria and may qualify soon if quality improves.
                </p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {nearMissTokens.map((item) => (
                    <SafeBuyCard key={`near-${item.id}`} item={item} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
