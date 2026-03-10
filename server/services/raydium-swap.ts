import { BONK_MINT, SOL_MINT } from "./raydium-pools";

const JUP_PRIMARY_BASE = "https://quote-api.jup.ag/v6";
const JUP_FALLBACK_BASE = "https://lite-api.jup.ag/swap/v1";
const JUP_REQUEST_TIMEOUT_MS = Math.max(2500, Number(process.env.DOCTORTRADE_JUP_TIMEOUT_MS || 8000));
const JUP_RETRY_COUNT = Math.max(0, Math.min(4, Math.trunc(Number(process.env.DOCTORTRADE_JUP_RETRY_COUNT || 2))));

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

const delay = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url: string, init?: RequestInit): Promise<Record<string, any>> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= JUP_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), JUP_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...(init || {}),
        signal: controller.signal,
      });

      if (!response.ok) {
        if ((response.status >= 500 || response.status === 429) && attempt < JUP_RETRY_COUNT) {
          await delay((attempt + 1) * 250);
          continue;
        }
        throw new Error(`http_${response.status}`);
      }

      return (await response.json()) as Record<string, any>;
    } catch (error) {
      lastError = error;
      if (attempt >= JUP_RETRY_COUNT) {
        break;
      }
      await delay((attempt + 1) * 250);
    } finally {
      clearTimeout(timeout);
    }
  }

  const message = lastError instanceof Error ? lastError.message : "fetch_failed";
  throw new Error(message || "fetch_failed");
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

  const quoteEndpoints = [
    `${JUP_PRIMARY_BASE}/quote?${query.toString()}`,
    `${JUP_FALLBACK_BASE}/quote?${query.toString()}`,
  ];

  let lastMessage = "fetch_failed";
  for (const endpoint of quoteEndpoints) {
    try {
      return await fetchJsonWithRetry(endpoint);
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "fetch_failed";
    }
  }

  throw new Error(`raydium_quote_failed_${lastMessage}`);
}

export async function fetchRaydiumSwapPayload(params: {
  quoteResponse: Record<string, any>;
  userPublicKey: string;
  priorityFeeLamports?: number;
}): Promise<Record<string, any>> {
  const body = JSON.stringify({
    quoteResponse: params.quoteResponse,
    userPublicKey: params.userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: Math.max(0, Math.trunc(Number(params.priorityFeeLamports || process.env.DOCTORTRADE_PRIORITY_FEE_LAMPORTS || 0))),
  });

  const swapEndpoints = [
    `${JUP_PRIMARY_BASE}/swap`,
    `${JUP_FALLBACK_BASE}/swap`,
  ];

  let lastMessage = "fetch_failed";
  for (const endpoint of swapEndpoints) {
    try {
      return await fetchJsonWithRetry(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "fetch_failed";
    }
  }

  throw new Error(`raydium_swap_failed_${lastMessage}`);
}
