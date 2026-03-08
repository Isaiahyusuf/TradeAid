#!/usr/bin/env node

const { Client } = require("pg");

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const result = await client.query(
    "SELECT key, value FROM app_state WHERE key IN ($1,$2,$3)",
    ["doctortrade.runtime.v1", "doctortrade.wallets.by_user.v1", "doctortrade.dex.worker.v1"],
  );

  const byKey = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  const runtime = byKey["doctortrade.runtime.v1"] || {};
  const walletsByUser = byKey["doctortrade.wallets.by_user.v1"] || {};
  const worker = byKey["doctortrade.dex.worker.v1"] || {};

  const output = {
    hasRuntime: Boolean(byKey["doctortrade.runtime.v1"]),
    hasWalletMap: Boolean(byKey["doctortrade.wallets.by_user.v1"]),
    walletUsers: Object.keys(walletsByUser || {}),
    ownerUserId: String(runtime.ownerUserId || ""),
    enabled: Boolean(runtime.enabled),
    killSwitch: Boolean(runtime.killSwitch),
    walletAddress: String(runtime.wallet?.address || ""),
    executionMode: String(runtime.execution?.mode || ""),
    lastReason: String(runtime.lastDecision?.reason || ""),
    lastError: String(runtime.lastError || ""),
    recentLogs: Array.isArray(worker.logs)
      ? worker.logs.slice(0, 8).map((log) => ({
          at: String(log.at || ""),
          event: String(log.event || ""),
          symbol: String(log.symbol || ""),
          reason: String(log.reason || ""),
        }))
      : [],
  };

  console.log(JSON.stringify(output, null, 2));
  await client.end();
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
