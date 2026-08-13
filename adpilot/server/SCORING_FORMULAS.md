# AdPilot Scoring Formulas — Google & Meta

This document is a reference inventory of every health-score formula currently
in the codebase, across both scoring layers:

- **Python layer** (`ads_agent/scoring_engine.py`, `ads_agent/google_ads_agent_v2.py`,
  `ads_agent/meta_ads_agent_v2.py`) — computes scores when campaign data is generated.
- **TypeScript layer** (`adpilot/server/scoring-config.ts`, `google-transform.ts`,
  `meta-transform.ts`) — re-normalizes data for the frontend, and in several places
  **recomputes and overwrites** what Python produced with different formulas/weights.

Wherever TS overwrites Python's number, it's called out explicitly — the two systems
do not always agree.

No persisted override file exists at `ads_agent/data/scoring_config_overrides.json`,
so the account-level TS scoring currently runs on pure hardcoded defaults.

---

## Shared math primitives — `adpilot/server/scoring-config.ts`

**Cost metrics** (CPL, CPC, CPQL, CPSV — lower is better), quadratic decay:

```
d = max(0, (actual - target) / target)
score = 100 × max(0, 1 − 1.5d − 5d²)
```
- at target (d=0) → 100
- 10% over → 80
- 20% over → 50
- 30% over → 10
- 34%+ over → 0

**Budget pacing** (deviation from planned spend), quadratic decay:

```
b = |actual_spend / planned_budget − 1|
score = 100 × max(0, 1 − b − 10b²)
```
- 0% deviation → 100
- 10% deviation → 80
- 20% deviation → 40
- 29%+ deviation → 0

**Rate metrics** (CTR, CVR, TSR, VHR, FFR — higher is better):
```
if actual >= target: score = weight
else:
  d = (target - actual) / target
  score = weight × max(0, 1 − 1.5d − 5d²)
```

**Lead volume vs expected (pro-rata)**: same shape as rate metrics, using
`d = (expected - actual) / expected`.

**Frequency** (funnel-layer thresholds):
```
if freq <= warn: score = weight
if freq >= severe: score = 0
excess = (freq - warn) / (severe - warn)
score = weight × max(0, 1 − excess²)
```

**Creative age** (grace period + decay):
```
if age <= refreshDays: score = weight
if age >= maxDays: score = 0
decay = (age - refreshDays) / (maxDays - refreshDays)
score = weight × max(0, 1 − decay²)
```

**Weighted creative score** (spend-weighted average + diversity factor):
```
hAvg = Σ(health_i × spend_i) / Σ(spend_i)   [active creatives only]
diversity = min(1, activeCreatives.length / 4)
score = weight × (hAvg / 100) × diversity
```

**Account status — dual gate** (worse of the two gates wins):
```
composite gate: total >= 75 → GREEN | >= 55 → YELLOW | >= 35 → ORANGE | else RED
veto gate (min score/weight ratio across metrics):
  min_ratio >= 0.40 → GREEN | >= 0.20 → YELLOW | >= 0.05 → ORANGE | else RED
final status = worse(composite gate, veto gate)
```

**Default account-level weights (both platforms)**: `cpsv:25, budget:25, cpql:20, cpl:20, creative:10`

---

## GOOGLE

### Account level
Computed twice — **TS value wins** (overwrites Python's).

| Layer | Formula | Weights |
|---|---|---|
| Python `calculate_google_health` (ads_agent/scoring_engine.py:165) | Staged step-function (`score_staged_cost`/`score_staged_budget`) | `cpsv:25, budget:20, cpql:20, cpl:10, campaign:15, creative:10` |
| **TS `recomputeGoogleHealthScore`** (google-transform.ts:37) — **active value** | Quadratic decay (`scoreWeightedCostMetric`/`scoreWeightedBudgetMetric`/`scoreWeightedCreativeMetric`) | `cpsv:25, budget:25, cpql:20, cpl:20, creative:10` |

Default targets: CPL 850, CPQL 1500, CPSV from `benchmarks.google_cpsv_low`.

### Campaign level (Search)
Python `score_google_campaign_module` (ads_agent/scoring_engine.py:249) — **trusted as-is by TS**, not recomputed.

```
{ cpl:30, cvr:22, cpc:15, qs:13, ctr:10, is:5, rsa:5 }
```
- `cpl` — staged cost vs target
- `cvr` — linear, target 5.0%
- `cpc` — staged cost, target 30
- `qs` (Quality Score) — `quality_score / 10 × 100`
- `ctr` — linear, target 2.0%
- `is` (impression share) — graded interpolation vs intent-based target: branded 85 / location 60 / generic 50 / competitor 40
- `rsa` — `min(100, rsa_count / 3 × 100)`

### Campaign level (Demand Gen)
Python `score_google_dg_module` (scoring_engine.py:304):

```
{ cpl:30, cpm:20, cvr:15, ctr:15, tsr:10, freq:10 }
```
Targets: CPM 120, CVR 3.0%, CTR 0.8%, TSR 3.5%, frequency cap 4.0.

### Ad Group level
Python `score_google_adgroup_module` (scoring_engine.py:282):

```
{ cpl:30, cvr:25, ctr:15, qs:15, is:10, cpc:5 }
```
Targets: CVR 5.0%, CTR 2.0%, impression-share target by campaign type (default 60), CPC 30.

### Ad level — RSA (text ads)
Python `score_google_rsa_module` (scoring_engine.py:322):

```
{ cpl:35, ctr:25, cvr:20, ad_strength:10, expected_ctr:10 }
```
- `cpl` staged vs target
- `ctr` linear, target 2.0%
- `cvr` linear, target 5.0%
- `ad_strength` mapped from Google enum: EXCELLENT=1.0, GOOD=0.8, AVERAGE=0.5, POOR=0.2, LOW=0.1 (×100)
- `expected_ctr` mapped: ABOVE_AVERAGE=1.0, AVERAGE=0.6, BELOW_AVERAGE=0.2 (×100)

### Ad level — Video / Static creative
Python `score_google_creative_module` (scoring_engine.py:345):

```
video:  { cpl:35, cpm:20, ctr:15, tsr:15, vhr:15 }
static: { cpl:45, cpm:25, ctr:20, cpc:10 }
```
All linear (not staged): CPL vs target, CPM vs 120(video)/80(static), CTR vs 0.8%/0.6%, TSR vs 3.5%, VHR vs 30%, CPC vs 20.

### Quality Score page (separate scorer)
`score_quality_score_page` (scoring_engine.py:372):

```
{ lp_exp:35, exp_ctr:35, ad_rel:30 }
```
Each mapped from enum: ABOVE_AVERAGE=1.0, AVERAGE=0.6, BELOW_AVERAGE=0.2 (×100).

### TS display-only fallback weights
`reconstructDetailed()` in google-transform.ts:589 rebuilds a **cosmetic** breakdown
only when `detailed_breakdown` is missing from the Python payload — it does not
change the actual `health_score`. Its weight maps differ slightly from Python's:

```
google_campaign: { cpl:30, cvr:22, cpc:15, qs:13, ctr:10, is:5, rsa:5 }
google_adgroup:  { cpl:30, cvr:25, ctr:15, qs:15, is:10, cpc:5 }
google_dg:       { cpl:36, cvr:19, ctr:19, freq:14, cpm:12 }
google_creative: { cpl:35, cpm:25, cr:20, cpc:20 }
google_rsa:      { ad_strength:30, quality_score:30, ctr:20, expected_ctr:20 }
```
It also "hot re-scores" `cpl` (target 850) and `cpc` (target 30, hardcoded) in place using the quadratic-decay formula if raw data is present.

---

## META

### Account level
Computed twice — **TS value wins** (overwrites Python's).

| Layer | Formula | Weights |
|---|---|---|
| Python `calculate_meta_health` (scoring_engine.py:137) | Staged step-function | `cpsv:25, budget:25, cpql:20, cpl:20, creative:10` |
| **TS `recomputeHealthScore`** (meta-transform.ts:172) — **active value** | Quadratic decay + creative blend `performance×0.6 + ageFactor×0.4` | `cpsv:25, budget:25, cpql:20, cpl:20, creative:10` |

Creative `ageFactor` (meta-transform.ts:124): 100 if age<30 days, linear decay to 0 between 30–45 days, 0 if ≥45 days.
Default targets: CPL 850, CPQL 1500, CPSV 20000.

### Campaign & Ad Set level
Computed twice — **TS value wins** (fully overwrites Python's, different weights entirely).

**Python** `score_meta_campaign_module` (scoring_engine.py:190), also reused for ad sets:
```
{ cpl:25, cvr:15, ctr:15, leads:15, freq:10, cpm:10, budget:10 }
```
- `cpl` staged vs target
- `cvr` linear (higher-better), target 1.5%
- `ctr` linear (higher-better), target 0.45%
- `leads` — `expected = spend/target_cpl`; `score = 100 × min(1.2, leads/expected)`
- `freq` linear (lower-better), target 1.8
- `cpm` linear (lower-better), target 350
- `budget` staged vs utilization
- **Red-flag override**: if CPL band or CVR band = "poor" → `total = min(total, 65.0)`

**TS `scoreMetaEntity`** (meta-transform.ts:295) — **active value**, applied to both `campaign_audit` and `adset_analysis`:
```
{ cpl:35, cpm:22.5, ctr:15, cvr:15, freq:12.5 }
```
- `cpl` — target 720
- `cpm` — target 120 if BOFU layer/theme, else 80
- `ctr` — target 1.2%
- `cvr` — target 4.0%
- `freq` — warn/severe 4.0/7.0 (BOFU) or 2.5/5.0 (else)

Status bands: EXCELLENT ≥0.80, GOOD ≥0.60, WATCH ≥0.40, ALERT ≥0.15, else CRITICAL (as % of max weight).
Classification: WINNER ≥70, UNDERPERFORMER <35, else WATCH.

### Ad / Creative level
Computed twice — **TS value wins** (fully overwrites Python's, different weights entirely).

**Python** `score_meta_creative_module` (scoring_engine.py:226):
```
video:  { cpl:35, cpm:20, tsr:15, vhr:15, ctr:15 }
static: { cpl:45, cpm:25, ctr:20, cpc:10 }
```
Targets: CPM 200(video)/150(static), TSR 25% (video only), VHR 25% (video only), CTR 0.8%(video)/0.6%(static), CPC 40 (static only, staged).

Auto-pause rules: flag if `leads==0 & impressions>=8000`, or `leads>0 & cpl > target×1.3`.

**TS inline scoring** in `normalizeMetaAnalysis` (meta-transform.ts:474) — **active value**:
```
video:  { cpl:30, cpm:20, ctr:10, tsr:15, vhr:15, ffr:10 }
static: { cpl:40, cpm:25, ctr:20, creative_age:15 }
```
- `cpl` — target 720
- `cpm` — target 120(BOFU)/80
- `ctr` — target 1.2%
- `tsr` — target 20%
- `vhr` — target 25%
- `ffr` — target 55% (`video_views/impressions × 100` if available)
- `creative_age` — full weight ≤35 days, 0 at ≥60 days, quadratic decay between (a term Python's version doesn't have)

---

## Classification bands (applied on top of scores)

| Level | Bands |
|---|---|
| Account (both platforms) | Dual-gate GREEN/YELLOW/ORANGE/RED — composite thresholds 75/55/35, veto thresholds 0.40/0.20/0.05 |
| Campaign/Ad-set/Ad (both platforms) | WINNER ≥70, UNDERPERFORMER <35, else WATCH |

`problem-detector.ts` doesn't compute scores — it reads existing `health_score`/`detailed_breakdown` and applies threshold/severity rules on top (weak metric = score <60; CRITICAL if account score <40, any KPI <15, CPL >2× target with pacing/spend anomalies, etc).

---

## Known dead/unused config

`meta_ads_agent_v2.py` declares SOP-overridable weight dicts that look like the
intended tuning knobs but are **never actually wired into the live call path**
(which uses `scoring_engine.py`'s hardcoded weights instead):

- `SOP["campaign_score_weights"]` = `{ cpl_vs_target:35, cpm:15, ctr:15, frequency:15, lead_volume:10, budget_util:10 }`
- `SOP["ad_score_weights_video"]` = `{ cpl_vs_target:35, cpm:20, thumb_stop:15, video_hold:15, ctr:15 }`
- `SOP["ad_score_weights_static"]` = `{ cpl_vs_target:45, cpm:25, ctr:30 }`

## Practical takeaway for tuning

- **Google account level** and **Meta account level**: edit `adpilot/server/scoring-config.ts` — this is the value actually shown to users.
- **Google campaign/ad-group/ad level**: edit `ads_agent/scoring_engine.py` — Python's number is trusted as-is, nothing overwrites it.
- **Meta campaign/ad-set/ad level**: edit `adpilot/server/meta-transform.ts` — TS fully overwrites whatever Python computes, so changing `scoring_engine.py` here has no visible effect.
