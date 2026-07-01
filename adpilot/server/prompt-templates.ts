/**
 * Prompt Templates — Mojo AdCortex Structured Prompt Builder
 *
 * Builds Claude prompts that include all 4 intelligence layers.
 * Each prompt forces strict JSON output format with ranked recommendations.
 *
 * Three prompt types:
 *  - Strategic:      Deep analysis for strategic decisions (Opus)
 *  - Recommendation: Generate actionable recommendations (Sonnet)
 *  - Terminal:        Command interpretation + execution plan (model depends on query)
 *
 * ─── CHANGELOG (Fix Guide v1) ────────────────────────────────────
 * 1. serializeLayer2() now includes adset/ad-group data, ad/creative data,
 *    Python agent intellect_insights, and 12+ missing campaign fields.
 * 2. Campaign cap raised from 20 → 40, smart overflow summary added.
 * 3. Recommendation prompt layer labels aligned with 4-layer architecture.
 * 4. Conflict handling: Claude must show ALL strong opinions, not pick one.
 * 5. Strategic prompt strengthened for entity-specific recommendations.
 */

import type { AssembledContext } from "./context-assembler";

// ─── Output Schema ────────────────────────────────────────────────

export interface AdCortexRecommendation {
  rank: number;
  action: string;
  confidence: number;
  source_layers: string[];
  sop_alignment: "agrees" | "disagrees" | "extends";
  sop_position?: string;
  reasoning: string;
  execution_type: "auto" | "manual" | "confirm";
  risk_level: "low" | "medium" | "high";
  action_payload: {
    intent?: string;
    platform?: string;
    entity_type?: string;
    entity_ids?: string[];
    filters?: Array<{ metric: string; operator: string; value: number; unit?: string }>;
    action?: { type: string; parameters: Record<string, any> };
    execution_plan?: string[];
    strategic_rationale?: string;
    risk_checks?: string[];
  };
}

export interface AdCortexResponse {
  recommendations: AdCortexRecommendation[];
  layer_contributions: Record<string, any>;
  conflicts: string[];
}

// ─── Helper: Serialize Context Layers ─────────────────────────────

function serializeLayer1(ctx: AssembledContext): string {
  const { sopRules, clientTargets, scoringConfig } = ctx.layer1;
  return `## LAYER 1: SOP RULES & CLIENT TARGETS

### Operating Rules
- Min conversions before action: ${sopRules.minConversionsBeforeAction}
- Min impressions (learning phase): ${sopRules.minImpressionsLearning}
- Max budget increase without confirmation: ${sopRules.maxBudgetIncreaseWithoutConfirm}%
- Cooldown between actions on same entity: ${sopRules.cooldownHours} hours
- Default budget scale: ${sopRules.defaultScalePercent}%
- Active cooldowns: ${Object.keys(sopRules.activeCooldowns).length} entities

### Client Targets
- Target CPL: ${clientTargets.cpl || "not set"}
- Monthly Budget: ${clientTargets.budget || "not set"}
- Monthly Leads Target: ${clientTargets.leads || "not set"}
- CPM Max: ${clientTargets.cpm_max || "not set"}

### Scoring Configuration
- CPL Target: ${scoringConfig.cpl_target || "not set"}
- CPL Critical: ${scoringConfig.cpl_critical || "not set"}
- CTR Benchmark: ${scoringConfig.ctr_benchmark || 1.0}%`;
}

function serializeLayer2(ctx: AssembledContext): string {
  const { intellect_insights, platformContext, analysisData } = ctx.layer2;

  // ─── Campaign summary (expanded fields, cap raised to 40) ──────
  const campaigns = analysisData?.campaign_audit || analysisData?.campaign_performance || analysisData?.campaigns || [];

  // Re-order campaigns to prioritize ones mentioned in the alert context if available
  const alertRelatedEntities = ctx.layer2.alertRelatedEntities || [];
  const prioritizedCampaigns = [...campaigns].sort((a, b) => {
    const aRelated = alertRelatedEntities.includes(a.campaign_id || a.id || "") || alertRelatedEntities.includes(a.campaign_name || a.name || "");
    const bRelated = alertRelatedEntities.includes(b.campaign_id || b.id || "") || alertRelatedEntities.includes(b.campaign_name || b.name || "");
    if (aRelated && !bRelated) return -1;
    if (!aRelated && bRelated) return 1;
    return 0;
  });

  const campaignSummary = prioritizedCampaigns.slice(0, 40).map((c: any) => {
    const spend = c.spend || c.cost || c.amount_spent || 0;
    const leads = c.leads || c.conversions || c.results || 0;
    const cpl = c.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
    const clicks = c.clicks || 0;
    const imps = c.impressions || 0;
    const ctr = c.ctr ?? (imps > 0 ? (clicks / imps) * 100 : 0);
    const cvr = c.cvr ?? (clicks > 0 ? (leads / clicks) * 100 : 0);
    return {
      id: c.campaign_id || c.id,
      name: c.campaign_name || c.name,
      status: c.status || c.effective_status || c.delivery_status,
      classification: c.classification,
      health_score: c.health_score,
      spend: Math.round(spend),
      leads,
      cpl: cpl > 99990 ? "no_leads" : Math.round(cpl),
      ctr: `${Number(ctr).toFixed(2)}%`,
      cvr: `${Number(cvr).toFixed(2)}%`,
      cpm: c.cpm ? Math.round(c.cpm) : null,
      frequency: c.frequency ? Number(c.frequency).toFixed(1) : null,
      impressions: imps,
      clicks,
      daily_budget: c.daily_budget || null,
      days_active: c.days_active || c.age_days || null,
      learning_status: c.learning_status || null,
      // Google-specific fields
      quality_score: c.quality_score || null,
      search_impression_share: c.search_is || c.search_impression_share || null,
      search_budget_lost_is: c.search_budget_lost_is || null,
      search_rank_lost_is: c.search_rank_lost_is || null,
      // Score breakdown for deeper analysis
      score_breakdown: c.score_breakdown || null,
    };
  });

  // Overflow summary if more campaigns exist
  const overflowCount = campaigns.length - campaignSummary.length;
  const overflowLine = overflowCount > 0
    ? `\n(+ ${overflowCount} more campaigns not shown — ${campaigns.slice(40).filter((c: any) => c.classification === "UNDERPERFORMER").length} underperformers among them)`
    : "";

  // ─── Ad Set / Ad Group summary (top 30) ────────────────────────
  const adsets = analysisData?.adset_analysis || analysisData?.ad_group_analysis || [];
  const adsetSummary = adsets.slice(0, 30).map((a: any) => {
    const spend = a.spend || a.cost || 0;
    const leads = a.leads || a.conversions || 0;
    const cpl = a.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
    return {
      id: a.adset_id || a.ad_group_id || a.id,
      name: a.adset_name || a.ad_group_name || a.name,
      campaign_name: a.campaign_name,
      status: a.status || a.effective_status,
      classification: a.classification,
      health_score: a.health_score,
      spend: Math.round(spend),
      leads,
      cpl: cpl > 99990 ? "no_leads" : Math.round(cpl),
      ctr: `${Number(a.ctr || 0).toFixed(2)}%`,
      cvr: `${Number(a.cvr || 0).toFixed(2)}%`,
      frequency: a.frequency ? Number(a.frequency).toFixed(1) : null,
      impressions: a.impressions || 0,
      daily_budget: a.daily_budget || null,
      should_pause: a.should_pause || false,
      auto_pause_reasons: a.auto_pause_reasons || [],
      // Google ad group specific
      quality_score: a.quality_score || null,
    };
  });

  // ─── Ad / Creative summary (top 30) ────────────────────────────
  const ads = analysisData?.creative_health || analysisData?.ad_analysis || [];
  const adSummary = ads.slice(0, 30).map((ad: any) => {
    const spend = ad.spend || ad.cost || 0;
    const leads = ad.leads || ad.conversions || 0;
    const cpl = ad.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
    return {
      id: ad.ad_id || ad.id,
      name: ad.ad_name || ad.name,
      campaign_name: ad.campaign_name,
      adset_name: ad.adset_name || ad.ad_group_name,
      classification: ad.classification,
      creative_score: ad.creative_score || ad.performance_score || null,
      creative_age_days: ad.creative_age_days || ad.age_days || null,
      spend: Math.round(spend),
      leads,
      cpl: cpl > 99990 ? "no_leads" : Math.round(cpl),
      ctr: `${Number(ad.ctr || 0).toFixed(2)}%`,
      frequency: ad.frequency ? Number(ad.frequency).toFixed(1) : null,
      impressions: ad.impressions || 0,
      // Video metrics
      thumb_stop_rate: ad.thumb_stop_rate || ad.tsr || null,
      video_hold_rate: ad.video_hold_rate || ad.vhr || null,
      hook_rate: ad.hook_rate || null,
      // Action flags from Python agent
      should_pause: ad.should_pause || false,
      auto_pause_reasons: ad.auto_pause_reasons || [],
    };
  });

  // ─── Python Agent Diagnostic Insights (PIE/PDE) ────────────────
  const agentInsights = analysisData?.intellect_insights || [];
  const insightBlock = Array.isArray(agentInsights) && agentInsights.length > 0
    ? agentInsights.slice(0, 25).map((ins: any) => {
      // Meta format: { type, severity, entity, detail, auto_action }
      // Google format: { type, title, observation, recommendation, impact, confidence }
      if (ins.detail) {
        return `- [${ins.type}]${ins.severity ? ` ${ins.severity}` : ""}: ${ins.entity || "account"} — ${ins.detail}${ins.auto_action ? " [AUTO-ACTION FLAGGED]" : ""}`;
      }
      return `- [${ins.type}] ${ins.title || ""}: ${ins.observation || ""} → Rec: ${ins.recommendation || ""}${ins.confidence ? ` (confidence: ${ins.confidence})` : ""}`;
    }).join("\n")
    : "No diagnostic insights from analysis engine.";

  return `## LAYER 2: CURRENT ANALYSIS DATA

### Account Overview
- Health Score: ${intellect_insights.healthScore ?? "N/A"}
- Overall CPL: ${intellect_insights.overallCpl?.toFixed(0) || "N/A"}
- Total Spend: ${intellect_insights.totalSpend?.toFixed(0) || "N/A"}
- Total Leads: ${intellect_insights.totalLeads || 0}
- Active Campaigns: ${intellect_insights.campaignCount || 0}
- Winners: ${intellect_insights.winnerCount || 0}
- Underperformers: ${intellect_insights.loserCount || 0}
- Active Alerts: ${intellect_insights.alertCount || 0}

### Platform Context
- Platform: ${platformContext.platform}
- Days Elapsed in Month: ${platformContext.daysElapsed ?? "N/A"}
- Days Remaining: ${platformContext.daysRemaining ?? "N/A"}

### Agent Diagnostic Insights (PIE/PDE Engine)
These are automated diagnoses from the analysis engine. Use them as INPUT for
your deeper analysis — do NOT just repeat them. Enhance them with your own
expert reasoning, or challenge them if the data suggests otherwise.
${insightBlock}

### Campaign Data (${campaignSummary.length} campaigns)
${JSON.stringify(campaignSummary, null, 2)}${overflowLine}

### Ad Set / Ad Group Data (${adsetSummary.length} ad sets)
${adsetSummary.length > 0 ? JSON.stringify(adsetSummary, null, 2) : "No ad set data available."}

### Ad / Creative Data (${adSummary.length} ads)
${adSummary.length > 0 ? JSON.stringify(adSummary, null, 2) : "No ad-level data available."}`;
}

function serializeLayer3(ctx: AssembledContext): string {
  const { recentActions, patterns, successRates } = ctx.layer3;

  const recentSummary = recentActions.slice(0, 10).map((a) => ({
    action: a.action,
    entity: a.entityName,
    outcome: a.outcome,
    reason: a.outcomeReason?.substring(0, 80),
    daysAgo: a.daysElapsed,
  }));

  return `## LAYER 3: EXECUTION LEARNING HISTORY

### Historical Success Rates
- Total Past Actions: ${successRates.totalActions}
- Overall Positive Rate: ${(successRates.positiveRate * 100).toFixed(0)}%
- Pause Success Rate: ${(successRates.pauseSuccessRate * 100).toFixed(0)}%
- Scale Success Rate: ${(successRates.scaleSuccessRate * 100).toFixed(0)}%

### Discovered Patterns
${patterns.length > 0 ? patterns.map((p) => `- ${p}`).join("\n") : "- No patterns discovered yet (insufficient data)"}

### Recent Actions (Last 10)
${recentSummary.length > 0 ? JSON.stringify(recentSummary, null, 2) : "No recent actions recorded."}`;
}

function serializeLayer4(ctx: AssembledContext): string {
  const { strategicInputs, overrideHistory } = ctx.layer4;

  const inputsSummary = strategicInputs.slice(0, 10).map((si) => ({
    action_taken: si.action,
    entity: si.entityName,
    reason_given_by_user: si.strategicCall || si.reason,
  }));

  const overrideSummary = overrideHistory.slice(0, 10).map((o) => ({
    recommendation: o.recommendationId,
    decision: o.action,
    rationale: o.strategicCall,
  }));

  return `## LAYER 4: USER ACTION RATIONALE (WHY ACTIONS WERE TAKEN)

### User Action Logs (Last 10)
${inputsSummary.length > 0 ? JSON.stringify(inputsSummary, null, 2) : "No action rationale recorded yet."}

### Recommendation Overrides
${overrideSummary.length > 0 ? JSON.stringify(overrideSummary, null, 2) : "No recommendation overrides recorded."}`;
}
// ─── Shared Output Format Instructions ────────────────────────────

const OUTPUT_FORMAT_INSTRUCTION = `
## OUTPUT FORMAT — STRICT JSON

You MUST respond with ONLY valid JSON (no markdown, no explanation before or after). The response must match this exact schema:

{
  "recommendations": [
    {
      "rank": 1,
      "action": "Brief, directive action title (e.g., 'Kill Scroll-Ignored Creatives' or 'Aggressive Lead-Form Pivot')",
      "confidence": 0.87,
      "source_layers": ["layer1", "layer2", "layer3", "layer4"],
      "sop_alignment": "agrees",
      "sop_position": "If sop_alignment is 'disagrees', summarize the SOP conflict here. Otherwise null.",
      "reasoning": "### WHAT IS HAPPENING\n(Consolidated diagnosis of the problem, referencing specific entity names and metrics)\n\n### WHY IT IS HAPPENING\n(Cross-layer reasoning: Synthesize independent data analysis with SOP rules, execution history, and strategic goals. DO NOT list layers separately.)\n\n### WHAT TO DO NEXT\n(Clear, high-impact strategic next steps and the expected performance outcome)",
      "execution_type": "auto",
      "risk_level": "low",
      "action_payload": {
        "intent": "Strategic intent summary",
        "platform": "meta",
        "entity_type": "campaign | adset | ad_group | ad | account | creative",
        "entity_ids": ["id1", "id2"],
        "filters": [
          { "metric": "cpl", "operator": ">", "value": 800, "unit": "INR" }
        ],
        "action": {
          "type": "pause",
          "parameters": {
            "reason": "CPL exceeds target threshold"
          }
        },
        "execution_plan": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
        "strategic_rationale": "One sentence strategic reasoning.",
        "risk_checks": ["Check 1", "Check 2"]
      }
    }
  ],
  "layer_contributions": {
    "summary": "Internal summary of how the 4-layer vertical stack influenced this specific set of decisions."
  },
  "conflicts": [
    "List any critical disagreements identified during vertical processing (e.g. Layer 3 success history contradicts Layer 1 SOP)."
  ]
}

RULES:
- Provide exactly 3 to 5 consolidated insights (NEVER more than 5)
- DO NOT expose layer-wise outputs (Layer 1 says X, Layer 2 says Y) in the reasoning.
- DO NOT separate SOP / AI / history / strategy in the text — provide UNIFIED reasoning.
- confidence must be between 0.0 and 1.0
- sop_alignment: "agrees" if follows SOP, "disagrees" if it challenges SOP, "extends" if it goes beyond SOPs
- execution_type values:
    "auto"    = Safe reversible platform change (pause, budget adjust) — executable via API
    "confirm" = Significant change requiring user approval before execution
    "manual"  = Requires human creative work, content update, or external tool (creative refresh, landing page fix, form edits, audience research)
- risk_level: "low" for reversible safe changes, "medium" for significant budget changes, "high" for large-scale pauses or budget increases > 50%
- action.type MUST be one of:
    For executable (auto/confirm): "pause", "scale", "adjust_budget", "unpause", "duplicate_winner"
    For strategic/manual: "creative_refresh", "audience_shift", "funnel_audit", "restructure", "bid_strategy_change", "ad_format_shift", "landing_page_audit", "creative_rotation", "clarify"
- entity_type: specify whether acting on campaign, adset, ad_group, ad, account, or creative level
- entity_ids: list the specific IDs from the data to act on (empty array [] if account-level or strategic)
  - Reference specific entity NAMES and METRICS from the data above.
- For each recommendation, the execution_plan MUST contain at least 3 specific, actionable steps a media buyer can follow immediately.`;

// ─── Prompt Builders ──────────────────────────────────────────────

/**
 * Strategic analysis prompt — used for deep analysis queries.
 * Routes to Opus for maximum reasoning quality.
 */
export function buildStrategicPrompt(ctx: AssembledContext): { system: string; user: string } {
  const system = `You are Mojo AdCortex, an elite AI performance performance strategist operating on a VERTICAL INTELLIGENCE STACK.

Your job is to analyze performance by processing inputs layer-by-layer in strict sequence, where each layer builds on the previous one.

### ANALYTICAL PROTOCOL (VERTICAL REASONING):

LAYER 1: SOP ANALYSIS (AI-INTERPRETED)
- Read all SOP rules, thresholds, and alerts.
- Use AI reasoning to interpret what they ACTUALLY imply for this specific client (not just restate them).
- Identify core issues, anomalies, and signals.
- **DYNAMIC BENCHMARKING (MISSING TARGETS)**: If a target in Layer 1 is "not set", you MUST derive an appropriate internal benchmark using account health, historical performance of winners, and platform context from Layer 2. Do not stop analysis due to missing targets.

LAYER 2: AI ANALYSIS (INDEPENDENT THINKING)
- Now ignore SOP rigidity and analyze the data using your own expert intelligence.
- Identify patterns, inefficiencies, or opportunities the SOP might miss (e.g., strong CTR but freakishly high CPM suggesting auction overlap).
- Challenge or validate Layer 1 conclusions.

LAYER 3: EXECUTION HISTORY ANALYSIS
- Analyze past actions taken (budget changes, creative tests, bid adjustments).
- Identify what worked, what failed, and where there are diminishing returns or repeated mistakes.

LAYER 4: STRATEGIC RATIONALE ANALYSIS
- Align with the user's establish strategic logic, past overrides, and overarching account goals.

FINAL STEP: CONSOLIDATED INTELLIGENCE
- Combine ALL layers into a single, unified decision output.
- DO NOT expose layer-wise outputs (Layer 1 says X, Layer 2 says Y).
- Deliver decision-grade insights that are holistic, non-redundant, and actionable.

${OUTPUT_FORMAT_INSTRUCTION}`;

  const user = `${serializeLayer1(ctx)}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}

---

Analyse the full context across the Vertical Intelligence Stack. Identify exactly 3 to 5 consolidated insights. For EVERY recommendation, reference specific entity names, IDs, and metrics from the data above. Prioritize by expected impact on CPL and lead volume.`;

  return { system, user };
}

/**
 * Recommendation prompt — used for generating specific actionable recommendations.
 * Routes to Sonnet for fast, cost-effective responses.
 *
 * alertContext is passed when the call is triggered from a specific alert (e.g. "Account CTR is
 * critically low"). When present, the prompt becomes a problem-specific diagnosis + fix engine
 * rather than a generic account health sweep.
 */
export function buildRecommendationPrompt(
  ctx: AssembledContext,
  alertContext?: { problem: string; metric?: string; metrics?: Record<string, string | number> }
): { system: string; user: string } {

  const hasProblem = !!alertContext?.problem;
  const alertMetric = alertContext?.metric?.toLowerCase() || "";

  const alertDiagnosisBlock = hasProblem ? buildAlertDiagnosisDirective(alertContext!.problem, alertMetric) : "";

  // 🔧 UPDATED SECTION: buildRecommendationPrompt SYSTEM PROMPT FIX

  const system = `You are Mojo AdCortex, an elite AI performance strategist for paid media (Meta Ads & Google Ads).

You operate on a VERTICAL INTELLIGENCE PIPELINE — each layer's OUTPUT becomes the next layer's INPUT. Layer 2 receives Layer 1's draft action and must respond to it. Layer 3 receives Layer 2's enriched action and validates it. Layer 4 receives Layer 3's validated action and applies strategic judgment. No layer operates in isolation. Every insight must synthesize reasoning from multiple layers into one connected analysis.

═══════════════════════════════════════════════════════════════════
SECTION 1: PROBLEM IDENTIFICATION
═══════════════════════════════════════════════════════════════════

Before generating ANY solution, you must first identify WHAT is broken. Problems are primarily discovered through entity scores (scored out of 100 using quadratic decay formulas), but you are NOT limited to scoring parameters. If you spot a problem through your own analysis — audience cannibalization, learning phase traps, seasonal anomalies, tracking gaps, structural campaign issues — surface it.

THREE-TIER SEVERITY (MANDATORY CLASSIFICATION):

CRITICAL — Problems that DIRECTLY and IMMEDIATELY impact Account Health Score. Action needed within 24 hours.
Triggers: Account score < 55, KPI (CPL/CPSV/CPQL) scoring < 15% of max, zero-lead budget drain (spend > 2x target CPL with 0 leads), budget pacing deviation > ±25% with < 10 days remaining, entity score dropped > 25 points in 48 hours.
RULE: Only KPIs or catastrophic score drops qualify. Supporting metrics (CPM, CTR, CVR, Frequency) can NEVER independently be CRITICAL.

MEDIUM — Entity-level score gaps that will become Critical if ignored. Early warning signals.
Triggers: Entity score < 35 (Underperformer), KPI scoring 15-40% of max, ≥ 3 metrics scoring 40-60% on same entity, frequency score < 40%, creative age score < 50% with > 30% spend share, Winner (score > 70) with budget utilization < 60%, Google IS budget lost > 20%.

LOW — Optimization opportunities when KPIs are healthy.
Triggers: Supporting metrics below 60% BUT KPIs are on target, entity in Watch zone (35-70) with KPIs meeting target, Google QS 5-6, ad strength = Average.

THE GOLDEN RULE: If all KPIs (CPL, CPSV, CPQL) are meeting targets, even terrible supporting metrics can only be LOW. A campaign with CPM at 2x benchmark but CPL at 0.8x target is FINE — don't fix what's working.

ROOT CAUSE CHAIN (MANDATORY FOR COST KPI FAILURES):
When CPL/CPSV/CPQL is the symptom, trace backward through the cost stack to find the REAL cause:
- Meta: CPM → CTR → CPC → CVR → CPL
- Google Search: CPC → CTR → CVR → CPL
The problem is NEVER "CPL is high." It's "CPL is high BECAUSE [specific upstream metric] broke." Your solution must target the root cause, not the symptom.

PLATFORM SEGREGATION (MANDATORY):
Meta problems and Google problems are ALWAYS analyzed separately. They have different cost chains, different scoring parameters, different SOPs, and different fundamentals. Never mix them. If analyzing both platforms, present Meta findings and Google findings as separate sections.
- Meta SOPs apply to Meta entities only.
- Google SOPs apply to Google entities only.
- Do not apply Meta benchmarks to Google or vice versa.

═══════════════════════════════════════════════════════════════════
SECTION 2: VERTICAL 4-LAYER SOLUTION PIPELINE
═══════════════════════════════════════════════════════════════════

For each identified problem, run through ALL 4 layers in strict sequence. Each layer refines the previous layer's output.

────────────────────────────────────────────────────────
LAYER 1 — SOP RULES (Deterministic Draft)
────────────────────────────────────────────────────────

Layer 1 produces a DRAFT ACTION based on deterministic SOP rules. It does NOT produce final recommendations.

Your job in Layer 1:
- Match the detected problem against the SOP rules provided in the data.
- Extract the TRUE problem signal — not just "CPL is high" but "CPL is high because CTR collapsed while CPM held steady."
- If a rule matches, produce a draft action with confidence level (e.g., "PAUSE immediately — 95% confidence").
- If NO rule matches, produce an escalation: "No SOP rule fits this problem — escalating to Layer 2 for full analysis" with 0% confidence.
- SOPs are platform-specific: Meta SOPs apply to Meta entities, Google SOPs apply to Google entities. Never cross-apply.

DYNAMIC BENCHMARKING: If explicit client targets are not available in the provided data, derive working benchmarks from the performance of WINNER entities (score > 70) within the same account. Their CPL, CTR, CVR become the implicit "what good looks like" for this account.

Layer 1 output → becomes Layer 2's input.

────────────────────────────────────────────────────────
LAYER 2 — AI EXPERT INTELLECT (Enrichment + Override)
────────────────────────────────────────────────────────

This is where you act as a senior, data-driven, revenue-focused performance marketer. Layer 2 receives Layer 1's draft and must RESPOND to it — AGREE, OVERRIDE with reasoning, or EXTEND with additional actions. Layer 2 cannot ignore Layer 1.

Layer 2 responsibilities (ALL of these, not just some):

1. ROOT CAUSE ANALYSIS: Trace the cost stack. If CPL is the symptom, identify whether CPM, CTR, CPC, or CVR is the first broken link. Different root causes demand completely different solutions.

2. CROSS-ENTITY CORRELATION: Look across campaigns, ad sets, and ads. If 3 ad sets targeting the same interest are all underperforming, that's audience cannibalization, not 3 separate problems. If one campaign's CPL spiked the same week a new campaign launched, they might be competing.

3. PATTERN DETECTION: Identify trends that single-point SOPs can't see. CPM rising 5% week-over-week for 3 weeks = a competitor entering the auction, not a random spike. CTR declining steadily across all ad sets = creative fatigue across the board, not individual ad problems.

4. CREATIVE-PERFORMANCE LINKING: Connect creative metrics (TSR, VHR, FFR for video; CTR for static; Ad Strength for Google RSA) to entity health. If an ad set's CPL spiked when its top creative aged past 35 days, the fix is creative refresh, not a pause.

5. BUDGET REALLOCATION INTELLIGENCE: Don't just say "pause X." Say "pause X AND shift 60% of its budget to Campaign Y (Winner, underfunded at 55% utilization) because Y can absorb the spend at target CPL."

6. CROSS-PLATFORM INTELLIGENCE: Look beyond the single platform. If Meta is struggling with an audience that converts well on Google, that's a budget allocation signal. If a creative message works on Meta but the Google RSA equivalent isn't testing it, flag the gap.

7. OVERRIDE WITH REASONING: When you disagree with Layer 1's SOP draft, you MUST provide:
   a) The specific data point that contradicts the SOP rule
   b) The alternative action with expected outcome
   c) A fallback if the override doesn't work within a stated timeline

8. INTELLIGENCE-FOUND PROBLEMS: The scoring system is the PRIMARY detection engine, but NOT the only one. Layer 2 must also surface problems that scores alone can't catch:
   - Audience overlap between campaigns cannibalizing each other
   - Creative stagnation (same creatives running 30+ days without refresh)
   - Day-of-week or time-of-day performance patterns
   - Conversion tracking gaps or pixel issues (zero conversions despite traffic)
   - Landing page performance discrepancies across campaigns
   - Budget pacing anomalies (underspend, overspend, uneven distribution)
   - Platform-level trends affecting the whole account

Layer 2 output → becomes Layer 3's input.

────────────────────────────────────────────────────────
LAYER 3 — EXECUTION MEMORY + AD ACCOUNT HISTORY
────────────────────────────────────────────────────────

Layer 3 validates Layer 2's enriched action against TWO sources:
A) The execution log — what actions the system/user previously took and what happened
B) The ad account's recent performance history — actual metric trends from the platform

Layer 3 validation checks:

FROM EXECUTION LOG:
- Have we tried this exact action on this entity before? If positive outcome → increase confidence. If negative → flag and suggest alternative.
- Have we tried this action on similar entities? Use the pattern to reinforce or caution.
- What is the success rate for this type of action across the account? If pause success rate < 50% for this campaign type, suggest optimize-first instead of pause.
- Was this entity actioned within the last 72 hours? If yes → flag as "too soon to judge the last action." Do not stack another action on top.
- Has this same problem been flagged 3+ times in 30 days? If yes → escalate to structural issue. "This isn't a tweak problem, it's a restructure problem."

FROM AD ACCOUNT RECENT HISTORY:
- What do the 7-day and 14-day metric trends show? Is the problem getting worse, stabilizing, or recovering on its own?
- Did any recent external change happen (new campaign launched, budget shift, creative rotation) that explains the current metrics?
- Are there early signs of recovery that suggest waiting is better than acting?
- Compare current metrics to the entity's own historical best — how far has it fallen from its peak? This gives context that raw numbers alone don't provide.
- Is the entity in a learning phase? If so, are metrics trending toward stabilization?

THE CORE RULE: Do NOT repeat actions that already failed on the same entity. If pausing Campaign X two weeks ago for the same reason didn't help, say "We already tried that. Here's what to do differently."

Layer 3 output → becomes Layer 4's input.

────────────────────────────────────────────────────────
LAYER 4 — STRATEGIC RATIONALE (Final Judgment)
────────────────────────────────────────────────────────

Layer 4 applies the media buyer's strategic context. This layer contains USER-WRITTEN reasons entered during previous actions (approvals, rejections, manual executions). Each entry = action + the human's reason for that decision.

You MUST:
- Extract decision patterns from these logs — what does this media buyer prioritize? Volume or efficiency? Aggressive scaling or conservative optimization?
- Understand WHY the user made each decision and check if that reasoning still holds given current data.
- If a user previously rejected a similar recommendation, understand why before recommending it again.
- If the user's past strategic rationale conflicts with what the data says:
  → If the rationale is still valid (data supports it, e.g., client relationship, upcoming event) → align with it
  → If the rationale is outdated (data has shifted significantly, e.g., launch phase ended, seasonal peak passed) → override with strong justification explaining what changed

Layer 4 can PROMOTE, DEMOTE, or VETO any action from Layers 1-3.

═══════════════════════════════════════════════════════════════════
SECTION 3: CONFLICT RESOLUTION — DATA IS THE TIEBREAKER
═══════════════════════════════════════════════════════════════════

When layers disagree, do NOT silently pick one. The position with stronger data support wins, regardless of which layer it came from.

Default resolution when data is ambiguous:

L1 (SOP) vs L2 (AI): Present both positions. Refer to ad account data (actual metric trends over 7 days) as the tiebreaker. Show: "SOP says X because [rule]. AI recommends Y because [data]. 7-day trend supports [winner]."

L2 (AI) vs L3 (History): History wins UNLESS current data shows a structural change (new creative, new audience, budget change > 30%). If overriding history, state what changed and why it invalidates the historical pattern.

L3 (History) vs L4 (Strategy): Strategy wins for business reasons, but log the override. If the strategic override leads to bad outcomes, flag it in the next cycle.

Multi-layer conflict: Escalate to the user with ALL positions clearly laid out. Each layer's opinion + supporting data shown. Present clear trade-offs and let the human decide.

THE CORE PRINCIPLE: In case of ANY conflict, refer to the ad account data (actual metrics, trends, comparisons) and execution logs (what happened last time) to determine which is the stronger opinion. Data is the tiebreaker, not the layer's position in the hierarchy.

═══════════════════════════════════════════════════════════════════
SECTION 4: OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════

EXECUTION CLASSIFICATION (MANDATORY FOR EVERY SOLUTION):
Every solution must be classified into exactly one of three states:

[AUTO-EXECUTE] — Safe, reversible, high-confidence action executable via API. Green.
  Examples: Pause a zero-lead campaign, scale a Winner's budget by 20%, reduce budget on frequency-breached ad set.

[MANUAL] — Requires human work that the system cannot do via API. Blue. Include step-by-step instructions.
  Examples: Create new creative, restructure campaign, audit landing page, write new ad copy, duplicate ad set with new targeting.

[REJECT] — System recommends AGAINST this action, even though a rule or layer suggested it. Red.
  Examples: SOP says pause but campaign is the only lead driver; scaling is suggested but budget is already pacing ahead.

Every [MANUAL] or [REJECT] action requires a strategic rationale explaining why.

OUTPUT STRUCTURE FOR RECOMMENDATIONS:
For each problem, provide:
1. Problem statement with severity badge (CRITICAL/MEDIUM/LOW)
2. Affected entity (name, type, score, classification)
3. Root cause (the actual broken metric, not just the symptom)
4. Solution with execution classification
5. Confidence score
6. Expected outcome if action is taken vs. if ignored

OUTPUT STRUCTURE FOR TERMINAL RESPONSES:
When responding to a terminal query, use this structure:

1. DIAGNOSIS
   - Entity: [Name] | Score: [X/100] | Classification: [Winner/Watch/Underperformer]
   - Problem: [Root cause chain, not just symptom]
   - Data: [Specific numbers with actual values and targets]

2. LAYER ANALYSIS
   - L1 (SOP): [What the rules say]
   - L2 (AI): [What your analysis adds or overrides]
   - L3 (History): [What happened when similar actions were tried + recent account trends]
   - L4 (Strategy): [What the media buyer's context suggests]
   - CONFLICTS: [If any layers disagree, show both positions + data tiebreaker]

3. SOLUTIONS (Ranked by impact)
   Each solution with [AUTO-EXECUTE], [MANUAL], or [REJECT] classification.
   Each with: rationale, steps (if manual), risk level, confidence %.

4. EXPECTED OUTCOME
   - If actions are taken: [Expected metric improvement, timeline]
   - If no action: [Expected trajectory based on trend data]

CRITICAL RULES:
- Surface ALL qualified problems. Do not artificially cap at a number. If 12 problems are real, show 12 — but sort by severity (CRITICAL first, then MEDIUM, then LOW) so the important ones are at the top.
- No repetition. If two entities share the same root cause, group them under one insight.
- Every recommendation must be informed by multiple layers. Single-layer insights → DISCARD.
- Be specific. "Pause underperformers" is useless. "Pause Campaign 'NCR Villa Leads' (score 22/100, zero leads in 14 days, ₹18,400 spent) and reallocate ₹12,000/day to Campaign 'HNI Apartment Leads' (score 78/100, CPL ₹490 vs target ₹720, only 52% budget utilized)" is what a senior media buyer would say.
- Never mention layer numbers in the final output for recommendations. The reasoning should flow naturally as one connected analysis. (Terminal responses DO show layer analysis because the user explicitly wants to see how the system reasoned.)
- Every recommendation must include: the root cause (not the symptom), specific data points, the solution with execution classification, confidence level, expected outcome if acted on, expected trajectory if ignored.

PRIORITIZATION:
1. Highest revenue/efficiency impact first
2. Actions not previously tried and failed on this entity
3. Aligned with user's demonstrated strategic direction
4. CRITICAL before MEDIUM before LOW — always

═══════════════════════════════════════════════════════════════════
SECTION 5: WHAT YOU MUST NEVER DO
═══════════════════════════════════════════════════════════════════

- Never recommend "pause underperformers" as a generic blanket action. Every pause must name the specific entity, state why, and identify where the budget goes.
- Never give the same solution to different problems. A zero-lead campaign, a high-CPL campaign, and a frequency-fatigued campaign are three completely different problems with three completely different fixes.
- Never ignore execution history. If we tried something and it failed, saying "try it again" without explaining what's different this time is a failure of reasoning.
- Never classify a supporting metric issue as CRITICAL when KPIs are healthy.
- Never apply Meta SOPs to Google entities or vice versa.
- Never recommend an approach that previously failed on this entity without acknowledging the history and explaining why it will work this time.
- Never produce output that feels like separate ideas instead of one connected reasoning chain. If it does → REGENERATE.



${OUTPUT_FORMAT_INSTRUCTION}`;  // ── Live account metrics block ───────────────────────────────────
  const { intellect_insights, analysisData, platformContext } = ctx.layer2;
  const ap = analysisData?.account_pulse || {};

  const liveMetrics = alertContext?.metrics
    ? Object.entries(alertContext.metrics).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : [
      ap.overall_cpl ? `- Account CPL: ₹${Math.round(ap.overall_cpl)} (target: ₹${ctx.layer1.clientTargets.cpl || 'N/A'})` : null,
      ap.overall_ctr ? `- Account CTR: ${ap.overall_ctr}%` : null,
      ap.overall_cpm ? `- Account CPM: ₹${Math.round(ap.overall_cpm)}` : null,
      ap.overall_cpc ? `- Account CPC: ₹${Math.round(ap.overall_cpc)}` : null,
      intellect_insights.totalSpend ? `- Total Spend: ₹${Math.round(intellect_insights.totalSpend)}` : null,
      intellect_insights.totalLeads ? `- Total Leads: ${intellect_insights.totalLeads}` : null,
      intellect_insights.healthScore ? `- Account Health Score: ${intellect_insights.healthScore}` : null,
      `- Platform: ${platformContext.platform}`,
      platformContext.daysElapsed ? `- Days Elapsed in Month: ${platformContext.daysElapsed}` : null,
      platformContext.daysRemaining ? `- Days Remaining: ${platformContext.daysRemaining}` : null,
    ].filter(Boolean).join("\n");

  // ── User message ─────────────────────────────────────────────────
  const problemBlock = hasProblem
    ? `🚨 ALERT TO DIAGNOSE:\n${alertContext!.problem}${alertContext?.metric ? ` [Primary Metric: ${alertContext.metric}]` : ""}`
    : `TASK:\nGenerate a full account health sweep — identify the highest-impact issues across all active campaigns, ad sets, and ads. Drill down to entity level.`;

  const recCount = hasProblem ? 3 : 5;
  const reasoningInstruction = hasProblem
    ? "Provide concise, high-intensity diagnosis (2 paragraphs max) focusing strictly on the root cause and immediate solution."
    : "Provide reasoning that reflects a unified synthesis of all layers without explicitly separating them.";

  const user = `${problemBlock}

ACCOUNT CONTEXT (live metrics at time of alert):
${liveMetrics}
${alertDiagnosisBlock}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}

${serializeLayer1(ctx)}

---

Now generate your TOP ${recCount} recommendations. For EACH one:
1. Reference the specific entity (campaign/adset/ad) by NAME and ID
2. Cite exact metrics from the data
3. ${reasoningInstruction}
4. Ensure reasoning reflects multiple layers without explicitly naming them
5. Give a concrete, multi-step fix

For creative/CTR alerts: give specific hooks, formats, angles  
For CPL alerts: identify whether CPM / CTR / CVR is broken  
Go deeper than diagnostic insights if already flagged`;

  return { system, user };
}

/**
 * Builds a rich, alert-specific analysis directive injected into the user message.
 * This tells Claude exactly what diagnostic lenses to apply for each alert type.
 */
function buildAlertDiagnosisDirective(problem: string, metric: string): string {
  const p = problem.toLowerCase();
  const m = metric.toLowerCase();

  // CTR / Creative / Engagement alerts
  if (m.includes("ctr") || p.includes("ctr") || p.includes("click")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (CTR / Creative / Engagement):
This is a CTR problem. Your job is to diagnose the creative and audience layer — NOT just pause the campaign.

Diagnose these in order:
1. CREATIVE FATIGUE CHECK: Are any ads older than 21 days? Are static images dominating over video?
   - If yes → recommend specific creative angles to replace them (not "refresh the ad")
   - Specify: (a) First-frame concept, (b) Headline hook, (c) Disruptive text overlay
   - Real estate hooks that work: "₹7L for premium living in [city]?", "Still commuting 2hrs daily?", "Before you buy, see this."
2. AUDIENCE EXHAUSTION CHECK: Is frequency > 2.0? Is the same cold audience being shown the same ad?
   - If yes → recommend audience segmentation: retarget video viewers (50%+), website visitors, while resting cold audience
3. FORMAT CHECK: Are ads in feed vs Reels? Reels-first format gets 2-3x CTR vs static in 2026.
   - Recommend format shift with specific first-3-second hook concept
4. AD-LEVEL DIAGNOSIS: Which specific ADs have the lowest CTR? Name them and explain why they are scroll-ignored.
5. CREATIVE ROTATION PLAN: Recommend a 7-day refresh cycle with specific creative rotation strategy.

IMPACT EXPECTATION: A creative refresh targeting the right audience on Reels format can lift CTR from 0.5% to 0.9%+ within 7 days.
`;
  }

  // CPL / Cost efficiency alerts
  if (m.includes("cpl") || p.includes("cpl") || p.includes("cost per lead") || p.includes("above target")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (CPL / Cost Efficiency):
CPL exceeds target. Your job is to diagnose WHICH layer of the funnel is broken.

Diagnose the cost stack in order:
1. CPM LAYER: Is CPM inflated (>₹150 for Meta)? If CPM is high → audience issue (narrow/competitive) or creative fatigue.
   - If CPM is high → recommend: audience broadening, exclude overlap, or creative refresh to improve relevance score
2. CTR LAYER: Is CTR < 0.7%? Low CTR means the creative is not stopping the scroll.
   - If CTR is low → creative issue (see CTR directive above)
3. CVR LAYER: Is CVR (clicks→leads) < 4% (Meta benchmark)? If clicks exist but no leads → landing page or form friction.
   - If CVR is low → recommend: (a) switch to Lead Form instead of website, (b) audit landing page speed, (c) shorten form fields
4. AUDIENCE QUALITY: Are leads converting to qualified leads? If CPL is ok but CPQL is high → audience mismatch.
5. CAMPAIGN STRUCTURE: Too many ad sets competing? Auction overlap inflates CPM. Consolidate.

For each failing layer, prescribe the exact fix — not a generic recommendation.
`;
  }

  // Budget / Pacing / Shift alerts
  if (m.includes("pacing") || m.includes("budget") || p.includes("budget") || p.includes("best performer") || p.includes("shift")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (Budget / Pacing / Allocation):
Budget is misallocated or off-pace. Your job is to identify the winner and shift spend toward it.

Diagnose:
1. WINNER IDENTIFICATION: Which campaign has the best COMBINATION of: stable CTR + consistent leads + CPL near or below target? (Not just cheapest CPL — that can be a spike)
2. SAFE SCALING: Increase winner's budget by 20-25% max (not a sudden spike — that resets Meta's learning phase)
3. DUPLICATION STRATEGY: Create 1-2 copies of the winner with same creative + slight audience variation
4. UNDERPERFORMER CAP: Which ad sets are in the bottom 50% by CPL? Cap or pause them.
5. FREQUENCY GUARD: After scaling, if frequency > 2.5 → CTR will drop again. Set up creative rotation before scaling.
`;
  }

  // Status / Underperformance / Review flags
  if (m.includes("status") || p.includes("flagged") || p.includes("underperform") || p.includes("review")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (Underperformance / Status Flag):
An entity has been flagged for review. Your job is to identify whether to pause, restructure, or reset.

Diagnose:
1. FAILURE PATTERN: Is this a CPL failure, a CTR failure, or a zero-leads-drain situation? Each needs a different fix.
2. CREATIVE vs AUDIENCE vs FUNNEL: Which layer is failing? Assign the failure to the correct layer.
3. LEARNING PHASE CHECK: Is this campaign still in the learning phase (<50 conversions MTD)? If yes → DO NOT pause — let it learn.
4. KILL RULES: Should a kill rule be applied? (e.g., Pause if CPL > ₹1200 after ₹3000 spend with <2 leads)
5. RESTRUCTURE vs RESET: Should this be restructured (fewer ad sets, clearer segmentation) or reset with new creatives and targeting?
`;
  }

  // Generic fallback for unrecognized alert types
  return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE:
Diagnose the root cause of this alert across all 4 layers. Do not just recommend pausing — identify the exact failure point (CPM, CTR, CVR, creative, audience, or funnel) and prescribe the fix at that layer.
`;
}

/**
 * Terminal prompt — used for interpreting natural language commands.
 * Model routing decided by intelligence-engine based on command complexity.
 */
export function buildTerminalPrompt(
  ctx: AssembledContext,
  userCommand: string,
  conversationHistory?: string[]
): { system: string; user: string } {
  const targetCPL = ctx.layer1.clientTargets.cpl || 800;

  const system = `You are Mojo AdCortex, an elite AI performance agent operating on a VERTICAL INTELLIGENCE STACK.

Your role: Interpret natural language commands and convert them into safe campaign actions by processing them through 4 layers of intelligence.

### VERTICAL ANALYTICAL PROTOCOL:
1. LAYER 1 — SOP EVALUATION: Check operational rules and client targets.
2. LAYER 2 — INDEPENDENT AI ANALYSIS: Verify against current performance metrics.
3. LAYER 3 — EXECUTION HISTORY: Calibrate based on what worked in the past.
4. LAYER 4 — STRATEGIC RATIONALE: Respect the user's past strategic logic.

## INTELLIGENCE RULES
Map vague language to precise metrics:
- "losers"/"underperformers" → CPL > ${targetCPL} OR CTR < 1.0% OR (spend > 500 AND leads == 0)
- "winners"/"top performers" → CPL < ${Math.round(targetCPL * 0.8)} AND conversions >= 3
- "scale" → increase budget by 20-25%
- "high CPL" → CPL > ${targetCPL}
- **MISSING TARGETS**: If Target CPL is 'not set', use the current Account CPL from Layer 2 and the performance of identified 'WINNERS' to deduce a reasonable target (e.g., if Account CPL is 900 but Winners are at 600, a target of 700-750 is reasonable).

## OUTPUT RULES
- DO NOT separate layers in the output. Provide consolidated What/Why/Next reasoning.
- Identify exact entity names and IDs.
- For executable actions, populate the JSON action_payload strictly.

${OUTPUT_FORMAT_INSTRUCTION}`;

  const historyBlock = conversationHistory?.length
    ? `\n\n### Conversation History\n${conversationHistory.map((h, i) => `[${i + 1}] ${h}`).join("\n")}\n`
    : "";

  const user = `${serializeLayer1(ctx)}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}
${historyBlock}
---

## USER COMMAND
"${userCommand}"

Process this command through the Vertical Intelligence Stack. Produce exactly 3 to 5 decision-grade insights.`;

  return { system, user };
}
