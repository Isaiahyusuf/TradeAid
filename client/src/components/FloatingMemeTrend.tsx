import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, X, Flame, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type TrendingCoin = {
  id: number;
  symbol: string;
  name: string;
  price: string;
  volume24h: string;
  hypeScore: number;
  trend: string;
};

export function FloatingMemeTrend() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const { data: trendingCoins } = useQuery<TrendingCoin[]>({
    queryKey: ["/api/memetrend/list"],
    refetchInterval: 30000,
  });

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 border-0"
        size="icon"
        data-testid="button-floating-memetrend"
      >
        <Flame className="w-6 h-6" />
      </Button>
    );
  }

  return (
    <Card
      className={cn(
        "fixed z-50 bg-card/95 backdrop-blur-xl border-purple-500/30 shadow-2xl transition-all duration-300",
        isMinimized
          ? "bottom-6 right-6 w-auto"
          : "bottom-6 right-6 w-80 max-h-[60vh]"
      )}
      data-testid="floating-memetrend-panel"
    >
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <span className="font-semibold text-sm">MemeTrend</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">LIVE</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setIsMinimized(!isMinimized)}
            data-testid="button-minimize-memetrend"
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setIsOpen(false)}
            data-testid="button-close-memetrend"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-border">
          {trendingCoins?.slice(0, 6).map((coin) => (
            <div
              key={coin.id}
              className="p-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
              data-testid={`floating-coin-${coin.symbol}`}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center font-bold text-xs">
                {coin.symbol.replace("$", "").charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-sm">{coin.symbol}</span>
                  {coin.trend === "UP" && <TrendingUp className="w-3 h-3 text-green-400" />}
                  {coin.trend === "DOWN" && <TrendingDown className="w-3 h-3 text-red-400" />}
                </div>
                <p className="text-xs text-muted-foreground truncate">{coin.name}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-xs">${coin.price}</p>
                <div className={cn(
                  "text-[10px] font-bold",
                  coin.hypeScore >= 80 ? "text-green-400" : 
                  coin.hypeScore >= 60 ? "text-yellow-400" : "text-muted-foreground"
                )}>
                  {coin.hypeScore} HYPE
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
