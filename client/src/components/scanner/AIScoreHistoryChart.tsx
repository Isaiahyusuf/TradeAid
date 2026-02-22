import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreResult } from "@/hooks/use-rugcheck";
import { MetricLabel } from "@/components/scanner/MetricLabel";

function pct(value: number) {
  return value > 1 ? value : value * 100;
}

type AIScoreHistoryChartProps = {
  history: ScoreResult[];
  isLoading?: boolean;
};

export function AIScoreHistoryChart({ history, isLoading }: AIScoreHistoryChartProps) {
  const points = [...history]
    .reverse()
    .slice(-24)
    .map((entry, index) => ({
      index,
      confidence: pct(entry.trade_confidence_index || 0),
      rug: pct(entry.rug_probability || 0),
      at: entry.scored_at,
    }));

  const width = 600;
  const height = 180;
  const padding = 20;

  const toPath = (values: number[]) => {
    if (!values.length) return "";
    return values
      .map((value, i) => {
        const x = padding + (i * (width - padding * 2)) / Math.max(values.length - 1, 1);
        const y = height - padding - (Math.min(Math.max(value, 0), 100) / 100) * (height - padding * 2);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  };

  const confidencePath = toPath(points.map((p) => p.confidence));
  const rugPath = toPath(points.map((p) => p.rug));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <MetricLabel
            label="Historical AI Score"
            tooltip="Timeline of trade confidence (green) and rug probability (red) for the selected token. New points are appended as rescoring happens."
            className="inline-flex items-center gap-1"
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-44 w-full" />
        ) : points.length < 2 ? (
          <p className="text-sm text-muted-foreground">Not enough score history yet. Run more scans to build the chart.</p>
        ) : (
          <>
            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[420px] h-44">
                <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="stroke-border" strokeWidth="1" />
                <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="stroke-border" strokeWidth="1" />
                <path d={confidencePath} fill="none" className="stroke-emerald-500" strokeWidth="2.5" />
                <path d={rugPath} fill="none" className="stroke-rose-500" strokeWidth="2.5" />
              </svg>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500" />Confidence</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-rose-500" />Rug Probability</span>
              <span>Latest: {points[points.length - 1]?.at ? new Date(points[points.length - 1].at as string).toLocaleString() : "-"}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
