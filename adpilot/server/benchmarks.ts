/**
 * Benchmark resolution — the single place that knows where a client's benchmarks live.
 *
 * The UI writes `benchmarks_<platform>.json`, but consumers used to read three
 * different paths: the pacing endpoint and the Meta agent read the un-suffixed
 * `benchmarks.json`, and the Google agent read `config.json` → `google_targets`.
 * The result was that benchmarks edited in the UI silently changed nothing on the
 * pacing screen or in either Python scoring layer.
 *
 * Everything on the server now resolves through here. The Python agents read the
 * same priority order (see meta_ads_agent_v2.py / google_ads_agent_v2.py).
 */

import fs from "fs";
import path from "path";

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const CLIENTS_BASE = path.join(DATA_BASE, "clients");

/** Where PUT /api/clients/:clientId/benchmarks writes. Always the canonical target. */
export function getBenchmarksPath(clientId: string, platform: string): string {
  return path.join(CLIENTS_BASE, clientId, `benchmarks_${platform}.json`);
}

/**
 * Read priority: platform-specific (what the UI writes) → legacy un-suffixed file.
 * Returns the resolved path, or null when the client has no benchmarks on disk.
 */
export function resolveBenchmarksPath(clientId: string, platform: string): string | null {
  const candidates = [
    getBenchmarksPath(clientId, platform),
    path.join(CLIENTS_BASE, clientId, "benchmarks.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Load a client's benchmarks, or an empty object when none are configured.
 *
 * An empty result is NOT harmless: downstream scorers treat a missing target as
 * "not measured" and exclude it from the weighted average. That is deliberate —
 * an absent target must never be scored as full marks — but it does mean the
 * account is being judged on fewer metrics, so the caller is warned.
 */
export function readBenchmarks(clientId: string, platform: string): Record<string, any> {
  const benchPath = resolveBenchmarksPath(clientId, platform);
  if (!benchPath) {
    console.warn(
      `[benchmarks] No benchmarks file for ${clientId}/${platform} — ` +
      `metrics without a target will be excluded from the health score.`
    );
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(benchPath, "utf-8"));
  } catch (err: any) {
    console.error(
      `[benchmarks] Failed to parse ${benchPath} for ${clientId}/${platform}: ${err?.message || err}`
    );
    return {};
  }
}
