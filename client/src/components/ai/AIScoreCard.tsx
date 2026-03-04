import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, TrendingUp, Shield, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TokenScore } from "@/lib/api";

interface AIScoreCardProps {
  score: TokenScore;
  compact?: boolean;
  className?: string;
}

function getRiskColor(score: number): string {
  if (score <= 30) return "text-green-500";
  if (score <= 60) return "text-yellow-500";
  return "text-red-500";
}

function getConfidenceColor(score: number): string {
  if (score >= 70) return "text-green-500";
  if (score >= 40) return "text-yellow-500";
  return "text-red-500";
}

function getRiskBadgeVariant(score: number): "default" | "destructive" | "secondary" {
  if (score <= 30) return "default";
  if (score <= 60) return "secondary";
  return "destructive";
}

export function AIScoreCard({ score, compact = false, className }: AIScoreCardProps) {
  const rugRisk = score.scores.rug_risk_score;
  const confidence = score.scores.trade_confidence_index;
  const liquidityStability = score.scores.liquidity_stability;
  const holderDist = score.scores.holder_distribution;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <div className="flex items-center gap-1.5">
          <AlertTriangle className={cn("h-4 w-4", getRiskColor(rugRisk))} />
          <span className="text-sm font-medium">{rugRisk.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingUp className={cn("h-4 w-4", getConfidenceColor(confidence))} />
          <span className="text-sm font-medium">{confidence.toFixed(0)}%</span>
        </div>
        <Badge variant={score.eligible ? "default" : "destructive"}>
          {score.eligible ? "Eligible" : "Not Eligible"}
        </Badge>
      </div>
    );
  }

  return (
    <Card className={cn("p-6", className)}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{score.symbol}</h3>
            <p className="text-sm text-muted-foreground">
              {score.name} • {score.chain}
            </p>
          </div>
          <Badge variant={getRiskBadgeVariant(rugRisk)} className="h-fit">
            {score.eligible ? "✓ Eligible" : "✗ Not Eligible"}
          </Badge>
        </div>

        {/* AI Scores */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Rug Risk</span>
              </div>
              <span className={cn("font-bold", getRiskColor(rugRisk))}>
                {rugRisk.toFixed(1)}%
              </span>
            </div>
            <Progress value={rugRisk} className="h-2" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                <span className="font-medium">Confidence</span>
              </div>
              <span className={cn("font-bold", getConfidenceColor(confidence))}>
                {confidence.toFixed(1)}%
              </span>
            </div>
            <Progress value={confidence} className="h-2" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span className="font-medium">Liquidity</span>
              </div>
              <span className="font-bold">{liquidityStability.toFixed(1)}%</span>
            </div>
            <Progress value={liquidityStability} className="h-2" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                <span className="font-medium">Holder Dist</span>
              </div>
              <span className="font-bold">{holderDist.toFixed(1)}%</span>
            </div>
            <Progress value={holderDist} className="h-2" />
          </div>
        </div>

        {/* Market Data */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Market Cap</p>
            <p className="text-sm font-medium">
              ${(score.market_data.market_cap_usd / 1000).toFixed(1)}K
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Liquidity</p>
            <p className="text-sm font-medium">
              ${(score.market_data.liquidity_usd / 1000).toFixed(1)}K
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Holders</p>
            <p className="text-sm font-medium">
              {score.market_data.holder_count || 'N/A'}
            </p>
          </div>
        </div>

        {/* Risk Flags */}
        {score.risk_flags.length > 0 && (
          <div className="pt-4 border-t">
            <p className="text-sm font-medium mb-2">Risk Flags:</p>
            <div className="flex flex-wrap gap-2">
              {score.risk_flags.map((flag, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {flag.replace(/_/g, ' ').toLowerCase()}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Eligibility Reason */}
        {!score.eligible && score.eligibility_reason && (
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">Reason: </span>
            {score.eligibility_reason.replace(/_/g, ' ')}
          </div>
        )}

        <div className="text-xs text-muted-foreground pt-2">
          Scored at: {new Date(score.scored_at).toLocaleString()}
        </div>
      </div>
    </Card>
  );
}
