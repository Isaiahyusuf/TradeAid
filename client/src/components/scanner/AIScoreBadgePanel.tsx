import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TokenItem } from "@/hooks/use-memetrend";
import { MetricLabel } from "@/components/scanner/MetricLabel";

function pct(value: number) {
  return value > 1 ? value : value * 100;
}

export function AIScoreBadgePanel({ token }: { token: TokenItem | null }) {
  const confidence = token?.latest_score ? pct(token.latest_score.trade_confidence_index) : 0;
  const rug = token?.latest_score ? pct(token.latest_score.rug_probability) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Score / Prediction</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1"><MetricLabel label="Confidence" tooltip="Overall trade confidence from AI scoring. Higher values indicate stronger short-term trade quality." className="inline-flex items-center gap-1 text-sm" /><span>{confidence.toFixed(0)}</span></div>
          <Progress value={confidence} />
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1"><MetricLabel label="Rug Probability" tooltip="AI-estimated chance of rug-style behavior. Lower is safer." className="inline-flex items-center gap-1 text-sm" /><span>{rug.toFixed(0)}</span></div>
          <Progress value={rug} />
        </div>
      </CardContent>
    </Card>
  );
}
