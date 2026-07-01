/**
 * Problem Deduplication & Hierarchy Logic
 *
 * Prevents duplicate problems from appearing at multiple hierarchy levels (account, campaign, adset, ad).
 * Groups related problems and selects the most actionable/specific level for presentation.
 *
 * Strategy:
 * - Group problems by trigger/root cause
 * - Keep the lowest (most specific) level that is actionable
 * - Link parent-child relationships for context
 * - Flag if the same issue spans multiple hierarchy levels
 */

import type { DetectedProblem, SeverityTier } from "./problem-detector";
import type { SolutionOption } from "./solution-pipeline";

export interface EnhancedSolution extends SolutionOption {
  tier: "PRIMARY" | "SECONDARY" | "REJECTION";
  whyThisTier: string; // Clear explanation of confidence level
  prerequisites?: string[]; // What must be true for this to work
  blockers?: string[]; // What prevents this from working
  successCriteria?: string[]; // How to measure if it worked
}

const HIERARCHY_LEVELS = {
  account: 0,
  campaign: 1,
  adset: 2,
  ad_group: 2,
  ad: 3,
};

type HierarchyLevel = keyof typeof HIERARCHY_LEVELS;

/**
 * Extract the core trigger/cause from a problem's trigger list
 * Returns the most semantic/actionable trigger
 */
function getPrimaryTrigger(problem: DetectedProblem): string {
  if (!problem.triggers || problem.triggers.length === 0) {
    return `score_${problem.severity.toLowerCase()}`;
  }

  // Prioritize specific, actionable triggers
  const actionableTriggers = [
    "zero_lead_budget_drain",
    "zero_lead_heavy_spend",
    "inflated_cpc",
    "creative_aging",
    "frequency_breach",
    "budget_pacing_emergency",
    "entity_freefall",
    "winner_underfunded",
    "google_is_budget_lost",
    "weak_ad_strength",
  ];

  for (const trigger of actionableTriggers) {
    if (problem.triggers.includes(trigger)) return trigger;
  }

  return problem.triggers[0];
}

/**
 * Check if two problems are related (same root cause, different hierarchy levels)
 */
function areProblemsRelated(p1: DetectedProblem, p2: DetectedProblem): boolean {
  const t1 = getPrimaryTrigger(p1);
  const t2 = getPrimaryTrigger(p2);

  // Same trigger = related
  if (t1 === t2) return true;

  // Same primary metric = likely related
  if (p1.symptomMetric === p2.symptomMetric && p1.rootCause.primaryMetric === p2.rootCause.primaryMetric) {
    return true;
  }

  return false;
}

/**
 * Select the most actionable problem level from a group
 * Prefer: specific level (ad > adset/ag > campaign) unless account is critical
 */
function selectPrimaryProblem(problems: DetectedProblem[]): DetectedProblem {
  if (problems.length === 1) return problems[0];

  // If account is CRITICAL, use that as the primary (it's the highest impact)
  const criticalAccount = problems.find(p => p.entity.type === "account" && p.severity === "CRITICAL");
  if (criticalAccount) return criticalAccount;

  // Otherwise, prefer the most specific (lowest hierarchy level) that is actionable
  const byLevel = problems.sort((a, b) => {
    const levelA = HIERARCHY_LEVELS[a.entity.type as HierarchyLevel] ?? 99;
    const levelB = HIERARCHY_LEVELS[b.entity.type as HierarchyLevel] ?? 99;
    return levelB - levelA; // Reverse: lower level (more specific) first
  });

  return byLevel[0];
}

/**
 * Deduplicate problems by eliminating same issue at multiple hierarchy levels
 * Returns only the most specific (actionable) version of each problem
 */
export function deduplicateProblems(problems: DetectedProblem[]): DetectedProblem[] {
  if (problems.length === 0) return [];

  const processed = new Set<string>();
  const result: DetectedProblem[] = [];

  for (const problem of problems) {
    if (processed.has(problem.id)) continue;

    // Find all related problems (same trigger/root cause)
    const related = problems.filter(p =>
      !processed.has(p.id) && areProblemsRelated(p, problem)
    );

    // Select only the most specific/actionable one
    const primary = selectPrimaryProblem(related);

    // Mark all related as processed (so we skip them)
    related.forEach(p => processed.add(p.id));

    // Add only the primary problem to results
    result.push(primary);
  }

  // Sort by severity + specificity
  return result.sort((a, b) => {
    const severityOrder = { CRITICAL: 0, MEDIUM: 1, LOW: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    // Then by how specific (lower hierarchy = more specific)
    const levelA = HIERARCHY_LEVELS[a.entity.type as HierarchyLevel] ?? 99;
    const levelB = HIERARCHY_LEVELS[b.entity.type as HierarchyLevel] ?? 99;
    return levelA - levelB;
  });
}

/**
 * Enhance solutions with clear tier classification and reasoning
 */
export function enhanceSolutionTiers(
  solutions: SolutionOption[],
  problem: DetectedProblem,
  context?: { accountScore?: number; entityScore?: number; spendLevel?: "high" | "medium" | "low" }
): EnhancedSolution[] {
  return solutions.map(solution => ({
    ...solution,
    tier: mapClassificationToTier(solution.classification),
    whyThisTier: buildTierReasoning(solution, problem, context),
    prerequisites: buildPrerequisites(solution, problem),
    blockers: buildBlockers(solution, problem),
    successCriteria: buildSuccessCriteria(solution, problem),
  }));
}

function mapClassificationToTier(classification: string): "PRIMARY" | "SECONDARY" | "REJECTION" {
  switch (classification) {
    case "AUTO-EXECUTE": return "PRIMARY";
    case "MANUAL": return "SECONDARY";
    case "REJECT": return "REJECTION";
    default: return "SECONDARY";
  }
}

function buildTierReasoning(
  solution: SolutionOption,
  problem: DetectedProblem,
  context?: any
): string {
  if (solution.classification === "AUTO-EXECUTE") {
    return `This is the highest-confidence action for this problem. Confidence: ${solution.confidence}%. ` +
           `Risk level: ${solution.risk}. This solution maps directly to the detected root cause (${problem.rootCause.primaryMetric}).`;
  }

  if (solution.classification === "MANUAL") {
    return `This is an alternative that requires manual review. Confidence: ${solution.confidence}%. ` +
           `Use this if the primary action doesn't apply or you need more control. Consider this when: ` +
           `the account context suggests manual oversight is preferred.`;
  }

  if (solution.classification === "REJECT") {
    return `This action is not recommended for this specific problem. Reason: ${solution.rationale}. ` +
           `Confidence that rejection is correct: ${solution.confidence}%.`;
  }

  return `Alternative approach. Confidence: ${solution.confidence}%.`;
}

function buildPrerequisites(solution: SolutionOption, problem: DetectedProblem): string[] {
  const prerequisites: string[] = [];

  if (solution.title.toLowerCase().includes("pause")) {
    prerequisites.push("Confirm the entity has alternative sources of volume");
    prerequisites.push("Verify tracking is not causing false zero-lead signals");
  }

  if (solution.title.toLowerCase().includes("scale")) {
    prerequisites.push("Budget availability for scaling");
    prerequisites.push("Verified conversion path and tracking");
    prerequisites.push("Account has no daily/campaign budget caps that would prevent scaling");
  }

  if (solution.title.toLowerCase().includes("creative")) {
    prerequisites.push("Fresh creative assets available");
    prerequisites.push("Sufficient performance data to judge creative effectiveness");
  }

  if (solution.title.toLowerCase().includes("bid")) {
    prerequisites.push("Bidding strategy supports manual adjustments");
    prerequisites.push("Enough conversion volume to trust bid changes");
  }

  return prerequisites;
}

function buildBlockers(solution: SolutionOption, problem: DetectedProblem): string[] {
  const blockers: string[] = [];

  if (problem.severity === "CRITICAL" && solution.classification === "MANUAL") {
    blockers.push("This is a CRITICAL problem that typically requires immediate action, not manual review");
  }

  if (solution.title.toLowerCase().includes("scale") && problem.triggers.includes("budget_pacing_emergency")) {
    blockers.push("Budget pacing emergency means scaling up could worsen budget overspend");
  }

  if (solution.title.toLowerCase().includes("pause") && problem.entity.type === "account") {
    blockers.push("Pausing an entire account is very high risk; consider pausing campaigns instead");
  }

  if (solution.title.toLowerCase().includes("creative") && problem.entity.type === "campaign") {
    blockers.push("Creative changes at campaign level may not be possible; affects individual ads/adsets");
  }

  return blockers;
}

function buildSuccessCriteria(solution: SolutionOption, problem: DetectedProblem): string[] {
  const criteria: string[] = [];

  if (solution.title.toLowerCase().includes("pause")) {
    criteria.push(`After pause, monitor replacement volume for 24-72 hours`);
    criteria.push(`Confirm budget stopped flowing to the paused entity`);
    criteria.push(`Track if account maintains overall lead volume`);
  }

  if (solution.title.toLowerCase().includes("scale")) {
    criteria.push(`Budget increase is spent within 48 hours`);
    criteria.push(`CPL does not increase after scaling`);
    criteria.push(`CTR or conversion rate maintains or improves`);
  }

  if (solution.title.toLowerCase().includes("creative")) {
    criteria.push(`New creative rotates into delivery within 24 hours`);
    criteria.push(`CTR or frequency improves within 3-5 days`);
    criteria.push(`Audience fatigue signals decrease`);
  }

  if (solution.title.toLowerCase().includes("bid")) {
    criteria.push(`Bid changes take effect within 1-2 hours`);
    criteria.push(`CPC moves in expected direction`);
    criteria.push(`Volume maintains or improves`);
  }

  return criteria.length > 0 ? criteria : ["Monitor entity metrics for improvement over next 24-48 hours"];
}

