type LaunchpadSourceDefinition = {
  key: string;
  label: string;
  weight: number;
};

type ProgramWatcher = {
  label: string;
  programId: string;
};

const DEFAULT_SOURCE_WEIGHT = 0.55;

const SOURCE_DEFINITIONS: LaunchpadSourceDefinition[] = [
  { key: "pumpfun_prebond_listener", label: "pump.fun", weight: 1.0 },
  { key: "pumpfun_feed", label: "pump.fun", weight: 0.96 },
  { key: "dexscreener_profiles", label: "dexscreener", weight: 0.7 },
  { key: "raydium_pool", label: "raydium", weight: 0.88 },
  { key: "raydium_launchlab", label: "raydium-launchlab", weight: 0.9 },
  { key: "moonshot", label: "moonshot", weight: 0.86 },
  { key: "program_watch", label: "program-watch", weight: 0.82 },
];

function normalizeSourceKey(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function toLaunchpadLabel(rawSource: string): string {
  const source = normalizeSourceKey(rawSource);
  if (!source) return "unknown";

  if (source.startsWith("program_watch:")) {
    return source.slice("program_watch:".length).replace(/_/g, "-") || "program-watch";
  }

  if (source.includes("pump")) return "pump.fun";
  if (source.includes("raydium") || source.includes("launchlab")) return "raydium";
  if (source.includes("moonshot")) return "moonshot";
  if (source.includes("dexscreener")) return "dexscreener";
  return source.replace(/_/g, "-");
}

export function resolveLaunchpadLabel(source: string): string {
  const normalized = normalizeSourceKey(source);
  const matched = SOURCE_DEFINITIONS.find((definition) => normalized.startsWith(definition.key));
  if (matched) {
    return matched.label;
  }
  return toLaunchpadLabel(normalized);
}

export function getLaunchSourceWeight(source: string): number {
  const normalized = normalizeSourceKey(source);
  if (!normalized) return DEFAULT_SOURCE_WEIGHT;

  const matched = SOURCE_DEFINITIONS.find((definition) => normalized.startsWith(definition.key));
  if (matched) {
    return matched.weight;
  }

  if (normalized.includes("pump")) return 0.95;
  if (normalized.includes("raydium")) return 0.88;
  if (normalized.includes("moonshot")) return 0.86;
  if (normalized.includes("dex")) return 0.72;
  if (normalized.startsWith("program_watch:")) return 0.82;
  return DEFAULT_SOURCE_WEIGHT;
}

function parseProgramWatchersFromEnv(): ProgramWatcher[] {
  const raw = String(process.env.SOLANA_EXTRA_LAUNCHPAD_PROGRAMS || "").trim();
  if (!raw) return [];

  const watchers: ProgramWatcher[] = [];
  const groups = raw.split(";").map((part) => part.trim()).filter(Boolean);

  for (const group of groups) {
    const [labelRaw, programsRaw] = group.split(":");
    const label = String(labelRaw || "").trim().toLowerCase().replace(/\s+/g, "_");
    const programs = String(programsRaw || "")
      .split(",")
      .map((programId) => programId.trim())
      .filter(Boolean);

    if (!label || programs.length === 0) continue;

    for (const programId of programs) {
      watchers.push({ label, programId });
    }
  }

  return watchers;
}

export function getAdditionalLaunchpadProgramWatchers(excludedProgramIds: string[] = []): ProgramWatcher[] {
  const excluded = new Set(excludedProgramIds.map((value) => String(value || "").trim()).filter(Boolean));
  const parsed = parseProgramWatchersFromEnv();
  const deduped = new Map<string, ProgramWatcher>();

  for (const watcher of parsed) {
    if (excluded.has(watcher.programId)) continue;
    deduped.set(`${watcher.label}:${watcher.programId}`, watcher);
  }

  return Array.from(deduped.values());
}
