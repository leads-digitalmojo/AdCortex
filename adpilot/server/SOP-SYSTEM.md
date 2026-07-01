# SOP (Standard Operating Procedure) System

## Overview

The SOP System is a 2-layer architecture for generating deterministic marketing insights:

1. **Layer 2 (Deterministic)** — `sop-engine.ts`: Evaluates structured business rules against live account data
2. **Layer 3 (AI Reasoning)** — Claude AI: Enhances and contextualizes SOP findings with strategic reasoning

This system replaces hardcoded rules with a configurable, database-driven approach that sources SOPs from `docs/Sop-Dump.md`.

---

## Architecture

### Files

| File | Purpose |
|------|---------|
| `sop-database.json` | Structured SOP definitions (JSON format) |
| `sop-loader.ts` | Parser/evaluator for SOP database |
| `sop-engine.ts` | Orchestrator: loads SOPs, evaluates conditions, generates insights |
| `intelligence-engine.ts` | 4-layer pipeline: uses `analyzeSop()` as Layer 2 input |
| `docs/Sop-Dump.md` | Source of truth for all business rules (markdown) |

### Data Flow

```
Raw Account Data
       ↓
[sop-engine.analyzeSop()]
       ↓
Database SOPs ← [sop-loader.getMatchingSops()]
       ↓
SopInsight[] (Layer 2 output)
       ↓
[intelligence-engine.insightsEngine()]
       ↓
Claude AI (Layer 3) + SOP findings
       ↓
Final Recommendations
```

---

## How to Use

### 1. Defining a New SOP

Edit `sop-database.json` and add a new SOP object:

```json
{
  "id": "my_sop_id",
  "name": "My SOP Name",
  "category": "efficiency",
  "metric": "cpl",
  "platforms": ["meta", "google"],
  "entityType": "campaign",
  "enabled": true,
  "priority": "HIGH",
  "iceScore": 7,
  "condition": {
    "type": "threshold",
    "field": "cpl",
    "operator": ">",
    "value": 1.3,
    "reference": "target_cpl"
  },
  "issue": "CPL Above Target",
  "impactTemplate": "Campaign \"{name}\" CPL (₹{cpl}) exceeds target.",
  "recommendation": "Review audience targeting and landing page experience.",
  "notes": "From SOP Dump: Cost stack triage"
}
```

### 2. Running SOP Evaluation

The system automatically evaluates SOPs when `analyzeSop()` is called:

```typescript
import { analyzeSop } from "./sop-engine";

const insights = analyzeSop(analysisData, targets, "meta");
// Returns: SopInsight[]
```

### 3. Filtering SOPs by Platform

SOPs are automatically filtered by platform:
- `platforms: ["meta"]` → only evaluate on Meta accounts
- `platforms: ["google"]` → only evaluate on Google accounts
- `platforms: ["meta", "google"]` → evaluate on both

### 4. SOP Conditions

#### Threshold Conditions
```json
{
  "type": "threshold",
  "field": "cpl",
  "operator": ">",
  "value": 1.3,
  "reference": "target_cpl"
}
```

**Operators:** `>`, `<`, `>=`, `<=`, `==`, `!=`

**References:**
- `"target_cpl"` → uses `targets.cpl`
- `"platform_baseline"` → 120 (Meta default)
- `"platform_benchmark"` → uses `platformThresholds` for platform-specific values
- `"trailing_7day_average"` → compares to 7-day baseline
- `"hot_warm_ratio"` → lead quality ratio

#### Compound Conditions
```json
{
  "type": "compound",
  "operator": "AND",
  "conditions": [
    { "field": "days_active", "operator": ">", "value": 7 },
    { "field": "leads", "operator": "<", "value": 5 }
  ]
}
```

**Operators:** `AND`, `OR`

---

## SOP Categories

| Category | Examples |
|----------|----------|
| **efficiency** | CPL, CPA, cost-effectiveness |
| **conversion** | CVR floor, form friction |
| **cost** | CPC inflation, CPM baseline |
| **delivery** | Budget-constrained, rank-constrained |
| **learning** | Algorithm learning trap, early-stage low performance |
| **creative** | Fatigue, critical failure, audience saturation |
| **audience** | Quality mismatch, audience saturation |
| **health** | Overall account health, pacing, tracking |
| **tracking** | Conversion anomalies, pixel issues |
| **quality** | Quality Score (Google-specific) |

---

## Key SOPs

### Account-Level
- **Critical CPL Deviation** — Account CPL > 1.5x target
- **Tracking Anomaly** — Zero leads today despite historical average
- **Pacing Deviation** — Spend variance > ±20% from plan

### Campaign-Level
- **Zero Leads Drain** — High spend (>2x CPL) with zero leads → **PAUSE**
- **CPL Above Threshold** — CPL > 1.3x target with low CVR
- **CPC Inflation** — CPC > platform benchmark (Google: ₹120, Meta: ₹45)
- **Algorithm Learning Trap** — Days active > 7, leads < 5, imps > 5000 → reset targeting
- **Impression Share Loss** — Budget-constrained (>20%) or rank-constrained (>40%)
- **Top Performer** — Leads ≥5, CPL < 0.7x target → **SCALE**

### Creative-Level
- **Critical Creative Failure** — Performance score < 35 → **PAUSE**
- **Advanced Creative Fatigue** — Age > 45 days or (age > 35 + score < 70) → refresh
- **Audience Saturation** — Frequency > 3.0 → refresh creatives

---

## How SOPs Map to SOP Dump

| SOP ID | Source in Sop-Dump.md |
|--------|------------------------|
| `cpl_deviation_account` | Account-level CPL monitoring |
| `zero_leads_drain` | Daily Optimizations - conversion tracking |
| `cpc_inflation_google` | Google Ads - CPC control in Search |
| `cpc_inflation_meta` | Meta Ads - bidding strategy review |
| `algorithm_learning_trap` | Meta Ads - performance plateau detection |
| `tracking_anomaly_cvr` | Daily Optimizations - CVR drop detection |
| `creative_fatigue_detected` | Meta Ads - frequency + CTR/CPM diagnostics |
| `impression_share_budget_lost` | Google Ads - IS Lost (Budget) handling |
| `impression_share_rank_lost` | Google Ads - IS Lost (Rank) handling |
| `top_performer_scaling` | Winner Scaling playbook |

---

## Testing SOPs

### 1. Reload the Database (Development)
```typescript
import { reloadSopDatabase } from "./sop-loader";

reloadSopDatabase(); // Forces fresh read from JSON
```

### 2. Check Enabled SOPs
```typescript
import { getEnabledSops } from "./sop-loader";

const metaSops = getEnabledSops("meta");
console.log(`${metaSops.length} Meta SOPs enabled`);
```

### 3. Debug a Specific SOP
Temporarily add logging to `sop-loader.ts`:
```typescript
console.log(`[SOP ${sop.id}] Evaluated: ${matched ? "MATCHED" : "NO MATCH"}`);
```

---

## Customization

### Disable a SOP
```json
{
  "id": "my_sop",
  "enabled": false  // Won't be evaluated
}
```

### Add a Client-Specific SOP
1. Create a new entry in `sop-database.json`
2. Set `platforms: ["meta"]` or `["google"]` to scope it
3. Set `enabled: true`

Example: Luxury real estate has higher CPL tolerance:
```json
{
  "id": "luxury_cpl_tolerance",
  "name": "Luxury CPL Threshold",
  "metric": "cpl",
  "platforms": ["meta", "google"],
  "entityType": "campaign",
  "enabled": true,
  "priority": "MEDIUM",
  "iceScore": 6,
  "condition": {
    "type": "threshold",
    "field": "cpl",
    "operator": ">",
    "value": 2.0,
    "reference": "target_cpl"
  },
  "issue": "Luxury CPL Above Tolerance",
  "impactTemplate": "Luxury campaign \"{name}\" CPL (₹{cpl}) exceeds 2x tolerance.",
  "recommendation": "Monitor — higher CPL expected for luxury segment. Ensure lead quality is Hot.",
  "notes": "Custom for luxury real estate clients"
}
```

---

## Performance

- **Load Time:** ~10ms (JSON parse + cache)
- **Evaluation Time:** ~5ms per campaign (compound conditions evaluated left-to-right)
- **Memory:** Single cached database copy (~100KB)

Caching is automatic; `sop-loader.ts` caches the database after first load.

---

## Troubleshooting

### SOP Not Firing?
1. **Check `enabled: true`** — SOP is disabled
2. **Check `platforms`** — SOP doesn't include current platform
3. **Check `entityType`** — SOP only evaluates specific entity types
4. **Debug condition** — Add logging to `evaluateCondition()` in `sop-loader.ts`

### SOP Firing Too Often?
1. **Tighten condition** — Use `AND` instead of `OR`
2. **Raise threshold** — Increase `value` in condition
3. **Disable if not needed** — Set `enabled: false`

### Template Not Formatting?
1. **Check field names** — Must match keys in `campaignData`
2. **Verify placeholder syntax** — Use `{field_name}`, not `{field name}`
3. **Check reference** — `reference` values must match resolver logic

---

## Future Enhancements

- [ ] Client-specific SOP overrides (per-account config)
- [ ] SOP versioning and A/B testing
- [ ] SOP performance metrics (false positive rate, ROI impact)
- [ ] Automated SOP suggestion (AI recommends new rules)
- [ ] SOP export to documentation (auto-generate playbooks)
