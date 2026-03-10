const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const runtime = await client.query(`select value from app_state where key='doctortrade.runtime.by_user.v1' limit 1`);
  const wallets = await client.query(`select value from app_state where key='doctortrade.wallets.by_user.v1' limit 1`);

  const runtimeMap = runtime.rows[0]?.value || {};
  const walletMap = wallets.rows[0]?.value || {};

  const rows = Object.keys(runtimeMap).map((userId) => {
    const rt = runtimeMap[userId] || {};
    const w = walletMap[userId] || {};
    return {
      user_id: userId,
      enabled: !!rt.enabled,
      kill_switch: !!rt.killSwitch,
      execution_mode: rt.execution?.mode || null,
      runtime_wallet_address: String(rt.wallet?.address || ''),
      wallet_map_address: String(w.address || ''),
      wallet_has_key: !!String(w.livePrivateKey || '').trim(),
      wallet_auto_hydrate_blocked: !!w.autoHydrateBlocked,
      trades_today: rt.controls?.trades_today ?? null,
      max_trades_per_day: rt.controls?.max_trades_per_day ?? null,
    };
  });

  console.log(JSON.stringify({ ts: new Date().toISOString(), users: rows }, null, 2));

  await client.end();
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
