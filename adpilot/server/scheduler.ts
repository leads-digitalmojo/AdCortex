import cron from "node-cron";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { log } from "./index";
import { saveAnalysisSnapshot } from "./analysis-persistence";
import { generateBiddingRecommendations } from "./bidding-intelligence";
import { storage } from "./storage";
import { db } from "./db";
import { clients } from "@shared/schema";
import { eq } from "drizzle-orm";
import { refreshAllAvailableFunds } from "./available-funds";

const execFileAsync = promisify(execFile);

const ADS_AGENT_DIR = path.resolve(import.meta.dirname, "../../ads_agent");
const DATA_BASE = path.resolve(ADS_AGENT_DIR, "data");
const STATUS_FILE = path.join(DATA_BASE, "scheduler_status.json");
const PLATFORM_SYNC_STATE_FILE = path.join(DATA_BASE, "platform_sync_state.json");

function resolvePythonPath(): string {
  if (process.env.PYTHON_PATH?.trim()) {
    return process.env.PYTHON_PATH.trim();
  }

  if (fs.existsSync("/opt/venv/bin/python3")) {
    return "/opt/venv/bin/python3";
  }

  return process.platform === "win32" ? "python" : "python3";
}

export type PlatformSyncStatus = "idle" | "loading" | "success" | "failed";

export interface PlatformSyncState {
  last_synced_at: string | null;
  last_successful_fetch: string | null;
  sync_status: PlatformSyncStatus;
  // Populated on a failed run, cleared on the next loading/success transition.
  // The dashboard's failure banners read this to show what actually went wrong
  // instead of a generic "run the agent" message.
  error?: string | null;
}

type PlatformSyncStore = Record<string, Record<string, PlatformSyncState>>;

export interface SchedulerStatus {
  lastRun: string | null;
  lastRunSuccess: boolean;
  lastRunDuration: number;
  lastError: string | null;
  nextRun: string | null;
  isRunning: boolean;
  runHistory: Array<{
    timestamp: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;
}

let schedulerStatus: SchedulerStatus = {
  lastRun: null,
  lastRunSuccess: false,
  lastRunDuration: 0,
  lastError: null,
  nextRun: null,
  isRunning: false,
  runHistory: [],
};

let platformSyncState: PlatformSyncStore = {};

export type AgentPlatform = "meta" | "google";

export interface AgentRunOptions {
  clientIds?: string[];
  platforms?: AgentPlatform[];
}

// Tracks which client/platform pairs currently have an agent process running so a
// scoped manual sync (e.g. "sync Google for this client") can start immediately
// instead of queuing behind an unrelated full run.
const inFlightSyncs = new Set<string>();
const syncKey = (clientId: string, platform: string) => `${clientId}:${platform}`;

/** True while an unscoped (all-clients) run is in progress. */
export function isFullRunActive(): boolean {
  return activeRuns > 0;
}

export function isPlatformSyncing(clientId: string, platform: string): boolean {
  return inFlightSyncs.has(syncKey(clientId, platform));
}

// Number of agent runs (full or scoped) currently executing.
let activeRuns = 0;

// SSE clients for live updates with user context
interface SSEClient {
  res: any;
  user: any;
  ownedClientIds: Set<string>;
}

const sseClients = new Set<SSEClient>();

export async function addSSEClient(res: any, user: any) {
  // Fetch owned client IDs once for this connection
  let ownedClientIds = new Set<string>();
  if (user.role === "admin") {
    // Admins don't need the set, but we keep it empty
  } else {
    try {
      const rows = await db.select({ id: clients.id }).from(clients).where(eq(clients.createdBy, user.id));
      ownedClientIds = new Set(rows.map(r => r.id));
    } catch (err) {
      console.error("[SSE] Failed to fetch owned clients for user", user.id, err);
    }
  }

  const client = { res, user, ownedClientIds };
  sseClients.add(client);
  res.on("close", () => sseClients.delete(client));
}

export function broadcastSSE(event: string, data: any, clientId?: string) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      const { res, user, ownedClientIds } = client;
      
      // RBAC & OBAC Check
      if (user.role === 'admin') {
        return res.write(payload);
      }

      // For members, only broadcast if:
      // 1. The event is NOT client-specific (e.g., system status)
      // 2. OR the user owns the clientId
      if (!clientId || ownedClientIds.has(clientId)) {
        res.write(payload);
      }
    } catch (err) {
      console.error("[SSE] Send failed", err);
      sseClients.delete(client);
    }
  });
}

function loadStatus(): void {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      schedulerStatus = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
    }
  } catch {
    // use defaults
  }
}

function loadPlatformSyncState(): void {
  try {
    if (fs.existsSync(PLATFORM_SYNC_STATE_FILE)) {
      platformSyncState = JSON.parse(fs.readFileSync(PLATFORM_SYNC_STATE_FILE, "utf-8"));
    }
  } catch {
    platformSyncState = {};
  }
}

function saveStatus(): void {
  const dir = path.dirname(STATUS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(schedulerStatus, null, 2));
}

function savePlatformSyncState(): void {
  const dir = path.dirname(PLATFORM_SYNC_STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PLATFORM_SYNC_STATE_FILE, JSON.stringify(platformSyncState, null, 2));
}

export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function extractAnalysisTimestamp(payload: any): string | null {
  return (
    normalizeTimestamp(payload?.last_successful_fetch) ||
    normalizeTimestamp(payload?.generated_at) ||
    normalizeTimestamp(payload?.timestamp) ||
    normalizeTimestamp(payload?.run_metadata?.timestamp)
  );
}

function getLatestAnalysisTimestamp(clientId: string, platform: string): string | null {
  const platformDir = path.join(DATA_BASE, "clients", clientId, platform);
  const candidateFiles = fs.existsSync(platformDir)
    ? fs.readdirSync(platformDir)
        // analysis_last_error.json is a failure record written by the Google agent —
        // it carries a `timestamp`, so counting it here would report a failed run as
        // a successful fetch.
        .filter((name) => /^analysis(?:_.+)?\.json$/.test(name) && name !== "analysis_last_error.json")
        .map((name) => path.join(platformDir, name))
    : [];

  const timestamps = candidateFiles
    .map((filePath) => {
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return extractAnalysisTimestamp(payload);
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return timestamps[0] || null;
}

function getDefaultPlatformSyncState(clientId: string, platform: string): PlatformSyncState {
  const inferredFetch = getLatestAnalysisTimestamp(clientId, platform);
  return {
    last_synced_at: inferredFetch,
    last_successful_fetch: inferredFetch,
    sync_status: inferredFetch ? "success" : "idle",
  };
}

function setPlatformSyncState(clientId: string, platform: string, next: Partial<PlatformSyncState>): PlatformSyncState {
  const current = getPlatformSyncState(clientId, platform);
  const updated: PlatformSyncState = {
    ...current,
    ...next,
  };

  if (!platformSyncState[clientId]) {
    platformSyncState[clientId] = {};
  }
  platformSyncState[clientId][platform] = updated;
  savePlatformSyncState();

  // Push the change so the dashboard reflects loading/success/failed for this
  // client+platform while a scoped run is in flight, instead of waiting for the
  // whole run to finish.
  broadcastSSE("sync-state-changed", { clientId, platform, state: updated }, clientId);

  return updated;
}

export function getPlatformSyncState(clientId: string, platform: string): PlatformSyncState {
  const stored = platformSyncState[clientId]?.[platform];
  if (stored) {
    const inferredFetch = getLatestAnalysisTimestamp(clientId, platform);
    const lastFetch = stored.last_successful_fetch || inferredFetch;
    let status: PlatformSyncStatus = stored.sync_status || (lastFetch ? "success" : "idle");

    // A persisted "loading" with no process behind it is a leftover from a crashed
    // or restarted run — don't leave the UI spinning forever.
    if (status === "loading" && !isPlatformSyncing(clientId, platform)) {
      status = lastFetch ? "success" : "idle";
    }

    return {
      last_synced_at: stored.last_synced_at || inferredFetch,
      last_successful_fetch: lastFetch,
      sync_status: status,
    };
  }
  return getDefaultPlatformSyncState(clientId, platform);
}

// Load clients registry and credentials for multi-client runs
async function loadClientsWithCredentials(): Promise<Array<{
  id: string;
  googleCreds?: Record<string, string>;
  metaCreds?: Record<string, string>;
}>> {
  try {
    const allClients = await storage.getAllClients();

    const results: Array<{ id: string; googleCreds?: Record<string, string>; metaCreds?: Record<string, string> }> = [];

    for (const c of allClients) {
      const creds = await storage.getCredentials(c.id);
      const envKey = (suffix: string) => `${String(c.id).toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;

      // Google Credentials — DB only, no ENV fallback
      const g = creds?.google as any;
      const googleCreds = (g?.clientId && g?.clientSecret && g?.refreshToken &&
        !String(g.clientId).startsWith("YOUR_")) ? {
          GOOGLE_CLIENT_ID: g.clientId,
          GOOGLE_CLIENT_SECRET: g.clientSecret,
          GOOGLE_REFRESH_TOKEN: g.refreshToken,
          GOOGLE_DEVELOPER_TOKEN: g.developerToken || "",
          GOOGLE_MCC_ID: g.mccId || "",
          GOOGLE_CUSTOMER_ID: g.customerId || "",
        } : (
          // ENV fallback for local dev / single-client setups
          (process.env[`GOOGLE_${envKey("CLIENT_ID")}`] && process.env[`GOOGLE_${envKey("CLIENT_SECRET")}`] && process.env[`GOOGLE_${envKey("REFRESH_TOKEN")}`])
            ? {
              GOOGLE_CLIENT_ID: process.env[`GOOGLE_${envKey("CLIENT_ID")}`] as string,
              GOOGLE_CLIENT_SECRET: process.env[`GOOGLE_${envKey("CLIENT_SECRET")}`] as string,
              GOOGLE_REFRESH_TOKEN: process.env[`GOOGLE_${envKey("REFRESH_TOKEN")}`] as string,
              GOOGLE_DEVELOPER_TOKEN: (process.env[`GOOGLE_${envKey("DEVELOPER_TOKEN")}`] as string) || (process.env.GOOGLE_DEVELOPER_TOKEN || ""),
              GOOGLE_MCC_ID: (process.env[`GOOGLE_${envKey("MCC_ID")}`] as string) || (process.env.GOOGLE_MCC_ID || ""),
              GOOGLE_CUSTOMER_ID: (process.env[`GOOGLE_${envKey("CUSTOMER_ID")}`] as string) || (process.env.GOOGLE_CUSTOMER_ID || ""),
            }
            : (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN)
              ? {
                GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
                GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
                GOOGLE_DEVELOPER_TOKEN: process.env.GOOGLE_DEVELOPER_TOKEN || "",
                GOOGLE_MCC_ID: process.env.GOOGLE_MCC_ID || "",
                GOOGLE_CUSTOMER_ID: process.env.GOOGLE_CUSTOMER_ID || "",
              }
              : undefined
        );

      // Meta Credentials — DB only, no ENV fallback
      const m = creds?.meta as any;
      const metaCreds = (m?.accessToken && m?.adAccountId &&
        !String(m.accessToken).startsWith("YOUR_")) ? {
          META_ACCESS_TOKEN: m.accessToken,
          META_AD_ACCOUNT_ID: m.adAccountId,
        } : (
          // ENV fallback for local dev / single-client setups
          (process.env[`META_${envKey("ACCESS_TOKEN")}`] && process.env[`META_${envKey("AD_ACCOUNT_ID")}`])
            ? {
              META_ACCESS_TOKEN: process.env[`META_${envKey("ACCESS_TOKEN")}`] as string,
              META_AD_ACCOUNT_ID: process.env[`META_${envKey("AD_ACCOUNT_ID")}`] as string,
            }
            : (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID)
              ? {
                META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
                META_AD_ACCOUNT_ID: process.env.META_AD_ACCOUNT_ID,
              }
              : undefined
        );

      results.push({ id: c.id, googleCreds, metaCreds });
    }

    return results;
  } catch (err) {
    log(`[Credentials] Error loading clients from DB: ${err}`, "scheduler");
    return [];
  }
}

// How many client syncs run at once. Each is a separate Python process, so this
// is bounded by the box's cores, not by network. Override with SYNC_CONCURRENCY.
//
// Read at call time, not module load: index.ts imports this module before it
// calls dotenv.config(), so anything read at module scope misses .env entirely.
function syncConcurrency(): number {
  return Math.max(1, Number(process.env.SYNC_CONCURRENCY) || 4);
}

const CADENCE_FILES = [
  { file: "analysis.json", cadence: "twice_weekly" },
  { file: "analysis_daily.json", cadence: "daily" },
  { file: "analysis_weekly.json", cadence: "weekly" },
  { file: "analysis_biweekly.json", cadence: "biweekly" },
  { file: "analysis_monthly.json", cadence: "monthly" },
];

/** Run `worker` over `items`, at most `limit` in flight. Never rejects. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** Sync one client on one platform: run the agent, record state, persist snapshots. */
async function syncClientPlatform(
  client: { id: string; googleCreds?: Record<string, string>; metaCreds?: Record<string, string> },
  platform: AgentPlatform,
  agentPath: string,
  pythonPath: string,
): Promise<void> {
  const label = platform === "google" ? "Google" : "Meta";
  const creds = platform === "google" ? client.googleCreds : client.metaCreds;

  log(`Scheduler: Running ${label} Ads Agent for client '${client.id}'...`, "scheduler");
  inFlightSyncs.add(syncKey(client.id, platform));
  setPlatformSyncState(client.id, platform, {
    last_synced_at: new Date().toISOString(),
    sync_status: "loading",
    error: null,
  });

  try {
    await execFileAsync(pythonPath, [agentPath, "--client", client.id, "--multi-cadence"], {
      cwd: ADS_AGENT_DIR,
      timeout: 600000,
      env: { ...process.env, ...creds },
    });

    setPlatformSyncState(client.id, platform, {
      last_synced_at: new Date().toISOString(),
      last_successful_fetch: getLatestAnalysisTimestamp(client.id, platform),
      sync_status: "success",
      error: null,
    });

    // PERSIST TO DB: capture every cadence file the agent wrote and push to Postgres
    const dir = path.join(DATA_BASE, "clients", client.id, platform);
    for (const { file, cadence } of CADENCE_FILES) {
      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        await saveAnalysisSnapshot(client.id, platform, data, cadence);
      } catch (e) {
        log(`[DB Push] Failed to persist ${label} ${cadence} snapshot for ${client.id}: ${e}`, "scheduler");
      }
    }

    if (platform === "google") {
      try {
        await generateBiddingRecommendations(client.id);
      } catch (e) {
        log(`[Bidding] Failed for ${client.id}: ${e}`, "scheduler");
      }
    }

    log(`Scheduler: ${label} agent completed for client '${client.id}'`, "scheduler");
  } catch (error: any) {
    setPlatformSyncState(client.id, platform, {
      last_synced_at: new Date().toISOString(),
      sync_status: "failed",
      // Was previously never persisted — the client's failure banners have a
      // `syncState.error` field to display, but it always rendered nothing
      // because this catch block only logged the message and dropped it.
      error: error?.message || String(error) || "Unknown error",
    });
    log(`Scheduler: ${label} agent failed for client '${client.id}': ${error.message}`, "scheduler");
  } finally {
    inFlightSyncs.delete(syncKey(client.id, platform));
  }
}

async function runAgent(options: AgentRunOptions = {}): Promise<void> {
  const { clientIds, platforms } = options;
  const isScoped = Boolean(clientIds?.length || platforms?.length);

  // Only a full run has to wait for another run to finish; a scoped manual sync
  // (single client/platform) may start right away — it skips any client/platform
  // pair that already has an agent process attached to it.
  if (!isScoped && activeRuns > 0) {
    log("Scheduler: Agent already running, skipping", "scheduler");
    return;
  }

  const wantsPlatform = (platform: AgentPlatform) => !platforms?.length || platforms.includes(platform);

  activeRuns++;
  schedulerStatus.isRunning = true;
  const startTime = Date.now();
  broadcastSSE("agent-run-started", { timestamp: new Date().toISOString() });

  try {
    log("Scheduler: Starting agent run...", "scheduler");

    const metaAgent = path.join(ADS_AGENT_DIR, "meta_ads_agent_v2.py");
    const googleAgent = path.join(ADS_AGENT_DIR, "google_ads_agent_v2.py");
    let clients = await loadClientsWithCredentials();

    // Filter to specific clients when triggered by a non-admin user
    if (clientIds && clientIds.length > 0) {
      clients = clients.filter((c) => clientIds.includes(c.id));
      log(`Scheduler: Scoped run for clients: ${clientIds.join(", ")}`, "scheduler");
    }
    if (platforms?.length) {
      log(`Scheduler: Scoped run for platforms: ${platforms.join(", ")}`, "scheduler");
    }

    // Both platforms run the same per-client pipeline, so drive them through one
    // worker and a concurrency pool. Each client is an independent Python process
    // with its own credentials — nothing is shared but platformSyncState, which is
    // keyed per client and flushed with a synchronous write, so it can't interleave.
    const pythonPath = resolvePythonPath();

    const legs: Array<{ platform: AgentPlatform; agent: string; clients: typeof clients }> = [];
    if (fs.existsSync(metaAgent) && wantsPlatform("meta")) {
      const metaClients = clients
        .filter((c) => c.metaCreds?.META_ACCESS_TOKEN)
        .filter((c) => !isPlatformSyncing(c.id, "meta"));
      if (metaClients.length === 0) {
        log("Scheduler: No Meta clients with credentials configured — skipping Meta agent", "scheduler");
      }
      legs.push({ platform: "meta", agent: metaAgent, clients: metaClients });
    }
    if (fs.existsSync(googleAgent) && wantsPlatform("google")) {
      const googleClients = clients
        .filter((c) => c.googleCreds?.GOOGLE_REFRESH_TOKEN)
        .filter((c) => !isPlatformSyncing(c.id, "google"));
      if (googleClients.length === 0) {
        log("Scheduler: No Google clients with credentials configured — skipping Google agent", "scheduler");
      }
      legs.push({ platform: "google", agent: googleAgent, clients: googleClients });
    }

    for (const leg of legs) {
      if (leg.clients.length === 0) continue;
      const concurrency = Math.min(syncConcurrency(), leg.clients.length);
      log(
        `Scheduler: ${leg.platform} leg — ${leg.clients.length} client(s), ${concurrency} at a time`,
        "scheduler",
      );
      await runWithConcurrency(leg.clients, concurrency, (client) =>
        syncClientPlatform(client, leg.platform, leg.agent, pythonPath),
      );
    }


    const duration = Date.now() - startTime;
    schedulerStatus.lastRun = new Date().toISOString();
    schedulerStatus.lastRunSuccess = true;
    schedulerStatus.lastRunDuration = duration;
    schedulerStatus.lastError = null;
    activeRuns = Math.max(0, activeRuns - 1);
    schedulerStatus.isRunning = activeRuns > 0;

    schedulerStatus.runHistory.unshift({
      timestamp: schedulerStatus.lastRun,
      success: true,
      duration,
    });
    // Keep last 30 runs
    if (schedulerStatus.runHistory.length > 30) {
      schedulerStatus.runHistory = schedulerStatus.runHistory.slice(0, 30);
    }

    saveStatus();
    log(`Scheduler: Agent run completed in ${(duration / 1000).toFixed(1)}s`, "scheduler");

    // Notify all connected clients to refresh data
    broadcastSSE("data-refreshed", {
      timestamp: new Date().toISOString(),
      duration,
    });
  } catch (err: any) {
    const errorMessage = err.message || "Unknown error";
    const duration = Date.now() - startTime;
    schedulerStatus.lastRun = new Date().toISOString();
    schedulerStatus.lastRunSuccess = false;
    schedulerStatus.lastRunDuration = duration;
    schedulerStatus.lastError = errorMessage;
    activeRuns = Math.max(0, activeRuns - 1);
    schedulerStatus.isRunning = activeRuns > 0;

    schedulerStatus.runHistory.unshift({
      timestamp: schedulerStatus.lastRun,
      success: false,
      duration,
      error: errorMessage,
    });
    if (schedulerStatus.runHistory.length > 30) {
      schedulerStatus.runHistory = schedulerStatus.runHistory.slice(0, 30);
    }

    saveStatus();
    log(`Scheduler: Agent run failed: ${errorMessage}`, "scheduler");

    broadcastSSE("agent-run-failed", {
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }
}

export function triggerManualRun(options: AgentRunOptions = {}): void {
  runAgent(options).catch((err) => log(`Manual run error: ${err.message}`, "scheduler"));
}

async function runAvailableFundsRefresh(): Promise<void> {
  try {
    const outcomes = await refreshAllAvailableFunds();
    const failed = outcomes.filter((o) => !o.ok);
    log(`Scheduler: Available funds refresh done — ${outcomes.length - failed.length}/${outcomes.length} succeeded`, "scheduler");
    if (failed.length > 0) {
      log(`Scheduler: Available funds failures: ${failed.map((f) => `${f.clientId}/${f.platform}: ${f.error}`).join("; ")}`, "scheduler");
    }
    // Live-push equivalent of Firestore onSnapshot: tell connected dashboards to
    // refetch their cached available-funds value now that it's been updated.
    broadcastSSE("available-funds-refreshed", { timestamp: new Date().toISOString() });
  } catch (err: any) {
    log(`Scheduler: Available funds refresh failed: ${err.message}`, "scheduler");
  }
}

export function initScheduler(): void {
  loadStatus();
  loadPlatformSyncState();

  // Schedule daily at 9:00 AM IST (03:30 UTC)
  // IST is UTC+5:30, so 9:00 AM IST = 3:30 AM UTC
  cron.schedule("30 3 * * *", () => {
    log("Scheduler: 9 AM IST trigger — starting agent run", "scheduler");
    runAgent();
  }, {
    timezone: "Asia/Kolkata",
  });

  // Available funds (Meta wallet / Google account_budget) refresh every 30 minutes,
  // mirroring the reference googleSync/metaSync Cloud Scheduler cadence.
  cron.schedule("*/30 * * * *", () => {
    log("Scheduler: 30-min trigger — refreshing available funds", "scheduler");
    runAvailableFundsRefresh();
  });

  // Seed the cache shortly after boot so the first dashboard load doesn't have to
  // wait up to 30 minutes for a value.
  setTimeout(runAvailableFundsRefresh, 10_000);

  // Compute next run time
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(9, 0, 0, 0);
  // Adjust for IST — but cron handles timezone, so we store the display time
  if (now.getHours() >= 9 || (now.getHours() === 9 && now.getMinutes() >= 0)) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  schedulerStatus.nextRun = nextRun.toISOString();
  saveStatus();

  log("Scheduler: Initialized — daily run at 9:00 AM IST, available funds every 30 min", "scheduler");
}
