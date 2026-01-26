import OpenAI from "openai";
import type { DexPair } from "./dexscreener";
import type { SafetyReport } from "./safety-analyzer";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

export interface AIAnalysis {
  summary: string;
  signal: "strong_buy" | "buy" | "hold" | "sell" | "avoid";
  confidence: number;
  entryPrice: string | null;
  targetPrice: string | null;
  stopLoss: string | null;
  reasoning: string;
  risks: string[];
  catalysts: string[];
}

export async function analyzeTokenWithAI(
  pair: DexPair,
  safety: SafetyReport
): Promise<AIAnalysis> {
  const tokenData = {
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    chain: pair.chainId,
    priceUsd: pair.priceUsd,
    liquidity: pair.liquidity?.usd || 0,
    volume24h: pair.volume?.h24 || 0,
    marketCap: pair.marketCap || pair.fdv || 0,
    priceChange1h: pair.priceChange?.h1 || 0,
    priceChange24h: pair.priceChange?.h24 || 0,
    buys24h: pair.txns?.h24?.buys || 0,
    sells24h: pair.txns?.h24?.sells || 0,
    ageHours: Math.round((Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)),
    safetyScore: safety.score,
    riskLevel: safety.riskLevel,
    isHoneypot: safety.isHoneypot,
    risks: safety.risks,
    positives: safety.positives,
    hasSocials: pair.info?.socials && pair.info.socials.length > 0,
    hasWebsite: pair.info?.websites && pair.info.websites.length > 0,
  };

  const prompt = `You are an expert crypto token analyst. Analyze this token and provide trading recommendations.

TOKEN DATA:
${JSON.stringify(tokenData, null, 2)}

Based on this data, provide:
1. A brief 1-2 sentence summary
2. A trading signal: strong_buy, buy, hold, sell, or avoid
3. Confidence level (0-100)
4. Entry price recommendation (or "wait" if not good time)
5. Target price (realistic short-term target based on momentum)
6. Stop loss level
7. Key reasoning (2-3 sentences)
8. Top 2 risks
9. Top 2 potential catalysts/positives

Respond ONLY with valid JSON in this exact format:
{
  "summary": "string",
  "signal": "strong_buy|buy|hold|sell|avoid",
  "confidence": number,
  "entryPrice": "string or null",
  "targetPrice": "string or null", 
  "stopLoss": "string or null",
  "reasoning": "string",
  "risks": ["string", "string"],
  "catalysts": ["string", "string"]
}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You are a crypto trading analyst. Always respond with valid JSON only, no markdown." },
        { role: "user", content: prompt }
      ],
      max_completion_tokens: 500,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const analysis = JSON.parse(jsonMatch[0]) as AIAnalysis;
    return {
      ...analysis,
      confidence: Math.min(100, Math.max(0, analysis.confidence)),
    };
  } catch (error) {
    console.error("AI analysis error:", error);
    return {
      summary: `${pair.baseToken.symbol} token on ${pair.chainId}. Safety score: ${safety.score}/100.`,
      signal: safety.riskLevel === "critical" || safety.riskLevel === "high" ? "avoid" : "hold",
      confidence: safety.score,
      entryPrice: null,
      targetPrice: null,
      stopLoss: null,
      reasoning: `Based on safety analysis. ${safety.risks[0] || "Monitor for changes."}`,
      risks: safety.risks.slice(0, 2),
      catalysts: safety.positives.slice(0, 2),
    };
  }
}

export async function generateQuickInsight(pair: DexPair): Promise<string> {
  const volume = pair.volume?.h24 || 0;
  const liquidity = pair.liquidity?.usd || 0;
  const priceChange = pair.priceChange?.h24 || 0;
  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;
  const ageHours = Math.round((Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60));

  let insight = `${pair.baseToken.symbol}`;
  
  if (ageHours < 24) insight += ` (New: ${ageHours}h old)`;
  
  if (priceChange > 100) insight += ` | Pumping +${priceChange.toFixed(0)}%`;
  else if (priceChange > 50) insight += ` | Rising +${priceChange.toFixed(0)}%`;
  else if (priceChange < -50) insight += ` | Dumping ${priceChange.toFixed(0)}%`;
  
  if (volume > 100000) insight += ` | High vol $${(volume/1000).toFixed(0)}K`;
  if (liquidity > 50000) insight += ` | Good liq $${(liquidity/1000).toFixed(0)}K`;
  else if (liquidity < 5000) insight += ` | Low liq $${(liquidity/1000).toFixed(1)}K`;
  
  if (buys > sells * 2) insight += ` | Strong buys`;
  else if (sells > buys * 2) insight += ` | Heavy sells`;
  
  return insight;
}
