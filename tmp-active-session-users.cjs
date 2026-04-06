const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const sql = `
    SELECT
      la.created_at,
      la.method,
      la.source,
      la.success,
      COALESCE(la.user_id::text, '') AS user_id,
      COALESCE(la.username, u.username, '') AS username,
      COALESCE(la.email, u.email, '') AS email,
      COALESCE(la.client_ip, '') AS client_ip,
      COALESCE(la.request_host, '') AS request_host
    FROM login_audit la
    LEFT JOIN users u ON u.id = la.user_id
    ORDER BY la.created_at DESC
    LIMIT 1000;
  `;

  const result = await client.query(sql);
  console.log(JSON.stringify({ rows: result.rows }, null, 2));

  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
