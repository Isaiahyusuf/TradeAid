#!/usr/bin/env node

const { spawnSync } = require("child_process");

function run(command, args, env = process.env) {
  const label = `${command} ${args.join(" ")}`;
  console.log(`\n> ${label}`);
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", label], {
        stdio: "inherit",
        shell: false,
        env,
      })
    : spawnSync(command, args, {
        stdio: "inherit",
        shell: false,
        env,
      });

  if (result.error) {
    throw result.error;
  }

  return Number(result.status || 0);
}

function main() {
  const checkExit = run("npm", ["run", "check"]);
  if (checkExit !== 0) {
    process.exit(checkExit);
  }

  const buildExit = run("npm", ["run", "build"]);
  if (buildExit !== 0) {
    process.exit(buildExit);
  }

  const smokeBaseUrl = String(process.env.SMOKE_BASE_URL || "").trim();
  const smokeBearerToken = String(process.env.SMOKE_BEARER_TOKEN || "").trim();
  const shouldRunSmoke = Boolean(smokeBaseUrl);

  if (!shouldRunSmoke) {
    console.log("\nSkipping API smoke: set SMOKE_BASE_URL to enable runtime API checks.");
    console.log("Verification passed: backend + UI compile/build are successful.");
    return;
  }

  if (!smokeBearerToken) {
    console.log("\nSMOKE_BEARER_TOKEN is not set. Protected API smoke routes may fail.");
  }

  const smokeExit = run("npm", ["run", "smoke:api"]);
  if (smokeExit !== 0) {
    process.exit(smokeExit);
  }

  console.log("\nVerification passed: backend, UI, and API smoke checks are successful.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exit(1);
}
