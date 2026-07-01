# Dynamic Scoring Configuration Examples

Quick reference for common adjustments to health scoring thresholds and weights.

## Cost Metrics Examples

### Example 1: Make Cost Tolerance More Lenient

**Goal**: Accounts are constantly scoring RED/YELLOW on CPL despite hitting business targets.

**Current Config**:
```json
"cost": {
  "excellent_ratio": 1.1,      // 10% over target
  "good_ratio": 1.2,           // 20% over target
  "concerning_ratio": 1.3,     // 30% over target
  "excellent_score": 100,
  "good_score": 70,
  "concerning_score": 40,
  "alert_score": 10
}
```

**Adjusted Config**:
```json
"cost": {
  "excellent_ratio": 1.15,     // 15% over target (more lenient)
  "good_ratio": 1.25,          // 25% over target (more lenient)
  "concerning_ratio": 1.35,    // 35% over target (more lenient)
  "excellent_score": 100,
  "good_score": 70,
  "concerning_score": 40,
  "alert_score": 10
}
```

**Impact**:
- Account with CPL 5% over target: Still 100
- Account with CPL 15% over target: 100 (was 70)
- Account with CPL 25% over target: 70 (was 40)
- Account with CPL 35% over target: 40 (was 10)

---

### Example 2: Make Cost Tolerance Stricter

**Goal**: Want to catch small cost overruns and encourage tighter control.

**Adjusted Config**:
```json
"cost": {
  "excellent_ratio": 1.05,     // 5% over target (stricter)
  "good_ratio": 1.10,          // 10% over target (stricter)
  "concerning_ratio": 1.15,    // 15% over target (stricter)
  "excellent_score": 100,
  "good_score": 70,
  "concerning_score": 40,
  "alert_score": 10
}
```

**Impact**:
- Account with CPL 3% over target: 100
- Account with CPL 7% over target: 70 (was 100)
- Account with CPL 12% over target: 40 (was 100)

---

## Budget Pacing Examples

### Example 3: Stricter Budget Pacing

**Goal**: Accounts are WAY underspending or overspending, but still scoring well.

**Current Config**:
```json
"budget": {
  "excellent_deviation": 0.10,  // ±10%
  "good_deviation": 0.15,       // ±15%
  "excellent_score": 100,
  "good_score": 60,
  "alert_score": 20
}
```

**Adjusted Config**:
```json
"budget": {
  "excellent_deviation": 0.05,  // ±5% (stricter)
  "good_deviation": 0.10,       // ±10% (stricter)
  "excellent_score": 100,
  "good_score": 60,
  "alert_score": 20
}
```

**Impact on pacing percentage**:
- 100% pacing (on track): 100
- 103% pacing (3% over): 100
- 107% pacing (7% over): 60 (was 100)
- 112% pacing (12% over): 20 (was 60)

---

### Example 4: More Lenient Budget Pacing

**Goal**: Budget pacing is hard to control; don't penalize accounts for small deviations.

**Adjusted Config**:
```json
"budget": {
  "excellent_deviation": 0.15,  // ±15% (more lenient)
  "good_deviation": 0.20,       // ±20% (more lenient)
  "excellent_score": 100,
  "good_score": 60,
  "alert_score": 20
}
```

**Impact**:
- 85% pacing: 100 (was 60)
- 80% pacing: 60 (was 20)
- 70% pacing: 20 (was 20)

---

## Metric Weights Examples

### Example 5: Emphasize CPL (Cost Per Lead)

**Goal**: CPL is your primary KPI; underperformance should drag overall score down more.

**Google — Current Config**:
```json
"google": {
  "account_level": {
    "cpsv": 25,
    "budget": 20,
    "cpql": 20,
    "cpl": 10,        // Low weight
    "campaign": 15,
    "creative": 10
  }
}
```

**Google — Adjusted Config**:
```json
"google": {
  "account_level": {
    "cpsv": 20,       // Reduce from 25
    "budget": 15,     // Reduce from 20
    "cpql": 15,       // Reduce from 20
    "cpl": 25,        // Increase from 10
    "campaign": 15,
    "creative": 10
  }
}
```

**Impact**:
- Before: CPL scored 50, overall score = 72 (YELLOW)
- After: CPL scored 50, overall score = 65 (RED) — much more impact

---

### Example 6: Emphasize Budget Pacing

**Goal**: You want stricter budget discipline across all accounts.

**Meta — Adjusted Config**:
```json
"meta": {
  "account_level": {
    "cpsv": 15,       // Reduce from 25
    "budget": 40,     // Increase from 25 ← Much higher!
    "cpql": 15,       // Reduce from 20
    "cpl": 15,        // Reduce from 20
    "creative": 15    // Increase from 10
  }
}
```

**Impact**:
- Budget now has 60% more influence on overall health score
- A RED budget score will drag the composite score down much more

---

### Example 7: Balanced Weights (Equal Emphasis)

**Goal**: Want all metrics to have equal influence.

**Adjusted Config**:
```json
"google": {
  "account_level": {
    "cpsv": 20,
    "budget": 20,
    "cpql": 20,
    "cpl": 20,
    "campaign": 10,
    "creative": 10
  }
}
```

**Impact**: Each metric contributes equally except campaign/creative (lower weight)

---

## Override Rules Examples

### Example 8: Tighter RED Override Rule

**Goal**: Don't let one good metric save an account if another metric is failing.

**Current Config**:
```json
"override_rules": {
  "red_metric_weight_threshold": 15,  // If metric with weight ≥15% is RED...
  "red_cap_threshold": 74              // ...cap score to 74 (max YELLOW)
}
```

**Adjusted Config**:
```json
"override_rules": {
  "red_metric_weight_threshold": 10,  // Lower threshold (stricter)
  "red_cap_threshold": 50              // Lower cap (no YELLOW mask)
}
```

**Impact**:
- A single RED metric (weight 10-14%) now caps the overall score
- Account can't stay YELLOW if any important metric is RED
- Drives focus on fixing all problem areas

---

### Example 9: More Forgiving RED Override

**Goal**: Single RED metrics shouldn't penalize overall score too much.

**Adjusted Config**:
```json
"override_rules": {
  "red_metric_weight_threshold": 20,  // Higher threshold
  "red_cap_threshold": 80              // Higher cap (allows higher GREEN scores)
}
```

**Impact**:
- Only metrics with weight ≥20% trigger the override
- Less likely to cap a good account to YELLOW

---

## Real-World Scenario: Luxury Real Estate Client

**Situation**: Amara (luxury real estate) has high CPL targets but great conversions.

**Default Config Problems**:
- CPL target: $8,000 (rare, high-value leads)
- Actual CPL: $7,500 (excellent)
- But account scores RED because cost ratios are designed for lower CPL

**Custom Config for Amara**:

```json
{
  "version": "1.0-amara-luxury",
  "thresholds": {
    "cost": {
      "excellent_ratio": 1.2,      // 20% more tolerance for high CPL
      "good_ratio": 1.4,           // 40% tolerance
      "concerning_ratio": 1.6,     // 60% tolerance
      "excellent_score": 100,
      "good_score": 70,
      "concerning_score": 40,
      "alert_score": 10
    },
    "budget": {
      "excellent_deviation": 0.20,  // Higher variance in luxury biz
      "good_deviation": 0.30,
      "excellent_score": 100,
      "good_score": 60,
      "alert_score": 20
    }
  },
  "weights": {
    "meta": {
      "account_level": {
        "cpsv": 30,        // Emphasize sales (more important)
        "budget": 15,      // Less important in luxury (flexible)
        "cpql": 30,        // Qualified leads crucial
        "cpl": 15,         // High CPL expected, less emphasis
        "creative": 10
      }
    }
  },
  "override_rules": {
    "red_metric_weight_threshold": 25,  // Only very high-weight metrics trigger cap
    "red_cap_threshold": 70
  }
}
```

**Result**: Amara's scores now reflect luxury real estate reality vs. lead gen reality

---

## How to Apply These Examples

### Step 1: Identify Your Problem
- Are accounts scoring too low? → Increase tolerances
- Are accounts scoring too high? → Decrease tolerances
- Is one metric dominating? → Adjust weights

### Step 2: Choose an Example
Find the example that matches your situation.

### Step 3: Edit the Config
Modify `scoring-config.json` with the adjusted values.

### Step 4: Test Against Historical Data
```typescript
// Pseudo-code for testing
const oldConfig = getScoringConfig();
setScoringConfig(newConfig);

const newScores = calculateScoresForAllAccounts();
const impact = compareScores(oldScores, newScores);

// Review impact before deploying
console.log(impact);
resetScoringConfig();  // Back to original
```

### Step 5: Deploy
Once confident in the changes, commit `scoring-config.json` and deploy.

---

## Common Mistakes

❌ **Forgetting to keep weights summing to 100**
```json
"weights": { "cpl": 25, "budget": 25, "cpql": 25 }  // = 75, not 100!
```

❌ **Making thresholds too extreme**
```json
"excellent_ratio": 2.0  // Basically any CPL is excellent
```

❌ **Applying same config to all clients**
- Luxury real estate ≠ SaaS
- Consider client-specific overrides

✅ **Do test changes first**
```typescript
setScoringConfig(newConfig);
const testScores = calculateTestScores();
// Review results, then commit if good
```

✅ **Do version your configs**
```json
{
  "version": "1.1-april-2026-stricter-cpl",
  "description": "Increased CPL emphasis after Q1 reviews"
}
```

✅ **Do document why you changed values**
```json
{
  "reason": "Amara has $8K+ average CPL; standard ratios are too strict",
  "changed_by": "john@company.com",
  "changed_date": "2026-04-14"
}
```

---

## Testing Checklist

Before deploying config changes:

- [ ] Review all value changes
- [ ] Calculate example scores manually
- [ ] Test against 5-10 representative accounts
- [ ] Compare old vs new scores
- [ ] Verify weights sum to 100
- [ ] Check for unintended side effects
- [ ] Document reason for changes
- [ ] Get approval from stakeholders
- [ ] Deploy to production
- [ ] Monitor health scores for 1-2 weeks
