/**
* Dynamic Scoring Configuration Loader
*
* Loads and validates health scoring thresholds and weights from configuration
* instead of hardcoding them. This allows runtime adjustment of scoring behavior.
*/

import fs from "fs";
import path from "path";

const SCORING_CONFIG_FILE = path.resolve(import.meta.dirname, "../../ads_agent/data/scoring_config_overrides.json");

export interface ScoringThresholds {
  // Cost metrics (CPL, CPC, CPQL, CPSV, CPM) — lower is better.
  // Stepped bands on ratio = actual / target. Every field here is honored by
  // scoreStagedCostDynamic / scoreWeightedCostMetric.
  cost: {
    good_ratio: number;           // ratio ≤ this → good_score (default: 1.10)
    watch_ratio: number;          // ratio ≤ this → watch_score (default: 1.20)
    poor_ratio: number;           // ratio ≤ this → poor_score (default: 1.30)
    good_score: number;           // default: 100
    watch_score: number;          // default: 70
    poor_score: number;           // default: 40
    floor_score: number;          // ratio above poor_ratio (default: 10)
  };
  // Budget pacing — absolute deviation from planned spend.
  // Stepped bands on dev = |actual / planned − 1|.
  budget: {
    good_deviation: number;       // dev ≤ this → good_score (default: 0.10)
    watch_deviation: number;      // dev ≤ this → watch_score (default: 0.15)
    good_score: number;           // default: 100
    watch_score: number;          // default: 60
    floor_score: number;          // dev above watch_deviation (default: 20)
  };
}

export interface MetricWeights {
  google: {
    account_level: {
      cpsv: number;
      budget: number;
      cpql: number;
      cpl: number;
      creative: number;
    };
  };
  meta: {
    account_level: {
      cpsv: number;
      budget: number;
      cpql: number;
      cpl: number;
      creative: number;
    };
  };
}

export interface ScoringConfig {
  version: string;
  thresholds: ScoringThresholds;
  weights: MetricWeights;
  green_threshold: number;        // score >= this = GREEN (default: 75)
  yellow_threshold: number;       // score >= this = YELLOW (default: 55) — dual-gate
  orange_threshold: number;       // score >= this = ORANGE (default: 35) — dual-gate
  // Legacy fields (deprecated after dual-gate migration):
  red_metric_weight_threshold?: number;
  red_cap_threshold?: number;
}

/**
 * Default scoring configuration matching Mojo AdCortex v1.0
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: "3.0-stepped-bands",
  thresholds: {
    // Mirrors ads_agent/scoring_engine.py score_staged_cost — the two layers must agree.
    cost: {
      good_ratio: 1.1,
      watch_ratio: 1.2,
      poor_ratio: 1.3,
      good_score: 100,
      watch_score: 70,
      poor_score: 40,
      floor_score: 10,
    },
    // Mirrors ads_agent/scoring_engine.py score_staged_budget.
    budget: {
      good_deviation: 0.10,
      watch_deviation: 0.15,
      good_score: 100,
      watch_score: 60,
      floor_score: 20,
    },
  },
  weights: {
    google: {
      account_level: {
        cpsv: 25,
        budget: 25,
        cpql: 20,
        cpl: 20,
        creative: 10,
      },
    },
    meta: {
      account_level: {
        cpsv: 25,
        budget: 25,
        cpql: 20,
        cpl: 20,
        creative: 10,
      },
    },
  },
  green_threshold: 75,
  yellow_threshold: 55,    // Dual-gate: changed from 50
  orange_threshold: 35,    // Dual-gate: new status level
  // Legacy fields kept for backward compatibility during transition
  red_metric_weight_threshold: 15,
  red_cap_threshold: 74,
};

let cachedConfig: ScoringConfig = DEFAULT_SCORING_CONFIG;

function mergeConfig(base: ScoringConfig, overrides: Partial<ScoringConfig>): ScoringConfig {
  return {
    ...base,
    ...overrides,
    thresholds: {
      ...base.thresholds,
      ...(overrides.thresholds || {}),
    },
    weights: {
      ...base.weights,
      ...(overrides.weights || {}),
    },
  };
}

function readPersistedOverrides(): Partial<ScoringConfig> | null {
  try {
    if (!fs.existsSync(SCORING_CONFIG_FILE)) return null;
    return JSON.parse(fs.readFileSync(SCORING_CONFIG_FILE, "utf-8"));
  } catch (err: any) {
    console.error("[scoring-config] Failed to read persisted overrides, using defaults:", err.message || err);
    return null;
  }
}

function writePersistedOverrides(overrides: Partial<ScoringConfig>): void {
  const dir = path.dirname(SCORING_CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCORING_CONFIG_FILE, JSON.stringify(overrides, null, 2));
}

/**
 * Load scoring configuration, merging any persisted admin overrides
 * (ads_agent/data/scoring_config_overrides.json) on top of the built-in defaults.
 * Updates the in-memory cache used by getScoringConfig()/getMetricWeights().
 * Called once at server startup; safe to call again to re-sync from disk.
 */
export async function loadScoringConfig(): Promise<ScoringConfig> {
  const overrides = readPersistedOverrides();
  cachedConfig = overrides ? mergeConfig(DEFAULT_SCORING_CONFIG, overrides) : { ...DEFAULT_SCORING_CONFIG };
  return cachedConfig;
}

/**
 * Get current scoring configuration (cached)
 */
export function getScoringConfig(): ScoringConfig {
  return cachedConfig;
}

/**
 * Update scoring configuration at runtime and persist it so the change survives
 * a server restart.
 */
export function setScoringConfig(config: Partial<ScoringConfig>): void {
  cachedConfig = mergeConfig(cachedConfig, config);
  try {
    writePersistedOverrides(cachedConfig);
  } catch (err: any) {
    console.error("[scoring-config] Failed to persist scoring config override:", err.message || err);
  }
}

/**
 * Reset to default configuration (also clears any persisted override file).
 */
export function resetScoringConfig(): void {
  cachedConfig = { ...DEFAULT_SCORING_CONFIG };
  try {
    if (fs.existsSync(SCORING_CONFIG_FILE)) fs.unlinkSync(SCORING_CONFIG_FILE);
  } catch (err: any) {
    console.error("[scoring-config] Failed to remove persisted override file:", err.message || err);
  }
}

/**
 * A metric score, or `null` when the metric could not be measured (no target
 * configured, or an unusable input). `null` is NOT zero and NOT full marks — it
 * must be excluded from the weighted average by the aggregation helpers below.
 */
export type MetricScore = number | null;

/**
 * Sentinel meaning "spend with no outcome at all" (e.g. zero leads on live spend).
 * Callers pass Infinity for this case; it scores 0 — strictly worse than the
 * floor score given to a merely expensive result.
 */
function isNoOutcomeSentinel(actual: number): boolean {
  return actual === Number.POSITIVE_INFINITY;
}

/**
 * Band comparisons need a tolerance: `1.1 - 1` is 0.10000000000000009 in IEEE 754,
 * so an account pacing at exactly 110% would otherwise fall into the next band down.
 * The same epsilon is applied in ads_agent/scoring_engine.py so both layers agree.
 */
const BAND_EPSILON = 1e-9;

function withinBand(value: number, boundary: number): boolean {
  return value <= boundary + BAND_EPSILON;
}

/**
 * Score a cost metric (CPL, CPC, CPQL, CPSV, CPM) using stepped bands.
 *
 * Canonical formula — mirrors ads_agent/scoring_engine.py score_staged_cost so the
 * Python and TypeScript layers produce the same number for the same campaign.
 *
 * ratio = actual / target
 * - ratio ≤ 1.1 → 100
 * - ratio ≤ 1.2 → 70
 * - ratio ≤ 1.3 → 40
 * - above      → 10
 *
 * Special cases:
 * - no target        → null (not measured — excluded from the weighted average)
 * - spend, no outcome→ 0 (worse than the floor: there is no result at any price)
 * - NaN              → null, with a warning; a bad input must not silently score
 */
export function scoreStagedCostDynamic(actual: number, target: number): MetricScore {
  if (!(target > 0)) return null;
  if (isNoOutcomeSentinel(actual)) return 0;
  if (!Number.isFinite(actual)) {
    console.warn(`[scoring] Non-finite cost metric (${actual}) against target ${target} — scoring as not measured.`);
    return null;
  }

  const { cost } = getScoringConfig().thresholds;
  const ratio = actual / target;
  if (withinBand(ratio, cost.good_ratio)) return cost.good_score;
  if (withinBand(ratio, cost.watch_ratio)) return cost.watch_score;
  if (withinBand(ratio, cost.poor_ratio)) return cost.poor_score;
  return cost.floor_score;
}

/**
 * Score a rate metric (CTR, CVR, TSR, VHR, FFR) using quadratic decay formula
 * Higher is better. shortfall from target is penalized.
 */
export function scoreHigher(actual: number, target: number, weight: number): number {
  if (target <= 0) return weight;
  if (actual >= target) return weight;
  const d = (target - actual) / target;
  return weight * Math.max(0, 1 - 1.5 * d - 5 * d * d);
}

/**
 * Score lead volume vs expected leads (pro-rata)
 */
export function scoreLeads(actual: number, expected: number, weight: number): number {
  if (expected <= 0) return weight;
  if (actual >= expected) return weight;
  const d = (expected - actual) / expected;
  return weight * Math.max(0, 1 - 1.5 * d - 5 * d * d);
}

/**
 * Score frequency based on funnel-layer thresholds
 */
export function scoreFrequency(freq: number, warn: number, severe: number, weight: number): number {
  if (freq <= warn) return weight;
  if (freq >= severe) return 0;
  const excess = (freq - warn) / (severe - warn);
  return weight * Math.max(0, 1 - excess * excess);
}

/**
 * Score creative age with grace period and quadratic decay
 */
export function scoreCreativeAge(age: number, refreshDays: number, maxDays: number, weight: number): number {
  if (age <= refreshDays) return weight;
  if (age >= maxDays) return 0;
  const decay = (age - refreshDays) / (maxDays - refreshDays);
  return weight * Math.max(0, 1 - decay * decay);
}

/**
 * Score budget pacing using stepped bands on deviation from plan.
 *
 * Canonical formula — mirrors ads_agent/scoring_engine.py score_staged_budget.
 * Both overspend and underspend are failures.
 *
 * dev = |pacing − 1|
 * - dev ≤ 0.10 → 100
 * - dev ≤ 0.15 → 60
 * - above      → 20
 */
function scoreBudgetDeviation(deviation: number): number {
  const { budget } = getScoringConfig().thresholds;
  if (withinBand(deviation, budget.good_deviation)) return budget.good_score;
  if (withinBand(deviation, budget.watch_deviation)) return budget.watch_score;
  return budget.floor_score;
}

export function scoreStagedBudgetDynamic(pacingPct: number): MetricScore {
  if (!Number.isFinite(pacingPct)) return null;
  return scoreBudgetDeviation(Math.abs(pacingPct / 100 - 1));
}

/**
 * Weighted variant of scoreStagedCostDynamic — returns a contribution in [0, weight],
 * or null when the metric is not measurable.
 */
export function scoreWeightedCostMetric(actual: number, target: number, weight: number): MetricScore {
  const score = scoreStagedCostDynamic(actual, target);
  return score === null ? null : weight * (score / 100);
}

/**
 * Weighted budget pacing against pro-rata planned spend.
 * Returns null when there is no budget to pace against — an unset budget must not
 * hand out full marks.
 */
export function scoreWeightedBudgetMetric(
  actualSpend: number,
  monthlyBudget: number,
  daysElapsed: number,
  daysInMonth: number,
  weight: number
): MetricScore {
  if (!(monthlyBudget > 0) || !(daysInMonth > 0)) return null;

  const safeDaysElapsed = Math.max(0, Math.min(daysElapsed, daysInMonth));
  const planned = monthlyBudget * (safeDaysElapsed / daysInMonth);
  if (planned <= 0) return null;
  if (!Number.isFinite(actualSpend)) return null;

  const deviation = Math.abs(actualSpend - planned) / planned;
  return weight * (scoreBudgetDeviation(deviation) / 100);
}

/**
 * Spend-weighted creative health. Returns null when there are no active creatives
 * carrying spend — that is missing data, not a zero-quality creative set.
 */
export function scoreWeightedCreativeMetric(creatives: any[], weight: number): MetricScore {
  const activeCreatives = (creatives || []).filter(
    (creative: any) => creative?.status === "ACTIVE" && (creative?.spend ?? 0) > 0
  );

  if (activeCreatives.length === 0) return null;

  const totalSpend = activeCreatives.reduce(
    (sum: number, creative: any) => sum + (creative?.spend ?? 0),
    0
  );
  if (totalSpend <= 0) return null;

  const weightedHealth = activeCreatives.reduce((sum: number, creative: any) => {
    const health = creative?.health_score ?? creative?.creative_score ?? creative?.performance_score ?? 0;
    return sum + health * (creative?.spend ?? 0);
  }, 0);

  const hAvg = weightedHealth / totalSpend;
  const diversity = Math.min(1, activeCreatives.length / 4);
  return weight * (hAvg / 100) * diversity;
}

/**
 * Combine weighted metric contributions into a 0–100 composite.
 *
 * Metrics scored `null` (no target configured, unusable input) are excluded from
 * BOTH the numerator and the weighted denominator, then the result is rescaled to
 * 100. Without the rescale, an unmeasurable metric would silently donate its full
 * weight as free marks — which is how a client with no CPSV benchmark used to
 * collect 25 points for nothing.
 *
 * `weights` is optional only for backward compatibility; always pass it.
 */
export function sumMetricScores(
  scores: Record<string, MetricScore>,
  weights?: Record<string, number>
): number {
  const scored = Object.entries(scores).filter(
    ([, score]) => score !== null && score !== undefined && Number.isFinite(score)
  ) as Array<[string, number]>;

  const total = scored.reduce((sum, [, score]) => sum + score, 0);
  if (!weights) return total;

  const scoredWeight = scored.reduce((sum, [metric]) => sum + (weights[metric] || 0), 0);
  if (scoredWeight <= 0) return 0;

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0 || scoredWeight === totalWeight) return total;

  // Rescale the measured subset back onto the full weight scale.
  return (total / scoredWeight) * totalWeight;
}

/** Render a score for logs, distinguishing "not measured" from a real zero. */
export function formatMetricScore(score: MetricScore): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "not measured";
  return (score as number).toFixed(2);
}

/** Round for display without collapsing an unmeasured metric into 0. */
export function roundMetricScore(score: MetricScore): MetricScore {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return Math.round(score * 100) / 100;
}

/** How many metrics actually carried a score, for "scored on N of M" in the UI. */
export function countScoredMetrics(scores: Record<string, MetricScore>): {
  scored: number;
  total: number;
  unmeasured: string[];
} {
  const entries = Object.entries(scores);
  const unmeasured = entries
    .filter(([, score]) => score === null || score === undefined || !Number.isFinite(score))
    .map(([metric]) => metric);
  return { scored: entries.length - unmeasured.length, total: entries.length, unmeasured };
}

/**
 * Get metric weights for a platform
 */
export function getMetricWeights(platform: "google" | "meta"): Record<string, number> {
  const config = getScoringConfig();
  return config.weights[platform].account_level;
}

/**
 * Check if a metric with this weight should trigger the RED override rule
 * @deprecated Use computeDualGateStatus instead for proper dual-gate logic
 */
export function shouldApplyRedOverride(weight: number, hasRedMetric: boolean): boolean {
  const config = getScoringConfig();
  return hasRedMetric && weight >= (config.red_metric_weight_threshold ?? 15);
}

/**
 * Get the cap score when RED override applies
 * @deprecated Use computeDualGateStatus instead for proper dual-gate logic
 */
export function getRedCapThreshold(): number {
  return getScoringConfig().red_cap_threshold ?? 74;
}

/**
 * Get classification thresholds
 */
export function getClassificationThresholds(): {
  green: number;
  yellow: number;
} {
  const config = getScoringConfig();
  return {
    green: config.green_threshold,
    yellow: config.yellow_threshold,
  };
}

/**
 * Compute the weakest-link ratio (min(score_i / weight_i)) for dual-gate status
 *
 * Used to prevent a single catastrophic metric from hiding behind strong averages.
 * min_ratio represents: the worst metric as a percentage of its maximum possible score.
 *
 * Example: CPL score 20/20 → ratio = 20/20 = 1.0
 *         CPQL score 10/20 → ratio = 10/20 = 0.5
 *         min_ratio = 0.5 (CPQL is the weakest link at 50% of max)
 */
export function computeMinRatio(
  scores: Record<string, MetricScore>,
  weights: Record<string, number>
): number {
  let minRatio = 1.0;

  for (const metric in scores) {
    const weight = weights[metric] || 0;
    if (weight <= 0) continue; // Skip metrics with no weight

    const score = scores[metric];
    // An unmeasured metric cannot veto — it is absent, not failing.
    if (score === null || score === undefined || !Number.isFinite(score)) continue;

    minRatio = Math.min(minRatio, score / weight);
  }

  return minRatio;
}

/**
 * Determine account status using dual-gate system (composite + weakest-link veto)
 *
 * Thresholds (Mojo AdCortex v1.0):
 * GREEN:  composite ≥ 75 AND min_ratio ≥ 0.40
 * YELLOW: composite ≥ 55 AND min_ratio ≥ 0.20
 * ORANGE: composite ≥ 35 AND min_ratio ≥ 0.05
 * RED:    composite < 35 OR min_ratio < 0.05
 *
 * The final status is the WORSE of the two gates.
 * This prevents a weak metric from hiding behind a strong composite score.
 */
export function computeDualGateStatus(
  total: number,
  minRatio: number
): "GREEN" | "YELLOW" | "ORANGE" | "RED" {
  const config = getScoringConfig();
  const greenThreshold = config.green_threshold;
  const yellowThreshold = config.yellow_threshold ?? 55;
  const orangeThreshold = config.orange_threshold ?? 35;

  // Determine composite gate status
  let compositeStatus: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  if (total >= greenThreshold) compositeStatus = "GREEN";
  else if (total >= yellowThreshold) compositeStatus = "YELLOW";
  else if (total >= orangeThreshold) compositeStatus = "ORANGE";
  else compositeStatus = "RED";

  // Determine veto gate status (weakest-link)
  let vetoStatus: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  if (minRatio >= 0.40) vetoStatus = "GREEN";
  else if (minRatio >= 0.20) vetoStatus = "YELLOW";
  else if (minRatio >= 0.05) vetoStatus = "ORANGE";
  else vetoStatus = "RED";

  // Return the worse of the two gates
  const statusRank = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
  const compositeRank = statusRank[compositeStatus];
  const vetoRank = statusRank[vetoStatus];

  return compositeRank < vetoRank ? compositeStatus : vetoStatus;
}
