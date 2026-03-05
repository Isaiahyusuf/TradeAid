import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIScoreCard } from "@/components/ai/AIScoreCard";
import { useScoreToken, useTokenScore } from "@/hooks/use-ai-scoring";
import { Loader2, Search } from "lucide-react";

const SUPPORTED_CHAINS = [
  { value: "solana", label: "Solana" },
];

export function TokenScanner() {
  const [contractAddress, setContractAddress] = useState("");
  const [chain, setChain] = useState("solana");
  const [scoredToken, setScoredToken] = useState<{ address: string; chain: string } | null>(null);

  const scoreTokenMutation = useScoreToken();
  
  const { data: scoreData, isLoading: isLoadingScore } = useTokenScore(
    scoredToken?.address || "",
    scoredToken?.chain || "solana",
    !!scoredToken
  );

  const handleScan = () => {
    if (!contractAddress.trim()) return;

    scoreTokenMutation.mutate(
      { contractAddress: contractAddress.trim(), chain },
      {
        onSuccess: () => {
          setScoredToken({ address: contractAddress.trim(), chain });
        },
      }
    );
  };

  const isLoading = scoreTokenMutation.isPending || isLoadingScore;

  return (
    <div className="space-y-6">
      {/* Scanner Input */}
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-4">AI Token Scanner</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Enter a token contract address to analyze with AI-powered risk assessment
        </p>

        <div className="flex gap-4">
          <div className="flex-1">
            <Input
              placeholder="Enter contract address..."
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleScan();
              }}
              disabled={isLoading}
            />
          </div>

          <Select value={chain} onValueChange={setChain} disabled={isLoading}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select chain" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CHAINS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleScan} disabled={isLoading || !contractAddress.trim()}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Scan
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Score Display */}
      {scoreData && (
        <AIScoreCard score={scoreData} />
      )}

      {/* Quick Tips */}
      <Card className="p-6 bg-muted/50">
        <h3 className="font-semibold mb-2">How AI Scoring Works</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• <strong>Rug Risk:</strong> AI-calculated probability of a rug pull (0-100%)</li>
          <li>• <strong>Confidence Index:</strong> Overall trading confidence score</li>
          <li>• <strong>Liquidity Stability:</strong> Assessment of liquidity pool health</li>
          <li>• <strong>Holder Distribution:</strong> Analysis of token holder concentration</li>
        </ul>
      </Card>
    </div>
  );
}
