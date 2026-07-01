import { Classification, getClassification } from "./classification";

/**
 * Shared Scoring Engine
 * Standardizes categorization based on Mojo AdCortex v1.0 spec.
 */

/**
 * Mojo AdCortex Metric Status
 * GREEN: 75-100, YELLOW: 50-74, RED: 0-49
 */
export type MetricStatus = "GREEN" | "YELLOW" | "RED";

export function getMetricStatus(score: number): MetricStatus {
  if (score >= 75) return "GREEN";
  if (score >= 50) return "YELLOW";
  return "RED";
}

/**
 * Score for lower-is-better metrics (CPL, CPC, CPQL, CPSV, CPM)
 *
 * Formula (Mojo AdCortex):
 * - score = 100 if actual ≤ target
 * - score = 100 − ((actual/target − 1) / (red_mult − 1)) × 60  [40–99 range between target and red]
 * - score = 0–39 if actual > red_mult × target, capped to 0 if ≥ 2× target
 *
 * @param actual Raw metric value (lower is better)
 * @param target Performance target / benchmark
 * @param red_mult How many times the target = RED threshold (default 1.5)
 * @returns Score 0–100
 */
export function scoreLowerIsBetter(
  actual: number,
  target: number,
  red_mult: number = 1.5
): number {
  if (target <= 0) return 50; // No target → neutral score
  if (actual <= target) return 100; // Meets or beats target → GREEN

  const ratio = actual / target;

  if (ratio >= 2) return 0; // 2× target or worse → RED floor
  if (ratio > red_mult) {
    // Above red threshold, below 2×: interpolate 0–39
    return Math.max(0, Math.round(((2 - ratio) / (2 - red_mult)) * 39));
  }

  // Between target and red threshold: 40–99
  const score = 100 - ((ratio - 1) / (red_mult - 1)) * 60;
  return Math.round(Math.max(40, Math.min(99, score)));
}

/**
 * Score for higher-is-better metrics (CTR, CVR, TSR, VHR, IS, QS)
 *
 * Formula (Mojo AdCortex):
 * - score = 100 if actual ≥ green threshold
 * - score = 40 + ((actual − red) / (green − red)) × 60  [40–99 between thresholds]
 * - score = (actual / red) × 40  if below red threshold
 *
 * @param actual Raw metric value (higher is better)
 * @param red Red threshold (score < 50 if below this)
 * @param green Green threshold (score = 100 if at or above)
 * @returns Score 0–100
 */
export function scoreHigherIsBetter(
  actual: number,
  red: number,
  green: number
): number {
  if (green <= 0) return 50; // No threshold → neutral
  if (actual >= green) return 100; // Meets or exceeds green → GREEN
  if (actual <= 0) return 0; // Zero or negative → RED

  if (actual < red) {
    // Below red threshold: interpolate 0–40
    return Math.round(Math.max(0, (actual / red) * 40));
  }

  // Between red and green: 40–99
  const score = 40 + ((actual - red) / (green - red)) * 60;
  return Math.round(Math.max(40, Math.min(99, score)));
}

/**
 * Legacy Linear score mapping (0-100) — DEPRECATED
 * Use scoreLowerIsBetter / scoreHigherIsBetter instead.
 * Kept for backward compatibility with other campaign health functions.
 */
export function scoreLinear(actual: number, target: number, weight: number, lowerIsBetter: boolean): number {
  if (target <= 0) return weight * 0.5;
  if (lowerIsBetter) {
    if (actual <= target * 0.8) return weight;
    if (actual >= target * 1.5) return 0;
    const ratio = actual / target;
    return Math.round(weight * Math.max(0, Math.min(1, (1.5 - ratio) / (1.5 - 0.8))) * 100) / 100;
  } else {
    if (actual >= target * 1.2) return weight;
    if (actual <= target * 0.5) return 0;
    const ratio = actual / target;
    return Math.round(weight * Math.max(0, Math.min(1, (ratio - 0.5) / (1.2 - 0.5))) * 100) / 100;
  }
}

/**
 * Google Impression Share Scorer
 *
 * Tier grading (same for all campaign types, target varies):
 *   IS ≥ target        → 100% of pts
 *   IS ≥ 70% of target → 75% of pts
 *   IS ≥ 50% of target → 40% of pts
 *   IS < 50% of target → 10% of pts
 *
 * Default IS targets by campaign type (pass via targetIS):
 *   Branded: 80 | Location/Theme: 40
 */
export function scoreImpressionShare(actualIS: number, targetIS: number): number {
  if (targetIS <= 0) return 50;
  if (actualIS >= targetIS) return 100;
  if (actualIS >= targetIS * 0.7) return 75;
  if (actualIS >= targetIS * 0.5) return 40;
  return 10;
}

// ─── Ad Strength / Rating helpers ───────────────────────────────────

/** Map ad_strength string → 0-100 score: EXCELLENT=100, GOOD=70, POOR=30, PENDING=50 */
export function scoreAdStrength(strength: string): number {
  const map: Record<string, number> = { EXCELLENT: 100, GOOD: 70, PENDING: 50, POOR: 30 };
  return map[(strength || "").toUpperCase()] ?? 50;
}

/** Map expected_ctr rating → 0-100 score: ABOVE_AVERAGE=100, AVERAGE=60, BELOW_AVERAGE=20 */
export function scoreExpectedCtr(rating: string): number {
  const map: Record<string, number> = { ABOVE_AVERAGE: 100, AVERAGE: 60, BELOW_AVERAGE: 20 };
  return map[(rating || "").toUpperCase().replace(/ /g, "_")] ?? 50;
}

/** Map QS component rating (ABOVE_AVERAGE / AVERAGE / BELOW_AVERAGE) → 0-100 */
export function scoreQsComponent(rating: string): number {
  return scoreExpectedCtr(rating); // same scale
}

// ─── Campaign-Level Scoring ──────────────────────────────────────────

/**
 * Meta Campaign Health Weights:
 * CPL vs target: 39 | Frequency: 19 | CPM: 19 | CTR: 14 | CVR: 9
 */
export function calculateMetaCampaignHealth(data: {
  cpl: number;
  frequency: number;
  cpm: number;
  ctr: number;
  leads: number;
  budget_utilization_pct: number; // 0-100, ideal ≈ 90-110%
  cvr: number;
}, targets: {
  cpl: number;
  cpm_max: number;
  ctr_min: number;
  frequency_max: number;
  lead_volume_target: number;
}): { score: number; breakdown: Record<string, number> } {
  const leadVolumeScore = targets.lead_volume_target > 0
    ? Math.min(100, (data.leads / targets.lead_volume_target) * 100)
    : 50;
  const budgetUtilDev = Math.abs(data.budget_utilization_pct / 100 - 1);
  const budgetUtilScore = Math.round(Math.max(0, Math.min(100, 100 * (1 - budgetUtilDev * 2))));

  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targets.cpl, 39, true),
    frequency: scoreLinear(data.frequency, targets.frequency_max, 19, true),
    cpm: scoreLinear(data.cpm, targets.cpm_max, 19, true),
    ctr: scoreLinear(data.ctr, targets.ctr_min, 14, false),
    cvr: scoreLinear(data.cvr, 3.0, 9, false),
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Meta Video Ad Health Weights:
 * CPL 35 | CPM 20 | TSR 15 | VHR 15 | CTR 15
 */
export function calculateMetaVideoAdHealth(data: {
  cpl: number;
  cpm: number;
  tsr: number;
  vhr: number;
  ctr: number;
}, targets: { cpl: number; cpm_max: number; tsr_min: number; vhr_min: number; ctr_min: number }): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targets.cpl, 35, true),
    cpm: scoreLinear(data.cpm, targets.cpm_max, 20, true),
    tsr: scoreLinear(data.tsr, targets.tsr_min, 15, false),
    vhr: scoreLinear(data.vhr, targets.vhr_min, 15, false),
    ctr: scoreLinear(data.ctr, targets.ctr_min, 15, false),
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Meta Static Ad Health Weights:
 * CPL 45 | CPM 25 | CTR 20 | CPC 10
 */
export function calculateDGStaticAdHealth(data: {
  cpl: number;
  cpm: number;
  ctr: number;
  cpc: number;
}, targetCpl: number, targetCpc: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 45, true),
    cpm: scoreLinear(data.cpm, 200, 25, true),
    ctr: scoreLinear(data.ctr, 0.8, 20, false),
    cpc: scoreLinear(data.cpc, targetCpc, 10, true),
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Google Search Campaign Health Weights:
 * CPL vs target: 25 | CVR: 22 | CPC vs target: 20 | QS avg: 13 | CTR: 10 | IS: 10
 *
 * IS grading by campaign type:
 *   Branded:        target 80% — 100/75/40/10 pts at ≥target/70%/50%/<50%
 *   Location/Theme: target 40% — same tier multipliers
 */
export function calculateSearchCampaignHealth(data: {
  cpl: number;
  cvr: number;
  cpc: number;
  qs_avg: number;
  ctr: number;
  is: number;
  campaign_type?: string; // "branded" | "location" | other
}, targets: {
  cpl: number;
  cpc: number;
  is_target?: number; // override; derived from campaign_type if omitted
}): { score: number; breakdown: Record<string, number> } {
  const campaignType = (data.campaign_type || "").toLowerCase();
  const isTarget = targets.is_target ?? (campaignType === "branded" ? 80 : 40);
  const isScore = scoreImpressionShare(data.is, isTarget);

  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targets.cpl, 25, true),
    cvr: scoreLinear(data.cvr, 5.0, 22, false),
    cpc: scoreLinear(data.cpc, targets.cpc, 20, true),
    qs: (data.qs_avg / 10) * 13,
    ctr: scoreLinear(data.ctr, 2.0, 10, false),
    is: (isScore / 100) * 10,
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Google Demand Gen Campaign Weights:
 * CPL 25 | CPM 20 | CVR 15 | CTR 15 | VVR P25 (TSR proxy) 7.5 | Frequency 10 | VVR P50 (VHR proxy) 7.5
 */
export function calculateDGHealth(data: {
  cpl: number;
  cpm: number;
  cvr: number;
  ctr: number;
  tsr: number;   // Video View Rate P25 proxy
  vhr: number;   // Video View Rate P50 proxy
  frequency: number;
}, targetCpl: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 25, true),
    cpm: scoreLinear(data.cpm, 200, 20, true),
    cvr: scoreLinear(data.cvr, 3.0, 15, false),
    ctr: scoreLinear(data.ctr, 0.8, 15, false),
    vvr_p25: scoreLinear(data.tsr, 3.5, 7.5, false),
    frequency: scoreLinear(data.frequency, 2.0, 10, true),
    vvr_p50: scoreLinear(data.vhr, 1.5, 7.5, false),
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Google Search Ad Group Health Weights:
 * CPL 30 | CVR 25 | CTR 15 | QS avg 15 | IS 10 | CPC 5
 */
export function calculateSearchAdGroupHealth(data: {
  cpl: number;
  cvr: number;
  ctr: number;
  qs_avg: number;
  is: number;
  cpc: number;
}, targets: {
  cpl: number;
  cpc: number;
  is_target: number;
}): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targets.cpl, 30, true),
    cvr: scoreLinear(data.cvr, 5.0, 25, false),
    ctr: scoreLinear(data.ctr, 2.0, 15, false),
    qs: (data.qs_avg / 10) * 15,
    is: (scoreImpressionShare(data.is, targets.is_target) / 100) * 10,
    cpc: scoreLinear(data.cpc, targets.cpc, 5, true),
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Google RSA (Search Ad) Health Weights:
 * CPL 35 | CTR 25 | CVR 20 | Ad Strength 10 | Expected CTR 10
 *
 * Ad Strength: EXCELLENT=100, GOOD=70, PENDING=50, POOR=30
 * Expected CTR: ABOVE_AVERAGE=100, AVERAGE=60, BELOW_AVERAGE=20
 */
export function calculateSearchAdHealth(data: {
  cpl: number;
  ctr: number;
  cvr: number;
  adStrength: string;       // "EXCELLENT" | "GOOD" | "PENDING" | "POOR"
  expectedCtrRating: string; // "ABOVE_AVERAGE" | "AVERAGE" | "BELOW_AVERAGE"
}, targetCpl: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 35, true),
    ctr: scoreLinear(data.ctr, 2.0, 25, false),
    cvr: scoreLinear(data.cvr, 5.0, 20, false),
    ad_strength: (scoreAdStrength(data.adStrength) / 100) * 10,
    expected_ctr: (scoreExpectedCtr(data.expectedCtrRating) / 100) * 10,
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Google Demand Gen Video Ad Health Weights:
 * CPL 35 | CPM 20 | CTR 15 | TSR (P25/Impressions) 15 | VHR (P50/Impressions) 15
 */
export function calculateDGVideoAdHealth(data: {
  cpl: number;
  cpm: number;
  ctr: number;
  tsr: number;
  vhr: number;
}, targetCpl: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 35, true),
    cpm: scoreLinear(data.cpm, 200, 20, true),
    ctr: scoreLinear(data.ctr, 0.8, 15, false),
    tsr: scoreLinear(data.tsr, 3.5, 15, false),
    vhr: scoreLinear(data.vhr, 1.5, 15, false),
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Google DG Static Ad Health Weights:
 * CPL 45 | CPM 25 | CTR 20 | CPC 10
 */
export function calculateDGStaticVideoAdHealth(data: {
  cpl: number;
  cpm: number;
  ctr: number;
  cpc: number;
}, targetCpl: number, targetCpc: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 45, true),
    cpm: scoreLinear(data.cpm, 200, 25, true),
    ctr: scoreLinear(data.ctr, 0.8, 20, false),
    cpc: scoreLinear(data.cpc, targetCpc, 10, true),
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Quality Score Page — Component Weighting:
 * Landing Page Experience: 35 | Expected CTR: 35 | Ad Relevance: 30
 *
 * Each component uses rating string → 0-100 score (ABOVE_AVERAGE=100, AVERAGE=60, BELOW_AVERAGE=20)
 */
export function calculateKeywordQualityScore(data: {
  landing_page_experience: string; // "ABOVE_AVERAGE" | "AVERAGE" | "BELOW_AVERAGE"
  expected_ctr: string;
  ad_relevance: string;
}): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    landing_page: (scoreQsComponent(data.landing_page_experience) / 100) * 35,
    expected_ctr: (scoreQsComponent(data.expected_ctr) / 100) * 35,
    ad_relevance: (scoreQsComponent(data.ad_relevance) / 100) * 30,
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}
