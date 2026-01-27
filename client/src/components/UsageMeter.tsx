import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Zap, Crown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { FREE_TIER_LIMITS } from "@shared/schema";

interface UsageMeterProps {
  type: "scans" | "analyses" | "signals";
  used: number;
  isPro?: boolean;
  className?: string;
}

const LABELS = {
  scans: { label: "Token Scans", icon: Zap, limit: FREE_TIER_LIMITS.dailyScans },
  analyses: { label: "AI Analyses", icon: Lock, limit: FREE_TIER_LIMITS.dailyDeepAnalyses },
  signals: { label: "Signal Views", icon: Crown, limit: FREE_TIER_LIMITS.dailySignalViews },
};

export function UsageMeter({ type, used, isPro = false, className }: UsageMeterProps) {
  const { label, icon: Icon, limit } = LABELS[type];
  const percentage = isPro ? 0 : Math.min((used / limit) * 100, 100);
  const remaining = Math.max(limit - used, 0);
  const isExhausted = !isPro && used >= limit;

  if (isPro) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Crown className="w-4 h-4 text-amber-400" />
        <span className="text-sm text-muted-foreground">{label}</span>
        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
          Unlimited
        </Badge>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", isExhausted ? "text-red-400" : "text-muted-foreground")} />
          <span className={cn(isExhausted && "text-red-400")}>{label}</span>
        </div>
        <span className={cn("text-muted-foreground", isExhausted && "text-red-400")}>
          {remaining}/{limit} left
        </span>
      </div>
      <Progress 
        value={percentage} 
        className={cn("h-1.5", isExhausted && "[&>div]:bg-red-500")}
      />
    </div>
  );
}

interface UsageSummaryProps {
  usage: {
    dailyScans: number;
    dailyDeepAnalyses: number;
    dailySignalViews: number;
  };
  isPro?: boolean;
  className?: string;
}

export function UsageSummary({ usage, isPro = false, className }: UsageSummaryProps) {
  if (isPro) {
    return (
      <div className={cn("flex items-center gap-2 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20", className)}>
        <Crown className="w-5 h-5 text-amber-400" />
        <span className="font-medium text-amber-400">Pro Member</span>
        <span className="text-sm text-muted-foreground ml-auto">Unlimited Access</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3 p-4 rounded-lg bg-card border", className)}>
      <div className="flex items-center justify-between">
        <span className="font-medium">Daily Usage</span>
        <Badge variant="outline" className="text-xs">Free Tier</Badge>
      </div>
      <UsageMeter type="scans" used={usage.dailyScans} />
      <UsageMeter type="analyses" used={usage.dailyDeepAnalyses} />
      <UsageMeter type="signals" used={usage.dailySignalViews} />
    </div>
  );
}
