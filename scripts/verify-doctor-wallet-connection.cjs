#!/usr/bin/env node

const { Client } = require("pg");
const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const ASSISTANT_PREFIX = "assistant.runtime.v1:";
const DOCTOR_WALLETS_KEY = "doctortrade.wallets.by_user.v1";
const DOCTOR_RUNTIME_KEY = "doctortrade.runtime.v1";

function fail(message, details) {
  console.error(`VERIFY FAILED: ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

async function fetchSingle(client, query, values = []) {
  const result = await client.query(query, values);
  return result.rows[0] || null;
}

async function resolveUserId(client) {
  const fromEnv = String(process.env.VERIFY_USER_ID || "").trim();
  if (fromEnv) return fromEnv;

  const latestAssistant = await fetchSingle(
    client,
    `
      SELECT key
      FROM app_state
      WHERE key LIKE $1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [`${ASSISTANT_PREFIX}%`],
  );

  const key = String(latestAssistant?.key || "").trim();
  if (!key.startsWith(ASSISTANT_PREFIX)) {
    const runtimeRow = await fetchSingle(
      client,
      `SELECT value FROM app_state WHERE key = $1 LIMIT 1`,
      [DOCTOR_RUNTIME_KEY],
    );
    const runtimeOwner = String(runtimeRow?.value?.ownerUserId || "").trim();
    if (runtimeOwner) {
      return runtimeOwner;
    }

    const doctorWalletsRow = await fetchSingle(
      client,
      `SELECT value FROM app_state WHERE key = $1 LIMIT 1`,
      [DOCTOR_WALLETS_KEY],
    );
    const walletsByUser = (doctorWalletsRow?.value && typeof doctorWalletsRow.value === "object")
      ? doctorWalletsRow.value
      : {};
    const candidate = Object.keys(walletsByUser || {})
      .filter((item) => String(item || "").trim().length > 0)
      .sort((left, right) => {
        const leftAt = new Date(String(walletsByUser?.[left]?.updatedAt || 0)).getTime();
        const rightAt = new Date(String(walletsByUser?.[right]?.updatedAt || 0)).getTime();
        return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
      })[0];

    return String(candidate || "").trim();
  }
  return key.slice(ASSISTANT_PREFIX.length).trim();
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    fail("DATABASE_URL is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const userId = await resolveUserId(client);
    if (!userId) {
      const runtimeOnly = await fetchSingle(
        client,
        `SELECT value FROM app_state WHERE key = $1 LIMIT 1`,
        [DOCTOR_RUNTIME_KEY],
      );
      const runtimeWalletAddress = String(runtimeOnly?.value?.wallet?.address || "").trim();
      if (!runtimeWalletAddress) {
        fail("Could not resolve a user id and runtime wallet is not connected.");
      }

      console.log("VERIFY PASSED (runtime mode): Doctor runtime has a connected wallet address.");
      console.log("userId=(unresolved)");
      console.log(`address=${runtimeWalletAddress}`);
      return;
    }

    const assistantRow = await fetchSingle(
      client,
      `SELECT value FROM app_state WHERE key = $1 LIMIT 1`,
      [`${ASSISTANT_PREFIX}${userId}`],
    );
    const assistantWallet = assistantRow?.value?.wallet || {};
    const assistantAddress = String(assistantWallet?.addresses_by_chain?.solana || "").trim();
    const assistantPrivateKey = String(assistantWallet?.private_keys_by_chain?.solana || "").trim();

    const doctorWalletsRow = await fetchSingle(
      client,
      `SELECT value FROM app_state WHERE key = $1 LIMIT 1`,
      [DOCTOR_WALLETS_KEY],
    );

    const walletsByUser = (doctorWalletsRow?.value && typeof doctorWalletsRow.value === "object") ? doctorWalletsRow.value : {};
    const userDoctorWallet = walletsByUser[userId] || {};

    const doctorAddress = String(userDoctorWallet?.address || "").trim();
    const doctorPrivateKeyStored = String(userDoctorWallet?.livePrivateKey || "").trim();
    if (!doctorAddress || !doctorPrivateKeyStored) {
      fail("Doctor wallet DB entry is missing address/private key", `userId=${userId} doctorAddress=${doctorAddress ? "yes" : "no"} doctorPrivateKey=${doctorPrivateKeyStored ? "yes" : "no"}`);
    }

    if (assistantAddress && doctorAddress !== assistantAddress) {
      fail("Doctor wallet address does not match assistant wallet address", `assistant=${assistantAddress} doctor=${doctorAddress}`);
    }

    if (assistantAddress && !assistantPrivateKey) {
      fail("Assistant wallet has address but missing private key", `userId=${userId}`);
    }

    const runtimeRow = await fetchSingle(
      client,
      `SELECT value FROM app_state WHERE key = $1 LIMIT 1`,
      [DOCTOR_RUNTIME_KEY],
    );

    const runtime = (runtimeRow?.value && typeof runtimeRow.value === "object") ? runtimeRow.value : {};
    const runtimeAddress = String(runtime?.wallet?.address || "").trim();
    const runtimeOwner = String(runtime?.ownerUserId || "").trim();

    if (runtimeAddress && runtimeAddress !== assistantAddress) {
      fail("Doctor runtime wallet address is out of sync", `assistant=${assistantAddress} runtime=${runtimeAddress}`);
    }

    console.log("VERIFY PASSED: Doctor wallet is persisted and connected.");
    console.log(`userId=${userId}`);
    console.log(`address=${assistantAddress}`);
    console.log(`runtimeOwner=${runtimeOwner || "(not set)"}`);
    console.log(`runtimeAddress=${runtimeAddress || "(not set)"}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  fail("Unexpected verifier error", error instanceof Error ? error.stack || error.message : String(error));
});
