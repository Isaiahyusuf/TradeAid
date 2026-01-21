import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ShieldCheck, Eye, TrendingUp, ArrowRight, Zap, Globe, 
  Twitter, Search, Star, CheckCircle2, Sparkles, Activity
} from "lucide-react";
import { SiSolana, SiEthereum } from "react-icons/si";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-3xl opacity-20 pointer-events-none" />
      
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tighter">
            <span className="text-primary">Meme</span>Scanner<span className="text-accent">AI</span>
          </h1>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-features">Features</a>
            <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-pricing">Pricing</a>
          </nav>
          <a href="/api/login">
            <Button data-testid="button-login">
              Launch App <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </a>
        </div>
      </header>

      <main className="pt-24">
        <section className="max-w-7xl mx-auto px-4 py-20 text-center relative">
          <Badge variant="outline" className="mb-6 border-primary/30 text-primary">
            <Sparkles className="w-3 h-3 mr-1" />
            Powered by GPT-5.1 AI
          </Badge>
          
          <h2 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 leading-tight">
            Avoid Rugs.<br />
            <span className="text-gradient">Follow Whales.</span><br />
            Win Big.
          </h2>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            The most advanced memecoin trading intelligence platform. 
            Multi-chain scanner, whale tracking, AI sentiment analysis, and real-time DEX alerts.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <a href="/api/login">
              <Button size="lg" className="text-lg px-8" data-testid="button-get-started">
                Get Started Free <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </a>
            <Button size="lg" variant="outline" className="text-lg px-8" data-testid="button-view-demo">
              <Activity className="w-5 h-5 mr-2" />
              Live Demo
            </Button>
          </div>
          
          <div className="flex items-center justify-center gap-6 text-muted-foreground text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              No credit card required
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              Pay with crypto
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              Multi-chain support
            </div>
          </div>
          
          <div className="mt-16 flex items-center justify-center gap-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <SiSolana className="w-6 h-6 text-[#9945FF]" />
              <span>Solana</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <SiEthereum className="w-6 h-6 text-[#627EEA]" />
              <span>Ethereum</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-6 h-6 rounded-full bg-[#F3BA2F] flex items-center justify-center text-black font-bold text-xs">B</div>
              <span>BSC</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-6 h-6 rounded-full bg-[#0052FF] flex items-center justify-center text-white font-bold text-xs">B</div>
              <span>Base</span>
            </div>
          </div>
        </section>

        <section id="features" className="max-w-7xl mx-auto px-4 py-20">
          <h3 className="text-3xl font-bold text-center mb-4">Everything You Need to Win</h3>
          <p className="text-muted-foreground text-center mb-12 max-w-xl mx-auto">
            Professional-grade tools used by top memecoin traders. All in one platform.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="p-6 bg-card/60 backdrop-blur border-green-500/20 hover:border-green-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mb-4">
                <ShieldCheck className="w-6 h-6 text-green-500" />
              </div>
              <h4 className="text-xl font-bold mb-2">RugShield</h4>
              <p className="text-muted-foreground">
                Instant token safety audits. Detect honeypots, locked liquidity, and ownership risks before buying.
              </p>
            </Card>
            
            <Card className="p-6 bg-card/60 backdrop-blur border-blue-500/20 hover:border-blue-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4">
                <Eye className="w-6 h-6 text-blue-500" />
              </div>
              <h4 className="text-xl font-bold mb-2">WhaleWatch</h4>
              <p className="text-muted-foreground">
                Track smart money wallets. Get real-time alerts when top traders buy or sell.
              </p>
            </Card>
            
            <Card className="p-6 bg-card/60 backdrop-blur border-purple-500/20 hover:border-purple-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4">
                <TrendingUp className="w-6 h-6 text-purple-500" />
              </div>
              <h4 className="text-xl font-bold mb-2">MemeTrend AI</h4>
              <p className="text-muted-foreground">
                AI-powered sentiment analysis. Spot viral narratives on Twitter before price impact.
              </p>
            </Card>
            
            <Card className="p-6 bg-card/60 backdrop-blur border-orange-500/20 hover:border-orange-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-orange-500" />
              </div>
              <h4 className="text-xl font-bold mb-2">DEX Scanner</h4>
              <p className="text-muted-foreground">
                Scan all major DEXes for new launches. DexScreener paid ads detection included.
              </p>
            </Card>
            
            <Card className="p-6 bg-card/60 backdrop-blur border-cyan-500/20 hover:border-cyan-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center mb-4">
                <Twitter className="w-6 h-6 text-cyan-500" />
              </div>
              <h4 className="text-xl font-bold mb-2">Twitter Trends</h4>
              <p className="text-muted-foreground">
                Real-time crypto Twitter tracking. See what's trending before it pumps.
              </p>
            </Card>
            
            <Card className="p-6 bg-card/60 backdrop-blur border-pink-500/20 hover:border-pink-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-pink-500/10 flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-pink-500" />
              </div>
              <h4 className="text-xl font-bold mb-2">Launchpad Monitor</h4>
              <p className="text-muted-foreground">
                Track Pump.fun, Moonshot, and more. Get alerts on bonding curve progress.
              </p>
            </Card>
          </div>
        </section>

        <section id="pricing" className="max-w-5xl mx-auto px-4 py-20">
          <h3 className="text-3xl font-bold text-center mb-4">Simple, Transparent Pricing</h3>
          <p className="text-muted-foreground text-center mb-12">
            Start free. Upgrade when you're ready to go pro.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="p-8 bg-card/60 backdrop-blur border-border">
              <h4 className="text-2xl font-bold mb-2">Free</h4>
              <p className="text-muted-foreground mb-6">Perfect for getting started</p>
              <div className="text-4xl font-bold mb-6">$0<span className="text-lg text-muted-foreground">/month</span></div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  5 token scans per day
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Track 3 whale wallets
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Basic trend data
                </li>
              </ul>
              <a href="/api/login">
                <Button variant="outline" className="w-full" data-testid="button-start-free">Start Free</Button>
              </a>
            </Card>
            
            <Card className="p-8 bg-gradient-to-br from-primary/10 to-accent/10 border-primary/30 relative overflow-hidden">
              <div className="absolute top-4 right-4">
                <Badge className="bg-primary text-primary-foreground">
                  <Star className="w-3 h-3 mr-1" />
                  Most Popular
                </Badge>
              </div>
              <h4 className="text-2xl font-bold mb-2">Pro</h4>
              <p className="text-muted-foreground mb-6">For serious traders</p>
              <div className="text-4xl font-bold mb-6">$100<span className="text-lg text-muted-foreground">/month</span></div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Unlimited token scans
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Unlimited whale tracking
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Real-time DEX alerts
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Twitter trend analysis
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  DexScreener paid detection
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Priority support
                </li>
              </ul>
              <a href="/api/login">
                <Button className="w-full" data-testid="button-go-pro">
                  Go Pro <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
              <p className="text-center text-sm text-muted-foreground mt-4">
                Pay with SOL, ETH, BSC, or BASE
              </p>
            </Card>
          </div>
        </section>

        <footer className="border-t border-border py-8">
          <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-muted-foreground text-sm">
              2025 MemeScanner AI. Not financial advice.
            </div>
            <div className="flex items-center gap-6 text-muted-foreground text-sm">
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Contact</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
