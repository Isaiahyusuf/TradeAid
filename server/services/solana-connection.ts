import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

const DEFAULT_HELIUS_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 350;

let singletonConnection: Connection | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getHeliusRpcUrl(): string {
  return String(process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || DEFAULT_HELIUS_RPC).trim();
}

export function getSolanaConnection(): Connection {
  if (!singletonConnection) {
    singletonConnection = new Connection(getHeliusRpcUrl(), "confirmed");
  }
  return singletonConnection;
}

export async function withSolanaRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; retryDelayMs?: number } = {},
): Promise<T> {
  const retries = Math.max(1, Math.trunc(options.retries ?? Number(process.env.SOLANA_RPC_RETRIES || DEFAULT_RETRY_COUNT)));
  const retryDelayMs = Math.max(100, Math.trunc(options.retryDelayMs ?? Number(process.env.SOLANA_RPC_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS)));

  let lastError: unknown;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i >= retries - 1) break;
      await delay(retryDelayMs * (i + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("solana_rpc_operation_failed");
}

export async function getTokenMintDecimals(mintAddress: string): Promise<number> {
  const normalized = String(mintAddress || "").trim();
  if (!normalized) return 0;
  if (normalized === "So11111111111111111111111111111111111111112") return 9;

  const mint = new PublicKey(normalized);
  const connection = getSolanaConnection();
  const mintInfo = await withSolanaRetry(() => getMint(connection, mint));
  return Number(mintInfo.decimals || 0);
}

export async function getTokenMintAuthorityInfo(mintAddress: string): Promise<{
  mintAuthorityDisabled: boolean;
  freezeAuthorityDisabled: boolean;
}> {
  const normalized = String(mintAddress || "").trim();
  if (!normalized) {
    return {
      mintAuthorityDisabled: false,
      freezeAuthorityDisabled: false,
    };
  }

  try {
    const mint = new PublicKey(normalized);
    const connection = getSolanaConnection();
    const mintInfo = await withSolanaRetry(() => getMint(connection, mint));
    return {
      mintAuthorityDisabled: mintInfo.mintAuthority === null,
      freezeAuthorityDisabled: mintInfo.freezeAuthority === null,
    };
  } catch {
    return {
      mintAuthorityDisabled: false,
      freezeAuthorityDisabled: false,
    };
  }
}
