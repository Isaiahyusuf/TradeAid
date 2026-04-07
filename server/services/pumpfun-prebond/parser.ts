type ParsedTokenBalance = {
  mint?: string;
};

type ParsedTransactionShape = {
  meta?: {
    postTokenBalances?: ParsedTokenBalance[];
    preTokenBalances?: ParsedTokenBalance[];
  };
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
    };
  };
};

const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

const EXCLUDED_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

function isLikelyMint(value: string, pumpProgramId: string) {
  const mint = String(value || "").trim();
  if (!mint) return false;
  if (!BASE58_RE.test(mint)) return false;
  if (mint === pumpProgramId) return false;
  if (EXCLUDED_MINTS.has(mint)) return false;
  return true;
}

function pickFirstMint(candidates: string[], pumpProgramId: string): string {
  for (const candidate of candidates) {
    if (isLikelyMint(candidate, pumpProgramId)) {
      return candidate;
    }
  }
  return "";
}

export function extractMintFromLogs(logs: string[], pumpProgramId: string): string {
  const candidates: string[] = [];
  for (const raw of logs) {
    const line = String(raw || "");
    const matches = line.match(BASE58_RE) || [];
    for (const match of matches) {
      candidates.push(String(match || "").trim());
    }
  }
  return pickFirstMint(candidates, pumpProgramId);
}

export function extractMintFromParsedTransaction(tx: ParsedTransactionShape | null, pumpProgramId: string): string {
  if (!tx) return "";

  const postBalances = Array.isArray(tx.meta?.postTokenBalances) ? tx.meta!.postTokenBalances! : [];
  const preBalances = Array.isArray(tx.meta?.preTokenBalances) ? tx.meta!.preTokenBalances! : [];

  const postMints = postBalances.map((row) => String(row?.mint || "").trim());
  const postPicked = pickFirstMint(postMints, pumpProgramId);
  if (postPicked) return postPicked;

  const preMints = preBalances.map((row) => String(row?.mint || "").trim());
  const prePicked = pickFirstMint(preMints, pumpProgramId);
  if (prePicked) return prePicked;

  const keysRaw = Array.isArray(tx.transaction?.message?.accountKeys)
    ? tx.transaction!.message!.accountKeys!
    : [];
  const keys = keysRaw.map((item) => (typeof item === "string" ? item : String(item?.pubkey || ""))).map((item) => String(item || "").trim());
  return pickFirstMint(keys, pumpProgramId);
}
