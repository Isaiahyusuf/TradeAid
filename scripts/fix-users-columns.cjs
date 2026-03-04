const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const sql = `
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS first_name varchar,
      ADD COLUMN IF NOT EXISTS last_name varchar,
      ADD COLUMN IF NOT EXISTS profile_image_url varchar,
      ADD COLUMN IF NOT EXISTS username varchar,
      ADD COLUMN IF NOT EXISTS bio varchar,
      ADD COLUMN IF NOT EXISTS favorite_chain varchar DEFAULT 'solana',
      ADD COLUMN IF NOT EXISTS notifications_enabled boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS email_alerts_enabled boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS risk_tolerance varchar DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
  `;

  await client.query(sql);
  console.log('users table columns ensured');
  await client.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
