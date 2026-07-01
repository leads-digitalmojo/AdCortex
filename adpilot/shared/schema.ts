import { pgTable, text, serial, integer, boolean, timestamp, jsonb, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Database Tables ────────────────────────────────────────────────

export const apiConfigs = pgTable("ai_configs", {
  id: serial("id").primaryKey(),
  openapiApiKey: text("openapi_api_key").notNull().default(""),
  geminiModel: text("gemini_model").notNull().default("gemini-1.5-flash"),
  geminiImageModel: text("gemini_image_model").notNull().default("gemini-2.0-flash-preview-image-generation"),
  groqApiKey: text("groq_api_key").notNull().default(""),
  groqModel: text("groq_model").notNull().default("llama-3.3-70b-versatile"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const clients = pgTable("clients", {
  id: text("id").primaryKey(), // e.g. "amara"
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  project: text("project").notNull(),
  location: text("location").notNull(),
  targetLocations: jsonb("target_locations").$type<string[]>().default([]),
  platforms: jsonb("platforms").notNull().default({}),
  targets: jsonb("targets").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: text("created_by"),
});

export const clientCredentials = pgTable("client_credentials", {
  clientId: text("client_id").primaryKey().references(() => clients.id, { onDelete: "cascade" }),
  meta: jsonb("meta").$type<{ accessToken: string; adAccountId: string }>(),
  google: jsonb("google").$type<{
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    developerToken: string;
    mccId: string;
    customerId: string;
  }>(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const creativeHubs = pgTable("creative_hubs", {
  clientId: text("client_id").primaryKey(),
  setup: jsonb("setup").default(null),
  threads: jsonb("threads").notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Action logs — every recommendation action requires a strategic_call rationale
export const actionLogs = pgTable("action_logs", {
  id: serial("id").primaryKey(),
  recommendationId: text("recommendation_id").notNull(),
  clientId: text("client_id").notNull(),
  platform: text("platform").notNull(),
  action: text("action").notNull(), // "approved" | "rejected" | "deferred"
  strategicCall: text("strategic_call").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Zod schemas for validation
export const insertApiConfigSchema = createInsertSchema(apiConfigs);
export const insertClientSchema = createInsertSchema(clients);
export const insertCreativeHubSchema = createInsertSchema(creativeHubs);
export const insertActionLogSchema = createInsertSchema(actionLogs);

export type ApiConfig = typeof apiConfigs.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type CreativeHub = typeof creativeHubs.$inferSelect;
export type ActionLog = typeof actionLogs.$inferSelect;
export type ClientCredential = typeof clientCredentials.$inferSelect;

export interface AnalysisPeriod {
  start: string;
  end: string;
  cadence: string;
}

export interface AccountPulse {
  total_spend_30d: number;
  daily_avg_spend: number;
  latest_daily_spend: number;
  spend_ratio: number;
  spend_status: string;
  spend_trend: string;
  spend_change_pct: number;
  total_leads_30d: number;
  avg_daily_leads: number;
  latest_daily_leads: number;
  leads_trend: string;
  leads_change_pct: number;
  zero_lead_days: number;
  total_impressions: number;
  total_clicks: number;
  total_reach: number;
  overall_ctr: number;
  ctr_trend: string;
  ctr_change_pct: number;
  overall_cpc: number;
  overall_cpm: number;
  overall_cpl: number;
  not_spending_campaigns: string[];
  alerts: string[];
  daily_spends: number[];
  daily_leads: number[];
  daily_ctrs: number[];
}

export interface LayerDiagnostic {
  metric: string;
  status: string;
  value: string | number;
  benchmark: string;
  message: string;
}

export interface LayerAggregate {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpl: number;
  avg_frequency: number;
  campaign_count: number;
}

export interface CostStackLayer {
  aggregate: LayerAggregate | null;
  diagnostics: LayerDiagnostic[];
  campaign_count: number;
}

export interface CostStack {
  funnel_split_actual: Record<string, number>;
  total_spend: number;
  layers: Record<string, CostStackLayer>;
}

export interface CampaignAudit {
  campaign_id: string;
  campaign_name: string;
  layer: string;
  objective: string;
  status: string;
  health_score: number;
  score_breakdown: Record<string, number>;
  score_bands: Record<string, string>;
  classification: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  reach: number;
  leads: number;
  cpl: number;
  daily_budget: number;
  budget_remaining: number;
  budget_utilization_pct: number;
  is_lead_campaign: boolean;
  is_awareness: boolean;
  delivery_status: string;
  learning_status: string;
  campaign_type?: string;
  theme?: string;
  bidding_strategy?: string;
  target_cpa?: number;
  search_impression_share?: number;
  search_rank_lost_is?: number;
  search_budget_lost_is?: number;
  phone_impressions?: number;
  phone_calls?: number;
  ptr?: number;
  cvr?: number;
  tsr?: number;
  vhr?: number;
  audience_type?: string;
  bidding?: string;
  video_views?: number;
  is_dg?: boolean;
}

export interface CreativeHealth {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  adset_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  leads: number;
  cpl: number;
  is_video: boolean;
  thumb_stop_pct: number;
  hold_rate_pct: number;
  first_frame_rate: number;
  video_p25: number;
  video_p50: number;
  video_p75: number;
  video_p100: number;
  avg_watch_sec: number;
  creative_age_days: number | null;
  health_signals: string[];
  creative_score: number;
  scoring_type: string;
  score_breakdown: Record<string, number>;
  score_bands: Record<string, string>;
  classification: string;
  should_pause: boolean;
  auto_pause_reasons: string[];
  status?: string;
  ad_strength?: string;
  headline_performance?: any;
  description_performance?: any;
  kwi_headlines_count?: number;
  expected_ctr?: string;
  format?: string;
  age_days?: number;
  tsr?: number;
  vhr?: number;
  cvr?: number;
}

export interface FatigueAlert {
  type: string;
  severity: string;
  ad_name: string;
  campaign: string;
  layer: string;
  decay_pct: number;
  ctr_before?: number;
  ctr_after?: number;
  message: string;
}

export interface ActivePlaybook {
  playbook: number;
  title: string;
  trigger: string;
  diagnosis: string[];
  actions: string[];
  layer: string;
}

export interface PatternAnalysis {
  top_ads: Array<{ name: string; cpl: number; ctr: number; spend: number; leads: number }>;
  bottom_ads: Array<{ name: string; cpl: number; ctr: number; spend: number; leads: number }>;
  patterns: Array<{ type: string; detail: string }>;
  ad_count: number;
  top_avg: { cpl: number; ctr: number; cpm: number };
  bottom_avg: { cpl: number; ctr: number; cpm: number };
}

export interface RootCause {
  cause: string;
  evidence: string;
  solution: string;
  approval_level: string;
  ice_score: number;
}

export interface Recommendation {
  priority: string;
  category: string;
  action: string;
  detail: string;
  insight?: string;
  impact?: string;
  ice_score: number;
  layer: string;
  root_causes?: RootCause[];
}

export interface BudgetPacing {
  avg_7d_spend: number;
  latest_spend: number;
  spend_anomalies: string[];
  exhausted_budgets: string[];
  under_spending: Array<{ name: string; pace: number; budget: number }>;
  funnel_split_issues: string[];
  daily_spends: number[];
}

export interface MonthlyPacing {
  month: string;
  days_elapsed: number;
  days_remaining: number;
  pct_through_month: number;
  targets: {
    budget: number;
    leads: number;
    cpl: number;
    svs: { low: number; high: number };
    cpsv: { low: number; high: number };
  };
  data_source: string;
  mtd: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    cpc: number;
    cpm: number;
    impressions: number;
    clicks: number;
  };
  expected: { spend: number; leads: number };
  projected_eom: { spend: number; leads: number; cpl: number };
  pacing: {
    spend_pct: number;
    spend_status: string;
    leads_pct: number;
    leads_status: string;
    cpl_status: string;
  };
  daily_needed: { leads: number; spend: number };
  alerts: string[];
}

export interface SopBenchmarks {
  cpm_ideal_low: number;
  cpm_ideal_high: number;
  cpm_alert: number;
  ctr_ideal_low: number;
  ctr_ideal_high: number;
  ctr_alert: number;
  ctr_critical: number;
  cpl_target_low: number;
  cpl_target_high: number;
  cpl_alert: number;
  cpl_critical: number;
  freq_tofu_mofu_warn: number;
  freq_tofu_mofu_severe: number;
  freq_bofu_warn: number;
  freq_bofu_severe: number;
  freq_general_alert: number;
  thumb_stop_target: number;
  thumb_stop_alert: number;
  hold_rate_target: number;
  hold_rate_alert: number;
  creative_max_age_days: number;
  creative_refresh_days: number;
  spend_anomaly_high: number;
  spend_anomaly_low: number;
  budget_scale_max_pct: number;
  [key: string]: number;
}

export interface AnalysisSummary {
  total_campaigns: number;
  total_spend: number;
  total_leads: number;
  avg_cpl: number;
  overall_ctr: number;
  total_fatigue_alerts: number;
  active_playbooks: number;
  total_recommendations: number;
  immediate_actions: number;
}

export interface AnalysisData {
  generated_at: string;
  period: {
    primary_7d: AnalysisPeriod;
    weekly_14d: AnalysisPeriod;
    mtd: AnalysisPeriod;
  };
  sop_benchmarks: SopBenchmarks;
  account_pulse: AccountPulse;
  cost_stack: CostStack;
  campaign_audit: CampaignAudit[];
  creative_health: CreativeHealth[];
  fatigue_alerts: FatigueAlert[];
  active_playbooks: ActivePlaybook[];
  pattern_analysis: PatternAnalysis;
  recommendations: Recommendation[];
  budget_pacing: BudgetPacing;
  monthly_pacing: MonthlyPacing;
  notifications: string[];
  summary: AnalysisSummary;
  adset_analysis: AdsetAnalysis[];
  intellect_insights: IntellectInsight[];
  dynamic_thresholds: DynamicThresholds;
  agent_version: string;
  cadence: string;
  scoring_summary: {
    total_adsets: number;
    winners: number;
    watch: number;
    underperformers: number;
    ad_scores?: {
      auto_pause?: any[];
      [key: string]: any;
    };
    [key: string]: any;
  };
  playbook_names: Record<string, string>;
}

export interface AdsetAnalysis {
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  layer: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  reach: number;
  leads: number;
  cpl: number;
  daily_budget: number;
  budget_utilization_pct: number;
  delivery_status: string;
  learning_status: string;
  health_score: number;
  classification: string; // "WINNER" | "WATCH" | "UNDERPERFORMER" | "NEW"
  score_breakdown: Record<string, number>;
  score_bands: Record<string, string>;
  should_pause: boolean;
  auto_pause_reasons: string[];
  diagnostics: Array<{ metric: string; status: string; value: string | number; benchmark: string; message: string }>;
  status?: string;
  keywords_count?: number;
  cvr?: number;
  qs_avg?: number;
  impression_share?: number;
  top_is_pct?: number;
  rsa_count?: number;
  audience?: string;
  targeting?: string;
  creative_count?: number;
}

export interface IntellectInsight {
  type: string;
  severity: string; // "HIGH" | "MEDIUM" | "LOW"
  entity: string;
  detail: string;
  auto_action: boolean;
}

export interface DynamicThresholds {
  cpl_target: number;
  cpl_alert: number;
  cpl_critical: number;
  cpl_auto_pause: number;
  impressions_no_lead_pause: number;
}

export type RecommendationAction = "approved" | "rejected" | "deferred";

export interface RecommendationActionRecord {
  id: string;
  action: RecommendationAction;
  timestamp: string;
}

// ─── Execution Engine Types ─────────────────────────────────────

export type ExecutionActionType =
  | "PAUSE_AD"
  | "UNPAUSE_AD"
  | "PAUSE_ADSET"
  | "UNPAUSE_ADSET"
  | "PAUSE_CAMPAIGN"
  | "UNPAUSE_CAMPAIGN"
  | "SCALE_BUDGET_UP"
  | "SCALE_BUDGET_DOWN"
  | "SET_BUDGET";

export interface ExecutionResult {
  success: boolean;
  action: ExecutionActionType | string;
  entityId: string;
  entityName: string;
  entityType: string;
  previousValue?: string;
  newValue?: string;
  metaApiResponse?: any;
  error?: string;
  timestamp: string;
  requestedBy: string;
  requestedByName?: string;
  reason?: string;
  strategicCall?: string;
}

export type QuickActionType =
  | "SCALE_WINNERS"
  | "PAUSE_UNDERPERFORMERS"
  | "FIX_LEARNING_LIMITED";

export interface QuickActionRequest {
  actionType: QuickActionType;
  scalePercent?: number;
}
// ─── Bidding Intelligence ───────────────────────────────────────

export const biddingRecommendations = pgTable("bidding_recommendations", {
  id: serial("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  adGroupId: text("ad_group_id"),
  clientId: text("client_id").notNull(),
  campaignName: text("campaign_name").notNull(),
  adGroupName: text("ad_group_name"),
  currentStrategy: text("current_strategy").notNull(), // e.g. "MAXIMIZE_CLICKS", "TARGET_CPA"
  recommendedStrategy: text("recommended_strategy").notNull(),
  currentBidLimit: numeric("current_bid_limit"),
  recommendedBidLimit: numeric("recommended_bid_limit"),
  currentTCPA: numeric("current_tcpa"),
  recommendedTCPA: numeric("recommended_tcpa"),
  avgCpc: numeric("avg_cpc").notNull(),
  ctr: numeric("ctr").notNull(),
  cvr: numeric("cvr").notNull(),
  costPerConversion: numeric("cost_per_conversion").notNull(),
  searchImpressionShare: numeric("search_impression_share"),
  lostIsRank: numeric("lost_is_rank"),
  lostIsBudget: numeric("lost_is_budget"),
  conversions: numeric("conversions").notNull(),
  clicks: numeric("clicks").notNull(),
  confidenceLevel: text("confidence_level").notNull(), // "low" | "medium" | "high"
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pending", "applied", "rejected"] }).notNull().default("pending"),
  strategicRationale: text("strategic_rationale"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBiddingRecommendationSchema = createInsertSchema(biddingRecommendations);
export type BiddingRecommendation = typeof biddingRecommendations.$inferSelect;

export const analysisSnapshots = pgTable("analysis_snapshots", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull(),
  platform: text("platform").notNull(),
  cadence: text("cadence").notNull().default("twice_weekly"),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("uq_analysis_client_platform_cadence").on(t.clientId, t.platform, t.cadence),
]);

export const sessions = pgTable("session", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export type AnalysisSnapshot = typeof analysisSnapshots.$inferSelect;
export type Session = typeof sessions.$inferSelect;

// ─── Managed Auth & Learning Tables ─────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  status: text("status", { enum: ["active", "blocked"] }).notNull().default("active"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const executionLogs = pgTable("execution_logs", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  platform: text("platform").notNull(),
  intent: text("intent").notNull(),
  command: text("command").notNull(),
  actionType: text("action_type").notNull(),
  campaignIds: jsonb("campaign_ids").notNull(),
  rationale: text("rationale"),
  safetyWarnings: text("safety_warnings"),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  requestedBy: text("requested_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const executionOutcomes = pgTable("execution_outcomes", {
  id: text("id").primaryKey(),
  logId: text("log_id").notNull(),
  clientId: text("client_id").notNull(),
  metricType: text("metric_type").notNull(), // cpl, leads, spend
  preValue: numeric("pre_value").notNull(),
  postValue: numeric("post_value"),
  recordedAt: timestamp("recorded_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ExecutionLog = typeof executionLogs.$inferSelect;
export type ExecutionOutcome = typeof executionOutcomes.$inferSelect;

export const performanceAlerts = pgTable("performance_alerts", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull(),
  platform: text("platform").notNull(),
  type: text("type").notNull(),
  entityId: text("entity_id"),
  entityName: text("entity_name"),
  metric: text("metric"),
  severity: text("severity").notNull(), // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  message: text("message").notNull(),
  status: text("status", { enum: ["active", "completed", "rejected"] }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPerformanceAlertSchema = createInsertSchema(performanceAlerts);
export type PerformanceAlert = typeof performanceAlerts.$inferSelect;
