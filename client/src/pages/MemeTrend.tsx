import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useTrendingCoins, useAnalyzeSentiment } from "@/hooks/use-memetrend";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, Minus, Bot, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export default function MemeTrend() {
  const { data: coins, isLoading } = useTrendingCoins();
  const { mutate: analyze, isPending: isAnalyzing, data: analysis, reset } = useAnalyzeSentiment();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const handleAnalyze = (symbol: string) => {
    setSelectedSymbol(symbol);
    analyze({ symbol });
  };

  const closeDialog = () => {
    setSelectedSymbol(null);
    reset();
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold">MemeTrend AI</h1>
          <p className="text-muted-foreground">Spot viral narratives before they moon using social sentiment analysis.</p>
        </div>

        {/* Trending Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <div key={i} className="h-48 rounded-2xl bg-card/50 animate-pulse" />
            ))
          ) : (
            coins?.map((coin) => (
              <motion.div
                key={coin.symbol}
                whileHover={{ y: -5 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <Card className="glass-card hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => handleAnalyze(coin.symbol)}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xl font-bold">{coin.name}</CardTitle>
                    <Badge variant="outline" className="font-mono">{coin.symbol}</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Price</span>
                        <span className="font-mono font-bold">{coin.price}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">24h Vol</span>
                        <span className="font-mono">{coin.volume24h}</span>
                      </div>
                      
                      <div className="pt-4 border-t border-white/5">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium flex items-center gap-2">
                            <Activity className="w-4 h-4 text-primary" /> Hype Score
                          </span>
                          <span className={cn(
                            "font-bold",
                            coin.hypeScore > 80 ? "text-green-500" : coin.hypeScore > 50 ? "text-yellow-500" : "text-red-500"
                          )}>{coin.hypeScore}/100</span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-1000"
                            style={{ width: `${coin.hypeScore}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          )}
        </div>

        {/* Analysis Dialog */}
        <Dialog open={!!selectedSymbol} onOpenChange={(open) => !open && closeDialog()}>
          <DialogContent className="bg-card border-primary/20 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-2xl">
                <Bot className="text-primary" /> AI Sentiment Analysis
              </DialogTitle>
            </DialogHeader>
            
            <div className="py-6">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center space-y-4 py-8">
                  <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-lg font-mono animate-pulse">Scanning social signals...</p>
                </div>
              ) : analysis ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                    <div>
                      <p className="text-muted-foreground text-sm uppercase tracking-wider">Verdict</p>
                      <p className={cn(
                        "text-2xl font-bold mt-1",
                        analysis.sentiment === 'BULLISH' ? "text-green-500" : analysis.sentiment === 'BEARISH' ? "text-red-500" : "text-yellow-500"
                      )}>
                        {analysis.sentiment}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground text-sm uppercase tracking-wider">Confidence</p>
                      <p className="text-2xl font-bold mt-1">{analysis.score}%</p>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <p className="text-sm text-muted-foreground mb-2 font-bold uppercase tracking-wider">AI Summary</p>
                    <p className="leading-relaxed text-gray-300">{analysis.summary}</p>
                  </div>
                  
                  <Button className="w-full bg-primary text-black font-bold h-12 text-lg" onClick={closeDialog}>
                    Close Analysis
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
