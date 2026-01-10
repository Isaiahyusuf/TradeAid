import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useScanToken, useScanHistory } from "@/hooks/use-rugcheck";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Lock, Unlock, AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function RugShield() {
  const [address, setAddress] = useState("");
  const { mutate: scanToken, isPending, data: result } = useScanToken();
  const { data: history } = useScanHistory();
  const { toast } = useToast();

  const handleScan = () => {
    if (!address) {
      toast({ title: "Error", description: "Please enter a token address", variant: "destructive" });
      return;
    }
    scanToken({ address });
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-500 border-green-500";
    if (score >= 50) return "text-yellow-500 border-yellow-500";
    return "text-red-500 border-red-500";
  };

  const holderData = result ? [
    { name: 'Top 10', value: result.topHoldersPercentage, color: '#ef4444' },
    { name: 'Others', value: 100 - result.topHoldersPercentage, color: '#22c55e' },
  ] : [];

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-bold">RugShield Scanner</h1>
          <p className="text-muted-foreground">Instantly audit Solana tokens for safety risks and honeypots.</p>
        </div>

        {/* Scan Input */}
        <div className="glass-card p-6 rounded-2xl">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Enter Solana Token Address..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="pl-10 h-12 bg-black/20 border-white/10 text-lg font-mono focus:ring-primary/50"
              />
            </div>
            <Button 
              onClick={handleScan} 
              disabled={isPending}
              className="h-12 px-8 text-lg font-bold bg-primary hover:bg-primary/90 text-black shadow-[0_0_20px_rgba(34,197,94,0.3)] transition-all"
            >
              {isPending ? "Scanning..." : "Scan Token"}
            </Button>
          </div>
        </div>

        {/* Results Area */}
        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              {/* Score Card */}
              <Card className="glass-card border-none bg-black/40">
                <CardHeader>
                  <CardTitle className="text-center text-muted-foreground text-sm uppercase tracking-wider">Safety Score</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center py-6">
                  <div className={cn(
                    "w-32 h-32 rounded-full border-8 flex items-center justify-center text-4xl font-bold transition-colors duration-500 shadow-xl bg-black/50",
                    getScoreColor(result.safetyScore)
                  )}>
                    {result.safetyScore}
                  </div>
                  <div className="mt-4 text-center">
                    <h3 className="font-bold text-xl">{result.name}</h3>
                    <p className="font-mono text-sm text-muted-foreground">{result.symbol}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Checks */}
              <Card className="glass-card border-none bg-black/40 md:col-span-2">
                <CardHeader>
                  <CardTitle>Critical Checks</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Liquidity */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {result.isLiquidityLocked ? <Lock className="text-green-500" /> : <Unlock className="text-red-500" />}
                      <div>
                        <p className="font-medium">Liquidity</p>
                        <p className="text-sm text-muted-foreground">{result.isLiquidityLocked ? "Locked & Safe" : "Unlocked (Risk)"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Mint Authority */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {result.mintAuthorityDisabled ? <CheckCircle2 className="text-green-500" /> : <AlertTriangle className="text-red-500" />}
                      <div>
                        <p className="font-medium">Mint Authority</p>
                        <p className="text-sm text-muted-foreground">{result.mintAuthorityDisabled ? "Disabled" : "Enabled (Risk)"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Honeypot Status */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {!result.isHoneypot ? <Shield className="text-green-500" /> : <AlertTriangle className="text-red-500" />}
                      <div>
                        <p className="font-medium">Honeypot Check</p>
                        <p className="text-sm text-muted-foreground">{!result.isHoneypot ? "Passed" : "HONEYPOT DETECTED"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Holders Chart */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between h-24">
                     <div className="flex-1">
                        <p className="font-medium">Top 10 Holders</p>
                        <p className={cn("text-2xl font-bold", result.topHoldersPercentage > 50 ? "text-red-500" : "text-green-500")}>
                          {result.topHoldersPercentage}%
                        </p>
                     </div>
                     <div className="h-20 w-20">
                       <ResponsiveContainer width="100%" height="100%">
                         <PieChart>
                           <Pie data={holderData} innerRadius={15} outerRadius={30} paddingAngle={2} dataKey="value">
                             {holderData.map((entry, index) => (
                               <Cell key={`cell-${index}`} fill={entry.color} />
                             ))}
                           </Pie>
                         </PieChart>
                       </ResponsiveContainer>
                     </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History */}
        {history && history.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Recent Scans</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.map((scan) => (
                <div key={scan.id} className="p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors flex justify-between items-center group cursor-pointer" onClick={() => setAddress(scan.address)}>
                  <div>
                    <p className="font-bold">{scan.name} <span className="text-muted-foreground text-sm font-normal">({scan.symbol})</span></p>
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[150px]">{scan.address}</p>
                  </div>
                  <div className={cn("px-2 py-1 rounded text-xs font-bold", scan.safetyScore >= 80 ? "bg-green-500/20 text-green-500" : scan.safetyScore >= 50 ? "bg-yellow-500/20 text-yellow-500" : "bg-red-500/20 text-red-500")}>
                    {scan.safetyScore}/100
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
