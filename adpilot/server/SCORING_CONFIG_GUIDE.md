# Dynamic Scoring Configuration Guide

## Overview

The account health scoring system now uses **dynamic, configurable values** instead of hardcoded thresholds. This allows you to adjust scoring behavior at runtime without modifying code.

## Configuration Structure

### Cost Metric Thresholds (`thresholds.cost`)

Controls how cost metrics (CPL, CPC, CPQL, CPSV) are scored:

| Field | Default | Meaning |
|-------|---------|---------|
| `excellent_ratio` | 1.1 | Score = 100 if actual ≤ target × 1.1 (10% over) |
| `good_ratio` | 1.2 | Score = 70 if actual ≤ target × 1.2 (20% over) |
| `concerning_ratio` | 1.3 | Score = 40 if actual ≤ target × 1.3 (30% over) |
| `alert_score` | 10 | Score = 10 if actual > target × 1.3 |

**Example**: If CPL target = $100 and actual CPL = $105:
- Ratio = 1.05 (5% over target)
- Since 1.05 ≤ 1.1, score = 100 (excellent)

### Budget Pacing Thresholds (`thresholds.budget`)

Controls how budget pacing is scored (deviation from 100%):

| Field | Default | Meaning |
|-------|---------|---------|
| `excellent_deviation` | 0.10 | Score = 100 if within ±10% of target pacing |
| `good_deviation` | 0.15 | Score = 60 if within ±15% of target pacing |
| `alert_score` | 20 | Score = 20 if > ±15% deviation |

**Example**: If expected pacing = 100% and actual = 95%:
- Deviation = |95/100 - 1| = 0.05
- Since 0.05 ≤ 0.10, score = 100 (excellent)

### Metric Weights

**Google Account Level** (should sum to 100):
```json
{
  "cpsv": 25,    // Cost per served value
  "budget": 20,  // Budget pacing
  "cpql": 20,    // Cost per qualified lead
  "cpl": 10,     // Cost per lead
  "campaign": 15, // Campaign health
  "creative": 10  // Creative health
}
```

**Meta Account Level** (should sum to 100):
```json
{
  "cpsv": 25,    // Cost per served value
  "budget": 25,  // Budget pacing (heavier than Google)
  "cpql": 20,    // Cost per qualified lead
  "cpl": 20,     // Cost per lead (heavier than Google)
  "creative": 10 // Creative health
}
```

### Override Rules

| Field | Default | Meaning |
|-------|---------|---------|
| `red_metric_weight_threshold` | 15 | If any metric with weight ≥ 15% is RED (< 50), apply cap |
| `red_cap_threshold` | 74 | Cap composite score to 74 (YELLOW) when override applies |
| `green_threshold` | 75 | Score ≥ 75 = GREEN status |
| `yellow_threshold` | 50 | 50 ≤ score < 75 = YELLOW status |

## How to Modify Configuration

### Option 1: Edit JSON Configuration (Recommended)

Edit `scoring-config.json`:

```bash
# Make cost thresholds stricter (less forgiving)
# Change excellent_ratio from 1.1 to 1.05 (5% over target instead of 10%)
{
  "thresholds": {
    "cost": {
      "excellent_ratio": 1.05,  # ← Changed
      "good_ratio": 1.15,
      "concerning_ratio": 1.25
    }
  }
}
```

Then reload the server for changes to take effect.

### Option 2: Runtime Programmatic Update

```typescript
import { setScoringConfig } from "./server/scoring-config";

// Update cost thresholds at runtime
setScoringConfig({
  thresholds: {
    cost: {
      excellent_ratio: 1.05,
      good_ratio: 1.15,
      concerning_ratio: 1.25,
      excellent_score: 100,
      good_score: 70,
      concerning_score: 40,
      alert_score: 10,
    }
  }
});
```

### Option 3: Load from Database

Extend `loadScoringConfig()` in `scoring-config.ts` to load from your database:

```typescript
export async function loadScoringConfig(): Promise<ScoringConfig> {
  // Example: Load from database
  const dbConfig = await db.query("SELECT * FROM scoring_configs WHERE active = true");
  return dbConfig ? parseConfig(dbConfig) : DEFAULT_SCORING_CONFIG;
}
```

## Common Adjustments

### Make Scoring More Lenient (higher scores)
- **Increase cost ratios**: `excellent_ratio: 1.15` (allow 15% over target)
- **Increase budget deviation**: `excellent_deviation: 0.15` (allow ±15% pacing)
- **Increase weights for strong performers**: Reduce weight of metrics the account doesn't do well on

### Make Scoring Stricter (lower scores)
- **Decrease cost ratios**: `excellent_ratio: 1.05` (allow only 5% over target)
- **Decrease budget deviation**: `excellent_deviation: 0.05` (allow only ±5% pacing)
- **Decrease weights for weak metrics**: Increase weight of metrics where performance matters most

### Emphasize Budget Pacing
- **Google**: Change `budget: 20` → `budget: 35`
- **Meta**: Change `budget: 25` → `budget: 40`
- Adjust other weights to keep total = 100

### Emphasize CPL Performance
- **Google**: Change `cpl: 10` → `cpl: 25`
- **Meta**: Change `cpl: 20` → `cpl: 35`
- Reduce other metrics proportionally

## Impact on Health Scores

When you modify configuration, health scores recalculate based on the new parameters:

```
Health Score = Σ(metric_score × weight) for all metrics

If composite_score >= green_threshold (75) → GREEN
If 50 <= composite_score < 75         → YELLOW  
If composite_score < 50               → RED
```

**Example Score Calculation** (Google):
```
CPL Score:      80 × 0.10 = 8.0
Budget Score:   90 × 0.20 = 18.0
CPQL Score:     75 × 0.20 = 15.0
CPSV Score:     60 × 0.25 = 15.0
Campaign Score: 70 × 0.15 = 10.5
Creative Score: 85 × 0.10 = 8.5
─────────────────────────────────
Composite:                   75.0 → GREEN
```

## Testing Configuration Changes

1. **Create a test configuration** with adjusted values
2. **Run against historical data** to see impact on health scores
3. **Compare results** between old and new config
4. **Validate** that changes align with business goals
5. **Deploy** to production

## Resetting to Defaults

```typescript
import { resetScoringConfig } from "./server/scoring-config";

// Reset all values to v1.0 defaults
resetScoringConfig();
```

## Version Control

The config file includes a `version` field for tracking changes:

```json
{
  "version": "1.0",
  "notes": {
    "date_modified": "2026-04-14",
    "reason": "Adjusted cost thresholds to reflect new industry benchmarks"
  }
}
```

## Architecture

### Files Involved

- **`scoring-config.ts`**: Config loader & dynamic scoring functions
- **`scoring-config.json`**: Configuration values (edit this for custom scoring)
- **`google-transform.ts`**: Uses dynamic scoring for Google health
- **`meta-transform.ts`**: Uses dynamic scoring for Meta health

### Key Functions

```typescript
// Load configuration
loadScoringConfig(): Promise<ScoringConfig>

// Get/set configuration at runtime
getScoringConfig(): ScoringConfig
setScoringConfig(partial: Partial<ScoringConfig>): void
resetScoringConfig(): void

// Dynamic scoring functions
scoreStagedCostDynamic(actual: number, target: number): number
scoreStagedBudgetDynamic(pacingPct: number): number
getMetricWeights(platform: "google" | "meta"): Record<string, number>
```

## Migration from Static to Dynamic

All hardcoded values have been removed from:
- ✅ `google-transform.ts`
- ✅ `meta-transform.ts`

The core scoring logic remains **identical** — only the threshold values are now dynamic.
