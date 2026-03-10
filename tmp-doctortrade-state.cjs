const { Client } = require('pg');

(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL missing');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const summary = await client.query(`
    SELECT
      key,
      updated_at,
      CASE WHEN value::text ILIKE '%"walletAddress":"%"%' THEN 1 ELSE 0 END AS has_wallet_like,
      CASE WHEN value::text ILIKE '%"enabled":true%' THEN 1 ELSE 0 END AS has_enabled_true,
      CASE WHEN value::text ILIKE '%"execution_mode":"live"%' OR value::text ILIKE '%"mode":"live"%' THEN 1 ELSE 0 END AS has_live_like,
      length(value::text) AS value_len
    FROM app_state
    WHERE key IN (
      'doctortrade.wallets.by_user.v1',
      'doctortrade.runtime.by_user.v1',
      'doctortrade.runtime.v1'
    )
    ORDER BY key;
  `);

  const byUser = await client.query(`
    WITH runtimes AS (
      SELECT
        kv.key AS user_id,
        kv.value AS runtime
      FROM app_state a,
      LATERAL jsonb_each(COALESCE(a.value, '{}'::jsonb)) kv
      WHERE a.key = 'doctortrade.runtime.by_user.v1'
    ), wallets AS (
      SELECT
        kv.key AS user_id,
        kv.value AS wallet
      FROM app_state a,
      LATERAL jsonb_each(COALESCE(a.value, '{}'::jsonb)) kv
      WHERE a.key = 'doctortrade.wallets.by_user.v1'
    )
    SELECT
      COALESCE(r.user_id, w.user_id) AS user_id,
      COALESCE(r.runtime->>'enabled','') AS enabled,
      COALESCE(r.runtime->'execution'->>'mode','') AS execution_mode,
      COALESCE(r.runtime->>'walletAddress','') AS runtime_wallet,
      COALESCE(w.wallet->>'walletAddress','') AS wallet_wallet,
      CASE WHEN COALESCE(r.runtime->>'privateKeyEncrypted','') <> '' THEN true ELSE false END AS runtime_has_key,
      CASE WHEN COALESCE(w.wallet->>'privateKeyEncrypted','') <> '' THEN true ELSE false END AS wallet_has_key
    FROM runtimes r
    FULL OUTER JOIN wallets w ON w.user_id = r.user_id
    ORDER BY user_id;
  `);

  const lastDecision = await client.query(`
    SELECT
      value #>> '{last_decision,action}' AS action,
      value #>> '{last_decision,reason}' AS reason,
      value #>> '{last_decision,at}' AS at,
      value #>> '{safety,pause_reason}' AS pause_reason,
      value #>> '{safety,paused}' AS paused,
      value #>> '{discovery,last_poll_at}' AS last_poll_at,
      updated_at
    FROM app_state
    WHERE key = 'doctortrade.runtime.v1';
  `);

  const focusUserId = '2759e8cc-a920-4bb3-8bcf-9b4351e95e22';
  const rawFocus = await client.query(`
    SELECT
      (SELECT value -> $1 FROM app_state WHERE key = 'doctortrade.runtime.by_user.v1') AS runtime,
      (SELECT value -> $1 FROM app_state WHERE key = 'doctortrade.wallets.by_user.v1') AS wallet,
      (SELECT value FROM app_state WHERE key = 'doctortrade.runtime.v1') AS global_runtime
  `, [focusUserId]);

  console.log(JSON.stringify({
    now: new Date().toISOString(),
    summary: summary.rows,
    byUser: byUser.rows,
    lastDecision: lastDecision.rows[0] || null,
    focusUserId,
    focusRaw: rawFocus.rows[0] || null,
  }, null, 2));

  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
