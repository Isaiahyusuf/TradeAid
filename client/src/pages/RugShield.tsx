import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import { useDexProjectInfo, useDevIntel, useScanToken, useScannerHealth, type ScoreResult } from "@/hooks/use-rugcheck";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, AlertTriangle, CheckCircle2, Search, TrendingUp, Activity, Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useChain, SUPPORTED_CHAINS, type AppChain } from "@/hooks/use-chain";

function ScoreGauge({ value, label }: { value: number; label: string }) {
  const getColor = () => {
    if (value >= 70) return "text-green-400 border-green-500";
    if (value >= 40) return "text-yellow-400 border-yellow-500";
    return "text-red-400 border-red-500";
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={cn(
        "w-16 h-16 rounded-full border-4 flex items-center justify-center text-lg font-bold bg-black/30",
        getColor()
      )}>
        {(value * 100).toFixed(0)}
      </div>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}

export default function RugShield() {
  const { chain, chainLabel, setChain } = useChain();
  const [address, setAddress] = useState("");
  const [scannedAddress, setScannedAddress] = useState("");
  const [detectedChain, setDetectedChain] = useState<string | null>(null);
  const didAutoScan = useRef(false);
  const { mutate: scanToken, isPending, data: result } = useScanToken();
  const { data: devIntel } = useDevIntel(scannedAddress || undefined, chain);
  const { data: dexProjectInfo } = useDexProjectInfo(scannedAddress || undefined, chain);
  const scannerHealth = useScannerHealth();
  const { toast } = useToast();

  useEffect(() => {
    if (didAutoScan.current) return;
    const params = new URLSearchParams(window.location.search);
    const prefilledAddress = String(params.get("address") || "").trim();
    const prefilledChain = String(params.get("chain") || "").trim().toLowerCase();
    const auto = params.get("auto") === "1";

    if ((SUPPORTED_CHAINS as readonly string[]).includes(prefilledChain)) {
      setChain(prefilledChain as AppChain);
    }

    if (!prefilledAddress) {
      didAutoScan.current = true;
      return;
    }

    setAddress(prefilledAddress);
    if (auto) {
      setScannedAddress(prefilledAddress);
      const scanChain = ((SUPPORTED_CHAINS as readonly string[]).includes(prefilledChain) ? prefilledChain : chain);
      scanToken(
        { address: prefilledAddress, chain: scanChain },
        {
          onError: (error) => {
            const message = error instanceof Error ? error.message : "Unable to score token";
            toast({
              title: "Scan failed",
              description: message,
              variant: "destructive",
            });
          },
        }
      );
    }

    didAutoScan.current = true;
  }, [chain, scanToken, setChain, toast]);

  useEffect(() => {
    if (chain !== "all") {
      setDetectedChain(null);
      return;
    }
    const resolved = String(result?.chain || "").trim().toLowerCase();
    if (!resolved || resolved === "all") {
      setDetectedChain(null);
      return;
    }
    if ((SUPPORTED_CHAINS as readonly string[]).includes(resolved)) {
      setDetectedChain(resolved);
      return;
    }
    setDetectedChain(null);
  }, [chain, result?.chain]);

  const handleScan = () => {
    if (!address) {
      toast({ title: "Error", description: "Please enter a contract address", variant: "destructive" });
      return;
    }
    setScannedAddress(address.trim());
    scanToken(
      { address, chain },
      {
        onError: (error) => {
          const message = error instanceof Error ? error.message : "Unable to score token";
          toast({
            title: "Scan failed",
            description: message,
            variant: "destructive",
          });
        },
      }
    );
  };

  const getOverallScore = (r: ScoreResult) => {
    return Math.round(r.trade_confidence_index * 100);
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-green-500 border-green-500";
    if (score >= 40) return "text-yellow-500 border-yellow-500";
    return "text-red-500 border-red-500";
  };

  const getCommunityStatusClasses = (status?: string) => {
    if (status === "active") return "bg-green-500/20 text-green-400";
    if (status === "moderate") return "bg-yellow-500/20 text-yellow-400";
    return "bg-red-500/20 text-red-400";
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl md:text-4xl font-bold" data-testid="text-page-title">Token Risk Scanner</h1>
          <p className="text-muted-foreground">Score any {chainLabel} token for rug risk, liquidity stability, and trade confidence.</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="solana-badge">Risk Matrix</Badge>
            <Badge variant="outline">{chainLabel}</Badge>
            <Badge variant="outline" className="border-accent/30 text-accent">Safety Focused</Badge>
            {detectedChain && (
              <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                Detected: {detectedChain === "bsc" ? "BNB Chain" : detectedChain}
              </Badge>
            )}
          </div>
        </div>

        <Card className="p-6 solana-card bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex flex-col md:flex-row gap-4">
            <Select value={chain} onValueChange={(value) => setChain(value as AppChain)}>
              <SelectTrigger className="w-full md:w-44" data-testid="select-chain">
                <SelectValue placeholder={chainLabel} />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CHAINS.map((item) => (
                  <SelectItem key={item} value={item} className="capitalize">
                    {item === "all" ? "All Chains" : item === "bsc" ? "BNB Chain" : item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Enter contract address..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="pl-10"
                data-testid="input-token-address"
              />
            </div>
            <Button 
              onClick={handleScan} 
              disabled={isPending}
              data-testid="button-scan-token"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
              {isPending ? "Scoring..." : "Score Token"}
            </Button>
            {chain === "all" && detectedChain && (
              <Button
                variant="outline"
                onClick={() => {
                  setChain(detectedChain as AppChain);
                  toast({ title: "Chain applied", description: `Switched to ${detectedChain}.` });
                }}
              >
                Use Detected Chain
              </Button>
            )}
          </div>
        </Card>

        <Card className="p-4 solana-card bg-card/70 backdrop-blur-sm border-border/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold">Scanner Health</p>
            <Badge variant="outline" className={scannerHealth.data?.running ? "border-green-500/40 text-green-400" : "border-yellow-500/40 text-yellow-300"}>
              {scannerHealth.data?.running ? "Running" : "Idle"}
            </Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">New Pairs Found</p>
              <p className="font-semibold">{scannerHealth.data?.candidatesDiscovered ?? 0}</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">Processed</p>
              <p className="font-semibold">{scannerHealth.data?.candidatesProcessed ?? 0}</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">Liquidity &gt; 0</p>
              <p className="font-semibold">{scannerHealth.data?.liquidityPositiveRatePct?.toFixed(1) ?? "0.0"}%</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">Last Dex Sync</p>
              <p className="font-semibold">{scannerHealth.data?.lastScanAt ? new Date(scannerHealth.data.lastScanAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Successful scans: {scannerHealth.data?.successfulScans ?? 0} · New tokens saved: {scannerHealth.data?.newTokensSaved ?? 0} · Cycle: {scannerHealth.data?.cycleCount ?? 0}
          </p>
        </Card>

        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="solana-card animate-fade-in-up">
              <CardHeader>
                <CardTitle className="text-center text-muted-foreground text-sm uppercase tracking-wider">Trade Confidence</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-6">
                <div className={cn(
                  "w-32 h-32 rounded-full border-8 flex items-center justify-center text-4xl font-bold bg-black/30",
                  getScoreColor(getOverallScore(result))
                )}>
                  {getOverallScore(result)}
                </div>
                <div className="mt-4 text-center">
                  <Badge className={cn(
                    result.status === "indexing"
                      ? "bg-blue-500/20 text-blue-400"
                      : result.status === "dex_live"
                      ? "bg-cyan-500/20 text-cyan-300"
                      : result.eligible 
                      ? "bg-green-500/20 text-green-400" 
                      : "bg-red-500/20 text-red-400"
                  )}>
                    {result.status === "indexing"
                      ? "Indexing Token"
                      : result.status === "dex_live"
                      ? "Dex Live Data"
                      : result.eligible
                      ? "Eligible"
                      : "Not Eligible"}
                  </Badge>
                  {result.eligibility_reason && (
                    <p className="text-xs text-muted-foreground mt-2">{result.eligibility_reason}</p>
                  )}
                  {result.chain && (
                    <p className="text-xs text-muted-foreground mt-1">Resolved chain: {result.chain}</p>
                  )}
                  {!!result.risk_flags?.length && (
                    <p className="text-xs text-muted-foreground mt-2">Flags: {result.risk_flags.slice(0, 3).join(", ")}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="solana-card md:col-span-2 animate-fade-in-up">
              <CardHeader>
                <CardTitle>Risk Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <ScoreGauge value={1 - result.rug_probability} label="Rug Safety" />
                  <ScoreGauge value={result.liquidity_stability} label="Liquidity" />
                  <ScoreGauge value={result.holder_distribution} label="Distribution" />
                  <ScoreGauge value={result.smart_wallet_signal} label="Smart Wallets" />
                </div>

                <div className="mt-6 space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                    {result.rug_probability < 0.3 ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                    )}
                    <div>
                      <p className="font-medium text-sm">Rug Probability</p>
                      <p className="text-xs text-muted-foreground">
                        {(result.rug_probability * 100).toFixed(1)}% chance of rug pull
                      </p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                    {result.liquidity_stability > 0.6 ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />
                    )}
                    <div>
                      <p className="font-medium text-sm">Liquidity Stability</p>
                      <p className="text-xs text-muted-foreground">
                        {(result.liquidity_stability * 100).toFixed(1)}% stability score
                      </p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-blue-500 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">Smart Wallet Activity</p>
                      <p className="text-xs text-muted-foreground">
                        {(result.smart_wallet_signal * 100).toFixed(1)}% smart wallet signal
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {(dexProjectInfo?.project_info || (devIntel && !('error' in (devIntel as any)))) && (
              <Card className="solana-card md:col-span-3 animate-fade-in-up">
                <CardHeader>
                  <CardTitle>Developer Rug + Jeet Intelligence</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {dexProjectInfo?.project_info && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground">DexScreener Project Info</p>
                        {dexProjectInfo.project_info.community_checker && (
                          <Badge className={cn(getCommunityStatusClasses(dexProjectInfo.project_info.community_checker.overall_status))}>
                            Community {dexProjectInfo.project_info.community_checker.overall_status.toUpperCase()} · {dexProjectInfo.project_info.community_checker.activity_score.toFixed(0)}/100
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="p-3 rounded-lg bg-muted/50"><p className="text-xs text-muted-foreground">Chain</p><p className="text-sm font-semibold capitalize">{dexProjectInfo.project_info.chain}</p></div>
                        <div className="p-3 rounded-lg bg-muted/50"><p className="text-xs text-muted-foreground">DEX</p><p className="text-sm font-semibold">{dexProjectInfo.project_info.dex_id || "unknown"}</p></div>
                        <div className="p-3 rounded-lg bg-muted/50"><p className="text-xs text-muted-foreground">Liquidity</p><p className="text-sm font-semibold">${Number(dexProjectInfo.project_info.liquidity_usd || 0).toLocaleString()}</p></div>
                        <div className="p-3 rounded-lg bg-muted/50"><p className="text-xs text-muted-foreground">Market Cap</p><p className="text-sm font-semibold">${Number(dexProjectInfo.project_info.market_cap_usd || 0).toLocaleString()}</p></div>
                      </div>
                    </div>
                  )}

                  {devIntel && !('error' in (devIntel as any)) && (
                    <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Rug Dev Flag</p>
                      <p className={cn("text-sm font-semibold", devIntel.rug_profile.is_rug_dev ? "text-red-400" : "text-green-400")}>{devIntel.rug_profile.is_rug_dev ? "Likely Rug Operator" : "No Strong Rug Pattern"}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Linked Launches</p>
                      <p className="text-sm font-semibold">{devIntel.rug_profile.linked_launches}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Typical Rug MC</p>
                      <p className="text-sm font-semibold">${devIntel.rug_profile.typical_rug_mcap_usd.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Jeet Pressure</p>
                      <p className={cn("text-sm font-semibold", devIntel.jeet_checker.too_many_jeets ? "text-red-400" : "text-green-400")}>{devIntel.jeet_checker.too_many_jeets ? "Too Many Jeets" : "Normal"}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-muted/40">
                      <p className="text-xs text-muted-foreground">Link Method</p>
                      <p className="text-sm">{devIntel.identity.link_method}</p>
                      <p className="text-xs text-muted-foreground mt-1">Linked wallets: {devIntel.identity.linked_wallet_count}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/40">
                      <p className="text-xs text-muted-foreground">Rug Ratio + Jeet Ratio</p>
                      <p className="text-sm">Rug ratio: {devIntel.rug_profile.rug_ratio_pct.toFixed(1)}%</p>
                      <p className="text-sm">High-jeet ratio: {devIntel.jeet_checker.high_jeet_ratio_pct.toFixed(1)}%</p>
                    </div>
                  </div>

                  {devIntel.project_info && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground">Project Info</p>
                        {devIntel.project_info.community_checker && (
                          <Badge className={cn(getCommunityStatusClasses(devIntel.project_info.community_checker.overall_status))}>
                            Community {devIntel.project_info.community_checker.overall_status.toUpperCase()} · {devIntel.project_info.community_checker.activity_score.toFixed(0)}/100
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-muted/40 space-y-2">
                          <p className="text-xs text-muted-foreground">Social Links</p>
                          <div className="flex flex-wrap gap-2">
                            {devIntel.project_info.social_links?.x && (
                              <a href={devIntel.project_info.social_links.x} target="_blank" rel="noreferrer" className="inline-flex">
                                <Badge variant="outline" className="hover:border-primary/50">X <ExternalLink className="w-3 h-3 ml-1" /></Badge>
                              </a>
                            )}
                            {devIntel.project_info.social_links?.telegram && (
                              <a href={devIntel.project_info.social_links.telegram} target="_blank" rel="noreferrer" className="inline-flex">
                                <Badge variant="outline" className="hover:border-primary/50">Telegram <ExternalLink className="w-3 h-3 ml-1" /></Badge>
                              </a>
                            )}
                            {devIntel.project_info.social_links?.discord && (
                              <a href={devIntel.project_info.social_links.discord} target="_blank" rel="noreferrer" className="inline-flex">
                                <Badge variant="outline" className="hover:border-primary/50">Discord <ExternalLink className="w-3 h-3 ml-1" /></Badge>
                              </a>
                            )}
                            {(!devIntel.project_info.social_links?.x && !devIntel.project_info.social_links?.telegram && !devIntel.project_info.social_links?.discord) && (
                              <p className="text-xs text-muted-foreground">No X, Telegram, or Discord links detected.</p>
                            )}
                          </div>

                          {devIntel.project_info.websites && devIntel.project_info.websites.length > 0 && (
                            <div className="pt-1">
                              <p className="text-xs text-muted-foreground mb-1">Websites</p>
                              <div className="flex flex-wrap gap-2">
                                {devIntel.project_info.websites.slice(0, 3).map((url) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex">
                                    <Badge variant="outline" className="hover:border-primary/50">Website <ExternalLink className="w-3 h-3 ml-1" /></Badge>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {devIntel.project_info.community_checker && (
                          <div className="p-3 rounded-lg bg-muted/40 space-y-2">
                            <p className="text-xs text-muted-foreground">Community Checker</p>
                            <p className="text-sm">{devIntel.project_info.community_checker.summary}</p>
                            <div className="flex flex-wrap gap-2">
                              {devIntel.project_info.community_checker.platforms.map((platform) => (
                                <Badge
                                  key={platform.platform}
                                  variant="outline"
                                  className={cn(
                                    platform.is_active && "border-green-500/40 text-green-400",
                                    !platform.available && "border-border/40 text-muted-foreground",
                                    platform.available && !platform.is_active && "border-yellow-500/40 text-yellow-400"
                                  )}
                                >
                                  {platform.platform.toUpperCase()} · {platform.status}
                                </Badge>
                              ))}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              1h Volume ${devIntel.project_info.community_checker.signals.volume_1h.toLocaleString()} · Trades 5m {devIntel.project_info.community_checker.signals.trades_5m.toFixed(0)} · Trades 1h {devIntel.project_info.community_checker.signals.trades_1h.toFixed(0)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Past linked launches</p>
                    <div className="space-y-2 max-h-56 overflow-auto pr-1">
                      {devIntel.past_launches.slice(0, 8).map((launch) => (
                        <div key={launch.contract_address} className="p-2 rounded border border-border/60 bg-card/40">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{launch.symbol || launch.name || launch.contract_address}</p>
                            <p className="text-xs text-muted-foreground">${Number(launch.market_cap_usd || 0).toLocaleString()}</p>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{launch.contract_address}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {!result && !isPending && (
          <Card className="solana-card p-12 text-center">
            <Shield className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-semibold text-muted-foreground mb-2">Enter a contract address to score</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Get instant risk analysis including rug probability, liquidity stability, holder distribution, and smart wallet signals.
            </p>
          </Card>
        )}
      </div>
    </Layout>
  );
}
