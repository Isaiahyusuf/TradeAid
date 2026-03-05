import { BONK_MINT, SOL_MINT } from "./raydium-pools";

const JUP_QUOTE_BASE = "https://quote-api.jup.ag/v6";

export type RaydiumRoute = "raydium" | "raydium-clmm";

export type RaydiumQuoteParams = {
  inputMint: string;
  outputMint: string;
  amountAtomic: string | number;
  slippageBps: number;
};

export function getDoctorTradeBaseAssetMint(): string {
  const baseAsset = String(process.env.DOCTORTRADE_BASE_ASSET || "SOL").trim().toUpperCase();
  return baseAsset === "BONK" ? BONK_MINT : SOL_MINT;
}

function getRaydiumDexesParam(): string {
  return String(process.env.RAYDIUM_ONLY_DEXES || "Raydium,Raydium CLMM").trim();
}

export async function fetchRaydiumQuote(params: RaydiumQuoteParams): Promise<Record<string, any>> {
  const query = new URLSearchParams({
    inputMint: String(params.inputMint || "").trim(),
    outputMint: String(params.outputMint || "").trim(),
    amount: String(params.amountAtomic),
    slippageBps: String(Math.max(1, Math.trunc(params.slippageBps || 100))),
    restrictIntermediateTokens: "true",
    onlyDirectRoutes: "false",
    dexes: getRaydiumDexesParam(),
  });

  const response = await fetch(`${JUP_QUOTE_BASE}/quote?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`raydium_quote_failed_${response.status}`);
  }

  return (await response.json()) as Record<string, any>;
}

export async function fetchRaydiumSwapPayload(params: {
  quoteResponse: Record<string, any>;
  userPublicKey: string;
  priorityFeeLamports?: number;
}): Promise<Record<string, any>> {
  const response = await fetch(`${JUP_QUOTE_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: Math.max(0, Math.trunc(Number(params.priorityFeeLamports || process.env.DOCTORTRADE_PRIORITY_FEE_LAMPORTS || 0))),
    }),
  });

  if (!response.ok) {
    throw new Error(`raydium_swap_failed_${response.status}`);
  }

  return (await response.json()) as Record<string, any>;
}
