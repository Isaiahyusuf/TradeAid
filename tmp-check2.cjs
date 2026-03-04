const { Client } = require('pg');
const conn = 'postgresql://postgres:XWQZRFpSXlECPJOwQkyuNnJnALxRQzLE@hopper.proxy.rlwy.net:17726/railway';
(async () => {
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query("select table_schema, table_name from information_schema.tables where table_name like 'tracked_%' or table_name like 'wallet_%';");
  console.log(res.rows);
  await client.end();
})().catch(err => { console.error(err); process.exit(1); });