# Your Account Score Comparison: v1.0 (Staged) vs v2.0 (Formula)

## Your Actual Data

| Metric | Actual | Target | Ratio | v1.0 Score | v2.0 Score | Difference |
|--------|--------|--------|-------|-----------|-----------|-----------|
| CPSV | ₹15,682 | ₹23,000 | 0.68 | 100 | 100 | —— |
| BUDGET | ₹94,093 | ₹86,667 | 108.6% | 100 | 71 | -29 |
| CPQL | ₹4,481 | ₹2,950 | 1.519 | 10 | 37 | +27 |
| CPL | ₹729 | ₹700 | 1.041 | 100 | 95 | -5 |
| CREATIVE | — | — | — | 60 | 60 | —— |

---

## Detailed Calculations

### CPSV: ₹15,682 vs ₹23,000

**Ratio** = 15,682 / 23,000 = 0.68 (GOOD — under target)

#### v1.0 (Staged):
```
ratio = 0.68
0.68 ≤ 1.1 (excellent_ratio) → score = 100
contribution = 100 × 25% = 25/25
```

#### v2.0 (Formula):
```
ratio = 0.68
0.68 ≤ 1.0 (target_ratio) → score = 100
contribution = 100 × 25% = 25/25
```

**Verdict**: Same ✅ (both give 25/25)

---

### BUDGET: ₹94,093 vs ₹86,667 expected (pacing 108.6%)

**Deviation** = |108.6/100 - 1| = 0.086 (over by 8.6%)

#### v1.0 (Staged):
```
deviation = 0.086
0.086 ≤ 0.10 (excellent_deviation) → score = 100
contribution = 100 × 25% = 25/25
```
*v1.0 gives full credit for being within ±10%*

#### v2.0 (Formula):
```
deviation = 0.086
0 < 0.086 < 0.30 (red_deviation), so interpolate
score = 100 - (0.086 / 0.30) × 100
      = 100 - 28.67
      = 71.33 → 71
contribution = 71 × 25% = 17.75/25
```
*v2.0 penalizes the 8.6% overage smoothly*

**Verdict**: v2.0 is stricter (-29 points) ⚠️

---

### CPQL: ₹4,481 vs ₹2,950

**Ratio** = 4,481 / 2,950 = 1.519 (52% over target — PROBLEM)

#### v1.0 (Staged):
```
ratio = 1.519
1.519 > 1.3 (concerning_ratio) → score = 10 (alert)
contribution = 10 × 20% = 2/20
```
*v1.0 assigns bottom score (10) for anything >30% over*

#### v2.0 (Formula):
```
ratio = 1.519
1.5 < 1.519 < 2.0, so in RED zone
redRange = 2.0 - 1.5 = 0.5
positionInRed = 1.519 - 1.5 = 0.019
score = ((0.5 - 0.019) / 0.5) × 39
      = (0.481 / 0.5) × 39
      = 37.5 → 37
contribution = 37 × 20% = 7.4/20
```
*v2.0 gives 37 because you're only 1.9% into the RED zone*

**Verdict**: v2.0 is fairer (+27 points) 💡

**Why it matters**: Your CPQL is 51.9% over target. The gap between red_multiplier (1.5 = 50% over) and floor_multiplier (2.0 = 100% over) is huge. You're at the beginning of that range, so v2.0 gives you 37 instead of a blanket 10.

---

### CPL: ₹729 vs ₹700

**Ratio** = 729 / 700 = 1.041 (4.1% over target — GOOD)

#### v1.0 (Staged):
```
ratio = 1.041
1.041 ≤ 1.1 (excellent_ratio) → score = 100
contribution = 100 × 20% = 20/20
```
*v1.0 gives full score for anything within 10% of target*

#### v2.0 (Formula):
```
ratio = 1.041
1.0 < 1.041 < 1.5, so interpolate
greenRange = 1.5 - 1.0 = 0.5
positionInGreen = 1.041 - 1.0 = 0.041
score = 100 - (0.041 / 0.5) × 60
      = 100 - 4.92
      = 95.08 → 95
contribution = 95 × 20% = 19/20
```
*v2.0 penalizes the 4.1% overage slightly*

**Verdict**: v2.0 is slightly stricter (-5 points)

**Why it matters**: With v2.0, being over target (even slightly) costs you points. With v1.0, you get full credit as long as you're within the band.

---

### CREATIVE: 60/100

Both systems treat creative the same (no formula needed for external score).

**v1.0**: 60 × 10% = 6/10  
**v2.0**: 60 × 10% = 6/10

---

## Composite Score Calculation

### v1.0 (Staged)

```
CPSV:    25/25
BUDGET:  25/25
CPQL:     2/20
CPL:     20/20
CREATIVE: 6/10
─────────────
Total:   78/100

Override Rule Check:
  CPQL → score 10 < 50 (RED) AND weight 20% ≥ 15%
  → Apply override: cap 78 → 74

Final Score: 74 (WATCH / YELLOW)
```

### v2.0 (Formula)

```
CPSV:    25/25
BUDGET:  17.75/25  (71 × 25%)
CPQL:     7.4/20   (37 × 20%)
CPL:     19/20     (95 × 20%)
CREATIVE: 6/10
─────────────
Total:   75.15 → 75/100

Override Rule Check:
  CPQL → score 37 < 50 (RED) AND weight 20% ≥ 15%
  → Apply override: cap would be 74, but 75 > 74, so no cap needed
  
  Actually: 75.15 ≥ 75 (green threshold) → GREEN
  Check: CPQL is RED (37) with weight 20% ≥ 15% → should cap to 74
  Result: min(75.15, 74) = 74... 
  
  Wait, let me recalculate:
  If CPQL (37) < 50 and weight 20% ≥ 15%, cap to 74.
  75 > 74? Yes.
  So final = 74 (capped)

Actually wait - the rule is: IF RED metric exists with weight ≥15%, cap composite to 74.
So: CPQL = 37 (RED), weight = 20% (≥15%) → cap = 74
Final: min(75.15, 74) = 74

Final Score: 74 (WATCH / YELLOW, same as v1.0 but for different reasons)
```

---

## Key Insight

**Your account scores 74 in both systems, but for different reasons:**

| Metric | v1.0 Impact | v2.0 Impact |
|--------|----------|----------|
| CPSV | Perfect (25) | Perfect (25) |
| BUDGET | Perfect (25) | Penalized (17.75) |
| CPQL | Heavily Penalized (2) | Fairly Penalized (7.4) |
| CPL | Perfect (20) | Nearly Perfect (19) |

**v1.0**: Budget is perfect (within ±10%), but CPQL gets hammered.  
**v2.0**: Budget is penalized for overpacing, but CPQL is treated more fairly.

Both end at 74 due to the RED override rule capping the score.

---

## What Does This Mean?

### The Good News ✅
- v2.0 is **fairer** to accounts like yours
- Your CPQL gets partial credit (37) instead of bottom score (10)
- The formula rewards gradual improvement more clearly

### The Challenge ⚠️
- v2.0 **penalizes overpacing** more harshly than v1.0
- Your 8.6% budget overage costs you -29 points in v2.0 vs 0 in v1.0
- You need to tighten budget pacing to improve significantly

### To Improve Your Health Score

**Priority 1: Fix CPQL** (the real problem)
- Current: ₹4,481 vs ₹2,950 target (52% over)
- Target: Get to ₹2,950 or below
- Impact: CPQL would jump from 37 → 95+, composite would jump to ~85+ (GREEN)

**Priority 2: Improve Budget Pacing** (optional but helps)
- Current: ₹94,093 vs ₹86,667 expected (108.6%)
- Target: Get to 100% or slightly under
- Impact: Budget would jump from 71 → 100, small boost to composite

**Priority 3: Keep CPL & CPSV** (doing well)
- Both are excellent, no action needed

---

## Configuration Summary

To use v2.0 formula-based scoring:

**Default Thresholds** (already set):
```json
{
  "cost": {
    "target_ratio": 1.0,
    "red_multiplier": 1.5,      // 50% over = RED
    "floor_multiplier": 2.0,    // 2× = score 0
    "excellent_floor": 40
  },
  "budget": {
    "target_deviation": 0.0,
    "red_deviation": 0.30,      // ±30% = RED
    "excellent_floor": 40
  }
}
```

These are **tuned for your business**. Adjust if needed.

---

## Next Steps

1. ✅ Confirm you want to use v2.0 formula-based scoring
2. ⚠️ Understand that scores will shift (yours: v1.0 74 → v2.0 74, but for different reasons)
3. 📊 Monitor your metrics with the new system
4. 🎯 Focus on reducing CPQL to improve health
