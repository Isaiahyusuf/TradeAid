import { X, ExternalLink, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ADS = [
  {
    id: "memescanner-pro",
    title: "Upgrade to Pro",
    description: "Unlimited scans, no ads, priority signals",
    cta: "Go Pro",
    link: "/subscription",
    gradient: "from-primary/20 via-accent/20 to-purple-500/20",
    border: "border-primary/30",
  },
  {
    id: "dex-partner",
    title: "Trade on DEX",
    description: "Lowest fees, fastest swaps",
    cta: "Trade Now",
    link: "#",
    gradient: "from-blue-500/20 via-cyan-500/20 to-teal-500/20",
    border: "border-blue-500/30",
  },
  {
    id: "telegram-bot",
    title: "Telegram Alerts",
    description: "Get instant token alerts on Telegram",
    cta: "Connect",
    link: "#",
    gradient: "from-sky-500/20 via-blue-500/20 to-indigo-500/20",
    border: "border-sky-500/30",
  },
];

interface AdBannerProps {
  variant?: "banner" | "inline" | "sidebar";
  onAdViewed?: () => void;
  className?: string;
}

export function AdBanner({ variant = "banner", onAdViewed, className }: AdBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [currentAd, setCurrentAd] = useState(ADS[0]);

  useEffect(() => {
    const randomAd = ADS[Math.floor(Math.random() * ADS.length)];
    setCurrentAd(randomAd);
    onAdViewed?.();
  }, [onAdViewed]);

  if (dismissed) return null;

  if (variant === "inline") {
    return (
      <div className={cn(
        "relative rounded-lg border p-3 bg-gradient-to-r",
        currentAd.gradient,
        currentAd.border,
        className
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{currentAd.title}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {currentAd.description}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
              <a href={currentAd.link}>
                {currentAd.cta}
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </Button>
            <button
              onClick={() => setDismissed(true)}
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-dismiss-ad"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="absolute top-1 right-8 text-[9px] text-muted-foreground/50">
          Ad
        </div>
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <div className={cn(
        "relative rounded-xl border p-4 bg-gradient-to-br",
        currentAd.gradient,
        currentAd.border,
        className
      )}>
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
          data-testid="button-dismiss-sidebar-ad"
        >
          <X className="w-3 h-3" />
        </button>
        <div className="text-[9px] text-muted-foreground/50 mb-2">Sponsored</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-semibold">{currentAd.title}</span>
          </div>
          <p className="text-sm text-muted-foreground">{currentAd.description}</p>
          <Button size="sm" className="w-full mt-2" asChild>
            <a href={currentAd.link}>
              {currentAd.cta}
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "relative rounded-xl border p-4 bg-gradient-to-r",
      currentAd.gradient,
      currentAd.border,
      className
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold">{currentAd.title}</div>
            <div className="text-sm text-muted-foreground">{currentAd.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild>
            <a href={currentAd.link}>
              {currentAd.cta}
              <ExternalLink className="w-4 h-4 ml-2" />
            </a>
          </Button>
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-dismiss-banner-ad"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="absolute top-2 right-12 text-[10px] text-muted-foreground/50">
        Sponsored
      </div>
    </div>
  );
}
