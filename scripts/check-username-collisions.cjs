#!/usr/bin/env node

const { config: loadEnv } = require("dotenv");
const { Client } = require("pg");
const { inspect } = require("util");

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();

  if (!connectionString) {
    console.error("[username-collision-check] DATABASE_URL is required.");
    process.exit(1);
  }

  const isLocalConnection = /localhost|127\.0\.0\.1/i.test(connectionString);
  const client = new Client(
    isLocalConnection
      ? { connectionString }
      : { connectionString, ssl: { rejectUnauthorized: false } }
  );

  console.log("[username-collision-check] Connecting to database...");
  await client.connect();
  console.log("[username-collision-check] Running collision query...");

  const collisionsQuery = `
    SELECT
      LOWER(username) AS normalized_username,
      COUNT(*)::int AS duplicate_count,
      ARRAY_AGG(id ORDER BY id) AS user_ids,
      ARRAY_AGG(username ORDER BY username) AS usernames
    FROM users
    WHERE username IS NOT NULL AND BTRIM(username) <> ''
    GROUP BY LOWER(username)
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, normalized_username ASC;
  `;

  const { rows } = await client.query(collisionsQuery);
  await client.end();

  if (!rows.length) {
    console.log("[username-collision-check] No username case-collisions found.");
    return;
  }

  console.error(`[username-collision-check] Found ${rows.length} username collision group(s):`);
  for (const row of rows) {
    const normalized = String(row.normalized_username || "");
    const count = Number(row.duplicate_count || 0);
    const usernames = Array.isArray(row.usernames) ? row.usernames.join(", ") : "";
    const userIds = Array.isArray(row.user_ids) ? row.user_ids.join(", ") : "";

    console.error(`- ${normalized} (${count})`);
    console.error(`  usernames: ${usernames}`);
    console.error(`  user_ids: ${userIds}`);
  }

  process.exit(2);
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(`[username-collision-check] ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    console.error("[username-collision-check] Username collision check failed");
    console.error(inspect(error, { depth: 5 }));
  }
  process.exit(1);
});
