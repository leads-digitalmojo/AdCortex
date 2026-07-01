/**
 * Google Ads API Execution Engine
 *
 * REAL Google Ads REST API integration (v21).
 * Ported from the working Python implementation in ads_agent/google_ads_api.py.
 *
 * Capabilities:
 * - Pause / Enable campaigns, ad groups, ads
 * - Set campaign budget (in rupees → micros)
 * - Scale budget up/down by percentage
 * - Set CPC bid at ad-group level
 * - Query entity status via GAQL
 *
 * Authentication: OAuth2 refresh-token flow with disk-based token cache.
 * All actions are logged to an audit trail for accountability.
 */

import fs from "fs";
import path from "path";

// ─── Configuration ────────────────────────────────────────────────
const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const AUDIT_LOG_PATH = path.join(DATA_BASE, "google_execution_audit_log.json");
const CREDS_FILE = path.resolve(import.meta.dirname, "../../ads_agent/google_ads_credentials.json");
const TOKEN_CACHE_FILE = path.resolve(import.meta.dirname, "../../ads_agent/.google_ads_token_cache.json");

const API_VERSION = "v21";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function normalizeGoogleAccountId(value?: string | null): string {
  return String(value ?? "").replace(/\D/g, "");
}

function getGoogleCustomerId(): string {
  return normalizeGoogleAccountId(process.env.GOOGLE_CUSTOMER_ID) || "3120813693";
}

function getGoogleLoginCustomerId(): string {
  return normalizeGoogleAccountId(process.env.GOOGLE_MCC_ID);
}

// Rate-limit: minimum delay between batch calls (ms)
const BATCH_DELAY_MS = 300;

// ─── Types ────────────────────────────────────────────────────────

export type GoogleExecutionActionType =
  | "PAUSE_CAMPAIGN"
  | "ENABLE_CAMPAIGN"
  | "PAUSE_AD_GROUP"
  | "ENABLE_AD_GROUP"
  | "PAUSE_AD"
  | "ENABLE_AD"
  | "SET_CAMPAIGN_BUDGET"
  | "SCALE_BUDGET_UP"
  | "SCALE_BUDGET_DOWN"
  | "SET_CPC_BID";

export interface GoogleExecutionRequest {
  action: GoogleExecutionActionType;
  entityId: string;
  entityName: string;
  entityType: "campaign" | "ad_group" | "ad";
  params?: {
    budgetAmount?: number;    // daily budget in rupees
    currentBudget?: number;   // fallback current daily budget in rupees
    scalePercent?: number;    // e.g. 20 = 20% increase
    cpcBidMicros?: number;   // CPC bid in micros
    reason?: string;
    playbookRef?: string;
    recommendationId?: string;
  };
  requestedBy: "user" | "agent" | "auto";
  requestedByName?: string;
  strategicCall?: string;
}

export interface GoogleExecutionResult {
  success: boolean;
  action: GoogleExecutionActionType;
  entityId: string;
  entityName: string;
  entityType: string;
  previousValue?: string;
  newValue?: string;
  googleApiResponse?: any;
  error?: string;
  timestamp: string;
  requestedBy: string;
  requestedByName?: string;
  reason?: string;
  strategicCall?: string;
  platform: "google";
}

interface AuditEntry extends GoogleExecutionResult {
  id: string;
}

interface Credentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  developer_token: string;
  login_customer_id?: string;
}

interface TokenCache {
  access_token: string;
  expires_at: number; // epoch seconds
}

// ─── Credentials & OAuth ─────────────────────────────────────────

function loadCredentials(): Credentials {
  const envCreds: Partial<Credentials> = {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    developer_token: process.env.GOOGLE_DEVELOPER_TOKEN,
    login_customer_id: normalizeGoogleAccountId(process.env.GOOGLE_MCC_ID),
  };

  const envComplete = Boolean(
    envCreds.client_id &&
    envCreds.client_secret &&
    envCreds.refresh_token &&
    envCreds.developer_token
  );

  const fileExists = fs.existsSync(CREDS_FILE);
  const fileCreds = fileExists ? JSON.parse(fs.readFileSync(CREDS_FILE, "utf-8")) as Partial<Credentials> : {};
  if (fileCreds.login_customer_id !== undefined) {
    fileCreds.login_customer_id = normalizeGoogleAccountId(fileCreds.login_customer_id);
  }
  const fileComplete = ["client_id","client_secret","refresh_token","developer_token"].every(
    (k) => (fileCreds as any)[k] && !(String((fileCreds as any)[k]).startsWith("YOUR_"))
  );

  if (envComplete) {
    return {
      ...(envCreds as Credentials),
      login_customer_id: envCreds.login_customer_id || "",
    };
  }

  if (fileComplete) {
    return {
      ...(fileCreds as Credentials),
      login_customer_id: fileCreds.login_customer_id || "",
    };
  }

  const missing = [];
  if (!envCreds.client_id) missing.push("GOOGLE_CLIENT_ID");
  if (!envCreds.client_secret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!envCreds.refresh_token) missing.push("GOOGLE_REFRESH_TOKEN");
  if (!envCreds.developer_token) missing.push("GOOGLE_DEVELOPER_TOKEN");

  throw new Error(
    `Google Ads credentials not configured. Either fill ${CREDS_FILE} or set env vars: ${missing.join(", ")}.`
  );
}

/**
 * Get a valid OAuth2 access token. Uses disk-based cache; refreshes when
 * the cached token is within 60 s of expiry (same logic as the Python impl).
 */
async function getAccessToken(creds: Credentials): Promise<string> {
  // Check cache
  if (fs.existsSync(TOKEN_CACHE_FILE)) {
    try {
      const cache: TokenCache = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, "utf-8"));
      const nowSec = Date.now() / 1000;
      if (cache.expires_at > nowSec + 60) {
        return cache.access_token;
      }
    } catch {
      // cache corrupt — fall through to refresh
    }
  }

  // Refresh the token
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token refresh failed: ${resp.status} - ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const accessToken: string = data.access_token;
  const expiresIn: number = data.expires_in ?? 3600;

  // Persist to disk
  const cache: TokenCache = {
    access_token: accessToken,
    expires_at: Date.now() / 1000 + expiresIn,
  };
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2));

  return accessToken;
}

/**
 * Build the standard header set required by every Google Ads REST call.
 */
async function buildHeaders(customerId: string = getGoogleCustomerId()): Promise<Record<string, string>> {
  const creds = loadCredentials();
  const token = await getAccessToken(creds);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": creds.developer_token,
    "Content-Type": "application/json",
  };
  const loginCustomerId = normalizeGoogleAccountId(creds.login_customer_id || getGoogleLoginCustomerId());
  if (loginCustomerId && loginCustomerId !== normalizeGoogleAccountId(customerId)) {
    headers["login-customer-id"] = loginCustomerId;
  }
  return headers;
}

// ─── Google Ads REST helpers ─────────────────────────────────────

/**
 * Parse a Google Ads API error response into a human-readable string.
 */
function parseGoogleAdsError(body: any): string {
  try {
    const details = body?.error?.details ?? [];
    const msgs: string[] = [];
    for (const detail of details) {
      for (const err of detail?.errors ?? []) {
        const code = JSON.stringify(err?.errorCode ?? {});
        msgs.push(`[${code}] ${err?.message ?? "unknown"}`);
      }
    }
    if (msgs.length) return msgs.join("; ");
    if (body?.error?.message) return body.error.message;
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return JSON.stringify(body).slice(0, 500);
  }
}

// ──── Mutate: Campaigns ──────────────────────────────────────────

async function mutateCampaignStatus(
  campaignId: string,
  status: "ENABLED" | "PAUSED"
): Promise<{ success: boolean; data?: any; error?: string }> {
  const customerId = getGoogleCustomerId();
  const headers = await buildHeaders(customerId);
  const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

  const resp = await fetch(
    `${BASE_URL}/customers/${customerId}/campaigns:mutate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [
          {
            update: {
              resourceName,
              status,
            },
            updateMask: "status",
          },
        ],
      }),
    }
  );

  const body = await resp.json();
  if (!resp.ok) {
    return { success: false, error: `Mutate failed (${resp.status}): ${parseGoogleAdsError(body)}` };
  }
  return { success: true, data: body };
}

// ──── Mutate: Ad Groups ──────────────────────────────────────────

async function mutateAdGroupStatus(
  adGroupId: string,
  status: "ENABLED" | "PAUSED"
): Promise<{ success: boolean; data?: any; error?: string }> {
  const customerId = getGoogleCustomerId();
  const headers = await buildHeaders(customerId);
  const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;

  const resp = await fetch(
    `${BASE_URL}/customers/${customerId}/adGroups:mutate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [
          {
            update: {
              resourceName,
              status,
            },
            updateMask: "status",
          },
        ],
      }),
    }
  );

  const body = await resp.json();
  if (!resp.ok) {
    return { success: false, error: `Mutate failed (${resp.status}): ${parseGoogleAdsError(body)}` };
  }
  return { success: true, data: body };
}

// ──── Mutate: Ads (adGroupAds) ───────────────────────────────────

async function mutateAdStatus(
  adGroupAdId: string,
  status: "ENABLED" | "PAUSED"
): Promise<{ success: boolean; data?: any; error?: string }> {
  // adGroupAdId is expected as "adGroupId~adId"
  const customerId = getGoogleCustomerId();
  const headers = await buildHeaders(customerId);
  const resourceName = `customers/${customerId}/adGroupAds/${adGroupAdId}`;

  const resp = await fetch(
    `${BASE_URL}/customers/${customerId}/adGroupAds:mutate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [
          {
            update: {
              resourceName,
              status,
            },
            updateMask: "status",
          },
        ],
      }),
    }
  );

  const body = await resp.json();
  if (!resp.ok) {
    return { success: false, error: `Mutate failed (${resp.status}): ${parseGoogleAdsError(body)}` };
  }
  return { success: true, data: body };
}

// ──── Mutate: CPC Bid on Ad Group ────────────────────────────────

async function mutateAdGroupCpcBid(
  adGroupId: string,
  cpcBidMicros: number
): Promise<{ success: boolean; data?: any; error?: string }> {
  const customerId = getGoogleCustomerId();
  const headers = await buildHeaders(customerId);
  const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;

  const resp = await fetch(
    `${BASE_URL}/customers/${customerId}/adGroups:mutate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [
          {
            update: {
              resourceName,
              cpcBidMicros: String(cpcBidMicros),
            },
            updateMask: "cpc_bid_micros",
          },
        ],
      }),
    }
  );

  const body = await resp.json();
  if (!resp.ok) {
    return { success: false, error: `Mutate failed (${resp.status}): ${parseGoogleAdsError(body)}` };
  }
  return { success: true, data: body };
}

// ──── Mutate: Campaign Budget ────────────────────────────────────

async function mutateCampaignBudget(
  budgetResourceName: string,
  newAmountMicros: number
): Promise<{ success: boolean; data?: any; error?: string }> {
  const customerId = getGoogleCustomerId();
  const headers = await buildHeaders(customerId);

  const resp = await fetch(
    `${BASE_URL}/customers/${customerId}/campaignBudgets:mutate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [
          {
            update: {
              resourceName: budgetResourceName,
              amountMicros: String(newAmountMicros),
            },
            updateMask: "amount_micros",
          },
        ],
      }),
    }
  );

  const body = await resp.json();
  if (!resp.ok) {
    return { success: false, error: `Budget update failed (${resp.status}): ${parseGoogleAdsError(body)}` };
  }
  return { success: true, data: body };
}

// ──── GAQL Query ─────────────────────────────────────────────────

async function gaqlSearch(query: string): Promise<any[]> {
  const customerId = getGoogleCustomerId();
  const headers = await buildHeaders(customerId);
  const allResults: any[] = [];
  let nextPageToken: string | undefined;

  do {
    const payload: Record<string, any> = { query: query.trim() };
    if (nextPageToken) payload.pageToken = nextPageToken;

    const resp = await fetch(
      `${BASE_URL}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }
    );

    const body = await resp.json();
    if (!resp.ok) {
      throw new Error(`GAQL query failed (${resp.status}): ${parseGoogleAdsError(body)}`);
    }

    allResults.push(...(body.results ?? []));
    nextPageToken = body.nextPageToken;
  } while (nextPageToken);

  return allResults;
}

// ──── Look up budget resource name for a campaign ────────────────

async function getCampaignBudgetInfo(
  campaignId: string
): Promise<{ budgetResourceName: string; currentMicros: number }> {
  const query = `
    SELECT campaign.id, campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id = ${campaignId}
    LIMIT 1
  `;
  const rows = await gaqlSearch(query);
  if (!rows.length) {
    throw new Error(`Campaign ${campaignId} not found`);
  }
  const row = rows[0];
  return {
    budgetResourceName: row.campaignBudget?.resourceName ?? row.campaign_budget?.resource_name,
    currentMicros: Number(row.campaignBudget?.amountMicros ?? row.campaign_budget?.amount_micros ?? 0),
  };
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

function logExecution(result: GoogleExecutionResult): AuditEntry {
  const entry: AuditEntry = {
    ...result,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  };
  const log = readAuditLog();
  log.unshift(entry);
  if (log.length > 500) log.length = 500;
  writeAuditLog(log);
  return entry;
}

export function appendGoogleAuditEntry(result: GoogleExecutionResult): AuditEntry {
  return logExecution(result);
}

// ─── Status dispatch helper ──────────────────────────────────────

async function setEntityStatus(
  entityId: string,
  entityType: string,
  status: "ENABLED" | "PAUSED"
): Promise<{ success: boolean; data?: any; error?: string }> {
  switch (entityType) {
    case "campaign":
      return mutateCampaignStatus(entityId, status);
    case "ad_group":
      return mutateAdGroupStatus(entityId, status);
    case "ad":
      return mutateAdStatus(entityId, status);
    default:
      return { success: false, error: `Unsupported entity type: ${entityType}` };
  }
}

// ─── Main Execution Handler ───────────────────────────────────────

export async function executeGoogleAction(req: GoogleExecutionRequest): Promise<GoogleExecutionResult> {
  const timestamp = new Date().toISOString();
  const baseResult = {
    action: req.action,
    entityId: req.entityId,
    entityName: req.entityName,
    entityType: req.entityType,
    timestamp,
    requestedBy: req.requestedBy,
    requestedByName: req.requestedByName,
    reason: req.params?.reason,
    strategicCall: req.strategicCall,
    platform: "google" as const,
  };

  try {
    switch (req.action) {
      // ── Pause entities ─────────────────────────────────────
      case "PAUSE_CAMPAIGN":
      case "PAUSE_AD_GROUP":
      case "PAUSE_AD": {
        const result = await setEntityStatus(req.entityId, req.entityType, "PAUSED");
        const execResult: GoogleExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: "ENABLED",
          newValue: result.success ? "PAUSED" : undefined,
          googleApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      // ── Enable entities ────────────────────────────────────
      case "ENABLE_CAMPAIGN":
      case "ENABLE_AD_GROUP":
      case "ENABLE_AD": {
        const result = await setEntityStatus(req.entityId, req.entityType, "ENABLED");
        const execResult: GoogleExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: "PAUSED",
          newValue: result.success ? "ENABLED" : undefined,
          googleApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      // ── Set campaign budget (rupees → micros) ──────────────
      case "SET_CAMPAIGN_BUDGET": {
        const budgetRupees = req.params?.budgetAmount;
        if (!budgetRupees || budgetRupees <= 0) {
          const execResult: GoogleExecutionResult = {
            ...baseResult,
            success: false,
            error: "Invalid budget amount",
          };
          logExecution(execResult);
          return execResult;
        }

        // Look up the budget resource name for this campaign
        const budgetInfo = await getCampaignBudgetInfo(req.entityId);
        const previousMicros = budgetInfo.currentMicros;
        const newMicros = budgetRupees * 1_000_000;

        const result = await mutateCampaignBudget(budgetInfo.budgetResourceName, newMicros);
        const execResult: GoogleExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: `₹${(previousMicros / 1_000_000).toFixed(2)}/day`,
          newValue: result.success ? `₹${budgetRupees}/day` : undefined,
          googleApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      // ── Scale budget up / down ─────────────────────────────
      case "SCALE_BUDGET_UP":
      case "SCALE_BUDGET_DOWN": {
        const scalePct = req.params?.scalePercent || 20;
        const direction = req.action === "SCALE_BUDGET_UP" ? "up" : "down";

        // Fetch current budget
        let currentMicros: number;
        let budgetResourceName: string;

        try {
          const budgetInfo = await getCampaignBudgetInfo(req.entityId);
          currentMicros = budgetInfo.currentMicros;
          budgetResourceName = budgetInfo.budgetResourceName;
        } catch (err) {
          if (req.params?.currentBudget) {
            console.log(`[google-execution] GAQL budget fetch failed for ${req.entityId}, using fallback: ₹${req.params.currentBudget}`);
            currentMicros = req.params.currentBudget * 1_000_000;
            // Best guess for resource name as fallback if we don't have it
            budgetResourceName = `customers/${getGoogleCustomerId()}/campaignBudgets/${req.entityId}`;
          } else {
            throw err;
          }
        }

        const factor = direction === "up" ? 1 + scalePct / 100 : 1 - scalePct / 100;
        const newMicros = Math.round(currentMicros * factor);

        if (newMicros <= 0) {
          const execResult: GoogleExecutionResult = {
            ...baseResult,
            success: false,
            error: `Scaling ${direction} ${scalePct}% would result in ₹0 or negative budget`,
          };
          logExecution(execResult);
          return execResult;
        }

        const result = await mutateCampaignBudget(budgetResourceName, newMicros);
        const previousRupees = (currentMicros / 1_000_000).toFixed(2);
        const newRupees = (newMicros / 1_000_000).toFixed(2);

        const execResult: GoogleExecutionResult = {
          ...baseResult,
          success: result.success,
          previousValue: `₹${previousRupees}/day`,
          newValue: result.success
            ? `₹${newRupees}/day (${direction} ${scalePct}%)`
            : undefined,
          googleApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      // ── Set CPC bid at ad-group level ──────────────────────
      case "SET_CPC_BID": {
        const cpcMicros = req.params?.cpcBidMicros;
        if (!cpcMicros || cpcMicros <= 0) {
          const execResult: GoogleExecutionResult = {
            ...baseResult,
            success: false,
            error: "Invalid CPC bid amount",
          };
          logExecution(execResult);
          return execResult;
        }
        const result = await mutateAdGroupCpcBid(req.entityId, cpcMicros);
        const execResult: GoogleExecutionResult = {
          ...baseResult,
          success: result.success,
          newValue: `₹${(cpcMicros / 1_000_000).toFixed(2)} CPC`,
          googleApiResponse: result.data,
          error: result.error,
        };
        logExecution(execResult);
        return execResult;
      }

      // ── Unknown action ─────────────────────────────────────
      default: {
        const execResult: GoogleExecutionResult = {
          ...baseResult,
          success: false,
          error: `Unknown action: ${req.action}`,
        };
        logExecution(execResult);
        return execResult;
      }
    }
  } catch (err: any) {
    const execResult: GoogleExecutionResult = {
      ...baseResult,
      success: false,
      error: err.message || "Unexpected error",
    };
    logExecution(execResult);
    return execResult;
  }
}

// ─── Batch Execution ──────────────────────────────────────────────

/**
 * Execute multiple actions in sequence with a 300 ms rate-limit delay.
 */
export async function executeGoogleBatch(
  requests: GoogleExecutionRequest[]
): Promise<GoogleExecutionResult[]> {
  const results: GoogleExecutionResult[] = [];
  for (const req of requests) {
    const result = await executeGoogleAction(req);
    results.push(result);
    // Rate-limit: wait between calls
    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
  }
  return results;
}

// ─── Audit Log accessor ──────────────────────────────────────────

/**
 * Get Google execution audit log (most recent first).
 */
export function getGoogleAuditLog(limit = 50): AuditEntry[] {
  const log = readAuditLog();
  return log.slice(0, limit);
}

// ─── Entity Status Query ─────────────────────────────────────────

/**
 * Fetch the current live status (and budget if applicable) of a Google Ads
 * entity directly from the API via GAQL.
 *
 * Returns a plain object with the relevant fields.
 */
export async function getGoogleEntityStatus(
  entityId: string,
  entityType: "campaign" | "ad_group" | "ad"
): Promise<{
  entityId: string;
  entityType: string;
  status?: string;
  budgetMicros?: number;
  budgetRupees?: number;
  cpcBidMicros?: number;
  name?: string;
  raw?: any;
  error?: string;
}> {
  try {
    let query: string;
    switch (entityType) {
      case "campaign":
        query = `
          SELECT campaign.id, campaign.name, campaign.status,
                 campaign_budget.amount_micros
          FROM campaign
          WHERE campaign.id = ${entityId}
          LIMIT 1`;
        break;
      case "ad_group":
        query = `
          SELECT ad_group.id, ad_group.name, ad_group.status,
                 ad_group.cpc_bid_micros
          FROM ad_group
          WHERE ad_group.id = ${entityId}
          LIMIT 1`;
        break;
      case "ad":
        query = `
          SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status
          FROM ad_group_ad
          WHERE ad_group_ad.ad.id = ${entityId}
          LIMIT 1`;
        break;
      default:
        return { entityId, entityType, error: `Unsupported entity type: ${entityType}` };
    }

    const rows = await gaqlSearch(query);
    if (!rows.length) {
      return { entityId, entityType, error: `Entity not found` };
    }

    const row = rows[0];

    if (entityType === "campaign") {
      const micros = Number(row.campaignBudget?.amountMicros ?? 0);
      return {
        entityId,
        entityType,
        name: row.campaign?.name,
        status: row.campaign?.status,
        budgetMicros: micros,
        budgetRupees: micros / 1_000_000,
        raw: row,
      };
    }

    if (entityType === "ad_group") {
      const cpc = Number(row.adGroup?.cpcBidMicros ?? 0);
      return {
        entityId,
        entityType,
        name: row.adGroup?.name,
        status: row.adGroup?.status,
        cpcBidMicros: cpc,
        raw: row,
      };
    }

    // ad
    return {
      entityId,
      entityType,
      name: row.adGroupAd?.ad?.name,
      status: row.adGroupAd?.status,
      raw: row,
    };
  } catch (err: any) {
    return { entityId, entityType, error: err.message || "Failed to query entity status" };
  }
}
