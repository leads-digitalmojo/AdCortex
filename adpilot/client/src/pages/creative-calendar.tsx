import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CalendarClock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Clock,
  TrendingDown,
  ArrowRight,
  Pause,
  Sparkles,
} from "lucide-react";
import {
  formatINR,
  formatPct,
  formatNumber,
  truncate,
  getHealthBgColor,
  getHealthBarBg,
} from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { UnifiedActions } from "@/components/unified-actions";

// ─── Types ───────────────────────────────────────────────────────

interface CreativeEntry {
  id: string;
  name: string;
  campaign_name: string;
  adset_name: string;
  age_days: number | null;
  creative_score: number | null;
  performance_score: number | null;
  age_score: number | null;
  ctr: number;
  cpm: number;
  cpl: number;
  health_signals: string[];
  spend: number;
  impressions: number;
  leads: number;
  frequency: number;
  is_video: boolean;
  thumb_stop_pct: number;
  hold_rate_pct: number;
  source: "meta" | "google";
  campaign_type?: string;
  classification?: string;
}

type FatigueLevel = "green" | "yellow" | "orange" | "red";

// ─── Updated age thresholds: green <= 30, yellow 31-35, orange 36-44, red >= 45 ───
function getAgeColor(ageDays: number, performanceScore: number | null): FatigueLevel {
  // Override: if performance_score >= 70, show green regardless of age
  if (performanceScore !== null && performanceScore >= 70) return "green";

  if (ageDays <= 30) return "green";
  if (ageDays <= 35) return "yellow";
  if (ageDays < 45) return "orange";
  return "red";
}

function getAgeColorClasses(level: FatigueLevel): { bg: string; border: string; text: string } {
  switch (level) {
    case "green":
      return { bg: "bg-emerald-500", border: "border-emerald-500/30", text: "text-emerald-400" };
    case "yellow":
      return { bg: "bg-yellow-500", border: "border-yellow-500/30", text: "text-yellow-400" };
    case "orange":
      return { bg: "bg-orange-500", border: "border-orange-500/30", text: "text-orange-400" };
    case "red":
      return { bg: "bg-red-500", border: "border-red-500/30", text: "text-red-400" };
  }
}

function getAgeBadgeClasses(level: FatigueLevel): string {
  switch (level) {
    case "green":
      return "text-emerald-600 bg-emerald-500/15 font-semibold";
    case "yellow":
      return "text-amber-600 bg-amber-500/15 font-semibold";
    case "orange":
      return "text-orange-600 bg-orange-500/15 font-semibold";
    case "red":
      return "text-red-600 bg-red-500/15 font-semibold";
  }
}

// Local recommendation engine removed. Insights are now globally managed by the 4-layer pipeline.

// ─── Component ───────────────────────────────────────────────────

export default function CreativeCalendarPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, benchmarks, activePlatform, activeClientId, activeClient, apiBase } = useClient();
  const { toast } = useToast();
  const isGoogle = activePlatform === "google";

  const { data: mtdData } = useQuery<{
    spend: number;
    leads: number;
    svs: number;
    qualified_leads: number;
    closures: number;
    cpl: number;
    cpql: number;
    cpsv: number;
  }>({
    queryKey: ["/api/mtd-deliverables", activeClientId, activePlatform],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mtd-deliverables?client_id=${activeClientId}&platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  const [refreshedIds, setRefreshedIds] = useState<Set<string>>(new Set());

  const targetCpl = activeClient?.targets?.[activePlatform]?.cpl || (data as any)?.dynamic_thresholds?.cpl_target || 800;

  const { data: pipelineData } = useQuery<{ insights: any[] }>({
    queryKey: ["/api/intelligence", activeClientId, activePlatform, "insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/intelligence/${activeClientId}/${activePlatform}/insights`);
      return res.json();
    },
    enabled: !!activeClientId && !!activePlatform,
  });

  const creativeInsights = useMemo(() => {
    return pipelineData?.insights?.filter(i => i.entityType === "ad") || [];
  }, [pipelineData]);

  // Fallback for older Google agent data or if creative_health missing
  const creatives = useMemo<CreativeEntry[]>(() => {
    if (!data) return [];
    const results: CreativeEntry[] = [];
    const creativeHealth = (data as any).creative_health || [];

    if (creativeHealth.length > 0) {
      for (const c of creativeHealth) {
        results.push({
          id: c.ad_id || c.id,
          name: c.ad_name || c.name || `Ad ${c.ad_id || ""}`,
          campaign_name: c.campaign_name || "",
          adset_name: c.adset_name || c.ad_group_name || "",
          age_days: c.creative_age_days ?? c.age_days ?? null,
          creative_score: c.creative_score ?? null,
          performance_score: c.performance_score ?? null,
          age_score: c.age_score ?? null,
          ctr: c.ctr || 0,
          cpm: c.cpm || 0,
          cpl: c.cpl || 0,
          health_signals: c.health_signals || [],
          spend: c.spend || 0,
          impressions: c.impressions || 0,
          leads: c.leads || c.conversions || 0,
          frequency: c.frequency || 0,
          is_video: !!c.is_video,
          thumb_stop_pct: c.thumb_stop_pct || 0,
          hold_rate_pct: c.hold_rate_pct || 0,
          source: isGoogle ? "google" : "meta",
          classification: c.classification,
        });
      }
    }
    return results;
  }, [data, isGoogle]);

  const refreshQueueItems = useMemo(() => {
    return creativeInsights.map(ins => {
      const creative = creatives.find(c => c.id === ins.entityId);
      if (!creative) return null;
      return { insight: ins, creative };
    }).filter(Boolean);
  }, [creativeInsights, creatives]);

  const timelineCreatives = useMemo(() => {
    return creatives
      .filter((c) => c.age_days !== null)
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));
  }, [creatives]);

  const maxAge = useMemo(() => {
    const ages = timelineCreatives.map((c) => c.age_days ?? 0);
    return Math.max(60, ...ages);
  }, [timelineCreatives]);

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-40 rounded-md" />
        <Skeleton className="h-[400px] rounded-md" />
      </div>
    );
  }

  // ─── MTD Calculations ─────────────────────────────────────────
  const mtdSpend = mtdData?.spend || 0;
  const mtdLeads = mtdData?.leads || 0;
  const mtdQL = mtdData?.qualified_leads || 0;
  const mtdSV = mtdData?.svs || 0;

  const mtdCpl = mtdData?.cpl || (mtdLeads > 0 ? mtdSpend / mtdLeads : 0);
  const mtdCpql = mtdData?.cpql || (mtdQL > 0 ? mtdSpend / mtdQL : 0);
  const mtdCpsv = mtdData?.cpsv || (mtdSV > 0 ? mtdSpend / mtdSV : 0);

  const posPct = mtdLeads > 0 ? (mtdQL / mtdLeads) * 100 : 0;
  const svPct = mtdLeads > 0 ? (mtdSV / mtdLeads) * 100 : 0;

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h1 className="text-base font-semibold text-foreground tracking-[0.5px]">Creative Rotation Calendar</h1>
          </div>
          <p className="text-base text-muted-foreground">
            {creatives.length} creatives tracked · {timelineCreatives.length} with age data · Thresholds: &le;30d green, 31-35d yellow, 36-44d orange, &ge;45d red
          </p>
        </div>

        {/* ─── MTD Performance Snapshot ─── */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-[#ffc61a]/100 backdrop-blur-sm">
            <p className="text-sm font-semibold text-black uppercase tracking-wider mb-0.5">MTD Spend</p>
            <p className="text-base font-bold tabular-nums">{formatINR(mtdSpend, 0)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-[#ffc61a]/100 backdrop-blur-sm">
            <p className="text-sm font-semibold text-black uppercase tracking-wider mb-0.5">MTD Leads</p>
            <p className="text-base font-bold tabular-nums">{formatNumber(mtdLeads)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-[#ffc61a]/100 backdrop-blur-sm">
            <p className="text-sm font-semibold text-black uppercase tracking-wider mb-0.5">CPL</p>
            <p className="text-base font-bold tabular-nums text-primary">{formatINR(mtdCpl, 0)}</p>
          </div>
        </div>
      </div>

      {/* ─── Creative Efficiency Grid ────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Existing health summary stats moved into this grid for compactness */}
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold text-black uppercase tracking-wider">Fresh (&le;30d)</p>
            <p className="text-base font-bold tabular-nums text-emerald-600">
              {timelineCreatives.filter(c => (c.age_days ?? 0) <= 30).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Active rotation</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold text-black uppercase tracking-wider">Aging (31–44d)</p>
            <p className="text-base font-bold tabular-nums text-amber-600">
              {timelineCreatives.filter(c => (c.age_days ?? 0) > 30 && (c.age_days ?? 0) < 45).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Watch for fatigue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold text-black uppercase tracking-wider">Stale (&ge;45d)</p>
            <p className="text-base font-bold tabular-nums text-red-600">
              {timelineCreatives.filter(c => (c.age_days ?? 0) >= 45).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Needs refresh</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Refresh Queue ─────────────────────────────────────────── */}
      {refreshQueueItems.length > 0 && (
        <Card className="border-orange-500/30">
          <CardHeader className="pb-2 px-4 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <CardTitle className="text-base font-medium text-red-400 tracking-[0.1px]">
                  Pipeline Creative Alerts — {refreshQueueItems.length} Detected
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="space-y-4">
              {refreshQueueItems.map(({ insight: ins, creative: c }: any, idx: number) => {
                const ageLevel = getAgeColor(c.age_days!, c.creative_score);
                const ageClasses = getAgeBadgeClasses(ageLevel);
                return (
                  <div
                    key={idx}
                    className="p-4 rounded-md bg-muted/30 border border-border/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-base font-medium text-foreground truncate max-w-[240px] block tracking-[0.3px]">
                            {truncate(c.name, 40)}
                          </span>
                          <Badge variant="secondary" className={cn("text-base px-1.5 py-0 shrink-0", ageClasses)}>
                            {c.age_days}d old
                          </Badge>
                          <Badge variant="outline" className={cn(
                            "text-base px-1.5 py-0 shrink-0",
                            ins.priority === "CRITICAL" ? "bg-red-50 border-red-200 text-red-600 font-semibold" : "bg-amber-50 border-amber-200 text-amber-600 font-semibold"
                          )}>
                            {ins.priority}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-base text-muted-foreground mt-3 mb-3 tracking-[0.3px]">
                          <span>CTR: <span className="font-bold text-black">{formatPct(c.ctr)}</span></span>
                          <span>Spend: <span className="font-bold text-black">{formatINR(c.spend, 0)}</span></span>
                          <span>Leads: <span className="font-bold text-black">{c.leads}</span></span>
                        </div>
                        <p className="text-base font-semibold text-foreground mt-4 mb-2 tracking-[0.3px]">
                          {ins.issue}: {ins.impact}
                        </p>
                        <p className="text-base text-emerald-600 font-bold leading-relaxed tracking-[0.3px]">
                          Recommendation: {ins.recommendation}
                        </p>
                      </div>
                    </div>
                    {/* Unified Actions */}
                    <div className="mt-4 pt-3 border-t border-border/20">
                      <UnifiedActions
                        entityId={c.id}
                        entityName={c.name}
                        entityType="ad"
                        actionType={ins.priority === "CRITICAL" ? "PAUSE_AD" : "CREATIVE_REFRESH"}
                        isAutoExecutable={ins.priority === "CRITICAL"}
                        recommendation={ins.recommendation}
                        currentMetrics={{ spend: c.spend, leads: c.leads, cpl: c.cpl, ctr: c.ctr }}
                        compact
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {refreshQueueItems.length === 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-base font-medium tracking-[0.3px]">All creatives are within rotation window — no refresh needed</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Visual Timeline ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium tracking-[0.1px]">Creative Age Timeline</CardTitle>
            <div className="flex items-center gap-3 font-semibold text-black">
              <span className="flex items-center gap-1 tracking-[0.8px]">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                &le;30d
              </span>
              <span className="flex items-center gap-1 tracking-[0.8px]">
                <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500 inline-block" />
                30–35d
              </span>
              <span className="flex items-center gap-1 tracking-[0.8px]">
                <span className="w-2.5 h-2.5 rounded-sm bg-orange-500 inline-block" />
                36–44d
              </span>
              <span className="flex items-center gap-1 tracking-[0.8px]">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
                &ge;45d
              </span>
              <span className="flex items-center gap-1 text-emerald-600 tracking-[0.5px]">
                Score &ge;70 = green
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {timelineCreatives.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-base text-muted-foreground">
              No creative age data available
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* Day markers */}
              <div className="flex items-center gap-0 ml-[226px] mb-2">
                <div className="relative w-full h-4">
                  {[0, 15, 30, 45, 60].filter(d => d < maxAge - 10).map((day) => (
                    <span
                      key={day}
                      className="absolute text-sm font-bold text-black tracking-[0.5px] -translate-x-1/2"
                      style={{ left: `${(day / maxAge) * 100}%` }}
                    >
                      {day}d
                    </span>
                  ))}
                  <span
                    className="absolute text-sm font-bold text-black tracking-[0.5px] right-0"
                  >
                    {maxAge}d
                  </span>
                </div>
              </div>

              {/* Reference lines at 30d and 45d */}
              <div className="relative ml-[220px] h-0">
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-yellow-500/40 z-10"
                  style={{ left: `${(30 / maxAge) * 100}%`, height: `${timelineCreatives.length * 36 + 10}px` }}
                />
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-red-500/40 z-10"
                  style={{ left: `${(45 / maxAge) * 100}%`, height: `${timelineCreatives.length * 36 + 10}px` }}
                />
              </div>

              {/* Creative bars */}
              {timelineCreatives.map((c) => {
                const ageDays = c.age_days ?? 0;
                const barWidth = Math.min((ageDays / maxAge) * 100, 100);
                const ageLevel = getAgeColor(ageDays, c.creative_score);
                const colorClasses = getAgeColorClasses(ageLevel);
                const isPerformingWell = c.creative_score !== null && c.creative_score >= 70;
                const isRefreshed = refreshedIds.has(c.id);

                const hasCtrDecline = c.health_signals.some(s =>
                  s.toLowerCase().includes("ctr") && (s.toLowerCase().includes("declin") || s.toLowerCase().includes("drop"))
                );
                const hasSevereFatigue = c.health_signals.some(s =>
                  s.toLowerCase().includes("fatigue") || s.toLowerCase().includes("exhaust")
                );

                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 h-8 ${isRefreshed ? "opacity-40" : ""}`}
                  >
                    {/* Creative name */}
                    <div className="w-[210px] shrink-0 flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm text-foreground truncate block max-w-[180px]">
                            {truncate(c.name, 28)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs">
                          <div className="text-base space-y-1">
                            <p className="font-medium">{c.name}</p>
                            <p className="text-muted-foreground">{c.campaign_name}</p>
                            <p>Score: {c.creative_score ?? "—"} · CTR: {formatPct(c.ctr)} · CPM: {formatINR(c.cpm, 0)}</p>
                            {c.health_signals.length > 0 && (
                              <div className="pt-1 border-t border-border/30">
                                {c.health_signals.map((s, i) => (
                                  <p key={i} className="text-xs">{s}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      {c.performance_score !== null && c.performance_score >= 70 && ageDays > 30 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary" className="text-xs px-2 py-0 text-emerald-600 bg-emerald-500/15 font-bold shrink-0 tracking-[0.5px]">
                              HIGH_PERF
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-base">High Performance (score {c.performance_score}) — Override aging fatigue</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    {/* Bar */}
                    <div className="flex-1 relative h-5">
                      <div className="absolute inset-0 bg-muted/20 rounded-sm" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={`absolute left-0 top-0 h-full rounded-sm ${colorClasses.bg} opacity-70 transition-all cursor-default`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div className="text-base space-y-0.5">
                            <p className="font-medium">{c.name}</p>
                            <p>Age: {ageDays} days</p>
                            <p>CTR: {formatPct(c.ctr)} · CPM: {formatINR(c.cpm, 0)}</p>
                            {c.creative_score !== null && <p>Score: {c.creative_score}{isPerformingWell ? " (Performing Well)" : ""}</p>}
                          </div>
                        </TooltipContent>
                      </Tooltip>

                      {/* Score badge on bar */}
                      {c.creative_score !== null && (
                        <div
                          className="absolute inset-y-0 flex items-center justify-end font-bold text-white z-20 pointer-events-none tracking-[0.5px]"
                          style={{ width: `${barWidth}%`, paddingRight: '8px' }}
                        >
                          <span className="text-xs">{Math.round(c.creative_score)}</span>
                        </div>
                      )}

                      {/* Fatigue warning */}
                      {(hasCtrDecline || hasSevereFatigue) && (
                        <div
                          className="absolute top-0.5 right-1 z-20"
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <TrendingDown className={`w-3.5 h-3.5 ${hasSevereFatigue ? "text-red-400" : "text-amber-400"}`} />
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <p className="text-base">
                                {hasSevereFatigue ? "Severe fatigue detected" : "CTR declining — potential fatigue"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>

                    {/* Age label */}
                    <span className={`text-base font-bold tracking-[0.5px] tabular-nums w-10 text-right shrink-0 ${colorClasses.text}`}>
                      {ageDays}d
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Summary Stats (updated thresholds) ────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold text-black uppercase tracking-wider">Total Creatives</p>
            <p className="text-base font-bold tabular-nums text-black">{creatives.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold text-black uppercase tracking-wider">Fresh (&le;30d)</p>
            <p className="text-base font-bold tabular-nums text-emerald-600">
              {timelineCreatives.filter(c => (c.age_days ?? 0) <= 30).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold text-black uppercase tracking-wider">Aging (31–44d)</p>
            <p className="text-base font-bold tabular-nums text-amber-600">
              {timelineCreatives.filter(c => (c.age_days ?? 0) > 30 && (c.age_days ?? 0) < 45).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold text-black uppercase tracking-wider">Stale (&ge;45d)</p>
            <p className="text-base font-bold tabular-nums text-red-600">
              {timelineCreatives.filter(c => (c.age_days ?? 0) >= 45).length}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
