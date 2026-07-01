/**
 * SOP Engine — deterministic marketing logic (Layer 1)
 *
 * Provides a set of rules to generate draft recommendations based on raw metric data.
 * Used as input for the AI Reasoning layer and as a fallback.
 *
 * ─── CHANGELOG (Fix Guide v1) ────────────────────────────────────
 * 1. Fixed BUG: spend vs targetCpl comparison (line 131) — now spend > targetCpl * 2
 * 2. Fixed BUG: CPC check was nested inside CPL block — now independent
 * 3. Added adset/ad-group analysis block
 * 4. Added ad-level creative analysis beyond just fatigue (performance scoring)
 * 5. Added Google ad-group Quality Score per-entity insights
 */

export interface SopInsight {
  issue: string;
  impact: string;
  recommendation: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  entityId?: string;
  entityName?: string;
  entityType?: "campaign" | "adset" | "ad_group" | "ad" | "account";
  platform?: string;
  ice_score: number;
}

export function analyzeSop(analysisData: any, targets: any, platform: string): SopInsight[] {
  const insights: SopInsight[] = [];
  // 1. Dynamic Benchmark Derivation (Mojo AdCortex v1.2)
  // If no explicit target is set, we infer one from the account's current health and performance.
  const ap = analysisData.account_pulse || {};
  let targetCpl = targets?.cpl;
  
  if (!targetCpl || targetCpl <= 0) {
    const accountAvgCpl = ap.overall_cpl || ap.avg_cpl || 0;
    if (accountAvgCpl > 0) {
      // If no target set, use the account's current average as the baseline benchmark.
      targetCpl = accountAvgCpl;
    } else {
      // Last resort: platform-specific defaults
      targetCpl = platform === "google" ? 850 : 720;
    }
  }

  // ═══ 1. Account Level Pulse ═══════════════════════════════════════

  // 1.1 Critical CPL Deviation
  if (ap.overall_cpl > targetCpl * 1.5) {
    insights.push({
      issue: "Critical CPL Deviation",
      impact: `Account CPL (₹${Math.round(ap.overall_cpl)}) is ${(ap.overall_cpl / targetCpl).toFixed(1)}x target (₹${targetCpl}). Run cost-stack triage: CPM → CTR → CVR to identify the broken layer.`,
      recommendation: "Diagnose cost stack before pausing — check if CPM >₹150 (audience issue), CTR <0.5% (creative issue), or CVR <3% (landing page issue). Fix at the correct layer.",
      priority: "CRITICAL",
      entityType: "account",
      ice_score: 9,
    });
  }

  // 1.2 Account CTR Critically Low
  const overallCtr = ap.overall_ctr || 0;
  if (overallCtr > 0 && overallCtr < 0.6) {
    insights.push({
      issue: "Account CTR Critically Low",
      impact: `Account CTR (${overallCtr.toFixed(2)}%) is below the 0.6% threshold — creatives are failing to stop the scroll. Scroll-ignored ads are wasting impressions.`,
      recommendation: `Audit all active ads for creative age (>21 days = fatigue risk). Identify ads with CTR <0.4% and pause them. Test Reels-first format with disruptive first-frame hooks (e.g. "Still renting in Vizag?" or "₹7L for premium living?"). Separate retargeting audiences from cold audiences.`,
      priority: "HIGH",
      entityType: "account",
      ice_score: 8,
    });
  }

  // 1.3 Account-level frequency cap breach (Meta only)
  const overallFreq = ap.overall_frequency || ap.frequency || 0;
  if (platform === "meta" && overallFreq > 2.5) {
    insights.push({
      issue: "Audience Frequency Cap Breach",
      impact: `Account frequency (${overallFreq.toFixed(1)}x) exceeds 2.5 — audience has seen the same ads too many times. CPMs will inflate and CTR will continue declining.`,
      recommendation: "Segmented audience reset: (1) Create retargeting ad set for video viewers 50%+ and website visitors (last 30d) with current winning creative; (2) Rest cold broad audience for 7 days; (3) When restarting cold, launch with a fresh creative angle. Do NOT increase budget into a fatigued audience.",
      priority: "MEDIUM",
      entityType: "account",
      ice_score: 7,
    });
  }

  // 1.4 Budget reallocation: winners and losers co-existing
  const winnerCount = analysisData.intellect_insights?.winnerCount || 0;
  const loserCount = analysisData.intellect_insights?.loserCount || 0;
  if (winnerCount >= 1 && loserCount >= 1) {
    insights.push({
      issue: "Budget Reallocation Opportunity",
      impact: `${winnerCount} winner(s) running alongside ${loserCount} underperformer(s). Budget is being split inefficiently — the winners are being starved while losers drain spend.`,
      recommendation: `Shift 25% of the bottom underperformer's budget to the top winner. Scale winner by max 25% per step (prevents Meta learning phase reset). Cap — don't pause — underperformers to maintain data signal. After scaling, monitor frequency; if >2.5, rotate creative before adding more budget.`,
      priority: "HIGH",
      entityType: "account",
      ice_score: 8,
    });
  }


  // ═══ 2. Campaign Level Analysis ═══════════════════════════════════
  const campaigns = analysisData.campaign_audit || analysisData.campaign_performance || analysisData.campaigns || [];

  campaigns.forEach((c: any) => {
    const spend = c.spend || c.cost || 0;
    const leads = c.leads || c.conversions || 0;
    const clicks = c.clicks || 0;
    const imps = c.impressions || 0;
    const cpl = c.cpl || (leads > 0 ? spend / leads : spend > 500 ? 9999 : 0);
    const cvr = c.cvr || (clicks > 0 ? (leads / clicks) * 100 : 0);
    const cpc = c.avg_cpc || c.cpc || (clicks > 0 ? spend / clicks : 0);
    const ctr = c.ctr || (imps > 0 ? (clicks / imps) * 100 : 0);

    const name = c.campaign_name || c.name || "Unknown";
    const id = c.campaign_id || c.id;

    // 2.1 Budget Drain — zero leads
    if (spend > targetCpl * 2 && leads === 0) {
      insights.push({
        issue: "Budget Drain (Zero Leads)",
        impact: `Campaign "${name}" has spent ${Math.round(spend)} with no results.`,
        recommendation: `Pause campaign "${name}" immediately.`,
        priority: "CRITICAL",
        entityId: id,
        entityName: name,
        entityType: "campaign",
        ice_score: 10,
      });
    }

    // 2.2 High CPL + CVR Floor Breach
    if (cpl > targetCpl * 1.3 && leads > 0) {
      const benchmarkCvr = platform === "google" ? 3.0 : 4.0;
      if (cvr < benchmarkCvr) {
        insights.push({
          issue: "Conversion Rate Floor Breach",
          impact: `"${name}" CVR (${cvr.toFixed(2)}%) is below floor (${benchmarkCvr}%). CPL at ${Math.round(cpl)} vs target ${targetCpl}.`,
          recommendation: `Audit landing page experience for "${name}" or lead form friction.`,
          priority: "HIGH",
          entityId: id,
          entityName: name,
          entityType: "campaign",
          ice_score: 8
        });
      }
    }

    // 2.3 CPC Inflation — FIXED: now independent check, NOT nested inside CPL block
    const cpcThreshold = platform === "google" ? 120 : 45;
    if (cpc > cpcThreshold && clicks > 10) {
      insights.push({
        issue: "CPC Inflation",
        impact: `"${name}" CPC (${cpc.toFixed(0)}) exceeds ${platform} benchmark (${cpcThreshold}), pushing costs up.`,
        recommendation: platform === "google"
          ? `Review keyword match types and add negatives for "${name}" to reduce CPCs.`
          : `Review bidding strategy and audience overlap for "${name}".`,
        priority: "MEDIUM",
        entityId: id,
        entityName: name,
        entityType: "campaign",
        ice_score: 6
      });
    }

    // 2.4 Impression Share Loss (Google Specific)
    if (platform === "google") {
      const lostBudget = c.search_budget_lost_is || 0;
      const lostRank = c.search_rank_lost_is || 0;
      if (lostBudget > 20) {
        insights.push({
          issue: "Budget-Constrained Delivery",
          impact: `"${name}" losing ${lostBudget.toFixed(0)}% of traffic due to daily budget caps.`,
          recommendation: `Increase daily budget for "${name}" by 20% to capture efficient volume.`,
          priority: "HIGH",
          entityId: id,
          entityName: name,
          entityType: "campaign",
          ice_score: 8
        });
      }
      if (lostRank > 40) {
        insights.push({
          issue: "Rank-Constrained Delivery",
          impact: `"${name}" losing ${lostRank.toFixed(0)}% of auction share due to low Ad Rank/Quality.`,
          recommendation: `Improve Ad Copy relevance or Quality Score for "${name}" to lower effective CPCs.`,
          priority: "MEDIUM",
          entityId: id,
          entityName: name,
          entityType: "campaign",
          ice_score: 6
        });
      }
    }

    // 2.5 Algorithm Learning Trap
    // FIXED: spend > targetCpl * 2 (was comparing total spend to per-lead cost)
    const daysActive = c.days_active || 0;
    if (daysActive > 7 && leads < 5 && imps > 5000 && spend > targetCpl * 2) {
      insights.push({
        issue: "Algorithm Learning Trap",
        impact: `"${name}" active ${daysActive} days with only ${leads} leads from ${imps.toLocaleString()} impressions. Spent ${Math.round(spend)}.`,
        recommendation: `Reset campaign "${name}" with broader targeting or switch to "Clicks" focus temporarily.`,
        priority: "HIGH",
        entityId: id,
        entityName: name,
        entityType: "campaign",
        ice_score: 7
      });
    }

    // 2.6 Winner Scaling Opportunity
    if (leads >= 5 && cpl < targetCpl * 0.7) {
      insights.push({
        issue: "Top Performer Opportunity",
        impact: `"${name}" delivering leads at ${Math.round(cpl)} CPL (30% below target). Has room to scale.`,
        recommendation: `Scale budget for "${name}" by 20% to capture more volume.`,
        priority: "MEDIUM",
        entityId: id,
        entityName: name,
        entityType: "campaign",
        ice_score: 8,
      });
    }
  });

  // ═══ 3. Ad Set / Ad Group Level Analysis (NEW) ════════════════════
  const adsets = analysisData.adset_analysis || analysisData.ad_group_analysis || [];
  adsets.forEach((a: any) => {
    const spend = a.spend || a.cost || 0;
    const leads = a.leads || a.conversions || 0;
    const cpl = a.cpl || (leads > 0 ? spend / leads : 0);
    const freq = a.frequency || 0;
    const name = a.adset_name || a.ad_group_name || a.name || "Unknown";
    const id = a.adset_id || a.ad_group_id || a.id;
    const entityType = platform === "google" ? "ad_group" : "adset";

    // 3.1 Audience Saturation (ad set level — more actionable than campaign)
    if (freq > 3.0 && spend > targetCpl) {
      insights.push({
        issue: "Ad Set Audience Saturation",
        impact: `"${name}" frequency is ${freq.toFixed(1)}x — audience has seen ads too many times.`,
        recommendation: `Expand audience targeting or pause ad set "${name}" and create fresh audience.`,
        priority: "HIGH",
        entityId: id,
        entityName: name,
        entityType: entityType as any,
        ice_score: 8,
      });
    }

    // 3.2 Ad set zero leads budget drain
    if (spend > targetCpl * 1.5 && leads === 0 && (a.impressions || 0) > 2000) {
      insights.push({
        issue: "Ad Set Budget Drain",
        impact: `"${name}" spent ${Math.round(spend)} with zero leads at ${(a.impressions || 0).toLocaleString()} impressions.`,
        recommendation: `Pause ad set "${name}" immediately — audience/targeting mismatch likely.`,
        priority: "CRITICAL",
        entityId: id,
        entityName: name,
        entityType: entityType as any,
        ice_score: 9,
      });
    }

    // 3.3 High CPL ad set (with enough data)
    if (cpl > targetCpl * 1.3 && leads >= 2) {
      insights.push({
        issue: "Ad Set CPL Above Target",
        impact: `"${name}" CPL at ${Math.round(cpl)} vs target ${targetCpl} (${((cpl / targetCpl - 1) * 100).toFixed(0)}% over).`,
        recommendation: `Review targeting and creatives in "${name}" or reallocate budget to better-performing ad sets.`,
        priority: "HIGH",
        entityId: id,
        entityName: name,
        entityType: entityType as any,
        ice_score: 7,
      });
    }

    // 3.4 Google: Quality Score at ad group level
    if (platform === "google" && a.quality_score != null && a.quality_score > 0 && a.quality_score < 5) {
      insights.push({
        issue: "Low Quality Score Ad Group",
        impact: `"${name}" Quality Score is ${a.quality_score}/10 — significantly inflating CPCs.`,
        recommendation: `Improve ad relevance and landing page experience for "${name}". Consider tighter keyword grouping.`,
        priority: "HIGH",
        entityId: id,
        entityName: name,
        entityType: "ad_group",
        ice_score: 8,
      });
    }

    // 3.5 Agent flagged for pause
    if (a.should_pause === true) {
      const reasons = (a.auto_pause_reasons || []).join("; ");
      insights.push({
        issue: "Agent Flagged for Pause",
        impact: `"${name}" flagged by analysis engine: ${reasons || "threshold breach"}.`,
        recommendation: `Pause ad set "${name}" per analysis engine recommendation.`,
        priority: "HIGH",
        entityId: id,
        entityName: name,
        entityType: entityType as any,
        ice_score: 8,
      });
    }
  });

  // ═══ 4. Creative / Ad Level Analysis (EXPANDED) ═══════════════════
  const creative = analysisData.creative_health || analysisData.ad_analysis || [];
  creative.forEach((ad: any) => {
    const ageDays = ad.creative_age_days ?? ad.age_days ?? 0;
    const score = ad.creative_score ?? ad.performance_score ?? 0;
    const adSpend = ad.spend || ad.cost || 0;
    const adLeads = ad.leads || ad.conversions || 0;
    const adName = ad.ad_name || ad.name || "Unknown";
    const adId = ad.ad_id || ad.id;
    const freq = ad.frequency || 0;

    const isCriticalFailure = (score > 0 && score < 35) || (adSpend > targetCpl * 2.5 && adLeads === 0);
    const isOverdue = (ageDays > 35 && score < 70) || (ageDays > 45);

    if (isCriticalFailure) {
      insights.push({
        issue: "Critical Creative Failure",
        impact: `Ad "${adName}" has high spend (${Math.round(adSpend)}) but near-zero results (Score: ${score}).`,
        recommendation: `Pause ad "${adName}" immediately to recapture budget.`,
        priority: "CRITICAL",
        entityId: adId,
        entityName: adName,
        entityType: "ad",
        ice_score: 9,
      });
    } else if (isOverdue) {
      insights.push({
        issue: "Advanced Creative Fatigue",
        impact: `Ad "${adName}" is ${ageDays} days old with score ${score}. CTR signals are decaying.`,
        recommendation: `Queue creative refresh for "${adName}" with a fresh visual angle.`,
        priority: "HIGH",
        entityId: adId,
        entityName: adName,
        entityType: "ad",
        ice_score: 7,
      });
    }

    // Ad-level frequency saturation
    if (freq > 3.0 && adSpend > 500) {
      insights.push({
        issue: "Ad Audience Saturation",
        impact: `Ad "${adName}" frequency (${freq.toFixed(1)}x) — same users seeing this ad too often.`,
        recommendation: `Pause ad "${adName}" or rotate in fresh creative to reduce fatigue.`,
        priority: "MEDIUM",
        entityId: adId,
        entityName: adName,
        entityType: "ad",
        ice_score: 6,
      });
    }

    // Video-specific: low thumb stop rate
    const tsr = ad.thumb_stop_rate || ad.tsr;
    if (tsr != null && tsr < 25 && adSpend > 500) {
      insights.push({
        issue: "Weak Video Hook",
        impact: `Ad "${adName}" thumb stop rate is ${tsr.toFixed(1)}% — users are scrolling past.`,
        recommendation: `Replace first 3 seconds of "${adName}" with a stronger hook/pattern interrupt.`,
        priority: "HIGH",
        entityId: adId,
        entityName: adName,
        entityType: "ad",
        ice_score: 7,
      });
    }

    // Video-specific: low hold rate
    const vhr = ad.video_hold_rate || ad.vhr;
    if (vhr != null && vhr < 40 && tsr != null && tsr > 25 && adSpend > 500) {
      insights.push({
        issue: "Video Content Drop-Off",
        impact: `Ad "${adName}" gets attention (TSR ${tsr?.toFixed(1)}%) but loses viewers (VHR ${vhr.toFixed(1)}%).`,
        recommendation: `Tighten the narrative of "${adName}" — front-load the value proposition in first 10 seconds.`,
        priority: "MEDIUM",
        entityId: adId,
        entityName: adName,
        entityType: "ad",
        ice_score: 6,
      });
    }

    // Agent flagged ad for pause
    if (ad.should_pause === true) {
      const reasons = (ad.auto_pause_reasons || []).join("; ");
      if (!isCriticalFailure) { // Avoid duplicate with critical failure
        insights.push({
          issue: "Agent Flagged Ad for Pause",
          impact: `Ad "${adName}" flagged by analysis engine: ${reasons || "threshold breach"}.`,
          recommendation: `Pause ad "${adName}" per analysis engine recommendation.`,
          priority: "HIGH",
          entityId: adId,
          entityName: adName,
          entityType: "ad",
          ice_score: 8,
        });
      }
    }
  });

  // ═══ 5. Account-Level Checks ════════════════════════════════════════

  // 5.1 Spend vs Plan pacing
  const budget = targets?.budget || analysisData?.dynamic_thresholds?.budget || 0;
  if (budget > 0) {
    const totalSpend = ap.total_spend_30d || ap.total_spend || 0;
    const dayOfMonth = new Date().getDate();
    const expectedSpend = (budget / 30) * dayOfMonth;
    const diffPct = ((totalSpend - expectedSpend) / expectedSpend) * 100;

    if (Math.abs(diffPct) > 20) {
      insights.push({
        issue: "Pacing Deviation",
        impact: `Month-to-date spend is ${Math.abs(diffPct).toFixed(0)}% ${diffPct > 0 ? "ahead of" : "behind"} plan.`,
        recommendation: diffPct > 0 ? "Slow down daily spend to avoid budget depletion." : "Check for delivery bottlenecks or increase budgets.",
        priority: "HIGH",
        entityType: "account",
        ice_score: 7
      });
    }
  }

  // 5.2 Tracking Sanity — only fire when latest_daily_leads is explicitly populated
  const todayLeads = ap.latest_daily_leads;
  if (todayLeads !== undefined && todayLeads !== null && todayLeads === 0 && (ap.total_leads_30d || ap.avg_daily_leads || 0) > 0) {
    insights.push({
      issue: "Tracking Anomaly",
      impact: `Zero leads in the last 24 hours despite historical average of ${(ap.avg_daily_leads || 0).toFixed(1)}/day.`,
      recommendation: "Immediate check of pixel/CAPI status and form completion logs.",
      priority: "CRITICAL",
      entityType: "account",
      ice_score: 10
    });
  }

  // 5.3 Quality Score aggregate (Google specific)
  if (platform === "google") {
    const adGroups = (analysisData.campaigns || []).flatMap((c: any) => c.ad_groups || []);
    const lowQS = adGroups.filter((ag: any) => ag.quality_score != null && ag.quality_score > 0 && ag.quality_score < 6);
    if (lowQS.length > 0) {
      insights.push({
        issue: "Low Quality Score Drain",
        impact: `${lowQS.length} ad groups have Quality Score < 6, inflating CPCs across the account.`,
        recommendation: "Audit landing page relevance and improve ad copy alignment with keywords.",
        priority: "MEDIUM",
        entityType: "ad_group",
        ice_score: 5
      });
    }
  }

  return insights.sort((a, b) => b.ice_score - a.ice_score);
}
