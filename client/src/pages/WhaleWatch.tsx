import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useTrackedWallets, useAddWallet, useDeleteWallet, useWalletAlerts } from "@/hooks/use-whalewatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function WhaleWatch() {
  const { data: wallets, isLoading: isLoadingWallets } = useTrackedWallets();
  const { data: alerts } = useWalletAlerts();
  const { mutateAsync: addWallet, isPending: isAdding } = useAddWallet();
  const { mutateAsync: deleteWallet } = useDeleteWallet();
  const { toast } = useToast();
  
  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [newWalletLabel, setNewWalletLabel] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const handleAddWallet = async () => {
    try {
      await addWallet({ address: newWalletAddress, label: newWalletLabel });
      setNewWalletAddress("");
      setNewWalletLabel("");
      setIsOpen(false);
      toast({ title: "Success", description: "Wallet added successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteWallet(id);
      toast({ title: "Deleted", description: "Wallet removed from tracking" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete wallet", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">WhaleWatch</h1>
            <p className="text-muted-foreground">Track smart money and get instant trade alerts.</p>
          </div>
          
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-black hover:bg-primary/90 font-bold">
                <Plus className="w-4 h-4 mr-2" /> Add Wallet
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle>Track New Wallet</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Wallet Address</label>
                  <Input 
                    placeholder="Solana Address..." 
                    value={newWalletAddress} 
                    onChange={(e) => setNewWalletAddress(e.target.value)} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Label (e.g. "Alpha Caller")</label>
                  <Input 
                    placeholder="Label..." 
                    value={newWalletLabel} 
                    onChange={(e) => setNewWalletLabel(e.target.value)} 
                  />
                </div>
                <Button 
                  className="w-full bg-primary text-black font-bold" 
                  onClick={handleAddWallet}
                  disabled={isAdding}
                >
                  {isAdding ? "Adding..." : "Start Tracking"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Wallets Table */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-white/5">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" /> Tracked Wallets
            </h2>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="w-[100px]">Label</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>Total Profit</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingWallets ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
                ) : wallets?.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No wallets tracked yet.</TableCell></TableRow>
                ) : (
                  wallets?.map((wallet) => (
                    <TableRow key={wallet.id} className="border-white/5 hover:bg-white/5">
                      <TableCell className="font-bold">{wallet.label}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{wallet.address}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-green-500/50 text-green-500 bg-green-500/10">
                          {wallet.winRate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-green-400 font-mono">{wallet.totalProfit}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(wallet.id)} className="hover:text-red-500 hover:bg-red-500/10">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Alerts Feed */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Live Alerts Feed</h2>
          <div className="grid gap-4">
            {alerts?.map((alert) => (
              <div key={alert.id} className="p-4 rounded-xl bg-card border border-border flex items-center justify-between hover:border-primary/30 transition-all">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    alert.type === 'BUY' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                  )}>
                    {alert.type === 'BUY' ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className="font-bold text-lg">
                      <span className={alert.type === 'BUY' ? "text-green-500" : "text-red-500"}>{alert.type}</span> {alert.tokenSymbol}
                    </p>
                    <p className="text-sm text-muted-foreground">by {alert.walletLabel}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold">{alert.amount}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(alert.timestamp!), "HH:mm:ss")}</p>
                </div>
              </div>
            ))}
            {alerts?.length === 0 && (
              <div className="text-center py-10 text-muted-foreground border border-dashed border-border rounded-xl">
                No recent alerts. Add wallets to start tracking.
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
