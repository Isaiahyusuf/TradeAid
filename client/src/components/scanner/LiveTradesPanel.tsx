import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TokenItem } from "@/hooks/use-memetrend";
import { MetricLabel } from "@/components/scanner/MetricLabel";

function whaleLabel(token: TokenItem) {
  return token.buys_1h >= 25 || token.volume_1h >= 100000;
}

export function LiveTradesPanel({ tokens }: { tokens: TokenItem[] }) {
  const rows = [...tokens]
    .sort((a, b) => (b.volume_1h || 0) - (a.volume_1h || 0))
    .slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Trades</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Waiting for live Solana swaps...</p>}
        {rows.map((token) => (
          <div key={token.id} className="p-3 rounded-lg border border-border flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">{token.symbol || token.name || "Unknown"}</p>
              <p className="text-xs text-muted-foreground"><MetricLabel label="Buys 1h" tooltip="Estimated number of buy transactions in the last 1 hour." className="inline-flex items-center gap-1 text-xs" />: {token.buys_1h || 0} · <MetricLabel label="Sells 1h" tooltip="Estimated number of sell transactions in the last 1 hour." className="inline-flex items-center gap-1 text-xs" />: {token.sells_1h || 0}</p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-xs text-muted-foreground"><MetricLabel label="Vol 1h" tooltip="Total traded USD volume over the last hour." className="inline-flex items-center gap-1 text-xs" /> ${(token.volume_1h || 0).toFixed(0)}</p>
              {whaleLabel(token) ? (
                <Badge className="bg-red-500/10 text-red-500">Whale Activity</Badge>
              ) : (
                <Badge variant="outline">Normal</Badge>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
