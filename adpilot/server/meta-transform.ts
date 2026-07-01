/**
 * normalizeMetaAnalysis
 *
 * Maps field names from the Python meta_ads_agent_v2.py output to the
 * canonical shape the dashboard (dashboard.tsx) expects, and recomputes
 * the account health score from the cadence-window data so switching
 * cadences (1D / 2×wk / Wkly / Bi-wk / Mo) reflects the actual window.
 */

import fs from "fs";
import path from "path";
import {
  scoreStagedCostDynamic,
  scoreStagedBudgetDynamic,
  getMetricWeights,
  scoreWeightedCostMetric,
  scoreWeightedBudgetMetric,
  sumMetricScores,
  computeMinRatio,
  computeDualGateStatus,
  scoreHigher,
  scoreLeads,
  scoreFrequency,
  scoreCreativeAge,
} from "./scoring-config";

function getMetaClassification(score: number): "WINNER" | "WATCH" | "UNDERPERFORMER" {
  if (score >= 70) return "WINNER";
  if (score < 35) return "UNDERPERFORMER";
  return "WATCH";
}

/**
 * Normalizes rates that might be coming in as decimals (0.35) instead of percentages (35).
 * Standard benchmarks (e.g. FFR 55%) expect values in 0-100 range.
 */
function normalizeRate(val: number | undefined | null): number {
  if (val == null || !Number.isFinite(val)) return 0;
  // If value is between 0 and 1 (exclusive), it's likely a decimal rate.
  // Note: CTR can legitimately be < 1.0%, but TSR/VHR/FFR are usually higher.
  // However, most modern Meta reports for these metrics are 0.XX.
  if (val > 0 && val <= 1.0) return +(val * 100).toFixed(2);
  return val;
}

function scoreLowerMeta(actual: number, target: number, weight: number): number {
  if (target <= 0) return weight;
  const safeActual = Number.isFinite(actual) ? actual : Number.POSITIVE_INFINITY;
  const d = Math.max(0, (safeActual - target) / target);
  return weight * Math.max(0, 1 - 1.5 * d - 5 * d * d);
}

function scoreHigherMeta(actual: number, target: number, weight: number): number {
  if (target <= 0) return weight;
  const safeActual = Number.isFinite(actual) ? actual : 0;
  const d = Math.max(0, (target - safeActual) / target);
  return weight * Math.max(0, 1 - 1.5 * d - 5 * d * d);
}

function scoreLeadsMeta(actual: number, expected: number, weight: number): number {
  if (expected <= 0) return weight;
  const safeActual = Number.isFinite(actual) ? actual : 0;
  const d = Math.max(0, (expected - safeActual) / expected);
  return weight * Math.max(0, 1 - 1.5 * d - 5 * d * d);
}

function scoreFrequencyMeta(freq: number, warn: number, severe: number, weight: number): number {
  if (freq <= warn) return weight;
  if (freq >= severe) return 0;
  const excess = (freq - warn) / (severe - warn);
  return weight * (1 - excess * excess);
}

function scoreBudgetMeta(actual: number, planned: number, weight: number): number {
  if (planned <= 0) return weight;
  const b = Math.abs(actual - planned) / planned;
  return weight * Math.max(0, 1 - b - 10 * b * b);
}

function scoreCreativeAgeMeta(ageDays: number, weight: number): number {
  if (ageDays <= 35) return weight;
  if (ageDays >= 60) return 0;
  const decay = (ageDays - 35) / (60 - 35);
  return weight * (1 - decay * decay);
}

function resolveMetaBenchmarks(data: any): Record<string, any> {
  let base = {
    ...(data.sop_benchmarks_fallback || {}),
    ...(data.dynamic_thresholds || {}),
  };

  const sourcePath = data.benchmarks_source;
  if (typeof sourcePath === "string" && sourcePath) {
    const candidates = [
      sourcePath,
      sourcePath.replace(/benchmarks\.json$/, "benchmarks_meta.json"),
    ];

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (!fs.existsSync(resolved)) continue;

      try {
        base = {
          ...base,
          ...JSON.parse(fs.readFileSync(resolved, "utf-8")),
        };
        break; // Use first found source
      } catch {
        // Ignore malformed external benchmark files
      }
    }
  }

  // CRITICAL: Always overlay the sop_benchmarks attached by the server (if any).
  // This object contains the latest user-saved benchmarks from the disk.
  return {
    ...base,
    ...(data.sop_benchmarks || {}),
  };
}

function getCreativeAgeFactor(ageDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0 || ageDays < 30) return 100;
  if (ageDays >= 45) return 0;
  return ((45 - ageDays) / 15) * 100;
}

function scoreWeightedMetaCreativeMetric(creatives: any[], weight: number): number {
  const liveCreatives = (creatives || []).filter(
    (creative: any) =>
      (creative?.status === "ACTIVE" || creative?.status === undefined || creative?.status === null) &&
      (creative?.spend ?? 0) > 0
  );

  if (liveCreatives.length === 0) return 0;

  const totalSpend = liveCreatives.reduce((sum: number, creative: any) => sum + (creative?.spend ?? 0), 0);
  if (totalSpend <= 0) return 0;

  const weightedHealth = liveCreatives.reduce((sum: number, creative: any) => {
    const performance = creative?.performance_score ?? creative?.creative_score ?? creative?.health_score ?? 0;
    const ageDays = creative?.creative_age_days ?? creative?.age_days ?? 0;
    const ageFactor = getCreativeAgeFactor(ageDays);
    const health = performance * 0.6 + ageFactor * 0.4;
    return sum + health * (creative?.spend ?? 0);
  }, 0);

  const hAvg = weightedHealth / totalSpend;
  const diversity = Math.min(1, liveCreatives.length / 4);
  return weight * (hAvg / 100) * diversity;
}

/**
 * Recomputes account_health_score and account_health_breakdown from
 * the cadence-window account_pulse metrics using Mojo AdCortex v2.0 formulas.
 *
 * Weights (Mojo AdCortex Meta):
 *   CPSV 25% · Budget 25% · CPQL 20% · CPL 20% · Creative 10%
 *
 * Formulas:
 *   - Cost metrics (CPSV, CPL, CPQL): Quadratic decay with acceleration
 *   - Budget: Quadratic penalty for both overspend and underspend
 *   - Creative: Spend-weighted average with diversity factor
 *
 * Status determination: Dual-gate system
 *   - Composite gate: Total score threshold (GREEN ≥75, YELLOW ≥55, ORANGE ≥35, RED <35)
 *   - Veto gate: Weakest-link ratio (min(score/weight)), prevents weak metrics from hiding
 *   - Final status = WORSE of the two gates
 */
function recomputeHealthScore(data: any): {
  score: number;
  breakdown: Record<string, number>;
  status: string;
} {
  const ap = data.account_pulse || {};
  const mp = data.monthly_pacing || {};
  const benchmarks = resolveMetaBenchmarks(data);
  
  console.log(`[recomputeHealthScore] Resolved benchmarks keys: ${Object.keys(benchmarks).join(", ")}`);

  const weights = getMetricWeights("meta");

  // MTD deliverables (manually entered SVS, qualified leads)
  const mtdDeliverables = data.mtd_deliverables || {};

  // ── MTD-only actuals (never fall back to 30-day rolling data) ──────
  const actualSpendMtd = mp.mtd?.spend ?? ap.mtd_pacing?.spend_mtd ?? 0;
  const actualLeadsMtd = mp.mtd?.leads ?? ap.mtd_pacing?.leads_mtd ?? 0;
  const actualQLeadsMtd =
    mtdDeliverables.positive_leads_achieved ??
    mtdDeliverables.quality_lead_count ??
    mp.mtd?.qualified_leads ??
    0;
  const actualSvsMtd = mtdDeliverables.svs_achieved ?? mp.mtd?.svs ?? 0;

  console.log(`[recomputeHealthScore] MTD Actuals: spend=${actualSpendMtd}, leads=${actualLeadsMtd}, qLeads=${actualQLeadsMtd}, svs=${actualSvsMtd}`);

  // ─── CPL Score (Lower is better: Quadratic) ───
  const cplTarget = benchmarks.cpl || benchmarks.cpl_target || mp.targets?.cpl || 800;
  const actualCplMtd = actualLeadsMtd > 0 ? actualSpendMtd / actualLeadsMtd : 0;
  const cplScore = scoreWeightedCostMetric(
    actualLeadsMtd > 0 ? actualCplMtd : (actualSpendMtd > 0 ? Number.POSITIVE_INFINITY : 0),
    cplTarget,
    weights.cpl
  );
  console.log(`[recomputeHealthScore] CPL Debug: target=${cplTarget}, actual=${actualCplMtd.toFixed(2)}, score=${cplScore.toFixed(2)}`);

  // ─── Budget/Pacing Score (MTD spend vs prorated monthly budget) ───
  const now = new Date();
  const derivedDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysInMonth = (mp.days_elapsed ?? 0) + (mp.days_remaining ?? 0) || derivedDaysInMonth;
  const daysElapsed = mp.days_elapsed ?? ap.mtd_pacing?.days_elapsed ?? Math.min(now.getDate(), daysInMonth);
  const monthlyBudget = benchmarks.budget || mp.targets?.budget || ap.mtd_pacing?.target_budget || data.targets?.budget || 0;
  const budgetScore = scoreWeightedBudgetMetric(
    actualSpendMtd,
    monthlyBudget,
    daysElapsed,
    daysInMonth,
    weights.budget
  );
  console.log(`[recomputeHealthScore] Budget Debug: target=${monthlyBudget}, actual=${actualSpendMtd}, days=${daysElapsed}/${daysInMonth}, score=${budgetScore.toFixed(2)}`);

  // ─── CPQL Score (Lower is better: Staged) ───
  const cpqlTarget = benchmarks.cpql_target || benchmarks.cpql || mp.targets?.cpql || 1500;
  const actualCpqlMtd = actualQLeadsMtd > 0 ? actualSpendMtd / actualQLeadsMtd : 0;
  const cpqlScore = actualQLeadsMtd > 0
    ? scoreWeightedCostMetric(actualCpqlMtd, cpqlTarget, weights.cpql)
    : 10;
  console.log(`[recomputeHealthScore] CPQL Debug: target=${cpqlTarget}, actual=${actualCpqlMtd.toFixed(2)}, score=${cpqlScore.toFixed(2)}`);

  // ─── CPSV Score (Lower is better: Staged) ───
  const cpsvTarget = benchmarks.cpsv_low || benchmarks.cpsv_target_low || mp.targets?.cpsv?.low || 0;
  const actualCpsvMtd = actualSvsMtd > 0 ? actualSpendMtd / actualSvsMtd : 0;
  const cpsvScore = scoreWeightedCostMetric(
    actualSvsMtd > 0 ? actualCpsvMtd : (actualSpendMtd > 0 ? Number.POSITIVE_INFINITY : 0),
    cpsvTarget,
    weights.cpsv
  );
  console.log(`[recomputeHealthScore] CPSV Debug: target=${cpsvTarget}, actual=${actualCpsvMtd.toFixed(2)}, score=${cpsvScore.toFixed(2)}`);

  // ─── Creative Score (Spend-weighted average + diversity factor) ───
  const creativeHealth: any[] = data.creative_health || [];
  const creativeScore = scoreWeightedMetaCreativeMetric(creativeHealth, weights.creative);

  // ─── Build Breakdown (weighted metric scores) ───
  const breakdown = {
    cpsv: Math.round(cpsvScore * 100) / 100,
    budget: Math.round(budgetScore * 100) / 100,
    cpql: Math.round(cpqlScore * 100) / 100,
    cpl: Math.round(cplScore * 100) / 100,
    creative: Math.round(creativeScore * 100) / 100,
  };

  // ─── Calculate Composite Score ───
  const compositeScore = Math.round(sumMetricScores(breakdown) * 100) / 100;

  // ─── Apply Dual-Gate Status Determination ───
  const minRatio = computeMinRatio(breakdown, weights);
  const dualGateStatus = computeDualGateStatus(compositeScore, minRatio);

  console.log(`[recomputeHealthScore] FINAL RESULT: score=${compositeScore}, status=${dualGateStatus}`);
  
  return { score: compositeScore, breakdown, status: dualGateStatus };
}

/**
 * Mapping of metric percentage of max weight to status label (Doc section 7)
 */
function getMetricStatus(pct: number): string {
  if (pct >= 0.80) return "EXCELLENT";
  if (pct >= 0.60) return "GOOD";
  if (pct >= 0.40) return "WATCH";
  if (pct >= 0.15) return "ALERT";
  return "CRITICAL";
}

/**
 * Breakdown Classification (Doc section 6)
 */
function getBreakdownClassification(segmentCpl: number, entityAvgCpl: number): string {
  if (entityAvgCpl <= 0) return "NEUTRAL";
  const deviation = (segmentCpl - entityAvgCpl) / entityAvgCpl;
  if (deviation <= -0.20) return "WINNER";
  if (deviation <= -0.05) return "ABOVE AVG";
  if (deviation <= 0.10) return "NEUTRAL";
  if (deviation <= 0.25) return "BELOW AVG";
  return "UNDERPERFORMER";
}

/**
 * Mojo AdCortex v1.0 Entity Scoring Engine (Meta)
 */
function scoreMetaEntity(
  entity: any,
  type: 'campaign' | 'adset',
  targets: any,
  pacing: any,
  benchmarks: any
): { health_score: number, detailed_breakdown: any } {
  const isBofu = (entity.layer || entity.theme || "").toLowerCase().includes("bofu");

  const defaultFreqWarn = isBofu ? 4.0 : 2.5;
  const defaultFreqSev = isBofu ? 7.0 : 5.0;
  const configuredFreqWarn = isBofu
    ? (benchmarks.frequency_bofu_warn ?? benchmarks.frequency_max_bofu ?? undefined)
    : (benchmarks.frequency_tofu_mofu_warn ?? benchmarks.frequency_max ?? undefined);
  const configuredFreqSev = isBofu
    ? (benchmarks.frequency_bofu_severe ?? benchmarks.frequency_max_bofu_severe ?? undefined)
    : (benchmarks.frequency_tofu_mofu_severe ?? benchmarks.frequency_max_severe ?? undefined);

  const freqWarn = Number(configuredFreqWarn ?? defaultFreqWarn);
  const freqSev = Number(configuredFreqSev ?? defaultFreqSev);

  const weights: Record<string, number> = {
    cpl: 35,
    cpm: 22.5,
    ctr: 15,
    cvr: 15,
    freq: 12.5,
  };
  const detailed: any = {};

  const ctrTarget = Number(benchmarks.ctr_min ?? benchmarks.ctr_target ?? targets.ctr ?? 1.2);
  const cvrTarget = Number(benchmarks.cvr_min ?? benchmarks.cvr_target ?? targets.cvr ?? 4.0);
  const cplTarget = Number(benchmarks.cpl ?? benchmarks.cpl_target ?? targets.cpl ?? 720);
  const cpmTarget = isBofu
    ? Number(benchmarks.cpm_bofu_target ?? benchmarks.cpm_max_bofu ?? benchmarks.cpm_max ?? 120)
    : Number(benchmarks.cpm_target ?? benchmarks.cpm_max ?? 80);

  let actualCpl = entity.cpl;
  if ((entity.leads || 0) <= 0 && (entity.spend || 0) > 0) {
    actualCpl = entity.spend;
  }
  const sCpl = scoreLowerMeta(actualCpl, cplTarget, weights.cpl);
  detailed.cpl = {
    score: Math.round((sCpl / weights.cpl) * 100),
    weight: weights.cpl,
    contribution: +sCpl.toFixed(1),
    actual: actualCpl,
    target: cplTarget,
    unit: "currency",
  };

  const sCpm = scoreLowerMeta(entity.cpm || entity.average_cpm || 0, cpmTarget, weights.cpm);
  detailed.cpm = {
    score: Math.round((sCpm / weights.cpm) * 100),
    weight: weights.cpm,
    contribution: +sCpm.toFixed(1),
    actual: entity.cpm || entity.average_cpm || 0,
    target: cpmTarget,
    unit: "currency",
  };



  const sCtr = scoreHigherMeta(entity.ctr || 0, ctrTarget, weights.ctr);
  detailed.ctr = {
    score: Math.round((sCtr / weights.ctr) * 100),
    weight: weights.ctr,
    contribution: +sCtr.toFixed(1),
    actual: entity.ctr || 0,
    target: ctrTarget,
    unit: "percent",
  };

  const actualCvr = entity.cvr || (entity.clicks > 0 ? (entity.leads / entity.clicks) * 100 : 0);
  const sCvr = scoreHigherMeta(actualCvr, cvrTarget, weights.cvr);
  detailed.cvr = {
    score: Math.round((sCvr / weights.cvr) * 100),
    weight: weights.cvr,
    contribution: +sCvr.toFixed(1),
    actual: actualCvr,
    target: cvrTarget,
    unit: "percent",
  };



  const sFreq = scoreFrequencyMeta(entity.frequency || 1.0, freqWarn, freqSev, weights.freq);
  detailed.freq = {
    score: Math.round((sFreq / weights.freq) * 100),
    weight: weights.freq,
    contribution: +sFreq.toFixed(1),
    actual: entity.frequency || 1.0,
    target: freqWarn,
    unit: "number",
  };

  const totalScore = Object.values(detailed).reduce((sum: number, d: any) => sum + d.contribution, 0);
  for (const k in detailed) {
    detailed[k].status = getMetricStatus(detailed[k].score / 100);
  }

  return { health_score: +totalScore.toFixed(1), detailed_breakdown: detailed };
}

function scoreLinearMeta(actual: number, target: number, weight: number, lowerIsBetter: boolean): number {
  if (target <= 0) return weight * 0.5;
  const d = lowerIsBetter ? Math.max(0, (actual - target) / target) : Math.max(0, (target - actual) / target);
  return weight * Math.max(0, 1 - 1.5 * d - 5 * d * d);
}

// ── Main normalizer ───────────────────────────────────────────────────────────

export function normalizeMetaAnalysis(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;

  const data = { ...raw };
  const mp = data.monthly_pacing || {};
  const ap = data.account_pulse || {};
  const pacing = {
    days_elapsed: mp.days_elapsed ?? ap.mtd_pacing?.days_elapsed ?? 14,
    days_remaining: mp.days_remaining ?? (30 - (mp.days_elapsed ?? 14))
  };

  const benchmarks = resolveMetaBenchmarks(data);
  const targets = {
    cpl: benchmarks.cpl || benchmarks.cpl_target || 720,
    ctr: 1.2,
    cvr: 4.0
  };

  // 1. Scoring Campaigns
  if (Array.isArray(data.campaign_audit)) {
    data.campaign_audit = data.campaign_audit.map((campaign: any) => {
      const result = scoreMetaEntity(campaign, 'campaign', targets, pacing, benchmarks);
      const scoreBreakdown = Object.fromEntries(
        Object.entries(result.detailed_breakdown).map(([metric, detail]: [string, any]) => [metric, Math.round(detail.contribution)])
      );
      const scoreBands = Object.fromEntries(
        Object.entries(result.detailed_breakdown).map(([metric, detail]: [string, any]) => [
          metric,
          getMetricStatus((detail.weight ?? 0) > 0 ? detail.contribution / detail.weight : 0),
        ])
      );
      return {
        ...campaign,
        health_score: result.health_score,
        classification: getMetaClassification(result.health_score),
        score_breakdown: scoreBreakdown,
        score_bands: scoreBands,
        detailed_breakdown: result.detailed_breakdown,
      };
    });
  }

  // 2. Scoring Ad Sets
  if (Array.isArray(data.adset_analysis)) {
    data.adset_analysis = data.adset_analysis.map((adset: any) => {
      const result = scoreMetaEntity(adset, 'adset', targets, pacing, benchmarks);
      const scoreBreakdown = Object.fromEntries(
        Object.entries(result.detailed_breakdown).map(([metric, detail]: [string, any]) => [metric, Math.round(detail.contribution)])
      );
      const scoreBands = Object.fromEntries(
        Object.entries(result.detailed_breakdown).map(([metric, detail]: [string, any]) => [
          metric,
          getMetricStatus((detail.weight ?? 0) > 0 ? detail.contribution / detail.weight : 0),
        ])
      );
      return {
        ...adset,
        health_score: result.health_score,
        classification: getMetaClassification(result.health_score),
        score_breakdown: scoreBreakdown,
        score_bands: scoreBands,
        detailed_breakdown: result.detailed_breakdown,
      };
    });
  }

  // 3. Scoring Ads (Creatives)
  if (Array.isArray(data.creative_health)) {
    data.creative_health = data.creative_health.map((creative: any) => {
      const isVideo = creative.video_views > 0 || creative.thru_plays > 0 || creative.thumb_stop_pct > 0;

      const weights: Record<string, number> = isVideo 
        ? { cpl: 30, cpm: 20, ctr: 10, tsr: 15, vhr: 15, ffr: 10 }
        : { cpl: 40, cpm: 25, ctr: 20, creative_age: 15 };

      const detailed: any = {};
      let total = 0;
      const isBofu = (creative.layer || creative.theme || "").toLowerCase().includes("bofu");
      const cpmTarget = isBofu ? 120 : 80;
      const tsrTarget = benchmarks.tsr_min || 20;
      const vhrTarget = benchmarks.vhr_min || 25;
      const ffrTarget = benchmarks.ffr_min || 55;

      for (const k in weights) {
        const W = weights[k];
        let score = 0;
        if (k === 'cpl') {
          let actualCpl = creative.cpl;
          if ((creative.leads || 0) <= 0 && (creative.spend || 0) > 0) actualCpl = creative.spend;
          score = scoreLowerMeta(actualCpl, targets.cpl, W);
        } else if (k === 'cpm') {
          score = scoreLowerMeta(creative.cpm || 0, cpmTarget, W);
        } else if (k === 'ctr') {
          score = scoreHigherMeta(creative.ctr || 0, targets.ctr, W);
        } else if (k === 'tsr') {
          const tsrVal = normalizeRate(creative.tsr ?? creative.thumb_stop_pct ?? creative.thumb_stop_rate);
          score = scoreHigherMeta(tsrVal, tsrTarget, W);
        } else if (k === 'vhr') {
          const vhrVal = normalizeRate(creative.vhr ?? creative.hold_rate_pct ?? creative.hold_rate);
          score = scoreHigherMeta(vhrVal, vhrTarget, W);
        } else if (k === 'ffr') {
          const ffrVal = normalizeRate(
            (creative.video_views > 0 && creative.impressions > 0)
              ? (creative.video_views / creative.impressions) * 100
              : (creative.ffr ?? creative.first_frame_rate_pct ?? creative.first_frame_rate ?? creative.hook_rate ?? 0)
          );
          score = scoreHigherMeta(ffrVal, ffrTarget, W);
        } else if (k === 'creative_age') {
          score = scoreCreativeAgeMeta(creative.creative_age_days || creative.age_days || 0, W);
        }

        const actualValue =
          k === "cpl" ? (creative.leads || 0) <= 0 && (creative.spend || 0) > 0 ? creative.spend : (creative.cpl || 0) :
          k === "cpm" ? (creative.cpm || 0) :
          k === "ctr" ? (creative.ctr || 0) :
          k === "tsr" ? normalizeRate(creative.tsr ?? creative.thumb_stop_pct ?? creative.thumb_stop_rate ?? 0) :
          k === "vhr" ? normalizeRate(creative.vhr ?? creative.hold_rate_pct ?? creative.hold_rate ?? 0) :
          k === "ffr" ? normalizeRate(
            (creative.video_views > 0 && creative.impressions > 0)
              ? (creative.video_views / creative.impressions) * 100
              : (creative.ffr ?? creative.first_frame_rate_pct ?? creative.first_frame_rate ?? creative.hook_rate ?? 0)
          ) :
          (creative.creative_age_days || creative.age_days || 0);
        const targetValue =
          k === "cpl" ? targets.cpl :
          k === "cpm" ? cpmTarget :
          k === "ctr" ? targets.ctr :
          k === "tsr" ? tsrTarget :
          k === "vhr" ? vhrTarget :
          k === "ffr" ? ffrTarget :
          35;
        const unit =
          k === "cpl" || k === "cpm" ? "currency" :
          k === "creative_age" ? "days" :
          k === "ctr" || k === "tsr" || k === "vhr" || k === "ffr" ? "percent" :
          "number";

        detailed[k] = {
          score: Math.round((score / W) * 100),
          weight: W,
          contribution: +score.toFixed(1),
          status: getMetricStatus(score / W),
          actual: actualValue,
          target: targetValue,
          unit,
        };
        total += score;
      }

      const scoreBreakdown = Object.fromEntries(
        Object.entries(detailed).map(([metric, detail]: [string, any]) => [metric, Math.round(detail.contribution)])
      );
      const scoreBands = Object.fromEntries(
        Object.entries(detailed).map(([metric, detail]: [string, any]) => [
          metric,
          getMetricStatus((detail.weight ?? 0) > 0 ? detail.contribution / detail.weight : 0),
        ])
      );

      return {
        ...creative,
        health_score: +total.toFixed(1),
        classification: getMetaClassification(total),
        score_breakdown: scoreBreakdown,
        score_bands: scoreBands,
        detailed_breakdown: detailed,
      };
    });
  }

  // 4. Normalizing Breakdowns (Doc section 6)
  if (data.breakdowns) {
    for (const dimension in data.breakdowns) {
      const items = data.breakdowns[dimension];
      if (Array.isArray(items)) {
        const avgCpl = targets.cpl; 
        data.breakdowns[dimension] = items.map((item: any) => {
          if ((item.leads || 0) < 3 || (item.spend || 0) < (targets.cpl * 0.5)) {
            return { ...item, classification: "INSUFFICIENT DATA" };
          }
          return {
            ...item,
            classification: getBreakdownClassification(item.cpl || (item.leads > 0 ? item.spend / item.leads : 0), avgCpl)
          };
        });
      }
    }
  }

  // ── 1. Account health score — recompute from cadence-window data ─────
  // The Python agent writes the same score to all cadence files (computed
  // from MTD data). We recompute it here from the per-cadence daily arrays
  // so the score changes when the user switches cadences.
  // Uses Mojo AdCortex v1.0 formulas with override rule for high-weight RED metrics.
  const recomputed = recomputeHealthScore(data);
  data.account_health_score = recomputed.score;
  data.account_health_classification = recomputed.status;
  data.account_health_breakdown = recomputed.breakdown;

  // ── 2. playbooks_triggered ───────────────────────────────────────────
  // Dashboard reads: data.playbooks_triggered || data.sop_triggers
  // Agent writes:    data.active_playbooks
  if (!data.playbooks_triggered && !data.sop_triggers) {
    data.playbooks_triggered = data.active_playbooks || [];
  }

  // ── 3. auto_pause_candidates ─────────────────────────────────────────
  // Dashboard reads: data.auto_pause_candidates (flat array)
  // Agent writes:    creative_health[].should_pause / adset_analysis[].should_pause
  if (!data.auto_pause_candidates) {
    const candidates: any[] = [];

    (data.creative_health || []).forEach((ad: any) => {
      if (ad.should_pause) {
        candidates.push({
          type: "ad",
          id: ad.ad_id,
          name: ad.ad_name,
          entity: ad.ad_name,
          metric: ad.auto_pause_reasons?.join("; ") || "Low performance",
          rule: "auto_pause",
          spend: ad.spend,
          cpl: ad.cpl,
        });
      }
    });

    (data.adset_analysis || []).forEach((adset: any) => {
      if (adset.should_pause) {
        candidates.push({
          type: "adset",
          id: adset.adset_id,
          name: adset.adset_name,
          entity: adset.adset_name,
          metric: adset.auto_pause_reasons?.join("; ") || "Low performance",
          rule: "auto_pause",
          spend: adset.spend,
          cpl: adset.cpl,
        });
      }
    });

    data.auto_pause_candidates = candidates;
  }

  // ── 4. monthly_pacing.alerts ─────────────────────────────────────────
  // Dashboard reads: mp.alerts — agent doesn't write this into monthly_pacing
  if (data.monthly_pacing && !data.monthly_pacing.alerts) {
    data.monthly_pacing = {
      ...data.monthly_pacing,
      alerts: data.account_pulse?.alerts || [],
    };
  }

  // ── 5. summary counts ────────────────────────────────────────────────
  if (data.summary) {
    data.summary = {
      ...data.summary,
      immediate_actions: data.auto_pause_candidates?.length ?? 0,
      total_fatigue_alerts: data.fatigue_alerts?.length ?? 0,
    };
  }

  // ── 6. Daily leads correction ────────────────────────────────────────
  // The Python agent sometimes writes daily_leads arrays with inflated
  // values (commonly 2x) compared to the authoritative total_leads_30d.
  // Detect and correct this so charts, CPL calculations, and the health
  // score all use consistent numbers.
  if (data.account_pulse) {
    const ap = data.account_pulse;
    const dailyLeads: number[] = ap.daily_leads || [];
    const dailyLeadsSum = dailyLeads.reduce((s: number, v: number) => s + v, 0);
    const reportedTotal = ap.total_leads_30d ?? ap.total_leads ?? 0;

    if (reportedTotal > 0 && dailyLeadsSum > 0 && dailyLeadsSum !== reportedTotal) {
      const ratio = dailyLeadsSum / reportedTotal;
      // Only correct if the ratio is a clean multiplier (1.8x–2.2x, 2.8x–3.2x, etc.)
      // This avoids correcting minor rounding differences
      const roundedRatio = Math.round(ratio);
      if (roundedRatio >= 2 && Math.abs(ratio - roundedRatio) < 0.2) {
        // Scale daily_leads down by the detected multiplier
        data.account_pulse = {
          ...ap,
          daily_leads: dailyLeads.map((v: number) => Math.round(v / roundedRatio)),
          _leads_correction_applied: true,
          _leads_correction_factor: roundedRatio,
        };
      }
    }
  }

  // ── 7. Data verification — embed cross-source comparison ─────────────
  // Compare leads from multiple sources so the dashboard can surface
  // discrepancies: daily_leads (corrected), total_leads_30d,
  // creative_health sum, adset_analysis sum.
  if (!data.data_verification) {
    const ap = data.account_pulse || {};
    const correctedDailyLeads: number[] = ap.daily_leads || [];
    const correctedDailyLeadsSum = correctedDailyLeads.reduce((s: number, v: number) => s + v, 0);
    const reportedTotal = ap.total_leads_30d ?? ap.total_leads ?? 0;
    const dailySpends: number[] = ap.daily_spends || [];
    const totalSpend = dailySpends.reduce((s: number, v: number) => s + v, 0);
    const reportedSpend = ap.total_spend_30d ?? ap.total_spend ?? 0;

    // Sum leads from entity-level arrays
    const creativeLeads = (data.creative_health || [])
      .reduce((s: number, c: any) => s + (c.leads ?? 0), 0);
    const adsetLeads = (data.adset_analysis || [])
      .reduce((s: number, a: any) => s + (a.leads ?? 0), 0);

    // Entity-level leads are the most trustworthy cross-reference
    const entityLeads = Math.max(creativeLeads, adsetLeads);

    // Spend discrepancy
    const spendDiscrepancy = Math.abs(totalSpend - reportedSpend);
    const spendDiscrepancyPct = reportedSpend > 0
      ? (spendDiscrepancy / reportedSpend) * 100
      : 0;

    // Leads discrepancy: compare reported total vs entity-level total
    const leadsDiscrepancy = entityLeads > 0
      ? Math.abs(reportedTotal - entityLeads)
      : 0;
    const leadsDiscrepancyPct = entityLeads > 0
      ? (leadsDiscrepancy / entityLeads) * 100
      : 0;

    const verified = spendDiscrepancyPct < 5 && leadsDiscrepancyPct < 5;

    data.data_verification = {
      verified,
      verified_at: data.generated_at || new Date().toISOString(),
      // Spend verification
      api_spend: reportedSpend,
      daily_spend_sum: Math.round(totalSpend * 100) / 100,
      spend_discrepancy_pct: parseFloat(spendDiscrepancyPct.toFixed(2)),
      // Leads verification
      reported_leads: reportedTotal,
      daily_leads_sum: correctedDailyLeadsSum,
      entity_leads: entityLeads,
      creative_health_leads: creativeLeads,
      adset_analysis_leads: adsetLeads,
      leads_discrepancy: leadsDiscrepancy,
      leads_discrepancy_pct: parseFloat(leadsDiscrepancyPct.toFixed(2)),
      // Daily leads correction tracking
      leads_correction_applied: !!ap._leads_correction_applied,
      leads_correction_factor: ap._leads_correction_factor || 1,
    };
  }

  return data;
}
