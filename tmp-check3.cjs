const { Client } = require('pg');
const conn = 'postgresql://postgres:TJgbTwndmconeixYAiimcRAnRcEdNBrx@postgres.railway.internal:5432/railway';
(async () => {
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query('select 1 as ok');
  console.log(res.rows);
  await client.end();
})().catch(err => { console.error(err); process.exit(1); });