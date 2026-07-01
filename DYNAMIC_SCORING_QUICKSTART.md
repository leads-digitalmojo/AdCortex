# Dynamic Scoring Quick Start

Your account health scoring system now uses **dynamic, configurable values** instead of hardcoded static values. Here's how to use it.

## 30-Second Summary

**Before**: Cost thresholds, budget deviations, and metric weights were hardcoded in the transform files.

**After**: All values live in `scoring-config.json` and can be adjusted without touching code.

```json
// Edit these values to change how health scores are calculated
{
  "thresholds": {
    "cost": { "excellent_ratio": 1.1, "good_ratio": 1.2, ... },
    "budget": { "excellent_deviation": 0.10, "good_deviation": 0.15, ... }
  },
  "weights": {
    "google": { "cpsv": 25, "budget": 20, "cpql": 20, ... },
    "meta": { "cpsv": 25, "budget": 25, "cpql": 20, ... }
  }
}
```

## What Was Changed

✅ **Removed** 2 hardcoded functions from both files:
- `scoreStagedCost()` 
- `scoreStagedBudget()`

✅ **Replaced** with dynamic versions that use config values:
- `scoreStagedCostDynamic()` 
- `scoreStagedBudgetDynamic()`

✅ **Files modified**:
- `adpilot/server/google-transform.ts`
- `adpilot/server/meta-transform.ts`

✅ **New files created**:
- `adpilot/server/scoring-config.ts` (config system)
- `adpilot/server/scoring-config.json` (values to edit)
- `adpilot/server/SCORING_CONFIG_GUIDE.md` (detailed docs)
- `adpilot/server/SCORING_EXAMPLES.md` (real examples)

## How to Adjust Scoring

### Option 1: Edit JSON (Recommended)

```bash
# Open this file and edit the values
adpilot/server/scoring-config.json
```

Example: Make cost thresholds stricter
```json
{
  "thresholds": {
    "cost": {
      "excellent_ratio": 1.05,  // ← Change from 1.1
      "good_ratio": 1.15,       // ← Change from 1.2
      "concerning_ratio": 1.25  // ← Change from 1.3
    }
  }
}
```

Restart server for changes to take effect.

### Option 2: Programmatic (Runtime)

```typescript
import { setScoringConfig } from "./server/scoring-config";

// Adjust at runtime without restarting
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
```

## Common Adjustments

### Make Scoring More Lenient ↗️
Accounts are scoring too low? Give them more room:

```json
{
  "cost": {
    "excellent_ratio": 1.2,     // ← Increase from 1.1
    "good_ratio": 1.3,          // ← Increase from 1.2
    "concerning_ratio": 1.4     // ← Increase from 1.3
  },
  "budget": {
    "excellent_deviation": 0.15 // ← Increase from 0.10
  }
}
```

### Make Scoring Stricter ↙️
Want tighter control? Reduce tolerances:

```json
{
  "cost": {
    "excellent_ratio": 1.05,    // ← Decrease from 1.1
    "good_ratio": 1.10,         // ← Decrease from 1.2
    "concerning_ratio": 1.15    // ← Decrease from 1.3
  },
  "budget": {
    "excellent_deviation": 0.05 // ← Decrease from 0.10
  }
}
```

### Emphasize CPL
CPL is your primary KPI? Make it count more:

```json
{
  "weights": {
    "google": {
      "cpl": 25,      // ← Increase from 10
      "cpsv": 15,     // ← Decrease from 25 to balance
      "budget": 15,   // ← Decrease from 20 to balance
      "cpql": 20,
      "campaign": 15,
      "creative": 10
    }
  }
}
```

### Emphasize Budget Pacing
Pacing matters most? Increase its weight:

```json
{
  "weights": {
    "google": {
      "budget": 35,   // ← Increase from 20
      "cpsv": 20,     // ← Decrease to balance
      "cpl": 10,
      "cpql": 15,
      "campaign": 10,
      "creative": 10
    }
  }
}
```

## Understanding the Values

### Cost Thresholds
```json
"cost": {
  "excellent_ratio": 1.1,      // Score 100 if actual ≤ target × 1.1
  "good_ratio": 1.2,           // Score 70 if actual ≤ target × 1.2
  "concerning_ratio": 1.3,     // Score 40 if actual ≤ target × 1.3
  "alert_score": 10            // Score 10 if actual > target × 1.3
}
```

**Example**: CPL target = $100
- Actual $105 (5% over) → Score 100 ✅
- Actual $115 (15% over) → Score 70 ⚠️
- Actual $125 (25% over) → Score 40 ❌

### Budget Pacing Thresholds
```json
"budget": {
  "excellent_deviation": 0.10, // Score 100 if within ±10% of target
  "good_deviation": 0.15,      // Score 60 if within ±15% of target
  "alert_score": 20            // Score 20 if > ±15%
}
```

**Example**: Expected pacing = 100%
- Actual 95% (5% under) → Score 100 ✅
- Actual 105% (5% over) → Score 100 ✅
- Actual 85% (15% under) → Score 60 ⚠️

### Metric Weights
```json
"weights": {
  "google": {
    "cpsv": 25,     // This metric counts 25% toward final score
    "budget": 20,   // This metric counts 20% toward final score
    "cpql": 20,
    "cpl": 10,
    "campaign": 15,
    "creative": 10
    // Total = 100
  }
}
```

## Default Values (Mojo AdCortex v1.0)

These are the current defaults. They match your existing system:

| Parameter | Google | Meta |
|-----------|--------|------|
| CPL Weight | 10% | 20% |
| Budget Weight | 20% | 25% |
| CPQL Weight | 20% | 20% |
| CPSV Weight | 25% | 25% |
| Cost Excellent | 1.1 (10% over) | 1.1 |
| Cost Good | 1.2 (20% over) | 1.2 |
| Budget Excellent | ±10% | ±10% |
| Budget Good | ±15% | ±15% |

## Next Steps

1. **Read** `SCORING_CONFIG_GUIDE.md` for detailed explanation
2. **Review** `scoring-config.json` to understand current values
3. **Check** `SCORING_EXAMPLES.md` for specific use cases
4. **Test** any changes against historical account data
5. **Deploy** your custom configuration

## Files Overview

| File | Purpose |
|------|---------|
| `scoring-config.ts` | Config loader & dynamic functions |
| `scoring-config.json` | **← Edit this for custom values** |
| `SCORING_CONFIG_GUIDE.md` | Detailed parameter explanations |
| `SCORING_EXAMPLES.md` | Real-world scenarios & examples |
| `google-transform.ts` | Uses dynamic scoring (modified) |
| `meta-transform.ts` | Uses dynamic scoring (modified) |

## FAQ

**Q: Will health scores change?**
A: No! Default values are identical to the old hardcoded ones. Scores only change if you modify the config.

**Q: Do I need to restart?**
A: Yes, if using JSON. To avoid restarts, use `setScoringConfig()` at runtime.

**Q: Can I have different configs per client?**
A: Yes! Load config from database per client. Extend `loadScoringConfig()` in `scoring-config.ts`.

**Q: What if I mess up the JSON?**
A: Just restore from git or reset to defaults with `resetScoringConfig()`.

**Q: How often can I change these?**
A: Anytime! The system loads config on startup and can be updated at runtime.

## Support

- **Full Guide**: `SCORING_CONFIG_GUIDE.md`
- **Code Examples**: `SCORING_EXAMPLES.md`
- **Implementation**: `adpilot/server/scoring-config.ts`
- **Current Config**: `adpilot/server/scoring-config.json`

---

**That's it!** Your scoring system is now fully dynamic. Go customize it to match your business needs.
