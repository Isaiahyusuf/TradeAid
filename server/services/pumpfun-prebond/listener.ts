import { Connection, PublicKey } from "@solana/web3.js";
import { extractMintFromLogs, extractMintFromParsedTransaction } from "./parser";
import { PrebondQueue } from "./queue";

export type PrebondDetection = {
  mint: string;
  signature: string;
  source: string;
};

type ListenerCallbacks = {
  onDetected: (token: PrebondDetection) => void;
};

const PUMPFUN_PROGRAM_ID = String(process.env.PUMPFUN_PROGRAM_ID || "6EF8rrecthR5Dkzon8Nwu78hRjzJ3AL9rS6pNqB7pump").trim();
const ENABLE_PUMP_INGEST_LOGS = String(process.env.ENABLE_PUMP_INGEST_LOGS || "false").trim().toLowerCase() === "true";

let started = false;

function getRpcUrl() {
  const helius = String(process.env.HELIUS_RPC_URL || "").trim();
  if (helius) return helius;
  const solana = String(process.env.SOLANA_RPC_URL || "").trim();
  if (solana) return solana;
  return "https://api.mainnet-beta.solana.com";
}

function logIfEnabled(message: string, meta?: Record<string, unknown>) {
  if (!ENABLE_PUMP_INGEST_LOGS) return;
  if (meta) {
    console.log(message, JSON.stringify(meta));
    return;
  }
  console.log(message);
}

export function startPumpFunPrebondListener(callbacks: ListenerCallbacks) {
  if (started) return;
  started = true;

  const rpcUrl = getRpcUrl();
  const connection = new Connection(rpcUrl, "processed");
  const program = new PublicKey(PUMPFUN_PROGRAM_ID);
  const seen = new Map<string, number>();

  const pruneSeen = (nowMs: number) => {
    const ttlMs = Math.max(60_000, Number(process.env.PREBOND_LISTENER_SEEN_TTL_MS || 10 * 60 * 1000));
    for (const [signature, seenAt] of Array.from(seen.entries())) {
      if (nowMs - seenAt > ttlMs) {
        seen.delete(signature);
      }
    }
  };

  const queue = new PrebondQueue(async (job) => {
    let mint = extractMintFromLogs(job.logs, PUMPFUN_PROGRAM_ID);

    if (!mint) {
      const tx = await connection.getParsedTransaction(job.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "processed",
      });
      mint = extractMintFromParsedTransaction(tx as any, PUMPFUN_PROGRAM_ID);
    }

    if (!mint) return;

    callbacks.onDetected({
      mint,
      signature: job.signature,
      source: "pumpfun_prebond_listener",
    });

    logIfEnabled("[Prebond] token detected", {
      mint,
      signature: job.signature,
      slot: job.slot,
    });
  }, Math.max(500, Number(process.env.PREBOND_QUEUE_MAX_DEPTH || 2500)));

  connection.onLogs(program, (event, context) => {
    // Keep callback ultra-fast: dedupe then queue only, no await/network here.
    if (event.err) return;

    const signature = String(event.signature || "").trim();
    if (!signature) return;

    const nowMs = Date.now();
    pruneSeen(nowMs);
    if (seen.has(signature)) return;
    seen.set(signature, nowMs);

    queue.enqueue({
      signature,
      slot: Number(context?.slot || 0),
      logs: Array.isArray(event.logs) ? event.logs.map((line) => String(line || "")) : [],
      seenAtMs: nowMs,
    });
  }, "processed");

  console.log("[Prebond] Pump.fun listener started (commitment=processed)");
}
