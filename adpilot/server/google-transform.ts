/**
 * Google Ads Analysis Data Normalization Layer
 *
 * Transforms raw Python agent JSON output into the canonical AnalysisData
 * shape expected by the frontend. This eliminates ad-hoc fallback chains
 * in every page component.
 */

// ─── Campaign Normalization ─────────────────────────────────────────

import { getClassification } from "../shared/classification";
import {
  scoreStagedCostDynamic,
  getMetricWeights,
  scoreWeightedCostMetric,
  scoreWeightedBudgetMetric,
  scoreWeightedCreativeMetric,
  sumMetricScores,
  computeMinRatio,
  computeDualGateStatus,
} from "./scoring-config";

/**
 * Recomputes Google account health score using Mojo AdCortex v2.0 formulas:
 * - Targets from benchmarks tab (google_cpl, google_cpsv_low, google_cpql_target, etc.)
 * - Current values from API MTD data (mtd_pacing)
 *
 * Weights: CPSV 25 · Budget 25 · CPQL 20 · CPL 20 · Creative 10
 *
 * Formulas:
 *   - Cost metrics (CPSV, CPL, CPQL): Quadratic decay with acceleration
 *   - Budget: Quadratic penalty for both overspend and underspend
 *   - Campaign/Creative: Agent-provided values
 *
 * Status determination: Dual-gate system (composite + weakest-link veto)
 */
function recomputeGoogleHealthScore(data: any): {
  score: number;
  breakdown: Record<string, number>;
  status: string;
} {
  const ap = data.account_pulse || {};
  const rawMtd = ap.mtd_pacing || {};                 // raw agent MTD pacing
  const mp = data.monthly_pacing || {};               // normalized monthly_pacing (has mp.mtd, mp.pacing)
  const benchmarks = data.sop_benchmarks || {};
  // MTD deliverables (manually entered SVS, qualified leads) — same as Meta
  const mtdDeliverables = data.mtd_deliverables || {};

  const weights = getMetricWeights("google");

  // ── MTD-only actuals — strictly MTD, no cadence-window or 30-day data ──
  // Priority: normalized mp.mtd (from normalizeMonthlyPacing) → raw mtd_pacing
  const actualSpendMtd = mp.mtd?.spend ?? rawMtd.spend_mtd ?? 0;
  const actualLeadsMtd = mp.mtd?.leads ?? rawMtd.leads_mtd ?? 0;
  // SVS and qualified leads from MTD deliverables (manually entered) — not available in API
  const actualSvsMtd = mtdDeliverables.svs_achieved ?? rawMtd.svs_mtd ?? 0;
  const actualQLeadsMtd = mtdDeliverables.positive_leads_achieved ?? rawMtd.qualified_leads_mtd ?? 0;

  // ─── CPL Score (Lower is better) ───
  // benchmarks.google_cpl = "Google CPL Target" from Benchmarks tab
  const cplTarget = benchmarks.google_cpl || benchmarks.cpl || mp.targets?.cpl || 850;
  const actualCplMtd = actualLeadsMtd > 0 ? actualSpendMtd / actualLeadsMtd : 0;
  const cplScore = scoreWeightedCostMetric(
    actualLeadsMtd > 0 ? actualCplMtd : (actualSpendMtd > 0 ? Number.POSITIVE_INFINITY : 0),
    cplTarget,
    weights.cpl
  );

  // ─── Budget/Pacing Score (MTD spend vs prorated monthly budget) ───
  const now = new Date();
  const derivedDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysInMonth = (mp.days_elapsed ?? 0) + (mp.days_remaining ?? 0) || derivedDaysInMonth;
  const daysElapsed = mp.days_elapsed ?? rawMtd.days_elapsed ?? Math.min(now.getDate(), daysInMonth);
  // PRIORITY: Benchmarks tab budget, then pacing targets
  const monthlyBudget = benchmarks.google_budget || benchmarks.budget || mp.targets?.budget || rawMtd.target_budget || data.targets?.budget || 0;
  const budgetScore = scoreWeightedBudgetMetric(
    actualSpendMtd,
    monthlyBudget,
    daysElapsed,
    daysInMonth,
    weights.budget
  );

  // ─── CPQL Score (Lower is better: Staged) ───
  // benchmarks.google_cpql_target or benchmarks.cpql_target from Benchmarks tab
  const cpqlTarget = benchmarks.google_cpql_target || benchmarks.cpql_target || mp.targets?.cpql || 1500;
  const actualCpqlMtd = actualQLeadsMtd > 0 ? actualSpendMtd / actualQLeadsMtd : 0;
  const cpqlScore = actualQLeadsMtd > 0
    ? scoreWeightedCostMetric(actualCpqlMtd, cpqlTarget, weights.cpql)
    : 10;

  // ─── CPSV Score (Lower is better: Staged) ───
  // benchmarks.google_cpsv_low = "Google CPSV Target Low" from Benchmarks tab
  // actualSvsMtd from MTD deliverables (svs_achieved — manually entered)
  const cpsvTarget = benchmarks.google_cpsv_low || benchmarks.cpsv_low || mp.targets?.cpsv?.low || 0;
  const actualCpsvMtd = actualSvsMtd > 0 ? actualSpendMtd / actualSvsMtd : 0;
  const cpsvScore = scoreWeightedCostMetric(
    actualSvsMtd > 0 ? actualCpsvMtd : (actualSpendMtd > 0 ? Number.POSITIVE_INFINITY : 0),
    cpsvTarget,
    weights.cpsv
  );

  // ─── Creative Score (Spend-weighted average + diversity factor) ───
  const creativeHealth: any[] = data.creative_health || [];
  const creativeScore = scoreWeightedCreativeMetric(creativeHealth, weights.creative);

  const breakdown = {
    cpsv: Math.round(cpsvScore * 100) / 100,
    budget: Math.round(budgetScore * 100) / 100,
    cpql: Math.round(cpqlScore * 100) / 100,
    cpl: Math.round(cplScore * 100) / 100,
    creative: Math.round(creativeScore * 100) / 100,
  };

  const compositeScore = Math.round(sumMetricScores(breakdown) * 100) / 100;

  // ─── Apply Dual-Gate Status Determination ───
  // Compute weakest-link ratio: min(score_i / weight_i) across all 5 metrics
  const minRatio = computeMinRatio(breakdown, weights);

  // Determine status using dual-gate (composite + veto)
  const dualGateStatus = computeDualGateStatus(compositeScore, minRatio);
  return { score: compositeScore, breakdown, status: dualGateStatus };
}

function cleanCampaignName(name: string): string {
  // Strip Render/deploy hash suffixes like " #d2r|dt7-dm_branded_..."
  return name.replace(/\s*#[a-z0-9|]+[-–].*$/i, "").trim();
}

function deriveCpc(cost: number, clicks: number): number {
  if (clicks > 0) return Math.round((cost / clicks) * 100) / 100;
  return 0;
}

function deriveCpm(cost: number, impressions: number): number {
  if (impressions > 0) return Math.round((cost / impressions) * 1000 * 100) / 100;
  return 0;
}

/** Parse DD/MM/YYYY from ad name (e.g. "20/02/2026-211-7lightblue-...") and return age in days */
function parseAgeDaysFromName(name: string): number | null {
  const match = name?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const created = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
}

function normalizeCampaign(c: any, benchmarks: any = {}): any {
  const cost = c.cost || 0;
  const clicks = c.clicks || 0;
  const impressions = c.impressions || 0;
  const conversions = c.conversions || 0;

  // Derive CPC/CPM if the API returned 0 (common with auto-bidding strategies)
  const avg_cpc = c.avg_cpc > 0 ? c.avg_cpc : deriveCpc(cost, clicks);
  const avg_cpm = c.avg_cpm > 0 ? c.avg_cpm : deriveCpm(cost, impressions);

  // Map campaign_type to layer for cross-platform compatibility
  const layerMap: Record<string, string> = {
    branded: "Branded",
    location: "Location",
    demand_gen: "Demand Gen",
    demand_gen_lookalike: "DG Lookalike",
    demand_gen_inmarket: "DG InMarket",
    demand_gen_custom: "DG Custom",
    demand_gen_retarget: "DG Retarget",
  };

  const campaignType = c.campaign_type || "unknown";
  const layer = layerMap[campaignType] || campaignType;

  const healthScore = c.health_score ?? c.score ?? 0;
  const classification = getClassification(healthScore);

  // Calculate weighted TSR/VHR from nested ads if applicable
  let campaignTsr = 0;
  let campaignVhr = 0;
  let totalVideoImpressions = 0;

  for (const ag of c.ad_groups || []) {
    for (const ad of ag.ads || []) {
      const adImpressions = ad.impressions || 0;
      const isVideo = ad.ad_type === "VIDEO" || ad.type === "VIDEO" || (ad.video_views || 0) > 0;
      if (isVideo && adImpressions > 0) {
        campaignTsr += (ad.tsr || 0) * adImpressions;
        campaignVhr += (ad.vhr || 0) * adImpressions;
        totalVideoImpressions += adImpressions;
      }
    }
  }

  const finalTsr = totalVideoImpressions > 0 ? campaignTsr / totalVideoImpressions : (c.tsr || 0);
  const finalVhr = totalVideoImpressions > 0 ? campaignVhr / totalVideoImpressions : (c.vhr || 0);

  return {
    // Canonical CampaignAudit fields
    campaign_id: c.id || c.campaign_id || "",
    campaign_name: cleanCampaignName(c.name || c.campaign_name || ""),
    layer,
    objective: c.channel_type || c.objective || "",
    status: c.status || "UNKNOWN",
    health_score: healthScore,
    score_breakdown: c.score_breakdown || c.cost_stack?.statuses || {},
    score_bands: c.score_bands || {},
    detailed_breakdown: c.detailed_breakdown || (c.campaign_type === "DEMAND_GEN" ? reconstructDetailed(c.score_breakdown, "google_dg", c, benchmarks) : reconstructDetailed(c.score_breakdown, "google_campaign", c, benchmarks)),
    classification,

    // Core metrics
    spend: cost,
    impressions,
    clicks,
    ctr: c.ctr || 0,
    cpc: avg_cpc,
    cpm: avg_cpm,
    frequency: c.frequency || 0,
    reach: c.reach || 0,
    leads: conversions,
    cpl: c.cpl || 0,
    cvr: c.cvr || 0,

    // Video metrics
    tsr: finalTsr,
    vhr: finalVhr,

    // Budget
    daily_budget: c.daily_budget || 0,
    budget_remaining: 0,
    budget_utilization_pct: 0,

    // Status flags
    is_lead_campaign: campaignType !== "demand_gen" || conversions > 0,
    is_awareness: false,
    delivery_status: c.status === "ENABLED" ? "active" : "paused",
    learning_status: "",

    // Google-specific fields (preserved for Google pages)
    campaign_type: campaignType,
    channel_type: c.channel_type || "",
    bidding_strategy: c.bidding_strategy || "",
    search_impression_share: c.search_impression_share ?? 0,
    search_budget_lost_is: c.search_budget_lost_is ?? 0,
    search_rank_lost_is: c.search_rank_lost_is ?? 0,
    absolute_top_is: c.absolute_top_is ?? 0,
    top_is: c.top_is ?? 0,
    click_share: c.click_share ?? 0,
    exact_match_is: c.exact_match_is ?? 0,
    all_conversions: c.all_conversions || conversions,
    cost_stack: c.cost_stack || null,
    impression_share_analysis: c.impression_share_analysis || null,
    dg_health: c.dg_health || null,
    benchmark_comparison: c.benchmark_comparison || null,

    // Nested ad groups (kept for pages that still need them)
    ad_group_count: c.ad_group_count || 0,
    ad_groups: c.ad_groups || [],
  };
}

// ─── Ad Group Extraction & Normalization ────────────────────────────

function extractAdGroups(campaigns: any[], benchmarks: any = {}): any[] {
  const adGroups: any[] = [];

  for (const campaign of campaigns) {
    const campaignName = cleanCampaignName(campaign.name || campaign.campaign_name || "");
    const campaignType = campaign.campaign_type || "unknown";
    const groups = campaign.ad_groups || [];

    for (const ag of groups) {
      const cost = ag.cost || 0;
      const clicks = ag.clicks || 0;
      const impressions = ag.impressions || 0;
      const conversions = ag.conversions || 0;
      const avg_cpc = ag.avg_cpc > 0 ? ag.avg_cpc : deriveCpc(cost, clicks);
      const healthScore = ag.health_score ?? ag.score ?? 0;

      adGroups.push({
        ad_group_id: ag.id || ag.ad_group_id || "",
        ad_group_name: ag.name || ag.ad_group_name || "",
        campaign_id: ag.campaign_id || campaign.id || "",
        campaign_name: campaignName,
        campaign_type: campaignType,
        status: ag.status || "UNKNOWN",
        health_score: healthScore,
        classification: getClassification(healthScore),

        // Metrics
        impressions,
        clicks,
        spend: cost,
        ctr: ag.ctr || 0,
        avg_cpc,
        cpc: avg_cpc,
        cpl: ag.cpl || 0,
        cvr: ag.cvr || 0,
        conversions,
        leads: conversions,

        // QS (if available)
        quality_score: ag.quality_score || null,

        // Score details
        score_breakdown: ag.score_breakdown || {},
        score_bands: ag.score_bands || {},
        detailed_breakdown: ag.detailed_breakdown || reconstructDetailed(ag.score_breakdown, "google_adgroup", ag, benchmarks),
      });
    }
  }

  return adGroups;
}

// ─── Creative Health Extraction ─────────────────────────────────────

function extractCreativeHealth(campaigns: any[], existingCreativeHealth: any[], benchmarks: any = {}): any[] {
  // If the agent already populated creative_health, use it
  if (existingCreativeHealth && existingCreativeHealth.length > 0) {
    return existingCreativeHealth.map((creative: any) => {
      const ageDays = (creative.creative_age_days && creative.creative_age_days > 0)
        ? creative.creative_age_days
        : parseAgeDaysFromName(creative.name || creative.ad_name || "");
      return {
        ...creative,
        creative_age_days: ageDays,
        classification: getClassification(
          creative.health_score ?? creative.creative_score ?? creative.performance_score ?? 0
        ),
      };
    });
  }

  // Otherwise extract from nested campaigns → ad_groups → ads
  const creatives: any[] = [];

  for (const campaign of campaigns) {
    const campaignName = cleanCampaignName(campaign.name || "");
    for (const ag of campaign.ad_groups || []) {
      for (const ad of ag.ads || []) {
        const cost = ad.cost || 0;
        const clicks = ad.clicks || 0;
        const impressions = ad.impressions || 0;
        const conversions = ad.conversions || 0;
        const isVideo = ad.ad_type === "VIDEO" || ad.type === "VIDEO" || (ad.video_views || 0) > 0;

        creatives.push({
          ad_id: ad.id || ad.ad_id || "",
          ad_name: ad.name || ad.ad_name || "",
          campaign_name: campaignName,
          adset_name: ag.name || ag.ad_group_name || "",
          ad_group_name: ag.name || ag.ad_group_name || "",

          spend: cost,
          impressions,
          clicks,
          leads: conversions,
          cpl: conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : 0,
          ctr: ad.ctr || (impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0),
          cpc: ad.cpc || ad.avg_cpc || deriveCpc(cost, clicks),
          cpm: ad.cpm || deriveCpm(cost, impressions),
          cvr: ad.cvr || (clicks > 0 ? Math.round((conversions / clicks) * 10000) / 100 : 0),
          frequency: ad.frequency || 0,

          is_video: isVideo,
          creative_type: isVideo ? "video" : "static",
          thumb_stop_pct: ad.tsr || 0,
          hold_rate_pct: ad.vhr || 0,
          first_frame_rate: 0,
          video_p25: ad.video_quartile_25 || 0,
          video_p50: ad.video_quartile_50 || 0,
          video_p75: ad.video_quartile_75 || 0,
          video_p100: ad.video_quartile_100 || 0,
          avg_watch_sec: 0,

          creative_age_days: (ad.creative_age_days && ad.creative_age_days > 0)
            ? ad.creative_age_days
            : parseAgeDaysFromName(ad.name || ad.ad_name || ""),
          health_signals: [],
          creative_score: ad.health_score || ad.performance_score || 0,
          scoring_type: isVideo ? "video" : "static",
          score_breakdown: ad.score_breakdown || {},
          score_bands: {},
          detailed_breakdown: ad.detailed_breakdown || reconstructDetailed(ad.score_breakdown, ad.ad_type === "VIDEO" ? "google_creative" : "google_rsa", ad, benchmarks),
          classification: getClassification(
            ad.health_score ?? ad.performance_score ?? ad.creative_score ?? 0
          ),
          should_pause: ad.should_pause || false,
          auto_pause_reasons: ad.auto_pause_reasons || [],

          // Google-specific
          ad_type: ad.ad_type || ad.type || (isVideo ? "VIDEO" : "RSA"),
          ad_strength: ad.ad_strength || null,
        });
      }
    }
  }

  return creatives;
}

// ─── Monthly Pacing Normalization ───────────────────────────────────

function normalizeMonthlyPacing(accountPulse: any, targets: any): any {
  const mtd = accountPulse?.mtd_pacing;
  if (!mtd) return null;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const daysElapsed = mtd.days_elapsed || Math.min(now.getDate(), totalDays);

  // Guard against stale data from a previous month to prevent nonsensical pacing projections
  if (daysElapsed > totalDays) return null;

  const daysRemaining = mtd.days_remaining || (totalDays - daysElapsed);
  const pctThrough = Math.round((daysElapsed / totalDays) * 100);

  const targetBudget = mtd.target_budget || targets?.budget || 0;
  const targetLeads = mtd.target_leads || targets?.leads || 0;
  const targetCpl = mtd.target_cpl || targets?.cpl || 0;
  const targetSvs = mtd.target_svs || targets?.svs || 0;

  const spendMtd = mtd.spend_mtd || accountPulse?.total_spend || 0;
  const leadsMtd = mtd.leads_mtd || accountPulse?.total_leads || 0;

  const projectedSpend = mtd.projected_spend || (daysElapsed > 0 ? (spendMtd / daysElapsed) * totalDays : 0);
  const projectedLeads = mtd.projected_leads || (daysElapsed > 0 ? (leadsMtd / daysElapsed) * totalDays : 0);

  const expectedSpend = (targetBudget / totalDays) * daysElapsed;
  const expectedLeads = (targetLeads / totalDays) * daysElapsed;

  const spendPct = mtd.pacing_spend_pct || (expectedSpend > 0 ? Math.round((spendMtd / expectedSpend) * 100) : 0);
  const leadsPct = mtd.pacing_leads_pct || (expectedLeads > 0 ? Math.round((leadsMtd / expectedLeads) * 100) : 0);

  const dailyNeededSpend = daysRemaining > 0 ? Math.round(((targetBudget - spendMtd) / daysRemaining) * 100) / 100 : 0;
  const dailyNeededLeads = daysRemaining > 0 ? Math.round(((targetLeads - leadsMtd) / daysRemaining) * 10) / 10 : 0;

  return {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    pct_through_month: pctThrough,
    targets: {
      budget: targetBudget,
      leads: targetLeads,
      cpl: targetCpl,
      svs: typeof targetSvs === "object" ? targetSvs : { low: targetSvs, high: targetSvs },
      cpsv: { low: 0, high: 0 },
    },
    data_source: "google_agent",
    mtd: {
      spend: spendMtd,
      leads: leadsMtd,
      cpl: leadsMtd > 0 ? Math.round((spendMtd / leadsMtd) * 100) / 100 : 0,
      ctr: accountPulse?.overall_ctr || 0,
      cpc: accountPulse?.overall_cpc || 0,
      cpm: accountPulse?.overall_cpm || 0,
      impressions: accountPulse?.total_impressions || 0,
      clicks: accountPulse?.total_clicks || 0,
    },
    expected: { spend: Math.round(expectedSpend), leads: Math.round(expectedLeads * 10) / 10 },
    projected_eom: {
      spend: Math.round(projectedSpend),
      leads: Math.round(projectedLeads),
      cpl: projectedLeads > 0 ? Math.round((projectedSpend / projectedLeads) * 100) / 100 : 0,
    },
    pacing: {
      spend_pct: spendPct,
      spend_status: spendPct >= 90 ? "on_track" : spendPct >= 70 ? "slightly_behind" : "behind",
      leads_pct: leadsPct,
      leads_status: leadsPct >= 90 ? "on_track" : leadsPct >= 70 ? "slightly_behind" : "behind",
      cpl_status: (accountPulse?.overall_cpl || 0) <= (targetCpl * 1.1) ? "on_track" : "above_target",
    },
    daily_needed: {
      spend: dailyNeededSpend,
      leads: dailyNeededLeads,
    },
    alerts: mtd.on_track === false
      ? [`Projected ${Math.round(projectedLeads)} leads vs ${targetLeads} target (gap: ${targetLeads - Math.round(projectedLeads)})`]
      : [],
  };
}

// ─── Recommendation Normalization ───────────────────────────────────

function normalizeRecommendation(rec: any): any {
  return {
    ...rec,
    // Ensure all expected fields exist
    id: rec.id || `R-${Math.random().toString(36).slice(2, 8)}`,
    insight: rec.insight || rec.description || "",
    action: rec.action || rec.action_type || "",
    impact: rec.impact || "",
    confidence: rec.confidence || "medium",
    category: rec.category || "general",
    campaign: rec.campaign ? cleanCampaignName(rec.campaign) : "",
    campaign_id: rec.campaign_id || "",
    ice_score: rec.ice_score || 5,
    action_type: rec.action_type || "manual_review",
    auto_executable: rec.auto_executable ?? false,
    sop_reference: rec.sop_reference || "",
    execution_status: rec.execution_status || "pending",
  };
}

// ─── Main Normalization Entry Point ─────────────────────────────────

export function normalizeGoogleAnalysis(raw: any): any {
  const benchmarks = raw.sop_benchmarks || {};
  const campaigns = (raw.campaigns || []).map((campaign: any) => normalizeCampaign(campaign, benchmarks));
  const adGroupAnalysis = extractAdGroups(raw.campaigns || [], benchmarks);
  const creativeHealth = extractCreativeHealth(raw.campaigns || [], raw.creative_health, benchmarks);

  // Normalize monthly pacing FIRST so recomputeGoogleHealthScore can use
  // mp.mtd.spend / mp.mtd.leads / mp.pacing.spend_pct (MTD-only data)
  const monthlyPacing = normalizeMonthlyPacing(raw.account_pulse, raw.targets);

  // Inject normalized monthly_pacing into raw before scoring so the health score
  // recomputation sees proper MTD values (mp.mtd.spend, mp.pacing.spend_pct, etc.)
  const dataForScoring = {
    ...raw,
    monthly_pacing: monthlyPacing ?? raw.monthly_pacing,
  };

  const recomputed = recomputeGoogleHealthScore(dataForScoring);

  return {
    // Metadata
    platform: "google",
    status: raw.status || "OK",
    timestamp: raw.timestamp || new Date().toISOString(),
    cadence: raw.cadence || "twice_weekly",
    window: raw.window || null,

    // Scores — recomputed from benchmarks + MTD API data (never cadence-window data)
    account_health_score: recomputed.score,
    account_health_classification: recomputed.status,
    account_health_breakdown: recomputed.breakdown,

    // Canonical data keys (what frontend expects)
    account_pulse: raw.account_pulse || {},
    monthly_pacing: monthlyPacing,
    campaign_audit: campaigns,
    ad_group_analysis: adGroupAnalysis,
    creative_health: creativeHealth,

    // Google-specific summary sections
    search_summary: raw.search_summary || null,
    dg_summary: raw.dg_summary || null,

    // Deep analysis modules
    quality_score_analysis: raw.quality_score_analysis || { status: "DISABLED", keywords: [] },
    search_terms_analysis: raw.search_terms_analysis || { status: "DISABLED", all_terms: [] },
    bidding_analysis: raw.bidding_analysis || { per_ad_group: [], smart_bidding_readiness: [] },
    ad_group_restructuring: raw.ad_group_restructuring || { summary: {}, recommendations: [] },
    cvr_analysis: raw.cvr_analysis || null,
    conversion_sanity: raw.conversion_sanity || null,
    geo_analysis: raw.geo_analysis || null,
    demographic_breakdowns: raw.demographic_breakdowns || {},
    frequency_audit: raw.frequency_audit || null,

    // Intelligence
    recommendations: (raw.recommendations || []).map(normalizeRecommendation),
    auto_pause_candidates: raw.auto_pause_candidates || [],
    playbooks_triggered: raw.playbooks_triggered || [],
    intellect_insights: raw.intellect_insights || [],

    // Time series
    daily_trends: raw.daily_trends || [],

    // Config
    targets: raw.targets || {},
    thresholds: raw.thresholds || {},
    dynamic_thresholds: raw.dynamic_thresholds || {},
    benchmarks: raw.benchmarks || {},
    module_activation: raw.module_activation || {},
    data_verification: raw.data_verification || null,

    // Backwards-compat: keep raw campaigns for pages that still reference it
    campaigns: campaigns,
  };
}

function reconstructDetailed(breakdown: any, type: string, item: any = {}, targets: any = {}): Record<string, any> {
  if (!breakdown) return {};
  const weights: Record<string, Record<string, number>> = {
    google_campaign: { cpl: 30, cvr: 22, cpc: 15, qs: 13, ctr: 10, is: 5, rsa: 5 },
    google_adgroup: { cpl: 30, cvr: 25, ctr: 15, qs: 15, is: 10, cpc: 5 },
    google_dg: { cpl: 36, cvr: 19, ctr: 19, freq: 14, cpm: 12 },
    google_creative: { cpl: 35, cpm: 25, cr: 20, cpc: 20 },
    google_rsa: { ad_strength: 30, quality_score: 30, ctr: 20, expected_ctr: 20 }
  };
  const w = weights[type] || {};
  const detailed: any = {};

  const targetCpl = targets.google_cpl || targets.cpl || 850;

  for (const k in w) {
    let score = breakdown[k];

    // Hot re-score cost metrics if raw data is available
    if (k === 'cpl' && item.cpl > 0) {
      score = scoreStagedCostDynamic(item.cpl, targetCpl);
    } else if (k === 'cpc' && (item.cpc > 0 || item.avg_cpc > 0)) {
      score = scoreStagedCostDynamic(item.cpc || item.avg_cpc, 30);
    }

    if (score !== undefined) {
      detailed[k] = {
        score: Math.round(score * 10) / 10,
        weight: w[k],
        contribution: Math.round((score * w[k] / 100) * 10) / 10
      };
    }
  }
  return detailed;
}
