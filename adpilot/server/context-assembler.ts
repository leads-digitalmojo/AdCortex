/**
 * Context Assembler — Mojo AdCortex Layer Builder
 *
 * Aggregates context from 4 distinct intelligence layers:
 *   Layer 1: SOP Rules, Client Targets, Scoring Configuration
 *   Layer 2: Analysis Data, Platform Context, Account Insights
 *   Layer 3: Execution Learning History, Patterns, Success Rates
 *   Layer 4: Strategic Inputs, Override History, User Decisions
 *
 * Design principles:
 *  - NEVER throws — missing data → empty structures
 *  - Parallelizes I/O where possible (Promise.all)
 *  - Reuses existing data access functions
 */

import fs from "fs";
import path from "path";
import { loadAnalysisSnapshot } from "./analysis-persistence";
import { getLearningData, type LearningEntry } from "./execution-learning";

// ─── Constants ────────────────────────────────────────────────────

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const REGISTRY_FILE = path.join(DATA_BASE, "clients_registry.json");
const AI_CONFIG_FILE = path.join(DATA_BASE, "ai_config.json");
const META_LEARNING_HISTORY = path.join(DATA_BASE, "learning_history.json");
const GOOGLE_LEARNING_HISTORY = path.join(DATA_BASE, "google_learning_history.json");
const COOLDOWN_LOG = path.join(DATA_BASE, "ai_command_cooldown.json");
const RECOMMENDATION_ACTIONS_DIR = path.join(DATA_BASE, "recommendation_actions");

// ─── Types ────────────────────────────────────────────────────────

export type QueryType =
  | "command"          // Terminal command (e.g. "pause losers")
  | "strategic_analysis"  // Deep strategic analysis
  | "recommendation"   // Generate recommendations
  | "insight"           // Quick insight questions

export interface AssembledContext {
  layer1: {
    sopRules: SopRules;
    clientTargets: ClientTargets;
    scoringConfig: ScoringConfig;
  };
  layer2: {
    analysisData: any;
    intellect_insights: IntellectInsights;
    platformContext: PlatformContext;
    alertRelatedEntities?: string[];
  };
  layer3: {
    recentActions: LearningEntry[];
    patterns: string[];
    successRates: SuccessRates;
  };
  layer4: {
    strategicInputs: StrategicInput[];
    overrideHistory: OverrideEntry[];
  };
}

interface SopRules {
  minConversionsBeforeAction: number;
  minImpressionsLearning: number;
  maxBudgetIncreaseWithoutConfirm: number;
  cooldownHours: number;
  defaultScalePercent: number;
  activeCooldowns: Record<string, number>;
}

interface ClientTargets {
  cpl?: number;
  budget?: number;
  leads?: number;
  cpm_max?: number;
  svs_low?: number;
  svs_high?: number;
  cpsv_low?: number;
  cpsv_high?: number;
  positive_lead_target?: number;
}

interface ScoringConfig {
  cpl_target?: number;
  cpl_critical?: number;
  ctr_benchmark?: number;
  health_weights?: Record<string, number>;
}

interface IntellectInsights {
  healthScore?: number;
  overallCpl?: number;
  totalSpend?: number;
  totalLeads?: number;
  campaignCount?: number;
  winnerCount?: number;
  loserCount?: number;
  alertCount?: number;
}

interface PlatformContext {
  platform: string;
  daysElapsed?: number;
  daysRemaining?: number;
  cadence?: string;
}

interface SuccessRates {
  totalActions: number;
  positiveRate: number;
  pauseSuccessRate: number;
  scaleSuccessRate: number;
  byAction: Record<string, { total: number; positive: number; negative: number }>;
}

interface StrategicInput {
  action: string;
  entityName: string;
  reason?: string;
  strategicCall?: string;
  recordedAt: string;
}

interface OverrideEntry {
  recommendationId: string;
  action: "approved" | "rejected" | "deferred";
  strategicCall: string;
  timestamp: string;
}

// ─── Safe File Readers ────────────────────────────────────────────

function safeReadJson(filepath: string, fallback: any = {}): any {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, "utf-8"));
    }
  } catch {}
  return fallback;
}

// ─── Layer Builders ───────────────────────────────────────────────

function buildLayer1(clientConfig: any, platform: string): AssembledContext["layer1"] {
  // Client targets — platform-specific only; do NOT fall back to the other platform's
  // targets (Meta CPL ≠ Google CPL — mixing them produces identical, meaningless alerts)
  const targets = clientConfig?.targets?.[platform] || {};
  const clientTargets: ClientTargets = {
    cpl: targets.cpl,
    budget: targets.budget,
    leads: targets.leads,
    cpm_max: targets.cpm_max,
    svs_low: targets.svs?.low,
    svs_high: targets.svs?.high,
    cpsv_low: targets.cpsv?.low,
    cpsv_high: targets.cpsv?.high,
    positive_lead_target: targets.positive_lead_target,
  };

  // Cooldown log
  const cooldownLog = safeReadJson(COOLDOWN_LOG, {});

  // SOP Rules — hardcoded operational rules from the existing system
  const sopRules: SopRules = {
    minConversionsBeforeAction: 3,
    minImpressionsLearning: 50,
    maxBudgetIncreaseWithoutConfirm: 50,
    cooldownHours: 4,
    defaultScalePercent: 25,
    activeCooldowns: cooldownLog,
  };

  // AI config for scoring
  const aiConfig = safeReadJson(AI_CONFIG_FILE, {});

  const scoringConfig: ScoringConfig = {
    cpl_target: targets.cpl,
    cpl_critical: targets.cpl ? targets.cpl * 1.5 : undefined,
    ctr_benchmark: aiConfig.ctr_benchmark || 1.0,
    health_weights: aiConfig.health_weights,
  };

  return { sopRules, clientTargets, scoringConfig };
}

async function buildLayer2(
  clientId: string,
  platform: string,
  analysisDataOverride?: any
): Promise<AssembledContext["layer2"]> {
  // Use provided analysis data, or load from snapshot
  let analysisData = analysisDataOverride;
  if (!analysisData) {
    try {
      analysisData = await loadAnalysisSnapshot(clientId, platform);
    } catch {}
  }
  analysisData = analysisData || {};

  // Extract high-level insights
  const ap = analysisData.account_pulse || {};
  const campaigns = analysisData.campaign_audit || analysisData.campaigns || [];

  const intellect_insights: IntellectInsights = {
    healthScore: ap.health_score,
    overallCpl: ap.overall_cpl || ap.avg_cpl,
    totalSpend: ap.total_spend || ap.total_spend_30d,
    totalLeads: ap.total_leads || ap.total_leads_30d,
    campaignCount: campaigns.length,
    winnerCount: campaigns.filter((c: any) => c.classification === "WINNER").length,
    loserCount: campaigns.filter((c: any) => c.classification === "UNDERPERFORMER").length,
    alertCount: (analysisData.alerts || []).length,
  };

  // Month pacing
  const mp = analysisData.monthly_pacing || {};
  const platformContext: PlatformContext = {
    platform,
    daysElapsed: mp.days_elapsed,
    daysRemaining: mp.days_remaining,
    cadence: analysisData.cadence,
  };

  return { analysisData, intellect_insights, platformContext };
}

function buildLayer3(platform: string): AssembledContext["layer3"] {
  // Filter learning data to this platform so Google doesn't see Meta action outcomes
  // and vice versa — cross-platform patterns are meaningless and cause duplicate alerts
  const allEntries = getLearningData();
  const platformEntries = allEntries.filter((e) => !e.platform || e.platform === platform);
  const recentActions = platformEntries.slice(0, 50);

  // Compute patterns from platform-filtered entries
  const patterns: string[] = [];
  const pauseEntries = platformEntries.filter((e) => e.action.startsWith("PAUSE") && e.outcome !== "PENDING");
  const pausePositive = pauseEntries.filter((e) => e.outcome === "POSITIVE").length;
  if (pauseEntries.length >= 3) {
    const rate = ((pausePositive / pauseEntries.length) * 100).toFixed(0);
    patterns.push(`Pausing underperformers had positive outcomes ${rate}% of the time (${pausePositive}/${pauseEntries.length}) on ${platform}`);
  }

  const scaleEntries = platformEntries.filter((e) => e.action.includes("SCALE") && e.outcome !== "PENDING");
  const scalePositive = scaleEntries.filter((e) => e.outcome === "POSITIVE").length;
  if (scaleEntries.length >= 3) {
    const rate = ((scalePositive / scaleEntries.length) * 100).toFixed(0);
    patterns.push(`Scaling winners succeeded ${rate}% of the time on ${platform}`);
  }

  // Compute per-action success rates
  const byAction: SuccessRates["byAction"] = {};
  for (const entry of platformEntries) {
    const a = entry.action;
    if (!byAction[a]) byAction[a] = { total: 0, positive: 0, negative: 0 };
    byAction[a].total++;
    if (entry.outcome === "POSITIVE") byAction[a].positive++;
    if (entry.outcome === "NEGATIVE") byAction[a].negative++;
  }

  const pauseSuccessRate = pauseEntries.length > 0 ? pausePositive / pauseEntries.length : 0;
  const scaleSuccessRate = scaleEntries.length > 0 ? scalePositive / scaleEntries.length : 0;
  const positiveTotal = platformEntries.filter((e) => e.outcome === "POSITIVE").length;

  const successRates: SuccessRates = {
    totalActions: platformEntries.length,
    positiveRate: platformEntries.length > 0 ? positiveTotal / platformEntries.length : 0,
    pauseSuccessRate,
    scaleSuccessRate,
    byAction,
  };

  return { recentActions, patterns, successRates };
}

function buildLayer4(platform: string): AssembledContext["layer4"] {
  // Agent learning history — strategic inputs from user decisions
  const historyPath = platform === "google" ? GOOGLE_LEARNING_HISTORY : META_LEARNING_HISTORY;
  const agentHistory = safeReadJson(historyPath, { strategic_inputs: [] });
  const rawInputs: any[] = Array.isArray(agentHistory.strategic_inputs) ? agentHistory.strategic_inputs : [];

  const strategicInputs: StrategicInput[] = rawInputs.slice(0, 30).map((si: any) => ({
    action: si.action || "",
    entityName: si.entityName || "",
    reason: si.reason,
    strategicCall: si.strategicCall,
    recordedAt: si.recordedAt || "",
  }));

  // Recommendation override history
  const overrideHistory: OverrideEntry[] = [];
  try {
    if (fs.existsSync(RECOMMENDATION_ACTIONS_DIR)) {
      const files = fs.readdirSync(RECOMMENDATION_ACTIONS_DIR).slice(0, 20);
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(RECOMMENDATION_ACTIONS_DIR, file), "utf-8"));
          if (data.action && data.strategic_call) {
            overrideHistory.push({
              recommendationId: data.id || file.replace(".json", ""),
              action: data.action,
              strategicCall: data.strategic_call,
              timestamp: data.timestamp || "",
            });
          }
        } catch {}
      }
    }
  } catch {}

  return { strategicInputs, overrideHistory };
}

// ─── Main Export ───────────────────────────────────────────────────

/**
 * Assemble full 4-layer context for an AI query.
 * Never throws — returns empty structures on missing data.
 */
export async function assembleContext(
  clientId: string,
  platform: string,
  queryType: QueryType,
  analysisDataOverride?: any
): Promise<AssembledContext> {
  // Load client config from registry
  let clientConfig: any = null;
  try {
    const registry: any[] = safeReadJson(REGISTRY_FILE, []);
    clientConfig = registry.find((c: any) => c.id === clientId) || {};
  } catch {
    clientConfig = {};
  }

  // Parallelize I/O-heavy layers
  const [layer2] = await Promise.all([
    buildLayer2(clientId, platform, analysisDataOverride),
  ]);

  // Layer 1 and 3-4 are sync or very fast
  const layer1 = buildLayer1(clientConfig, platform);
  const layer3 = buildLayer3(platform);
  const layer4 = buildLayer4(platform);

  return { layer1, layer2, layer3, layer4 };
}
