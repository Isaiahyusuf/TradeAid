const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const keys = [
    'doctortrade.wallets.by_user.v1',
    'doctortrade.runtime.by_user.v1',
    'doctortrade.runtime.v1',
  ];

  const keyRows = await client.query(
    `select key, updated_at from app_state where key = any($1) order by updated_at desc`,
    [keys],
  );

  const walletCounts = await client.query(`
    with w as (
      select value from app_state where key = 'doctortrade.wallets.by_user.v1'
    ), r as (
      select value from app_state where key = 'doctortrade.runtime.by_user.v1'
    )
    select
      coalesce((select count(*)::int from w, jsonb_each(w.value)), 0) as wallet_entries,
      coalesce((select count(*)::int from w, jsonb_each(w.value) e where coalesce(e.value->>'address','') <> ''), 0) as wallets_non_empty,
      coalesce((select count(*)::int from r, jsonb_each(r.value)), 0) as runtime_entries,
      coalesce((select count(*)::int from r, jsonb_each(r.value) e where coalesce(e.value->'wallet'->>'address','') <> ''), 0) as runtime_non_empty
  `);

  const runtime = await client.query(`
    select value
    from app_state
    where key = 'doctortrade.runtime.v1'
    limit 1
  `);

  const runtimeObj = runtime.rows[0]?.value || {};
  const summary = {
    enabled: !!runtimeObj.enabled,
    kill_switch: !!runtimeObj.killSwitch,
    wallet_address: runtimeObj.wallet?.address || '',
    execution_mode: runtimeObj.execution?.mode || null,
    live_capable_hint: {
      has_wallet_address: !!String(runtimeObj.wallet?.address || '').trim(),
    },
    controls: {
      trades_today: runtimeObj.controls?.trades_today,
      max_trades_per_day: runtimeObj.controls?.max_trades_per_day,
      max_open_positions: runtimeObj.controls?.max_open_positions,
    },
    positions_count: Array.isArray(runtimeObj.positions) ? runtimeObj.positions.length : 0,
    recent_trades_count: Array.isArray(runtimeObj.recentTrades) ? runtimeObj.recentTrades.length : 0,
    recent_trade_modes: Array.isArray(runtimeObj.recentTrades)
      ? runtimeObj.recentTrades.slice(0, 12).map((t) => ({
          token: t?.token,
          action: t?.action,
          execution_mode: t?.execution_mode,
          timestamp: t?.timestamp,
        }))
      : [],
    last_decision: runtimeObj.lastDecision || null,
  };

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    keys: keyRows.rows,
    walletCounts: walletCounts.rows[0],
    runtimeSummary: summary,
  }, null, 2));

  await client.end();
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
