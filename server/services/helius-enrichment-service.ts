import { logStructured } from "./structured-logger";

export interface HeliusEnrichment {
  mintAddress: string;
  supply: number | null;
  authorities: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    mintAuthorityActive: boolean;
    freezeAuthorityActive: boolean;
  };
  holdersCount: number | null;
  metadata: Record<string, unknown>;
}

async function heliusRpcCall<T>(apiKey: string, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method,
      params,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Helius ${method} failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload?.error) {
    throw new Error(payload.error.message || `Helius ${method} returned error`);
  }

  return payload.result as T;
}

export async function enrichTokenWithHelius(mintAddress: string): Promise<HeliusEnrichment> {
  const heliusApiKey = String(process.env.HELIUS_API_KEY || "").trim();
  if (!heliusApiKey) {
    logStructured("warn", "helius.missing_key", { mintAddress });
    return {
      mintAddress,
      supply: null,
      authorities: {
        mintAuthority: null,
        freezeAuthority: null,
        mintAuthorityActive: false,
        freezeAuthorityActive: false,
      },
      holdersCount: null,
      metadata: {},
    };
  }

  try {
    type AssetResult = {
      token_info?: {
        supply?: number;
        mint_authority?: string | null;
        freeze_authority?: string | null;
      };
      content?: {
        metadata?: Record<string, unknown>;
      };
    };

    const assetResult = await heliusRpcCall<AssetResult>(heliusApiKey, "getAsset", { id: mintAddress });

    let holdersCount: number | null = null;
    try {
      type TokenAccountsResult = { total?: number };
      const holdersResult = await heliusRpcCall<TokenAccountsResult>(heliusApiKey, "getTokenAccounts", {
        mint: mintAddress,
        page: 1,
        limit: 1,
      });
      if (typeof holdersResult?.total === "number") {
        holdersCount = holdersResult.total;
      }
    } catch (holderError) {
      logStructured("warn", "helius.holder_count_unavailable", {
        mintAddress,
        message: holderError instanceof Error ? holderError.message : "Unknown error",
      });
    }

    const mintAuthority = assetResult?.token_info?.mint_authority ?? null;
    const freezeAuthority = assetResult?.token_info?.freeze_authority ?? null;
    const metadata = (assetResult?.content?.metadata || {}) as Record<string, unknown>;

    const enrichment: HeliusEnrichment = {
      mintAddress,
      supply: typeof assetResult?.token_info?.supply === "number" ? assetResult.token_info.supply : null,
      authorities: {
        mintAuthority,
        freezeAuthority,
        mintAuthorityActive: !!mintAuthority,
        freezeAuthorityActive: !!freezeAuthority,
      },
      holdersCount,
      metadata,
    };

    logStructured("info", "helius.enrichment_success", {
      mintAddress,
      holdersCount,
      supply: enrichment.supply,
      mintAuthorityActive: enrichment.authorities.mintAuthorityActive,
      freezeAuthorityActive: enrichment.authorities.freezeAuthorityActive,
    });

    return enrichment;
  } catch (error) {
    logStructured("error", "helius.enrichment_failed", {
      mintAddress,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      mintAddress,
      supply: null,
      authorities: {
        mintAuthority: null,
        freezeAuthority: null,
        mintAuthorityActive: false,
        freezeAuthorityActive: false,
      },
      holdersCount: null,
      metadata: {},
    };
  }
}
