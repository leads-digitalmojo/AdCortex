/**
 * Regression suite for the Mojo AdCortex scoring primitives.
 *
 * Every case here corresponds to a bug found in the P0 correctness audit. The
 * three that matter most:
 *   - spend with zero leads used to score a PERFECT CPL (0 read as "far below target")
 *   - a missing target used to score FULL MARKS instead of being excluded
 *   - the TypeScript and Python layers used different formulas and disagreed by
 *     up to 30 points on the same campaign
 *
 * Run: npx tsx server/test-scoring.ts
 */

import {
  scoreStagedCostDynamic,
  scoreStagedBudgetDynamic,
  scoreWeightedCostMetric,
  scoreWeightedBudgetMetric,
  scoreWeightedCreativeMetric,
  sumMetricScores,
  countScoredMetrics,
  computeMinRatio,
  type MetricScore,
} from "./scoring-config";
import { getClassification } from "../shared/classification";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (ok) {
    passed++;
    console.log(`  PASS  ${label} → ${String(actual)}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label} → got ${String(actual)}, expected ${String(expected)}`);
  }
}

function near(label: string, actual: MetricScore, expected: number, tolerance = 0.01) {
  const ok = actual !== null && Math.abs((actual as number) - expected) <= tolerance;
  if (ok) {
    passed++;
    console.log(`  PASS  ${label} → ${(actual as number).toFixed(2)}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label} → got ${String(actual)}, expected ~${expected}`);
  }
}

// ── Cost metric: stepped bands, matching ads_agent/scoring_engine.py ──────────
console.log("\n=== Cost metric bands (target 1000) ===");
check("at target", scoreStagedCostDynamic(1000, 1000), 100);
check("+10% (band edge)", scoreStagedCostDynamic(1100, 1000), 100);
check("+11% (into watch)", scoreStagedCostDynamic(1110, 1000), 70);
check("+20% (band edge)", scoreStagedCostDynamic(1200, 1000), 70);
check("+21%", scoreStagedCostDynamic(1210, 1000), 40);
check("+30% (band edge)", scoreStagedCostDynamic(1300, 1000), 40);
check("+31% (floor)", scoreStagedCostDynamic(1310, 1000), 10);
check("+300% (still floor)", scoreStagedCostDynamic(4000, 1000), 10);
check("well under target", scoreStagedCostDynamic(500, 1000), 100);

// ── The zero-lead bug: spend, no outcome ─────────────────────────────────────
console.log("\n=== Zero leads on live spend (the P0-3 bug) ===");
check(
  "spend with no leads scores 0, NOT 100",
  scoreStagedCostDynamic(Number.POSITIVE_INFINITY, 1000),
  0
);
check(
  "and is strictly worse than a merely expensive lead",
  (scoreStagedCostDynamic(Number.POSITIVE_INFINITY, 1000) as number) <
    (scoreStagedCostDynamic(9999, 1000) as number),
  true
);

// ── The missing-target bug ───────────────────────────────────────────────────
console.log("\n=== Missing target (the P0-2 bug) ===");
check("target 0 → not measured", scoreStagedCostDynamic(500, 0), null);
check("negative target → not measured", scoreStagedCostDynamic(500, -1), null);
check("weighted, target 0 → not measured", scoreWeightedCostMetric(500, 0, 25), null);
check("no budget → not measured", scoreWeightedBudgetMetric(1000, 0, 15, 30, 25), null);
check("no active creatives → not measured", scoreWeightedCreativeMetric([], 10), null);

// ── Bad inputs must not silently score ───────────────────────────────────────
console.log("\n=== Non-finite inputs (the P2-2 bug) ===");
check("NaN actual → not measured", scoreStagedCostDynamic(NaN, 1000), null);
check("NaN pacing → not measured", scoreStagedBudgetDynamic(NaN), null);

// ── Budget pacing bands ──────────────────────────────────────────────────────
console.log("\n=== Budget pacing bands ===");
check("perfect pacing", scoreStagedBudgetDynamic(100), 100);
check("+10% (band edge)", scoreStagedBudgetDynamic(110), 100);
check("-10% (band edge)", scoreStagedBudgetDynamic(90), 100);
check("+15% (band edge)", scoreStagedBudgetDynamic(115), 60);
check("+16% (floor)", scoreStagedBudgetDynamic(116), 20);
check("+50% never goes below the floor", scoreStagedBudgetDynamic(150), 20);
near("weighted, on plan", scoreWeightedBudgetMetric(500, 1000, 15, 30, 25), 25);

// ── Weighted contributions ───────────────────────────────────────────────────
console.log("\n=== Weighted cost contributions ===");
near("at target, weight 20", scoreWeightedCostMetric(700, 700, 20), 20);
near("+15% of target, weight 20", scoreWeightedCostMetric(805, 700, 20), 14); // 70% of 20
near("+50% of target, weight 20", scoreWeightedCostMetric(1050, 700, 20), 2); // 10% of 20

// ── Aggregation must renormalize, not hand out free marks ────────────────────
console.log("\n=== Composite with an unmeasured metric ===");
const weights = { cpsv: 25, budget: 25, cpql: 20, cpl: 20, creative: 10 };

const allScored = { cpsv: 25, budget: 25, cpql: 20, cpl: 20, creative: 10 };
near("everything measured and perfect → 100", sumMetricScores(allScored, weights), 100);

// CPSV unmeasured; the other four are perfect. The composite should stay 100
// (the measured metrics are all perfect) rather than dropping to 75 — but the
// coverage report must say only 4 of 5 were scored.
const cpsvMissing = { cpsv: null, budget: 25, cpql: 20, cpl: 20, creative: 10 };
near("unmeasured CPSV, rest perfect → 100 on 4 metrics", sumMetricScores(cpsvMissing, weights), 100);
check("coverage reports 4 of 5", countScoredMetrics(cpsvMissing).scored, 4);
check("coverage names the gap", countScoredMetrics(cpsvMissing).unmeasured.join(","), "cpsv");

// The bug this replaces: CPSV unmeasured while the rest are HALF marks. Before,
// CPSV silently contributed its full 25 and the account read 62.5. Now the score
// reflects only what was measured: half marks across the board → 50.
const cpsvMissingRestHalf = { cpsv: null, budget: 12.5, cpql: 10, cpl: 10, creative: 5 };
near("unmeasured CPSV no longer inflates a mediocre account", sumMetricScores(cpsvMissingRestHalf, weights), 50);

check("unmeasured metric cannot veto via min-ratio", computeMinRatio(cpsvMissing, weights), 1);

// ── Classification ───────────────────────────────────────────────────────────
console.log("\n=== Classification bands (75 / 50 + CPL rule) ===");
check("score 75, no CPL data → WINNER", getClassification(75), "WINNER");
check("score 74 → WATCH", getClassification(74), "WATCH");
check("score 50 → WATCH", getClassification(50), "WATCH");
check("score 49 → UNDERPERFORMER", getClassification(49), "UNDERPERFORMER");

check("score 80, CPL at target → WINNER", getClassification(80, 1000, 1000), "WINNER");
check("score 80, CPL over target → WATCH not WINNER", getClassification(80, 1100, 1000), "WATCH");
check("score 80, CPL > 1.3x → UNDERPERFORMER", getClassification(80, 1400, 1000), "UNDERPERFORMER");
check("score 90, CPL 2x target → UNDERPERFORMER", getClassification(90, 2000, 1000), "UNDERPERFORMER");
check("CPL rule skipped when no target", getClassification(80, 5000, 0), "WINNER");

check("missing score → NOT_SCORED, not UNDERPERFORMER", getClassification(null), "NOT_SCORED");
check("undefined score → NOT_SCORED", getClassification(undefined), "NOT_SCORED");
check("NaN score → NOT_SCORED", getClassification(NaN), "NOT_SCORED");

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(52)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
