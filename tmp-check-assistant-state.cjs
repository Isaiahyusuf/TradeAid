const { Client } = require('pg');

(async () => {
  const cs = 'postgresql://postgres:XWQZRFpSXlECPJOwQkyuNnJnALxRQzLE@hopper.proxy.rlwy.net:17726/railway';
  const client = new Client({ connectionString: cs });
  await client.connect();
  const result = await client.query(
    "select key, updated_at from app_state where key like 'assistant.runtime.v1:%' order by updated_at desc limit 20"
  );
  console.log(result.rows);
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
