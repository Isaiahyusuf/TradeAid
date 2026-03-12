import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ShieldAlert } from "lucide-react";

export default function Disclaimer() {
  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-4">
        <Card className="solana-card animate-fade-in-up border-amber-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
              DoctorTrade Disclaimer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              DoctorTrade is a decision-support and execution-assist tool. It is designed to help you analyze and act faster,
              but it does not guarantee profitable outcomes.
            </p>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="font-medium text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                No Profit Guarantee
              </p>
              <p className="mt-2 text-xs text-amber-100/90">
                Market volatility, liquidity shocks, slippage, outages, and execution delays can cause losses. Use strict risk controls
                and only trade with capital you can afford to lose.
              </p>
            </div>

            <ul className="list-disc pl-5 space-y-1">
              <li>DoctorTrade signals and automation are informational and assistive, not financial advice.</li>
              <li>You remain fully responsible for configuration, execution decisions, and account risk.</li>
              <li>Always verify wallet, slippage, position size, and stop conditions before enabling live trading.</li>
              <li>Use the kill switch immediately if behavior is not as expected.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
