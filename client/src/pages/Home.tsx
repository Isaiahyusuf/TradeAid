import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Eye, TrendingUp, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const features = [
    {
      title: "RugShield",
      description: "Instant safety audits for Solana tokens. Detect honeypots and liquidity risks before you buy.",
      icon: ShieldCheck,
      href: "/rugshield",
      color: "text-green-500",
      bg: "bg-green-500/10",
      border: "border-green-500/20"
    },
    {
      title: "WhaleWatch",
      description: "Track smart money wallets. Get real-time alerts when top traders buy or sell.",
      icon: Eye,
      href: "/whalewatch",
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20"
    },
    {
      title: "MemeTrend",
      description: "AI-powered sentiment analysis. Spot viral narratives on Twitter before price impact.",
      icon: TrendingUp,
      href: "/memetrend",
      color: "text-purple-500",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20"
    }
  ];

  return (
    <Layout>
      <div className="space-y-12 py-8">
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4">
              Trade <span className="text-gradient">Smarter</span>.
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              The ultimate toolkit for Solana memecoin traders. Avoid rugs, follow whales, and spot trends early.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 + 0.3 }}
            >
              <div className={`h-full p-6 rounded-2xl border ${feature.border} ${feature.bg} hover:bg-opacity-20 transition-all group flex flex-col`}>
                <div className={`w-12 h-12 rounded-lg ${feature.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <feature.icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <h3 className="text-2xl font-bold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground mb-6 flex-1">{feature.description}</p>
                <Link href={feature.href}>
                  <Button className="w-full group-hover:translate-x-1 transition-transform" variant="outline">
                    Launch Tool <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
