import { logStructured } from "./structured-logger";

const APIFY_API_BASE = "https://api.apify.com/v2";
const DEFAULT_PUMPFUN_ACTOR_ID = "mscrpt/pump-fun-real-time-monitor";

export interface FreshTokenItem {
  mintAddress: string;
  name: string;
  symbol: string;
  creator: string | null;
  liquidityUsd: number | null;
  eventType: string;
  raw: Record<string, unknown>;
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

export async function fetchFreshPumpfunTokens(limit = 20): Promise<FreshTokenItem[]> {
  const apifyToken = String(process.env.APIFY_TOKEN || "").trim();
  const actorId = String(process.env.APIFY_PUMPFUN_ACTOR_ID || DEFAULT_PUMPFUN_ACTOR_ID).trim();

  if (!apifyToken) {
    const error = new Error("APIFY_TOKEN is missing");
    logStructured("error", "apify.missing_token", { actorId });
    throw error;
  }

  const runsUrl = `${APIFY_API_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(apifyToken)}&status=SUCCEEDED&desc=1&limit=1`;

  try {
    const runsResponse = await fetch(runsUrl);
    if (!runsResponse.ok) {
      const body = await runsResponse.text();
      logStructured("error", "apify.runs_request_failed", {
        status: runsResponse.status,
        actorId,
        body: body.slice(0, 400),
      });
      throw new Error(`Apify runs request failed with ${runsResponse.status}`);
    }

    const runsPayload = await runsResponse.json() as {
      data?: { items?: Array<{ defaultDatasetId?: string; id?: string }> };
    };

    const run = runsPayload?.data?.items?.[0];
    const datasetId = String(run?.defaultDatasetId || "").trim();
    if (!datasetId) {
      logStructured("warn", "apify.no_dataset_found", { actorId, runId: run?.id || null });
      return [];
    }

    const itemsUrl = `${APIFY_API_BASE}/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(apifyToken)}&clean=true&desc=1&limit=${Math.max(1, Math.min(100, limit))}`;
    const itemsResponse = await fetch(itemsUrl);
    if (!itemsResponse.ok) {
      const body = await itemsResponse.text();
      logStructured("error", "apify.items_request_failed", {
        status: itemsResponse.status,
        actorId,
        datasetId,
        body: body.slice(0, 400),
      });
      throw new Error(`Apify dataset items request failed with ${itemsResponse.status}`);
    }

    const itemsPayload = await itemsResponse.json() as Array<Record<string, unknown>>;
    const normalized = (Array.isArray(itemsPayload) ? itemsPayload : [])
      .map((item) => {
        const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const eventType = pickString(record, ["eventType", "event_type", "type"]).toLowerCase();
        return {
          mintAddress: pickString(record, ["mintAddress", "mint", "tokenAddress", "address"]),
          name: pickString(record, ["name", "tokenName"]),
          symbol: pickString(record, ["symbol", "tokenSymbol"]),
          creator: pickString(record, ["creator", "creatorAddress", "owner"]) || null,
          liquidityUsd: pickNumber(record, ["liquidityUsd", "liquidity_usd", "liquidity", "initialLiquidityUsd"]),
          eventType,
          raw: record,
        } satisfies FreshTokenItem;
      })
      .filter((item) => item.eventType === "new_token" && !!item.mintAddress);

    logStructured("info", "apify.fresh_tokens_fetched", {
      actorId,
      datasetId,
      totalItems: Array.isArray(itemsPayload) ? itemsPayload.length : 0,
      freshTokenCount: normalized.length,
    });

    return normalized;
  } catch (error) {
    logStructured("error", "apify.fetch_failed", {
      actorId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
