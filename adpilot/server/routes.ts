import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);

import type { RecommendationAction, QuickActionType } from "@shared/schema";
import {
  executeAction,
  executeBatch,
  getAuditLog,
  getEntityStatus,
  appendAuditEntry,
  type ExecutionRequest,
  type ExecutionActionType,
} from "./meta-execution";
import {
  recordExecution,
  getLearningData,
  getLearningSummary,
  triggerOutcomeUpdate,
} from "./execution-learning";
import {
  loadAnalysisSnapshot,
  analysisCache,
  ANALYSIS_CACHE_TTL,
  getCacheKey,
  invalidateAnalysisCache,
} from "./analysis-persistence";
import { pool, db } from "./db";
import { analysisSnapshots, biddingRecommendations, performanceAlerts } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { normalizeGoogleAnalysis } from "./google-transform";
import { normalizeMetaAnalysis } from "./meta-transform";
import {
  executeGoogleAction,
  executeGoogleBatch,
  getGoogleAuditLog,
  appendGoogleAuditEntry,
  type GoogleExecutionRequest,
  type GoogleExecutionActionType,
} from "./google-execution";
import {
  addSSEClient,
  getPlatformSyncState,
  getSchedulerStatus,
  triggerManualRun,
} from "./scheduler";
import { handleAICommand } from "./ai-command";
import {
  duplicateCreativeThread,
  generateCreativeImageForThread,
  generateCreativeThread,
  getCreativeHubState,
  regenerateCreativeSectionForThread,
  saveCreativeSetup,
  updateCreativeThreadTag,
  type CreativePlatform,
  type CreativeSectionKey,
  type CreativeStatusTag,
} from "./creative-hub";
import { generateBiddingRecommendations } from "./bidding-intelligence";
import { storage } from "./storage";
import { requireAdmin, requireOwnership, requireAuth, getUserById } from "./auth";
import { insightsEngine } from "./intelligence-engine";
import { getCache, setCache, invalidateCachePattern, cacheKey } from "./cache";

// ─── Multi-Client Registry ─────────────────────────────────────────
// The registry is now persisted to disk so clients added via the UI survive restarts.
// File: ads_agent/data/clients_registry.json
// ... (later in the file)

interface PlatformConfig {
  enabled: boolean;
  dataPath: string; // path to analysis JSON
  label: string;
}

interface ClientTargets {
  budget: number;
  leads: number;
  cpl: number;
  svs: { low: number; high: number };
  cpsv: { low: number; high: number };
}

interface ClientConfig {
  id: string;
  name: string;
  shortName: string;
  project: string;
  location: string;
  targetLocations?: string[];
  platforms: Record<string, PlatformConfig>;
  targets?: Record<string, ClientTargets>;
  createdAt?: string;
  createdBy?: string | null;
}

// Per-client API credentials stored separately (never sent to the frontend)
interface ClientCredentials {
  clientId: string;
  meta?: {
    accessToken: string;
    adAccountId: string;
  };
  google?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    developerToken: string;
    mccId: string;
    customerId: string;
  };
  updatedAt: string;
}

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const BENCHMARKS_BASE = path.join(DATA_BASE, "clients");
const getClientDataDir = (clientId: string) => path.join(DATA_BASE, "clients", clientId);
const AI_CONFIG_FILE = path.join(DATA_BASE, "ai_config.json");

function readAiConfig() {
  try {
    if (fs.existsSync(AI_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(AI_CONFIG_FILE, "utf-8"));
    }
  } catch { }
  return {
    openapiApiKey: process.env.OPENAPI_API_KEY || process.env.OPENAPI_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    geminiImageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-preview-image-generation",
    groqApiKey: process.env.GROQ_API_KEY || "",
    groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  };
}

function saveAiConfig(config: any) {
  fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(config, null, 2));
}
const REGISTRY_FILE = path.join(DATA_BASE, "clients_registry.json");
const CREDENTIALS_FILE = path.join(DATA_BASE, "clients_credentials.json");
const GOOGLE_ADS_TOKEN_CACHE = path.resolve(import.meta.dirname, "../../ads_agent/.google_ads_token_cache.json");
const LEGACY_GOOGLE_CREDS_FILE = path.resolve(import.meta.dirname, "../../ads_agent/google_ads_credentials.json");
const GOOGLE_ADS_API_VERSION = "v21";
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// ─── Registry persistence helpers ─────────────────────────────────

// All clients are DB-driven. No hardcoded defaults.

function ensureDataDir() {
  if (!fs.existsSync(DATA_BASE)) fs.mkdirSync(DATA_BASE, { recursive: true });
}

async function loadRegistry(): Promise<ClientConfig[]> {
  const clients = await storage.getAllClients();
  return clients.map(c => ({
    ...c,
    targetLocations: c.targetLocations as string[] || [],
    platforms: c.platforms as Record<string, PlatformConfig>,
    targets: c.targets as Record<string, ClientTargets> || {},
    createdAt: c.createdAt?.toISOString()
  }));
}

async function saveRegistry(registry: ClientConfig[]): Promise<void> {
  // Logic to sync the entire registry is replaced by per-client atomic storage methods.
  // We keep this function sig for easier refactoring of routes.
  for (const client of registry) {
    const existing = await storage.getClient(client.id);
    if (existing) {
      await storage.updateClient(client.id, client);
    } else {
      await storage.createClient(client);
    }
  }
}

async function loadCredentials(): Promise<Record<string, ClientCredentials>> {
  const clients = await storage.getAllClients();
  const result: Record<string, ClientCredentials> = {};
  for (const c of clients) {
    const creds = await storage.getCredentials(c.id);
    if (creds) {
      result[c.id] = {
        clientId: c.id,
        meta: creds.meta ? { accessToken: creds.meta.accessToken, adAccountId: creds.meta.adAccountId } : undefined,
        google: creds.google as any,
        updatedAt: creds.updatedAt?.toISOString() || ""
      };
    }
  }
  return result;
}

async function saveCredentials(store: Record<string, ClientCredentials>): Promise<void> {
  for (const [clientId, data] of Object.entries(store)) {
    await storage.saveCredentials(clientId, data);
  }
}

function isPlaceholderSecret(value?: string): boolean {
  return !value || value.trim() === "" || value.trim().startsWith("YOUR_");
}

function normalizeGoogleAccountId(value?: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

function parseGoogleAdsApiError(body: any): string {
  try {
    const details = body?.error?.details ?? [];
    const messages: string[] = [];
    for (const detail of details) {
      for (const err of detail?.errors ?? []) {
        messages.push(err?.message ?? JSON.stringify(err?.errorCode ?? {}));
      }
    }
    if (messages.length) return messages.join("; ");
    return body?.error?.message || JSON.stringify(body).slice(0, 500);
  } catch {
    return "Unknown Google Ads API error";
  }
}

async function getGoogleAccessTokenForClient(google: NonNullable<ClientCredentials["google"]>): Promise<string> {
  const body = new URLSearchParams({
    client_id: google.clientId,
    client_secret: google.clientSecret,
    refresh_token: google.refreshToken,
    grant_type: "refresh_token",
  });

  const resp = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.access_token) {
    throw new Error(
      `Token refresh failed: ${resp.status}${data ? ` - ${parseGoogleAdsApiError(data)}` : ""}`
    );
  }

  return data.access_token;
}

async function verifyGoogleClientConnection(google: NonNullable<ClientCredentials["google"]>) {
  const customerId = normalizeGoogleAccountId(google.customerId);
  const mccId = normalizeGoogleAccountId(google.mccId);

  if (!customerId) {
    throw new Error("Google customer ID is required");
  }
  if (!google.developerToken) {
    throw new Error("Google developer token is required");
  }

  const accessToken = await getGoogleAccessTokenForClient(google);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": google.developerToken,
    "Content-Type": "application/json",
  };
  if (mccId && mccId !== customerId) {
    headers["login-customer-id"] = mccId;
  }

  const resp = await fetch(`${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone
        FROM customer
        LIMIT 1
      `,
    }),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(parseGoogleAdsApiError(data) || `Google Ads API request failed (${resp.status})`);
  }

  const customer = data?.results?.[0]?.customer ?? {};
  return {
    ok: true,
    api_version: GOOGLE_ADS_API_VERSION,
    customer_id: String(customer.id || customerId),
    mcc_id: mccId,
    descriptive_name: customer.descriptiveName || "",
    currency_code: customer.currencyCode || "",
    time_zone: customer.timeZone || "",
  };
}

function getValidMetaCreds(creds?: ClientCredentials) {
  if (!creds?.meta) return null;
  if (isPlaceholderSecret(creds.meta.accessToken) || isPlaceholderSecret(creds.meta.adAccountId)) return null;
  return creds.meta;
}

function getValidGoogleCreds(creds?: ClientCredentials) {
  if (!creds?.google) return null;
  if (
    isPlaceholderSecret(creds.google.clientId) ||
    isPlaceholderSecret(creds.google.clientSecret) ||
    isPlaceholderSecret(creds.google.refreshToken)
  ) {
    return null;
  }
  return creds.google;
}

// Credentials are DB-only. No ENV fallbacks for client credentials.

function getEffectiveMetaCreds(clientId: string, credsStore: Record<string, ClientCredentials>) {
  return getValidMetaCreds(credsStore[clientId]) || null;
}

function syncLegacyGoogleCredentialsFile(google?: ClientCredentials["google"]): void {
  if (!google) return;
  const payload = {
    client_id: google.clientId,
    client_secret: google.clientSecret,
    refresh_token: google.refreshToken,
    developer_token: google.developerToken,
    login_customer_id: normalizeGoogleAccountId(google.mccId),
    default_client_id: normalizeGoogleAccountId(google.customerId),
  };
  fs.writeFileSync(LEGACY_GOOGLE_CREDS_FILE, JSON.stringify(payload, null, 2));
}

// Live in-memory registry (loaded at startup, mutated by CRUD APIs)
// Live registry is now loaded on-demand via await loadRegistry()

// Some deployments persist `clients_registry.json` with absolute, machine-specific
// `dataPath` values (e.g. from a different laptop). Normalize those paths back
// into this server's `DATA_BASE` so we can correctly compute `hasData`.
function resolvePlatformDataPath(clientId: string, platform: string, platformConfig: PlatformConfig): string {
  const configured = typeof platformConfig?.dataPath === "string" ? platformConfig.dataPath : "";

  if (!configured) {
    return path.join(DATA_BASE, `clients/${clientId}/${platform}/analysis.json`);
  }

  // If the configured path already exists on this machine, use it.
  if (fs.existsSync(configured)) return configured;

  // If the registry stores an absolute path containing "ads_agent/data/",
  // map the suffix into our local DATA_BASE.
  const normalized = configured.replace(/\\/g, "/");
  const marker = "ads_agent/data/";
  const markerIdx = normalized.indexOf(marker);
  if (markerIdx !== -1) {
    const relativeToAdsAgentData = normalized.slice(markerIdx + marker.length);
    return path.join(DATA_BASE, relativeToAdsAgentData);
  }

  // Otherwise, fall back to the default expected location.
  return path.join(DATA_BASE, `clients/${clientId}/${platform}/analysis.json`);
}


// ─── Custom Instructions Storage ──────────────────────────────────
const INSTRUCTIONS_FILE = path.join(DATA_BASE, "custom_instructions.json");

interface Instruction {
  id: string;
  clientId: string;
  platform: string;
  instruction: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "normal" | "low";
  createdAt: string;
  executedAt: string | null;
  result: string | null;
}

interface InstructionsStore {
  instructions: Instruction[];
}

function readInstructions(): InstructionsStore {
  if (!fs.existsSync(INSTRUCTIONS_FILE)) {
    return { instructions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(INSTRUCTIONS_FILE, "utf-8"));
  } catch {
    return { instructions: [] };
  }
}

function writeInstructions(store: InstructionsStore): void {
  const dir = path.dirname(INSTRUCTIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INSTRUCTIONS_FILE, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── File-based Recommendation Actions (replaces in-memory Map) ───
const RECOMMENDATION_ACTIONS_PATH = path.join(DATA_BASE, "recommendation_actions.json");
const ACTION_LOGS_PATH = path.join(DATA_BASE, "action_logs.json");

type ActionRecord = { action: RecommendationAction; timestamp: string; strategic_call?: string };

function readRecommendationActions(): Record<string, ActionRecord> {
  if (!fs.existsSync(RECOMMENDATION_ACTIONS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(RECOMMENDATION_ACTIONS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeRecommendationActions(data: Record<string, ActionRecord>): void {
  const dir = path.dirname(RECOMMENDATION_ACTIONS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RECOMMENDATION_ACTIONS_PATH, JSON.stringify(data, null, 2));
}

function appendActionLog(entry: {
  id: string;
  clientId: string;
  platform: string;
  action: string;
  strategic_call: string;
  timestamp: string;
}): void {
  let logs: any[] = [];
  if (fs.existsSync(ACTION_LOGS_PATH)) {
    try { logs = JSON.parse(fs.readFileSync(ACTION_LOGS_PATH, "utf-8")); } catch { /* empty */ }
  }
  logs.push(entry);
  const dir = path.dirname(ACTION_LOGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACTION_LOGS_PATH, JSON.stringify(logs, null, 2));
}

// Load persisted recommendation actions on startup
let recommendationActionsCache: Record<string, ActionRecord> = readRecommendationActions();

function setRecommendationAction(key: string, value: ActionRecord): void {
  recommendationActionsCache[key] = value;
  writeRecommendationActions(recommendationActionsCache);
}

function getRecommendationActionsForPrefix(prefix: string): Record<string, ActionRecord> {
  const result: Record<string, ActionRecord> = {};
  for (const [key, value] of Object.entries(recommendationActionsCache)) {
    if (key.startsWith(prefix)) {
      const recId = key.slice(prefix.length);
      result[recId] = value;
    }
  }
  return result;
}

async function readAnalysisData(clientId: string, platform: string, cadence?: string): Promise<any> {
  const cacheKey = getCacheKey(clientId, platform, cadence);
  const cached = analysisCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ANALYSIS_CACHE_TTL) {
    console.log(`[readAnalysisData] [CACHE HIT] Returning cached analysis for ${clientId}/${platform} (${cadence ?? 'default'})`);
    return cached.data;
  }
  console.log(`[readAnalysisData] [CACHE MISS/INVALIDATED] Recalculating analysis scores for ${clientId}/${platform} (${cadence ?? 'default'})...`);

  let raw: any = null;

  // 1. Try DB first (Most reliable)
  const snap = await loadAnalysisSnapshot(clientId, platform, cadence);
  if (snap) {
    raw = snap;
  }

  // 2. File fallback
  if (!raw) {
    const currentRegistry = await loadRegistry();
    const client = currentRegistry.find((c) => c.id === clientId);
    if (!client) {
      throw new Error(`Client '${clientId}' not found in registry`);
    }
    const platformConfig = client.platforms[platform];
    if (!platformConfig) {
      throw new Error(`Platform '${platform}' not configured for client '${clientId}'`);
    }

    let dataPath = resolvePlatformDataPath(clientId, platform, platformConfig);

    if (cadence) {
      const cadencePath = dataPath.replace(/analysis\.json$/, `analysis_${cadence}.json`);
      if (fs.existsSync(cadencePath)) dataPath = cadencePath;
    }

    if (!fs.existsSync(dataPath)) {
      throw new Error(`No analysis data found (DB or File) for ${clientId}/${platform}`);
    }

    raw = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  }

  // 3. Load Benchmarks for health score calculation
  // PRIORITY: platform-specific file first (written by PUT /benchmarks),
  // then fall back to the generic benchmarks.json.
  // This ensures scores always reflect the latest benchmarks saved from the UI.
  let benchmarksData: any = null;
  try {
    const canonicalPath = path.join(BENCHMARKS_BASE, clientId, `benchmarks_${platform}.json`);
    const altPath1 = path.join(DATA_BASE, "clients", clientId, `benchmarks_${platform}.json`);
    const altPath2 = path.join(DATA_BASE, "clients", clientId, "benchmarks.json");
    const legacyPath = path.join(BENCHMARKS_BASE, clientId, "benchmarks.json");

    // Try paths in priority order: platform-specific → fallback
    const tryPaths = [canonicalPath, altPath1, altPath2, legacyPath];
    const bmPath = tryPaths.find(p => fs.existsSync(p));

    if (bmPath) {
      benchmarksData = JSON.parse(fs.readFileSync(bmPath, "utf-8"));
      console.log(`[readAnalysisData] Loaded benchmarks from: ${bmPath}`);
    }
  } catch (e) {
    console.warn(`[readAnalysisData] Failed to load benchmarks for ${clientId}/${platform}:`, e);
  }

  // 4. Attach Benchmarks to raw data before normalization
  if (benchmarksData) {
    raw.sop_benchmarks = benchmarksData;
  }

  // 4b. Load and attach MTD Deliverables (svs_achieved, positive_leads_achieved) for CPSV/CPQL scoring
  try {
    let mtdPath = path.join(DATA_BASE, "clients", clientId, `mtd_deliverables_${platform}.json`);
    if (!fs.existsSync(mtdPath) && platform === "meta") {
      mtdPath = path.join(DATA_BASE, "clients", clientId, "mtd_deliverables.json");
    }
    if (fs.existsSync(mtdPath)) {
      raw.mtd_deliverables = JSON.parse(fs.readFileSync(mtdPath, "utf-8"));
    }
  } catch (e) {
    // Silently fail
  }

  // 5. Normalize Google data into canonical shape
  const data = platform === "google"
    ? normalizeGoogleAnalysis(raw)
    : normalizeMetaAnalysis(raw);

  analysisCache.set(cacheKey, { data, ts: Date.now() });

  // ─── Learning Engine Sync ──────────────────────────────────────
  // Every time we load fresh data, check if any pending actions can now be closed
  try {
    const updated = triggerOutcomeUpdate(data);
    if (updated > 0) {
      console.log(`[Outcome Evaluator] Automatically updated ${updated} action outcomes based on fresh data.`);
    }
  } catch (err: any) {
    console.warn(`[Outcome Evaluator] Background update failed: ${err.message}`);
  }

  return data;
}

// List available cadence files for a client/platform
async function listCadences(clientId: string, platform: string): Promise<string[]> {
  const currentRegistry = await loadRegistry();
  const client = currentRegistry.find((c) => c.id === clientId);
  if (!client) return [];
  const platformConfig = client.platforms[platform];
  if (!platformConfig) return [];
  const dir = path.dirname(resolvePlatformDataPath(clientId, platform, platformConfig));
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const cadences: string[] = [];
  for (const f of files) {
    const match = f.match(/^analysis_(.+)\.json$/);
    if (match) cadences.push(match[1]);
  }
  return cadences;
}

// ─── Helper: get benchmarks from registry targets ─────────────────
async function getDefaultBenchmarks(clientId: string, platform?: string): Promise<any> {
  const currentRegistry = await loadRegistry();
  const client = currentRegistry.find((c) => c.id === clientId);
  const targets = client?.targets;

  // Use the specified platform's targets, or fall back to meta, or use hardcoded defaults
  const platformTargets = targets?.[platform || "meta"] || targets?.meta;

  return {
    budget: platformTargets?.budget || 200000,
    leads: platformTargets?.leads || 278,
    cpl: platformTargets?.cpl || 720,
    ctr_min: 0.7,
    cvr_min: 4.0,
    cpm_max: 300,
    cpsv_low: platformTargets?.cpsv?.low || 18000,
    cpsv_high: platformTargets?.cpsv?.high || 20000,
    svs_low: platformTargets?.svs?.low || 10,
    svs_high: platformTargets?.svs?.high || 12,
    tsr_min: 30.0,
    vhr_min: 25.0,
    frequency_max: 2.5,
    cpc_max: 50,
    auto_pause_cpl_threshold_pct: 135,
    auto_pause_zero_leads_impressions: 8000,
    target_locations: client?.targetLocations || ["Hyderabad", "Secunderabad"],
    svs_mtd: 3,
    closures_mtd: 1,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ─── Health check (tests DB connectivity) ───────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(503).json({ status: "error", db: "disconnected", detail: err.message });
    }
  });



  // ─── Client Registry Endpoints ─────────────────────────────────

  app.get("/api/clients", requireAuth, async (req, res) => {
    const user = req.authUser!;
    const registry = await storage.getAllClients(user.role === "admin" ? undefined : user.id);

    // Collect all platforms across the filtered clients to check DB presence
    const platformStatusPromises = registry.flatMap(c => {
      const platformsObj = (c.platforms || {}) as Record<string, any>;
      return Object.keys(platformsObj).map(async (platformId) => {
        const fileExists = fs.existsSync(resolvePlatformDataPath(c.id, platformId, (c.platforms as any)[platformId]));
        let dbExists = false;
        if (process.env.DATABASE_URL) {
          try {
            const [snap] = await db
              .select({ id: analysisSnapshots.id })
              .from(analysisSnapshots)
              .where(and(
                eq(analysisSnapshots.clientId, c.id),
                eq(analysisSnapshots.platform, platformId)
              ))
              .limit(1);
            dbExists = !!snap;
          } catch (e) {
            console.error(`[hasData Check] Failed for ${c.id}/${platformId}:`, e);
          }
        }
        return { clientId: c.id, platformId, hasData: fileExists || dbExists };
      });
    });

    const platformStatuses = await Promise.all(platformStatusPromises);
    const statusMap = new Map<string, boolean>();
    platformStatuses.forEach(s => statusMap.set(`${s.clientId}:${s.platformId}`, s.hasData));

    const clients = registry.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      project: c.project,
      location: c.location,
      targetLocations: c.targetLocations || [],
      platforms: Object.entries((c.platforms || {}) as Record<string, any>).map(([key, p]: [string, any]) => ({
        id: key,
        label: p.label,
        enabled: p.enabled,
        hasData: statusMap.get(`${c.id}:${key}`) ?? false,
      })),
      targets: c.targets || {},
      createdBy: c.createdBy,
    }));
    res.json(clients);
  });

  // Get single client details
  app.get("/api/clients/:clientId", async (req, res) => {
    const userId = typeof req.session.authUserId === "string"
      ? req.session.authUserId
      : undefined;

    const user = await getUserById(userId); if (!user) return res.status(401).json({ error: "Auth required" });

    const client = await storage.getClient(req.params.clientId as string);
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Access check: Admin can see everything, members only see their own
    if (user.role === "member" && client.createdBy !== user.id) {
      return res.status(403).json({ error: "Forbidden: You do not own this client" });
    }

    res.json({
      id: client.id,
      name: client.name,
      shortName: client.shortName,
      project: client.project,
      location: client.location,
      targetLocations: client.targetLocations || [],
      platforms: Object.entries(client.platforms as Record<string, any>).map(([key, p]: [string, any]) => ({
        id: key,
        label: p.label,
        enabled: p.enabled,
        hasData: fs.existsSync(resolvePlatformDataPath(client.id, key, p)),
      })),
      targets: client.targets || {},
    });
  });

  // ─── Client CRUD (create / update / delete) ─────────────────────

  // Generate a URL-safe ID from a name
  function toClientId(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // POST /api/clients — create a new client
  app.post("/api/clients", requireAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const { name, shortName, project, location, targetLocations, enableMeta, enableGoogle } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Client name is required" });
      }
      const id = toClientId(name.trim());
      const registry = await loadRegistry();
      if (registry.find((c) => c.id === id)) {
        return res.status(409).json({ error: `A client with id '${id}' already exists` });
      }
      const newClient: ClientConfig = {
        id,
        name: name.trim(),
        shortName: (shortName || name).trim(),
        project: (project || name).trim(),
        location: (location || "").trim(),
        createdBy: user.id, // Set ownership!
        targetLocations: Array.isArray(targetLocations)
          ? targetLocations.filter(Boolean)
          : (targetLocations || "").split(",").map((s: string) => s.trim()).filter(Boolean),
        platforms: {
          meta: {
            enabled: enableMeta !== false,
            dataPath: path.join(DATA_BASE, `clients/${id}/meta/analysis.json`),
            label: "Meta Ads",
          },
          google: {
            enabled: enableGoogle !== false,
            dataPath: path.join(DATA_BASE, `clients/${id}/google/analysis.json`),
            label: "Google Ads",
          },
        },
        targets: {},
        createdAt: new Date().toISOString(),
      };

      // Ensure data directories exist
      fs.mkdirSync(path.join(DATA_BASE, `clients/${id}/meta`), { recursive: true });
      fs.mkdirSync(path.join(DATA_BASE, `clients/${id}/google`), { recursive: true });

      const insertPayload = { ...newClient };
      delete (insertPayload as any).createdAt; // let DB use defaultNow()
      await storage.createClient(insertPayload);

      // Sync to legacy registry JSON
      registry.push(newClient);
      fs.writeFileSync(path.join(DATA_BASE, "clients_registry.json"), JSON.stringify(registry, null, 2));

      res.status(201).json({ id, name: newClient.name, shortName: newClient.shortName });
    } catch (err: any) {
      console.error("[POST /api/clients] Failed to create client:", err);
      res.status(500).json({ error: err.message || "Internal Server Error" });
    }
  });

  // PUT /api/clients/:clientId — update name, location, targets, platform enable/disable
  app.put("/api/clients/:clientId", async (req, res) => {
    const userId = typeof req.session.authUserId === "string"
      ? req.session.authUserId
      : undefined;

    const user = await getUserById(userId); if (!user) return res.status(401).json({ error: "Auth required" });

    const existing = await storage.getClient(req.params.clientId as string);
    if (!existing) return res.status(404).json({ error: "Client not found" });

    // Ownership check
    if (user.role === "member" && existing.createdBy !== user.id) {
      return res.status(403).json({ error: "Forbidden: You do not own this client" });
    }

    const { name, shortName, project, location, targetLocations, enableMeta, enableGoogle, targets } = req.body;

    const updatedClient = {
      ...existing,
      name: (name || existing.name).trim(),
      shortName: (shortName || existing.shortName).trim(),
      project: (project || existing.project).trim(),
      location: (location !== undefined ? location : existing.location).trim(),
      targetLocations: Array.isArray(targetLocations)
        ? targetLocations.filter(Boolean)
        : existing.targetLocations,
      platforms: {
        ...(existing.platforms as Record<string, any>),
        meta: { ...((existing.platforms as Record<string, any>).meta || {}), enabled: enableMeta !== undefined ? Boolean(enableMeta) : (existing.platforms as any).meta?.enabled },
        google: { ...((existing.platforms as Record<string, any>).google || {}), enabled: enableGoogle !== undefined ? Boolean(enableGoogle) : (existing.platforms as any).google?.enabled },
      },
      targets: targets !== undefined ? targets : existing.targets,
    };

    await storage.updateClient(req.params.clientId as string, updatedClient);
    res.json({ success: true, id: req.params.clientId as string });
  });

  // DELETE /api/clients/:clientId — remove from registry (data files preserved)
  app.delete("/api/clients/:clientId", async (req, res) => {
    const userId = typeof req.session.authUserId === "string"
      ? req.session.authUserId
      : undefined;

    const user = await getUserById(userId); if (!user) return res.status(401).json({ error: "Auth required" });

    const { clientId } = req.params as Record<string, string>;
    const existing = await storage.getClient(clientId);
    if (!existing) return res.status(404).json({ error: "Client not found" });

    // Ownership check
    if (user.role === "member" && existing.createdBy !== user.id) {
      return res.status(403).json({ error: "Forbidden: You do not own this client" });
    }

    await storage.deleteClient(clientId);
    await storage.deleteCredentials(clientId);
    res.json({ success: true });
  });

  // GET /api/clients/:clientId/credentials — return masked credentials (for display)
  app.get("/api/clients/:clientId/credentials", async (req, res) => {
    const userId = typeof req.session.authUserId === "string"
      ? req.session.authUserId
      : undefined;

    const user = await getUserById(userId); if (!user) return res.status(401).json({ error: "Auth required" });

    const client = await storage.getClient(req.params.clientId as string);
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Access check
    if (user.role === "member" && client.createdBy !== user.id) {
      return res.status(403).json({ error: "Forbidden: You do not own this client" });
    }

    const credsStore = await loadCredentials();
    const c = credsStore[req.params.clientId as string];
    const clientMeta = getValidMetaCreds(c);
    const clientGoogle = getValidGoogleCreds(c);
    // Mask secrets — only send whether they exist plus last 6 chars of token
    const mask = (s?: string) => s ? `••••••${s.slice(-6)}` : "";
    res.json({
      hasMeta: !!clientMeta?.accessToken,
      hasGoogle: !!clientGoogle?.clientId,
      metaSource: clientMeta ? "client" : "missing",
      googleSource: clientGoogle ? "client" : "missing",
      meta: clientMeta ? {
        accessToken: mask(clientMeta.accessToken),
        adAccountId: clientMeta.adAccountId,
      } : undefined,
      google: clientGoogle ? {
        clientId: mask(clientGoogle.clientId),
        clientSecret: mask(clientGoogle.clientSecret),
        refreshToken: mask(clientGoogle.refreshToken),
        developerToken: mask(clientGoogle.developerToken),
        mccId: clientGoogle.mccId,
        customerId: clientGoogle.customerId,
      } : undefined,
    });
  });

  app.get("/api/clients/:clientId/google/status", async (req, res) => {
    try {
      const userId = typeof req.session.authUserId === "string"
        ? req.session.authUserId
        : undefined;

      const user = await getUserById(userId); if (!user) return res.status(401).json({ error: "Auth required" });

      const clientId = req.params.clientId as string;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (user.role === "member" && client.createdBy !== user.id) {
        return res.status(403).json({ error: "Forbidden: You do not own this client" });
      }

      const credsStore = await loadCredentials();
      const google = getValidGoogleCreds(credsStore[clientId]);
      if (!google) {
        return res.status(400).json({ error: "Google credentials are not configured for this client" });
      }

      const result = await verifyGoogleClientConnection(google);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Google verification failed" });
    }
  });

  // PUT /api/clients/:clientId/credentials — save/update credentials
  app.put("/api/clients/:clientId/credentials", async (req, res) => {
    try {
      const userId = typeof req.session.authUserId === "string"
        ? req.session.authUserId
        : undefined;

      const user = await getUserById(userId); if (!user) return res.status(401).json({ error: "Auth required" });

      const { clientId } = req.params as Record<string, string>;
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Access check
      if (user.role === "member" && client.createdBy !== user.id) {
        return res.status(403).json({ error: "Forbidden: You do not own this client" });
      }

      const { meta, google } = req.body;
      const credsStore = await loadCredentials();
      const existing = credsStore[clientId] || { clientId, updatedAt: "" };

      if (meta) {
        const { accessToken, adAccountId } = meta;
        if (!accessToken || !adAccountId) {
          return res.status(400).json({ error: "Meta credentials require accessToken and adAccountId" });
        }
        existing.meta = { accessToken: accessToken.trim(), adAccountId: adAccountId.trim() };
      }

      if (google) {
        const { clientId: gClientId, clientSecret, refreshToken, developerToken, mccId, customerId } = google;
        if (!gClientId || !clientSecret || !refreshToken) {
          return res.status(400).json({ error: "Google credentials require clientId, clientSecret, and refreshToken" });
        }
        existing.google = {
          clientId: gClientId.trim(),
          clientSecret: clientSecret.trim(),
          refreshToken: refreshToken.trim(),
          developerToken: (developerToken || "").trim(),
          mccId: normalizeGoogleAccountId(mccId),
          customerId: normalizeGoogleAccountId(customerId),
        };
      }

      existing.updatedAt = new Date().toISOString();
      credsStore[clientId as string] = existing;
      await saveCredentials(credsStore);

      // Keep the legacy Python credentials file aligned for local scripts.
      if (google) {
        syncLegacyGoogleCredentialsFile(existing.google);
      }

      // Clear stale token cache so the new refresh token is used immediately.
      if (google && fs.existsSync(GOOGLE_ADS_TOKEN_CACHE)) {
        fs.unlinkSync(GOOGLE_ADS_TOKEN_CACHE);
      }

      res.json({ success: true, updatedAt: existing.updatedAt });
    } catch (err: any) {
      console.error("[PUT /api/clients/:clientId/credentials] Failed:", err);
      res.status(500).json({ error: err.message || "Failed to save credentials" });
    }
  });

  // ─── Analysis Data Endpoints (client + platform aware) ─────────

  const handleAnalysisRequest = async (req: any, res: any) => {
    try {
      const cadence = req.query.cadence as string;
      const data = await readAnalysisData(req.params.clientId as string, req.params.platform as string, cadence);
      res.json(data);
    } catch (err: any) {
      const status = err.message.includes("not found") || err.message.includes("not configured") ? 404
        : err.message.includes("not yet enabled") ? 403
          : 500;
      res.status(status).json({ error: err.message });
    }
  };

  app.get("/api/clients/:clientId/platforms/:platform/analysis", requireOwnership, handleAnalysisRequest);
  app.get("/api/clients/:clientId/:platform/analysis", requireOwnership, handleAnalysisRequest);

  app.get("/api/clients/:clientId/:platform/sync-state", requireOwnership, async (req, res) => {
    try {
      const registry = await loadRegistry();
      const client = registry.find((entry) => entry.id === req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      const platformConfig = client.platforms[req.params.platform as string];
      if (!platformConfig) {
        return res.status(404).json({ error: "Platform not configured" });
      }

      res.json(getPlatformSyncState(req.params.clientId as string, req.params.platform as string));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load sync state" });
    }
  });

  // List available cadences for a client/platform
  app.get("/api/clients/:clientId/:platform/cadences", async (req, res) => {
    const cadences = await listCadences(req.params.clientId as string, req.params.platform as string);
    res.json(cadences);
  });

  // Summary for a client/platform
  app.get("/api/clients/:clientId/platforms/:platform/performance", async (req, res) => {
    try {
      const data = await readAnalysisData(req.params.clientId as string, req.params.platform as string);
      res.json({
        summary: data.summary,
        account_pulse: data.account_pulse,
        monthly_pacing: data.monthly_pacing,
      });
    } catch (err: any) {
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ─── Paused Entities (derived from audit log) ─────────────────
  // Returns a map of entity IDs → paused info for entities whose latest
  // action in the audit log was a PAUSE (not subsequently unpaused).
  // Supports optional ?platform= query param ("meta", "google", "all").
  app.get("/api/paused-entities", requireAdmin, (_req, res) => {
    try {
      const platformFilter = (_req.query.platform as string || "all").toLowerCase();

      const paused: Record<string, { entityName: string; entityType: string; pausedAt: string; reason?: string; platform?: string }> = {};

      // Meta audit log
      if (platformFilter === "meta" || platformFilter === "all") {
        const metaLog = getAuditLog(500);
        const latestMetaAction = new Map<string, { action: string; timestamp: string; entityName: string; entityType: string; reason?: string }>();
        for (const entry of metaLog) {
          if (!latestMetaAction.has(entry.entityId)) {
            latestMetaAction.set(entry.entityId, {
              action: entry.action,
              timestamp: entry.timestamp,
              entityName: entry.entityName,
              entityType: entry.entityType,
              reason: entry.reason,
            });
          }
        }
        latestMetaAction.forEach((val, entityId) => {
          if (val.action.startsWith("PAUSE_") && !val.action.startsWith("UNPAUSE_")) {
            paused[entityId] = {
              entityName: val.entityName,
              entityType: val.entityType,
              pausedAt: val.timestamp,
              reason: val.reason,
              platform: "meta",
            };
          }
        });
      }

      // Google audit log
      if (platformFilter === "google" || platformFilter === "all") {
        const googleLog = getGoogleAuditLog(500);
        const latestGoogleAction = new Map<string, { action: string; timestamp: string; entityName: string; entityType: string; reason?: string }>();
        for (const entry of googleLog) {
          if (!latestGoogleAction.has(entry.entityId)) {
            latestGoogleAction.set(entry.entityId, {
              action: entry.action,
              timestamp: entry.timestamp,
              entityName: entry.entityName,
              entityType: entry.entityType,
              reason: entry.reason,
            });
          }
        }
        latestGoogleAction.forEach((val, entityId) => {
          if (val.action.startsWith("PAUSE_") && !val.action.startsWith("ENABLE_")) {
            paused[entityId] = {
              entityName: val.entityName,
              entityType: val.entityType,
              pausedAt: val.timestamp,
              reason: val.reason,
              platform: "google",
            };
          }
        });
      }

      res.json(paused);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Recommendation Actions (client + platform scoped) ─────────

  app.post("/api/clients/:clientId/:platform/recommendations/:id/action", requireOwnership, async (req, res) => {
    const { clientId, platform, id } = req.params as Record<string, string>;
    const { action, executionDetails, strategic_call } = req.body;
    if (!action || !["approved", "rejected", "deferred"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Must be approved, rejected, or deferred." });
    }
    if (!strategic_call || typeof strategic_call !== "string" || strategic_call.trim().length < 10) {
      return res.status(400).json({ error: "strategic_call is required (min 10 chars). No action can be taken without a rationale." });
    }
    const timestamp = new Date().toISOString();
    const key = `${clientId}:${platform}:${id}`;
    setRecommendationAction(key, {
      action: action as RecommendationAction,
      timestamp,
      strategic_call: strategic_call.trim(),
    });
    // Persist to action_logs for learning database
    appendActionLog({ id, clientId, platform, action, strategic_call: strategic_call.trim(), timestamp });

    // If approved with executionDetails, execute the action via Meta API
    if (action === "approved" && executionDetails) {
      try {
        const execReq: ExecutionRequest = {
          action: executionDetails.executionAction as ExecutionActionType,
          entityId: executionDetails.entityId,
          entityName: executionDetails.entityName || executionDetails.entityId,
          entityType: executionDetails.entityType || "adset",
          params: {
            ...(executionDetails.params || {}),
            recommendationId: id,
          },
          requestedBy: "user",
        };
        const execResult = await executeAction(execReq);
        return res.json({ success: true, id, action, execution: execResult });
      } catch (err: any) {
        return res.json({
          success: true,
          id,
          action,
          execution: { success: false, error: err.message || "Execution failed" },
        });
      }
    }

    res.json({ success: true, id, action });
  });

  app.get("/api/clients/:clientId/:platform/recommendations/actions", (req, res) => {
    const { clientId, platform } = req.params as Record<string, string>;
    const prefix = `${clientId}:${platform}:`;
    const actions = getRecommendationActionsForPrefix(prefix);
    res.json(actions);
  });

  // ─── Custom Instructions Endpoints ─────────────────────────────

  // List instructions for a client (newest first)
  app.get("/api/clients/:clientId/instructions", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const store = readInstructions();
    const clientInstructions = store.instructions
      .filter((i) => i.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(clientInstructions);
  });

  // Create a new instruction
  app.post("/api/clients/:clientId/instructions", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const { instruction, platform, priority } = req.body;
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return res.status(400).json({ error: "Instruction text is required" });
    }
    const validPlatforms = ["meta", "google", "all"];
    const validPriorities = ["high", "normal", "low"];
    const newInstruction: Instruction = {
      id: generateId(),
      clientId,
      platform: validPlatforms.includes(platform) ? platform : "meta",
      instruction: instruction.trim(),
      status: "pending",
      priority: validPriorities.includes(priority) ? priority : "normal",
      createdAt: new Date().toISOString(),
      executedAt: null,
      result: null,
    };
    const store = readInstructions();
    store.instructions.push(newInstruction);
    writeInstructions(store);
    res.status(201).json(newInstruction);
  });

  // Update instruction status
  app.patch("/api/clients/:clientId/instructions/:id", (req, res) => {
    const { clientId, id } = req.params as Record<string, string>;
    const { status, result } = req.body;
    const validStatuses = ["pending", "in_progress", "completed", "cancelled"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const store = readInstructions();
    const idx = store.instructions.findIndex((i) => i.id === id && i.clientId === clientId);
    if (idx === -1) {
      return res.status(404).json({ error: "Instruction not found" });
    }
    if (status) store.instructions[idx].status = status;
    if (result !== undefined) store.instructions[idx].result = result;
    if (status === "completed" || status === "cancelled") {
      store.instructions[idx].executedAt = new Date().toISOString();
    }
    writeInstructions(store);
    res.json(store.instructions[idx]);
  });

  // Delete instruction
  app.delete("/api/clients/:clientId/instructions/:id", (req, res) => {
    const { clientId, id } = req.params as Record<string, string>;
    const store = readInstructions();
    const idx = store.instructions.findIndex((i) => i.id === id && i.clientId === clientId);
    if (idx === -1) {
      return res.status(404).json({ error: "Instruction not found" });
    }
    store.instructions.splice(idx, 1);
    writeInstructions(store);
    res.json({ success: true });
  });

  // ─── Creative Hub Endpoints ────────────────────────────────────
  app.get("/api/clients/:clientId/creative-hub", (req, res) => {
    res.json(getCreativeHubState(req.params.clientId));
  });

  app.post("/api/clients/:clientId/creative-hub/setup", async (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const {
      projectName = "",
      logos = [],
      renders = [],
      price = "",
      reraNumber = "",
      buildingNumber = "",
      configuration = "",
      location = "",
      sqftRange = "",
      tone = "premium",
      customInstructions = "",
      winningCreatives = [],
    } = req.body || {};

    const next = await saveCreativeSetup(clientId, {
      projectName,
      logos,
      renders,
      price,
      reraNumber,
      buildingNumber,
      configuration,
      location,
      sqftRange,
      tone,
      customInstructions,
      winningCreatives,
    });

    res.json(next);
  });

  app.post("/api/clients/:clientId/creative-hub/generate", requireOwnership, async (req, res) => {
    try {
      const { clientId } = req.params as Record<string, string>;
      const hub = getCreativeHubState(clientId);
      if (!hub.setup) {
        return res.status(400).json({ error: "Creative SOP setup is required before generation." });
      }

      const input = {
        campaignIdea: String(req.body?.campaignIdea || "").trim(),
        offer: String(req.body?.offer || "").trim(),
        hook: String(req.body?.hook || "").trim(),
        platform: (req.body?.platform || "meta") as CreativePlatform,
        customInstruction: String(req.body?.customInstruction || "").trim(),
      };

      if (!input.campaignIdea || !input.offer || !input.hook) {
        return res.status(400).json({ error: "Campaign idea, offer, and hook are required." });
      }

      const platform = req.query.platform === "google" ? "google" : "meta";
      const analysis = await readAnalysisData(clientId, platform);
      const references = (((analysis as any)?.creative_health || []) as any[])
        .sort((a, b) => (b.creative_score || 0) - (a.creative_score || 0))
        .slice(0, 5)
        .map((item) => ({
          name: item.ad_name || item.name || "Creative",
          score: item.creative_score,
          ctr: item.ctr,
          cpl: item.cpl,
          classification: item.classification,
        }));

      const next = await generateCreativeThread({
        clientId,
        setup: hub.setup,
        input,
        references,
      });
      res.json(next);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to generate creative" });
    }
  });
  app.post("/api/clients/:clientId/creative-hub/regenerate", async (req, res) => {
    try {
      const { clientId } = req.params as Record<string, string>;
      const { threadId, sectionKey } = req.body;
      if (!threadId || !sectionKey) {
        return res.status(400).json({ error: "threadId and sectionKey are required." });
      }

      const hub = getCreativeHubState(clientId);
      const input = (hub.threads.find((t) => t.id === threadId))?.input;
      const platform = input?.platform === "google_display" ? "google" : "facebook";
      const analysis = await readAnalysisData(clientId as string, platform === "google" ? "google" : "meta");
      const references = (((analysis as any)?.creative_health || []) as any[])
        .sort((a, b) => (b.creative_score || 0) - (a.creative_score || 0))
        .slice(0, 5)
        .map((item) => ({
          name: item.ad_name || item.name || "Creative",
          score: item.creative_score,
          ctr: item.ctr,
          cpl: item.cpl,
          classification: item.classification,
        }));

      const next = await regenerateCreativeSectionForThread({
        clientId,
        threadId,
        sectionKey,
        references,
      });
      res.json(next);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to regenerate section" });
    }
  });

  app.post("/api/clients/:clientId/creative-hub/:threadId/generate-image", async (req, res) => {
    try {
      const { clientId, threadId } = req.params as Record<string, string>;
      const requestedSize = String(req.body?.requestedSize || "1080x1080") as any;
      const versionId = req.body?.versionId ? String(req.body.versionId) : undefined;

      const next = await generateCreativeImageForThread({
        clientId,
        threadId,
        versionId,
        requestedSize,
      });
      res.json(next);
    } catch (error: any) {
      const status = error?.message?.includes("unavailable") || error?.message?.includes("key") ? 400 : 500;
      res.status(status).json({ error: error?.message || "Failed to generate image" });
    }
  });

  app.post("/api/clients/:clientId/creative-hub/:threadId/tag", async (req, res) => {
    const { clientId, threadId } = req.params as Record<string, string>;
    const statusTag = req.body?.statusTag as CreativeStatusTag;
    if (!statusTag) {
      return res.status(400).json({ error: "statusTag is required." });
    }
    const next = await updateCreativeThreadTag({ clientId, threadId, statusTag });
    res.json(next);
  });

  app.post("/api/clients/:clientId/creative-hub/:threadId/duplicate", async (req, res) => {
    const { clientId, threadId } = req.params as Record<string, string>;
    const next = await duplicateCreativeThread({ clientId, threadId });
    res.json(next);
  });

  // Legacy /api/analysis endpoints removed — use /api/clients/:clientId/:platform/analysis

  // ─── Execution Engine Endpoints ─────────────────────────────────

  // Execute a single action (pause, unpause, scale budget, etc.)
  app.post("/api/execute", requireAdmin, async (req, res) => {
    try {
      const { action, entityId, entityName, entityType, params, requestedBy } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";

      // Validate required fields
      if (!action || !entityId || !entityType) {
        return res.status(400).json({ error: "Missing required fields: action, entityId, entityType" });
      }

      const validActions: ExecutionActionType[] = [
        "PAUSE_AD", "UNPAUSE_AD",
        "PAUSE_ADSET", "UNPAUSE_ADSET",
        "PAUSE_CAMPAIGN", "UNPAUSE_CAMPAIGN",
        "SCALE_BUDGET_UP", "SCALE_BUDGET_DOWN",
        "SET_BUDGET",
      ];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(", ")}` });
      }

      const validEntityTypes = ["campaign", "adset", "ad"];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ error: "entityType must be campaign, adset, or ad" });
      }

      const execReq: ExecutionRequest = {
        action,
        entityId,
        entityName: entityName || entityId,
        entityType,
        params: params || {},
        requestedBy: requestedBy || "user",
        requestedByName: actorName,
      };

      const result = await executeAction(execReq);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Execution failed" });
    }
  });

  // Execute a batch of actions
  app.post("/api/execute/batch", requireAdmin, async (req, res) => {
    try {
      const { actions } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";
      if (!Array.isArray(actions) || actions.length === 0) {
        return res.status(400).json({ error: "actions must be a non-empty array" });
      }
      if (actions.length > 20) {
        return res.status(400).json({ error: "Maximum 20 actions per batch" });
      }
      const results = await executeBatch(actions.map((action: any) => ({
        ...action,
        requestedBy: action.requestedBy || "user",
        requestedByName: actorName,
      })));
      res.json({ results, total: results.length, succeeded: results.filter(r => r.success).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Batch execution failed" });
    }
  });

  // Get entity status from Meta API (live)
  app.get("/api/entity/:entityId/status", async (req, res) => {
    try {
      const status = await getEntityStatus(req.params.entityId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get execution audit log
  app.get("/api/audit-log", requireAdmin, (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 50;
    const log = getAuditLog(limit);
    res.json(log);
  });

  // ─── Auto-Execute Endpoint ──────────────────────────────────────
  // Reads latest analysis, finds auto_action insights, executes them
  app.post("/api/auto-execute", requireAdmin, async (req, res) => {
    try {
      const { clientId, platform = "meta" } = req.body || {};
      if (!clientId) return res.status(400).json({ error: "clientId is required" });
      const data = await readAnalysisData(clientId, platform);

      const insights: any[] = data.intellect_insights || [];
      const autoInsights = insights.filter((i: any) => i.auto_action === true);

      if (autoInsights.length === 0) {
        return res.json({ results: [], total: 0, succeeded: 0, message: "No auto-executable insights found" });
      }

      // Build adset/campaign lookup for fuzzy matching entity names
      const adsets: any[] = data.adset_analysis || [];
      const campaigns: any[] = data.campaign_audit || [];

      const execRequests: ExecutionRequest[] = [];

      for (const insight of autoInsights) {
        if (insight.type === "AUTO_PAUSE_CPL" || insight.type === "AUTO_PAUSE_ZERO_LEADS") {
          // Try to match entity name to an adset or campaign
          const entityName = insight.entity || "";
          const matchedAdset = adsets.find((a: any) =>
            entityName.includes(a.adset_name?.substring(0, 30)) ||
            a.adset_name?.includes(entityName.substring(0, 30))
          );
          const matchedCampaign = campaigns.find((c: any) =>
            entityName.includes(c.campaign_name?.substring(0, 30)) ||
            c.campaign_name?.includes(entityName.substring(0, 30))
          );

          if (matchedAdset) {
            execRequests.push({
              action: "PAUSE_ADSET",
              entityId: matchedAdset.adset_id,
              entityName: matchedAdset.adset_name,
              entityType: "adset",
              params: {
                reason: insight.detail,
                playbookRef: insight.type,
              },
              requestedBy: "auto",
            });
          } else if (matchedCampaign) {
            execRequests.push({
              action: "PAUSE_CAMPAIGN",
              entityId: matchedCampaign.campaign_id,
              entityName: matchedCampaign.campaign_name,
              entityType: "campaign",
              params: {
                reason: insight.detail,
                playbookRef: insight.type,
              },
              requestedBy: "auto",
            });
          }
        }
      }

      if (execRequests.length === 0) {
        return res.json({ results: [], total: 0, succeeded: 0, message: "No matching entities found for auto-execute" });
      }

      const results = await executeBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Auto-execute failed" });
    }
  });

  // ─── Quick Action Endpoint ──────────────────────────────────────
  // Execute batch actions: SCALE_WINNERS, PAUSE_UNDERPERFORMERS, FIX_LEARNING_LIMITED
  app.post("/api/clients/:clientId/:platform/quick-action", requireOwnership, async (req, res) => {
    try {
      const { clientId, platform } = req.params as Record<string, string>;
      const { actionType, scalePercent = 20 } = req.body as { actionType: QuickActionType; scalePercent?: number };

      if (!actionType || !["SCALE_WINNERS", "PAUSE_UNDERPERFORMERS", "FIX_LEARNING_LIMITED"].includes(actionType)) {
        return res.status(400).json({
          error: "actionType must be SCALE_WINNERS, PAUSE_UNDERPERFORMERS, or FIX_LEARNING_LIMITED",
        });
      }

      const data = await readAnalysisData(clientId, platform);
      const adsets: any[] = data.adset_analysis || [];
      const execRequests: ExecutionRequest[] = [];

      switch (actionType) {
        case "SCALE_WINNERS": {
          const winners = adsets.filter((a: any) => a.classification === "WINNER");
          for (const w of winners) {
            if (w.adset_id && w.daily_budget > 0) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: w.adset_id,
                entityName: w.adset_name || w.adset_id,
                entityType: "adset",
                params: {
                  scalePercent,
                  reason: `Quick Action: Scale winner +${scalePercent}% (score ${w.health_score}, CPL ₹${w.cpl?.toFixed(0) || "N/A"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "PAUSE_UNDERPERFORMERS": {
          const underperformers = adsets.filter(
            (a: any) => a.should_pause === true || a.classification === "UNDERPERFORMER"
          );
          for (const u of underperformers) {
            if (u.adset_id) {
              execRequests.push({
                action: "PAUSE_ADSET",
                entityId: u.adset_id,
                entityName: u.adset_name || u.adset_id,
                entityType: "adset",
                params: {
                  reason: `Quick Action: Pause underperformer (score ${u.health_score}, ${u.auto_pause_reasons?.join("; ") || "classification: UNDERPERFORMER"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "FIX_LEARNING_LIMITED": {
          const learningLimited = adsets.filter((a: any) => a.learning_status === "LEARNING_LIMITED");
          for (const ll of learningLimited) {
            if (ll.adset_id && ll.daily_budget > 0) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: ll.adset_id,
                entityName: ll.adset_name || ll.adset_id,
                entityType: "adset",
                params: {
                  scalePercent: 30,
                  reason: `Quick Action: Fix Learning Limited - scale budget +30% (current budget ₹${ll.daily_budget?.toFixed(0) || "N/A"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: `No matching adsets found for ${actionType}`,
        });
      }

      const results = await executeBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Quick action failed" });
    }
  });

  app.post("/api/clients/:clientId/:platform/auto-execute-now", requireOwnership, async (req, res) => {
    try {
      const { clientId, platform } = req.params as Record<string, string>;
      const data = await readAnalysisData(clientId, platform);

      const execRequests: ExecutionRequest[] = [];

      // 1. Ads from scoring_summary.ad_scores.auto_pause
      const autoPauseAds: any[] = (data as any).scoring_summary?.ad_scores?.auto_pause || [];
      for (const ad of autoPauseAds) {
        if (ad.ad_id) {
          execRequests.push({
            action: "PAUSE_AD",
            entityId: ad.ad_id,
            entityName: ad.ad_name || ad.ad_id,
            entityType: "ad",
            params: {
              reason: `Auto-pause: ${(ad.auto_pause_reasons || []).join("; ") || "scored for auto-pause"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      // 2. Ads from creative_health with should_pause === true
      const creativeHealth: any[] = (data as any).creative_health || [];
      for (const ad of creativeHealth) {
        if (ad.should_pause && ad.ad_id) {
          // Avoid duplicates from scoring_summary
          if (!execRequests.some((r) => r.entityId === ad.ad_id)) {
            execRequests.push({
              action: "PAUSE_AD",
              entityId: ad.ad_id,
              entityName: ad.ad_name || ad.ad_id,
              entityType: "ad",
              params: {
                reason: `Auto-pause: ${(ad.auto_pause_reasons || []).join("; ") || "should_pause flagged in creative_health"}`,
              },
              requestedBy: "auto",
            });
          }
        }
      }

      // 3. Adsets from adset_analysis with should_pause === true
      const adsetAnalysis: any[] = (data as any).adset_analysis || [];
      for (const adset of adsetAnalysis) {
        if (adset.should_pause && adset.adset_id) {
          execRequests.push({
            action: "PAUSE_ADSET",
            entityId: adset.adset_id,
            entityName: adset.adset_name || adset.adset_id,
            entityType: "adset",
            params: {
              reason: `Auto-pause: ${(adset.auto_pause_reasons || []).join("; ") || "should_pause flagged in adset_analysis"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: "No entities matching auto-pause criteria found",
        });
      }

      const results = await executeBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Auto-execute failed" });
    }
  });

  // ─── Execute Single Action (client/platform scoped) ──────────────
  // Accepts optional strategicCall in body for the learning engine
  // Supports MARK_COMPLETE, REJECT, DEFER (log-only, no API call)
  app.post("/api/clients/:clientId/:platform/execute-action", requireOwnership, async (req, res) => {
    try {
      const { clientId, platform } = req.params as Record<string, string>;
      const { action, entityId, entityName, entityType, params, strategicCall } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";

      if (!action || !entityId || !entityType) {
        return res.status(400).json({ error: "Missing required fields: action, entityId, entityType" });
      }

      // Log-only action types (no API call needed)
      const logOnlyActions = ["MARK_COMPLETE", "REJECT", "DEFER"];
      if (logOnlyActions.includes(action)) {
        const logResult = {
          success: true,
          action,
          entityId,
          entityName: entityName || entityId,
          entityType,
          previousValue: action,
          newValue: action === "MARK_COMPLETE" ? "completed" : action === "REJECT" ? "rejected" : "deferred",
          timestamp: new Date().toISOString(),
          requestedBy: "user",
          requestedByName: actorName,
          reason: params?.reason || strategicCall || "",
          strategicCall,
        };

        if (req.params.platform === "google") {
          appendGoogleAuditEntry({
            ...logResult,
            platform: "google",
          });
        } else {
          appendAuditEntry(logResult);
        }

        // Record to learning engine
        try {
          const analysisData = await readAnalysisData(clientId, platform);
          recordExecution(
            Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            clientId,
            platform === "google" ? "google" : "meta",
            entityId,
            entityName || entityId,
            entityType,
            action,
            params?.reason || strategicCall || `${action} by user`,
            analysisData,
            strategicCall,
            actorName
          );
        } catch (_) { /* best-effort */ }

        return res.json(logResult);
      }

      const validActions: ExecutionActionType[] = [
        "PAUSE_AD", "UNPAUSE_AD",
        "PAUSE_ADSET", "UNPAUSE_ADSET",
        "PAUSE_CAMPAIGN", "UNPAUSE_CAMPAIGN",
        "SCALE_BUDGET_UP", "SCALE_BUDGET_DOWN",
        "SET_BUDGET",
      ];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          error: `Invalid action. Must be one of: ${[...validActions, ...logOnlyActions].join(", ")}`,
        });
      }

      const validEntityTypes = ["campaign", "adset", "ad"];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ error: "entityType must be campaign, adset, or ad" });
      }

      const execReq: ExecutionRequest = {
        action,
        entityId,
        entityName: entityName || entityId,
        entityType,
        params: params || {},
        requestedBy: "user",
        requestedByName: actorName,
        strategicCall,
      };

      const result = await executeAction(execReq);

      // Record execution for learning engine (best-effort)
      if (result.success) {
        try {
          const analysisData = await readAnalysisData(clientId, platform);
          recordExecution(
            Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            clientId,
            platform === "google" ? "google" : "meta",
            entityId,
            entityName || entityId,
            entityType,
            action,
            params?.reason,
            analysisData,
            strategicCall,
            actorName
          );
        } catch (_) {
          // don't fail the response if learning recording fails
        }
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Execution failed" });
    }
  });

  // ─── Benchmarks Endpoints ──────────────────────────────────────────

  function getBenchmarksPath(clientId: string, platform: string): string {
    return path.join(BENCHMARKS_BASE, clientId, `benchmarks_${platform}.json`);
  }

  app.get("/api/clients/:clientId/benchmarks", requireOwnership, async (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const platform = (req.query.platform as string) || "meta";
    const benchPath = getBenchmarksPath(clientId, platform);
    if (!fs.existsSync(benchPath)) {
      // Fallback: check if the legacy generic benchmarks.json exists
      const legacyPath = path.join(BENCHMARKS_BASE, clientId, "benchmarks.json");
      if (fs.existsSync(legacyPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
          return res.json(data);
        } catch { }
      }
      return res.json({ ...(await getDefaultBenchmarks(clientId, platform)), updated_at: null });
    }
    try {
      const data = JSON.parse(fs.readFileSync(benchPath, "utf-8"));
      res.json(data);
    } catch {
      res.json({ ...(await getDefaultBenchmarks(clientId, platform)), updated_at: null });
    }
  });

  app.put("/api/clients/:clientId/benchmarks", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const platform = (req.query.platform as string) || "meta";
    const benchPath = getBenchmarksPath(clientId, platform);
    const dir = path.dirname(benchPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      ...req.body,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(benchPath, JSON.stringify(data, null, 2));
    // Invalidate analysis cache so health scores recalculate with new benchmarks
    invalidateAnalysisCache(clientId, platform);
    res.json(data);
  });

  // ─── Breakdowns Endpoint ───────────────────────────────────────────

  app.get("/api/clients/:clientId/:platform/breakdowns", requireOwnership, async (req, res) => {
    const { clientId, platform } = req.params as Record<string, string>;
    const cadence = req.query.cadence as string | undefined;
    const currentRegistry = await loadRegistry();
    const client = currentRegistry.find((c) => c.id === clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    try {
      const data = await readAnalysisData(clientId, platform, cadence);

      // Check for any breakdown data in the analysis
      const hasBreakdowns = data.breakdowns || data.demographic_breakdowns || data.breakdown_age ||
        data.breakdown_gender || data.breakdown_placement || data.breakdown_device || data.breakdown_region;

      if (hasBreakdowns) {
        return res.json({
          available: true,
          breakdowns: data.breakdowns || data.demographic_breakdowns || {
            age: data.breakdown_age || [],
            gender: data.breakdown_gender || [],
            placement: data.breakdown_placement || [],
            device: data.breakdown_device || [],
            region: data.breakdown_region || [],
          },
          campaign_breakdowns: data.campaign_breakdowns || {},
          geo_alerts: data.geo_alerts || [],
          target_locations: data.target_locations || client.targetLocations || [],
        });
      }

      res.json({
        available: false,
        message: "Breakdown data will be available after the next agent run with demographic fetching enabled.",
        target_locations: client.targetLocations || [],
      });
    } catch {
      res.json({
        available: false,
        message: "Breakdown data will be available after the next agent run with demographic fetching enabled.",
        target_locations: client.targetLocations || [],
      });
    }
  });

  // ─── Campaign-Specific Breakdowns Endpoint ───────────────────────

  app.get("/api/clients/:clientId/:platform/breakdowns/:campaignId", requireOwnership, async (req, res) => {
    const { clientId, platform, campaignId } = req.params as Record<string, string>;
    const cadence = req.query.cadence as string | undefined;
    const currentRegistry = await loadRegistry();
    const client = currentRegistry.find((c) => c.id === clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    try {
      const data = await readAnalysisData(clientId, platform, cadence);

      // Attempt to get campaign-specific data first
      let cbd = data.campaign_breakdowns?.[campaignId];

      // For Google, if campaign-specific data isn't found, fallback to global demographic_breakdowns
      // which the frontend is now capable of filtering by campaign_id.
      if (!cbd && (platform === "google" || platform === "google_ads")) {
        cbd = data.demographic_breakdowns || data.breakdowns;
      }

      if (!cbd) {
        return res.json({ available: false, message: "No breakdown data for this campaign." });
      }

      return res.json({
        available: true,
        breakdowns: cbd,
        target_locations: data.target_locations || client.targetLocations || [],
      });
    } catch {
      res.json({ available: false, message: "Campaign breakdown data not available." });
    }
  });

  // ─── Google Ads Execution Endpoints ─────────────────────────────

  // Execute a single Google Ads action (accepts strategicCall for learning)
  app.post("/api/clients/:clientId/google/execute-action", requireOwnership, async (req, res) => {
    try {
      const { clientId } = req.params as Record<string, string>;
      const { action, entityId, entityName, entityType, params, strategicCall } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";

      if (!action || !entityId || !entityType) {
        return res.status(400).json({ error: "Missing required fields: action, entityId, entityType" });
      }

      const validActions: GoogleExecutionActionType[] = [
        "PAUSE_CAMPAIGN", "ENABLE_CAMPAIGN",
        "PAUSE_AD_GROUP", "ENABLE_AD_GROUP",
        "PAUSE_AD", "ENABLE_AD",
        "SET_CAMPAIGN_BUDGET",
        "SCALE_BUDGET_UP", "SCALE_BUDGET_DOWN",
        "SET_CPC_BID",
      ];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          error: `Invalid action. Must be one of: ${validActions.join(", ")}`,
        });
      }

      const execReq: GoogleExecutionRequest = {
        action,
        entityId,
        entityName: entityName || entityId,
        entityType,
        params: params || {},
        requestedBy: "user",
        requestedByName: actorName,
        strategicCall,
      };

      const result = await executeGoogleAction(execReq);

      // Record execution for learning engine (best-effort)
      if (result.success) {
        try {
          const analysisData = await readAnalysisData(clientId, "google");
          recordExecution(
            Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            clientId,
            "google",
            entityId,
            entityName || entityId,
            entityType,
            action,
            params?.reason,
            analysisData,
            strategicCall,
            actorName
          );
        } catch (_) { /* best-effort */ }
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Execution failed" });
    }
  });

  // Batch execute Google Ads actions
  app.post("/api/clients/:clientId/google/execute-batch", requireOwnership, async (req, res) => {
    try {
      const { actions } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";
      if (!Array.isArray(actions) || actions.length === 0) {
        return res.status(400).json({ error: "actions must be a non-empty array" });
      }
      if (actions.length > 20) {
        return res.status(400).json({ error: "Maximum 20 actions per batch" });
      }
      const results = await executeGoogleBatch(actions.map((action: any) => ({
        ...action,
        requestedBy: action.requestedBy || "user",
        requestedByName: actorName,
      })));
      res.json({ results, total: results.length, succeeded: results.filter(r => r.success).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Batch execution failed" });
    }
  });

  // Google Ads audit log
  app.get("/api/google-audit-log", requireAdmin, (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 50;
    const log = getGoogleAuditLog(limit);
    res.json(log);
  });

  // Google auto-execute: pause underperformers from analysis
  app.post("/api/clients/:clientId/google/auto-execute-now", requireOwnership, async (req, res) => {
    try {
      const { clientId } = req.params as Record<string, string>;
      const data = await readAnalysisData(clientId, "google");

      const execRequests: GoogleExecutionRequest[] = [];

      // 1. Campaigns with should_pause
      const campaigns: any[] = data.campaign_analysis || data.campaign_audit || [];
      for (const camp of campaigns) {
        if (camp.should_pause && (camp.campaign_id || camp.id)) {
          execRequests.push({
            action: "PAUSE_CAMPAIGN",
            entityId: camp.campaign_id || camp.id,
            entityName: camp.campaign_name || camp.name || camp.campaign_id,
            entityType: "campaign",
            params: {
              reason: `Auto-pause: ${(camp.auto_pause_reasons || []).join("; ") || "flagged for auto-pause"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      // 2. Ad groups with should_pause
      const adGroups: any[] = data.ad_group_analysis || [];
      for (const ag of adGroups) {
        if (ag.should_pause && (ag.ad_group_id || ag.id)) {
          execRequests.push({
            action: "PAUSE_AD_GROUP",
            entityId: ag.ad_group_id || ag.id,
            entityName: ag.ad_group_name || ag.name || ag.ad_group_id,
            entityType: "ad_group",
            params: {
              reason: `Auto-pause: ${(ag.auto_pause_reasons || []).join("; ") || "flagged for auto-pause"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      // 3. Ads with should_pause
      const ads: any[] = data.ad_analysis || data.creative_health || [];
      for (const ad of ads) {
        if (ad.should_pause && (ad.ad_id || ad.id)) {
          if (!execRequests.some((r) => r.entityId === (ad.ad_id || ad.id))) {
            execRequests.push({
              action: "PAUSE_AD",
              entityId: ad.ad_id || ad.id,
              entityName: ad.ad_name || ad.name || ad.ad_id,
              entityType: "ad",
              params: {
                reason: `Auto-pause: ${(ad.auto_pause_reasons || []).join("; ") || "flagged for auto-pause"}`,
              },
              requestedBy: "auto",
            });
          }
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: "No entities matching auto-pause criteria found",
        });
      }

      const results = await executeGoogleBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Auto-execute failed" });
    }
  });

  // Google Quick Actions
  app.post("/api/clients/:clientId/google/quick-action", async (req, res) => {
    try {
      const { clientId } = req.params as Record<string, string>;
      const { actionType, scalePercent = 20 } = req.body;

      if (!actionType || !["SCALE_WINNERS", "PAUSE_UNDERPERFORMERS", "FIX_LEARNING_LIMITED"].includes(actionType)) {
        return res.status(400).json({
          error: "actionType must be SCALE_WINNERS, PAUSE_UNDERPERFORMERS, or FIX_LEARNING_LIMITED",
        });
      }

      const data = await readAnalysisData(clientId, "google");
      const campaigns: any[] = data.campaign_analysis || data.campaign_audit || [];
      const execRequests: GoogleExecutionRequest[] = [];

      switch (actionType) {
        case "SCALE_WINNERS": {
          const winners = campaigns.filter((c: any) => c.classification === "WINNER");
          for (const w of winners) {
            if (w.campaign_id || w.id) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: w.campaign_id || w.id,
                entityName: w.campaign_name || w.name || w.campaign_id,
                entityType: "campaign",
                params: {
                  scalePercent,
                  reason: `Quick Action: Scale winner +${scalePercent}% (score ${w.health_score}, CPL ₹${w.cpl?.toFixed(0) || "N/A"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "PAUSE_UNDERPERFORMERS": {
          const underperformers = campaigns.filter(
            (c: any) => c.should_pause === true || c.classification === "UNDERPERFORMER"
          );
          for (const u of underperformers) {
            if (u.campaign_id || u.id) {
              execRequests.push({
                action: "PAUSE_CAMPAIGN",
                entityId: u.campaign_id || u.id,
                entityName: u.campaign_name || u.name || u.campaign_id,
                entityType: "campaign",
                params: {
                  reason: `Quick Action: Pause underperformer (score ${u.health_score}, ${u.auto_pause_reasons?.join("; ") || "UNDERPERFORMER"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "FIX_LEARNING_LIMITED": {
          const limited = campaigns.filter((c: any) =>
            c.learning_status === "LEARNING_LIMITED" || c.bidding_status === "LEARNING"
          );
          for (const ll of limited) {
            if (ll.campaign_id || ll.id) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: ll.campaign_id || ll.id,
                entityName: ll.campaign_name || ll.name || ll.campaign_id,
                entityType: "campaign",
                params: {
                  scalePercent: 30,
                  reason: `Quick Action: Fix Learning Limited - scale budget +30%`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: `No matching campaigns found for ${actionType}`,
        });
      }

      const results = await executeGoogleBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Quick action failed" });
    }
  });

  // ─── Google Negative Keyword Routes ─────────────────────────────
  const NEGATIVES_SCRIPT = path.resolve(import.meta.dirname, "../../ads_agent/google_ads_negatives.py");

  // Add a single negative keyword to a campaign
  app.post("/api/clients/:clientId/google/add-negative-keyword", async (req, res) => {
    try {
      const { campaignId, keyword, matchType } = req.body;

      if (!campaignId || !keyword) {
        return res.status(400).json({ error: "Missing required fields: campaignId, keyword" });
      }

      const validMatchTypes = ["EXACT", "PHRASE", "BROAD"];
      const normalizedMatchType = validMatchTypes.includes(matchType) ? matchType : "BROAD";

      const { stdout, stderr } = await execFileAsync("python3", [
        NEGATIVES_SCRIPT,
        "add",
        "--campaign-id", String(campaignId),
        "--keyword", String(keyword),
        "--match-type", normalizedMatchType,
      ], { timeout: 30000 });

      const result = JSON.parse(stdout);
      res.json(result);
    } catch (err: any) {
      // Try to parse Python JSON error output from stderr/stdout
      let message = "Failed to add negative keyword";
      try {
        const parsed = JSON.parse(err.stdout || "");
        message = parsed.error || message;
      } catch {
        message = err.stderr || err.message || message;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  // List negative keywords for a campaign
  app.get("/api/clients/:clientId/google/negative-keywords", requireOwnership, async (req, res) => {
    try {
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "Missing required query param: campaignId" });
      }

      const { stdout } = await execFileAsync("python3", [
        NEGATIVES_SCRIPT,
        "list",
        "--campaign-id", String(campaignId),
      ], { timeout: 30000 });

      const result = JSON.parse(stdout);
      res.json(result);
    } catch (err: any) {
      let message = "Failed to list negative keywords";
      try {
        const parsed = JSON.parse(err.stdout || "");
        message = parsed.error || message;
      } catch {
        message = err.stderr || err.message || message;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  // Bulk add negative keywords to a campaign
  app.post("/api/clients/:clientId/google/negative-keywords/bulk", requireOwnership, async (req, res) => {
    try {
      const { campaignId, keywords } = req.body;

      if (!campaignId || !keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ error: "Missing required fields: campaignId, keywords (array)" });
      }

      const validMatchTypes = ["EXACT", "PHRASE", "BROAD"];
      const sanitized = keywords.map((kw: { keyword: string; matchType?: string }) => ({
        keyword: String(kw.keyword || "").trim(),
        matchType: validMatchTypes.includes(kw.matchType || "") ? kw.matchType : "BROAD",
      })).filter((kw: { keyword: string }) => kw.keyword.length > 0);

      if (sanitized.length === 0) {
        return res.status(400).json({ error: "No valid keywords provided" });
      }

      const keywordsJson = JSON.stringify(sanitized);

      const { stdout } = await execFileAsync("python3", [
        NEGATIVES_SCRIPT,
        "add-bulk",
        "--campaign-id", String(campaignId),
        "--keywords-json", keywordsJson,
      ], { timeout: 60000 });

      const result = JSON.parse(stdout);
      res.json(result);
    } catch (err: any) {
      let message = "Failed to bulk add negative keywords";
      try {
        const parsed = JSON.parse(err.stdout || "");
        message = parsed.error || message;
      } catch {
        message = err.stderr || err.message || message;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  // ─── MTD Deliverables Endpoints ──────────────────────────────────

  function getMtdDeliverablesPath(clientId: string, platform: string = "meta"): string {
    return path.join(DATA_BASE, "clients", clientId, `mtd_deliverables_${platform}.json`);
  }

  function getLegacyMtdDeliverablesPath(clientId: string): string {
    return path.join(DATA_BASE, "clients", clientId, "mtd_deliverables.json");
  }

  function getMtdHistoryPath(clientId: string, platform: string = "meta"): string {
    return path.join(DATA_BASE, "clients", clientId, `mtd_history_${platform}.json`);
  }

  function getLegacyMtdHistoryPath(clientId: string): string {
    return path.join(DATA_BASE, "clients", clientId, "mtd_history.json");
  }

  // ─── Consolidated MTD Deliverables (Source of Truth) ────────────
  app.get("/api/mtd-deliverables", requireAdmin, async (req, res) => {
    const { client_id: clientId, platform: requestedPlatform } = req.query as Record<string, string>;
    if (!clientId) return res.status(400).json({ error: "client_id is required" });

    const currentRegistry = await loadRegistry();
    const client = currentRegistry.find(c => c.id === clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });

    let totalSpend = 0;
    let totalLeads = 0;
    let totalImpressions = 0;
    let dataComplete = true;
    let manualInputMissing = false;
    let trackingIssueFlag = false;
    let lastAnalysisUpdate = "";

    const requestedPlatformId = typeof requestedPlatform === "string" ? requestedPlatform : null;
    const platformsObj = (client.platforms || {}) as Record<string, any>;
    const platformEntries = Object.entries(platformsObj).filter(([platformId, platform]: [string, any]) => {
      if (!platform.enabled) return false;
      return requestedPlatformId ? platformId === requestedPlatformId : true;
    });

    // 1. Accumulate API Data from Platforms
    for (const [platformId] of platformEntries) {
      try {
        const data = await readAnalysisData(clientId as string, platformId);
        if (data) {
          // Meta uses 'monthly_pacing' -> 'mtd', Google uses 'mtd_pacing'
          const mtd = data.monthly_pacing?.mtd || data.mtd_pacing || {};
          totalSpend += mtd.spend ?? mtd.spend_mtd ?? 0;
          totalLeads += mtd.leads ?? mtd.leads_mtd ?? 0;
          totalImpressions += (mtd.impressions ?? mtd.impressions_mtd ?? (data.account_pulse?.total_impressions_mtd || data.account_pulse?.total_impressions || 0));

          if (!lastAnalysisUpdate || (data.generated_at && data.generated_at > lastAnalysisUpdate)) {
            lastAnalysisUpdate = data.generated_at;
          }
        } else {
          dataComplete = false;
        }
      } catch (e) {
        console.error(`[mtd-deliverables] Failed for ${clientId}/${platformId}:`, e);
        dataComplete = false;
      }
    }

    // 2. Fetch Manual Deliverables
    const mtdFilePath = getMtdDeliverablesPath(clientId as string, requestedPlatformId || "meta");
    let manual: any = { svs_achieved: 0, positive_leads_achieved: 0, quality_lead_count: 0, updated_at: null };
    if (fs.existsSync(mtdFilePath)) {
      try {
        manual = JSON.parse(fs.readFileSync(mtdFilePath, "utf-8"));
      } catch (e) { }
    } else if (requestedPlatformId === "meta") {
      const legacyPath = getLegacyMtdDeliverablesPath(clientId as string);
      if (fs.existsSync(legacyPath)) {
        try {
          manual = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
        } catch (e) { }
      } else {
        manualInputMissing = true;
      }
    } else {
      manualInputMissing = true;
    }

    if (!manual.updated_at) {
      manualInputMissing = true;
    }

    // 3. Calculation Logic (Backend Only)
    const svs = manual.svs_achieved || 0;
    const qLeads = manual.positive_leads_achieved || 0; // The UI uses positive_leads_achieved for "Qualified Leads"
    // Handle specific field for QL if quality_lead_count is provided as fallback/secondary
    const qCount = manual.quality_lead_count || qLeads;

    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const cpql = qCount > 0 ? totalSpend / qCount : 0;
    const cpsv = svs > 0 ? totalSpend / svs : 0;
    const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const posPct = totalLeads > 0 ? (qLeads / totalLeads) * 100 : 0;
    const svPct = totalLeads > 0 ? (svs / totalLeads) * 100 : 0;

    // 4. Integrity Checks
    if (totalSpend > 500 && totalLeads === 0) trackingIssueFlag = true;
    if (totalLeads > 10 && qLeads === 0 && svs === 0) trackingIssueFlag = true;

    const now = new Date();
    const result = {
      client_id: clientId,
      platform: requestedPlatformId || "all",
      month: now.toISOString().slice(0, 7), // YYYY-MM
      mtd: {
        spend: totalSpend,
        leads: totalLeads,
        impressions: totalImpressions,
        qualified_leads: qCount,
        svs: svs,
        closures: manual.closures_achieved || 0,
        cpl: Math.round(cpl),
        cpql: Math.round(cpql),
        cpsv: Math.round(cpsv),
        cpm: Math.round(cpm),
        positive_pct: Number(posPct.toFixed(1)),
        sv_pct: Number(svPct.toFixed(1))
      },
      status: {
        data_complete: dataComplete,
        manual_input_missing: manualInputMissing,
        tracking_issue_flag: trackingIssueFlag
      },
      last_updated: manual.updated_at || lastAnalysisUpdate || now.toISOString()
    };

    res.json(result);
  });

  // ─── Monthly Pacing Pivot — all calculations backend-computed ─────
  app.get("/api/clients/:clientId/pacing", requireOwnership, async (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const platform = (req.query.platform as string) || "meta";

    // Helper: safe divide
    const div = (a: number, b: number) => (b > 0 ? a / b : 0);

    // Date math
    const now = new Date();
    const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const daysRemaining = totalDays - daysElapsed;

    // MTD Target formula: (Monthly Target / Total Days) × Days Elapsed
    const calcMtdTarget = (monthly: number) => totalDays > 0 ? (monthly / totalDays) * daysElapsed : 0;
    // Projected formula: (MTD Delivered / Days Elapsed) × Total Days
    const calcProjected = (delivered: number) => daysElapsed > 0 ? (delivered / daysElapsed) * totalDays : 0;
    // Daily Needed formula: max(0, Monthly Target − MTD Delivered) / Remaining Days
    const calcDailyNeeded = (monthly: number, delivered: number) => daysRemaining > 0 ? Math.max(0, monthly - delivered) / daysRemaining : 0;
    // Ratio projections are computed from projected numerator / denominator.
    const calcProjectedRatio = (projectedNumerator: number, projectedDenominator: number) => projectedDenominator > 0 ? projectedNumerator / projectedDenominator : 0;

    // Status for volume metrics (higher = better)
    const volumeStatus = (delivered: number, mtdTgt: number) => {
      if (mtdTgt <= 0) return "—";
      const r = div(delivered, mtdTgt);
      if (r >= 1.0) return "ON TRACK";
      if (r >= 0.8) return "SLIGHTLY BEHIND";
      return "OFF TRACK";
    };
    // Status for cost metrics (lower = better)
    const costStatus = (delivered: number, target: number) => {
      if (target <= 0 || delivered <= 0) return "—";
      const r = div(delivered, target);
      if (r <= 1.0) return "ON TARGET";
      if (r <= 1.15) return "SLIGHTLY HIGH";
      return "OFF TARGET";
    };
    // Status for budget (within ±10% of MTD target = on track)
    const budgetStatus = (delivered: number, mtdTgt: number) => {
      if (mtdTgt <= 0) return "—";
      const r = div(delivered, mtdTgt);
      if (r >= 0.9 && r <= 1.1) return "ON TRACK";
      if (r > 1.1) return "OVERSPENT";
      if (r >= 0.8) return "SLIGHTLY UNDER";
      return "UNDERSPENT";
    };

    // Fetch analysis data (for monthly_pacing targets + API-derived MTD)
    let mp: any = null;
    try {
      const analysis = await readAnalysisData(clientId, platform);
      mp = analysis?.monthly_pacing || null;
    } catch (_) { }

    // Fetch benchmarks for user-configured targets
    let bm: Record<string, any> = {};
    try {
      const bmPath = path.join(DATA_BASE, "clients", clientId, "benchmarks.json");
      if (fs.existsSync(bmPath)) bm = JSON.parse(fs.readFileSync(bmPath, "utf-8"));
    } catch (_) { }

    // Fetch MTD deliverables (manual inputs: svs, qualified_leads, closures)
    let manual: any = { svs_achieved: 0, positive_leads_achieved: 0, closures_achieved: 0, quality_lead_count: 0 };
    try {
      const mtdPath = getMtdDeliverablesPath(clientId, platform);
      if (fs.existsSync(mtdPath)) manual = JSON.parse(fs.readFileSync(mtdPath, "utf-8"));
      else if (platform === "meta") {
        const legacyPath = getLegacyMtdDeliverablesPath(clientId);
        if (fs.existsSync(legacyPath)) manual = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
      }
    } catch (_) { }

    // ─── Authoritative delivered values ─────────────────────────────
    const mtdSpend = mp?.mtd?.spend ?? 0;
    const mtdLeads = mp?.mtd?.leads ?? 0;
    const mtdSvs = manual.svs_achieved || 0;
    const mtdQLeads = manual.positive_leads_achieved || manual.quality_lead_count || 0;
    const mtdClosures = manual.closures_achieved || 0;
    const mtdCpl = mtdLeads > 0 ? Math.round(div(mtdSpend, mtdLeads)) : 0;
    const mtdCpql = mtdQLeads > 0 ? Math.round(div(mtdSpend, mtdQLeads)) : 0;
    const mtdCpsv = mtdSvs > 0 ? Math.round(div(mtdSpend, mtdSvs)) : 0;
    const projectedSpend = calcProjected(mtdSpend);
    const projectedLeads = calcProjected(mtdLeads);
    const projectedQLeads = calcProjected(mtdQLeads);
    const projectedSvs = calcProjected(mtdSvs);

    // ─── Monthly targets ─────────────────────────────────────────────
    const budgetTarget = bm.budget ?? mp?.targets?.budget ?? 0;
    const leadsTarget = bm.leads ?? mp?.targets?.leads ?? 0;
    const cplTarget = bm.cpl ?? mp?.targets?.cpl ?? 0;
    const cpqlTarget = bm.cpql_target ?? 0;
    const svsTargetLow = bm.svs_low ?? mp?.targets?.svs?.low ?? 0;
    const svsTargetHigh = bm.svs_high ?? mp?.targets?.svs?.high ?? 0;
    const cpsvTargetLow = bm.cpsv_low ?? mp?.targets?.cpsv?.low ?? 0;
    const cpsvTargetHigh = bm.cpsv_high ?? mp?.targets?.cpsv?.high ?? 0;
    const qLeadsTarget = bm.positive_lead_target ?? 0;

    const rows = [
      {
        metric: "Spend",
        monthly_target: budgetTarget,
        mtd_target: Math.round(calcMtdTarget(budgetTarget)),
        mtd_delivered: Math.round(mtdSpend),
        projected: Math.round(calcProjected(mtdSpend)),
        daily_needed: Math.round(calcDailyNeeded(budgetTarget, mtdSpend)),
        status: budgetStatus(mtdSpend, calcMtdTarget(budgetTarget)),
        format: "inr",
      },
      {
        metric: "Leads",
        monthly_target: leadsTarget,
        mtd_target: Math.round(calcMtdTarget(leadsTarget)),
        mtd_delivered: Math.round(mtdLeads),
        projected: Math.round(calcProjected(mtdLeads)),
        daily_needed: Number(calcDailyNeeded(leadsTarget, mtdLeads).toFixed(1)),
        status: volumeStatus(mtdLeads, calcMtdTarget(leadsTarget)),
        format: "number",
      },
      {
        metric: "CPL",
        monthly_target: cplTarget,
        mtd_target: cplTarget,
        mtd_delivered: mtdCpl,
        projected: Math.round(calcProjectedRatio(projectedSpend, projectedLeads)),
        daily_needed: null,
        status: costStatus(mtdCpl, cplTarget),
        format: "inr",
      },
      {
        metric: "Qualified Leads",
        monthly_target: qLeadsTarget,
        mtd_target: Math.round(calcMtdTarget(qLeadsTarget)),
        mtd_delivered: mtdQLeads,
        projected: Math.round(calcProjected(mtdQLeads)),
        daily_needed: Number(calcDailyNeeded(qLeadsTarget, mtdQLeads).toFixed(1)),
        status: volumeStatus(mtdQLeads, calcMtdTarget(qLeadsTarget)),
        format: "number",
      },
      {
        metric: "CPQL",
        monthly_target: cpqlTarget,
        mtd_target: cpqlTarget,
        mtd_delivered: mtdCpql,
        projected: Math.round(calcProjectedRatio(projectedSpend, projectedQLeads)),
        daily_needed: null,
        status: costStatus(mtdCpql, cpqlTarget),
        format: "inr",
      },
      {
        metric: "SVs",
        monthly_target: `${svsTargetLow}–${svsTargetHigh}`,
        mtd_target: Math.round(calcMtdTarget(svsTargetLow)),
        mtd_delivered: mtdSvs,
        projected: Math.round(calcProjected(mtdSvs)),
        daily_needed: Number(calcDailyNeeded(svsTargetLow, mtdSvs).toFixed(1)),
        status: volumeStatus(mtdSvs, calcMtdTarget(svsTargetLow)),
        format: "number",
      },
      {
        metric: "CPSV",
        monthly_target: `${cpsvTargetLow}–${cpsvTargetHigh}`,
        mtd_target: cpsvTargetHigh,
        mtd_delivered: mtdCpsv,
        projected: Math.round(calcProjectedRatio(projectedSpend, projectedSvs)),
        daily_needed: null,
        status: costStatus(mtdCpsv, cpsvTargetHigh),
        format: "inr",
      },
      {
        metric: "Closures",
        monthly_target: null,
        mtd_target: null,
        mtd_delivered: mtdClosures,
        projected: null,
        daily_needed: null,
        status: mtdClosures > 0 ? "TRACKING" : "AWAITING DATA",
        format: "number",
      },
    ];

    res.json({
      client_id: clientId,
      platform,
      month: now.toISOString().slice(0, 7),
      days_elapsed: daysElapsed,
      days_remaining: daysRemaining,
      total_days: totalDays,
      pct_through_month: Number(((daysElapsed / totalDays) * 100).toFixed(1)),
      rows,
      alerts: mp?.alerts || [],
      data_integrity: {
        manual_input_missing: !manual.svs_achieved && !manual.positive_leads_achieved,
        tracking_issue: mtdSpend > 500 && mtdLeads === 0,
      },
    });
  });

  app.get("/api/clients/:clientId/mtd-deliverables", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const platform = (req.query.platform as string) || "meta";
    const filePath = getMtdDeliverablesPath(clientId, platform);
    if (!fs.existsSync(filePath)) {
      if (platform === "meta") {
        const legacyPath = getLegacyMtdDeliverablesPath(clientId);
        if (fs.existsSync(legacyPath)) {
          try {
            return res.json(JSON.parse(fs.readFileSync(legacyPath, "utf-8")));
          } catch { }
        }
      }
      return res.json({
        svs_achieved: 0,
        positive_leads_achieved: 0,
        closures_achieved: 0,
        quality_lead_count: 0,
        notes: "",
        updated_at: null,
      });
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      res.json(data);
    } catch {
      res.json({
        svs_achieved: 0,
        positive_leads_achieved: 0,
        closures_achieved: 0,
        quality_lead_count: 0,
        notes: "",
        updated_at: null,
      });
    }
  });

  app.put("/api/clients/:clientId/mtd-deliverables", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const platform = (req.query.platform as string) || "meta";
    const filePath = getMtdDeliverablesPath(clientId, platform);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      svs_achieved: Number(req.body.svs_achieved) || 0,
      positive_leads_achieved: Number(req.body.positive_leads_achieved) || 0,
      closures_achieved: Number(req.body.closures_achieved) || 0,
      quality_lead_count: Number(req.body.quality_lead_count) || 0,
      notes: req.body.notes || "",
      updated_at: new Date().toISOString(),
      updated_by: req.body.updated_by || "System User",
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Update History
    const historyPath = getMtdHistoryPath(clientId, platform);
    let history: any[] = [];
    if (fs.existsSync(historyPath)) {
      try {
        history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      } catch (e) { }
    } else if (platform === "meta") {
      const legacyHistoryPath = getLegacyMtdHistoryPath(clientId);
      if (fs.existsSync(legacyHistoryPath)) {
        try {
          history = JSON.parse(fs.readFileSync(legacyHistoryPath, "utf-8"));
        } catch (e) { }
      }
    }
    history.unshift({ ...data, id: Date.now() });
    // Keep last 50 entries
    if (history.length > 50) history = history.slice(0, 50);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    res.json(data);
  });

  app.get("/api/clients/:clientId/mtd-deliverables/history", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const platform = (req.query.platform as string) || "meta";
    const historyPath = getMtdHistoryPath(clientId, platform);
    if (!fs.existsSync(historyPath)) {
      if (platform === "meta") {
        const legacyHistoryPath = getLegacyMtdHistoryPath(clientId);
        if (fs.existsSync(legacyHistoryPath)) {
          try {
            return res.json(JSON.parse(fs.readFileSync(legacyHistoryPath, "utf-8")));
          } catch { }
        }
      }
      return res.json([]);
    }
    try {
      const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      res.json(history);
    } catch {
      res.json([]);
    }
  });

  // ─── Execution Learning Endpoints ────────────────────────────────

  app.get("/api/execution-learning", requireAdmin, (_req, res) => {
    try {
      const data = getLearningData();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to read learning data" });
    }
  });

  app.get("/api/execution-learning/summary", requireAdmin, (_req, res) => {
    try {
      const summary = getLearningSummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to compute learning summary" });
    }
  });

  // Trigger outcome update for pending learning entries
  app.post("/api/execution-learning/update-outcomes", requireAdmin, async (req, res) => {
    try {
      const { clientId, platform } = req.body;
      const data = await readAnalysisData(clientId, platform);
      const count = triggerOutcomeUpdate(data);
      res.json({ success: true, updatedCount: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FEEDBACK LOOP: Save user feedback on recommendations
  app.post("/api/recommendations/feedback", requireAdmin, (req, res) => {
    const { text, context, status, clientId, platform } = req.body;
    if (!text || !status) {
      return res.status(400).json({ error: "Text and status are required" });
    }

    const CSV_PATH = path.join(DATA_BASE, "learning-data.csv");
    const timestamp = new Date().toISOString();
    const row = `"${timestamp}","${clientId || "unknown"}","${platform || "unknown"}","${status}","${text.replace(/"/g, '""')}","${(context || "").replace(/"/g, '""')}"\n`;

    try {
      if (!fs.existsSync(CSV_PATH)) {
        fs.writeFileSync(CSV_PATH, "timestamp,clientId,platform,status,recommendation,context\n");
      }
      fs.appendFileSync(CSV_PATH, row);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Failed to save feedback:", err);
      res.status(500).json({ error: "Failed to save feedback" });
    }
  });


  // ─── Data Verification Endpoint ─────────────────────────────────
  app.get("/api/clients/:clientId/:platform/verify-data", requireOwnership, async (req, res) => {
    const { clientId, platform } = req.params as Record<string, string>;
    const cadence = (req.query.cadence as string) || "twice_weekly";

    try {
      const data = await readAnalysisData(clientId, platform, cadence);
      const ap = data.account_pulse || {};
      const agentSpend = ap.total_spend_30d ?? ap.total_spend ?? 0;
      const agentLeads = Math.round(ap.total_leads_30d ?? ap.total_leads ?? 0);

      // Check if the normalizer embedded verification data (from meta-transform / google-transform)
      const verification = data.data_verification || data.api_cross_check;
      if (verification) {
        return res.json({
          verified: verification.verified ?? (verification.discrepancy_pct < 5 && (verification.leads_discrepancy_pct ?? 0) < 5),
          // Spend checks
          apiSpend: verification.api_spend ?? verification.live_spend ?? agentSpend,
          agentSpend,
          discrepancy: Math.abs((verification.api_spend ?? agentSpend) - agentSpend),
          discrepancyPct: verification.spend_discrepancy_pct ?? verification.discrepancy_pct ?? 0,
          // Leads checks
          apiLeads: verification.entity_leads ?? verification.reported_leads ?? agentLeads,
          agentLeads,
          leadsDiscrepancy: verification.leads_discrepancy ?? 0,
          leadsDiscrepancyPct: verification.leads_discrepancy_pct ?? 0,
          creativeHealthLeads: verification.creative_health_leads ?? null,
          adsetAnalysisLeads: verification.adset_analysis_leads ?? null,
          leadsCorrectionApplied: verification.leads_correction_applied ?? false,
          leadsCorrectionFactor: verification.leads_correction_factor ?? 1,
          // Status
          status: "verified",
          lastVerified: verification.verified_at ?? data.generated_at ?? null,
        });
      }

      // Cross-check: compare current cadence data with the base analysis.json
      // If they differ significantly, flag it
      try {
        const baseData = await readAnalysisData(clientId, platform); // default (no cadence)
        const baseAp = baseData.account_pulse || {};
        const baseSpend = baseAp.total_spend_30d ?? baseAp.total_spend ?? 0;
        const baseLeads = Math.round(baseAp.total_leads_30d ?? baseAp.total_leads ?? 0);

        const spendDiscrepancy = Math.abs(agentSpend - baseSpend);
        const spendDiscrepancyPct = baseSpend > 0 ? (spendDiscrepancy / baseSpend) * 100 : 0;

        const leadsDiscrepancy = Math.abs(agentLeads - baseLeads);
        const leadsDiscrepancyPct = baseLeads > 0 ? (leadsDiscrepancy / baseLeads) * 100 : 0;

        return res.json({
          verified: spendDiscrepancyPct < 5 && leadsDiscrepancyPct < 5,
          apiSpend: baseSpend,
          agentSpend,
          discrepancy: Math.round(spendDiscrepancy),
          discrepancyPct: parseFloat(spendDiscrepancyPct.toFixed(2)),
          apiLeads: baseLeads,
          agentLeads,
          leadsDiscrepancy: leadsDiscrepancy,
          leadsDiscrepancyPct: parseFloat(leadsDiscrepancyPct.toFixed(2)),
          creativeHealthLeads: null,
          adsetAnalysisLeads: null,
          leadsCorrectionApplied: false,
          leadsCorrectionFactor: 1,
          status: "cross_checked",
          lastVerified: data.generated_at || null,
        });
      } catch {
        // Can't cross-check, return unverified
        return res.json({
          verified: true,
          apiSpend: agentSpend,
          agentSpend,
          discrepancy: 0,
          discrepancyPct: 0,
          apiLeads: agentLeads,
          agentLeads,
          leadsDiscrepancy: 0,
          leadsDiscrepancyPct: 0,
          creativeHealthLeads: null,
          adsetAnalysisLeads: null,
          leadsCorrectionApplied: false,
          leadsCorrectionFactor: 1,
          status: "single_source",
          lastVerified: data.generated_at || null,
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Verification failed" });
    }
  });

  app.get("/api/clients/:clientId/:platform/check-new-entities", requireOwnership, async (req, res) => {
    const { clientId, platform } = req.params as Record<string, string>;

    try {
      const data = await readAnalysisData(clientId, platform);
      const campaigns = (data as any).campaign_audit || (data as any).campaigns || [];
      const adsetAnalysis = (data as any).adset_analysis || (data as any).ad_group_analysis || [];
      const campaignAnalysis = (data as any).campaign_audit || (data as any).campaigns || (data as any).campaign_analysis || [];
      const adsets = data.adset_analysis || data.ad_groups || [];

      const newCampaigns = campaigns.filter((c: any) => {
        if (c.is_new) return true;
        if (c.created_time) {
          const created = new Date(c.created_time);
          const hoursSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60);
          return hoursSinceCreated < 48;
        }
        return false;
      }).map((c: any) => ({
        id: c.campaign_id || c.id,
        name: c.campaign_name || c.name,
        type: c.layer || c.campaign_type || c.theme || "unknown",
      }));

      const newAdsets = adsets.filter((a: any) => {
        if (a.is_new) return true;
        if (a.created_time) {
          const created = new Date(a.created_time);
          const hoursSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60);
          return hoursSinceCreated < 48;
        }
        return false;
      }).map((a: any) => ({
        id: a.adset_id || a.ad_group_id || a.id,
        name: a.adset_name || a.ad_group_name || a.name,
      }));

      res.json({
        hasNewEntities: newCampaigns.length > 0 || newAdsets.length > 0,
        newCampaigns,
        newAdsets,
        totalNew: newCampaigns.length + newAdsets.length,
        lastAnalysis: data.generated_at || data.run_metadata?.timestamp || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Entity check failed" });
    }
  });

  // ─── SSE Endpoint for Live Updates ──────────────────────────────
  app.get("/api/events", requireAuth, async (req, res) => {
    const user = req.authUser!;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("event: connected\ndata: {}\n\n");

    // Pass user context for scoping events
    await addSSEClient(res, user);

    req.on("close", () => {
      // cleanup handled in addSSEClient
    });
  });

  // ─── Scheduler Endpoints ──────────────────────────────────────────

  app.get("/api/scheduler/status", (_req, res) => {
    res.json(getSchedulerStatus());
  });

  app.post("/api/scheduler/run-now", async (req, res) => {
    const userId = typeof req.session.authUserId === "string"
      ? req.session.authUserId
      : undefined;

    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: "Auth required" });

    if (user.role === "admin") {
      // Admin runs agent for all clients
      triggerManualRun();
    } else {
      // Member runs agent only for their own clients
      const registry = await loadRegistry();
      const ownedClientIds = registry
        .filter((c) => c.createdBy === user.id)
        .map((c) => c.id);

      if (ownedClientIds.length === 0) {
        return res.status(400).json({ error: "You have no clients to sync" });
      }
      triggerManualRun(ownedClientIds);
    }

    res.json({ success: true, message: "Agent run triggered" });
  });

  // ─── Command Parser Endpoint ──────────────────────────────────────
  // Parses natural language commands into executable actions
  app.post("/api/parse-command", requireAdmin, async (req, res) => {
    try {
      const { command, clientId, platform = "meta" } = req.body;
      if (!clientId) return res.status(400).json({ error: "clientId is required" });
      if (!command || typeof command !== "string") {
        return res.status(400).json({ error: "Command text required" });
      }

      const cmd = command.toLowerCase().trim();
      const data = await readAnalysisData(clientId, platform);
      const adsets: any[] = (data as any).adset_analysis || (data as any).ad_group_analysis || [];
      const campaigns: any[] = (data as any).campaign_audit || (data as any).campaigns || (data as any).campaign_analysis || [];

      const parsed: Array<{
        action: string;
        entityId: string;
        entityName: string;
        entityType: string;
        params: Record<string, any>;
        description: string;
      }> = [];

      // Pause campaign by name
      const pauseCampaignMatch = cmd.match(/pause\s+campaign\s+["""]?(.+?)["""]?\s*$/);
      if (pauseCampaignMatch) {
        const name = pauseCampaignMatch[1];
        const match = campaigns.find((c: any) =>
          (c.campaign_name || c.name || "").toLowerCase().includes(name.toLowerCase())
        );
        if (match) {
          const campName = match.campaign_name || match.name;
          const campId = match.campaign_id || match.id;
          parsed.push({
            action: "PAUSE_CAMPAIGN",
            entityId: campId,
            entityName: campName,
            entityType: "campaign",
            params: { reason: `User command: ${command}` },
            description: `Pause campaign "${campName}"`,
          });
        }
      }

      // Pause adset/ad group by name
      const pauseAdsetMatch = cmd.match(/pause\s+(?:adset|ad\s*group)\s+["""]?(.+?)["""]?\s*$/);
      if (pauseAdsetMatch) {
        const name = pauseAdsetMatch[1];
        const match = adsets.find((a: any) =>
          (a.adset_name || a.ad_group_name || "").toLowerCase().includes(name.toLowerCase())
        );
        if (match) {
          parsed.push({
            action: platform === "google" ? "PAUSE_AD_GROUP" : "PAUSE_ADSET",
            entityId: match.adset_id || match.ad_group_id,
            entityName: match.adset_name || match.ad_group_name,
            entityType: platform === "google" ? "ad_group" : "adset",
            params: { reason: `User command: ${command}` },
            description: `Pause ${platform === "google" ? "ad group" : "adset"} "${match.adset_name || match.ad_group_name}"`,
          });
        }
      }

      // Increase/decrease budget
      const budgetMatch = cmd.match(/(increase|decrease|raise|lower|scale\s*up|scale\s*down)\s+budget\s+(?:of\s+|for\s+|on\s+)?["""]?(.+?)["""]?\s+(?:by\s+)?(\d+)%?\s*$/);
      if (budgetMatch) {
        const direction = budgetMatch[1];
        const name = budgetMatch[2];
        const pct = parseInt(budgetMatch[3]);
        const isUp = ["increase", "raise", "scale up"].includes(direction);
        const campaign = campaigns.find((c: any) =>
          (c.campaign_name || c.name || "").toLowerCase().includes(name.toLowerCase())
        );
        const adset = adsets.find((a: any) =>
          (a.adset_name || a.ad_group_name || a.name || "").toLowerCase().includes(name.toLowerCase())
        );
        const entity = campaign || adset;
        if (entity) {
          parsed.push({
            action: isUp ? "SCALE_BUDGET_UP" : "SCALE_BUDGET_DOWN",
            entityId: entity.campaign_id || entity.id || entity.adset_id || entity.ad_group_id,
            entityName: entity.campaign_name || entity.name || entity.adset_name || entity.ad_group_name,
            entityType: campaign ? "campaign" : (platform === "google" ? "ad_group" : "adset"),
            params: { scalePercent: pct, reason: `User command: ${command}` },
            description: `${isUp ? "Increase" : "Decrease"} budget by ${pct}% on "${entity.campaign_name || entity.adset_name || entity.ad_group_name}"`,
          });
        }
      }

      // Pause all underperformers
      if (cmd.includes("pause") && (cmd.includes("underperformer") || cmd.includes("loser"))) {
        const targets = adsets.filter((a: any) =>
          a.should_pause === true || a.classification === "UNDERPERFORMER"
        );
        for (const t of targets) {
          parsed.push({
            action: platform === "google" ? "PAUSE_AD_GROUP" : "PAUSE_ADSET",
            entityId: t.adset_id || t.ad_group_id,
            entityName: t.adset_name || t.ad_group_name,
            entityType: platform === "google" ? "ad_group" : "adset",
            params: { reason: `User command: ${command}` },
            description: `Pause underperformer "${t.adset_name || t.ad_group_name}" (score: ${t.health_score})`,
          });
        }
      }

      // Google-specific: add negative keyword
      if (platform === "google" && cmd.includes("negative") && cmd.includes("keyword")) {
        const kwMatch = cmd.match(/add\s+negative\s+(?:keyword\s+)?["""]?(.+?)["""]?\s+(?:to|for|in)\s+(.+)/i);
        if (kwMatch) {
          const keyword = kwMatch[1].trim();
          const campaignName = kwMatch[2].trim();
          const matchedCampaign = campaigns.find((c: any) =>
            (c.campaign_name || c.name || "").toLowerCase().includes(campaignName.toLowerCase())
          );
          if (matchedCampaign) {
            parsed.push({
              action: "ADD_NEGATIVE_KEYWORD",
              entityId: matchedCampaign.campaign_id || matchedCampaign.id,
              entityName: keyword,
              entityType: "campaign",
              params: {
                keyword,
                campaignId: matchedCampaign.campaign_id || matchedCampaign.id,
                matchType: "BROAD",
                reason: `User command: ${command}`,
              },
              description: `Add negative keyword "${keyword}" to "${matchedCampaign.campaign_name || matchedCampaign.name}"`,
            });
          }
        }
      }

      // Google-specific: adjust bid
      if (platform === "google" && (cmd.includes("bid") || cmd.includes("cpc"))) {
        const bidMatch = cmd.match(/(increase|decrease|raise|lower)\s+(?:bid|cpc)\s+(?:of\s+|for\s+|on\s+)?["""]?(.+?)["""]?\s+(?:by\s+)?(\d+)%?\s*$/);
        if (bidMatch) {
          const direction = bidMatch[1];
          const name = bidMatch[2];
          const pct = parseInt(bidMatch[3]);
          const isUp = ["increase", "raise"].includes(direction);
          // Find ad group
          const allAdGroups: any[] = [];
          for (const camp of (data as any).campaigns || []) {
            for (const ag of camp.ad_groups || []) {
              allAdGroups.push({ ...ag, campaign_name: camp.name || camp.campaign_name });
            }
          }
          const ag = allAdGroups.find((a: any) =>
            (a.name || a.ad_group_name || "").toLowerCase().includes(name.toLowerCase())
          );
          if (ag) {
            const currentCpc = ag.max_cpc || ag.current_max_cpc || ag.avg_cpc || 0;
            const newCpc = isUp ? currentCpc * (1 + pct / 100) : currentCpc * (1 - pct / 100);
            parsed.push({
              action: "SET_CPC_BID",
              entityId: ag.id || ag.ad_group_id,
              entityName: ag.name || ag.ad_group_name,
              entityType: "ad_group",
              params: {
                newBidMicros: Math.round(newCpc * 1000000),
                reason: `User command: ${command}`,
              },
              description: `${isUp ? "Increase" : "Decrease"} CPC bid by ${pct}% on ad group "${ag.name || ag.ad_group_name}" (₹${currentCpc.toFixed(2)} → ₹${newCpc.toFixed(2)})`,
            });
          }
        }
      }

      // Scale all winners
      if (cmd.includes("scale") && cmd.includes("winner")) {
        const pctMatch = cmd.match(/(\d+)%/);
        const pct = pctMatch ? parseInt(pctMatch[1]) : 20;
        const winners = adsets.filter((a: any) => a.classification === "WINNER");
        for (const w of winners) {
          if (w.adset_id || w.ad_group_id) {
            parsed.push({
              action: "SCALE_BUDGET_UP",
              entityId: w.adset_id || w.ad_group_id,
              entityName: w.adset_name || w.ad_group_name,
              entityType: platform === "google" ? "ad_group" : "adset",
              params: { scalePercent: pct, reason: `User command: ${command}` },
              description: `Scale winner "${w.adset_name || w.ad_group_name}" +${pct}%`,
            });
          }
        }
      }

      res.json({
        command,
        parsed,
        count: parsed.length,
        message: parsed.length > 0
          ? `Parsed ${parsed.length} action(s) from command`
          : "Could not parse command into actions. Try: 'pause campaign X', 'increase budget of X by 20%', 'pause all underperformers', 'scale all winners 20%'",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Command parsing failed" });
    }
  });

  // ─── Unified Intelligence Pipeline (Central Source of Truth) ──────
  // Enforces 4-layer pipeline globally with caching
  app.get("/api/intelligence/:clientId/:platform/insights", requireOwnership, async (req, res) => {
    try {
      const { clientId, platform } = req.params as Record<string, string>;
      const { type = "recommendation", alert_problem, alert_metric, alert_metrics } = req.query as Record<string, string>;

      // Build alertContext when the request comes from a specific alert modal
      const alertContext = alert_problem
        ? {
          problem: alert_problem,
          metric: alert_metric,
          metrics: alert_metrics ? JSON.parse(alert_metrics) : undefined,
        }
        : undefined;

      console.log(`[API] Unified Intelligence Request: client=${clientId} platform=${platform} type=${type}${alertContext ? ` alert="${alert_problem?.substring(0, 60)}"` : ""}`);

      // Build a unique cache key that includes alert context if present
      let cacheKey_val = cacheKey("intelligence", clientId, platform, type);
      if (alertContext) {
        // Create a simple stable string representation for the alert context to use as a cache key suffix
        const contextStr = `${alert_problem || ""}:${alert_metric || ""}:${alert_metrics || ""}`;
        const contextHash = Buffer.from(contextStr).toString("base64").substring(0, 32);
        cacheKey_val = cacheKey("intelligence", clientId, platform, type, "alert", contextHash);
      }

      // Check cache
      const cached = getCache(cacheKey_val);
      if (cached) {
        console.log(`[API] Cache hit for ${cacheKey_val}`);
        return res.json(cached);
      }

      const result = await insightsEngine({
        clientId,
        platform: platform as any,
        type: type as any,
        alertContext,
      });

      // Cache result (5 minute TTL)
      setCache(cacheKey_val, result, 300); // 5 minutes
      console.log(`[API] Cached result for ${cacheKey_val}`);

      res.json(result);
    } catch (err: any) {
      console.error(`[API] Intelligence Pipeline Failure:`, err);
      res.status(500).json({
        error: "Critical Pipeline Failure",
        message: err.message
      });
    }
  });

  // ─── AI Command Terminal ──────────────────────────────────────────
  // POST /api/ai/command
  // Accepts a natural language command, runs it through Claude, executes actions
  app.post("/api/ai/command", requireAdmin, async (req, res) => {
    try {
      const { command, clientId, platform, provider } = req.body as {
        command: string;
        clientId: string;
        platform: "meta" | "google" | "all";
        provider?: "groq" | "gemini" | "auto";
      };

      if (!command?.trim()) {
        return res.status(400).json({ error: "command is required" });
      }
      if (!clientId) {
        return res.status(400).json({ error: "clientId is required" });
      }

      // Load client config and analysis data
      const registry = await loadRegistry();
      const client = registry.find((c) => c.id === clientId);
      if (!client) {
        return res.status(404).json({ error: `Client "${clientId}" not found` });
      }

      const requestedPlatform = platform || "all";
      let analysisData: any = {};

      if (requestedPlatform === "all") {
        const metaConfig = client.platforms.meta;
        const googleConfig = client.platforms.google;
        let metaData: any = {};
        let googleData: any = {};

        if (metaConfig) {
          const metaPath = resolvePlatformDataPath(clientId, "meta", metaConfig);
          if (fs.existsSync(metaPath)) {
            try {
              metaData = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            } catch { }
          }
        }

        if (googleConfig) {
          const googlePath = resolvePlatformDataPath(clientId, "google", googleConfig);
          if (fs.existsSync(googlePath)) {
            try {
              googleData = JSON.parse(fs.readFileSync(googlePath, "utf-8"));
            } catch { }
          }
        }

        analysisData = {
          campaign_audit: [
            ...((metaData?.campaign_audit || metaData?.campaigns || []) as any[]).map((item) => ({
              ...item,
              _sourcePlatform: "meta",
            })),
            ...((googleData?.campaign_performance || googleData?.campaigns || []) as any[]).map((item) => ({
              ...item,
              _sourcePlatform: "google",
            })),
          ],
        };
      } else {
        const platformConfig = client.platforms[requestedPlatform];
        if (platformConfig) {
          const resolvedPath = resolvePlatformDataPath(clientId, requestedPlatform, platformConfig);
          if (fs.existsSync(resolvedPath)) {
            try {
              analysisData = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
            } catch {
              // analysis data unavailable — AI will work with empty context
            }
          }
        }
      }

      const clientTargets =
        requestedPlatform === "google"
          ? client.targets?.google || client.targets?.meta
          : client.targets?.meta || client.targets?.google;

      const result = await handleAICommand({
        command: command.trim(),
        clientId,
        platform: requestedPlatform,
        analysisData,
        clientTargets,
        provider: provider || "auto",
      });

      res.json(result);
    } catch (err: any) {
      console.error("[AI Command Route] Error:", err);
      res.status(500).json({ error: err.message || "AI command failed" });
    }
  });

  app.get("/api/config/ai", requireAdmin, (_req, res) => {
    res.json(readAiConfig());
  });

  app.post("/api/config/ai", (req, res) => {
    const next = req.body;
    saveAiConfig(next);
    res.json({ success: true, config: next });
  });

  // ─── Bidding Intelligence Module ────────────────────────────────────────
  // GET /api/clients/:clientId/google/bidding-recommendations
  // Computes per-campaign bidding decisions: Max Clicks or tCPA + reason + confidence
  app.get("/api/clients/:clientId/google/bidding-recommendations", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const dataDir = getClientDataDir(clientId);
    const analysisPath = path.join(dataDir, "google", "analysis.json");

    if (!fs.existsSync(analysisPath)) {
      return res.json({ campaigns: [], meta: { generated_at: new Date().toISOString(), data_available: false } });
    }

    try {
      const raw = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      const campaigns: any[] = raw.campaigns || [];
      const biddingAnalysis = raw.bidding_analysis || {};
      const perAdGroup: any[] = biddingAnalysis.per_ad_group || [];
      const smartReadiness: any[] = biddingAnalysis.smart_bidding_readiness || [];
      const targetCpa: number = raw.meta?.target_cpa || raw.targets?.google?.target_cpa || 850;

      // Group ad groups by campaign for aggregation
      const campMap = new Map<string, any[]>();
      for (const ag of perAdGroup) {
        const key = ag.campaign_id || ag.campaign_name;
        if (!campMap.has(key)) campMap.set(key, []);
        campMap.get(key)!.push(ag);
      }

      const recommendations = campaigns.map((camp: any) => {
        const campId = camp.id || camp.campaign_id || camp.name;
        const campName = camp.name || camp.campaign_name;
        const adGroups = campMap.get(campId) || campMap.get(campName) || [];

        // Aggregate metrics from ad groups
        const totalClicks = adGroups.reduce((s: number, ag: any) => s + (ag.clicks || 0), 0);
        const totalConversions = adGroups.reduce((s: number, ag: any) => s + (ag.conversions || 0), 0);
        const totalCost = adGroups.reduce((s: number, ag: any) => s + (ag.cost || 0), 0);
        const avgCpc = totalClicks > 0 ? totalCost / totalClicks : (camp.avg_cpc || camp.cpc || 0);
        const cvr = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : (camp.cvr || 0);
        const costPerConversion = totalConversions > 0 ? totalCost / totalConversions : 0;
        const searchIs = camp.search_impression_share ?? camp.impression_share_analysis?.search_impression_share ?? null;
        const lostIsRank = camp.search_rank_lost_is ?? camp.impression_share_analysis?.search_rank_lost_is ?? null;
        const lostIsBudget = camp.search_budget_lost_is ?? camp.impression_share_analysis?.search_budget_lost_is ?? null;
        const currentStrategy = camp.bidding_strategy || "MAXIMIZE_CLICKS";
        const lowTopOfPageCpc = adGroups[0]?.low_top_of_page_cpc || avgCpc * 0.8;

        // Find smart bidding readiness data for this campaign
        const smartData = smartReadiness.find((sb: any) =>
          sb.campaign_id === campId || sb.campaign_name === campName
        );
        const conversions30d = smartData?.conversions_30d ?? totalConversions;
        const cvrVariance14d = smartData?.cvr_variance_14d ?? null;
        const trackingStable = smartData?.tracking_stable ?? true;
        const conv14d = camp.conversions_14d ?? totalConversions;

        // ─── SOP Decision Engine ──────────────────────────────────────
        // Bid Limit Formula: MIN(Low Top-of-Page CPC × 1.35, Target CPA × CVR)
        const bidLimitByTopOfPage = lowTopOfPageCpc * 1.35;
        const bidLimitByCPA = targetCpa * (cvr / 100);
        const computedBidLimit = Math.min(bidLimitByTopOfPage, bidLimitByCPA);
        const suggestedTcpa = costPerConversion > 0 ? Math.round(costPerConversion * 0.8) : Math.round(targetCpa * 0.9);

        // CVR stability signals
        const cvrStable = cvrVariance14d !== null ? cvrVariance14d < 20 : (cvr > 1);
        const hasEnoughData = conversions30d >= 15;
        const hasStrongData = conversions30d >= 30;
        const hasMatureData = conversions30d >= 50;
        const cpaOnTarget = costPerConversion > 0 && costPerConversion <= targetCpa * 1.2;
        const lowImpressionShare = searchIs !== null && searchIs < 50;
        const lostToBudget = lostIsBudget !== null && lostIsBudget > 15;

        // ─── Primary Decision Logic ────────────────────────────────────
        let recommendation: "stay_max_clicks" | "switch_tcpa" | "hold" = "stay_max_clicks";
        let confidence: "high" | "medium" | "low" = "low";
        const reasons: string[] = [];
        const alerts: Array<{ severity: "critical" | "warning" | "info"; message: string }> = [];

        // CHECK: Should we HOLD (do not switch)?
        if (lostToBudget) {
          recommendation = "hold";
          confidence = "medium";
          reasons.push("Lost IS due to budget — increase budget before changing strategy");
          alerts.push({ severity: "warning", message: "Impression share lost due to budget constraints — optimize budget first" });
        } else if (!trackingStable) {
          recommendation = "hold";
          confidence = "high";
          reasons.push("Conversion tracking is unstable — fix tracking before switching");
          alerts.push({ severity: "critical", message: "Conversion tracking unstable — bidding decisions may be unreliable" });
        } else if (!hasEnoughData) {
          recommendation = "stay_max_clicks";
          confidence = "high";
          reasons.push(`Only ${conversions30d} conversions — need ≥15 to consider tCPA`);
          reasons.push(`Use Max Clicks with bid cap of ${Math.round(computedBidLimit)}`);
          if (avgCpc > computedBidLimit * 1.1) {
            alerts.push({ severity: "critical", message: `CPC ₹${Math.round(avgCpc)} exceeds bid limit ₹${Math.round(computedBidLimit)} — reduce bid cap` });
          }
        }
        // CHECK: Switch to tCPA?
        else if (hasMatureData && cvrStable && cpaOnTarget && trackingStable) {
          recommendation = "switch_tcpa";
          confidence = "high";
          reasons.push(`CVR stable at ${cvr.toFixed(1)}%`);
          reasons.push(`${conversions30d} conversions in last 30 days`);
          reasons.push(`Cost/Conv ₹${Math.round(costPerConversion)} within target range`);
          alerts.push({ severity: "info", message: `Eligible for tCPA @ ₹${suggestedTcpa} — all readiness criteria met` });
        } else if (hasStrongData && cvrStable && trackingStable) {
          recommendation = "switch_tcpa";
          confidence = "medium";
          reasons.push(`CVR stable at ${cvr.toFixed(1)}%`);
          reasons.push(`${conversions30d} conversions in 30d — approaching tCPA threshold`);
          if (!cpaOnTarget) reasons.push("Cost/Conv slightly above target — monitor before switching");
          alerts.push({ severity: "info", message: `Almost ready for tCPA — continue monitoring for consistent CPA` });
        }
        // DEFAULT: Stay on Max Clicks
        else {
          recommendation = "stay_max_clicks";
          confidence = hasEnoughData ? "medium" : "high";
          reasons.push(`CVR ${!cvrStable ? "unstable" : `at ${cvr.toFixed(1)}%`} — Max Clicks mode appropriate`);
          if (!hasStrongData) reasons.push(`Need ${30 - conversions30d} more conversions to qualify for tCPA`);
          if (avgCpc > computedBidLimit * 1.1) {
            alerts.push({ severity: "critical", message: `CPC ₹${Math.round(avgCpc)} exceeds computed bid limit ₹${Math.round(computedBidLimit)} — overbidding detected` });
          }
          if (lostIsRank !== null && lostIsRank > 20) {
            alerts.push({ severity: "warning", message: `Lost ${lostIsRank.toFixed(0)}% IS due to low rank — consider raising bid limit` });
          }
        }

        if (searchIs !== null && searchIs < 40) {
          alerts.push({ severity: "warning", message: `Low impression share (${searchIs.toFixed(0)}%) — campaign visibility is limited` });
        }

        return {
          campaign_id: campId,
          campaign_name: campName,
          campaign_type: camp.campaign_type || "",
          status: camp.status || "ACTIVE",
          // Current state
          current_strategy: currentStrategy,
          // Metrics
          avg_cpc: avgCpc,
          cvr,
          ctr: camp.ctr || 0,
          conversions_30d: conversions30d,
          conversions_14d: conv14d,
          cost_per_conversion: costPerConversion,
          search_impression_share: searchIs,
          lost_is_rank: lostIsRank,
          lost_is_budget: lostIsBudget,
          clicks: totalClicks,
          // Decision engine output
          recommendation,
          confidence,
          reasons,
          alerts,
          // Bid calculations (SOP formula)
          computed_bid_limit: computedBidLimit,
          bid_limit_by_top_of_page: bidLimitByTopOfPage,
          bid_limit_by_cpa: bidLimitByCPA,
          suggested_tcpa: suggestedTcpa,
          target_cpa: targetCpa,
          // Additional context
          cvr_variance_14d: cvrVariance14d,
          tracking_stable: trackingStable,
          low_top_of_page_cpc: lowTopOfPageCpc,
        };
      });

      // Action history storage
      const historyPath = path.join(dataDir, "bidding_action_history.json");
      let history: any[] = [];
      if (fs.existsSync(historyPath)) {
        try { history = JSON.parse(fs.readFileSync(historyPath, "utf8")); } catch { history = []; }
      }

      const alertCount = recommendations.reduce((sum: number, r: any) =>
        sum + r.alerts.filter((a: any) => a.severity === "critical" || a.severity === "warning").length, 0);
      const onCorrectStrategy = recommendations.filter((r: any) =>
        (r.recommendation === "stay_max_clicks" && r.current_strategy !== "TARGET_CPA") ||
        (r.recommendation === "switch_tcpa" && r.current_strategy === "TARGET_CPA")
      ).length;

      res.json({
        campaigns: recommendations,
        meta: {
          generated_at: new Date().toISOString(),
          data_available: true,
          total_campaigns: recommendations.length,
          alert_count: alertCount,
          on_correct_strategy: onCorrectStrategy,
          target_cpa: targetCpa,
        },
        history: history.slice(-20), // Last 20 actions
      });
    } catch (err: any) {
      console.error("[Bidding Recommendations] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/clients/:clientId/google/bidding-recommendations/action
  // Records user action (Apply/Reject) with mandatory strategic rationale
  app.post("/api/clients/:clientId/google/bidding-recommendations/action", requireOwnership, (req, res) => {
    const { clientId } = req.params as Record<string, string>;
    const { campaign_id, campaign_name, action, recommendation, rationale, params } = req.body;

    if (!rationale || rationale.trim().length < 10) {
      return res.status(400).json({ error: "Strategic rationale is required (min 10 characters)" });
    }

    const dataDir = getClientDataDir(clientId);
    const historyPath = path.join(dataDir, "bidding_action_history.json");
    let history: any[] = [];
    if (fs.existsSync(historyPath)) {
      try { history = JSON.parse(fs.readFileSync(historyPath, "utf8")); } catch { history = []; }
    }

    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      campaign_id,
      campaign_name,
      action, // "apply" | "reject" | "manual_apply"
      recommendation,
      rationale,
      params: params || {},
    };
    history.push(entry);
    if (history.length > 200) history = history.slice(-200);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8");

    res.json({ success: true, entry });
  });

  // ─── Bidding Intelligence: Trigger + DB Action ───────────────
  // NOTE: GET /api/clients/:clientId/google/bidding-recommendations is handled above (SOP decision engine)
  // NOTE: POST .../action is handled above (file-based action recording)

  app.post("/api/clients/:clientId/google/bidding-recommendations/trigger", requireOwnership, async (req, res) => {
    try {
      const { clientId } = req.params as Record<string, string>;
      await generateBiddingRecommendations(clientId);
      res.json({ success: true, message: "Bidding intelligence run completed." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/performance-alerts/:clientId/:platform", requireOwnership, async (req, res) => {
    try {
      const clientId = String(req.params.clientId);
      const platform = String(req.params.platform);
      const alerts = await db.select().from(performanceAlerts).where(
        and(
          eq(performanceAlerts.clientId, clientId),
          eq(performanceAlerts.platform, platform),
          eq(performanceAlerts.status, "active")
        )
      );
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/performance-alerts/:id/complete", requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      await db.update(performanceAlerts)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(performanceAlerts.id, parseInt(id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/performance-alerts/:id/reject", requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      await db.update(performanceAlerts)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(performanceAlerts.id, parseInt(id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
