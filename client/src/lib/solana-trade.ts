import { Connection, VersionedTransaction } from "@solana/web3.js";

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
};

type QuoteRoute = {
  inAmount: string;
  outAmount: string;
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const QUOTE_API_URL = "https://quote-api.jup.ag/v6/quote";
const SWAP_API_URL = "https://quote-api.jup.ag/v6/swap";
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

function toLamports(amountSol: number): number {
  return Math.floor(amountSol * 1_000_000_000);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function getPhantomProvider(): PhantomProvider {
  const provider = window.solana;
  if (!provider?.isPhantom) {
    throw new Error("Phantom wallet not found. Install Phantom and reload.");
  }
  return provider;
}

export async function connectPhantomWallet(): Promise<string> {
  const provider = getPhantomProvider();
  const response = await provider.connect();
  return response.publicKey.toString();
}

export async function executeDirectBuy(params: { outputMint: string; amountSol: number; slippageBps?: number }) {
  const { outputMint, amountSol, slippageBps = 150 } = params;

  if (!outputMint) {
    throw new Error("Token mint address is missing.");
  }
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error("Enter a valid SOL amount.");
  }

  const provider = getPhantomProvider();
  const walletAddress = provider.publicKey?.toString() || (await connectPhantomWallet());
  const amountLamports = toLamports(amountSol);

  const quoteUrl = new URL(QUOTE_API_URL);
  quoteUrl.searchParams.set("inputMint", SOL_MINT);
  quoteUrl.searchParams.set("outputMint", outputMint);
  quoteUrl.searchParams.set("amount", String(amountLamports));
  quoteUrl.searchParams.set("slippageBps", String(slippageBps));
  quoteUrl.searchParams.set("onlyDirectRoutes", "false");

  const quoteResponse = await fetch(quoteUrl.toString());
  if (!quoteResponse.ok) {
    throw new Error("Unable to fetch Jupiter quote.");
  }

  const quotePayload = (await quoteResponse.json()) as { data?: QuoteRoute[] };
  const route = quotePayload.data?.[0];
  if (!route) {
    throw new Error("No swap route found for this token right now.");
  }

  const swapResponse = await fetch(SWAP_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: route,
      userPublicKey: walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!swapResponse.ok) {
    throw new Error("Unable to create swap transaction.");
  }

  const swapPayload = (await swapResponse.json()) as { swapTransaction?: string };
  if (!swapPayload.swapTransaction) {
    throw new Error("Swap transaction was empty.");
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const transactionBytes = base64ToBytes(swapPayload.swapTransaction);
  const transaction = VersionedTransaction.deserialize(transactionBytes);
  const signedTransaction = await provider.signTransaction(transaction);

  const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction(signature, "confirmed");

  return {
    signature,
    explorerUrl: `https://solscan.io/tx/${signature}`,
    walletAddress,
  };
}
