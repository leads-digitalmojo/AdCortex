/**
* Dynamic Scoring Configuration Loader
*
* Loads and validates health scoring thresholds and weights from configuration
* instead of hardcoding them. This allows runtime adjustment of scoring behavior.
*/

export interface ScoringThresholds {
  // Cost metrics (CPL, CPC, CPQL, CPSV, CPM) — lower is better
  // Uses continuous formula: Score = 100 - ((ratio - 1) / (red_mult - 1)) * 60 for target < actual < red
  cost: {
    target_ratio: number;         // Ratio = 1.0 (at target) → score 100 (default: 1.0)
    red_multiplier: number;       // Ratio ≥ this × target → score ≤ 50 (default: 1.5 = 50% over)
    floor_multiplier: number;     // Ratio ≥ this × target → score 0 (default: 2.0 = 2× target)
    excellent_floor: number;      // Minimum score in excellent range (default: 40)
  };
  // Budget pacing — deviation from 100%
  // Uses continuous formula: Score = 100 - (|deviation| / threshold) * 50 within bounds
  budget: {
    target_deviation: number;     // Deviation = 0 (perfect pacing) → score 100 (default: 0.0)
    red_deviation: number;        // Deviation ≥ this → score ≤ 50 (default: 0.30 = ±30%)
    excellent_floor: number;      // Minimum score in excellent range (default: 40);
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
  version: "2.0-formula-quadratic",
  thresholds: {
    cost: {
      target_ratio: 1.0,         // At target = 100
      red_multiplier: 1.5,       // 50% over target = RED threshold (score 50)
      floor_multiplier: 2.0,     // 2× target = score 0
      excellent_floor: 40,       // Min score in excellent range (deprecated with quadratic)
    },
    budget: {
      target_deviation: 0.0,     // Perfect pacing = 100
      red_deviation: 0.30,       // ±30% = RED threshold (score 50)
      excellent_floor: 40,       // Min score in excellent range (deprecated with quadratic)
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

/**
 * Load scoring configuration from external source
 * For now, returns default config. Can be extended to load from:
 * - sop-database.json
 * - environment variables
 * - database
 * - API
 */
export async function loadScoringConfig(): Promise<ScoringConfig> {
  // TODO: Implement dynamic loading from sop-database.json or other source
  // For now, return the default config
  return DEFAULT_SCORING_CONFIG;
}

/**
 * Get current scoring configuration (cached)
 */
export function getScoringConfig(): ScoringConfig {
  return cachedConfig;
}

/**
 * Update scoring configuration at runtime
 */
export function setScoringConfig(config: Partial<ScoringConfig>): void {
  cachedConfig = {
    ...cachedConfig,
    ...config,
    thresholds: {
      ...cachedConfig.thresholds,
      ...(config.thresholds || {}),
    },
    weights: {
      ...cachedConfig.weights,
      ...(config.weights || {}),
    },
  };
}

/**
 * Reset to default configuration
 */
export function resetScoringConfig(): void {
  cachedConfig = { ...DEFAULT_SCORING_CONFIG };
}

/**
 * Score a cost metric (CPL, CPC, CPQL, CPSV, CPM) using quadratic decay formula
 *
 * Formula (Mojo AdCortex v1.0):
 * d = max(0, (actual - target) / target)
 * score = 100 × max(0, 1 − 1.5d − 5d²)
 *
 * Behavior:
 * - at target (d=0) → 100
 * - 10% over (d=0.1) → 80
 * - 20% over (d=0.2) → 50
 * - 30% over (d=0.3) → 10
 * - 34%+ over → 0
 */
export function scoreStagedCostDynamic(actual: number, target: number): number {
  if (target <= 0) return 100; // Edge case: undefined target = full marks

  const d = Math.max(0, (actual - target) / target);
  const rawScore = Math.max(0, 1 - 1.5 * d - 5 * d * d);
  return Math.round(rawScore * 100);
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
 * Score budget pacing using quadratic formula
 *
 * Formula (Mojo AdCortex v1.0):
 * b = |actual_spend - planned_budget| / planned_budget
 * score = 100 × max(0, 1 − b − 10b²)
 *
 * Behavior: Both overspend and underspend are failures.
 * - 0% deviation (100% pacing) → 100
 * - 10% deviation (±10%) → 80
 * - 20% deviation (±20%) → 40
 * - 29%+ deviation → 0
 */
export function scoreStagedBudgetDynamic(pacingPct: number): number {
  const b = Math.abs(pacingPct / 100 - 1);
  const rawScore = Math.max(0, 1 - b - 10 * b * b);
  return Math.round(rawScore * 100);
}

export function scoreWeightedCostMetric(actual: number, target: number, weight: number): number {
  if (target <= 0) return weight;

  const safeActual = Number.isFinite(actual) ? actual : Number.POSITIVE_INFINITY;
  const d = Math.max(0, (safeActual - target) / target);
  return weight * Math.max(0, 1 - 1.5 * d - 5 * d * d);
}

export function scoreWeightedBudgetMetric(
  actualSpend: number,
  monthlyBudget: number,
  daysElapsed: number,
  daysInMonth: number,
  weight: number
): number {
  if (monthlyBudget <= 0 || daysInMonth <= 0) return weight;

  const safeDaysElapsed = Math.max(0, Math.min(daysElapsed, daysInMonth));
  const planned = monthlyBudget * (safeDaysElapsed / daysInMonth);
  if (planned <= 0) return weight;

  const b = Math.abs(actualSpend - planned) / planned;
  return weight * Math.max(0, 1 - b - 10 * b * b);
}

export function scoreWeightedCreativeMetric(creatives: any[], weight: number): number {
  const activeCreatives = (creatives || []).filter(
    (creative: any) => creative?.status === "ACTIVE" && (creative?.spend ?? 0) > 0
  );

  if (activeCreatives.length === 0) return 0;

  const totalSpend = activeCreatives.reduce(
    (sum: number, creative: any) => sum + (creative?.spend ?? 0),
    0
  );
  if (totalSpend <= 0) return 0;

  const weightedHealth = activeCreatives.reduce((sum: number, creative: any) => {
    const health = creative?.health_score ?? creative?.creative_score ?? creative?.performance_score ?? 0;
    return sum + health * (creative?.spend ?? 0);
  }, 0);

  const hAvg = weightedHealth / totalSpend;
  const diversity = Math.min(1, activeCreatives.length / 4);
  return weight * (hAvg / 100) * diversity;
}

export function sumMetricScores(scores: Record<string, number>): number {
  return Object.values(scores).reduce((total, score) => total + score, 0);
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
  scores: Record<string, number>,
  weights: Record<string, number>
): number {
  let minRatio = 1.0;

  for (const metric in scores) {
    const weight = weights[metric] || 0;
    if (weight <= 0) continue; // Skip metrics with no weight

    const ratio = scores[metric] / weight;
    minRatio = Math.min(minRatio, ratio);
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
