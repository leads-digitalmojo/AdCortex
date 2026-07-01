import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useClient, benchmarksQueryKey } from "@/lib/client-context";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatINR, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Save,
  Loader2,
  SlidersHorizontal,
  Target,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  IndianRupee,
  MousePointerClick,
  Eye,
  MapPin,
  Shield,
  BarChart3,
  TrendingUp,
  FileText,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface Benchmarks {
  // Section 1: Lead & Revenue Targets
  leads: number;
  budget: number;
  cpl: number;
  cpl_max: number;
  svs_low: number;
  svs_high: number;
  cpsv_low: number;
  cpsv_high: number;
  positive_lead_target: number;
  positive_pct_target: number;
  cpql_target: number;

  // Section 2: Engagement Metrics
  tsr_min: number;
  ctr_min: number;
  cvr_min: number;
  cpm_min: number;
  cpm_max: number;
  cpc_max: number;
  vhr_min: number;
  ffr_min: number;
  frequency_max: number;

  // Section 3: Auto-Pause Rules
  auto_pause_cpl_threshold_pct: number;
  auto_pause_zero_leads_impressions: number;

  // Section 4: Location
  target_locations: string[];

  // MTD Deliverables
  svs_mtd: number;
  positive_leads_mtd: number;
  closures_mtd: number;
}

// ─── Section Definitions ────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: "number";
  step?: string;
  help?: string;
  suffix?: string;
}

interface SectionDef {
  id: string;
  title: string;
  icon: typeof Target;
  description: string;
  fields: FieldDef[];
}

const SECTION_1_LEAD_REVENUE: SectionDef = {
  id: "lead-revenue",
  title: "Lead & Revenue Targets",
  icon: Target,
  description: "Monthly lead targets and cost benchmarks — the agent uses these as north stars",
  fields: [
    { key: "leads", label: "Target Leads (monthly)", type: "number", help: "Total leads to generate per month" },
    { key: "budget", label: "Monthly Budget (₹)", type: "number", help: "Total Meta Ads budget for the month" },
    { key: "cpl", label: "CPL Target (₹)", type: "number", help: "Ideal cost per lead — scoring baseline" },
    { key: "cpl_max", label: "CPL Max / Auto-Pause Threshold (₹)", type: "number", help: "Leads above this CPL trigger auto-pause consideration" },
    { key: "svs_low", label: "SV Target (Low)", type: "number", help: "Minimum site visits target per month" },
    { key: "svs_high", label: "SV Target (High)", type: "number", help: "Stretch site visits target per month" },
    { key: "cpsv_low", label: "CPSV Target Low (₹)", type: "number", help: "Cost per site visit — lower bound" },
    { key: "cpsv_high", label: "CPSV Target High (₹)", type: "number", help: "Cost per site visit — upper bound" },
    { key: "positive_lead_target", label: "Positive Lead Target", type: "number", help: "Number of positive/quality leads per month" },
    { key: "positive_pct_target", label: "Positive % Target", type: "number", step: "0.1", help: "Target % of leads that should be positive", suffix: "%" },
    { key: "cpql_target", label: "CPQL Target (₹)", type: "number", help: "Cost per quality lead target" },
  ],
};

const SECTION_2_ENGAGEMENT: SectionDef = {
  id: "engagement",
  title: "Engagement Metric Targets",
  icon: MousePointerClick,
  description: "Creative and engagement benchmarks — used for scoring ads, breakdowns, and audit checks",
  fields: [
    { key: "tsr_min", label: "TSR Target (Thumb Stop Rate)", type: "number", step: "0.1", help: "3s views ÷ impressions — target ≥ 30%", suffix: "%" },
    { key: "ctr_min", label: "CTR Target", type: "number", step: "0.01", help: "Click-through rate target", suffix: "%" },
    { key: "cvr_min", label: "CVR Target", type: "number", step: "0.01", help: "Conversion rate target", suffix: "%" },
    { key: "cpm_min", label: "CPM Ideal Low (₹)", type: "number", help: "Lower bound of ideal CPM range" },
    { key: "cpm_max", label: "CPM Ideal High (₹)", type: "number", help: "Upper bound / alert threshold for CPM" },
    { key: "cpc_max", label: "CPC Target (₹)", type: "number", help: "Ideal cost per click" },
    { key: "vhr_min", label: "VHR Target (Video Hold Rate)", type: "number", step: "0.1", help: "3s→15s retention — target ≥ 25%", suffix: "%" },
    { key: "ffr_min", label: "First Frame Rate Target", type: "number", step: "0.1", help: "Target ≥ 90%", suffix: "%" },
    { key: "frequency_max", label: "Frequency Alert Threshold", type: "number", step: "0.1", help: "Alert when frequency exceeds this (28d)" },
  ],
};

const SECTION_3_AUTOPAUSE: SectionDef = {
  id: "auto-pause",
  title: "Auto-Pause Rules",
  icon: Shield,
  description: "Rules that trigger auto-pause recommendations when thresholds are breached",
  fields: [
    { key: "auto_pause_cpl_threshold_pct", label: "CPL Multiplier (% above target)", type: "number", help: "e.g. 130 = pause at 130% of CPL target", suffix: "%" },
    { key: "auto_pause_zero_leads_impressions", label: "Zero-Lead Impression Threshold", type: "number", help: "If impressions exceed this with 0 leads, flag for pause" },
  ],
};


const MTD_DELIVERABLES: SectionDef = {
  id: "mtd-deliverables",
  title: "MTD Deliverables",
  icon: FileText,
  description: "Enter month-to-date achieved numbers for quality leads, SVs, and closures. Agent calculates everything else from API data.",
  fields: [
    { key: "svs_mtd", label: "SVs Achieved This Month", type: "number", help: "Total site visits achieved MTD" },
    { key: "positive_leads_mtd", label: "Positive Leads Achieved", type: "number", help: "Total quality/positive leads MTD" },
    { key: "closures_mtd", label: "Closures Achieved", type: "number", help: "Total closures/bookings MTD" },
  ],
};

// ─── Google Editable Benchmark Sections ──────────────────────────────

const GOOGLE_LEAD_REVENUE: SectionDef = {
  id: "google-lead-revenue",
  title: "Lead & Revenue Targets (Google)",
  icon: Target,
  description: "Monthly Google Ads targets — used by the agent for pacing and auto-pause decisions",
  fields: [
    { key: "google_leads", label: "Target Leads (monthly)", type: "number", help: "Total Google Ads leads target per month" },
    { key: "google_budget", label: "Monthly Budget (₹)", type: "number", help: "Total Google Ads budget for the month" },
    { key: "google_cpl", label: "CPL Target (₹)", type: "number", help: "Ideal cost per lead for Google" },
    { key: "google_cpl_max", label: "CPL Max (₹)", type: "number", help: "Auto-pause threshold — 1.4× CPL target" },
    { key: "google_svs_low", label: "SV Target (Low)", type: "number", help: "Min site visits target" },
    { key: "google_svs_high", label: "SV Target (High)", type: "number", help: "Stretch site visits target" },
    { key: "google_cpsv_low", label: "CPSV Low (₹)", type: "number", help: "Cost per site visit — lower bound" },
    { key: "google_cpsv_high", label: "CPSV High (₹)", type: "number", help: "Cost per site visit — upper bound" },
    { key: "google_positive_lead_target", label: "Positive Lead Target", type: "number", help: "Quality leads target" },
  ],
};

const GOOGLE_SEARCH_METRICS: SectionDef = {
  id: "google-search-metrics",
  title: "Search Campaign Metrics",
  icon: MousePointerClick,
  description: "Target thresholds for Search campaigns — CTR, CPC, CVR, IS, QS",
  fields: [
    { key: "google_search_ctr_target", label: "CTR Target", type: "number", step: "0.1", help: "Minimum 2%", suffix: "%" },
    { key: "google_search_cpc_max", label: "CPC Max (₹)", type: "number", help: "Maximum cost per click for Search" },
    { key: "google_search_cvr_target", label: "CVR Target", type: "number", step: "0.1", help: "Minimum 3%", suffix: "%" },
    { key: "google_branded_is_target", label: "Branded IS Target", type: "number", step: "1", help: "Target ≥70%", suffix: "%" },
    { key: "google_location_is_target", label: "Location IS Target", type: "number", step: "1", help: "Target ≥20%", suffix: "%" },
    { key: "google_qs_target", label: "QS Target", type: "number", step: "1", help: "Minimum Quality Score 6" },
  ],
};

const GOOGLE_DG_METRICS: SectionDef = {
  id: "google-dg-metrics",
  title: "Demand Gen Metrics",
  icon: Eye,
  description: "Target thresholds for Demand Gen campaigns — CPM, CTR, Frequency, Video",
  fields: [
    { key: "google_dg_cpm_target", label: "CPM Target (₹)", type: "number", help: "~₹150 baseline" },
    { key: "google_dg_ctr_target", label: "CTR Target", type: "number", step: "0.1", help: "0.7-1.2%", suffix: "%" },
    { key: "google_dg_frequency_max", label: "Frequency Max (28d)", type: "number", step: "0.1", help: "Maximum frequency cap" },
    { key: "google_dg_vtr_target", label: "Video View Rate Target", type: "number", step: "0.1", help: "Target video view rate", suffix: "%" },
  ],
};

const GOOGLE_AUTOPAUSE: SectionDef = {
  id: "google-auto-pause",
  title: "Auto-Pause Rules (Google)",
  icon: Shield,
  description: "Rules for auto-pause recommendations on Google campaigns",
  fields: [
    { key: "google_auto_pause_cpl_pct", label: "CPL Threshold (% of target)", type: "number", help: "e.g. 140 = pause at 1.4× CPL", suffix: "%" },
    { key: "google_auto_pause_zero_conv_spend", label: "Zero-Conv Spend Threshold (₹)", type: "number", help: "Pause keywords with no conversions above this spend" },
    { key: "google_auto_pause_min_impressions", label: "Min Impressions Before Pause", type: "number", help: "Minimum impressions before evaluating for pause" },
  ],
};


const GOOGLE_MTD: SectionDef = {
  id: "google-mtd",
  title: "MTD Deliverables (Google)",
  icon: FileText,
  description: "Enter month-to-date Google Ads numbers",
  fields: [
    { key: "google_svs_mtd", label: "SVs Achieved This Month", type: "number" },
    { key: "google_positive_leads_mtd", label: "Positive Leads Achieved", type: "number" },
    { key: "google_closures_mtd", label: "Closures Achieved", type: "number" },
  ],
};

// ─── Google Benchmark Targets ────────────────────────────────────────

const GOOGLE_TARGETS: Record<string, { label: string; metrics: Array<{ key: string; label: string; target: string; format: "pct" | "inr" | "num" }> }> = {
  branded: {
    label: "Branded Search",
    metrics: [
      { key: "ctr", label: "CTR", target: "15–20%", format: "pct" },
      { key: "cvr", label: "CVR", target: "6–8%", format: "pct" },
      { key: "impression_share", label: "Impression Share", target: "≥70%", format: "pct" },
      { key: "avg_cpc", label: "Avg CPC", target: "—", format: "inr" },
      { key: "cpl", label: "CPL", target: "—", format: "inr" },
      { key: "quality_score", label: "Avg QS", target: "≥7", format: "num" },
    ],
  },
  location: {
    label: "Location Search",
    metrics: [
      { key: "ctr", label: "CTR", target: "5–10%", format: "pct" },
      { key: "cvr", label: "CVR", target: "3–5%", format: "pct" },
      { key: "impression_share", label: "Impression Share", target: "≥20%", format: "pct" },
      { key: "avg_cpc", label: "Avg CPC", target: "—", format: "inr" },
      { key: "cpl", label: "CPL", target: "—", format: "inr" },
      { key: "quality_score", label: "Avg QS", target: "≥6", format: "num" },
    ],
  },
  demand_gen: {
    label: "Demand Gen",
    metrics: [
      { key: "ctr", label: "CTR", target: "0.5–1%", format: "pct" },
      { key: "cpm", label: "CPM", target: "≤₹120", format: "inr" },
      { key: "cpm_alert", label: "CPM Alert", target: "₹200", format: "inr" },
      { key: "frequency_7d", label: "Frequency (7d)", target: "≤4", format: "num" },
      { key: "cpl", label: "CPL", target: "—", format: "inr" },
      { key: "tsr", label: "TSR", target: "≥25%", format: "pct" },
    ],
  },
};

function statusIcon(status: "good" | "warn" | "bad" | "na") {
  switch (status) {
    case "good":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "warn":
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
    case "bad":
      return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    default:
      return <span className="w-3.5 h-3.5 text-muted-foreground">—</span>;
  }
}

function evaluateMetric(key: string, value: number | undefined, campaignType: string): "good" | "warn" | "bad" | "na" {
  if (value == null || isNaN(value)) return "na";

  if (campaignType === "branded") {
    if (key === "ctr") return value >= 15 ? "good" : value >= 10 ? "warn" : "bad";
    if (key === "cvr") return value >= 6 ? "good" : value >= 4 ? "warn" : "bad";
    if (key === "impression_share") return value >= 70 ? "good" : value >= 50 ? "warn" : "bad";
    if (key === "quality_score") return value >= 7 ? "good" : value >= 5 ? "warn" : "bad";
  }
  if (campaignType === "location") {
    if (key === "ctr") return value >= 5 ? "good" : value >= 3 ? "warn" : "bad";
    if (key === "cvr") return value >= 3 ? "good" : value >= 2 ? "warn" : "bad";
    if (key === "impression_share") return value >= 20 ? "good" : value >= 10 ? "warn" : "bad";
    if (key === "quality_score") return value >= 6 ? "good" : value >= 4 ? "warn" : "bad";
  }
  if (campaignType === "demand_gen") {
    if (key === "ctr") return value >= 0.5 ? "good" : value >= 0.3 ? "warn" : "bad";
    if (key === "cpm") return value <= 120 ? "good" : value <= 200 ? "warn" : "bad";
    if (key === "cpm_alert") return value <= 200 ? "good" : "bad";
    if (key === "frequency_7d") return value <= 4 ? "good" : value <= 6 ? "warn" : "bad";
    if (key === "tsr") return value >= 25 ? "good" : value >= 15 ? "warn" : "bad";
  }
  return "na";
}

function formatMetricValue(value: number | undefined, format: "pct" | "inr" | "num"): string {
  if (value == null || isNaN(value)) return "—";
  switch (format) {
    case "pct":
      return formatPct(value);
    case "inr":
      return formatINR(value, 0);
    case "num":
      return value.toFixed(1);
  }
}

// ─── Google Benchmarks Component ─────────────────────────────────────

function GoogleBenchmarks() {
  const { analysisData: data, isLoadingAnalysis, activeClientId, benchmarks, isLoadingBenchmarks } = useClient();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState<"targets" | "actuals" | "mtd">("targets");

  const isBenchmarksLoading = isLoadingBenchmarks;

  useEffect(() => {
    if (benchmarks) {
      setForm(benchmarks);
    }
  }, [benchmarks]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      await apiRequest("PUT", `/api/clients/${activeClientId}/benchmarks?platform=google`, payload);
    },
    onSuccess: () => {
      // Invalidate the canonical key — propagates to dashboard, campaigns, adsets, MTD
      queryClient.invalidateQueries({ queryKey: benchmarksQueryKey(activeClientId, "google") });
      // Invalidate analysis data so health scores recalculate immediately
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${activeClientId}/google`, "analysis"] });
      toast({ title: "Google Benchmarks Saved", description: "Health scores updated instantly on dashboard." });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  function handleFieldChange(key: string, value: string) {
    const parts = key.split(".");
    if (parts.length === 1) {
      setForm((prev) => ({ ...prev, [key]: value === "" ? 0 : Number(value) }));
    } else {
      setForm((prev) => {
        const obj = { ...(prev[parts[0]] || {}) };
        obj[parts[1]] = value === "" ? 0 : Number(value);
        return { ...prev, [parts[0]]: obj };
      });
    }
  }

  function handleSave() {
    saveMutation.mutate(form);
  }

  // ─── Actuals vs Targets computation (existing logic) ─────────
  const campaigns = useMemo(() => {
    if (!data) return [];
    const all = (data as any).campaigns || [];
    return all.filter((c: any) => c.status?.toUpperCase() === "ENABLED" || c.status?.toUpperCase() === "ACTIVE");
  }, [data]);

  const campaignsByType = useMemo(() => {
    const grouped: Record<string, any[]> = { branded: [], location: [], demand_gen: [] };
    for (const c of campaigns) {
      const t = c.campaign_type || c.type || "";
      if (t in grouped) grouped[t].push(c);
    }
    return grouped;
  }, [campaigns]);

  const actuals = useMemo(() => {
    const result: Record<string, Record<string, number | undefined>> = {};
    for (const [type, camps] of Object.entries(campaignsByType)) {
      if (camps.length === 0) { result[type] = {}; continue; }
      let totalImpr = 0, totalClicks = 0, totalCost = 0, totalConv = 0, totalQS = 0, qsCount = 0;
      for (const c of camps) {
        totalImpr += c.impressions || 0;
        totalClicks += c.clicks || 0;
        totalCost += c.cost || c.spend || 0;
        totalConv += c.conversions || 0;
        if (c.avg_quality_score || c.quality_score) { totalQS += c.avg_quality_score || c.quality_score || 0; qsCount++; }
      }
      result[type] = {
        ctr: totalImpr > 0 ? (totalClicks / totalImpr) * 100 : undefined,
        cvr: totalClicks > 0 ? (totalConv / totalClicks) * 100 : undefined,
        cpl: totalConv > 0 ? totalCost / totalConv : undefined,
        avg_cpc: totalClicks > 0 ? totalCost / totalClicks : undefined,
        cpm: totalImpr > 0 ? (totalCost / totalImpr) * 1000 : undefined,
        quality_score: qsCount > 0 ? totalQS / qsCount : undefined,
        impression_share: camps[0]?.search_impression_share || camps[0]?.impression_share,
        frequency_7d: camps[0]?.frequency_7d || camps[0]?.frequency,
        tsr: camps[0]?.tsr,
      };
    }
    return result;
  }, [campaignsByType]);

  if (isLoadingAnalysis || isBenchmarksLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1000px]">
      {/* Tab toggle */}
      <div className="flex items-center gap-1 border-b border-border/50 pb-px">
        <button className={cn("px-4 py-2 text-xs font-medium transition-colors border-b-2", activeTab === "targets" ? "text-primary border-primary bg-primary/5" : "text-muted-foreground border-transparent hover:text-foreground")} onClick={() => setActiveTab("targets")}>
          <Target className="w-3.5 h-3.5 inline mr-1.5" />Targets & Thresholds
        </button>
        <button className={cn("px-4 py-2 text-xs font-medium transition-colors border-b-2", activeTab === "actuals" ? "text-primary border-primary bg-primary/5" : "text-muted-foreground border-transparent hover:text-foreground")} onClick={() => setActiveTab("actuals")}>
          <BarChart3 className="w-3.5 h-3.5 inline mr-1.5" />Actuals vs Targets
        </button>
      </div>

      {activeTab === "targets" && (
        <>
          <EditableSection section={GOOGLE_LEAD_REVENUE} form={form} onFieldChange={handleFieldChange} />
          <EditableSection section={GOOGLE_SEARCH_METRICS} form={form} onFieldChange={handleFieldChange} />
          <EditableSection section={GOOGLE_DG_METRICS} form={form} onFieldChange={handleFieldChange} />
          <EditableSection section={GOOGLE_AUTOPAUSE} form={form} onFieldChange={handleFieldChange} />
        </>
      )}

      {activeTab === "actuals" && (
        <>
          {Object.entries(GOOGLE_TARGETS).map(([type, config]) => {
            const typeActuals = actuals[type] || {};
            const typeCampaigns = campaignsByType[type] || [];
            const hasCampaigns = typeCampaigns.length > 0;
            return (
              <Card key={type}>
                <CardHeader className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-[#F0BC00]" />
                      <CardTitle className="text-base font-medium">{config.label}</CardTitle>
                    </div>
                    <Badge variant="outline" className={cn("text-xs", hasCampaigns ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-muted/50 text-muted-foreground border-border")}>{typeCampaigns.length} campaign{typeCampaigns.length !== 1 ? "s" : ""}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0">
                  {!hasCampaigns ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No active {config.label.toLowerCase()} campaigns</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="t-table w-full">
                        <thead><tr className="border-b border-border/50">
                          <th className="text-left py-4 px-4 t-label font-bold uppercase tracking-widest text-muted-foreground">Metric</th>
                          <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Target</th>
                          <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Actual</th>
                          <th className="text-center py-2 pl-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                        </tr></thead>
                        <tbody>
                          {config.metrics.map((metric) => {
                            const actual = typeActuals[metric.key];
                            const status = evaluateMetric(metric.key, actual, type);
                            return (
                              <tr key={metric.key} className="border-b border-border/30 hover:bg-muted/30">
                                <td className="py-2 pr-3 text-foreground font-medium">{metric.label}</td>
                                <td className="py-2 px-3 text-right text-muted-foreground tabular-nums">{metric.target}</td>
                                <td className={cn("py-2 px-3 text-right tabular-nums font-medium", status === "good" ? "text-emerald-400" : status === "warn" ? "text-amber-400" : status === "bad" ? "text-red-400" : "text-muted-foreground")}>{formatMetricValue(actual, metric.format)}</td>
                                <td className="py-2 pl-3 text-center">{statusIcon(status)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}



      {/* Save Button */}
      {isAdmin ? (
        <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2" onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Google Benchmarks
        </Button>
      ) : (
        <div className="p-3 rounded-lg bg-muted/30 border border-border/30 flex items-center justify-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Benchmarks are read-only for standard users</span>
        </div>
      )}

      {/* Info card */}
      <Card className="bg-muted/20 border-border/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Branded Search:</strong> CTR 15–20%, CVR 6–8%, IS ≥70%, QS ≥7</p>
            <p><strong>Location Search:</strong> CTR 5–10%, CVR 3–5%, IS ≥20%, QS ≥6</p>
            <p><strong>Demand Gen:</strong> CPM ~₹150, CTR 0.7–1.2%, Frequency cap 28d</p>
            <p><strong>Active Thresholds:</strong> Benchmarks act as the active baseline for scoring. They directly drive CPL coloring, auto-pause rules, breakdown intelligence, MTD alerts, and recommendation severity.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Editable Section Component ─────────────────────────────────────

function EditableSection({
  section,
  form,
  onFieldChange,
}: {
  section: SectionDef;
  form: Record<string, any>;
  onFieldChange: (key: string, value: string) => void;
}) {
  const Icon = section.icon;

  // Resolve nested key values (e.g. "video_scoring_weights.cpl")
  function getNestedValue(key: string): any {
    const parts = key.split(".");
    let val: any = form;
    for (const p of parts) {
      val = val?.[p];
    }
    return val ?? "";
  }

  return (
    <Card data-testid={`section-${section.id}`}>
      <CardHeader className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          <CardTitle className="text-base font-medium">{section.title}</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{section.description}</p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {section.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {field.label}
                {field.suffix && <span className="text-xs text-muted-foreground">({field.suffix})</span>}
              </label>
              <Input
                type={field.type}
                step={field.step}
                value={getNestedValue(field.key)}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                className="h-8 text-base bg-muted/30"
                data-testid={`input-${field.key.replace(/\./g, "-")}`}
              />
              {field.help && (
                <p className="text-xs text-muted-foreground">{field.help}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Meta Benchmarks Component (restructured) ───────────────────────

function MetaBenchmarks() {
  const { activeClientId, benchmarks, isLoadingBenchmarks } = useClient();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, any>>({});
  const [locations, setLocations] = useState("");
  const [activeTab, setActiveTab] = useState<"targets" | "mtd">("targets");

  useEffect(() => {
    if (benchmarks) {
      setForm(benchmarks);
      setLocations(((benchmarks as any).target_locations || []).join(", "));
    }
  }, [benchmarks]);

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      await apiRequest("PUT", `/api/clients/${activeClientId}/benchmarks?platform=meta`, data);
    },
    onSuccess: () => {
      // Invalidate canonical key — propagates to dashboard, campaigns, adsets, MTD
      queryClient.invalidateQueries({ queryKey: benchmarksQueryKey(activeClientId, "meta") });
      // Invalidate analysis data so health scores recalculate immediately
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${activeClientId}/meta`, "analysis"] });
      toast({ title: "Benchmarks Saved", description: "Health scores updated instantly on dashboard." });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  function handleFieldChange(key: string, value: string) {
    const parts = key.split(".");
    if (parts.length === 1) {
      setForm((prev) => ({ ...prev, [key]: value === "" ? 0 : Number(value) }));
    } else {
      setForm((prev) => {
        const obj = { ...(prev[parts[0]] || {}) };
        obj[parts[1]] = value === "" ? 0 : Number(value);
        return { ...prev, [parts[0]]: obj };
      });
    }
  }

  function handleSave() {
    const payload = {
      ...form,
      target_locations: locations.split(",").map((s) => s.trim()).filter(Boolean),
    };
    saveMutation.mutate(payload);
  }

  if (isLoadingBenchmarks) {
    return (
      <div>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1000px]">
      {/* Tab toggle: Targets vs MTD Deliverables */}
      <div className="flex items-center gap-1 border-b border-border/50 pb-px">
        <button
          className={cn(
            "px-4 py-2 text-xs font-medium transition-colors border-b-2",
            activeTab === "targets"
              ? "text-primary border-primary bg-primary/5"
              : "text-muted-foreground border-transparent hover:text-foreground"
          )}
          onClick={() => setActiveTab("targets")}
        >
          <Target className="w-3.5 h-3.5 inline mr-1.5" />
          Targets & Thresholds
        </button>
      </div>

      {activeTab === "targets" && (
        <>
          {/* Section 1: Lead & Revenue Targets */}
          <EditableSection
            section={SECTION_1_LEAD_REVENUE}
            form={form}
            onFieldChange={handleFieldChange}
          />

          {/* Section 2: Engagement Metric Targets */}
          <EditableSection
            section={SECTION_2_ENGAGEMENT}
            form={form}
            onFieldChange={handleFieldChange}
          />

          {/* Section 3: Auto-Pause Rules */}
          <EditableSection
            section={SECTION_3_AUTOPAUSE}
            form={form}
            onFieldChange={handleFieldChange}
          />

          {/* Section 4: Target Location */}
          <Card data-testid="section-location">
            <CardHeader className="px-4 py-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <CardTitle className="text-base font-medium">Target Location</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Locations used for geo-spend alerts and breakdown flagging
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Locations (comma-separated)</label>
                <Input
                  type="text"
                  value={locations}
                  onChange={(e) => setLocations(e.target.value)}
                  placeholder="Hyderabad, Secunderabad, Nallagandla"
                  className="h-8 text-base bg-muted/30"
                  data-testid="input-target-locations"
                />
                <p className="text-xs text-muted-foreground">
                  Used for geo-breakdown alerts. Spend outside these locations will be flagged.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}


      {/* Save Button */}
      {isAdmin ? (
        <Button
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          data-testid="button-save-benchmarks"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save All Benchmarks
        </Button>
      ) : (
        <div className="p-3 rounded-lg bg-muted/30 border border-border/30 flex items-center justify-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Benchmarks are read-only for standard users</span>
        </div>
      )}

      {/* Info card */}
      <Card className="bg-muted/20 border-border/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Active Thresholds:</strong> Benchmarks act as the active baseline for scoring across Dashboard, Campaigns, Adsets, and MTD modules — changes apply instantly.</p>
            <p><strong>Agent Integration:</strong> Benchmarks directly drive CPL coloring, auto-pause rules, breakdown intelligence, MTD alerts, and recommendation logic.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function BenchmarksPage() {
  const { activePlatform } = useClient();
  const isGoogle = activePlatform === "google";

  return (
    <div className="p-6 space-y-6 max-w-[1200px]">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15">
          <SlidersHorizontal className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="t-page-title text-foreground">
            {isGoogle ? "Google Ads Benchmarks" : "Benchmarks & Targets"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isGoogle
              ? "Actual performance vs industry targets by campaign type"
              : "Configure performance thresholds — the agent reads these as north stars on every run"}
          </p>
        </div>
      </div>

      {isGoogle ? <GoogleBenchmarks /> : <MetaBenchmarks />}
    </div>
  );
}
