import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  CheckCircle2, Star, Zap, Copy, ExternalLink, 
  Loader2, ShieldCheck
} from "lucide-react";
import { SiSolana, SiEthereum } from "react-icons/si";

type Subscription = {
  plan: string;
  status: string;
  expiresAt?: string;
  paymentMethod?: string;
};

const PAYMENT_ADDRESSES = {
  SOL: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJk",
  ETH: "0x742d35Cc6634C0532925a3b844Bc9e7595f60254",
  BSC: "0x742d35Cc6634C0532925a3b844Bc9e7595f60254",
  BASE: "0x742d35Cc6634C0532925a3b844Bc9e7595f60254",
};

const PAYMENT_AMOUNTS = {
  SOL: "0.5 SOL",
  ETH: "0.03 ETH",
  BSC: "0.17 BNB",
  BASE: "0.03 ETH",
};

function PaymentChainIcon({ chain }: { chain: string }) {
  switch (chain) {
    case "SOL":
      return <SiSolana className="w-5 h-5 text-[#9945FF]" />;
    case "ETH":
      return <SiEthereum className="w-5 h-5 text-[#627EEA]" />;
    case "BSC":
      return <div className="w-5 h-5 rounded-full bg-[#F3BA2F] flex items-center justify-center text-black font-bold text-xs">B</div>;
    case "BASE":
      return <div className="w-5 h-5 rounded-full bg-[#0052FF] flex items-center justify-center text-white font-bold text-xs">B</div>;
    default:
      return null;
  }
}

export default function Subscription() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");

  const { data: subscription, isLoading } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const upgradeMutation = useMutation({
    mutationFn: async (data: { paymentMethod: string; txHash: string }) => {
      return apiRequest("POST", "/api/subscription", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({
        title: "Subscription Activated!",
        description: "Welcome to Pro! Your subscription is now active.",
      });
      setSelectedChain(null);
      setTxHash("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to activate subscription. Please try again.",
        variant: "destructive",
      });
    },
  });

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast({
      title: "Copied!",
      description: "Wallet address copied to clipboard",
    });
  };

  const isPro = subscription?.plan === "pro" && subscription?.status === "active";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Subscription</h1>
          <p className="text-muted-foreground">Manage your MemeScanner AI subscription</p>
        </div>

        <Card className={`p-6 ${isPro ? "border-primary/30 bg-primary/5" : "border-border"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isPro ? "bg-primary/20" : "bg-muted"}`}>
                {isPro ? <Star className="w-6 h-6 text-primary" /> : <ShieldCheck className="w-6 h-6 text-muted-foreground" />}
              </div>
              <div>
                <h2 className="text-xl font-bold">{isPro ? "Pro Plan" : "Free Plan"}</h2>
                <p className="text-muted-foreground text-sm">
                  {isPro ? "All features unlocked" : "Limited features"}
                </p>
              </div>
            </div>
            <Badge className={isPro ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}>
              {subscription?.status || "active"}
            </Badge>
          </div>
          
          {isPro && subscription?.expiresAt && (
            <div className="mt-4 text-sm text-muted-foreground">
              Renews on {new Date(subscription.expiresAt).toLocaleDateString()}
            </div>
          )}
        </Card>

        {!isPro && (
          <>
            <Card className="p-6 bg-gradient-to-br from-primary/10 to-accent/10 border-primary/30">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-bold">Upgrade to Pro</h3>
              </div>
              <p className="text-muted-foreground mb-6">
                Get unlimited access to all features for $100/month. Pay with your favorite crypto.
              </p>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {(["SOL", "ETH", "BSC", "BASE"] as const).map((chain) => (
                  <button
                    key={chain}
                    onClick={() => setSelectedChain(chain)}
                    className={`p-4 rounded-xl border transition-all ${
                      selectedChain === chain 
                        ? "border-primary bg-primary/10" 
                        : "border-border hover:border-primary/50 hover:bg-white/5"
                    }`}
                    data-testid={`payment-chain-${chain}`}
                  >
                    <div className="flex items-center justify-center mb-2">
                      <PaymentChainIcon chain={chain} />
                    </div>
                    <p className="font-semibold text-center">{chain}</p>
                    <p className="text-xs text-muted-foreground text-center">{PAYMENT_AMOUNTS[chain]}</p>
                  </button>
                ))}
              </div>

              {selectedChain && (
                <div className="space-y-4 p-4 rounded-xl bg-card/60 border border-border">
                  <div>
                    <Label className="text-sm text-muted-foreground">Send exactly {PAYMENT_AMOUNTS[selectedChain as keyof typeof PAYMENT_AMOUNTS]} to:</Label>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 bg-background p-3 rounded-lg font-mono text-sm break-all">
                        {PAYMENT_ADDRESSES[selectedChain as keyof typeof PAYMENT_ADDRESSES]}
                      </code>
                      <Button 
                        size="icon" 
                        variant="outline"
                        onClick={() => copyAddress(PAYMENT_ADDRESSES[selectedChain as keyof typeof PAYMENT_ADDRESSES])}
                        data-testid="button-copy-address"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="txHash">Transaction Hash</Label>
                    <Input
                      id="txHash"
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      placeholder="Enter your transaction hash after sending..."
                      className="mt-2"
                      data-testid="input-tx-hash"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Paste your transaction hash after sending payment
                    </p>
                  </div>

                  <Button 
                    className="w-full"
                    disabled={!txHash || upgradeMutation.isPending}
                    onClick={() => upgradeMutation.mutate({ paymentMethod: selectedChain, txHash })}
                    data-testid="button-confirm-payment"
                  >
                    {upgradeMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Confirm Payment
                      </>
                    )}
                  </Button>
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Pro Features Include:</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  "Unlimited token scans",
                  "Unlimited whale tracking",
                  "Real-time DEX alerts",
                  "Twitter trend analysis",
                  "DexScreener paid detection",
                  "Launchpad monitoring",
                  "AI-powered insights",
                  "Priority support",
                ].map((feature) => (
                  <div key={feature} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    {feature}
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {isPro && (
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Your Pro Features</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                "Unlimited token scans",
                "Unlimited whale tracking",
                "Real-time DEX alerts",
                "Twitter trend analysis",
                "DexScreener paid detection",
                "Launchpad monitoring",
                "AI-powered insights",
                "Priority support",
              ].map((feature) => (
                <div key={feature} className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {feature}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
