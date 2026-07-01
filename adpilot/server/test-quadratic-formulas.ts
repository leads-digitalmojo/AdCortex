/**
 * Test suite for Mojo AdCortex v2.0 quadratic formulas
 * Validates that the new formulas match the PDF specification
 */

import {
  scoreWeightedCostMetric,
  scoreWeightedBudgetMetric,
  scoreWeightedCreativeMetric,
  computeMinRatio,
  computeDualGateStatus,
} from "./scoring-config";

// Test cases from the PDF specification
console.log("=== Testing Cost Metric Formula ===");

// Test case 1: CPL at target
let result = scoreWeightedCostMetric(700, 700, 20);
console.log(`CPL 700 vs target 700: ${result.toFixed(2)} (expected: 20.00)`);

// Test case 2: CPL 4.1% over target
result = scoreWeightedCostMetric(729, 700, 20);
console.log(`CPL 729 vs target 700 (4.1% over): ${result.toFixed(2)} (expected: ~18.60)`);

// Test case 3: CPQL 51.9% over target (in RED zone)
result = scoreWeightedCostMetric(4481, 2950, 20);
console.log(`CPQL 4481 vs target 2950 (51.9% over): ${result.toFixed(2)} (expected: 0.00)`);

// Test case 4: Cost 20% over target
result = scoreWeightedCostMetric(840, 700, 20);
console.log(`Cost 840 vs target 700 (20% over): ${result.toFixed(2)} (expected: 10.00)`);

// Test case 5: Cost 34%+ over target (at zero point)
result = scoreWeightedCostMetric(936, 700, 20);
console.log(`Cost 936 vs target 700 (34% over): ${result.toFixed(2)} (expected: ~0.00)`);

console.log("\n=== Testing Budget Pacing Formula ===");

// Test case 1: Perfect pacing
result = scoreWeightedBudgetMetric(25000, 50000, 15, 30, 25);
console.log(`Perfect pacing: ${result.toFixed(2)} (expected: 25.00)`);

// Test case 2: 8.6% overspend (from your case)
result = scoreWeightedBudgetMetric(27150, 50000, 15, 30, 25);
console.log(`Budget 8.6% over plan: ${result.toFixed(2)} (expected: ~21.00)`);

// Test case 3: 10% deviation
result = scoreWeightedBudgetMetric(27500, 50000, 15, 30, 25);
console.log(`Budget 10% over plan: ${result.toFixed(2)} (expected: 20.00)`);

// Test case 4: 20% deviation
result = scoreWeightedBudgetMetric(30000, 50000, 15, 30, 25);
console.log(`Budget 20% over plan: ${result.toFixed(2)} (expected: 10.00)`);

console.log("\n=== Testing Creative Formula ===");

result = scoreWeightedCreativeMetric([
  { status: "ACTIVE", spend: 1000, creative_score: 80 },
  { status: "ACTIVE", spend: 1000, creative_score: 80 },
], 10);
console.log(`Two active ads at 80 health: ${result.toFixed(2)} (expected: 4.00)`);

console.log("\n=== Testing Min Ratio Calculation ===");

const breakdown = {
  cpsv: 25,
  budget: 20,
  cpql: 10,  // Weakest metric
  cpl: 20,
  creative: 8,
};

const weights = {
  cpsv: 25,
  budget: 25,
  cpql: 20,
  cpl: 20,
  creative: 10,
};

const minRatio = computeMinRatio(breakdown, weights);
console.log(`Min ratio for breakdown: ${minRatio.toFixed(3)}`);
console.log(`  - CPSV: 25/25 = 1.0`);
console.log(`  - Budget: 20/25 = 0.8`);
console.log(`  - CPQL: 10/20 = 0.5 (weakest)`);
console.log(`  - CPL: 20/20 = 1.0`);
console.log(`  - Creative: 8/10 = 0.8`);
console.log(`Expected min: 0.5, Got: ${minRatio.toFixed(3)}`);

console.log("\n=== Testing Dual-Gate Status ===");

// Test case: composite=80, min_ratio=0.35
let status = computeDualGateStatus(80, 0.35);
console.log(`Composite 80, minRatio 0.35: ${status} (expected: YELLOW)`);

// Test case: composite=76, min_ratio=0.45
status = computeDualGateStatus(76, 0.45);
console.log(`Composite 76, minRatio 0.45: ${status} (expected: GREEN)`);

// Test case: composite=70, min_ratio=0.15
status = computeDualGateStatus(70, 0.15);
console.log(`Composite 70, minRatio 0.15: ${status} (expected: ORANGE)`);

// Test case: composite=30, min_ratio=0.02
status = computeDualGateStatus(30, 0.02);
console.log(`Composite 30, minRatio 0.02: ${status} (expected: RED)`);

console.log("\n=== All Tests Completed ===");
