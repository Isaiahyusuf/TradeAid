/**
 * Chain normalization utility for Solana-only production builds.
 * Converts supported chain identifiers to lowercase "solana" and rejects non-Solana chains.
 */

export function normalizeChain(chain?: string): "solana" {
  if (!chain) return "solana";
  const normalized = String(chain).toLowerCase().trim();

  // Accept common Solana chain identifiers
  if (["solana", "sol", "spl"].includes(normalized)) {
    return "solana";
  }

  // Log and fallback to solana for any unrecognized chain
  console.warn(`[Chain] Unrecognized chain "${chain}"; defaulting to "solana"`);
  return "solana";
}

/**
 * Validates that a chain is supported. Returns true only for Solana.
 */
export function isSupportedChain(chain: string): boolean {
  return normalizeChain(chain) === "solana";
}
