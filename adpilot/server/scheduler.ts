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
        .filter((name) => /^analysis(?:_.+)?\.json$/.test(name))
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
  return updated;
}

export function getPlatformSyncState(clientId: string, platform: string): PlatformSyncState {
  const stored = platformSyncState[clientId]?.[platform];
  if (stored) {
    const inferredFetch = getLatestAnalysisTimestamp(clientId, platform);
    return {
      last_synced_at: stored.last_synced_at || inferredFetch,
      last_successful_fetch: stored.last_successful_fetch || inferredFetch,
      sync_status: inferredFetch ? "success" : (stored.sync_status || "idle"),
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

async function runAgent(clientIds?: string[]): Promise<void> {
  if (schedulerStatus.isRunning) {
    log("Scheduler: Agent already running, skipping", "scheduler");
    return;
  }

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

    if (fs.existsSync(metaAgent)) {
      const metaClients = clients.filter((c) => c.metaCreds?.META_ACCESS_TOKEN);
      if (metaClients.length === 0) {
        log("Scheduler: No Meta clients with credentials configured — skipping Meta agent", "scheduler");
      }
      for (const client of metaClients) {
        log(`Scheduler: Running Meta Ads Agent for client '${client.id}'...`, "scheduler");
        const syncStartedAt = new Date().toISOString();
        setPlatformSyncState(client.id, "meta", {
          last_synced_at: syncStartedAt,
          sync_status: "loading",
        });
        try {
          // Explicitly pass env variables to ensure agent has access tokens
          const pythonPath = resolvePythonPath();
          log(`Scheduler: Executing Meta agent with ${pythonPath} for client ${client.id}`, "scheduler");
          
          await execFileAsync(pythonPath, [metaAgent, "--client", client.id, "--multi-cadence"], {
            cwd: ADS_AGENT_DIR,
            timeout: 600000,
            env: { ...process.env, ...client.metaCreds },
          });

          const syncCompletedAt = new Date().toISOString();
          setPlatformSyncState(client.id, "meta", {
            last_synced_at: syncCompletedAt,
            last_successful_fetch: getLatestAnalysisTimestamp(client.id, "meta"),
            sync_status: "success",
          });

          // PERSIST TO DB: Capture all cadence JSON files and push to Postgres
          const metaDir = path.join(DATA_BASE, "clients", client.id, "meta");
          const cadenceFiles = [
            { file: "analysis.json", cadence: "twice_weekly" },
            { file: "analysis_daily.json", cadence: "daily" },
            { file: "analysis_weekly.json", cadence: "weekly" },
            { file: "analysis_biweekly.json", cadence: "biweekly" },
            { file: "analysis_monthly.json", cadence: "monthly" },
          ];
          for (const { file, cadence } of cadenceFiles) {
            const filePath = path.join(metaDir, file);
            if (fs.existsSync(filePath)) {
              try {
                const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                await saveAnalysisSnapshot(client.id, "meta", data, cadence);
              } catch (e) {
                log(`[DB Push] Failed to persist Meta ${cadence} snapshot for ${client.id}: ${e}`, "scheduler");
              }
            }
          }
        } catch (error: any) {
          setPlatformSyncState(client.id, "meta", {
            last_synced_at: new Date().toISOString(),
            sync_status: "failed",
          });
          log(`Scheduler: Meta agent failed for client '${client.id}': ${error.message}`, "scheduler");
        }
      }
    }

    if (fs.existsSync(googleAgent)) {
      const googleClients = clients.filter((c) => c.googleCreds?.GOOGLE_REFRESH_TOKEN);
      if (googleClients.length === 0) {
        log("Scheduler: No Google clients with credentials configured — skipping Google agent", "scheduler");
      }
      for (const client of googleClients) {
        log(`Scheduler: Running Google Ads Agent for client '${client.id}'...`, "scheduler");
        const syncStartedAt = new Date().toISOString();
        setPlatformSyncState(client.id, "google", {
          last_synced_at: syncStartedAt,
          sync_status: "loading",
        });
        try {
          const pythonPath = resolvePythonPath();
          log(`Scheduler: Executing Google agent with ${pythonPath} for client ${client.id}`, "scheduler");
          
          await execFileAsync(pythonPath, [googleAgent, "--client", client.id, "--multi-cadence"], {
            cwd: ADS_AGENT_DIR,
            timeout: 600000,
            env: { ...process.env, ...client.googleCreds },
          });
        } catch (error: any) {
          setPlatformSyncState(client.id, "google", {
            last_synced_at: new Date().toISOString(),
            sync_status: "failed",
          });
          log(`Scheduler: Google agent failed for client '${client.id}': ${error.message}`, "scheduler");
          continue;
        }
        setPlatformSyncState(client.id, "google", {
          last_synced_at: new Date().toISOString(),
          last_successful_fetch: getLatestAnalysisTimestamp(client.id, "google"),
          sync_status: "success",
        });

        // PERSIST TO DB: Capture all cadence JSON files and push to Postgres
        const googleDir = path.join(DATA_BASE, "clients", client.id, "google");
        const googleCadenceFiles = [
          { file: "analysis.json", cadence: "twice_weekly" },
          { file: "analysis_daily.json", cadence: "daily" },
          { file: "analysis_weekly.json", cadence: "weekly" },
          { file: "analysis_biweekly.json", cadence: "biweekly" },
          { file: "analysis_monthly.json", cadence: "monthly" },
        ];
        for (const { file, cadence } of googleCadenceFiles) {
          const filePath = path.join(googleDir, file);
          if (fs.existsSync(filePath)) {
            try {
              const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
              await saveAnalysisSnapshot(client.id, "google", data, cadence);
            } catch (e) {
              log(`[DB Push] Failed to persist Google ${cadence} snapshot for ${client.id}: ${e}`, "scheduler");
            }
          }
        }

        // RUN BIDDING INTELLIGENCE
        try {
          await generateBiddingRecommendations(client.id);
        } catch (e) {
          log(`[Bidding] Failed for ${client.id}: ${e}`, "scheduler");
        }
        log(`Scheduler: Google agent completed for client '${client.id}'`, "scheduler");
      }
    }

    const duration = Date.now() - startTime;
    schedulerStatus.lastRun = new Date().toISOString();
    schedulerStatus.lastRunSuccess = true;
    schedulerStatus.lastRunDuration = duration;
    schedulerStatus.lastError = null;
    schedulerStatus.isRunning = false;

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
    schedulerStatus.isRunning = false;

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

export function triggerManualRun(clientIds?: string[]): void {
  runAgent(clientIds).catch((err) => log(`Manual run error: ${err.message}`, "scheduler"));
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

  log("Scheduler: Initialized — daily run at 9:00 AM IST", "scheduler");
}
