import { db } from "./db";
import { biddingRecommendations, clients as clientTable, analysisSnapshots } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { log } from "./index";

export async function generateBiddingRecommendations(clientId: string) {
  log(`Bidding Intelligence: Generating recommendations for ${clientId}...`, "bidding");

  // 1. Fetch latest Google Ads analysis snapshot
  const [snapshot] = await db
    .select()
    .from(analysisSnapshots)
    .where(and(
      eq(analysisSnapshots.clientId, clientId),
      eq(analysisSnapshots.platform, "google")
    ))
    .orderBy(desc(analysisSnapshots.createdAt))
    .limit(1);

  if (!snapshot) {
    log(`Bidding Intelligence: No Google snapshot found for ${clientId}`, "bidding");
    return;
  }

  const data = snapshot.data as any;
  const campaigns = data.campaigns || [];
  const targets = data.targets || {};
  const targetCpa = targets.cpl || 850;

  // ─── 2. Process Campaigns ─────────────────────────────────────
  for (const camp of campaigns) {
    if (camp.status !== "ENABLED") continue;
    await processEntityBidding(clientId, camp, targetCpa, null);
  }

  // ─── 3. Process Ad Groups ──────────────────────────────────────
  const adGroups = data.ad_groups || [];
  for (const ag of adGroups) {
    if (ag.status !== "ENABLED") continue;
    await processEntityBidding(clientId, ag, targetCpa, ag.campaign_id);
  }

  log(`Bidding Intelligence: Completed for ${clientId}`, "bidding");
}

async function processEntityBidding(clientId: string, entity: any, targetCpa: number, campaignIdForAdGroup: string | null) {
  const isAdGroup = !!campaignIdForAdGroup;
  const currentStrategy = entity.bidding_strategy || (isAdGroup ? "PARENT_CAMPAIGN" : "UNKNOWN");
  const avgCpc = entity.avg_cpc || 0;
  const cvr = (entity.cvr || 0) / 100;
  const conversions = entity.conversions || 0;
  const costPerConversion = entity.cpl || 0;
  const clicks = entity.clicks || 0;
  const searchIs = entity.search_impression_share || 0;
  const lostIsRank = entity.search_rank_lost_is || 0;
  const lostIsBudget = entity.search_budget_lost_is || 0;

  let recommendation: "stay_max_clicks" | "switch_tcpa" | "hold" = "stay_max_clicks";
  let reasons: string[] = [];
  let confidence: "low" | "medium" | "high" = "medium";
  let computed_bid_limit: number | null = null;
  let suggested_tcpa: number | null = null;
  let alerts: { severity: "critical" | "warning" | "info"; message: string }[] = [];

  // Alerts
  if (avgCpc > targetCpa * 0.1 && cvr < 0.01) {
    alerts.push({ severity: "critical", message: "CPC too high vs CVR" });
  }
  if (lostIsRank > 40) {
    alerts.push({ severity: "critical", message: "Low impression share due to rank" });
  }

  // Logic (simplified for shared entity use)
  const isMaxClicks = currentStrategy === "MAXIMIZE_CLICKS" || currentStrategy === "UNKNOWN" || currentStrategy === "PARENT_CAMPAIGN";
  
  if (isMaxClicks && conversions >= 15) {
    recommendation = "switch_tcpa";
    suggested_tcpa = targetCpa;
    reasons.push(`${conversions.toFixed(1)} conversions in last 7 days.`);
    confidence = conversions >= 30 ? "high" : "medium";
  } else if (isMaxClicks) {
    recommendation = "stay_max_clicks";
    const bidByCpc = avgCpc * 1.35;
    const bidByTarget = targetCpa * cvr;
    computed_bid_limit = cvr > 0 ? Math.min(bidByCpc, bidByTarget) : bidByCpc;
    reasons.push(`Maintain with bid limit ₹${Math.round(computed_bid_limit)}.`);
  }

  // Save to DB
  await db.insert(biddingRecommendations).values({
    campaignId: isAdGroup ? campaignIdForAdGroup : entity.id,
    adGroupId: isAdGroup ? entity.id : null,
    clientId,
    campaignName: entity.campaign_name || entity.name,
    adGroupName: isAdGroup ? entity.name : null,
    currentStrategy,
    recommendedStrategy: recommendation === "switch_tcpa" ? "TARGET_CPA" : "MAXIMIZE_CLICKS",
    currentBidLimit: entity.bid_limit ? String(entity.bid_limit) : null,
    recommendedBidLimit: computed_bid_limit ? String(Math.round(computed_bid_limit)) : null,
    currentTCPA: entity.target_cpa ? String(entity.target_cpa) : null,
    recommendedTCPA: suggested_tcpa ? String(Math.round(suggested_tcpa)) : null,
    avgCpc: String(avgCpc),
    ctr: String(entity.ctr),
    cvr: String(entity.cvr),
    costPerConversion: String(costPerConversion),
    searchImpressionShare: entity.search_impression_share ? String(entity.search_impression_share) : null,
    lostIsRank: entity.search_rank_lost_is ? String(entity.search_rank_lost_is) : null,
    lostIsBudget: entity.search_budget_lost_is ? String(entity.search_budget_lost_is) : null,
    conversions: String(conversions),
    clicks: String(clicks),
    confidenceLevel: confidence,
    reason: JSON.stringify({ reasons, alerts, recommendation }),
    status: "pending",
  });
}
