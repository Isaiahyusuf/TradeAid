import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TokenAvatar } from "@/components/token/TokenAvatar";
import { useDoctorTicker, type DoctorTickerItem } from "@/hooks/use-doctortrade";
import { cn } from "@/lib/utils";

type LiveTickerBarProps = {
  className?: string;
};

const signalAccentByType: Record<string, string> = {
  Hot: "text-emerald-300 border-emerald-500/40",
  Pumping: "text-rose-300 border-rose-500/40",
  "Smart Money": "text-cyan-300 border-cyan-500/40",
};

const signalEmojiByType: Record<string, string> = {
  Hot: "🔥",
  Pumping: "🚀",
  "Smart Money": "🧠",
};

function fmtUsdCompact(value: number) {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "$0";
  if (safe >= 1_000_000_000) return `$${(safe / 1_000_000_000).toFixed(2)}B`;
  if (safe >= 1_000_000) return `$${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000) return `$${(safe / 1_000).toFixed(0)}K`;
  if (safe >= 1) return `$${safe.toFixed(2)}`;
  return `$${safe.toFixed(6)}`;
}

export function LiveTickerBar({ className }: LiveTickerBarProps) {
  const [, setLocation] = useLocation();
  const { data } = useDoctorTicker(28);
  const [selected, setSelected] = useState<DoctorTickerItem | null>(null);

  const items = data?.items || [];
  const hasItems = items.length > 0;

  const tickerRows = useMemo(() => {
    if (!hasItems) {
      return [
        {
          id: "placeholder",
          mint: "",
          name: "Scanning",
          symbol: "ALPHA",
          price_usd: 0,
          liquidity_usd: 0,
          volume_5m_usd: 0,
          age_minutes: 0,
          signal: "Hot",
          signal_prefix: "FIRE",
          source: "Doctor AI",
          message: "DoctorTrade is scanning DexScreener, Pump.fun, Helius flow, and internal AI signals...",
          created_at: new Date().toISOString(),
        } as DoctorTickerItem,
      ];
    }

    return [...items, ...items];
  }, [hasItems, items]);

  const openDoctorTrade = (query?: string) => {
    setSelected(null);
    setLocation(query ? `/doctortrade${query}` : "/doctortrade");
  };

  return (
    <>
      <div
        className={cn(
          "h-10 border-b border-emerald-500/25 bg-[#070c11]/95 backdrop-blur-md overflow-hidden",
          className,
        )}
      >
        <div className="live-ticker-track h-full">
          {tickerRows.map((item, index) => {
            const signal = String(item.signal || "Hot");
            const accentClass = signalAccentByType[signal] || signalAccentByType.Hot;
            const signalEmoji = signalEmojiByType[signal] || "🔥";

            return (
              <button
                key={`${item.id}-${index}`}
                type="button"
                className="live-ticker-item"
                onClick={() => item.mint && setSelected(item)}
                title={item.message}
                disabled={!item.mint}
              >
                <TokenAvatar
                  logoUrl=""
                  symbol={item.symbol}
                  name={item.name}
                  className="h-4 w-4 border-none"
                  fallbackClassName="text-[8px]"
                />
                <span className="text-[11px] text-emerald-200/95 font-semibold">
                  {signalEmoji} {item.symbol}
                </span>
                <span className="text-[11px] text-muted-foreground">{fmtUsdCompact(item.price_usd)}</span>
                <span className="text-[11px] text-muted-foreground">Liq {fmtUsdCompact(item.liquidity_usd)}</span>
                <span className="text-[11px] text-muted-foreground">Vol5m {fmtUsdCompact(item.volume_5m_usd)}</span>
                <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", accentClass)}>
                  {signal}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected?.symbol || "Token"} Alpha Actions
            </DialogTitle>
            <DialogDescription>
              Open details, chart, or send this coin to DoctorTrade sniper workflow.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs space-y-1">
              <p><span className="text-muted-foreground">Token:</span> {selected.name} ({selected.symbol})</p>
              <p><span className="text-muted-foreground">Price:</span> {fmtUsdCompact(selected.price_usd)}</p>
              <p><span className="text-muted-foreground">Liquidity:</span> {fmtUsdCompact(selected.liquidity_usd)}</p>
              <p><span className="text-muted-foreground">Volume (5m):</span> {fmtUsdCompact(selected.volume_5m_usd)}</p>
              <p><span className="text-muted-foreground">Signal:</span> {selected.signal}</p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => openDoctorTrade(`?token=${encodeURIComponent(String(selected?.mint || ""))}`)}>
              Token Details
            </Button>
            <Button variant="outline" onClick={() => openDoctorTrade(`?action=buy&contract=${encodeURIComponent(String(selected?.mint || ""))}&chain=solana`)}>
              Quick Buy
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const chartUrl = String(selected?.chart_url || "").trim();
                if (chartUrl) {
                  window.open(chartUrl, "_blank", "noopener,noreferrer");
                }
              }}
            >
              Chart
            </Button>
            <Button onClick={() => openDoctorTrade()}>
              Sniper
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
