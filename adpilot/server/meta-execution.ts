/**
 * Meta Ads API Execution Engine
 * 
 * Provides programmatic control over Meta Ads:
 * - Pause/Unpause campaigns, adsets, ads
 * - Scale budgets (increase/decrease)
 * - Batch operations
 * 
 * Uses the Meta Marketing API v21.0 via HTTP POST requests.
 * All actions are logged to an audit trail for accountability.
 */

import fs from "fs";
import path from "path";

// ─── Configuration ────────────────────────────────────────────────
const META_API_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Token and account ID are read from the agent's config
const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const AUDIT_LOG_PATH = path.join(DATA_BASE, "execution_audit_log.json");

function getMetaAccessToken(): string {
  return process.env.META_ACCESS_TOKEN || "";
}

// ─── Types ────────────────────────────────────────────────────────

export type ExecutionActionType = 
  | "PAUSE_AD"
  | "UNPAUSE_AD"
  | "PAUSE_ADSET"
  | "UNPAUSE_ADSET"
  | "PAUSE_CAMPAIGN"
  | "UNPAUSE_CAMPAIGN"
  | "SCALE_BUDGET_UP"
  | "SCALE_BUDGET_DOWN"
  | "SET_BUDGET";

export interface ExecutionRequest {
  action: ExecutionActionType;
  entityId: string;           // campaign_id, adset_id, or ad_id
  entityName: string;         // human-readable name
  entityType: "campaign" | "adset" | "ad";
  clientId?: string;          // which dashboard client this action belongs to
  // The client's own Meta access token/ad account, used instead of the shared
  // legacy env token so budget currency conversion matches the right account.
  // Optional only so this type doesn't force a breaking change on every field —
  // routes.ts resolves and passes these for every real call site.
  accessToken?: string;
  adAccountId?: string;
  params?: {
    budgetAmount?: number;    // new daily budget in rupees (paise internally)
    currentBudget?: number;   // fallback current daily budget in rupees
    scalePercent?: number;    // e.g. 20 = increase by 20%
    reason?: string;          // why this action is being taken
    playbookRef?: string;     // which SOP playbook triggered this
    recommendationId?: string; // link to the recommendation
  };
  requestedBy: "user" | "agent" | "auto";
  requestedByName?: string;
  strategicCall?: string;
}

export interface ExecutionResult {
  success: boolean;
  action: ExecutionActionType;
  entityId: string;
  entityName: string;
  entityType: string;
  clientId?: string;
  previousValue?: string;
  newValue?: string;
  metaApiResponse?: any;
  error?: string;
  timestamp: string;
  requestedBy: string;
  requestedByName?: string;
  reason?: string;
  strategicCall?: string;
}

interface AuditEntry extends ExecutionResult {
  id: string;
}

// ─── Audit Log ────────────────────────────────────────────────────

function readAuditLog(): AuditEntry[] {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeAuditLog(entries: AuditEntry[]): void {
  const dir = path.dirname(AUDIT_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(entries, null, 2));
}

function logExecution(result: ExecutionResult): AuditEntry {
  const entry: AuditEntry = {
    ...result,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  };
  const log = readAuditLog();
  log.unshift(entry); // newest first
  // Keep last 500 entries
  if (log.length > 500) log.length = 500;
  writeAuditLog(log);
  return entry;
}

export function appendAuditEntry(result: ExecutionResult): AuditEntry {
  return logExecution(result);
}

// ─── Retry Helper ─────────────────────────────────────────────────

/**
 * Fetch with automatic retry on HTTP 429 (rate limit).
 * Reads the Retry-After header to determine wait time; defaults to 5s if absent.
 * Retries up to maxRetries times before giving up.
 */
async function fetchWithRetry(
  url: string,
  // eslint-disable-next-line no-undef
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.status !== 429 || attempt === maxRetries) {
      return response;
    }

    lastResponse = response;

    // Parse Retry-After header (value in seconds)
    const retryAfterHeader = response.headers.get("Retry-After");
    const waitSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
    const waitMs = (isNaN(waitSeconds) ? 5 : waitSeconds) * 1000;

    console.log(
      `[meta-execution] 429 rate limit hit on attempt ${attempt + 1}/${maxRetries + 1}. ` +
      `Waiting ${waitMs / 1000}s before retry...`
    );

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // Should not reach here, but return last response as fallback
  return lastResponse!;
}

// ─── Meta API Helpers ─────────────────────────────────────────────

async function metaApiPost(
  entityId: string,
  params: Record<string, string | number>,
  accessToken?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const url = `${META_BASE_URL}/${entityId}`;
  const body = new URLSearchParams();
  body.append("access_token", accessToken || getMetaAccessToken());
  for (const [key, value] of Object.entries(params)) {
    body.append(key, String(value));
  }

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await response.json();
    
    if (data.error) {
      return { success: false, error: data.error.message || JSON.stringify(data.error) };
    }
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error" };
  }
}

async function metaApiGet(
  entityId: string,
  fields: string[],
  accessToken?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const url = `${META_BASE_URL}/${entityId}?fields=${fields.join(",")}&access_token=${accessToken || getMetaAccessToken()}`;
  try {
    const response = await fetchWithRetry(url, { method: "GET" });
    const data = await response.json();
    if (data.error) {
      return { success: false, error: data.error.message || JSON.stringify(data.error) };
    }
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error" };
  }
}

// ─── Core Execution Functions ─────────────────────────────────────

// Zero-decimal currencies report whole-unit amounts already (no ×100 conversion).
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "BIF", "DJF", "GNF", "KMF", "PYG", "RWF", "UGX", "VUV", "XAF", "XOF", "XPF"]);

// Cache the ad account's currency divisor per request lifecycle to avoid an extra
// API call on every budget mutation. Keyed by ad account ID.
const currencyDivisorCache = new Map<string, number>();

async function getAccountCurrencyDivisor(adAccountId: string | undefined, accessToken: string | undefined): Promise<number> {
  if (!adAccountId) return 100; // legacy default (assumes a 2-decimal currency, e.g. INR/USD)
  if (currencyDivisorCache.has(adAccountId)) return currencyDivisorCache.get(adAccountId)!;

  const result = await metaApiGet(adAccountId, ["currency"], accessToken);
  const currency = result.success ? result.data?.currency : undefined;
  const divisor = currency && ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
  currencyDivisorCache.set(adAccountId, divisor);
  return divisor;
}

/**
 * Pause a campaign, adset, or ad.
 * Pre-flight check: if the entity is already PAUSED, skip the API call and log accordingly.
 */
async function pauseEntity(
  entityId: string,
  entityType: string,
  accessToken?: string
): Promise<{ success: boolean; data?: any; error?: string; alreadyPaused?: boolean; previousValue?: string }> {
  // Pre-flight: GET current status
  const statusResult = await metaApiGet(entityId, ["effective_status", "configured_status", "status"], accessToken);
  if (statusResult.success && statusResult.data) {
    const currentStatus =
      statusResult.data.effective_status ||
      statusResult.data.configured_status ||
      statusResult.data.status;

    if (currentStatus === "PAUSED") {
      console.log(
        `[meta-execution] Entity ${entityId} is already paused — skipping API call.`
      );
      return { success: true, data: statusResult.data, alreadyPaused: true, previousValue: "PAUSED" };
    }
  }

  const result = await metaApiPost(entityId, { status: "PAUSED" }, accessToken);
  return {
    ...result,
    alreadyPaused: false,
    previousValue: statusResult.success
      ? (statusResult.data?.effective_status || statusResult.data?.configured_status || statusResult.data?.status || "ACTIVE")
      : "ACTIVE",
  };
}

/**
 * Unpause (activate) a campaign, adset, or ad
 */
async function unpauseEntity(entityId: string, entityType: string, accessToken?: string): Promise<{ success: boolean; data?: any; error?: string }> {
  return metaApiPost(entityId, { status: "ACTIVE" }, accessToken);
}

/**
 * Get current daily budget for an adset or campaign, converted to the account's
 * major currency unit (e.g. rupees for INR, dollars for USD, yen for JPY).
 */
async function getCurrentBudget(entityId: string, accessToken?: string, adAccountId?: string): Promise<number | null> {
  const result = await metaApiGet(entityId, ["daily_budget", "lifetime_budget", "name"], accessToken);
  if (!result.success || !result.data) return null;
  if (!result.data.daily_budget) return null;
  const divisor = await getAccountCurrencyDivisor(adAccountId, accessToken);
  return parseInt(result.data.daily_budget) / divisor;
}

/**
 * Set daily budget for an adset or campaign.
 * Amount is in the account's major currency unit — converted to the account's
 * smallest unit (e.g. ×100 for INR/USD, ×1 for zero-decimal currencies like JPY).
 */
async function setBudget(entityId: string, amount: number, accessToken?: string, adAccountId?: string): Promise<{ success: boolean; data?: any; error?: string }> {
  const divisor = await getAccountCurrencyDivisor(adAccountId, accessToken);
  const amountMinorUnit = Math.round(amount * divisor);
  return metaApiPost(entityId, { daily_budget: amountMinorUnit }, accessToken);
}

// ─── Main Execution Handler ───────────────────────────────────────

export async function executeAction(req: ExecutionRequest): Promise<ExecutionResult> {
  const timestamp = new Date().toISOString();
  const baseResult = {
    action: req.action,
    entityId: req.entityId,
    entityName: req.entityName,
    entityType: req.entityType,
    clientId: req.clientId,
    timestamp,
    requestedBy: req.requestedBy,
    requestedByName: req.requestedByName,
    reason: req.params?.reason,
    strategicCall: req.strategicCall,
  };

  try {
    switch (req.action) {
      case "PAUSE_AD":
      case "PAUSE_ADSET":
      case "PAUSE_CAMPAIGN": {
        const result = await pauseEntity(req.entityId, req.entityType, req.accessToken);
        const execResult: ExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: result.previousValue || "ACTIVE",
          newValue: result.success ? (result.alreadyPaused ? "PAUSED (already)" : "PAUSED") : undefined,
          metaApiResponse: result.data,
          error: result.error,
        };
        // Only log to audit if we actually changed something (not already paused)
        if (!result.alreadyPaused) {
          logExecution(execResult);
        }
        return execResult;
      }

      case "UNPAUSE_AD":
      case "UNPAUSE_ADSET":
      case "UNPAUSE_CAMPAIGN": {
        const result = await unpauseEntity(req.entityId, req.entityType, req.accessToken);
        const execResult: ExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: "PAUSED",
          newValue: result.success ? "ACTIVE" : undefined,
          metaApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      case "SCALE_BUDGET_UP":
      case "SCALE_BUDGET_DOWN": {
        let currentAmount = await getCurrentBudget(req.entityId, req.accessToken, req.adAccountId);

        // Fallback: use passed currentBudget if API fetch failed
        if (currentAmount === null && req.params?.currentBudget) {
          console.log(`[meta-execution] API budget fetch failed for ${req.entityId}, using fallback: ₹${req.params.currentBudget}`);
          currentAmount = req.params.currentBudget;
        }

        if (currentAmount === null) {
          const execResult: ExecutionResult = {
            ...baseResult,
            success: false,
            error: "Could not read current budget (API returned null and no fallback provided)",
          };
          logExecution(execResult);
          return execResult;
        }

        const scalePct = req.params?.scalePercent || 20;
        const multiplier = req.action === "SCALE_BUDGET_UP"
          ? 1 + scalePct / 100
          : 1 - scalePct / 100;
        const newAmount = Math.round(currentAmount * multiplier);

        const result = await setBudget(req.entityId, newAmount, req.accessToken, req.adAccountId);
        const execResult: ExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: `₹${currentAmount}/day`,
          newValue: result.success ? `₹${newAmount}/day` : undefined,
          metaApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      case "SET_BUDGET": {
        const currentAmount = await getCurrentBudget(req.entityId, req.accessToken, req.adAccountId);
        const newAmount = req.params?.budgetAmount;

        if (!newAmount || newAmount <= 0) {
          const execResult: ExecutionResult = {
            ...baseResult,
            success: false,
            error: "Invalid budget amount",
          };
          logExecution(execResult);
          return execResult;
        }

        const result = await setBudget(req.entityId, newAmount, req.accessToken, req.adAccountId);
        const execResult: ExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: currentAmount ? `₹${currentAmount}/day` : "unknown",
          newValue: result.success ? `₹${newAmount}/day` : undefined,
          metaApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      default: {
        const execResult: ExecutionResult = {
          ...baseResult,
          success: false,
          error: `Unknown action: ${req.action}`,
        };
        logExecution(execResult);
        return execResult;
      }
    }
  } catch (err: any) {
    const execResult: ExecutionResult = {
      ...baseResult,
      success: false,
      error: err.message || "Unexpected error",
    };
    logExecution(execResult);
    return execResult;
  }
}

/**
 * Execute multiple actions in sequence (batch)
 */
export async function executeBatch(requests: ExecutionRequest[]): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  for (const req of requests) {
    const result = await executeAction(req);
    results.push(result);
    // Small delay between API calls to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return results;
}

/**
 * Get execution audit log
 */
export function getAuditLog(limit = 50, clientId?: string): AuditEntry[] {
  const log = readAuditLog();
  const filtered = clientId ? log.filter((e) => e.clientId === clientId) : log;
  return filtered.slice(0, limit);
}

/**
 * Get entity's current status from Meta API
 */
export async function getEntityStatus(entityId: string): Promise<{
  status?: string;
  daily_budget?: number;
  name?: string;
  error?: string;
}> {
  const isAdAccount = entityId.startsWith("act_");
  const fields = isAdAccount 
    ? ["account_status", "name"]
    : ["status", "configured_status", "effective_status", "daily_budget", "name"];

  const result = await metaApiGet(entityId, fields);
  if (!result.success) {
    return { error: result.error };
  }

  // account_status is numeric for Ad Accounts: 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, etc.
  // We map it to a string for consistency across the app.
  const accountStatusMap: Record<number, string> = {
    1: "ACTIVE",
    2: "DISABLED",
    3: "UNSETTLED",
    7: "PENDING_RISK_REVIEW",
    8: "PENDING_SETTLEMENT",
    9: "IN_GRACE_PERIOD",
    10: "PENDING_CLOSURE",
    11: "CLOSED",
    101: "CLOSED",
  };

  return {
    status: isAdAccount 
      ? accountStatusMap[result.data.account_status] || `UNKNOWN (${result.data.account_status})`
      : (result.data.effective_status || result.data.configured_status || result.data.status),
    daily_budget: result.data.daily_budget ? parseInt(result.data.daily_budget) / 100 : undefined,
    name: result.data.name,
  };
}
