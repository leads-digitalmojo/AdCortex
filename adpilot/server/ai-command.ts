/**
 * AI Command Engine — Mojo AdCortex Integration
 *
 * Flow:
 *   1. Receive natural language command from user
 *   2. Route through AdCortex 4-layer intelligence engine
 *   3. Map ranked recommendations to backward-compatible response
 *   4. Apply safety checks on the top action
 *   5. Execute actions via existing execution engines
 *   6. Log everything to database
 *
 * PRESERVED from v1: ActionPlan, ExecutionOutcome types, getCampaignMetrics(),
 * applyFilters(), runSafetyChecks(), executeActionPlan(), logExecutionToDb(),
 * updateCooldownLog(), sanitizeClientCredentials()
 */

import fs from "fs";
import path from "path";
import { executeAction, type ExecutionRequest, type ExecutionActionType } from "./meta-execution";
import { executeGoogleAction, type GoogleExecutionRequest, type GoogleExecutionActionType } from "./google-execution";
import { db } from "./db";
import { executionLogs, executionOutcomes } from "@shared/schema";
import { processQuery, type IntelligenceResult } from "./intelligence-engine";
import type { AdCortexRecommendation } from "./prompt-templates";
import { recordExecution, updateOutcomes, triggerOutcomeUpdate } from "./execution-learning";

// ─── Constants ────────────────────────────────────────────────────

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const COOLDOWN_LOG = path.join(DATA_BASE, "ai_command_cooldown.json");

function isPlaceholderSecret(value?: string): boolean {
  return !value || value.trim() === "" || value.trim().startsWith("YOUR_");
}

function sanitizeClientCredentials(credentials: { meta?: any; google?: any }) {
  const next: { meta?: any; google?: any } = {};

  if (
    credentials.meta?.accessToken &&
    credentials.meta?.adAccountId &&
    !isPlaceholderSecret(credentials.meta.accessToken) &&
    !isPlaceholderSecret(credentials.meta.adAccountId)
  ) {
    next.meta = credentials.meta;
  }

  if (
    credentials.google?.clientId &&
    credentials.google?.clientSecret &&
    credentials.google?.refreshToken &&
    !isPlaceholderSecret(credentials.google.clientId) &&
    !isPlaceholderSecret(credentials.google.clientSecret) &&
    !isPlaceholderSecret(credentials.google.refreshToken)
  ) {
    next.google = credentials.google;
  }

  return next;
}

// ─── Types (PRESERVED — backward compatible) ──────────────────────

export interface AICommandRequest {
  command: string;
  clientId: string;
  platform: "meta" | "google" | "all";
  analysisData: any;
  clientTargets?: { cpl?: number; budget?: number; leads?: number };
  provider?: "groq" | "gemini" | "claude" | "auto"; // kept for API compat, ignored internally
}

export interface AICommandResponse {
  humanResponse: string;
  actionJson: ActionPlan | null;
  executionResults: ExecutionOutcome[];
  safetyWarnings: string[];
  requiresConfirmation: boolean;
  terminalResponse?: IntelligenceResult["terminalResponse"];

  // New AdCortex fields (non-breaking additions)
  rankedRecommendations?: AdCortexRecommendation[];
  layerContributions?: Record<string, any>;
  conflicts?: string[];
}

interface ActionFilter {
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
  value: number;
  unit?: string;
}

interface ActionPlan {
  intent: string;
  platform: "meta" | "google" | "all";
  filters: ActionFilter[];
  action: {
    type: "pause" | "scale" | "adjust_budget" | "unpause" | "clarify";
    parameters: Record<string, any>;
  };
  execution_plan: string[];
  strategic_rationale: string;
  risk_checks: string[];
}

interface ExecutionOutcome {
  campaignId: string;
  campaignName: string;
  action: string;
  success: boolean;
  message: string;
  previousValue?: any;
  newValue?: any;
}

// ─── Campaign Filter Engine (PRESERVED) ───────────────────────────

function getCampaignMetrics(campaign: any): Record<string, number> {
  const spend = campaign.spend || campaign.cost || campaign.amount_spent || 0;
  const leads = campaign.leads || campaign.conversions || campaign.results || 0;
  const impressions = campaign.impressions || 0;
  const clicks = campaign.clicks || 0;

  const cpl = campaign.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
  const ctr = campaign.ctr ?? (impressions > 0 ? (clicks / impressions) * 100 : 0);
  const cvr = campaign.cvr ?? (clicks > 0 ? (leads / clicks) * 100 : 0);

  return { spend, leads, impressions, clicks, cpl, ctr, cvr };
}

function applyFilters(campaigns: any[], filters: ActionFilter[]): any[] {
  // Separate string-based filters (campaign_name, name, id, etc.) from numeric metric filters
  const stringFields = ["campaign_name", "name", "campaign_id", "id", "status", "classification"];

  return campaigns.filter((campaign) => {
    const metrics = getCampaignMetrics(campaign);
    return filters.every((filter) => {
      const metricKey = filter.metric.toLowerCase();

      // Handle string-based filters (campaign name, id, status)
      if (stringFields.includes(metricKey)) {
        const fieldValue = String(
          campaign[metricKey] || campaign.campaign_name || campaign.name || ""
        ).toLowerCase();
        const filterValue = String(filter.value).toLowerCase();
        const op = normalizeOperator(filter.operator);

        if (op === "==" || op === "===") return fieldValue === filterValue;
        if (op === "!=") return fieldValue !== filterValue;
        // Fuzzy: "contains" match for name-based filters
        if (op === "contains" || op === "includes") return fieldValue.includes(filterValue);
        // Default: exact or partial match for string fields
        return fieldValue === filterValue || fieldValue.includes(filterValue);
      }

      // Standard numeric metric filter
      const value = metrics[metricKey];
      if (value === undefined) return false;
      const op = normalizeOperator(filter.operator);
      switch (op) {
        case ">":  return value > filter.value;
        case "<":  return value < filter.value;
        case ">=": return value >= filter.value;
        case "<=": return value <= filter.value;
        case "==": return value === filter.value;
        case "!=": return value !== filter.value;
        default:   return false;
      }
    });
  });
}

/** Normalize operator variants that Claude might produce */
function normalizeOperator(op: string): string {
  const cleaned = op.trim();
  const map: Record<string, string> = {
    "greater_than": ">", "gt": ">", "above": ">",
    "less_than": "<", "lt": "<", "below": "<",
    "gte": ">=", "greater_than_or_equal": ">=",
    "lte": "<=", "less_than_or_equal": "<=",
    "equals": "==", "eq": "==", "equal": "==", "===": "==",
    "not_equals": "!=", "ne": "!=", "not_equal": "!=",
    "contains": "contains", "includes": "contains",
  };
  return map[cleaned.toLowerCase()] || cleaned;
}

/**
 * Fallback name matching — when filter-based matching fails, extract campaign
 * names from the recommendation text and match against the campaign pool.
 */
function fallbackNameMatch(
  campaigns: any[],
  recommendation: { action: string; reasoning: string; action_payload: any },
  actionPlan: { intent: string; strategic_rationale: string }
): any[] {
  // Collect all text that might contain campaign names
  const textSources = [
    recommendation.action,
    recommendation.reasoning,
    actionPlan.intent,
    actionPlan.strategic_rationale,
    JSON.stringify(recommendation.action_payload?.filters || []),
  ].join(" ");

  const matched: any[] = [];

  for (const campaign of campaigns) {
    const campName = (campaign.campaign_name || campaign.name || "").trim();
    const campId = (campaign.campaign_id || campaign.id || "").trim();

    if (!campName && !campId) continue;

    // Check if the campaign name appears in any recommendation text
    if (campName && textSources.includes(campName)) {
      matched.push(campaign);
      continue;
    }

    // Check campaign ID
    if (campId && textSources.includes(campId)) {
      matched.push(campaign);
      continue;
    }

    // Fuzzy: check if a significant portion of the campaign name (first 20+ chars) appears
    if (campName.length >= 15) {
      const nameSegment = campName.substring(0, Math.min(25, campName.length));
      if (textSources.toLowerCase().includes(nameSegment.toLowerCase())) {
        matched.push(campaign);
      }
    }
  }

  return matched;
}

// ─── Safety Checks (PRESERVED) ────────────────────────────────────

interface SafetyResult {
  safe: boolean;
  warnings: string[];
  skippedCampaigns: string[];
  approvedCampaigns: any[];
}

function runSafetyChecks(campaigns: any[], actionType: string): SafetyResult {
  const warnings: string[] = [];
  const skippedCampaigns: string[] = [];
  const approvedCampaigns: any[] = [];

  let cooldownLog: Record<string, number> = {};
  if (fs.existsSync(COOLDOWN_LOG)) {
    try { cooldownLog = JSON.parse(fs.readFileSync(COOLDOWN_LOG, "utf-8")); } catch {}
  }
  const cooldownHours = 4;
  const now = Date.now();

  for (const campaign of campaigns) {
    const metrics = getCampaignMetrics(campaign);
    const campaignId = campaign.campaign_id || campaign.id || "";
    const name = campaign.campaign_name || campaign.name || campaignId;
    let skip = false;

    if (metrics.leads < 3 && actionType !== "pause") {
      warnings.push(`"${name}" has < 3 conversions — insufficient data for ${actionType}. Skipped.`);
      skippedCampaigns.push(name);
      skip = true;
    }

    if (metrics.impressions < 50 && !skip) {
      warnings.push(`"${name}" may be in learning phase (${metrics.impressions} impressions). Skipped.`);
      skippedCampaigns.push(name);
      skip = true;
    }

    if (!skip && cooldownLog[campaignId]) {
      const hoursSinceLastAction = (now - cooldownLog[campaignId]) / (1000 * 60 * 60);
      if (hoursSinceLastAction < cooldownHours) {
        warnings.push(`"${name}" was actioned ${hoursSinceLastAction.toFixed(1)}h ago — cooldown active. Skipped.`);
        skippedCampaigns.push(name);
        skip = true;
      }
    }

    if (!skip) approvedCampaigns.push(campaign);
  }

  return { safe: approvedCampaigns.length > 0, warnings, skippedCampaigns, approvedCampaigns };
}

function updateCooldownLog(campaignIds: string[]) {
  let cooldownLog: Record<string, number> = {};
  if (fs.existsSync(COOLDOWN_LOG)) {
    try { cooldownLog = JSON.parse(fs.readFileSync(COOLDOWN_LOG, "utf-8")); } catch {}
  }
  const now = Date.now();
  for (const id of campaignIds) cooldownLog[id] = now;
  fs.writeFileSync(COOLDOWN_LOG, JSON.stringify(cooldownLog, null, 2));
}

async function logExecutionToDb(entry: {
  clientId: string;
  platform: string;
  intent: string;
  command: string;
  rationale: string;
  actionType: string;
  campaignIds: string[];
  successCount: number;
  failureCount: number;
  safetyWarnings: string;
  requestedBy: string;
  outcomes: Array<{ metric: string; preValue: number }>;
}) {
  const logId = (globalThis as any).crypto?.randomUUID?.() || require("crypto").randomUUID();

  await db.insert(executionLogs).values({
    id: logId,
    clientId: entry.clientId,
    platform: entry.platform,
    intent: entry.intent,
    command: entry.command,
    actionType: entry.actionType,
    campaignIds: entry.campaignIds,
    rationale: entry.rationale,
    safetyWarnings: entry.safetyWarnings,
    successCount: entry.successCount,
    failureCount: entry.failureCount,
    requestedBy: entry.requestedBy,
    createdAt: new Date(),
  });

  if (entry.outcomes.length > 0) {
    await db.insert(executionOutcomes).values(
      entry.outcomes.map((o) => ({
        id: ((globalThis as any).crypto?.randomUUID?.() || require("crypto").randomUUID()),
        logId,
        clientId: entry.clientId,
        metricType: o.metric,
        preValue: String(o.preValue),
        recordedAt: new Date(),
      }))
    );
  }

  console.log(`[AI Command] Logged execution ${logId} to database.`);
}

// ─── Execution Router (PRESERVED) ─────────────────────────────────

async function executeActionPlan(
  actionPlan: ActionPlan,
  campaigns: any[],
  analysisData: any,
  clientId: string,
  credentials: { meta?: any; google?: any }
): Promise<ExecutionOutcome[]> {
  const outcomes: ExecutionOutcome[] = [];
  const { action } = actionPlan;

  if (action.type === "clarify") return outcomes;

  for (const campaign of campaigns) {
    const campaignId = campaign.campaign_id || campaign.id || "";
    const campaignName = campaign.campaign_name || campaign.name || campaignId;
    const executionPlatform = actionPlan.platform === "all"
      ? (campaign._sourcePlatform === "google" ? "google" : "meta")
      : actionPlan.platform;

    try {
      if (executionPlatform === "meta") {
        let metaAction: ExecutionActionType = "PAUSE_CAMPAIGN";
        const params: ExecutionRequest["params"] = {
          reason: action.parameters?.reason || actionPlan.strategic_rationale,
          scalePercent: action.parameters?.scale_percent,
          currentBudget: campaign.daily_budget,
        };

        if (action.type === "pause") metaAction = "PAUSE_CAMPAIGN";
        else if (action.type === "unpause") metaAction = "UNPAUSE_CAMPAIGN";
        else if (action.type === "scale") metaAction = "SCALE_BUDGET_UP";
        else if (action.type === "adjust_budget") {
          metaAction = action.parameters?.direction === "down" ? "SCALE_BUDGET_DOWN" : "SCALE_BUDGET_UP";
        }

        const req: ExecutionRequest = {
          action: metaAction,
          entityId: campaignId,
          entityName: campaignName,
          entityType: "campaign",
          params,
          requestedBy: "agent",
        };

        const previousMetaAccessToken = process.env.META_ACCESS_TOKEN;
        const previousMetaAdAccountId = process.env.META_AD_ACCOUNT_ID;

        // Scalable Env Fallback Logic
        const CLIENT_META_CONFIG: Record<string, { accessToken: string; adAccountId: string } | null> = {
          "revasa-aura": {
            accessToken: process.env.META_REVASA_AURA_ACCESS_TOKEN || "",
            adAccountId: `act_${process.env.META_REVASA_AURA_AD_ACCOUNT_ID || ""}`
          }
        };

        try {
          if (credentials.meta?.accessToken) {
            process.env.META_ACCESS_TOKEN = credentials.meta.accessToken;
            process.env.META_AD_ACCOUNT_ID = credentials.meta.adAccountId;
          } else if (CLIENT_META_CONFIG[clientId] && CLIENT_META_CONFIG[clientId]?.accessToken) {
            process.env.META_ACCESS_TOKEN = CLIENT_META_CONFIG[clientId]!.accessToken;
            process.env.META_AD_ACCOUNT_ID = CLIENT_META_CONFIG[clientId]!.adAccountId;
          }

          const result = await executeAction(req);
          outcomes.push({
            campaignId,
            campaignName,
            action: metaAction,
            success: result.success,
            message: result.error || (result.success ? "Action completed" : "Action failed"),
            previousValue: result.previousValue,
            newValue: result.newValue,
          });

          // ─── Learning Engine Integration ──────────────────────────
          if (result.success) {
            try {
              recordExecution(
                `meta-${campaignId}-${Date.now()}`,
                clientId,
                "meta",
                campaignId,
                campaignName,
                "campaign",
                metaAction,
                action.parameters?.reason || actionPlan.strategic_rationale,
                analysisData,
                actionPlan.strategic_rationale,
                "AI Agent"
              );
            } catch (err: any) {
              console.warn(`[AI Command] Learning record failed: ${err.message}`);
            }
          }
        } finally {
          if (previousMetaAccessToken === undefined) delete process.env.META_ACCESS_TOKEN;
          else process.env.META_ACCESS_TOKEN = previousMetaAccessToken;

          if (previousMetaAdAccountId === undefined) delete process.env.META_AD_ACCOUNT_ID;
          else process.env.META_AD_ACCOUNT_ID = previousMetaAdAccountId;
        }

      } else if (executionPlatform === "google") {
        let googleAction: GoogleExecutionActionType = "PAUSE_CAMPAIGN";
        const params: GoogleExecutionRequest["params"] = {
          reason: action.parameters?.reason || actionPlan.strategic_rationale,
          scalePercent: action.parameters?.scale_percent,
          currentBudget: campaign.daily_budget,
        };

        if (action.type === "pause") googleAction = "PAUSE_CAMPAIGN";
        else if (action.type === "unpause") googleAction = "ENABLE_CAMPAIGN";
        else if (action.type === "scale") googleAction = "SCALE_BUDGET_UP";
        else if (action.type === "adjust_budget") {
          googleAction = action.parameters?.direction === "down" ? "SCALE_BUDGET_DOWN" : "SCALE_BUDGET_UP";
        }

        const req: GoogleExecutionRequest = {
          action: googleAction,
          entityId: campaignId,
          entityName: campaignName,
          entityType: "campaign",
          params,
          requestedBy: "agent",
        };

        const previousGoogleEnv = {
          GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
          GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
          GOOGLE_DEVELOPER_TOKEN: process.env.GOOGLE_DEVELOPER_TOKEN,
          GOOGLE_MCC_ID: process.env.GOOGLE_MCC_ID,
          GOOGLE_CUSTOMER_ID: process.env.GOOGLE_CUSTOMER_ID,
        };

        try {
          if (credentials.google?.clientId) {
            process.env.GOOGLE_CLIENT_ID = credentials.google.clientId;
            process.env.GOOGLE_CLIENT_SECRET = credentials.google.clientSecret;
            process.env.GOOGLE_REFRESH_TOKEN = credentials.google.refreshToken;
            process.env.GOOGLE_DEVELOPER_TOKEN = credentials.google.developerToken;
            process.env.GOOGLE_MCC_ID = credentials.google.mccId;
            process.env.GOOGLE_CUSTOMER_ID = credentials.google.customerId;
          }

          const result = await executeGoogleAction(req);
          outcomes.push({
            campaignId,
            campaignName,
            action: googleAction,
            success: result.success,
            message: result.error || (result.success ? "Action completed" : "Action failed"),
            previousValue: result.previousValue,
            newValue: result.newValue,
          });

          // ─── Learning Engine Integration ──────────────────────────
          if (result.success) {
            try {
              recordExecution(
                `google-${campaignId}-${Date.now()}`,
                clientId,
                "google",
                campaignId,
                campaignName,
                "campaign",
                googleAction,
                action.parameters?.reason || actionPlan.strategic_rationale,
                analysisData,
                actionPlan.strategic_rationale,
                "AI Agent"
              );
            } catch (err: any) {
              console.warn(`[AI Command] Learning record failed: ${err.message}`);
            }
          }
        } finally {
          for (const [key, value] of Object.entries(previousGoogleEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    } catch (err: any) {
      outcomes.push({
        campaignId,
        campaignName,
        action: action.type,
        success: false,
        message: `Error: ${err.message}`,
      });
    }
  }

  return outcomes;
}

// ─── AdCortex → ActionPlan Mapper ─────────────────────────────────

function mapRecommendationToActionPlan(rec: AdCortexRecommendation, platform: string): ActionPlan | null {
  const payload = rec.action_payload;
  if (!payload?.action) return null;

  const actionType = payload.action.type;
  if (!["pause", "scale", "adjust_budget", "unpause", "clarify"].includes(actionType)) {
    return null;
  }

  return {
    intent: payload.intent || rec.action,
    platform: (payload.platform || platform) as ActionPlan["platform"],
    filters: (payload.filters || []).map((f: any) => ({
      metric: f.metric || "",
      operator: f.operator || ">",
      value: f.value || 0,
      unit: f.unit,
    })),
    action: {
      type: actionType as ActionPlan["action"]["type"],
      parameters: payload.action.parameters || {},
    },
    execution_plan: payload.execution_plan || [],
    strategic_rationale: payload.strategic_rationale || rec.reasoning,
    risk_checks: payload.risk_checks || [],
  };
}

// ─── Main Handler (REFACTORED) ────────────────────────────────────

export async function handleAICommand(req: AICommandRequest): Promise<AICommandResponse> {
  const { command, clientId, platform, analysisData, clientTargets } = req;
  
  // ─── 0. Update learning outcomes before processing ────────────────
  try {
    const updatedCount = triggerOutcomeUpdate(analysisData);
    if (updatedCount > 0) {
      console.log(`[AI Command] Automatically updated ${updatedCount} historical learning outcomes using fresh analysis.`);
    }
  } catch (err: any) {
    console.warn(`[AI Command] Learning sync skipped: ${err.message}`);
  }

  console.log(`[AI Command] Processing via AdCortex: "${command.substring(0, 80)}..." | client=${clientId} platform=${platform}`);

  // ─── 1. Run through AdCortex intelligence engine ───────────────
  let result: IntelligenceResult;
  try {
    result = await processQuery({
      type: "command",
      clientId,
      platform,
      message: command,
      analysisData,
    });
  } catch (err: any) {
    console.error("[AI Command] AdCortex error:", err.message);
    return {
      humanResponse: `AI service error: ${err.message}. Please check your ANTHROPIC_API_KEY in the environment variables.`,
      actionJson: null,
      executionResults: [],
      safetyWarnings: [],
      requiresConfirmation: false,
    };
  }

  // ─── 2. Map AdCortex response to backward-compatible format ────
  const primaryRec = result.recommendations[0];
  const actionJson = primaryRec ? mapRecommendationToActionPlan(primaryRec, platform) : null;

  // Safety warnings from high-risk recommendations
  const safetyWarnings: string[] = result.recommendations
    .filter((r) => r.risk_level === "high")
    .map((r) => `⚠️ High-risk: ${r.reasoning.substring(0, 120)}`);

  // Requires confirmation if any recommendation says "confirm"
  const requiresConfirmation = result.recommendations.some(
    (r) => r.execution_type === "confirm"
  );

  if (!actionJson || actionJson.action.type === "clarify") {
    return {
      humanResponse: result.humanResponse,
      actionJson,
      executionResults: [],
      safetyWarnings,
      requiresConfirmation: false,
      terminalResponse: result.terminalResponse,
      // AdCortex additions
      rankedRecommendations: result.recommendations,
      layerContributions: result.layer_contributions,
      conflicts: result.conflicts,
    };
  }

  // ─── 3. Apply filters to find matching campaigns (ENHANCED) ─────
  const campaigns: any[] = analysisData?.campaign_audit || analysisData?.campaign_performance || analysisData?.campaigns || [];
  let matchedCampaigns = campaigns;

  console.log(`[AI Command] Campaign pool: ${campaigns.length} campaigns. Filters: ${JSON.stringify(actionJson.filters)}`);

  if (actionJson.filters && actionJson.filters.length > 0) {
    matchedCampaigns = applyFilters(campaigns, actionJson.filters);
    console.log(`[AI Command] Filter-matched: ${matchedCampaigns.length}/${campaigns.length} campaigns`);
  }

  // Fallback: If filters returned 0 matches, try to match by campaign name from recommendation
  if (matchedCampaigns.length === 0 && primaryRec) {
    console.log(`[AI Command] Filter match failed. Attempting name-based fallback...`);
    matchedCampaigns = fallbackNameMatch(campaigns, primaryRec, actionJson);
    if (matchedCampaigns.length > 0) {
      console.log(`[AI Command] Name fallback matched: ${matchedCampaigns.length} campaigns`);
    }
  }

  // Last resort: If still 0 matches but we have a valid action intent, apply to all campaigns
  // matching just the numeric metric filters (ignore name/string filters)  
  if (matchedCampaigns.length === 0 && actionJson.filters && actionJson.filters.length > 0) {
    const numericOnly = actionJson.filters.filter(
      (f) => !["campaign_name", "name", "campaign_id", "id", "status", "classification"].includes(f.metric.toLowerCase())
    );
    if (numericOnly.length > 0 && numericOnly.length < actionJson.filters.length) {
      console.log(`[AI Command] Retrying with ${numericOnly.length} numeric-only filters (dropped string filters)`);
      matchedCampaigns = applyFilters(campaigns, numericOnly);
    }
  }

  if (matchedCampaigns.length === 0) {
    return {
      humanResponse: result.humanResponse + "\n\n⚠️ No campaigns matched the specified criteria. No actions were taken.",
      actionJson,
      executionResults: [],
      safetyWarnings: [...safetyWarnings, "No campaigns matched the filters — nothing to execute."],
      requiresConfirmation: false,
      terminalResponse: result.terminalResponse,
      rankedRecommendations: result.recommendations,
      layerContributions: result.layer_contributions,
      conflicts: result.conflicts,
    };
  }

  // ─── 4. Safety checks (PRESERVED) ─────────────────────────────
  const safety = runSafetyChecks(matchedCampaigns, actionJson.action.type);
  const allWarnings = [...safetyWarnings, ...safety.warnings];

  // Confirmation for large budget increases
  const budgetConfirmNeeded =
    actionJson.action.type === "scale" &&
    (actionJson.action.parameters?.scale_percent || 0) > 50;

  if (requiresConfirmation || budgetConfirmNeeded) {
    const pct = actionJson.action.parameters?.scale_percent || "large";
    allWarnings.push(`Budget increase of ${pct}% requires explicit confirmation.`);
    return {
      humanResponse: result.humanResponse + `\n\n⚠️ This action requires your confirmation because it involves a ${budgetConfirmNeeded ? "large budget change" : "high-risk action"}. Please confirm to proceed.`,
      actionJson,
      executionResults: [],
      safetyWarnings: allWarnings,
      requiresConfirmation: true,
      terminalResponse: result.terminalResponse,
      rankedRecommendations: result.recommendations,
      layerContributions: result.layer_contributions,
      conflicts: result.conflicts,
    };
  }

  if (!safety.safe) {
    return {
      humanResponse: result.humanResponse + "\n\n⚠️ All matched campaigns were blocked by safety checks. No actions taken.",
      actionJson,
      executionResults: [],
      safetyWarnings: allWarnings,
      requiresConfirmation: false,
      terminalResponse: result.terminalResponse,
      rankedRecommendations: result.recommendations,
      layerContributions: result.layer_contributions,
      conflicts: result.conflicts,
    };
  }

  // ─── 5. Execute actions (PRESERVED) ────────────────────────────
  let credentials: { meta?: any; google?: any } = {};
  const credFile = path.join(DATA_BASE, "clients_credentials.json");
  if (fs.existsSync(credFile)) {
    try {
      const allCreds: any[] = JSON.parse(fs.readFileSync(credFile, "utf-8"));
      const clientCreds = allCreds.find((c: any) => c.clientId === clientId);
      if (clientCreds) credentials = sanitizeClientCredentials(clientCreds);
    } catch {}
  }

  const executionResults = await executeActionPlan(
    actionJson,
    safety.approvedCampaigns,
    analysisData,
    clientId,
    credentials
  );

  // Update cooldown log
  const actionedIds = safety.approvedCampaigns.map((c: any) => c.id || c.campaign_id || "").filter(Boolean);
  if (actionedIds.length > 0) updateCooldownLog(actionedIds);

  // Log to DB
  await logExecutionToDb({
    clientId,
    platform,
    intent: actionJson.intent,
    command,
    rationale: actionJson.strategic_rationale,
    actionType: actionJson.action.type,
    campaignIds: actionedIds,
    successCount: executionResults.filter((r) => r.success).length,
    failureCount: executionResults.filter((r) => !r.success).length,
    safetyWarnings: allWarnings.join(" | "),
    requestedBy: "mojo-adcortex",
    outcomes: safety.approvedCampaigns.map((c: any) => {
      const m = getCampaignMetrics(c);
      return { metric: "cpl", preValue: m.cpl };
    }),
  });

  return {
    humanResponse: result.humanResponse,
    actionJson,
    executionResults,
    safetyWarnings: allWarnings,
    requiresConfirmation: false,
    terminalResponse: result.terminalResponse,
    // AdCortex additions
    rankedRecommendations: result.recommendations,
    layerContributions: result.layer_contributions,
    conflicts: result.conflicts,
  };
}
