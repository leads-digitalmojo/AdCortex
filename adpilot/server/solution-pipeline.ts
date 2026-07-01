import type { AssembledContext } from "./context-assembler";
import type { LearningEntry } from "./execution-learning";
import type { AdCortexRecommendation } from "./prompt-templates";
import type { DetectedProblem, SeverityTier } from "./problem-detector";
import { generateSolutionTiers } from "./solution-tiers";
import { callClaude } from "./claude-provider";

export type ExecutionClassification = "AUTO-EXECUTE" | "MANUAL" | "REJECT";

export interface LayerAnalysisBlock {
  title: string;
  action: string;
  confidence: number;
  reasoning: string;
  data?: string[];
}

export interface SolutionOption {
  classification: ExecutionClassification;
  title: string;
  rationale: string;
  steps: string[];
  risk: "Low" | "Medium" | "High";
  confidence: number;
  expectedOutcome: string;
  actionPayload?: AdCortexRecommendation["action_payload"];
}

export interface TieredSolutions {
  primary: SolutionOption;
  secondary: SolutionOption[];
  rejection: SolutionOption[];
}

export interface RecommendationCard {
  id: string;
  severity: SeverityTier;
  platform: "meta" | "google";
  entity: {
    id?: string;
    name: string;
    type: string;
    score: number;
    classification: string;
  };
  diagnosis: {
    symptom: string;
    problem: string;
    data: string[];
    rootCauseChain: string[];
  };
  layerAnalysis: {
    l1: LayerAnalysisBlock;
    l2: LayerAnalysisBlock;
    l3: LayerAnalysisBlock;
    l4: LayerAnalysisBlock;
    conflicts: string[];
  };
  solutions: SolutionOption[];
  tieredSolutions: TieredSolutions;
  expectedOutcome: string;
  modelUsed?: "opus" | "sonnet";
}

function toActionKeyword(title: string): "pause" | "scale" | "budget" | "creative" | "landing" | "clarify" {
  const text = title.toLowerCase();
  if (text.includes("pause")) return "pause";
  if (text.includes("scale")) return "scale";
  if (text.includes("budget")) return "budget";
  if (text.includes("creative")) return "creative";
  if (text.includes("landing") || text.includes("form") || text.includes("audit")) return "landing";
  return "clarify";
}

function getExecutionAction(
  intent: "pause" | "unpause" | "scale_up" | "scale_down" | "set_budget",
  entityType: string,
  platform: string
): string {
  const isGoogle = platform === "google";
  
  if (intent === "pause") {
    if (entityType === "campaign") return "PAUSE_CAMPAIGN";
    if (entityType === "adset" || entityType.includes("ad_group")) return isGoogle ? "PAUSE_AD_GROUP" : "PAUSE_ADSET";
    return "PAUSE_AD";
  }
  
  if (intent === "unpause") {
    if (entityType === "campaign") return isGoogle ? "ENABLE_CAMPAIGN" : "UNPAUSE_CAMPAIGN";
    if (entityType === "adset" || entityType.includes("ad_group")) return isGoogle ? "ENABLE_AD_GROUP" : "UNPAUSE_ADSET";
    return isGoogle ? "ENABLE_AD" : "UNPAUSE_AD";
  }
  
  if (intent === "scale_up") return "SCALE_BUDGET_UP";
  if (intent === "scale_down") return "SCALE_BUDGET_DOWN";
  if (intent === "set_budget") return isGoogle ? "SET_CAMPAIGN_BUDGET" : "SET_BUDGET";
  
  return String(intent).toUpperCase();
}

function buildEntityFilter(problem: DetectedProblem) {
  const id = problem.entity.id;
  const name = problem.entity.name;
  const metric = problem.entity.type === "campaign" ? "campaign_id" : "name";
  const value = id && problem.entity.type === "campaign" ? id : name;

  return value
    ? [{ metric, operator: "==", value }]
    : [];
}

function buildSopDraft(problem: DetectedProblem, ctx: AssembledContext): LayerAnalysisBlock & {
  ruleId: string;
  execution: ExecutionClassification;
  actionPayload?: AdCortexRecommendation["action_payload"];
} {
  const targetCpl = Number(ctx.layer1.clientTargets?.cpl || 0);
  const raw = problem.entity.raw || {};
  const cvr = Number(raw.cvr || raw.overall_cvr || 0);

  if (problem.triggers.includes("zero_lead_budget_drain") || problem.triggers.includes("zero_lead_heavy_spend")) {
    const isDrain = problem.triggers.includes("zero_lead_budget_drain");
    return {
      ruleId: isDrain ? "zero_lead_pause" : "heavy_spend_no_leads_pause",
      title: "L1 (SOP)",
      action: `Pause ${problem.entity.type} immediately`,
      confidence: 95,
      reasoning: isDrain 
        ? "Document rule match: zero leads plus spend above 3x target CPL maps to an immediate pause draft action."
        : "Critical performance breach: entity has spent significantly with zero lead contribution. Pause recommended to prevent further drain.",
      execution: "AUTO-EXECUTE",
      actionPayload: {
        intent: `Pause ${problem.entity.name} immediately`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { 
          type: getExecutionAction("pause", problem.entity.type, problem.platform), 
          parameters: { reason: isDrain ? "Zero leads plus high spend" : "Significant spend with zero leads" } 
        },
        execution_plan: [
          `Pause ${problem.entity.name} via API.`,
          "Watch the account for volume replacement over the next 72 hours.",
          "Reallocate budget only after a replacement winner is confirmed.",
        ],
        strategic_rationale: "Safe, reversible, deterministic pause based on performance failure.",
        risk_checks: ["Confirm zero leads are not caused by tracking gaps."],
      },
    };
  }

  if (problem.triggers.includes("inflated_cpc")) {
    return {
      ruleId: "high_cpc_audit",
      title: "L1 (SOP)",
      action: "Review bidding and audience overlap",
      confidence: 75,
      reasoning: "CPC is significantly higher than the account average, suggesting creative exhaustion or auction overlap.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Optimize CPC for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Check audience overlap with other active campaigns.",
          "Refresh creative assets to improve click-through rate.",
          "Consider shifting to a more efficient bidding strategy.",
        ],
        strategic_rationale: "High CPC usually requires creative or audience shifts that cannot be automated safely.",
        risk_checks: ["Ensure high CPC isn't skewed by a small sample of impressions."],
      },
    };
  }

  if (problem.triggers.includes("creative_aging")) {
    return {
      ruleId: "creative_fatigue_refresh",
      title: "L1 (SOP)",
      action: "Mandatory creative refresh",
      confidence: 80,
      reasoning: "Winning assets have exceeded 21 days or have a low aging score, and represent a high spend share. Creative fatigue is imminent.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Refresh creative for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Identify top performing creative hook and iterate on it.",
          "Introduce 2 new video formats (Reels/Feed).",
          "Test a disruptive new headline hook.",
        ],
        strategic_rationale: "Refreshes required human creative input for first-frame and hook design.",
        risk_checks: ["Keep the existing winner active at low spend until the refresh is validated."],
      },
    };
  }

  if (problem.triggers.includes("frequency_breach")) {
    return {
      ruleId: "frequency_reduce_budget",
      title: "L1 (SOP)",
      action: "Reduce budget by 30% or pause",
      confidence: 85,
      reasoning: "Document rule match: frequency in breach territory drafts a budget reduction or pause pending audience validation.",
      execution: "AUTO-EXECUTE",
      actionPayload: {
        intent: `Reduce budget on ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { 
          type: getExecutionAction("scale_down", problem.entity.type, problem.platform), 
          parameters: { scalePercent: 30, reason: "Frequency breach" } 
        },
        execution_plan: [
          `Reduce budget on ${problem.entity.name} by 30%.`,
          "Watch CTR and CPL for 72 hours after the budget reduction.",
          "Prepare a creative refresh if fatigue persists.",
        ],
        strategic_rationale: "Budget reduction is reversible and safe when fatigue is already confirmed by score.",
        risk_checks: ["Do not cut budget if this entity is the only lead driver and no replacement exists."],
      },
    };
  }

  if (problem.triggers.includes("winner_underfunded")) {
    return {
      ruleId: "winner_scale",
      title: "L1 (SOP)",
      action: "Scale budget by 20-25%",
      confidence: 75,
      reasoning: "Document rule match: score above 70 plus low budget utilization is a missed scaling opportunity.",
      execution: "AUTO-EXECUTE",
      actionPayload: {
        intent: `Scale winner ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { 
          type: getExecutionAction("scale_up", problem.entity.type, problem.platform), 
          parameters: { scalePercent: 20, reason: "Winner is underfunded" } 
        },
        execution_plan: [
          `Increase ${problem.entity.name} budget by 20%.`,
          "Monitor CPL and frequency after the scale.",
          "Stop further scaling if CPL drifts above target.",
        ],
        strategic_rationale: "Moderate winner scaling is reversible and aligned to the document's missed-opportunity rule.",
        risk_checks: ["Avoid scaling beyond 25% in one step."],
      },
    };
  }

  if (problem.symptomMetric === "cpl" && cvr > 0 && targetCpl > 0 && raw.cpl > targetCpl * 1.3 && cvr < (problem.platform === "google" ? 3 : 4)) {
    return {
      ruleId: "landing_page_audit",
      title: "L1 (SOP)",
      action: "Flag for landing page audit",
      confidence: 80,
      reasoning: "Document rule match: CPL above 1.3x target with CVR below floor routes to a landing page or lead-form audit.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Audit funnel for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Review landing page speed and mobile UX.",
          "Reduce form friction or field count.",
          "Validate tracking before changing traffic sources.",
        ],
        strategic_rationale: "Manual funnel work is required; the platform cannot execute this safely via API.",
        risk_checks: ["Confirm whether the bottleneck is page friction versus audience intent."],
      },
    };
  }

  if (problem.triggers.includes("google_is_budget_lost")) {
    return {
      ruleId: "google_is_budget",
      title: "L1 (SOP)",
      action: "Increase budget or adjust bid",
      confidence: 70,
      reasoning: "Document rule match: Search IS budget loss above 20% escalates to budget or bid review.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Review budget limits on ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Review impression share and budget caps.",
          "Increase budget only if CPL can tolerate additional spend.",
          "If CPL is already stressed, improve bid efficiency before adding budget.",
        ],
        strategic_rationale: "Budget expansion needs human judgment when search economics are already changing.",
        risk_checks: ["Check ROI before adding budget into a weak efficiency profile."],
      },
    };
  }

  if (problem.triggers.includes("cpl_severe_breach")) {
    return {
      ruleId: "cpl_severe_breach_audit",
      title: "L1 (SOP)",
      action: "Immediate CPL breach investigation",
      confidence: 85,
      reasoning: "CPL exceeds 2x target — this is a severe breach that requires immediate investigation of the full cost stack.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Investigate CPL breach on ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Audit CPM, CTR, and CVR for the first broken layer.",
          "Check if audience saturation is driving up CPM.",
          "Review creative performance and refresh if CTR is below benchmark.",
          "Validate conversion tracking before cutting traffic.",
        ],
        strategic_rationale: "CPL at 2x+ target requires root-cause analysis before automated action.",
        risk_checks: ["Do not pause without confirming the CPL issue is not a tracking anomaly."],
      },
    };
  }

  if (problem.triggers.includes("budget_pacing_emergency")) {
    const spendPct = Number(problem.entity.raw?.pacing?.spend_pct ?? 100);
    const isOverPacing = spendPct > 120;
    return {
      ruleId: "budget_pacing_emergency",
      title: "L1 (SOP)",
      action: isOverPacing ? "Reduce daily budgets to prevent early exhaustion" : "Boost daily budgets or pause low performers to rescue delivery",
      confidence: 82,
      reasoning: isOverPacing
        ? `Budget pacing is at ${spendPct.toFixed(0)}% with less than 7 days remaining — over-pacing risks exhausting monthly budget before month end.`
        : `Budget pacing is severely under-tracking with less than 7 days remaining — at risk of significant under-delivery.`,
      execution: "MANUAL",
      actionPayload: {
        intent: isOverPacing ? "Reduce budgets to prevent over-spend" : "Increase budgets to rescue delivery",
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: isOverPacing
          ? [
              "Identify the top 2-3 campaigns consuming the most budget.",
              "Reduce their daily budgets by 15-20% to slow spend rate.",
              "Do not pause high-performing campaigns; only throttle.",
              "Re-check pacing daily until month end.",
            ]
          : [
              "Identify paused or heavily limited campaigns with proven CPL.",
              "Increase or restore their daily budgets to accelerate delivery.",
              "Alternatively, pause zero-lead campaigns to redistribute spend.",
              "Re-check pacing daily until month end.",
            ],
        strategic_rationale: "Pacing emergencies require human judgment to avoid disrupting winner campaigns.",
        risk_checks: ["Avoid pausing the sole lead driver while trying to rescue pacing."],
      },
    };
  }

  if (problem.triggers.includes("low_quality_score")) {
    return {
      ruleId: "low_quality_score_fix",
      title: "L1 (SOP)",
      action: "Improve ad relevance and landing page experience to raise Quality Score",
      confidence: 78,
      reasoning: "Quality Score below 5 directly increases CPC auction costs. The document requires ad copy and landing page alignment before budget decisions.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Improve Quality Score for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Audit keyword-to-ad relevance: ensure each ad group targets a tight keyword theme.",
          "Improve Expected CTR by rewriting headlines with the target keyword.",
          "Review Landing Page Experience: speed, mobile UX, and keyword match on page.",
          "Pause or restructure very broad match terms that drag down relevance scores.",
        ],
        strategic_rationale: "Raising Quality Score is the highest-ROI lever for Google — each point improvement reduces CPC by ~15%.",
        risk_checks: ["Do not change bids while improving QS; let the score recover first."],
      },
    };
  }

  // Generic health score degradation — used when no breakdown is available
  if (problem.symptomMetric === "health_score") {
    return {
      ruleId: "health_score_audit",
      title: "L1 (SOP)",
      action: "Audit account health metrics to identify root degradation",
      confidence: 60,
      reasoning: `${problem.entity.name} has a health score of ${problem.entity.score.toFixed(0)}/100 but no metric breakdown is available. A manual audit of KPIs (CPL, CTR, CVR, CPM) is required to identify the first break point.`,
      execution: "MANUAL",
      actionPayload: {
        intent: `Audit ${problem.entity.name} for root cause of health decline`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Pull the last 7-day metric trend for CPL, CTR, CVR, and CPM.",
          "Identify the first metric in the cost stack that broke below benchmark.",
          "Apply the root-cause-specific SOP rule (CPL → CPM → CTR → CVR).",
          "Escalate to L2 with the identified root cause metric.",
        ],
        strategic_rationale: "Without a metric breakdown, a structured audit is needed before any automated action.",
        risk_checks: ["Do not take action until the root metric is confirmed."],
      },
    };
  }

  return {
    ruleId: "escalate_to_l2",
    title: "L1 (SOP)",
    action: "Escalate to Layer 2 for root-cause analysis",
    confidence: 0,
    reasoning: "No deterministic SOP rule cleanly fits this score-driven problem, so the document requires a Layer 2 analysis.",
    execution: "MANUAL",
  };
}

// ─── Model Tier Selection ──────────────────────────────────────────

// Strategic triggers that warrant Opus-level reasoning regardless of severity.
// These involve budget allocation decisions, scaling calls, structural campaign
// changes, or multi-entity impact — i.e., anything where a wrong call burns
// real money or misses a scaling window.
const STRATEGIC_TRIGGERS = new Set([
  "zero_lead_budget_drain",
  "zero_lead_heavy_spend",
  "budget_pacing_emergency",
  "winner_underfunded",
  "cpl_severe_breach",
  "cpl_medium_breach",
  "google_is_budget_lost",
  "entity_freefall",
  "low_quality_score",
]);

// L1 SOP rules that involve strategic decisions (scale, pause high-value, budget realloc)
const STRATEGIC_SOP_RULES = new Set([
  "zero_lead_pause",
  "heavy_spend_no_leads_pause",
  "winner_scale",
  "frequency_reduce_budget",
  "landing_page_audit",
  "cpl_severe_breach_audit",
  "google_is_budget",
  "budget_pacing_emergency",
  "low_quality_score_fix",
  "health_score_audit",
  "escalate_to_l2",           // No SOP match → needs deeper AI reasoning
]);

function selectModelTier(
  problem: DetectedProblem,
  l1RuleId?: string
): "opus" | "sonnet" {
  // 1. Always Opus for CRITICAL severity
  if (problem.severity === "CRITICAL") return "opus";

  // 2. Opus if any trigger is strategic (budget, scaling, drain, freefall)
  if (problem.triggers.some((t) => STRATEGIC_TRIGGERS.has(t))) return "opus";

  // 3. Opus if L1 mapped to a strategic SOP rule
  if (l1RuleId && STRATEGIC_SOP_RULES.has(l1RuleId)) return "opus";

  // 4. Opus for campaign-level problems (higher blast radius than ad/adset)
  if (problem.entity.type === "campaign") return "opus";

  // 5. Everything else — regular tactical optimization → Sonnet
  return "sonnet";
}

// ─── L2: Real Claude API Call ──────────────────────────────────────

async function buildL2Real(
  problem: DetectedProblem,
  l1: ReturnType<typeof buildSopDraft>,
  ctx: AssembledContext
): Promise<LayerAnalysisBlock & {
  position: "AGREE" | "OVERRIDE" | "EXTEND";
  primaryAction: string;
  actionPayload?: AdCortexRecommendation["action_payload"];
  expectedOutcome: string;
}> {
  const raw = problem.entity.raw || {};
  const metricsList = problem.weakMetrics
    .map((m) => `${m.label}: score=${m.score.toFixed(0)}/100${m.value != null ? `, value=${m.value}` : ""}`)
    .join("\n  - ");

  const systemPrompt = `You are a senior performance marketer analyzing ONE specific ad performance problem for a real estate client running Meta and Google ads. Target property: Deevyashakti Amara.

Your task: Analyze the problem, then AGREE, OVERRIDE, or EXTEND the SOP (L1) draft action based on the root cause data provided.

AGREE = The SOP action is correct, execute it.
OVERRIDE = The SOP action is wrong given the data. Provide a better action.
EXTEND = The SOP action is partially right but needs refinement or more context.

You MUST respond with ONLY valid JSON in this exact format:
{
  "position": "AGREE" | "OVERRIDE" | "EXTEND",
  "reasoning": "2-3 sentences explaining your position, referencing specific metrics",
  "actions": ["action 1", "action 2", "action 3"],
  "primaryAction": "the single best action to take right now",
  "confidence": 70-95,
  "expectedOutcome": "what should happen if the action is taken",
  "conflicts": ["any data point that conflicts with the SOP", "..."]
}`;

  const userMessage = `PROBLEM ANALYSIS REQUEST

Entity: ${problem.entity.name}
Type: ${problem.entity.type}
Score: ${problem.entity.score.toFixed(1)}/100
Classification: ${problem.entity.classification}
Platform: ${problem.platform}
Severity: ${problem.severity}

SYMPTOM: ${problem.symptom}
PROBLEM STATEMENT: ${problem.problemStatement}

ROOT CAUSE CHAIN:
${problem.rootCause.chain.map((step) => `  ${step.label}: ${step.score.toFixed(0)}/100 (${step.status})`).join("\n")}

Primary Root Cause: ${problem.rootCause.primaryLabel}
Root Cause Summary: ${problem.rootCause.summary}

WEAK METRICS:
  - ${metricsList || "No specific metric breakdown available"}

TRIGGERS: ${problem.triggers.join(", ")}

L1 SOP DRAFT:
  Rule: ${l1.ruleId}
  Action: ${l1.action}
  Confidence: ${l1.confidence}%
  Reasoning: ${l1.reasoning}

RAW ENTITY DATA:
${JSON.stringify(raw, null, 2).substring(0, 800)}

Based on the root cause chain and metrics above, should you AGREE, OVERRIDE, or EXTEND the SOP action? Provide 1-3 specific, actionable recommendations that directly address the root cause.`;

  const modelTier = selectModelTier(problem, l1.ruleId);

  const claudeResponse = await callClaude({
    systemPrompt,
    userMessage,
    modelTier,
    maxTokens: modelTier === "opus" ? 2048 : 1024,
    temperature: 0.2,
  });
  console.log(`[Solution Pipeline] L2 used ${modelTier} for ${problem.severity} severity problem: ${problem.entity.name} [triggers: ${problem.triggers.join(", ")}]`);

  // Parse the JSON response
  const jsonMatch = claudeResponse.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude L2 response did not contain valid JSON");
  }
  const parsed = JSON.parse(jsonMatch[0]);

  const position: "AGREE" | "OVERRIDE" | "EXTEND" = 
    ["AGREE", "OVERRIDE", "EXTEND"].includes(parsed.position) ? parsed.position : "EXTEND";
  const primaryAction = parsed.primaryAction || parsed.actions?.[0] || l1.action;
  const confidence = Math.min(95, Math.max(50, Number(parsed.confidence) || 75));

  // Build action payload from the AI response
  const actionKeyword = toActionKeyword(primaryAction);
  const actionPayload: AdCortexRecommendation["action_payload"] = l1.actionPayload || {
    intent: primaryAction,
    platform: problem.platform,
    entity_type: problem.entity.type,
    entity_ids: problem.entity.id ? [problem.entity.id] : [],
    filters: buildEntityFilter(problem) as any,
    action: { type: actionKeyword === "pause" ? getExecutionAction("pause", problem.entity.type, problem.platform) : "clarify", parameters: {} },
    execution_plan: parsed.actions || [primaryAction],
    strategic_rationale: parsed.reasoning || "",
    risk_checks: [],
  };

  // If L2 overrides with a different action, update the payload
  if (position === "OVERRIDE" && parsed.actions?.length > 0) {
    actionPayload.intent = primaryAction;
    actionPayload.execution_plan = parsed.actions;
    actionPayload.strategic_rationale = parsed.reasoning;
    if (actionKeyword !== "pause") {
      actionPayload.action = { type: "clarify", parameters: {} };
    }
  }

  return {
    title: "L2 (AI Expert)",
    action: primaryAction,
    confidence,
    reasoning: parsed.reasoning || `Root-cause focus is ${problem.rootCause.primaryLabel}. ${problem.rootCause.summary}`,
    data: parsed.conflicts?.length > 0 ? parsed.conflicts : undefined,
    position,
    primaryAction,
    actionPayload,
    expectedOutcome: parsed.expectedOutcome || "Stabilize performance while addressing the first broken layer in the chain.",
  };
}

// Fallback deterministic L2 when Claude API fails
function buildL2Fallback(
  problem: DetectedProblem,
  l1: ReturnType<typeof buildSopDraft>
): LayerAnalysisBlock & {
  position: "AGREE" | "OVERRIDE" | "EXTEND";
  primaryAction: string;
  actionPayload?: AdCortexRecommendation["action_payload"];
  expectedOutcome: string;
} {
  const raw = problem.entity.raw || {};
  const primaryMetric = problem.rootCause.primaryMetric;
  const conflicts: string[] = [];

  let action = l1.action;
  let reasoning = `Root-cause focus is ${problem.rootCause.primaryLabel}. ${problem.rootCause.summary}`;
  let position: "AGREE" | "OVERRIDE" | "EXTEND" = l1.ruleId === "escalate_to_l2" ? "EXTEND" : "AGREE";
  let expectedOutcome = "Stabilize performance while addressing the first broken layer in the chain.";
  let actionPayload = l1.actionPayload;

  if ((l1.ruleId === "zero_lead_pause" || l1.ruleId === "heavy_spend_no_leads_pause") && typeof raw.learning_status === "string" && raw.learning_status.toLowerCase().includes("learning")) {
    position = "OVERRIDE";
    action = "Hold for 3 days and monitor learning instead of pausing";
    reasoning = "SOP wants an immediate pause, but the entity is still in a learning state. Conflicting data: the entity is still learning.";
    expectedOutcome = "Allow the learning phase to complete before judging final CPL efficiency.";
    actionPayload = {
      intent: `Hold ${problem.entity.name} for 3 more days`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Leave the entity live for 3 more days.",
        "Review CTR and CPL trend daily.",
        "Pause only if no improvement appears by the next review window.",
      ],
      strategic_rationale: "Learning-phase exceptions should not be auto-paused without confirming the trend.",
      risk_checks: ["Revert to the SOP pause if leads stay at zero after the hold period."],
    };
  } else if (primaryMetric === "ctr") {
    position = (l1.ruleId === "zero_lead_pause" || l1.ruleId === "heavy_spend_no_leads_pause" || l1.ruleId === "escalate_to_l2") ? "OVERRIDE" : "EXTEND";
    action = `Refresh creative instead of treating ${problem.rootCause.primaryLabel} as a generic CPL issue`;
    reasoning = `The cost stack points to CTR as the first broken layer. The document example explicitly says a CTR drop should be treated as a creative problem, not a blanket pause.`;
    expectedOutcome = "A creative refresh should lift engagement and reduce downstream CPL pressure within the next optimization cycle.";
    actionPayload = {
      intent: `Refresh creative for ${problem.entity.name}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Replace the weakest creative or hook.",
        "Keep the audience intact while testing the new creative.",
        "Re-check CTR, CPC, and CPL after 72 hours.",
      ],
      strategic_rationale: "Creative work is required because the score breakdown shows engagement failing before conversion.",
      risk_checks: ["Fallback to pause only if CTR does not recover after the refresh."],
    };
  } else if (primaryMetric === "cvr") {
    position = l1.ruleId === "landing_page_audit" ? "AGREE" : "OVERRIDE";
    action = "Fix the conversion step before cutting traffic";
    reasoning = "The first broken layer is CVR. CVR weakness means landing page friction, form friction, or intent mismatch.";
    expectedOutcome = "Improving conversion friction should lower CPL without sacrificing reach.";
    actionPayload = {
      intent: `Fix conversion friction for ${problem.entity.name}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Audit form or landing page friction.",
        "Reduce complexity in the conversion step.",
        "Validate post-click tracking before changing traffic sources.",
      ],
      strategic_rationale: "Manual conversion work is required because the top-of-funnel is not the first break point.",
      risk_checks: ["Fallback to traffic cuts only if CVR stays weak after the audit."],
    };
  } else if (primaryMetric === "cpm" || primaryMetric === "cpc") {
    position = l1.ruleId === "escalate_to_l2" ? "EXTEND" : "OVERRIDE";
    action = problem.platform === "google"
      ? "Tighten search efficiency before expanding spend"
      : "Relieve cost pressure through audience or bidding cleanup";
    reasoning = `The first broken layer is ${problem.rootCause.primaryLabel}. This is an upstream cost problem.`;
    expectedOutcome = "Reducing upstream auction pressure should lower click cost and improve CPL without an unnecessary pause.";
    actionPayload = {
      intent: `Relieve cost pressure on ${problem.entity.name}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Review bidding and audience or keyword efficiency.",
        "Trim the waste source driving CPM/CPC up.",
        "Re-check the full cost stack after the adjustment.",
      ],
      strategic_rationale: "This requires analysis and optimization work rather than direct API execution.",
      risk_checks: ["Do not increase budget until the upstream cost layer stabilizes."],
    };
  } else if (problem.triggers.includes("winner_underfunded")) {
    position = "AGREE";
    action = "Scale the winner and monitor frequency";
    reasoning = "Layer 2 agrees with the SOP because the score profile already validates a winner and the opportunity is budget utilization, not a broken KPI.";
    expectedOutcome = "A measured scale should increase lead volume while keeping CPL in range.";
  }

  return {
    title: "L2 (AI Expert)",
    action,
    confidence: Math.max(l1.confidence, position === "OVERRIDE" ? 78 : 82),
    reasoning,
    data: conflicts.length > 0 ? conflicts : undefined,
    position,
    primaryAction: action,
    actionPayload,
    expectedOutcome,
  };
}

async function buildL2(
  problem: DetectedProblem,
  l1: ReturnType<typeof buildSopDraft>,
  ctx: AssembledContext
): Promise<ReturnType<typeof buildL2Fallback>> {
  try {
    return await buildL2Real(problem, l1, ctx);
  } catch (err: any) {
    console.warn(`[Solution Pipeline] L2 Claude API failed, using deterministic fallback: ${err.message}`);
    return buildL2Fallback(problem, l1);
  }
}

// ─── L3: Real Claude API Call ──────────────────────────────────────

async function buildL3Real(
  problem: DetectedProblem,
  l2: Awaited<ReturnType<typeof buildL2>>,
  ctx: AssembledContext
): Promise<LayerAnalysisBlock & {
  confidenceDelta: number;
  recurringIssue: boolean;
}> {
  const recentActions = ctx.layer3.recentActions as LearningEntry[] || [];
  const sameEntityActions = recentActions.filter((entry) => entry.entityId === problem.entity.id);
  const similarTypeActions = recentActions.filter(
    (entry) => entry.entityType === problem.entity.type
  );
  const cooldownHit = sameEntityActions.some((entry) => {
    const executedAt = new Date(entry.executedAt).getTime();
    return Number.isFinite(executedAt) && Date.now() - executedAt < 72 * 60 * 60 * 1000;
  });
  const recurringIssue = sameEntityActions.length >= 3;

  const historyText = sameEntityActions.slice(0, 5).map((entry) => 
    `- Action: ${entry.action}, Outcome: ${entry.outcome}, Executed: ${entry.executedAt}`
  ).join("\n") || "No history for this specific entity.";

  const similarHistoryText = similarTypeActions.slice(0, 8).map((entry) =>
    `- Entity: ${entry.entityId || "unknown"}, Action: ${entry.action}, Outcome: ${entry.outcome}`
  ).join("\n") || "No similar entity history available.";

  const positiveCount = similarTypeActions.filter((e) => e.outcome === "POSITIVE").length;
  const negativeCount = similarTypeActions.filter((e) => e.outcome === "NEGATIVE").length;
  const totalSimilar = similarTypeActions.length;
  const successRate = totalSimilar > 0 ? ((positiveCount / totalSimilar) * 100).toFixed(0) : "unknown";

  const systemPrompt = `You are a performance marketing analyst reviewing execution history to validate a proposed action for a real estate advertising account.

Your task: Based on execution history for this entity and similar entities, validate the proposed L2 action. Assess if this is a recurring issue and adjust confidence accordingly.

You MUST respond with ONLY valid JSON in this exact format:
{
  "validation": "PROCEED" | "CAUTION" | "BLOCK",
  "historyMatch": "brief description of the most relevant historical pattern found",
  "adjustedConfidence": -20 to +15 (integer, the delta to apply to L2 confidence),
  "recurringIssue": true | false,
  "cooldownActive": true | false,
  "warnings": ["warning 1", "warning 2"],
  "reasoning": "2-3 sentences explaining the history-based assessment"
}`;

  const userMessage = `L3 HISTORY VALIDATION REQUEST

ENTITY: ${problem.entity.name} (${problem.entity.type})
PROPOSED ACTION FROM L1+L2: ${l2.primaryAction}
L2 CONFIDENCE: ${l2.confidence}%
L2 POSITION: ${l2.position}

EXECUTION HISTORY FOR THIS ENTITY:
${historyText}

SIMILAR ENTITY HISTORY (same type: ${problem.entity.type}):
${similarHistoryText}

SUCCESS RATE FOR SIMILAR ACTIONS: ${successRate}% (${positiveCount} positive / ${negativeCount} negative out of ${totalSimilar} similar actions)

COOLDOWN STATUS: ${cooldownHit ? "ACTIVE — entity was actioned within last 72 hours" : "Clear — no recent actions"}
RECURRING ISSUE: ${recurringIssue ? `YES — entity has been flagged ${sameEntityActions.length} times` : "No repeated flags"}

Based on this history, should we PROCEED, CAUTION, or BLOCK the proposed action? Apply a confidence delta between -20 and +15.`;

  const modelTier = selectModelTier(problem);

  const claudeResponse = await callClaude({
    systemPrompt,
    userMessage,
    modelTier,
    maxTokens: modelTier === "opus" ? 1024 : 512,
    temperature: 0.1,
  });
  console.log(`[Solution Pipeline] L3 used ${modelTier} for ${problem.severity} severity problem: ${problem.entity.name} [triggers: ${problem.triggers.join(", ")}]`);

  const jsonMatch = claudeResponse.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude L3 response did not contain valid JSON");
  }
  const parsed = JSON.parse(jsonMatch[0]);

  const confidenceDelta = Math.min(15, Math.max(-20, Number(parsed.adjustedConfidence) || 0));
  const newConfidence = Math.max(0, Math.min(100, l2.confidence + confidenceDelta));

  let action = "History validates current direction";
  if (parsed.validation === "BLOCK") {
    action = "History strongly cautions against this action";
  } else if (parsed.validation === "CAUTION") {
    action = "Proceed with caution based on history";
  }

  const warnings: string[] = parsed.warnings || [];
  if (cooldownHit) warnings.push("Entity was actioned within the last 72 hours — effects may not yet be visible.");
  if (parsed.recurringIssue || recurringIssue) warnings.push("Recurring pattern detected — consider structural fix rather than tactical tweak.");

  return {
    title: "L3 (History)",
    action,
    confidence: newConfidence,
    reasoning: parsed.reasoning || "No strong historical contradiction found.",
    data: warnings.length > 0 ? warnings : undefined,
    confidenceDelta,
    recurringIssue: parsed.recurringIssue || recurringIssue,
  };
}

// Fallback deterministic L3
function buildL3Fallback(
  problem: DetectedProblem,
  l2: Awaited<ReturnType<typeof buildL2>>,
  ctx: AssembledContext
): LayerAnalysisBlock & {
  confidenceDelta: number;
  recurringIssue: boolean;
} {
  const recentActions = ctx.layer3.recentActions as LearningEntry[] || [];
  
  function canonicalActionMatch(action: string): string {
    const normalized = action.toLowerCase();
    if (normalized.includes("pause")) return "pause";
    if (normalized.includes("scale")) return "scale";
    if (normalized.includes("creative")) return "creative";
    if (normalized.includes("landing") || normalized.includes("conversion") || normalized.includes("audit")) return "landing";
    if (normalized.includes("budget")) return "budget";
    return normalized;
  }

  const canonical = canonicalActionMatch(l2.primaryAction);
  const sameEntity = recentActions.filter((entry) => entry.entityId === problem.entity.id);
  const exactAction = sameEntity.filter((entry) => canonicalActionMatch(entry.action) === canonical);
  const similarAction = recentActions.filter(
    (entry) => entry.entityType === problem.entity.type && canonicalActionMatch(entry.action) === canonical,
  );
  const positiveSimilar = similarAction.filter((entry) => entry.outcome === "POSITIVE").length;
  const negativeExact = exactAction.filter((entry) => entry.outcome === "NEGATIVE").length;
  const cooldownHit = sameEntity.some((entry) => {
    const executedAt = new Date(entry.executedAt).getTime();
    return Number.isFinite(executedAt) && Date.now() - executedAt < 72 * 60 * 60 * 1000;
  });
  const recurringIssue = sameEntity.length >= 3;

  let confidenceDelta = 0;
  let reasoning = "No strong historical contradiction was found, so Layer 3 leaves the action largely intact.";

  if (positiveSimilar >= 2) {
    confidenceDelta += 10;
    reasoning = `History supports this action: similar entities had ${positiveSimilar} positive outcomes for the same action pattern.`;
  }

  if (negativeExact > 0) {
    confidenceDelta -= 15;
    reasoning = "History cautions against repeating the exact same action on this entity because it already failed before.";
  }

  if (cooldownHit) {
    confidenceDelta -= 10;
    reasoning = "This entity was actioned within the last 72 hours, so it is too soon to judge the last change.";
  }

  if (recurringIssue) {
    confidenceDelta -= 8;
    reasoning += " The entity has been flagged repeatedly, which points to a structural issue rather than a one-off tweak.";
  }

  return {
    title: "L3 (History)",
    action: confidenceDelta < -10 ? "Proceed with caution" : "History validates current direction",
    confidence: Math.max(0, Math.min(100, l2.confidence + confidenceDelta)),
    reasoning,
    confidenceDelta,
    recurringIssue,
  };
}

async function buildL3(
  problem: DetectedProblem,
  l2: Awaited<ReturnType<typeof buildL2>>,
  ctx: AssembledContext
): Promise<ReturnType<typeof buildL3Fallback>> {
  try {
    return await buildL3Real(problem, l2, ctx);
  } catch (err: any) {
    console.warn(`[Solution Pipeline] L3 Claude API failed, using deterministic fallback: ${err.message}`);
    return buildL3Fallback(problem, l2, ctx);
  }
}

function buildL4(problem: DetectedProblem, action: string, ctx: AssembledContext): LayerAnalysisBlock & {
  veto: boolean;
} {
  function canonicalActionMatch(a: string): string {
    const normalized = a.toLowerCase();
    if (normalized.includes("pause")) return "pause";
    if (normalized.includes("scale")) return "scale";
    if (normalized.includes("creative")) return "creative";
    if (normalized.includes("landing") || normalized.includes("conversion") || normalized.includes("audit")) return "landing";
    if (normalized.includes("budget")) return "budget";
    return normalized;
  }

  const normalizedAction = canonicalActionMatch(action);
  const strategicInputs = ctx.layer4.strategicInputs || [];
  const overrideHistory = ctx.layer4.overrideHistory || [];
  const matchedStrategicInput = strategicInputs.find((entry) => {
    const entityMatch = entry.entityName && problem.entity.name.toLowerCase().includes(entry.entityName.toLowerCase());
    const actionMatch = entry.action && canonicalActionMatch(entry.action) === normalizedAction;
    return entityMatch || actionMatch;
  });

  const matchedOverride = overrideHistory.find((entry) => canonicalActionMatch(entry.strategicCall || entry.action) === normalizedAction);
  const text = [matchedStrategicInput?.reason, matchedStrategicInput?.strategicCall, matchedOverride?.strategicCall]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const veto = normalizedAction === "pause" && (text.includes("brand presence") || text.includes("launch"));
  let reasoning = "No strategic constraint blocks the data-backed action.";

  if (matchedStrategicInput) {
    reasoning = `Layer 4 found prior buyer context: ${matchedStrategicInput.reason || matchedStrategicInput.strategicCall}.`;
  } else if (matchedOverride) {
    reasoning = `Layer 4 found a related override history entry: ${matchedOverride.strategicCall}.`;
  }

  if (veto) {
    reasoning += " That context conflicts with a pause, so the system should not auto-resolve the conflict.";
  }

  return {
    title: "L4 (Strategy)",
    action: veto ? "Strategic constraint blocks the pause" : "Strategy allows the action",
    confidence: veto ? 65 : 85,
    reasoning,
    veto,
  };
}

function classifyExecution(
  title: string,
  confidence: number,
  veto: boolean,
  l2Position: "AGREE" | "OVERRIDE" | "EXTEND",
): ExecutionClassification {
  if (veto) return "REJECT";
  const keyword = toActionKeyword(title);

  // Only AUTO-EXECUTE safe, high-confidence actions that the full pipeline agrees on
  if (l2Position === "AGREE" && (keyword === "pause" || keyword === "scale" || keyword === "budget") && confidence >= 85) {
    return "AUTO-EXECUTE";
  }
  // If L2 overrides, require human review even if confidence is high
  if (l2Position === "OVERRIDE") return "MANUAL";
  if (keyword === "clarify") return "MANUAL";
  return "MANUAL";
}

function riskFor(action: string, classification: ExecutionClassification): "Low" | "Medium" | "High" {
  if (classification === "REJECT") return "High";
  const keyword = toActionKeyword(action);
  if (keyword === "pause") return "Medium";
  if (keyword === "scale" || keyword === "budget") return "Medium";
  if (keyword === "creative" || keyword === "landing") return "Low";
  return "Low";
}

function primarySteps(actionPayload?: AdCortexRecommendation["action_payload"], fallbackTitle?: string): string[] {
  if (actionPayload?.execution_plan?.length) return actionPayload.execution_plan;
  if (!fallbackTitle) return ["Review the entity manually."];
  return [fallbackTitle];
}

function rejectSolution(problem: DetectedProblem, l1: ReturnType<typeof buildSopDraft>, l2: Awaited<ReturnType<typeof buildL2>>): SolutionOption | null {
  if (l1.ruleId === "escalate_to_l2" || l1.action === l2.primaryAction) return null;

  return {
    classification: "REJECT",
    title: l1.action,
    rationale: `Layer 1 proposed "${l1.action}", but Layer 2 overrode it because ${l2.reasoning.toLowerCase()}`,
    steps: ["Do not execute the rejected action unless a human deliberately overrides it."],
    risk: "High",
    confidence: Math.max(55, l1.confidence),
    expectedOutcome: "Rejecting the SOP fallback avoids executing an action that current data does not support.",
    actionPayload: {
      intent: `Reject ${l1.action}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: ["Keep the rejected option visible as a conflict note only."],
      strategic_rationale: "The document requires explicit conflict visibility instead of silently hiding disagreement.",
      risk_checks: [],
    },
  };
}

export async function runSolutionPipeline(problem: DetectedProblem, ctx: AssembledContext): Promise<RecommendationCard> {
  const l1 = buildSopDraft(problem, ctx);
  const l2 = await buildL2(problem, l1, ctx);
  const l3 = await buildL3(problem, l2, ctx);
  const l4 = buildL4(problem, l2.primaryAction, ctx);

  const conflicts: string[] = [];
  // Only flag a real L1↔L2 conflict when:
  //  - L2 OVERRIDES (not AGREE or EXTEND — those are normal refinements)
  //  - AND the L1 rule was not the generic escalation placeholder
  const isRealOverride =
    l2.position === "OVERRIDE" &&
    l1.ruleId !== "escalate_to_l2" &&
    l1.action !== l2.primaryAction;
  if (isRealOverride) {
    conflicts.push(`Layer 1 (SOP) recommended "${l1.action}", but Layer 2 analysis determined that the root cause (${problem.rootCause.primaryLabel}) requires "${l2.primaryAction}" instead.`);
  }
  // Only flag history as a conflict if the downward pressure is strong (> 15 points)
  if (l3.confidenceDelta < -15) {
    conflicts.push(`Execution history strongly cautions against this action (−${Math.abs(l3.confidenceDelta)} confidence). A recurring or recently failed action pattern was detected.`);
  }
  if (l4.veto) {
    conflicts.push("A strategic constraint (brand presence or launch phase) blocks an automatic pause. Human review is required before executing.");
  }

  const finalConfidence = Math.max(0, Math.min(100, l3.confidence + (l4.veto ? -10 : 5)));
  const classification = classifyExecution(l2.primaryAction, finalConfidence, l4.veto, l2.position);

  const primarySolution: SolutionOption = {
    classification,
    title: l2.primaryAction,
    rationale: `${l2.reasoning} ${l3.reasoning} ${l4.reasoning}`.trim(),
    steps: primarySteps(l2.actionPayload, l2.primaryAction),
    risk: riskFor(l2.primaryAction, classification),
    confidence: finalConfidence,
    expectedOutcome: l2.expectedOutcome,
    actionPayload: l2.actionPayload,
  };

  const alternativeReject = rejectSolution(problem, l1, l2);

  // Build tiered solutions from real L2/L3 output
  // Only fall back to generateSolutionTiers if L2 produced a generic/incomplete result
  const l2HasRichActions = l2.actionPayload?.execution_plan?.length && l2.actionPayload.execution_plan.length > 1;
  
  let tieredSolutions: TieredSolutions;
  if (l2HasRichActions) {
    // Build tiered solutions from real AI output
    const secondary: SolutionOption[] = [];
    
    // If L2 overrides, keep L1 as a secondary option for human review
    if (l2.position === "OVERRIDE" && l1.actionPayload) {
      secondary.push({
        classification: "MANUAL",
        title: `Alternative: ${l1.action} (SOP approach)`,
        rationale: `Original SOP recommendation before AI analysis. ${l1.reasoning}`,
        steps: primarySteps(l1.actionPayload, l1.action),
        risk: riskFor(l1.action, "MANUAL"),
        confidence: l1.confidence,
        expectedOutcome: "SOP-driven outcome if AI recommendation is set aside.",
        actionPayload: l1.actionPayload,
      });
    }
    
    // Add expert review as final secondary option
    secondary.push({
      classification: "MANUAL",
      title: `Get expert review on ${problem.entity.name}`,
      rationale: `Before taking action, request human expert review to validate AI recommendation and full context.`,
      steps: [
        "Export entity performance report (7-day trend).",
        "Review AI diagnosis and layer analysis.",
        "Execute agreed action with expert sign-off.",
      ],
      risk: "Low",
      confidence: 80,
      expectedOutcome: "Higher confidence in decision through human validation.",
    });

    const rejection: SolutionOption[] = alternativeReject ? [alternativeReject] : [];

    tieredSolutions = {
      primary: primarySolution,
      secondary,
      rejection,
    };
  } else {
    // Fall back to deterministic tier generator
    const analysisData = ctx.layer2?.analysisData || {};
    const accountMetrics = analysisData.account_pulse || {};
    const accountScore = Number(accountMetrics.health_score ?? 50);
    const spend = Number(problem.entity.raw?.spend ?? problem.entity.raw?.budget ?? 0);
    const leads = Number(problem.entity.raw?.leads ?? problem.entity.raw?.conversions ?? 0);

    tieredSolutions = generateSolutionTiers(problem, {
      accountScore,
      entityScore: problem.entity.score,
      spend,
      leads,
    });
  }

  // Capture which model tier was used for this card's L2 analysis
  const modelUsed = selectModelTier(problem, l1.ruleId);

  return {
    id: problem.id,
    severity: problem.severity,
    platform: problem.platform,
    entity: {
      id: problem.entity.id,
      name: problem.entity.name,
      type: problem.entity.type,
      score: problem.entity.score,
      classification: problem.entity.classification,
    },
    diagnosis: {
      symptom: problem.symptom,
      problem: problem.problemStatement,
      data: problem.dataPoints,
      rootCauseChain: problem.rootCause.chain.map((step) => `${step.label} ${step.score.toFixed(0)}/100`),
    },
    layerAnalysis: {
      l1,
      l2,
      l3,
      l4,
      conflicts,
    },
    solutions: alternativeReject ? [primarySolution, alternativeReject] : [primarySolution],
    tieredSolutions,
    expectedOutcome: problem.expectedIfIgnored,
    modelUsed,
  };
}

function severityWeight(severity: SeverityTier): number {
  return severity === "CRITICAL" ? 300 : severity === "MEDIUM" ? 200 : 100;
}

function commandRelevance(card: RecommendationCard, solution: SolutionOption, message?: string): number {
  if (!message) return 0;
  const text = message.toLowerCase();
  const solutionText = `${solution.title} ${solution.rationale}`.toLowerCase();
  const entityText = `${card.entity.name} ${card.entity.type}`.toLowerCase();
  let score = 0;

  if (text.includes("pause") && solutionText.includes("pause")) score += 120;
  if (text.includes("scale") && solutionText.includes("scale")) score += 120;
  if ((text.includes("winner") || text.includes("scale")) && card.entity.classification === "WINNER") score += 60;
  if ((text.includes("underperform") || text.includes("loser") || text.includes("bad")) && card.entity.score < 35) score += 60;
  if (text.includes("creative") && solutionText.includes("creative")) score += 80;
  if ((text.includes("landing") || text.includes("form") || text.includes("funnel")) && solutionText.includes("conversion")) score += 70;
  if (text.includes("budget") && solutionText.includes("budget")) score += 60;
  if (text.includes("lead") && card.diagnosis.problem.toLowerCase().includes("lead")) score += 40;

  const nameTokens = entityText.split(/\s+/).filter((token) => token.length > 4);
  if (nameTokens.some((token) => text.includes(token))) score += 100;

  return score;
}

export function cardsToRecommendations(cards: RecommendationCard[], message?: string): AdCortexRecommendation[] {
  const flattened = cards.flatMap((card) =>
    card.solutions
      .filter((solution) => solution.classification !== "REJECT")
      .map((solution) => ({ card, solution })),
  );

  return flattened
    .sort((left, right) => {
      const leftScore = severityWeight(left.card.severity) + left.solution.confidence + commandRelevance(left.card, left.solution, message);
      const rightScore = severityWeight(right.card.severity) + right.solution.confidence + commandRelevance(right.card, right.solution, message);
      return rightScore - leftScore;
    })
    .slice(0, 5)
    .map(({ card, solution }, index) => ({
      rank: index + 1,
      action: solution.title,
      confidence: Number((solution.confidence / 100).toFixed(2)),
      source_layers: ["L1", "L2", "L3", "L4"],
      sop_alignment: card.layerAnalysis.l1.action === card.layerAnalysis.l2.action ? "agrees" : "disagrees",
      sop_position: card.layerAnalysis.l1.action,
      reasoning: `${card.diagnosis.problem}\n${solution.rationale}`,
      execution_type: solution.classification === "AUTO-EXECUTE" ? "auto" : "manual",
      risk_level: solution.risk.toLowerCase() as "low" | "medium" | "high",
      action_payload: solution.actionPayload || {
        intent: solution.title,
        platform: card.platform,
        entity_type: card.entity.type,
        entity_ids: card.entity.id ? [card.entity.id] : [],
        filters: [],
        action: { type: "clarify", parameters: {} },
        execution_plan: solution.steps,
        strategic_rationale: solution.rationale,
        risk_checks: [],
      },
    }));
}
