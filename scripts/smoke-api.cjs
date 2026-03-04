#!/usr/bin/env node

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const bearerToken = String(process.env.SMOKE_BEARER_TOKEN || "").trim();

const checks = [
  {
    name: "Doctor health",
    path: "/api/doctor/health",
    method: "GET",
    expect: [200],
  },
  {
    name: "Doctor status",
    path: "/api/doctor/status",
    method: "GET",
    expect: [200],
  },
  {
    name: "Token stats overview",
    path: "/api/tokens/stats/overview",
    method: "GET",
    expect: [200],
  },
  {
    name: "System health",
    path: "/api/system/health",
    method: "GET",
    expect: [200],
  },
  {
    name: "Growth summary",
    path: "/api/growth/summary",
    method: "GET",
    expect: [200],
  },
  {
    name: "Tokens feed",
    path: "/api/tokens?limit=5",
    method: "GET",
    expect: bearerToken ? [200] : [200, 401, 403],
  },
];

async function runCheck(check) {
  const headers = { "Content-Type": "application/json" };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const url = `${baseUrl}${check.path}`;
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: check.method,
      headers,
    });

    const elapsedMs = Date.now() - started;
    const responseText = await response.text();

    if (!check.expect.includes(response.status)) {
      return {
        ok: false,
        name: check.name,
        status: response.status,
        elapsedMs,
        snippet: responseText.slice(0, 240),
      };
    }

    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {
      json = null;
    }

    const count = Number(json?.count || json?.total || json?.total_tokens || 0);

    return {
      ok: true,
      name: check.name,
      status: response.status,
      elapsedMs,
      count,
    };
  } catch (error) {
    return {
      ok: false,
      name: check.name,
      status: 0,
      elapsedMs: Date.now() - started,
      snippet: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function main() {
  console.log(`Running API smoke checks against ${baseUrl}`);
  if (!bearerToken) {
    console.log("No SMOKE_BEARER_TOKEN provided; protected routes may return 401/403.");
  }

  const results = [];
  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);
    if (result.ok) {
      console.log(`PASS  ${check.name} [${result.status}] (${result.elapsedMs}ms)` + (result.count ? ` count=${result.count}` : ""));
    } else {
      console.error(`FAIL  ${check.name} [${result.status}] (${result.elapsedMs}ms)`);
      if (result.snippet) {
        console.error(`      ${result.snippet}`);
      }
    }
  }

  const failed = results.filter((item) => !item.ok);
  if (failed.length > 0) {
    console.error(`\nSmoke checks failed: ${failed.length}/${results.length}`);
    process.exit(1);
  }

  console.log(`\nSmoke checks passed: ${results.length}/${results.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Smoke check runner failed");
  process.exit(1);
});
