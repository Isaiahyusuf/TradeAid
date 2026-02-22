import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TokenItem } from "@/hooks/use-memetrend";
import { MetricLabel } from "@/components/scanner/MetricLabel";

function pct(value: number) {
  return value > 1 ? value : value * 100;
}

export function RiskAnalysisPanel({ token }: { token: TokenItem | null }) {
  const score = token?.latest_score;
  const rugRisk = score ? pct(score.rug_probability) : 0;
  const holderRisk = token?.top_holders_pct ?? 0;
  const mintRisk = token?.is_mintable ? 90 : 10;
  const freezeRisk = token?.is_ownership_renounced ? 20 : 80;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk Analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="flex justify-between mb-1"><MetricLabel label="Rug Risk Score" tooltip="AI-estimated probability of rug-pull behavior from liquidity, holder, and trading signals." /><span className={rugRisk > 60 ? "text-red-500" : "text-green-500"}>{rugRisk.toFixed(0)}/100</span></div>
          <Progress value={rugRisk} />
        </div>
        <div>
          <div className="flex justify-between mb-1"><MetricLabel label="Top Holder Concentration" tooltip="Percent of supply controlled by top wallets. Higher concentration usually increases manipulation risk." /><span>{holderRisk ? `${holderRisk}%` : "Unknown"}</span></div>
          <Progress value={holderRisk || 0} />
        </div>
        <div>
          <div className="flex justify-between mb-1"><MetricLabel label="Mint Authority Risk" tooltip="If mint authority exists, supply can still be increased, which can dilute holders." /><span>{token?.is_mintable ? "Risky" : "Safer"}</span></div>
          <Progress value={mintRisk} />
        </div>
        <div>
          <div className="flex justify-between mb-1"><MetricLabel label="Freeze Authority Risk" tooltip="If freeze authority remains, token transfers can potentially be restricted by the authority wallet." /><span>{token?.is_ownership_renounced ? "Safer" : "Risky"}</span></div>
          <Progress value={freezeRisk} />
        </div>
        <div className="text-xs text-muted-foreground">
          Liquidity lock and honeypot checks are inferred from available on-chain and pool signals.
        </div>
      </CardContent>
    </Card>
  );
}
