# AI Scoring Integration - Usage Guide

## Overview
AI scoring has been integrated into both the frontend and backend, allowing you to analyze tokens with AI-powered risk assessment.

## Quick Start

### 1. Use the Token Scanner Component
The easiest way to use AI scoring is with the pre-built `TokenScanner` component:

```tsx
import { TokenScanner } from "@/components/scanner/TokenScanner";

export default function MyPage() {
  return (
    <Layout>
      <TokenScanner />
    </Layout>
  );
}
```

### 2. Use AI Score Card for Display
If you already have token data and want to display the score:

```tsx
import { AIScoreCard } from "@/components/ai/AIScoreCard";
import { useTokenScore } from "@/hooks/use-ai-scoring";

export function MyTokenDisplay() {
  const { data: score, isLoading } = useTokenScore(
    "TokenMintAddressHere",
    "solana"
  );

  if (isLoading) return <div>Loading...</div>;
  if (!score) return null;

  return (
    <AIScoreCard score={score} />
    // Or compact version:
    // <AIScoreCard score={score} compact />
  );
}
```

### 3. Trigger Scoring Programmatically
Use the `useScoreToken` hook to manually trigger scoring:

```tsx
import { useScoreToken } from "@/hooks/use-ai-scoring";
import { Button } from "@/components/ui/button";

export function ScanButton({ address, chain }: { address: string; chain: string }) {
  const scoreToken = useScoreToken();

  const handleScan = () => {
    scoreToken.mutate({ contractAddress: address, chain });
  };

  return (
    <Button onClick={handleScan} disabled={scoreToken.isPending}>
      {scoreToken.isPending ? "Scanning..." : "Scan Token"}
    </Button>
  );
}
```

## Backend API Endpoints

### Score a Token
```
POST /api/scoring/score-token
Body: {
  "contract_address": "string",
  "chain": "solana" | "ethereum" | "bsc" | "base" | "arbitrum" | "polygon"
}
```

### Get Token Insight
```
GET /api/scoring/insight/:chain/:contract_address
Authentication: Required
```

### Get Token List
```
GET /api/tokens?chain=solana&offset=0&limit=20&age=5m
Authentication: Required
```

## Score Data Structure

```typescript
interface TokenScore {
  contract_address: string;
  chain: string;
  symbol: string;
  name: string;
  eligible: boolean;
  eligibility_reason?: string | null;
  risk_flags: string[];
  status: string;
  scores: {
    rug_probability: number;         // 0-100%
    liquidity_stability: number;     // 0-100%
    holder_distribution: number;     // 0-100%
    smart_wallet_signal: number;     // 0-100%
    trade_confidence_index: number;  // 0-100%
    rug_risk_score: number;          // 0-100%
    opportunity_score: number;       // 0-100%
  };
  market_data: {
    market_cap_usd: number;
    liquidity_usd: number;
    holder_count: number;
  };
  scored_at: string;
}
```

## Integration Examples

### Add to Existing Token List
```tsx
import { useTokenScore } from "@/hooks/use-ai-scoring";
import { AIScoreCard } from "@/components/ai/AIScoreCard";

export function TokenList({ tokens }: { tokens: TokenItem[] }) {
  return (
    <div className="space-y-4">
      {tokens.map((token) => {
        const { data: score } = useTokenScore(
          token.contract_address,
          token.chain,
          true // enabled
        );

        return (
          <div key={token.id}>
            <h3>{token.symbol}</h3>
            {score && <AIScoreCard score={score} compact />}
          </div>
        );
      })}
    </div>
  );
}
```

### Add to Token Detail Page
```tsx
import { useParams } from "wouter";
import { useTokenScore, useTokenInsight } from "@/hooks/use-ai-scoring";
import { AIScoreCard } from "@/components/ai/AIScoreCard";
import { Card } from "@/components/ui/card";

export default function TokenDetailPage() {
  const { chain, address } = useParams();
  
  const { data: score, isLoading: scoreLoading } = useTokenScore(
    address || "",
    chain || "solana"
  );
  
  const { data: insight } = useTokenInsight(
    chain || "solana",
    address || ""
  );

  return (
    <div className="space-y-6">
      {/* Token Info */}
      
      {/* AI Score */}
      {score && <AIScoreCard score={score} />}
      
      {/* AI Insight */}
      {insight && (
        <Card className="p-6">
          <h3 className="font-semibold mb-2">AI Insight</h3>
          <p className="text-sm mb-4">{insight.insight.summary}</p>
          <ul className="space-y-1">
            {insight.insight.key_points.map((point, i) => (
              <li key={i} className="text-sm text-muted-foreground">• {point}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
```

## Features

✅ **Real-time AI Scoring** - Analyze tokens instantly
✅ **Multi-chain Support** - Solana, Ethereum, BSC, Base, Arbitrum, Polygon
✅ **Risk Assessment** - Rug risk, liquidity stability, holder distribution
✅ **Confidence Scoring** - AI-powered trade confidence index
✅ **Market Data** - Market cap, liquidity, holder count
✅ **Eligibility Check** - Automatic trading eligibility determination
✅ **React Query Integration** - Automatic caching and refetching
✅ **Toast Notifications** - User-friendly feedback
✅ **Loading States** - Built-in loading indicators
✅ **Error Handling** - Graceful error management

## Deployment Status

Current deployment: **BUILDING** (8036a76d)
- ✅ Backend endpoints added
- ✅ Frontend API functions created
- ✅ AI Score components built
- ✅ React hooks implemented
- ⏳ Deploying to Railway...

Once the deployment completes (SUCCESS), all AI scoring functionality will be live!
