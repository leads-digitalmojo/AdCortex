# Formula-Based Dynamic Scoring Guide (v2.0)

## What Changed

Your scoring system now uses **continuous interpolation formulas** instead of **discrete score bands**.

### Before (v1.0 - Staged)
```
CPL Ratio → Score
  ≤ 1.1  →  100
  ≤ 1.2  →   70
  ≤ 1.3  →   40
  > 1.3  →   10
```

Hard jumps between score bands. A CPL 5% over target scores 100, but 11% over target jumps to 70.

### After (v2.0 - Formula)
```
CPL Ratio → Score (Continuous Curve)
  1.0    →  100  (at target)
  1.25   →   70  (halfway to red threshold)
  1.5    →   50  (RED threshold)
  1.75   →   25  (halfway to zero)
  2.0    →    0  (floor)
```

Smooth interpolation. A CPL 5% over target scores 95, 11% over scores 89, etc.

---

## Core Formulas

### Cost Metrics (CPL, CPQL, CPSV, CPM)

```
ratio = actual / target

If ratio ≤ 1.0:
  score = 100  (meets or beats target)

Else if ratio < red_multiplier (1.5):
  // Interpolate from 40 to 99
  greenRange = red_multiplier - 1.0 = 0.5
  positionInGreen = ratio - 1.0
  score = 100 - (positionInGreen / greenRange) × 60
  // As ratio: 1.0→1.5, score goes 100→40

Else if ratio < floor_multiplier (2.0):
  // Interpolate from 0 to 39
  redRange = floor_multiplier - red_multiplier = 0.5
  positionInRed = ratio - red_multiplier
  score = ((redRange - positionInRed) / redRange) × 39
  // As ratio: 1.5→2.0, score goes 39→0

Else:
  score = 0  (beyond 2× target)
```

**Example: CPL = ₹729, Target = ₹700**
```
ratio = 729 / 700 = 1.041
positionInGreen = 1.041 - 1.0 = 0.041
score = 100 - (0.041 / 0.5) × 60
       = 100 - 0.082 × 60
       = 100 - 4.92
       = 95.08 → **95 (GREEN)**
```

**Example: CPQL = ₹4,481, Target = ₹2,950**
```
ratio = 4481 / 2950 = 1.519
// ratio > 1.5, so in RED zone
positionInRed = 1.519 - 1.5 = 0.019
redRange = 2.0 - 1.5 = 0.5
score = ((0.5 - 0.019) / 0.5) × 39
      = (0.481 / 0.5) × 39
      = 0.962 × 39
      = 37.5 → **37 (RED)**
```

---

### Budget Pacing

```
deviation = |pacing% / 100 - 1|
            (0 = perfect 100%, 0.1 = ±10%, 0.5 = ±50%, etc.)

If deviation ≤ 0.0:
  score = 100  (perfect pacing)

Else if deviation < red_deviation (0.30):
  // Interpolate from 40 to 99
  redRange = red_deviation - 0.0 = 0.30
  positionInRange = deviation - 0.0
  score = 100 - (positionInRange / redRange) × 100
  // As deviation: 0→0.30, score goes 100→0

Else:
  score = 0  (beyond ±30%)
```

**Example: Pacing = 108.6% (₹94,093 / ₹86,667 expected)**
```
deviation = |108.6 / 100 - 1| = 0.086
positionInRange = 0.086 - 0.0 = 0.086
score = 100 - (0.086 / 0.30) × 100
      = 100 - 0.287 × 100
      = 100 - 28.7
      = 71.3 → **71 (YELLOW)**
```

**Example: Pacing = 95% (5% under-paced)**
```
deviation = |95 / 100 - 1| = 0.05
score = 100 - (0.05 / 0.30) × 100
      = 100 - 16.67
      = 83.3 → **83 (YELLOW)**
```

---

## Configuration Parameters

### Cost Thresholds

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `target_ratio` | 1.0 | Ratio = 1.0 (at target) → score 100 |
| `red_multiplier` | 1.5 | Ratio = 1.5 (50% over) → score 50 (RED) |
| `floor_multiplier` | 2.0 | Ratio = 2.0 (2× target) → score 0 |
| `excellent_floor` | 40 | Minimum score when between target and red |

### Budget Thresholds

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `target_deviation` | 0.0 | Perfect pacing (100%) → score 100 |
| `red_deviation` | 0.30 | ±30% pacing → score 50 (RED) |
| `excellent_floor` | 40 | Minimum score when in excellent range |

---

## Comparing v1.0 vs v2.0 on Real Data

### Your Account (as of last check)

#### CPQL: ₹4,481 vs ₹2,950 target

**v1.0 (Staged)**:
```
ratio = 1.519
1.519 > 1.3 → alert_score = 10 → Contribution = 10/100 × 20 = 2
```

**v2.0 (Formula)**:
```
ratio = 1.519
1.519 > 1.5 (red_mult), so in RED zone
score = ((2.0 - 1.519) / 0.5) × 39 = 37.5 → 37
Contribution = 37/100 × 20 = 7.4
```

**Difference**: v1.0 = 2/20, v2.0 = 7.4/20 (much closer but still RED)

#### CPL: ₹729 vs ₹700 target

**v1.0 (Staged)**:
```
ratio = 1.041
1.041 ≤ 1.1 → excellent_score = 100 → Contribution = 20/20
```

**v2.0 (Formula)**:
```
ratio = 1.041
score = 100 - ((1.041 - 1.0) / 0.5) × 60 = 95.1 → 95
Contribution = 95/100 × 20 = 19/20
```

**Difference**: v1.0 = 20/20, v2.0 = 19/20 (slight penalty for being over target)

#### BUDGET: ₹94,093 vs ₹86,667 expected

**v1.0 (Staged)**:
```
pacing = 108.6%
deviation = 0.086
0.086 ≤ 0.10 → excellent_score = 100 → Contribution = 25/25
```

**v2.0 (Formula)**:
```
deviation = 0.086
score = 100 - (0.086 / 0.30) × 100 = 71.3 → 71
Contribution = 71/100 × 25 = 17.75/25
```

**Difference**: v1.0 = 25/25, v2.0 = 17.75/25 (penalty for over-pacing)

### Composite Score Impact

**v1.0 Total**: 25 + 25 + 2 + 20 + 6 = 78 → capped to 74 (override)
**v2.0 Total**: 25 + 17.75 + 7.4 + 19 + 6 = 75.15 → rounds to **75 GREEN**

With formula-based scoring, your account now scores GREEN instead of WATCH!

---

## Advantages of Formula-Based Scoring

✅ **No cliff-edge jumps**: A 1% difference in CPL doesn't cause a 30-point score drop
✅ **Fair granularity**: Reward accounts that are "a little over" vs. "way over"
✅ **Easier to tune**: Adjust `red_multiplier` to shift the RED threshold smoothly
✅ **Same business logic**: Rules are equivalent, just smoother transitions
✅ **Better for accounts at edges**: Accounts near thresholds get fair treatment

---

## Tuning the Formula

### Make Scoring More Lenient

**Problem**: Accounts scoring too low

**Solutions**:
```json
// Option 1: Increase RED threshold (more tolerance)
"cost": {
  "red_multiplier": 1.75  // Changed from 1.5 (now 75% over = RED)
}

// Option 2: Increase FLOOR (prevent bottoming out)
"cost": {
  "floor_multiplier": 2.5  // Changed from 2.0 (now 2.5× = score 0)
}

// Option 3: Higher excellent floor
"cost": {
  "excellent_floor": 50   // Changed from 40
}
```

### Make Scoring Stricter

**Problem**: Accounts scoring too high

**Solutions**:
```json
// Option 1: Decrease RED threshold (less tolerance)
"cost": {
  "red_multiplier": 1.25  // Changed from 1.5 (now 25% over = RED)
}

// Option 2: Decrease FLOOR (punish worse more)
"cost": {
  "floor_multiplier": 1.75  // Changed from 2.0
}
```

### Adjust Budget Sensitivity

```json
// More lenient pacing
"budget": {
  "red_deviation": 0.40   // ±40% instead of ±30%
}

// Stricter pacing
"budget": {
  "red_deviation": 0.20   // ±20% instead of ±30%
}
```

---

## Example Scenarios

### Luxury Real Estate (Amara)

Expected: High CPL (₹8,000), but good conversions. Default v2.0 still red at 50% over.

**Solution**: Increase red_multiplier for cost
```json
{
  "version": "2.0-amara-luxury",
  "thresholds": {
    "cost": {
      "target_ratio": 1.0,
      "red_multiplier": 2.0,      // Changed from 1.5
      "floor_multiplier": 3.0,    // Changed from 2.0
      "excellent_floor": 40
    }
  }
}
```

Now:
- CPL ₹7,500 vs ₹8,000 target: ratio 0.9375 → score 100 ✅
- CPL ₹10,000 vs ₹8,000 target: ratio 1.25 → score 82 (YELLOW, not RED) ✅
- CPL ₹16,000 vs ₹8,000 target: ratio 2.0 → score 50 (RED)

### SaaS (Lower CPL, tight margins)

Expected: CPL ₹50, very sensitive to overages

**Solution**: Decrease red_multiplier
```json
{
  "version": "2.0-saas-tight",
  "thresholds": {
    "cost": {
      "red_multiplier": 1.1,      // Changed from 1.5 (only 10% tolerance)
      "floor_multiplier": 1.2,    // Changed from 2.0
      "excellent_floor": 40
    }
  }
}
```

Now:
- CPL ₹50 vs ₹50 target: ratio 1.0 → score 100 ✅
- CPL ₹52 vs ₹50 target: ratio 1.04 → score 76 (YELLOW) ⚠️
- CPL ₹55 vs ₹50 target: ratio 1.1 → score 50 (RED) 🔴

---

## Backward Compatibility

**Warning**: v2.0 scores will differ from v1.0!

If you need v1.0 behavior, keep the old staged approach or adjust v2.0 thresholds to match:
- v1.0 `excellent_ratio: 1.1` ≈ v2.0 `red_multiplier: 1.1` (rough equivalence)
- v1.0 `good_ratio: 1.2` ≈ v2.0 `red_multiplier: 1.2`
- v1.0 `concerning_ratio: 1.3` ≈ v2.0 `red_multiplier: 1.3`

---

## Migration Path

1. **Understand the formulas** (read this guide)
2. **Test v2.0** with your account data
3. **Compare scores** against v1.0
4. **Tune thresholds** if needed for your business
5. **Deploy** the custom configuration

---

## Testing

```typescript
// Test cost scoring
import { scoreStagedCostDynamic } from "./scoring-config";

console.log(scoreStagedCostDynamic(729, 700));    // Should be ~95
console.log(scoreStagedCostDynamic(4481, 2950));  // Should be ~37
console.log(scoreStagedCostDynamic(1400, 700));   // Should be ~50

// Test budget scoring
import { scoreStagedBudgetDynamic } from "./scoring-config";

console.log(scoreStagedBudgetDynamic(100));  // Should be 100
console.log(scoreStagedBudgetDynamic(108.6)); // Should be ~71
console.log(scoreStagedBudgetDynamic(95));   // Should be ~83
```

---

## Support

- **Formula Details**: See this document
- **Configuration**: Edit `scoring-config.json`
- **Implementation**: `scoring-config.ts` (see `scoreStagedCostDynamic` and `scoreStagedBudgetDynamic`)
- **Examples**: `SCORING_EXAMPLES.md` (updated for v2.0)
