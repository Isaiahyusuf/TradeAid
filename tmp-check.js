const { Client } = require('pg');
const conn = 'postgresql://postgres:XWQZRFpSXlECPJOwQkyuNnJnALxRQzLE@hopper.proxy.rlwy.net:17726/railway';
(async () => {
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const r1 = await client.query("SELECT to_regclass('public.tracked_wallets') AS exists;");
  const r2 = await client.query("SELECT to_regclass('public.wallet_alerts') AS exists;");
  console.log(r1.rows, r2.rows);
  await client.end();
})().catch(err => { console.error(err); process.exit(1); });