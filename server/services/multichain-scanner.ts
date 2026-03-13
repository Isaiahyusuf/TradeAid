import { storage } from "../storage";
import type { InsertScannedToken } from "@shared/schema";
import { logStructured } from "./structured-logger";
import WebSocket from "ws";

interface LaunchpadToken {
  address: string;
  symbol: string;
  name: string;
  chain: "solana" | "ethereum" | "bsc" | "base";
  launchpad: string;
  priceUsd: string;
  liquidity: number;
  marketCap: number;
  volume24h: number;
  holders?: number;
  topHoldersPercentage: number;
  devWalletPercentage: number;
  createdAt: Date;
}

interface HolderInfo {
  address: string;
  balance: number;
  percentage: number;
  isDevWallet: boolean;
  isContract: boolean;
}

interface PumpLaunchEvent {
  mint: string;
  creator: string;
  signature: string;
  detectedAt: Date;
  retries: number;
  source?: string;
}

// Only Solana launchpads are supported in production builds for this app.
const LAUNCHPADS = {
  solana: [
    { name: "pump.fun", url: "https://frontend-api.pump.fun" },
    { name: "moonshot", url: "https://api.moonshot.cc" },
  ],
};

const SAFE_THRESHOLDS = {
  maxTopHoldersPercentage: 30,
  maxDevWalletPercentage: 10,
  minLiquidity: 10000,
  minHolders: 50,
  maxSingleHolderPercentage: 15,
};

const EXCLUDED_SOL_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
]);

const EXCLUDED_SOL_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT", "USD1", "USDC.S"]);
const PUMPFUN_PROGRAM_ID = String(process.env.PUMPFUN_PROGRAM_ID || "6EF8rrecthR5Dkzon8Nwu78hRjzJ3AL9rS6pNqB7pump").trim();
const RAYDIUM_AMM_PROGRAM_ID = String(process.env.RAYDIUM_AMM_PROGRAM_ID || "675kPX9MHTjS2zt1qfr1NYHuzeFvQy2f6YvP6Vf3wGZ").trim();
const RAYDIUM_CLMM_PROGRAM_ID = String(process.env.RAYDIUM_CLMM_PROGRAM_ID || "").trim();
const RAYDIUM_CPMM_PROGRAM_ID = String(process.env.RAYDIUM_CPMM_PROGRAM_ID || "").trim();
const RAYDIUM_PROGRAM_IDS = Array.from(new Set([
  RAYDIUM_AMM_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
].filter((value) => Boolean(value))));
const SOLANA_RPC_FALLBACK = "https://api.mainnet-beta.solana.com";
const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const FRESH_LISTENER_MAX_AGE_SECONDS = Math.max(
  1,
  Number(
    process.env.PUMP_LISTENER_MAX_AGE_SECONDS
      || process.env.FRESH_SNIPER_MAX_TOKEN_AGE_SECONDS
      || 5,
  ),
);
const FRESH_LISTENER_MAX_AGE_MINUTES = FRESH_LISTENER_MAX_AGE_SECONDS / 60;

export class MultichainLaunchpadScanner {
  private isScanning = false;
  private runtimeInitialized = false;
  private readonly scannerInstanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly emittedFreshMints = new Map<string, number>();
  private pumpListenerStarted = false;
  private readonly pendingPumpLaunches: PumpLaunchEvent[] = [];
  private readonly seenPumpSignatures = new Map<string, number>();
  private readonly seenPumpMints = new Map<string, number>();
  private supplementalListenersStarted = false;
  private readonly seenPumpFeedMints = new Map<string, number>();
  private readonly seenDexProfileMints = new Map<string, number>();
  private readonly seenRaydiumSignatures = new Map<string, number>();
  private lastRaydiumPollReportAt = 0;

  private getSolanaWsUrl() {
    return String(process.env.SOLANA_WS_URL || "").trim();
  }

  private getSolanaRpcUrl() {
    return String(process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || SOLANA_RPC_FALLBACK).trim();
  }

  private prunePumpListenerCaches(nowMs = Date.now()) {
    const ttlMs = Math.max(60_000, Number(process.env.PUMP_LISTENER_SEEN_TTL_MS || 30 * 60 * 1000));
    for (const [signature, seenAt] of Array.from(this.seenPumpSignatures.entries())) {
      if (nowMs - seenAt > ttlMs) {
        this.seenPumpSignatures.delete(signature);
      }
    }
    for (const [mint, seenAt] of Array.from(this.seenPumpMints.entries())) {
      if (nowMs - seenAt > ttlMs) {
        this.seenPumpMints.delete(mint);
      }
    }
    for (const [mint, seenAt] of Array.from(this.seenPumpFeedMints.entries())) {
      if (nowMs - seenAt > ttlMs) {
        this.seenPumpFeedMints.delete(mint);
      }
    }
    for (const [mint, seenAt] of Array.from(this.seenDexProfileMints.entries())) {
      if (nowMs - seenAt > ttlMs) {
        this.seenDexProfileMints.delete(mint);
      }
    }
    for (const [signature, seenAt] of Array.from(this.seenRaydiumSignatures.entries())) {
      if (nowMs - seenAt > ttlMs) {
        this.seenRaydiumSignatures.delete(signature);
      }
    }
  }

  private enqueueDetectedMint(mint: string, creator: string, signature: string, source: string) {
    const normalizedMint = String(mint || "").trim();
    if (!normalizedMint || EXCLUDED_SOL_MINTS.has(normalizedMint)) return;

    const nowMs = Date.now();
    this.prunePumpListenerCaches(nowMs);
    if (this.seenPumpMints.has(normalizedMint)) return;

    this.seenPumpMints.set(normalizedMint, nowMs);
    this.seenPumpSignatures.set(signature, nowMs);
    this.pendingPumpLaunches.unshift({
      mint: normalizedMint,
      creator: String(creator || "").trim(),
      signature,
      detectedAt: new Date(),
      retries: 0,
      source,
    });

    console.log("[Pipeline] NEW TOKEN DETECTED");
    console.log(`[Pipeline] Source: ${source}`);
    console.log(`[Pipeline] Mint: ${normalizedMint}`);
    console.log(`[Pipeline] Creator: ${String(creator || "unknown")}`);
    console.log(`[Pipeline] Signature: ${signature}`);
  }

  private startSupplementalLaunchListeners() {
    if (this.supplementalListenersStarted) return;
    this.supplementalListenersStarted = true;

    const pumpIntervalMs = Math.max(2_000, Number(process.env.PUMPFUN_FEED_POLL_MS || 5_000));
    const dexIntervalMs = Math.max(4_000, Number(process.env.DEX_PROFILES_POLL_MS || 10_000));
    const raydiumIntervalMs = Math.max(4_000, Number(process.env.RAYDIUM_POOLS_POLL_MS || 8_000));

    console.log("[Pipeline] Supplemental listeners started (pumpfun feed + dex profiles + raydium pools)");

    void this.pollPumpFunFeed();
    setInterval(() => {
      void this.pollPumpFunFeed();
    }, pumpIntervalMs);

    void this.pollDexProfiles();
    setInterval(() => {
      void this.pollDexProfiles();
    }, dexIntervalMs);

    void this.pollRaydiumPools();
    setInterval(() => {
      void this.pollRaydiumPools();
    }, raydiumIntervalMs);
  }

  private async pollPumpFunFeed() {
    try {
      const response = await fetch("https://frontend-api.pump.fun/coins?offset=0&limit=100&sort=created_timestamp&order=DESC&includeNsfw=false");
      if (!response.ok) return;
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload as Array<Record<string, any>> : [];

      let added = 0;
      const nowMs = Date.now();
      for (const row of rows) {
        const mint = String(row?.mint || row?.address || "").trim();
        if (!mint || EXCLUDED_SOL_MINTS.has(mint) || this.seenPumpFeedMints.has(mint)) continue;
        this.seenPumpFeedMints.set(mint, nowMs);
        this.enqueueDetectedMint(mint, String(row?.creator || "").trim(), `pumpfeed:${mint}:${nowMs}`, "pumpfun_feed");
        added += 1;
      }
      if (added > 0) {
        console.log(`[Pipeline] Pump.fun feed added ${added} new mints`);
      }
    } catch {
    }
  }

  private async pollDexProfiles() {
    try {
      const response = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
      if (!response.ok) return;
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload as Array<Record<string, any>> : [];

      let added = 0;
      const nowMs = Date.now();
      for (const row of rows) {
        if (String(row?.chainId || "") !== "solana") continue;
        const mint = String(row?.tokenAddress || "").trim();
        if (!mint || EXCLUDED_SOL_MINTS.has(mint) || this.seenDexProfileMints.has(mint)) continue;
        this.seenDexProfileMints.set(mint, nowMs);
        this.enqueueDetectedMint(mint, "", `dexprofile:${mint}:${nowMs}`, "dexscreener_profiles");
        added += 1;
      }
      if (added > 0) {
        console.log(`[Pipeline] Dex profiles added ${added} new mints`);
      }
    } catch {
    }
  }

  private async rpcCall(method: string, params: any[]) {
    const rpcUrl = this.getSolanaRpcUrl();
    if (!rpcUrl) return null;
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.result ?? null;
  }

  private extractRaydiumInitializeMints(tx: Record<string, any> | null) {
    const message = (tx?.transaction?.message || {}) as Record<string, any>;
    const instructions = Array.isArray(message?.instructions) ? message.instructions as Array<Record<string, any>> : [];
    const accountKeys = this.getTxAccountKeys(tx);
    const mints: string[] = [];
    const seen = new Set<string>();

    const pushMint = (value: unknown) => {
      const mint = String(value || "").trim();
      if (!mint) return;
      if (seen.has(mint)) return;
      if (EXCLUDED_SOL_MINTS.has(mint)) return;
      if (RAYDIUM_PROGRAM_IDS.includes(mint)) return;
      if (mint === PUMPFUN_PROGRAM_ID) return;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;

      seen.add(mint);
      mints.push(mint);
    };

    for (const instruction of instructions) {
      const programId = this.getInstructionProgramId(instruction, accountKeys);
      if (!RAYDIUM_PROGRAM_IDS.includes(programId)) continue;

      const parsed = (instruction?.parsed || {}) as Record<string, any>;
      const parsedType = String(parsed?.type || "").toLowerCase();
      // Some Raydium/CPMM txs are exposed as initialize2/initialize without explicit pool keyword.
      if (!parsedType.includes("initialize")) continue;

      const info = (parsed?.info || {}) as Record<string, any>;
      for (const key of ["coinMint", "pcMint", "baseMint", "quoteMint", "tokenMint"]) {
        pushMint(info?.[key]);
      }
    }

    // Fallback for txs where parser omits mint fields but logs indicate pool initialization.
    if (mints.length === 0) {
      const logs = Array.isArray(tx?.meta?.logMessages) ? tx!.meta.logMessages as Array<unknown> : [];
      const hasInitializePoolLog = logs.some((line) => {
        const text = String(line || "").toLowerCase();
        return text.includes("initialize") && text.includes("pool");
      });

      if (hasInitializePoolLog) {
        const postTokenBalances = Array.isArray(tx?.meta?.postTokenBalances)
          ? tx!.meta.postTokenBalances as Array<Record<string, any>>
          : [];
        for (const row of postTokenBalances) {
          pushMint(row?.mint);
        }

        for (const key of accountKeys) {
          pushMint(key);
        }
      }
    }

    return mints;
  }

  private async pollRaydiumPools() {
    try {
      let checkedSignatures = 0;
      let added = 0;

      for (const programId of RAYDIUM_PROGRAM_IDS) {
        const signatures = await this.rpcCall("getSignaturesForAddress", [programId, { limit: 30 }]);
        const rows = Array.isArray(signatures) ? signatures as Array<Record<string, any>> : [];
        checkedSignatures += rows.length;

        for (const row of rows) {
          const signature = String(row?.signature || "").trim();
          if (!signature || this.seenRaydiumSignatures.has(signature)) continue;
          this.seenRaydiumSignatures.set(signature, Date.now());

          const tx = await this.rpcCall("getTransaction", [
            signature,
            {
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0,
              commitment: "confirmed",
            },
          ]) as Record<string, any> | null;
          const mints = this.extractRaydiumInitializeMints(tx);
          for (const mint of mints) {
            this.enqueueDetectedMint(mint, "", signature, "raydium_pool");
            added += 1;
          }
        }
      }

      if (added > 0) {
        console.log(`[Pipeline] Raydium pools added ${added} new mints`);
      }

      const now = Date.now();
      if (now - this.lastRaydiumPollReportAt > 30_000) {
        this.lastRaydiumPollReportAt = now;
        console.log(`[Pipeline] Raydium poll checked ${checkedSignatures} signatures, added ${added} mints`);
      }
    } catch (error) {
      console.warn("[Pipeline] Raydium poll error", error instanceof Error ? error.message : String(error || "unknown_error"));
    }
  }

  private async fetchSolanaParsedTransaction(signature: string) {
    const rpcUrl = this.getSolanaRpcUrl();
    if (!rpcUrl || !signature) return null;

    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [
            signature,
            {
              encoding: "jsonParsed",
              commitment: "processed",
              maxSupportedTransactionVersion: 0,
            },
          ],
        }),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return (payload?.result && typeof payload.result === "object") ? payload.result as Record<string, any> : null;
    } catch {
      return null;
    }
  }

  private extractMintFromTransaction(tx: Record<string, any> | null, logs: string[]) {
    const balances = Array.isArray(tx?.meta?.postTokenBalances) ? tx!.meta.postTokenBalances as Array<Record<string, any>> : [];
    for (const row of balances) {
      const mint = String(row?.mint || "").trim();
      if (!mint || mint === PUMPFUN_PROGRAM_ID || EXCLUDED_SOL_MINTS.has(mint)) continue;
      return mint;
    }

    for (const line of logs) {
      const matches = String(line || "").match(BASE58_RE) || [];
      for (const candidate of matches) {
        const mint = String(candidate || "").trim();
        if (!mint || mint === PUMPFUN_PROGRAM_ID || EXCLUDED_SOL_MINTS.has(mint)) continue;
        return mint;
      }
    }

    return "";
  }

  private getTxAccountKeys(tx: Record<string, any> | null) {
    const message = tx?.transaction?.message;
    const accountKeys = Array.isArray(message?.accountKeys)
      ? message.accountKeys as Array<string | Record<string, any>>
      : [];

    return accountKeys
      .map((key) => {
        if (typeof key === "string") return key.trim();
        if (key && typeof key === "object") return String(key.pubkey || "").trim();
        return "";
      })
      .filter((key) => !!key);
  }

  private getInstructionProgramId(instruction: Record<string, any>, accountKeys: string[]) {
    const directProgramId = String(instruction?.programId || "").trim();
    if (directProgramId) return directProgramId;

    const programIdIndex = Number(instruction?.programIdIndex);
    if (Number.isInteger(programIdIndex) && programIdIndex >= 0 && programIdIndex < accountKeys.length) {
      return accountKeys[programIdIndex] || "";
    }

    return "";
  }

  private getInstructionAccounts(instruction: Record<string, any>, accountKeys: string[]) {
    const rawAccounts = Array.isArray(instruction?.accounts)
      ? instruction.accounts as Array<string | number | Record<string, any>>
      : [];

    const accounts: string[] = [];
    for (const account of rawAccounts) {
      if (typeof account === "string") {
        accounts.push(account.trim());
        continue;
      }
      if (typeof account === "number") {
        const resolved = accountKeys[account] || "";
        if (resolved) accounts.push(resolved);
        continue;
      }
      if (account && typeof account === "object") {
        const pubkey = String((account as Record<string, any>).pubkey || "").trim();
        if (pubkey) accounts.push(pubkey);
      }
    }

    return accounts.filter((account) => !!account);
  }

  private extractPumpLaunchFromTransaction(tx: Record<string, any> | null, signature: string, logs: string[]) {
    const instructions = Array.isArray(tx?.transaction?.message?.instructions)
      ? tx!.transaction.message.instructions as Array<Record<string, any>>
      : [];
    const accountKeys = this.getTxAccountKeys(tx);

    for (const instruction of instructions) {
      const programId = this.getInstructionProgramId(instruction, accountKeys);
      if (programId !== PUMPFUN_PROGRAM_ID) continue;

      const accounts = this.getInstructionAccounts(instruction, accountKeys);
      const mint = String(accounts[0] || "").trim();
      const creator = String(accounts[1] || "").trim();

      if (!mint || mint === PUMPFUN_PROGRAM_ID || EXCLUDED_SOL_MINTS.has(mint)) {
        continue;
      }

      return {
        mint,
        creator,
        signature,
      };
    }

    const fallbackMint = this.extractMintFromTransaction(tx, logs);
    if (!fallbackMint) return null;

    return {
      mint: fallbackMint,
      creator: this.extractCreatorFromTransaction(tx),
      signature,
    };
  }

  private extractCreatorFromTransaction(tx: Record<string, any> | null) {
    const message = tx?.transaction?.message;
    const keys = Array.isArray(message?.accountKeys) ? message.accountKeys as Array<Record<string, any> | string> : [];
    for (const key of keys) {
      if (typeof key === "string") {
        const value = String(key || "").trim();
        if (value) return value;
        continue;
      }
      if (key && typeof key === "object" && key.signer) {
        const value = String(key.pubkey || "").trim();
        if (value) return value;
      }
    }
    return "";
  }

  private extractPumpLaunchFromProgramEvent(notification: Record<string, any>) {
    const result = (notification?.params?.result || {}) as Record<string, any>;
    const value = (result?.value || {}) as Record<string, any>;
    const context = (result?.context || {}) as Record<string, any>;
    const slot = Number(context?.slot || 0);

    const account = (value?.account || {}) as Record<string, any>;
    const data = (account?.data || {}) as Record<string, any>;
    const parsed = (data?.parsed || {}) as Record<string, any>;
    const info = (parsed?.info || {}) as Record<string, any>;

    const mint = String(info?.mint || "").trim();
    const creator = String(info?.owner || "").trim();
    if (!mint || EXCLUDED_SOL_MINTS.has(mint) || mint === PUMPFUN_PROGRAM_ID) {
      return null;
    }

    return {
      mint,
      creator,
      signature: `program:${mint}:${slot || Date.now()}`,
    };
  }

  private async handlePumpLogNotification(notification: Record<string, any>) {
    console.log("[Pump.fun Event]", JSON.stringify(notification));

    const detected = this.extractPumpLaunchFromProgramEvent(notification);
    if (!detected) return;
    console.log("[Pump.fun] Possible token launch");

    const nowMs = Date.now();
    this.prunePumpListenerCaches(nowMs);
    if (this.seenPumpSignatures.has(detected.signature)) return;
    this.seenPumpSignatures.set(detected.signature, nowMs);

    const mint = String(detected.mint || "").trim();
    if (!mint || this.seenPumpMints.has(mint)) return;

    const creator = String(detected.creator || "").trim();
    this.seenPumpMints.set(mint, nowMs);
    this.pendingPumpLaunches.unshift({
      mint,
      creator,
      signature: detected.signature,
      detectedAt: new Date(),
      retries: 0,
    });

    console.log("[Pump.fun] NEW TOKEN DETECTED");
    console.log(`[Pump.fun] Mint: ${mint}`);
    console.log(`[Pump.fun] Creator: ${creator || "unknown"}`);
    console.log(`[Pump.fun] Signature: ${detected.signature}`);
  }

  private startPumpFunListener() {
    if (this.pumpListenerStarted) return;
    this.pumpListenerStarted = true;

    void (async () => {
      let retryMs = 2000;
      while (true) {
        const wsUrl = this.getSolanaWsUrl();
        if (!wsUrl) {
          console.warn("[Pump.fun] Listener disabled: SOLANA_WS_URL is empty");
          await new Promise((resolve) => setTimeout(resolve, retryMs));
          retryMs = Math.min(30_000, retryMs * 2);
          continue;
        }

        try {
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            let keepaliveTimer: NodeJS.Timeout | null = null;

            ws.on("open", () => {
              retryMs = 2000;
              const payload = {
                jsonrpc: "2.0",
                id: 1,
                method: "programSubscribe",
                params: [
                  PUMPFUN_PROGRAM_ID,
                  {
                    encoding: "jsonParsed",
                    commitment: "confirmed",
                  },
                ],
              };
              ws.send(JSON.stringify(payload));
              console.log("[Pump.fun] Subscribed to program logs via Helius WS");

              keepaliveTimer = setInterval(() => {
                try {
                  ws.ping();
                } catch {
                }
              }, 20_000);
            });

            ws.on("message", (raw) => {
              try {
                const text = typeof raw === "string" ? raw : raw.toString("utf8");
                const payload = JSON.parse(text) as Record<string, any>;

                // Confirm logsSubscribe activation with the explicit RPC ack frame.
                if (payload?.id === 1 && Object.prototype.hasOwnProperty.call(payload, "result")) {
                  console.log("[Pump.fun] Subscription response:", JSON.stringify(payload));
                }

                void this.handlePumpLogNotification(payload);
              } catch {
              }
            });

            ws.on("error", (error) => {
              if (keepaliveTimer) {
                clearInterval(keepaliveTimer);
                keepaliveTimer = null;
              }
              reject(error);
            });

            ws.on("close", () => {
              if (keepaliveTimer) {
                clearInterval(keepaliveTimer);
                keepaliveTimer = null;
              }
              resolve();
            });
          });
        } catch (error) {
          console.warn("[Pump.fun] Listener crashed", error instanceof Error ? error.message : String(error || "unknown_error"));
        }

        await new Promise((resolve) => setTimeout(resolve, retryMs));
        retryMs = Math.min(30_000, retryMs * 2);
      }
    })();
  }

  async scanAllLaunchpads(): Promise<LaunchpadToken[]> {
    if (this.isScanning) {
      console.log("[Multichain] Scan already in progress");
      return [];
    }

    this.isScanning = true;
    if (!this.runtimeInitialized) {
      this.runtimeInitialized = true;
      console.log(`[Pipeline] Runtime initialized instance=${this.scannerInstanceId}`);
    }
    console.log("[Multichain] Starting multi-chain launchpad scan...");
    this.startPumpFunListener();
    this.startSupplementalLaunchListeners();

    try {
      // Discovery is log-first from pump.fun program transactions via Helius WS.
      // DexScreener is used only for market enrichment after mint detection.
      const results = await Promise.allSettled([
        this.scanDetectedPumpLaunches(),
      ]);

      const allTokens: LaunchpadToken[] = [];
      
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          allTokens.push(...result.value);
        }
      }

      console.log(`[Multichain] Found ${allTokens.length} tokens across all chains`);

      const safeTokens = await this.analyzeAndFilterSafe(allTokens);
      console.log(`[Multichain] ${safeTokens.length} tokens passed safety checks`);

      await this.saveTokens(safeTokens);

      return safeTokens;
    } catch (error) {
      console.error("[Multichain] Scan error:", error);
      return [];
    } finally {
      this.isScanning = false;
    }
  }

  private async scanDetectedPumpLaunches(): Promise<LaunchpadToken[]> {
    const tokens: LaunchpadToken[] = [];
    const wrappedSolMint = "So11111111111111111111111111111111111111112";
    const maxBatch = Math.max(1, Number(process.env.PUMP_LISTENER_DETECTED_BATCH_SIZE || 30));

    if (this.pendingPumpLaunches.length === 0) {
      console.log("[Pump.fun] Waiting for mint detections from Helius WebSocket listener");
      return tokens;
    }

    const nowMs = Date.now();
    const staleTtlMs = Math.max(10_000, Number(process.env.PUMP_LISTENER_PENDING_TTL_MS || 5 * 60 * 1000));
    const pending = this.pendingPumpLaunches.splice(0, maxBatch);

    for (const event of pending) {
      if (nowMs - event.detectedAt.getTime() > staleTtlMs) {
        continue;
      }

      try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${event.mint}`);
        if (!response.ok) {
          if (event.retries < 8) {
            this.pendingPumpLaunches.push({ ...event, retries: event.retries + 1 });
          }
          continue;
        }

        const payload = await response.json();
        const pairs = (Array.isArray(payload?.pairs) ? payload.pairs : []) as Array<Record<string, any>>;
        const solanaPairs = pairs
          .filter((pair) => String(pair?.chainId || "") === "solana")
          .sort((left, right) => Number(right?.liquidity?.usd || 0) - Number(left?.liquidity?.usd || 0));
        const bestPair = solanaPairs[0] || null;

        if (!bestPair) {
          if (event.retries < 8) {
            this.pendingPumpLaunches.push({ ...event, retries: event.retries + 1 });
          }
          continue;
        }

        const baseToken = (bestPair.baseToken || {}) as Record<string, any>;
        const quoteToken = (bestPair.quoteToken || {}) as Record<string, any>;
        const baseAddress = String(baseToken.address || "").trim();
        const quoteAddress = String(quoteToken.address || "").trim();
        const selectedToken = (baseAddress === wrappedSolMint && quoteAddress) ? quoteToken : baseToken;
        const selectedAddress = String(selectedToken.address || event.mint).trim();
        if (!selectedAddress || EXCLUDED_SOL_MINTS.has(selectedAddress)) {
          continue;
        }

        const selectedSymbol = String(selectedToken.symbol || "???").trim().toUpperCase();
        if (!selectedSymbol || EXCLUDED_SOL_SYMBOLS.has(selectedSymbol)) {
          continue;
        }

        const holderAnalysis = await this.analyzeHolders(selectedAddress, "solana");
        tokens.push({
          address: selectedAddress,
          symbol: selectedSymbol,
          name: String(selectedToken.name || "Unknown").slice(0, 80),
          chain: "solana",
          launchpad: "pump.fun",
          priceUsd: String(bestPair.priceUsd || "0"),
          liquidity: Number(bestPair.liquidity?.usd || 0),
          marketCap: Number(bestPair.marketCap || bestPair.fdv || 0),
          volume24h: Number(bestPair.volume?.h24 || 0),
          topHoldersPercentage: holderAnalysis.topHoldersPercentage,
          devWalletPercentage: holderAnalysis.devWalletPercentage,
          createdAt: event.detectedAt,
        });
      } catch {
        if (event.retries < 8) {
          this.pendingPumpLaunches.push({ ...event, retries: event.retries + 1 });
        }
      }
    }

    console.log(`[Multichain] Found ${tokens.length} tokens from solana`);
    return tokens;
  }

  private async scanPumpFun(): Promise<LaunchpadToken[]> {
    console.log("[Multichain] Scanning Pump.fun...");
    try {
      const response = await fetch("https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false");
      
      if (!response.ok) {
        console.log("[Multichain] Pump.fun API not accessible, using DexScreener fallback");
        return [];
      }

      const data = await response.json();
      const tokens: LaunchpadToken[] = [];

      for (const coin of (Array.isArray(data) ? data : []).slice(0, 30)) {
        const mint = coin?.mint || coin?.address || "";
        if (!mint) continue;

        const holderAnalysis = await this.analyzeHolders(mint, "solana");

        const createdAtRaw = coin?.created_timestamp || coin?.createdAt || Date.now();
        const createdAt = isNaN(Number(createdAtRaw)) ? new Date(createdAtRaw) : new Date(Number(createdAtRaw));

        const priceUsd = (() => {
          const m = coin?.usd_market_cap;
          if (!m) return "0";
          try {
            return String(m);
          } catch (e) {
            return "0";
          }
        })();

        const liquidity = coin?.virtual_sol_reserves ? Number(coin.virtual_sol_reserves) * 100 : 0;

        tokens.push({
          address: mint,
          symbol: coin?.symbol || coin?.ticker || "UNKNOWN",
          name: coin?.name || coin?.title || "Unknown",
          chain: "solana",
          launchpad: "pump.fun",
          priceUsd,
          liquidity,
          marketCap: coin?.usd_market_cap || 0,
          volume24h: coin?.volume_24h || 0,
          holders: coin?.holder_count || 0,
          topHoldersPercentage: holderAnalysis.topHoldersPercentage,
          devWalletPercentage: holderAnalysis.devWalletPercentage,
          createdAt,
        });
      }

      console.log(`[Multichain] Found ${tokens.length} tokens from Pump.fun`);
      return tokens;
    } catch (error) {
      console.error("[Multichain] Pump.fun scan error:", error);
      return [];
    }
  }

  private async scanBSCNewTokens(): Promise<LaunchpadToken[]> {
    console.log("[Multichain] Scanning BSC new tokens (DexScreener)...");
    try {
      const response = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
      if (!response.ok) return [];

      const data = await response.json();
      const bscTokens = data.filter((t: any) => t.chainId === "bsc").slice(0, 20);
      
      const tokens: LaunchpadToken[] = [];

      for (const token of bscTokens) {
        const holderAnalysis = await this.analyzeHolders(token.tokenAddress, "bsc");
        
        tokens.push({
          address: token.tokenAddress,
          symbol: token.header?.split(" ")[0] || "???",
          name: token.description?.slice(0, 50) || "Unknown",
          chain: "bsc",
          launchpad: "pancakeswap",
          priceUsd: "0",
          liquidity: 0,
          marketCap: 0,
          volume24h: 0,
          topHoldersPercentage: holderAnalysis.topHoldersPercentage,
          devWalletPercentage: holderAnalysis.devWalletPercentage,
          createdAt: new Date(),
        });
      }

      console.log(`[Multichain] Found ${tokens.length} tokens from BSC`);
      return tokens;
    } catch (error) {
      console.error("[Multichain] BSC scan error:", error);
      return [];
    }
  }

  private async scanDexScreenerLaunches(chain: "ethereum" | "bsc" | "base"): Promise<LaunchpadToken[]> {
    console.log(`[Multichain] Scanning ${chain} via DexScreener...`);
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chain === "ethereum" ? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" : chain === "bsc" ? "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" : "0x4200000000000000000000000000000000000006"}`);
      
      if (!response.ok) {
        const tokenProfilesResponse = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
        if (!tokenProfilesResponse.ok) return [];
        
        const profiles = await tokenProfilesResponse.json();
        const chainTokens = profiles.filter((t: any) => t.chainId === chain).slice(0, 20);
        
        const tokens: LaunchpadToken[] = [];
        for (const token of chainTokens) {
          const pairsResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`);
          let bestPair: any = null;
          if (pairsResponse.ok) {
            const pairsPayload = await pairsResponse.json();
            const chainPairs = ((pairsPayload?.pairs || []) as any[]).filter((pair) => String(pair.chainId || "") === chain);
            bestPair = chainPairs.sort((left, right) => Number(right?.liquidity?.usd || 0) - Number(left?.liquidity?.usd || 0))[0] || null;
          }
          const holderAnalysis = await this.analyzeHolders(token.tokenAddress, chain);
          if (!bestPair) {
            continue;
          }
          tokens.push({
            address: token.tokenAddress,
            symbol: String(bestPair?.baseToken?.symbol || "???"),
            name: String(bestPair?.baseToken?.name || token.description?.slice(0, 50) || "Unknown"),
            chain,
            launchpad: String(bestPair?.dexId || "dexscreener"),
            priceUsd: String(bestPair?.priceUsd || "0"),
            liquidity: Number(bestPair?.liquidity?.usd || 0),
            marketCap: Number(bestPair?.marketCap || bestPair?.fdv || 0),
            volume24h: Number(bestPair?.volume?.h24 || 0),
            topHoldersPercentage: holderAnalysis.topHoldersPercentage,
            devWalletPercentage: holderAnalysis.devWalletPercentage,
            createdAt: bestPair?.pairCreatedAt ? new Date(bestPair.pairCreatedAt) : new Date(),
          });
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return tokens;
      }

      const data = await response.json();
      const tokens: LaunchpadToken[] = [];
      for (const pair of (data.pairs || []).slice(0, 20)) {
        if (Number(pair?.liquidity?.usd || 0) <= 0) {
          continue;
        }
        const baseToken = pair?.baseToken || {};
        const quoteToken = pair?.quoteToken || {};
        const baseAddress = String(baseToken?.address || "").trim();
        const quoteAddress = String(quoteToken?.address || "").trim();

        const selectedToken = baseToken;
        const selectedAddress = String(selectedToken?.address || "").trim();
        if (!selectedAddress) {
          continue;
        }

        const selectedSymbol = String(selectedToken?.symbol || "???").trim().toUpperCase();

        const holderAnalysis = await this.analyzeHolders(selectedAddress, chain);
        
        tokens.push({
          address: selectedAddress,
          symbol: selectedSymbol || "???",
          name: selectedToken?.name || "Unknown",
          chain,
          launchpad: pair.dexId || "unknown",
          priceUsd: pair.priceUsd || "0",
          liquidity: pair.liquidity?.usd || 0,
          marketCap: pair.marketCap || 0,
          volume24h: pair.volume?.h24 || 0,
          topHoldersPercentage: holderAnalysis.topHoldersPercentage,
          devWalletPercentage: holderAnalysis.devWalletPercentage,
          createdAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : new Date(),
        });
      }

      console.log(`[Multichain] Found ${tokens.length} tokens from ${chain}`);
      return tokens;
    } catch (error) {
      console.error(`[Multichain] ${chain} scan error:`, error);
      return [];
    }
  }

  private async scanDexScreenerProfiles(chain: "solana" | "ethereum" | "bsc" | "base"): Promise<LaunchpadToken[]> {
    const tokenProfilesResponse = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
    if (!tokenProfilesResponse.ok) return [];

    const profiles = await tokenProfilesResponse.json();
    const chainTokens = (Array.isArray(profiles) ? profiles : [])
      .filter((t: any) => t.chainId === chain)
      .slice(0, 80);

    const tokens: LaunchpadToken[] = [];
    const wrappedSolMint = "So11111111111111111111111111111111111111112";

    for (const token of chainTokens) {
      const tokenAddress = String(token?.tokenAddress || "").trim();
      if (!tokenAddress) continue;
      if (EXCLUDED_SOL_MINTS.has(tokenAddress)) continue;

      const pairsResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      if (!pairsResponse.ok) {
        continue;
      }

      const pairsPayload = await pairsResponse.json();
      const chainPairs = ((pairsPayload?.pairs || []) as any[])
        .filter((pair) => String(pair?.chainId || "") === chain)
        .sort((left, right) => Number(right?.liquidity?.usd || 0) - Number(left?.liquidity?.usd || 0));

      const bestPair = chainPairs[0] || null;
      if (!bestPair) {
        continue;
      }

      const baseToken = bestPair?.baseToken || {};
      const quoteToken = bestPair?.quoteToken || {};
      const baseAddress = String(baseToken?.address || "").trim();
      const quoteAddress = String(quoteToken?.address || "").trim();
      const selectedToken = (baseAddress === wrappedSolMint && quoteAddress) ? quoteToken : baseToken;
      const selectedAddress = String(selectedToken?.address || tokenAddress).trim();
      const selectedSymbol = String(selectedToken?.symbol || "???").trim().toUpperCase();

      if (!selectedAddress || EXCLUDED_SOL_MINTS.has(selectedAddress)) {
        continue;
      }
      if (EXCLUDED_SOL_SYMBOLS.has(selectedSymbol)) {
        continue;
      }

      const holderAnalysis = await this.analyzeHolders(selectedAddress, chain);
      tokens.push({
        address: selectedAddress,
        symbol: selectedSymbol || "???",
        name: String(selectedToken?.name || token?.description || "Unknown").slice(0, 80),
        chain,
        launchpad: String(bestPair?.dexId || "dexscreener"),
        priceUsd: String(bestPair?.priceUsd || "0"),
        liquidity: Number(bestPair?.liquidity?.usd || 0),
        marketCap: Number(bestPair?.marketCap || bestPair?.fdv || 0),
        volume24h: Number(bestPair?.volume?.h24 || 0),
        topHoldersPercentage: holderAnalysis.topHoldersPercentage,
        devWalletPercentage: holderAnalysis.devWalletPercentage,
        createdAt: bestPair?.pairCreatedAt ? new Date(bestPair.pairCreatedAt) : new Date(),
      });

      await new Promise((resolve) => setTimeout(resolve, 60));
      if (tokens.length >= 30) break;
    }

    console.log(`[Multichain] Found ${tokens.length} tokens from ${chain}`);
    return tokens;
  }

  private async analyzeHolders(tokenAddress: string, chain: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[]; analyzed: boolean }> {
    try {
      if (chain === "solana") {
        const result = await this.analyzeSolanaHolders(tokenAddress);
        return { ...result, analyzed: result.holders.length > 0 };
      } else if (chain === "ethereum" || chain === "base") {
        const result = await this.analyzeEVMHolders(tokenAddress, chain);
        return { ...result, analyzed: result.holders.length > 0 };
      } else if (chain === "bsc") {
        const result = await this.analyzeBSCHolders(tokenAddress);
        return { ...result, analyzed: result.holders.length > 0 };
      }
    } catch (error) {
      console.log(`[Holders] Could not analyze holders for ${tokenAddress}:`, error);
    }
    
    return { topHoldersPercentage: -1, devWalletPercentage: -1, holders: [], analyzed: false };
  }

  private async analyzeSolanaHolders(tokenAddress: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[] }> {
    const heliusKey = process.env.HELIUS_API_KEY;
    if (!heliusKey) {
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }

    try {
      const response = await fetch(`https://api.helius.xyz/v0/token-accounts?api-key=${heliusKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAccounts: [tokenAddress],
          displayOptions: { showZeroBalance: false },
        }),
      });

      if (!response.ok) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      const data = await response.json();
      const tokenAccounts = data.result?.token_accounts || [];

      let totalSupply = 0;
      const holders: HolderInfo[] = [];

      for (const account of tokenAccounts) {
        const balance = parseFloat(account.amount) / Math.pow(10, account.decimals || 9);
        totalSupply += balance;
        holders.push({
          address: account.owner,
          balance,
          percentage: 0,
          isDevWallet: false,
          isContract: false,
        });
      }

      holders.sort((a, b) => b.balance - a.balance);

      for (const holder of holders) {
        holder.percentage = totalSupply > 0 ? (holder.balance / totalSupply) * 100 : 0;
      }

      const top10 = holders.slice(0, 10);
      const topHoldersPercentage = top10.reduce((sum, h) => sum + h.percentage, 0);
      
      const devWallet = holders[0];
      const devWalletPercentage = devWallet?.percentage || 0;

      return { topHoldersPercentage, devWalletPercentage, holders: top10 };
    } catch (error) {
      console.error("[Holders] Solana analysis error:", error);
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }
  }

  private async analyzeEVMHolders(tokenAddress: string, chain: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[] }> {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }

    try {
      const network = chain === "base" ? "base-mainnet" : "eth-mainnet";
      const response = await fetch(`https://${network}.g.alchemy.com/v2/${alchemyKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getTokenBalances",
          params: [tokenAddress, "DEFAULT_TOKENS"],
        }),
      });

      if (!response.ok) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      return { topHoldersPercentage: 15, devWalletPercentage: 5, holders: [] };
    } catch (error) {
      console.error("[Holders] EVM analysis error:", error);
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }
  }

  private async analyzeBSCHolders(tokenAddress: string): Promise<{ topHoldersPercentage: number; devWalletPercentage: number; holders: HolderInfo[] }> {
    const bscscanKey = process.env.BSCSCAN_API_KEY;
    if (!bscscanKey) {
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }

    try {
      const response = await fetch(
        `https://api.bscscan.com/api?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&page=1&offset=10&apikey=${bscscanKey}`
      );

      if (!response.ok) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      const data = await response.json();
      if (data.status !== "1" || !data.result) {
        return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
      }

      const holders: HolderInfo[] = data.result.map((h: any) => ({
        address: h.TokenHolderAddress,
        balance: parseFloat(h.TokenHolderQuantity),
        percentage: parseFloat(h.TokenHolderPercent || "0"),
        isDevWallet: false,
        isContract: false,
      }));

      const topHoldersPercentage = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);
      const devWalletPercentage = holders[0]?.percentage || 0;

      return { topHoldersPercentage, devWalletPercentage, holders };
    } catch (error) {
      console.error("[Holders] BSC analysis error:", error);
      return { topHoldersPercentage: 0, devWalletPercentage: 0, holders: [] };
    }
  }

  private async analyzeAndFilterSafe(tokens: LaunchpadToken[]): Promise<LaunchpadToken[]> {
    const safeTokens: LaunchpadToken[] = [];

    for (const token of tokens) {
      const isSafe = this.checkSafety(token);
      if (isSafe) {
        safeTokens.push(token);
      }
    }

    safeTokens.sort((a, b) => {
      const scoreA = this.calculateSafetyScore(a);
      const scoreB = this.calculateSafetyScore(b);
      return scoreB - scoreA;
    });

    return safeTokens;
  }

  private checkSafety(token: LaunchpadToken): boolean {
    if (token.topHoldersPercentage < 0 || token.devWalletPercentage < 0) {
      console.log(`[Safety] Skipping ${token.symbol} - holder analysis not available`);
      return false;
    }

    if (token.topHoldersPercentage > SAFE_THRESHOLDS.maxTopHoldersPercentage) {
      return false;
    }

    if (token.devWalletPercentage > SAFE_THRESHOLDS.maxDevWalletPercentage) {
      return false;
    }

    if (token.liquidity > 0 && token.liquidity < SAFE_THRESHOLDS.minLiquidity) {
      return false;
    }

    return true;
  }

  private calculateSafetyScore(token: LaunchpadToken): number {
    let score = 100;

    score -= token.topHoldersPercentage * 0.5;
    score -= token.devWalletPercentage * 2;

    if (token.liquidity >= 50000) score += 10;
    else if (token.liquidity >= 20000) score += 5;

    if (token.volume24h >= 100000) score += 10;
    else if (token.volume24h >= 50000) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  private async saveTokens(tokens: LaunchpadToken[]): Promise<void> {
    const nowMs = Date.now();
    for (const [mint, at] of Array.from(this.emittedFreshMints.entries())) {
      if (nowMs - at > 30 * 60 * 1000) {
        this.emittedFreshMints.delete(mint);
      }
    }

    for (const token of tokens) {
      try {
        const existing = await storage.getScannedTokenByAddress(token.address);
        
        const safetyScore = this.calculateSafetyScore(token);
        const riskLevel = safetyScore >= 70 ? "low" : safetyScore >= 50 ? "medium" : "high";

        const tokenData: InsertScannedToken = {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          chain: token.chain,
          dexId: token.launchpad,
          pairAddress: "",
          priceUsd: token.priceUsd,
          priceNative: "0",
          liquidity: token.liquidity,
          marketCap: token.marketCap,
          volume24h: token.volume24h,
          priceChange1h: 0,
          priceChange24h: 0,
          buys24h: 0,
          sells24h: 0,
          safetyScore,
          topHoldersPercentage: token.topHoldersPercentage,
          devWalletPercentage: token.devWalletPercentage,
          isLiquidityLocked: false,
          mintAuthorityDisabled: false,
          isHoneypot: false,
          riskLevel,
          socialLinks: {},
          pairCreatedAt: token.createdAt,
        };

        if (existing) {
          await storage.updateScannedToken(existing.id, tokenData);
        } else {
          await storage.createScannedToken(tokenData);
        }

        const tokenAgeMinutes = Math.max(0, (Date.now() - new Date(token.createdAt).getTime()) / 60000);
        const symbol = String(token.symbol || "").trim().toUpperCase();
        const isEarlySafe = token.chain === "solana"
          && !EXCLUDED_SOL_MINTS.has(String(token.address || "").trim())
          && !EXCLUDED_SOL_SYMBOLS.has(symbol)
          && Number.isFinite(tokenAgeMinutes)
          && tokenAgeMinutes <= FRESH_LISTENER_MAX_AGE_MINUTES
          && token.liquidity >= 8_000
          && safetyScore >= 65;
        const isSafeFallback = token.chain === "solana"
          && !EXCLUDED_SOL_MINTS.has(String(token.address || "").trim())
          && !EXCLUDED_SOL_SYMBOLS.has(symbol)
          && Number.isFinite(tokenAgeMinutes)
          && tokenAgeMinutes <= FRESH_LISTENER_MAX_AGE_MINUTES
          && token.liquidity >= 20_000
          && token.volume24h >= 10_000
          && safetyScore >= 75;

        if ((isEarlySafe || isSafeFallback) && !this.emittedFreshMints.has(token.address)) {
          this.emittedFreshMints.set(token.address, nowMs);
          logStructured("info", "pump_listener.token_ingested", {
            mintAddress: token.address,
            symbol: token.symbol,
            source: isEarlySafe ? "multichain_pump_listener_fallback" : "multichain_safe_listener_fallback",
            creatorWallet: null,
            transactionSignature: null,
            liquidityUsd: Number(token.liquidity || 0),
            marketCapUsd: Number(token.marketCap || 0),
            volumeUsd: Number(token.volume24h || 0),
            pairAgeMinutes: Number(tokenAgeMinutes.toFixed(4)),
            ageLimitSeconds: FRESH_LISTENER_MAX_AGE_SECONDS,
          });
        }
      } catch (error) {
        console.error(`[Multichain] Failed to save token ${token.symbol}:`, error);
      }
    }
  }
}

export const multichainScanner = new MultichainLaunchpadScanner();
