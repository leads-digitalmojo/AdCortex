# Dynamic Health Scoring Migration Summary

## What Changed

Your account health scoring system has been migrated from **static, hardcoded values** to **dynamic, configurable values**. The core scoring logic remains identical — only the threshold parameters are now runtime-configurable.

## Before vs After

### Before (Static/Hardcoded)

```typescript
// google-transform.ts
function scoreStagedCost(actual: number, target: number): number {
  const ratio = actual / target;
  if (ratio <= 1.1) return 100;      // ← HARDCODED
  if (ratio <= 1.2) return 70;       // ← HARDCODED
  if (ratio <= 1.3) return 40;       // ← HARDCODED
  return 10;                          // ← HARDCODED
}

function scoreStagedBudget(pacingPct: number): number {
  const dev = Math.abs(pacingPct / 100 - 1);
  if (dev <= 0.10) return 100;       // ← HARDCODED
  if (dev <= 0.15) return 60;        // ← HARDCODED
  return 20;                          // ← HARDCODED
}

const weights: Record<string, number> = { 
  cpsv: 25, budget: 20, cpql: 20, cpl: 10, 
  campaign: 15, creative: 10           // ← HARDCODED
};
```

### After (Dynamic/Configurable)

```typescript
// google-transform.ts
import { 
  scoreStagedCostDynamic,
  scoreStagedBudgetDynamic,
  getMetricWeights 
} from "./scoring-config";

// Uses dynamic config:
const cplScore = actualLeadsMtd > 0
  ? scoreStagedCostDynamic(actualCplMtd, cplTarget)  // ← Dynamic
  : 50;

const budgetScore = scoreStagedBudgetDynamic(pacingPct);  // ← Dynamic

const weights = getMetricWeights("google");  // ← Dynamic
```

## New Files Created

### 1. `adpilot/server/scoring-config.ts`
The configuration system with:
- **Type definitions** for config structure
- **Default configuration** matching v1.0 spec
- **Dynamic scoring functions** that use config values
- **Runtime APIs** to read/update config

Key functions:
```typescript
loadScoringConfig()        // Load config (returns defaults for now)
getScoringConfig()         // Get current config
setScoringConfig(partial)  // Update config at runtime
resetScoringConfig()       // Reset to defaults

scoreStagedCostDynamic()   // Score cost metrics using config
scoreStagedBudgetDynamic() // Score budget pacing using config
getMetricWeights()         // Get platform-specific weights
```

### 2. `adpilot/server/scoring-config.json`
JSON configuration file with all parameters:
```json
{
  "thresholds": {
    "cost": {
      "excellent_ratio": 1.1,      // 10% over target
      "good_ratio": 1.2,           // 20% over target
      "concerning_ratio": 1.3,     // 30% over target
      "excellent_score": 100,
      "good_score": 70,
      "concerning_score": 40,
      "alert_score": 10
    },
    "budget": {
      "excellent_deviation": 0.10, // ±10%
      "good_deviation": 0.15,      // ±15%
      "excellent_score": 100,
      "good_score": 60,
      "alert_score": 20
    }
  },
  "weights": {
    "google": { cpsv: 25, budget: 20, ... },
    "meta": { cpsv: 25, budget: 25, ... }
  }
}
```

### 3. `SCORING_CONFIG_GUIDE.md`
Complete documentation with:
- Configuration structure explained
- Common adjustments (lenient/strict)
- Impact examples
- Testing strategies

## Files Modified

### `google-transform.ts`
✅ Removed hardcoded `scoreStagedCost()` function
✅ Removed hardcoded `scoreStagedBudget()` function
✅ Replaced all calls with dynamic versions:
  - `scoreStagedCost()` → `scoreStagedCostDynamic()`
  - `scoreStagedBudget()` → `scoreStagedBudgetDynamic()`
✅ Replaced static weights:
  - `const weights = { cpsv: 25, ... }` → `const weights = getMetricWeights("google")`
✅ Updated RED override rule to use dynamic threshold

### `meta-transform.ts`
✅ Same changes as google-transform.ts for Meta platform
✅ Uses `getMetricWeights("meta")` instead of Google weights

## How to Use

### Adjust Scoring Behavior

Edit `scoring-config.json`:

```json
// Make cost metrics stricter
"cost": {
  "excellent_ratio": 1.05,  // Change from 1.1 (was: 10% tolerance)
  "good_ratio": 1.15,       // Change from 1.2 (was: 20% tolerance)
  "concerning_ratio": 1.25  // Change from 1.3 (was: 30% tolerance)
}

// Make budget pacing more lenient
"budget": {
  "excellent_deviation": 0.15,  // Change from 0.10
  "good_deviation": 0.20         // Change from 0.15
}

// Emphasize CPL in Meta scoring
"meta": {
  "account_level": {
    "cpl": 30  // Change from 20 (heavier weight)
  }
}
```

### Runtime Configuration

```typescript
import { setScoringConfig } from "./server/scoring-config";

// Adjust thresholds at runtime
setScoringConfig({
  thresholds: {
    cost: {
      excellent_ratio: 1.05,
      good_ratio: 1.15,
      concerning_ratio: 1.25,
      excellent_score: 100,
      good_score: 70,
      concerning_score: 40,
      alert_score: 10
    }
  }
});

// Adjust weights at runtime
setScoringConfig({
  weights: {
    google: {
      account_level: {
        cpl: 20,
        budget: 25  // Increase from 20
      }
    }
  }
});
```

## Business Impact Examples

### Scenario 1: Accounts consistently missing CPL targets

**Current Problem**: CPL scores are always in the 40-70 range
**Solution**: Increase cost tolerance
```json
"excellent_ratio": 1.2,  // Allow 20% over (was 10%)
"good_ratio": 1.35,      // Allow 35% over (was 20%)
```
**Result**: Same accounts now score 70-100

### Scenario 2: Want to emphasize budget pacing

**Current Problem**: Accounts with bad pacing still score well on other metrics
**Solution**: Increase budget weight
```json
"google": {
  "budget": 30  // From 20
  "campaign": 10  // Reduce to keep total = 100
}
```
**Result**: Budget performance now matters 50% more

### Scenario 3: Make scoring stricter for quality accounts

**Current Problem**: Top accounts reach 100 too easily
**Solution**: Tighten all thresholds
```json
"cost": {
  "excellent_ratio": 1.02,  // Only 2% over (from 10%)
  "good_ratio": 1.05,       // Only 5% over (from 20%)
  "concerning_ratio": 1.10   // 10% over (from 30%)
}
```
**Result**: Accounts need tighter cost control to score well

## Architecture

```
┌─────────────────────────────────┐
│   scoring-config.json           │ ← Edit these values
│   (configuration values)        │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  scoring-config.ts              │ ← Config loader & API
│  - loadScoringConfig()          │
│  - getScoringConfig()           │
│  - setScoringConfig()           │
│  - scoreStagedCostDynamic()     │
│  - scoreStagedBudgetDynamic()   │
└────────────┬────────────────────┘
             │
    ┌────────┴─────────┐
    │                  │
┌───▼──────────────┐  ┌──▼───────────────┐
│ google-          │  │ meta-            │
│ transform.ts     │  │ transform.ts     │
│                  │  │                  │
│ recomputeGoogle  │  │ recomputeMeta    │
│ HealthScore()    │  │ HealthScore()    │
└──────────────────┘  └──────────────────┘
         │                    │
         └────────┬───────────┘
                  │
         ┌────────▼──────────┐
         │  Dashboard/UI     │
         │  Shows health     │
         │  scores & status  │
         └───────────────────┘
```

## No Code Breaking Changes

✅ All scoring logic remains identical
✅ Health scores won't change (same defaults as before)
✅ No frontend changes needed
✅ No database migrations needed
✅ Fully backward compatible

## Future Enhancements

The system is now ready for:

1. **Database-backed config**: Load from `sop_database` table
2. **Per-client scoring**: Different thresholds for different clients
3. **Time-series config**: Change scoring rules by season
4. **A/B testing**: Compare scoring approaches
5. **ML-driven tuning**: Optimize thresholds based on outcomes

## Getting Started

1. **Review** `scoring-config.json` — understand current values
2. **Read** `SCORING_CONFIG_GUIDE.md` — understand each parameter
3. **Test** adjustments against historical data
4. **Deploy** your custom configuration
5. **Monitor** impact on health scores

## Support

- **Configuration Guide**: `SCORING_CONFIG_GUIDE.md`
- **Type Definitions**: `adpilot/server/scoring-config.ts` (line 1-50)
- **Current Config**: `adpilot/server/scoring-config.json`
- **Implementation**: `adpilot/server/google-transform.ts` & `meta-transform.ts`
