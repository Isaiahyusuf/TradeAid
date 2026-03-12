import { logStructured } from "./structured-logger";

const APIFY_API_BASE = "https://api.apify.com/v2";
const DEFAULT_PUMPFUN_ACTOR_ID = "mscrpt/pump-fun-real-time-monitor";
const APIFY_QUOTA_ERROR_RE = /(dataset-locked|platform-feature-disabled|monthly usage hard limit exceeded)/i;

const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

class ApifyQuotaError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApifyQuotaError";
    this.status = status;
  }
}

function isQuotaError(status: number, body: string): boolean {
  return (status === 402 || status === 403) && APIFY_QUOTA_ERROR_RE.test(body || "");
}

function extractRunIdFromUrl(runUrl: string): string {
  const trimmed = String(runUrl || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/\/actor-runs\/([A-Za-z0-9]+)(?:\?|$)/i);
  return (match?.[1] || "").trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseActorInput(): Record<string, unknown> {
  const raw = String(process.env.APIFY_ACTOR_INPUT_JSON || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    logStructured("warn", "apify.workflow.invalid_actor_input_json", {});
    return {};
  }
}

function resolveForwardUrl(): string {
  const explicit = String(process.env.TRADEAID_APIFY_INGEST_URL || "").trim();
  if (explicit) return explicit;
  const port = String(process.env.PORT || "8000").trim();
  return `http://127.0.0.1:${port}/api/fresh/apify-ingest`;
}

export type ApifyWorkflowResult = {
  actorId: string;
  runId: string;
  status: string;
  datasetId: string;
  totalItems: number;
  forwardedItems: number;
  forwardUrl: string;
  finishedAt: string;
};

export async function runApifyWorkflowOnce(limit: number = 10): Promise<ApifyWorkflowResult> {
  const apifyToken = String(process.env.APIFY_TOKEN || "").trim();
  const actorId = String(process.env.APIFY_PUMPFUN_ACTOR_ID || DEFAULT_PUMPFUN_ACTOR_ID).trim();
  const explicitRunId = String(process.env.APIFY_RUN_ID || "").trim();
  const explicitRunUrl = String(process.env.APIFY_RUN_URL || "").trim();
  const replayRunId = explicitRunId || extractRunIdFromUrl(explicitRunUrl);

  if (!apifyToken) {
    throw new Error("APIFY_TOKEN is missing");
  }

  let runId = replayRunId;
  let finalStatus = "RUNNING";
  let datasetId = "";

  if (!runId) {
    const startUrl = `${APIFY_API_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(apifyToken)}`;
    const actorInput = parseActorInput();

    const startResponse = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
    });

    if (!startResponse.ok) {
      const body = await startResponse.text();
      logStructured("error", "apify.workflow.start_failed", {
        actorId,
        status: startResponse.status,
        body: body.slice(0, 400),
      });
      if (isQuotaError(startResponse.status, body)) {
        throw new ApifyQuotaError(startResponse.status, "Apify monthly quota reached");
      }
      throw new Error(`Failed to start Apify actor run (${startResponse.status})`);
    }

    const startPayload = (await startResponse.json()) as { data?: { id?: string; status?: string; defaultDatasetId?: string } };
    runId = String(startPayload?.data?.id || "").trim();
    if (!runId) {
      throw new Error("Apify actor run did not return run id");
    }

    finalStatus = String(startPayload?.data?.status || "RUNNING").trim().toUpperCase();
    datasetId = String(startPayload?.data?.defaultDatasetId || "").trim();
  } else {
    logStructured("info", "apify.workflow.replay_mode", { actorId, runId });
  }

  const pollIntervalMs = Math.max(2_000, Number(process.env.APIFY_RUN_POLL_INTERVAL_MS || 5_000));
  const timeoutMs = Math.max(30_000, Number(process.env.APIFY_RUN_TIMEOUT_MS || 180_000));
  const startedAt = Date.now();

  if (replayRunId && runId) {
    finalStatus = "RUNNING";
  }

  while (!terminalStatuses.has(finalStatus)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for Apify run ${runId}`);
    }

    await sleep(pollIntervalMs);

    const runResponse = await fetch(
      `${APIFY_API_BASE}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(apifyToken)}`,
    );
    if (!runResponse.ok) {
      const body = await runResponse.text();
      logStructured("error", "apify.workflow.poll_failed", {
        runId,
        status: runResponse.status,
        body: body.slice(0, 400),
      });
      if (isQuotaError(runResponse.status, body)) {
        throw new ApifyQuotaError(runResponse.status, "Apify monthly quota reached");
      }
      throw new Error(`Failed to poll Apify run ${runId} (${runResponse.status})`);
    }

    const runPayload = (await runResponse.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    finalStatus = String(runPayload?.data?.status || "").trim().toUpperCase();
    datasetId = String(runPayload?.data?.defaultDatasetId || datasetId || "").trim();
  }

  if (finalStatus !== "SUCCEEDED") {
    throw new Error(`Apify run ${runId} finished with status ${finalStatus}`);
  }

  if (!datasetId) {
    throw new Error(`Apify run ${runId} succeeded without dataset id`);
  }

  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const itemsUrl = `${APIFY_API_BASE}/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(apifyToken)}&clean=true&desc=1&limit=${safeLimit}`;
  const itemsResponse = await fetch(itemsUrl);

  if (!itemsResponse.ok) {
    const body = await itemsResponse.text();
    logStructured("error", "apify.workflow.items_failed", {
      runId,
      datasetId,
      status: itemsResponse.status,
      body: body.slice(0, 400),
    });
    if (isQuotaError(itemsResponse.status, body)) {
      throw new ApifyQuotaError(itemsResponse.status, "Apify monthly quota reached");
    }
    throw new Error(`Failed to fetch Apify dataset items (${itemsResponse.status})`);
  }

  const items = (await itemsResponse.json()) as Array<Record<string, unknown>>;
  const normalizedItems = Array.isArray(items) ? items : [];

  const forwardUrl = resolveForwardUrl();
  const forwardHeaders: Record<string, string> = { "Content-Type": "application/json" };
  const ingestKey = String(process.env.TRADEAID_APIFY_INGEST_KEY || "").trim();
  if (ingestKey) {
    forwardHeaders["x-tradeaid-ingest-key"] = ingestKey;
  }

  const forwardResponse = await fetch(forwardUrl, {
    method: "POST",
    headers: forwardHeaders,
    body: JSON.stringify({
      source: "apify",
      actor_id: actorId,
      run_id: runId,
      dataset_id: datasetId,
      fetched_at: new Date().toISOString(),
      items: normalizedItems,
    }),
  });

  if (!forwardResponse.ok) {
    const body = await forwardResponse.text();
    logStructured("error", "apify.workflow.forward_failed", {
      runId,
      datasetId,
      status: forwardResponse.status,
      body: body.slice(0, 400),
      forwardUrl,
    });
    throw new Error(`Failed to forward Apify dataset to TradeAid (${forwardResponse.status})`);
  }

  const result: ApifyWorkflowResult = {
    actorId,
    runId,
    status: finalStatus,
    datasetId,
    totalItems: normalizedItems.length,
    forwardedItems: normalizedItems.length,
    forwardUrl,
    finishedAt: new Date().toISOString(),
  };

  logStructured("info", "apify.workflow.forward_success", result);
  return result;
}

let schedulerTimer: NodeJS.Timeout | null = null;
let apifyPausedUntil = 0;

export function startApifyWorkflowScheduler(intervalMs: number = 5 * 60 * 1000): void {
  if (schedulerTimer) {
    return;
  }

  const apifyToken = String(process.env.APIFY_TOKEN || "").trim();
  if (!apifyToken) {
    logStructured("warn", "apify.workflow.disabled_missing_token", {});
    return;
  }

  const enabledRaw = String(process.env.APIFY_WORKFLOW_ENABLED || "true").trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(enabledRaw)) {
    logStructured("warn", "apify.workflow.disabled", {});
    return;
  }

  const runCycle = async () => {
    if (apifyPausedUntil > Date.now()) {
      return;
    }

    try {
      await runApifyWorkflowOnce(Number(process.env.APIFY_DATASET_LIMIT || 10));
    } catch (error) {
      if (error instanceof ApifyQuotaError) {
        const cooldownMs = Math.max(60_000, Number(process.env.APIFY_QUOTA_COOLDOWN_MS || 12 * 60 * 60 * 1000));
        apifyPausedUntil = Date.now() + cooldownMs;
        logStructured("warn", "apify.workflow.paused_quota", {
          status: error.status,
          cooldownMs,
          resumeAt: new Date(apifyPausedUntil).toISOString(),
        });
        return;
      }

      logStructured("error", "apify.workflow.cycle_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const firstDelayMs = Math.max(2_000, Number(process.env.APIFY_WORKFLOW_INITIAL_DELAY_MS || 20_000));
  setTimeout(() => {
    void runCycle();
  }, firstDelayMs);

  schedulerTimer = setInterval(() => {
    void runCycle();
  }, Math.max(60_000, intervalMs));

  logStructured("info", "apify.workflow.scheduler_started", {
    intervalMs: Math.max(60_000, intervalMs),
    firstDelayMs,
  });
}
