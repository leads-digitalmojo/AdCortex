/**
 * Fallback Solution Tiers — Mojo AdCortex
 *
 * This file provides FALLBACK deterministic solutions used when the real
 * Claude AI pipeline (L2/L3) fails. The primary solution generation now
 * happens in solution-pipeline.ts via real Claude API calls.
 *
 * generateSolutionTiers() is called only when:
 *   - The Claude API is unavailable
 *   - L2 returns incomplete/unparseable output
 *   - A network or timeout error occurs during L2/L3 calls
 */

import type { DetectedProblem } from "./problem-detector";
import type { SolutionOption } from "./solution-pipeline";

interface TieredSolutions {
  primary: SolutionOption;
  secondary: SolutionOption[];
  rejection: SolutionOption[];
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

/**
 * FALLBACK: Generate deterministic solution tiers for a detected problem.
 * Called only when the Claude AI pipeline (L2/L3) fails.
 * Primary classification is MANUAL (not AUTO-EXECUTE) since AI validation was skipped.
 */
export function generateSolutionTiers(
  problem: DetectedProblem,
  entityContext: { accountScore: number; entityScore: number; spend: number; leads: number }
): TieredSolutions {
  const primary = selectFallbackPrimarySolution(problem, entityContext);
  const secondary = generateFallbackSecondary(problem, primary);
  const rejection = generateFallbackRejections(problem);

  return { primary, secondary, rejection };
}

function selectFallbackPrimarySolution(
  problem: DetectedProblem,
  context: { accountScore: number; entityScore: number; spend: number; leads: number }
): SolutionOption {
  const trigger = problem.triggers[0];

  // ZERO LEAD DRAIN: Pause (MANUAL fallback — AI was not available to validate)
  if (trigger === "zero_lead_budget_drain" || trigger === "zero_lead_heavy_spend") {
    return {
      classification: "MANUAL",
      title: `Review and consider pausing ${problem.entity.name} (zero leads + high spend)`,
      rationale: `[Fallback — AI analysis unavailable] This ${problem.entity.type} has spent significantly without generating leads. ` +
                 `SOP recommendation is to pause, but human review is required since AI validation was skipped.`,
      steps: [
        `1. Confirm zero leads are not a tracking issue before pausing`,
        `2. Pause ${problem.entity.type} "${problem.entity.name}" via dashboard or API`,
        `3. Monitor replacement volume for next 72 hours`,
        `4. Reallocate budget to performers only after confirming replacement`,
      ],
      risk: "Medium",
      confidence: 80,
      expectedOutcome: `If confirmed: budget stops leaking and account maintains volume through replacement sources.`,
      actionPayload: {
        intent: `Pause ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("pause", problem.entity.type, problem.platform),
          parameters: { reason: "Zero leads with high spend (fallback)" },
        },
        execution_plan: [
          `Verify zero leads are not a tracking issue`,
          `Pause ${problem.entity.name} after confirmation`,
          "Monitor account for volume replacement over next 72 hours",
          "Reallocate budget to proven performers",
        ],
        strategic_rationale: "SOP-driven pause — verify tracking before executing",
        risk_checks: ["Confirm zero leads are not tracking issue before pausing"],
      },
    };
  }

  // WINNER UNDERFUNDED: Scale budget
  if (trigger === "winner_underfunded") {
    return {
      classification: "MANUAL",
      title: `Scale budget on winning ${problem.entity.type}`,
      rationale: `[Fallback — AI analysis unavailable] This ${problem.entity.type} scores above 70 but budget utilization is below 60%. ` +
                 `Review and scale if CPL targets allow.`,
      steps: [
        `1. Verify current CPL is within target before scaling`,
        `2. Increase daily budget by 20% for this ${problem.entity.type}`,
        `3. Monitor CPL over next 48 hours`,
        `4. Scale further if CPL stays below target`,
      ],
      risk: "Low",
      confidence: 75,
      expectedOutcome: `Budget utilization improves. Lead volume increases. CPL maintains if winner efficiency holds.`,
      actionPayload: {
        intent: `Scale budget for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("scale_up", problem.entity.type, problem.platform),
          parameters: { scalePercent: 20, reason: "Winner underfunded (fallback)" },
        },
        execution_plan: [
          "Verify CPL is within target",
          "Increase daily budget by 20%",
          "Monitor CPL over 48 hours",
        ],
        strategic_rationale: "Scale proven winners to increase lead volume at target efficiency",
        risk_checks: ["Verify CPL doesn't drift above target after scaling"],
      },
    };
  }

  // FREQUENCY BREACH: Reduce budget
  if (trigger === "frequency_breach") {
    return {
      classification: "MANUAL",
      title: "Lower frequency by reducing budget or rotating creative",
      rationale: `[Fallback — AI analysis unavailable] Frequency appears elevated. Review current frequency metric and consider reducing budget by 20-30% or rotating creative.`,
      steps: [
        `1. Check current frequency metric (impressions / unique reach)`,
        `2. If frequency > 3: reduce budget by 25% or pause for 24 hours`,
        `3. Introduce new creative to reach fresh inventory`,
        `4. Monitor CTR and frequency over next 48 hours`,
      ],
      risk: "Low",
      confidence: 70,
      expectedOutcome: `Frequency normalizes. CTR improves as audience fatigue lifts.`,
      actionPayload: {
        intent: `Reduce frequency on ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("scale_down", problem.entity.type, problem.platform),
          parameters: { scalePercent: 25, reason: "Frequency breach (fallback)" },
        },
        execution_plan: [
          "Reduce budget by 25% to lower frequency",
          "Introduce new creative assets",
          "Monitor CTR and frequency daily",
        ],
        strategic_rationale: "Frequency reduction lowers audience fatigue and cost per impression",
        risk_checks: ["Monitor volume during and after reduction"],
      },
    };
  }

  // CREATIVE AGING: Refresh creative
  if (trigger === "creative_aging") {
    return {
      classification: "MANUAL",
      title: "Refresh creative assets to combat fatigue",
      rationale: `[Fallback — AI analysis unavailable] Creative shows aging signals. Design or source 2-3 new creative variations and A/B test against existing.`,
      steps: [
        `1. Audit creative performance (CTR, frequency trends)`,
        `2. Design or source 2-3 new creative variations`,
        `3. Set up A/B test: old creative (hold) vs. new creative (test)`,
        `4. Monitor CTR improvement within first 3 days`,
      ],
      risk: "Low",
      confidence: 75,
      expectedOutcome: `CTR improves 10-20% within 3 days. Frequency curve flattens.`,
      actionPayload: {
        intent: `Refresh creative for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Audit current creative performance",
          "Design or source 2-3 new creative variations",
          "Set up A/B test with 50/50 budget split",
        ],
        strategic_rationale: "Creative fatigue requires new assets",
        risk_checks: ["Keep top performer running at reduced spend during test"],
      },
    };
  }

  // DEFAULT: Manual review
  return {
    classification: "MANUAL",
    title: `Review ${problem.entity.type} performance and optimize`,
    rationale: `[Fallback — AI analysis unavailable] This ${problem.entity.type} is underperforming (score ${problem.entity.score.toFixed(0)}/100). ` +
               `Audit targeting, creative, and bidding to identify optimization levers.`,
    steps: [
      `1. Compare metrics against account average`,
      `2. Identify weakest metric (CPL, CTR, CVR)`,
      `3. Build optimization hypothesis`,
      `4. Test and monitor for 48-72 hours`,
    ],
    risk: "Low",
    confidence: 55,
    expectedOutcome: `Performance hypothesis validated. Score improves 5-15 points within 5-7 days of targeted fixes.`,
    actionPayload: {
      intent: `Review ${problem.entity.name} performance`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Compare metrics against account benchmarks",
        "Identify weakest metric (CPL, CTR, CVR)",
        "Build and test optimization hypothesis",
        "Monitor results for 48-72 hours",
      ],
      strategic_rationale: "Underperformance requires systematic testing",
      risk_checks: ["Test changes on small portion before full rollout"],
    },
  };
}

function generateFallbackSecondary(
  problem: DetectedProblem,
  primary: SolutionOption
): SolutionOption[] {
  const alternatives: SolutionOption[] = [];

  // Offer expert review as a conservative alternative
  alternatives.push({
    classification: "MANUAL",
    title: `Get expert review on ${problem.entity.name}`,
    rationale: `Before taking action, request human expert review. Especially important since AI validation was unavailable for this recommendation.`,
    steps: [
      `1. Export entity performance report (7-day trend)`,
      `2. Review diagnosis and proposed action`,
      `3. Confirm action with account manager`,
      `4. Execute with documented rationale`,
    ],
    risk: "Low",
    confidence: 85,
    expectedOutcome: `Higher confidence in decision due to human validation. Potential to uncover context automation missed.`,
  });

  return alternatives;
}

function generateFallbackRejections(problem: DetectedProblem): SolutionOption[] {
  const rejections: SolutionOption[] = [];

  if (problem.triggers.some((t) => t.includes("zero_lead"))) {
    rejections.push({
      classification: "REJECT",
      title: "Do NOT scale budget on this entity",
      rationale: `This entity has zero leads. Scaling budget will only increase the budget drain. Fix the conversion issue first.`,
      steps: [],
      risk: "High",
      confidence: 95,
      expectedOutcome: `Avoided wasting budget on zero-performing spend.`,
    });
  }

  if (problem.entity.type === "account" && problem.severity === "CRITICAL") {
    rejections.push({
      classification: "REJECT",
      title: "Do NOT pause the entire account",
      rationale: `Pausing all campaigns will stop all lead flow. Identify and pause individual underperformers instead.`,
      steps: [],
      risk: "High",
      confidence: 99,
      expectedOutcome: `Prevented catastrophic volume loss. Maintains winners while fixing problems.`,
    });
  }

  return rejections;
}
