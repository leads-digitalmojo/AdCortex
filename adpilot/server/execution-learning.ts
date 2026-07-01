/**
 * Execution Learning Engine
 *
 * Tracks the outcomes of executed actions (pause, scale, etc.) by capturing
 * "before" metrics at execution time and "after" metrics on subsequent checks.
 * Determines whether each action had a POSITIVE, NEGATIVE, or NEUTRAL outcome.
 *
 * Storage: /home/user/workspace/ads_agent/data/execution_learning.json
 */

import fs from "fs";
import path from "path";

// ─── Configuration ────────────────────────────────────────────────

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const LEARNING_PATH = path.join(DATA_BASE, "execution_learning.json");
const META_LEARNING_HISTORY_PATH = path.join(DATA_BASE, "learning_history.json");
const GOOGLE_LEARNING_HISTORY_PATH = path.join(DATA_BASE, "google_learning_history.json");

// ─── Types ────────────────────────────────────────────────────────

export interface LearningEntry {
  executionId: string;
  clientId?: string;
  platform?: "meta" | "google";
  entityId: string;
  entityName: string;
  entityType: string;
  action: string;
  executedAt: string;
  requestedByName?: string;
  reason?: string;
  strategicCall?: string;
  beforeMetrics: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    impressions: number;
  };
  afterMetrics?: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    impressions: number;
    measuredAt: string;
  };
  outcome?: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "PENDING";
  outcomeReason?: string;
  daysElapsed?: number;
}

interface StrategicLearningInput {
  id: string;
  executionId: string;
  clientId: string;
  platform: "meta" | "google";
  entityId: string;
  entityName: string;
  entityType: string;
  action: string;
  requestedByName?: string;
  reason?: string;
  strategicCall?: string;
  recordedAt: string;
  source: "user_strategy";
}

export interface LearningSummary {
  totalActions: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  pendingCount: number;
  positiveRate: number;
  patterns: string[];
}

// ─── Storage ──────────────────────────────────────────────────────

function readLearningData(): LearningEntry[] {
  if (!fs.existsSync(LEARNING_PATH)) return [];
  try {
    const raw = fs.readFileSync(LEARNING_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLearningData(entries: LearningEntry[]): void {
  const dir = path.dirname(LEARNING_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEARNING_PATH, JSON.stringify(entries, null, 2));
}

function readAgentLearningHistory(platform: "meta" | "google"): any {
  const targetPath = platform === "google" ? GOOGLE_LEARNING_HISTORY_PATH : META_LEARNING_HISTORY_PATH;
  if (!fs.existsSync(targetPath)) {
    return platform === "google"
      ? { runs: [], patterns: [], actions: [], strategic_inputs: [] }
      : { runs: [], patterns: [], fatigue_timelines: {}, audience_saturation: {}, strategic_inputs: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
  } catch {
    return platform === "google"
      ? { runs: [], patterns: [], actions: [], strategic_inputs: [] }
      : { runs: [], patterns: [], fatigue_timelines: {}, audience_saturation: {}, strategic_inputs: [] };
  }
}

function writeAgentLearningHistory(platform: "meta" | "google", payload: any): void {
  const targetPath = platform === "google" ? GOOGLE_LEARNING_HISTORY_PATH : META_LEARNING_HISTORY_PATH;
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));
}

function appendStrategicInputToAgentHistory(entry: LearningEntry): void {
  if (!entry.clientId || !entry.platform) return;
  if (!entry.reason && !entry.strategicCall) return;

  const learningHistory = readAgentLearningHistory(entry.platform);
  const strategicInputs: StrategicLearningInput[] = Array.isArray(learningHistory.strategic_inputs)
    ? learningHistory.strategic_inputs
    : [];

  strategicInputs.unshift({
    id: `${entry.executionId}:strategy`,
    executionId: entry.executionId,
    clientId: entry.clientId,
    platform: entry.platform,
    entityId: entry.entityId,
    entityName: entry.entityName,
    entityType: entry.entityType,
    action: entry.action,
    requestedByName: entry.requestedByName,
    reason: entry.reason,
    strategicCall: entry.strategicCall,
    recordedAt: entry.executedAt,
    source: "user_strategy",
  });

  learningHistory.strategic_inputs = strategicInputs.slice(0, 250);
  writeAgentLearningHistory(entry.platform, learningHistory);
}

// ─── Helpers ──────────────────────────────────────────────────────

function findEntityMetrics(
  analysisData: any,
  entityId: string,
  entityType: string
): { spend: number; leads: number; cpl: number; ctr: number; impressions: number } | null {
  if (!analysisData) return null;

  if (entityType === "campaign") {
    const match = (analysisData.campaign_audit || analysisData.campaign_analysis || []).find(
      (c: any) => c.campaign_id === entityId || c.id === entityId
    );
    if (match) {
      return {
        spend: match.spend || 0,
        leads: match.leads || match.conversions || 0,
        cpl: match.cpl || 0,
        ctr: match.ctr || 0,
        impressions: match.impressions || 0,
      };
    }
  }

  if (entityType === "adset") {
    const match = (analysisData.adset_analysis || []).find(
      (a: any) => a.adset_id === entityId
    );
    if (match) {
      return {
        spend: match.spend || 0,
        leads: match.leads || 0,
        cpl: match.cpl || 0,
        ctr: match.ctr || 0,
        impressions: match.impressions || 0,
      };
    }
  }

  // Google ad_groups: search inside campaigns' ad_groups arrays
  if (entityType === "ad_group" || entityType === "adset") {
    const campaigns = analysisData.campaign_audit || analysisData.campaign_analysis || [];
    for (const campaign of campaigns) {
      const adGroups = campaign.ad_groups || [];
      const match = adGroups.find(
        (ag: any) => ag.ad_group_id === entityId || ag.id === entityId
      );
      if (match) {
        return {
          spend: match.spend || 0,
          leads: match.leads || match.conversions || 0,
          cpl: match.cpl || 0,
          ctr: match.ctr || 0,
          impressions: match.impressions || 0,
        };
      }
    }
    // Also check top-level ad_group_analysis array
    const adGroupAnalysis = analysisData.ad_group_analysis || [];
    const agMatch = adGroupAnalysis.find(
      (ag: any) => ag.ad_group_id === entityId || ag.id === entityId
    );
    if (agMatch) {
      return {
        spend: agMatch.spend || 0,
        leads: agMatch.leads || agMatch.conversions || 0,
        cpl: agMatch.cpl || 0,
        ctr: agMatch.ctr || 0,
        impressions: agMatch.impressions || 0,
      };
    }
  }

  if (entityType === "ad") {
    const match = (analysisData.creative_health || analysisData.ad_analysis || []).find(
      (a: any) => a.ad_id === entityId || a.id === entityId
    );
    if (match) {
      return {
        spend: match.spend || 0,
        leads: match.leads || match.conversions || 0,
        cpl: match.cpl || 0,
        ctr: match.ctr || 0,
        impressions: match.impressions || 0,
      };
    }
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Record an execution with "before" metrics captured from current analysis data.
 * Called when an action is successfully executed.
 * Optionally accepts a strategicCall parameter (user's strategic rationale).
 */
export function recordExecution(
  executionId: string,
  clientId: string,
  platform: "meta" | "google",
  entityId: string,
  entityName: string,
  entityType: string,
  action: string,
  reason: string | undefined,
  analysisData: any,
  strategicCall?: string,
  requestedByName?: string
): LearningEntry {
  const beforeMetrics = findEntityMetrics(analysisData, entityId, entityType) || {
    spend: 0,
    leads: 0,
    cpl: 0,
    ctr: 0,
    impressions: 0,
  };

  const entry: LearningEntry = {
    executionId,
    clientId,
    platform,
    entityId,
    entityName,
    entityType,
    action,
    executedAt: new Date().toISOString(),
    requestedByName,
    reason,
    strategicCall,
    beforeMetrics,
    outcome: "PENDING",
    daysElapsed: 0,
  };

  const entries = readLearningData();
  entries.unshift(entry);
  // Keep last 1000 entries
  if (entries.length > 1000) entries.length = 1000;
  writeLearningData(entries);
  appendStrategicInputToAgentHistory(entry);

  return entry;
}

/**
 * Update outcomes for pending entries using fresh analysis data.
 * Called on each agent run or periodically.
 *
 * For PAUSE actions: compares account-level CPL before vs after ONLY if the paused
 * entity was responsible for >5% of account spend. Otherwise, classifies based on
 * whether overall CPL improved.
 */
export function updateOutcomes(analysisData: any): void {
  const entries = readLearningData();
  if (entries.length === 0) return;

  const now = new Date();
  const accountCpl = analysisData?.account_pulse?.overall_cpl || 0;
  const accountSpend = analysisData?.account_pulse?.total_spend || 0;
  const cplTarget = analysisData?.dynamic_thresholds?.cpl_target || 0;
  const cplCritical = analysisData?.dynamic_thresholds?.cpl_critical || 0;
  let updated = false;

  for (const entry of entries) {
    if (entry.outcome !== "PENDING") continue;

    const execDate = new Date(entry.executedAt);
    const daysElapsed = Math.floor(
      (now.getTime() - execDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    entry.daysElapsed = daysElapsed;

    if (daysElapsed < 3) continue; // Too soon

    // Capture after metrics
    const afterMetrics = findEntityMetrics(
      analysisData,
      entry.entityId,
      entry.entityType
    );
    if (afterMetrics) {
      entry.afterMetrics = {
        ...afterMetrics,
        measuredAt: now.toISOString(),
      };
    }

    const before = entry.beforeMetrics;
    const action = entry.action;

    if (action.startsWith("PAUSE")) {
      // Determine if the paused entity was responsible for >5% of account spend
      const entitySpendShare = (accountSpend > 0 && before.spend > 0)
        ? (before.spend / accountSpend) * 100
        : 0;

      if (entitySpendShare > 5 && before.cpl > 0 && accountCpl > 0) {
        // Entity was significant — compare account CPL before vs after directly
        const changePct = ((accountCpl - before.cpl) / before.cpl) * 100;
        if (changePct < -5) {
          entry.outcome = "POSITIVE";
          entry.outcomeReason = `Account CPL improved ${Math.abs(changePct).toFixed(0)}% after pause (entity had ${entitySpendShare.toFixed(1)}% of spend)`;
        } else if (changePct > 10) {
          entry.outcome = "NEGATIVE";
          entry.outcomeReason = `Account CPL worsened ${changePct.toFixed(0)}% after pause (entity had ${entitySpendShare.toFixed(1)}% of spend)`;
        } else {
          entry.outcome = "NEUTRAL";
          entry.outcomeReason = `No significant CPL change after pause (entity had ${entitySpendShare.toFixed(1)}% of spend)`;
        }
      } else if (accountCpl > 0 && cplTarget > 0) {
        // Entity was minor (<= 5% spend) — classify based on whether overall CPL improved
        if (accountCpl <= cplTarget) {
          entry.outcome = "POSITIVE";
          entry.outcomeReason = `Overall CPL ₹${accountCpl.toFixed(0)} within target ₹${cplTarget.toFixed(0)} after pause`;
        } else if (accountCpl > cplCritical && cplCritical > 0) {
          entry.outcome = "NEGATIVE";
          entry.outcomeReason = `Overall CPL ₹${accountCpl.toFixed(0)} still above critical ₹${cplCritical.toFixed(0)} after pause`;
        } else {
          entry.outcome = "NEUTRAL";
          entry.outcomeReason = "Overall CPL did not significantly change after pause";
        }
      } else {
        entry.outcome = "NEUTRAL";
        entry.outcomeReason = "Insufficient data for comparison";
      }
    } else if (action.includes("SCALE")) {
      if (afterMetrics) {
        if (
          afterMetrics.leads > before.leads &&
          (afterMetrics.cpl <= cplTarget || afterMetrics.cpl === 0)
        ) {
          entry.outcome = "POSITIVE";
          entry.outcomeReason = `Leads increased (${before.leads}->${afterMetrics.leads}) with CPL within target`;
        } else if (afterMetrics.cpl > cplCritical && cplCritical > 0) {
          entry.outcome = "NEGATIVE";
          entry.outcomeReason = `CPL exceeded critical threshold after scaling (₹${afterMetrics.cpl.toFixed(0)})`;
        } else {
          entry.outcome = "NEUTRAL";
          entry.outcomeReason = "No significant improvement after scaling";
        }
      } else {
        entry.outcome = "NEUTRAL";
        entry.outcomeReason = "Entity no longer in active data";
      }
    } else if (action.includes("UNPAUSE") || action.includes("ENABLE")) {
      if (afterMetrics) {
        if (afterMetrics.leads > 0 && afterMetrics.cpl <= cplTarget && cplTarget > 0) {
          entry.outcome = "POSITIVE";
          entry.outcomeReason = `Entity producing leads at CPL ₹${afterMetrics.cpl.toFixed(0)} after reactivation`;
        } else if (afterMetrics.cpl > cplCritical && cplCritical > 0) {
          entry.outcome = "NEGATIVE";
          entry.outcomeReason = `Entity CPL ₹${afterMetrics.cpl.toFixed(0)} exceeds critical after reactivation`;
        } else {
          entry.outcome = "NEUTRAL";
          entry.outcomeReason = "No significant change after reactivation";
        }
      } else {
        entry.outcome = "NEUTRAL";
        entry.outcomeReason = "Entity no longer in active data";
      }
    } else if (daysElapsed >= 7) {
      entry.outcome = "NEUTRAL";
      entry.outcomeReason = "Unable to determine outcome for this action type";
    }

    updated = true;
  }

  if (updated) {
    writeLearningData(entries);
  }
}

/**
 * Trigger an outcome update and return the count of entries that were updated.
 * Can be called from a route handler to force a re-evaluation.
 */
export function triggerOutcomeUpdate(analysisData: any): number {
  const entriesBefore = readLearningData();
  const pendingBefore = entriesBefore.filter((e) => e.outcome === "PENDING").length;

  updateOutcomes(analysisData);

  const entriesAfter = readLearningData();
  const pendingAfter = entriesAfter.filter((e) => e.outcome === "PENDING").length;

  return pendingBefore - pendingAfter;
}

/**
 * Get all learning entries.
 */
export function getLearningData(): LearningEntry[] {
  return readLearningData();
}

/**
 * Get aggregate summary of learning outcomes.
 * Returns format matching frontend LearningSummary interface.
 */
export function getLearningSummary(): any {
  const entries = readLearningData();
  const total = entries.length;
  const positive = entries.filter((e) => e.outcome === "POSITIVE").length;
  const negative = entries.filter((e) => e.outcome === "NEGATIVE").length;
  const neutral = entries.filter((e) => e.outcome === "NEUTRAL").length;
  const pending = entries.filter((e) => e.outcome === "PENDING").length;

  const patterns: string[] = [];

  // Compute pattern insights
  const pauseEntries = entries.filter((e) => e.action.startsWith("PAUSE") && e.outcome);
  const pausePositive = pauseEntries.filter((e) => e.outcome === "POSITIVE").length;
  if (pauseEntries.length >= 3) {
    const rate = ((pausePositive / pauseEntries.length) * 100).toFixed(0);
    patterns.push(
      `Pausing underperformers had positive outcomes ${rate}% of the time (${pausePositive}/${pauseEntries.length})`
    );
  }

  const scaleEntries = entries.filter((e) => e.action.includes("SCALE") && e.outcome);
  const scalePositive = scaleEntries.filter((e) => e.outcome === "POSITIVE").length;
  if (scaleEntries.length >= 3) {
    const rate = ((scalePositive / scaleEntries.length) * 100).toFixed(0);
    patterns.push(
      `Budget scaling on winners had positive outcomes ${rate}% of the time (${scalePositive}/${scaleEntries.length})`
    );
  }

  // Build byAction breakdown
  const byAction: Record<string, { total: number; positive: number; negative: number; neutral: number; pending: number }> = {};
  for (const entry of entries) {
    if (!byAction[entry.action]) {
      byAction[entry.action] = { total: 0, positive: 0, negative: 0, neutral: 0, pending: 0 };
    }
    byAction[entry.action].total++;
    if (entry.outcome === "POSITIVE") byAction[entry.action].positive++;
    else if (entry.outcome === "NEGATIVE") byAction[entry.action].negative++;
    else if (entry.outcome === "NEUTRAL") byAction[entry.action].neutral++;
    else byAction[entry.action].pending++;
  }

  return {
    totalEntries: total,
    outcomes: {
      POSITIVE: positive,
      NEGATIVE: negative,
      NEUTRAL: neutral,
      PENDING: pending,
    },
    byAction,
    patterns,
    // Keep backward compat fields
    totalActions: total,
    positiveCount: positive,
    negativeCount: negative,
    neutralCount: neutral,
    pendingCount: pending,
    positiveRate: total > 0 ? positive / total : 0,
  };
}
