import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { formatINR, formatPct, getCplColor, truncate } from "@/lib/format";
import {
  BarChart3,
  Clock,
  AlertTriangle,
  IndianRupee,
  Trophy,
  ThumbsDown,
  MapPin,
  Info,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Ban,
  Flag,
  Eye,
  SlidersHorizontal,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedActions, type UnifiedActionItem, type ActionState } from "@/components/unified-actions";
import { HealthScoreBreakdown } from "@/components/health-score-breakdown";

// ─── Constants & Types ──────────────────────────────────────────────

const ACCOUNT_OVERVIEW = "all";
const META_TABS = ["Age", "Gender", "Placement", "Device", "Region"] as const;
type MetaTabType = (typeof META_TABS)[number];

const META_COLUMN_CONFIG = [
  { column: "Dimension", description: "Breakdown segment (Age, Gender, etc.)" },
  { column: "Health Score", description: "Score based on CPL, CTR, and conversion efficiency" },
  { column: "Spend", description: "Spend for this segment" },
  { column: "Leads", description: "Conversions for segment" },
  { column: "CPL", description: "Cost per lead" },
  { column: "CTR", description: "Click-through rate" },
  { column: "Recommendation", description: "Action based on score" }
];

const GOOGLE_TABS = ["Age", "Gender", "Device", "Location", "Placement"] as const;
type GoogleTabType = (typeof GOOGLE_TABS)[number];

const GOOGLE_TAB_KEYS: Record<GoogleTabType, string> = {
  Age: "age",
  Gender: "gender",
  Device: "device",
  Location: "location",
  Placement: "placement",
};

interface BreakdownRow {
  dimension: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  cpl: number;
  classification?: string;
  is_target_location?: boolean;
}

interface GoogleBreakdownRow extends BreakdownRow {
  cost: number;
  conversions: number;
  cvr: number;
  bid_adjustment?: number;
}

interface BreakdownData {
  available: boolean;
  message?: string;
  breakdowns: any;
  geo_alerts: any[];
  target_locations: string[];
  dynamic_thresholds?: any;
}

// ─── Layout Helper ──────────────────────────────────────────────────

function formatNumber(n: number) {
  return Math.round(n).toLocaleString();
}

// ─── Shared Components ─────────────────────────────────────────────


function getHealthStatus(s: number) {
  if (s >= 75) return { label: "Excellent", color: "text-emerald-500", bg: "bg-emerald-500", lightBg: "bg-emerald-500/10", border: "border-emerald-500/20" };
  if (s >= 60) return { label: "Good", color: "text-emerald-400", bg: "bg-emerald-400", lightBg: "bg-emerald-400/10", border: "border-emerald-400/20" };
  if (s >= 40) return { label: "Moderate", color: "text-amber-500", bg: "bg-amber-500", lightBg: "bg-amber-500/10", border: "border-amber-500/20" };
  if (s >= 25) return { label: "Poor", color: "text-orange-500", bg: "bg-orange-500", lightBg: "bg-orange-500/10", border: "border-orange-500/20" };
  return { label: "Critical", color: "text-red-500", bg: "bg-red-500", lightBg: "bg-red-500/10", border: "border-red-500/20" };
}

function computeBreakdownScore(row: any, target: number, ctrBenchmark: number, totalLeads: number, totalSpend: number) {
  let cplScore = 0;
  if (row.leads > 0) {
    const ratio = target / row.cpl;
    cplScore = Math.min(50, Math.max(0, ratio * 25)); // High weight on CPL
  } else if (row.spend > 500) {
    cplScore = 5;
  } else {
    cplScore = 20; // neutral
  }

  let ctrScore = 0;
  if (row.ctr > 0) {
    const ratio = row.ctr / ctrBenchmark;
    ctrScore = Math.min(20, Math.max(0, ratio * 10));
  }

  let volumeScore = 0;
  if (totalLeads > 0) {
    volumeScore = Math.min(20, (row.leads / totalLeads) * 100);
  }

  let efficiencyScore = 0;
  if (totalSpend > 0) {
    const spendPct = (row.spend / totalSpend) * 100;
    efficiencyScore = Math.min(10, spendPct > 10 ? 10 : spendPct);
  }

  return {
    total: Math.round(cplScore + ctrScore + volumeScore + efficiencyScore),
    cplScore: Math.round(cplScore),
    ctrScore: Math.round(ctrScore),
    volumeScore: Math.round(volumeScore),
    efficiencyScore: Math.round(efficiencyScore),
  };
}

function getRecommendationType(row: any, score: number, tabName: string, isTarget?: boolean) {
  if (tabName === "Region" && isTarget === false && row.spend > 0) {
    return { type: "exclude", text: "Pause / Exclude", color: "text-red-500", lightBg: "bg-red-500/10", border: "border-red-500/20", reason: "Outside target geography" };
  }
  if (score >= 75) return { type: "scale", text: "Scale / Increase budget", color: "text-emerald-500", lightBg: "bg-emerald-500/10", border: "border-emerald-500/20", reason: "Top tier performance" };
  if (score >= 40) return { type: "monitor", text: "Monitor / Optimize", color: "text-amber-500", lightBg: "bg-amber-500/10", border: "border-amber-500/20", reason: "Average performance" };
  if (score > 0) return { type: "reduce", text: "Reduce spend / Pause", color: "text-red-500", lightBg: "bg-red-500/10", border: "border-red-500/20", reason: "Severe inefficiency" };
  return { type: "none", text: "Needs Data", color: "text-muted-foreground", lightBg: "bg-muted", border: "border-transparent", reason: "Insufficient impressions" };
}

// ─── Main Component ────────────────────────────────────────────────

export default function BreakdownsPage() {
  const { activeClient: client, activeCadence: globalCadence, activePlatform } = useClient();

  const clientId = client?.id || "amara";
  const platformKey = activePlatform === "google" ? "google" : "meta";
  const apiBase = `/api/clients/${clientId}`;

  const { data: analysisData, isLoading: isLoadingAnalysis } = useQuery({
    queryKey: [apiBase, platformKey, "analysis", globalCadence],
    queryFn: async () => {
      const url = `${apiBase}/${platformKey}/analysis?cadence=${globalCadence}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const activeCadence = analysisData?.active_cadence || globalCadence;

  return (
    <div className="min-h-screen bg-background">
      {platformKey === "meta" ? (
        <MetaBreakdowns
          clientId={clientId}
          analysisData={analysisData}
          isLoadingAnalysis={isLoadingAnalysis}
          activeCadence={activeCadence}
        />
      ) : (
        <GoogleBreakdowns
          clientId={clientId}
          analysisData={analysisData}
          isLoadingAnalysis={isLoadingAnalysis}
          activeCadence={activeCadence}
        />
      )}
    </div>
  );
}

// ─── Meta Breakdowns ───────────────────────────────────────────────

function MetaBreakdowns({ clientId, analysisData, isLoadingAnalysis, activeCadence }: any) {
  const apiBase = `/api/clients/${clientId}/meta`;
  const [activeTab, setActiveTab] = useState<MetaTabType>("Age");
  const [selectedCampaign, setSelectedCampaign] = useState(ACCOUNT_OVERVIEW);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: string) {
    if (sortKey === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpand(id: string) { setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  const thresholds = analysisData?.dynamic_thresholds;
  const cplTarget = thresholds?.cpl_target ?? 1000;
  const ctrTarget = thresholds?.ctr_min ?? 0.8;

  const campaigns = useMemo(() => {
    if (!analysisData?.campaign_audit) return [];
    return analysisData.campaign_audit
      .filter((c: any) => c.spend > 0)
      .map((c: any) => ({
        id: c.campaign_id,
        name: c.campaign_name,
        cpl: c.cpl,
        spend: c.spend,
        leads: c.leads,
      }))
      .sort((a: any, b: any) => b.spend - a.spend);
  }, [analysisData]);

  const { data, isLoading } = useQuery<BreakdownData>({
    queryKey: [apiBase, "breakdowns", selectedCampaign, activeCadence],
    queryFn: async () => {
      const url = selectedCampaign === ACCOUNT_OVERVIEW
        ? `${apiBase}/breakdowns?cadence=${activeCadence}`
        : `${apiBase}/breakdowns/${selectedCampaign}?cadence=${activeCadence}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const tabKey = activeTab.toLowerCase();

  const rawRows: BreakdownRow[] = useMemo(() => {
    const source = data?.available && data.breakdowns?.[tabKey] ? data.breakdowns[tabKey] : [];
    if (selectedCampaign !== ACCOUNT_OVERVIEW) return source;
    const aggregated: Record<string, BreakdownRow> = {};
    source.forEach((row: any) => {
      let dim = row.dimension || "Unknown";
      
      // Clean labels
      dim = dim.toString().replace(/_/g, " ");

      if (!aggregated[dim]) { aggregated[dim] = { ...row, dimension: dim }; }
      else {
        const agg = aggregated[dim];
        agg.spend += row.spend;
        agg.impressions += row.impressions;
        agg.clicks += row.clicks;
        agg.leads += row.leads;
        agg.cpl = agg.leads > 0 ? agg.spend / agg.leads : 0;
        agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
      }
    });
    return Object.values(aggregated);
  }, [data, tabKey, selectedCampaign]);

  const rows = useMemo(() => {
    return [...rawRows].sort((a, b) => {
      const aVal = (a as any)[sortKey] ?? 0;
      const bVal = (b as any)[sortKey] ?? 0;
      if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [rawRows, sortKey, sortDir]);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);

  const scoredRows = useMemo(() => {
    return rows.map((row) => {
      const score = computeBreakdownScore(row, cplTarget, ctrTarget, totalLeads, totalSpend);
      const rec = getRecommendationType(row, score.total, activeTab, row.is_target_location);
      return { row, score, rec };
    });
  }, [rows, cplTarget, ctrTarget, totalLeads, totalSpend, activeTab]);

  if (isLoading) return <div className="p-12 text-center text-muted-foreground"><Clock className="w-8 h-8 mx-auto mb-2 animate-spin opacity-20" /><p>Synthesizing Meta Ads Breakdowns...</p></div>;

  return (
    <div className="p-6 space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="t-page-title text-foreground">Meta Breakdowns Engine</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Performance Audit Layer</p>
          </div>
        </div>
        <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
          <SelectTrigger className="w-[340px] h-11 bg-card border-border/60 shadow-md">
            <SelectValue placeholder="Campaign Selection" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ACCOUNT_OVERVIEW} className="font-semibold">Account-Wide View</SelectItem>
            {campaigns.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{truncate(c.name, 45)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1 bg-muted/20 p-1.5 rounded-xl border border-border/40 w-fit">
        {META_TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setExpandedIds(new Set()); }}
            className={cn("px-6 py-2.5 text-xs font-bold uppercase tracking-widest rounded-lg transition-all", activeTab === tab ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted/30")}>
            {tab}
          </button>
        ))}
      </div>

      <Card className="border-border/60 shadow-2xl overflow-hidden bg-card/40 backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              <tr className="bg-muted/30 border-b border-border/60">
                {META_COLUMN_CONFIG.map((col, idx) => (
                  <th key={idx} className={cn("px-4 py-4 text-sm font-bold uppercase tracking-widest text-muted-foreground text-left")}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                          {col.column} <Info className="w-3 h-3 opacity-40" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[200px] p-3 space-y-2 bg-card border-border shadow-2xl">
                          <p className="font-bold border-b border-border/50 pb-1">{col.column} SOP</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">{col.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoredRows.map(({ row, score, rec }, i) => {
                const isExpanded = expandedIds.has(row.dimension);
                const health = getHealthStatus(score.total);
                return (
                  <React.Fragment key={i}>
                    <tr className={cn("border-b border-border/20 hover:bg-muted/30 transition-all cursor-pointer group", isExpanded && "bg-primary/5")} onClick={() => toggleExpand(row.dimension)}>
                      <td className="p-4 font-bold text-foreground text-base tracking-tight">{row.dimension}</td>
                      <td className="p-4">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="w-full max-w-[180px]">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className={cn("text-xs font-bold uppercase tracking-widest", health.color)}>{health.label}</span>
                                  <span className="text-xs font-bold text-foreground">{score.total}<span className="text-muted-foreground">/100</span></span>
                                </div>
                                <div className="h-1.5 w-full bg-border/40 rounded-full overflow-hidden">
                                  <div className={cn("h-full rounded-full", health.bg)} style={{ width: `${score.total}%` }} />
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="bg-card border-border shadow-xl">
                              <p className="text-xs">Based on CPL efficiency, CTR, and conversion volume.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                      <td className="p-4 tabular-nums font-bold text-foreground/80">{formatINR(row.spend, 0)}</td>
                      <td className="p-4 tabular-nums font-bold text-foreground">{row.leads}</td>
                      <td className={cn("p-4 tabular-nums font-bold", getCplColor(row.cpl, thresholds))}>{row.cpl > 0 ? formatINR(row.cpl, 0) : "—"}</td>
                      <td className="p-4 tabular-nums font-bold text-foreground/70">{formatPct(row.ctr)}</td>
                      <td className="p-4">
                        <div className={cn("inline-flex items-center gap-2 px-2.5 py-1 rounded border shadow-xs", rec.lightBg, rec.border, rec.color)}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", rec.color.replace('text-', 'bg-'))} />
                          <span className="text-xs font-bold uppercase tracking-wider">{rec.text}</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/10">
                        <td colSpan={7} className="p-8 border-b border-primary/20 space-y-6">
                          <div className="space-y-6">
                            <HealthScoreBreakdown
                              entityName={row.dimension}
                              scoreBreakdown={{
                                "CPL_Efficiency": score.cplScore,
                                "CTR_Impact": score.ctrScore,
                                "Lead_Volume": score.volumeScore,
                                "Spend_Utilization": score.efficiencyScore
                              }}
                              detailedBreakdown={{
                                "CPL_Efficiency": { actual: row.cpl, target: cplTarget, unit: "currency", contribution: score.cplScore, weight: 50 },
                                "CTR_Impact": { actual: row.ctr / 100, target: ctrTarget / 100, unit: "percent", contribution: score.ctrScore, weight: 20 },
                                "Lead_Volume": { actual: row.leads, target: Math.round(totalLeads / scoredRows.length), unit: "number", contribution: score.volumeScore, weight: 20 },
                                "Spend_Utilization": { actual: row.spend, target: Math.round(totalSpend / scoredRows.length), unit: "currency", contribution: score.efficiencyScore, weight: 10 }
                              }}
                            />
                            
                            <div className={cn("p-5 rounded-xl border bg-background/80 shadow-sm space-y-2", health.border)}>
                              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Expert Recommendation:</p>
                              <p className="text-base font-medium text-foreground leading-relaxed">
                                System indicates <span className={cn("font-bold", rec.color)}>{rec.text}</span> because {rec.reason.toLowerCase()}. 
                                Efficiency Score of <span className={cn("font-bold", health.color)}>{score.total}/100</span> suggests this segment is 
                                {score.total >= 60 ? " prime for budget acceleration or stabilization." : " currently underperforming relative to account-wide benchmarks and requires intervention."}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Google Breakdowns ─────────────────────────────────────────────

function GoogleBreakdowns({ clientId, analysisData, isLoadingAnalysis, activeCadence }: any) {
  const apiBase = `/api/clients/${clientId}/google`;
  const [activeTab, setActiveTab] = useState<GoogleTabType>("Age");
  const [selectedCampaign, setSelectedCampaign] = useState(ACCOUNT_OVERVIEW);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [sortKey, setSortKey] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  function toggleSort(key: string) {
    if (sortKey === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpand(id: string) { setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  const { data, isLoading } = useQuery<BreakdownData>({
    queryKey: [apiBase, "breakdowns", selectedCampaign, activeCadence],
    queryFn: async () => {
      const url = selectedCampaign === ACCOUNT_OVERVIEW
        ? `${apiBase}/breakdowns?cadence=${activeCadence}`
        : `${apiBase}/breakdowns/${selectedCampaign}?cadence=${activeCadence}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const tabKey = GOOGLE_TAB_KEYS[activeTab];

  const rawRows: GoogleBreakdownRow[] = useMemo(() => {
    if (!data?.available || !data.breakdowns) return [];

    // Google demographic_breakdowns is a global object with keys like 'age', 'gender', 'device'
    // Each key contains a flat array of records for ALL campaigns.
    const allRecords = data.breakdowns[tabKey] || [];

    // 1. Filter by selected campaign if not ACCOUNT_OVERVIEW
    const filtered = selectedCampaign === ACCOUNT_OVERVIEW
      ? allRecords
      : allRecords.filter((r: any) => r.campaign_id === selectedCampaign);

    // 2. Aggregate by dimension
    const aggregated: Record<string, GoogleBreakdownRow> = {};

    filtered.forEach((r: any) => {
      // Handle the various field names Google uses for dimensions
      let dim = r.age_range || r.gender || r.device || r.region || r.location || r.dimension || "Unknown";
      
      // Clean technical labels
      dim = dim.toString()
        .replace(/AGE_RANGE_/g, "Age ")
        .replace(/_/g, " ")
        .replace(/UNDETERMINED/g, "Unknown")
        .replace(/DEVICE_/g, "");

      if (!aggregated[dim]) {
        aggregated[dim] = {
          ...r,
          dimension: dim,
          cost: r.cost || r.spend || 0,
          conversions: r.conversions || r.leads || 0,
          impressions: r.impressions || 0,
          clicks: r.clicks || 0
        };
      } else {
        const agg = aggregated[dim];
        agg.cost += (r.cost || r.spend || 0);
        agg.impressions += (r.impressions || 0);
        agg.clicks += (r.clicks || 0);
        agg.conversions += (r.conversions || r.leads || 0);
      }
    });

    // 3. Final metric derivation
    return Object.values(aggregated).map(r => ({
      ...r,
      ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
      cpc: r.clicks > 0 ? r.cost / r.clicks : 0,
      cpl: r.conversions > 0 ? r.cost / r.conversions : 0,
      cvr: r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
    }));
  }, [data, tabKey, selectedCampaign]);

  const rows = useMemo(() => {
    return [...rawRows].sort((a, b) => {
      const aVal = (a as any)[sortKey] ?? 0;
      const bVal = (b as any)[sortKey] ?? 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [rawRows, sortKey, sortDir]);

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const rowsWithConversions = rows.filter(r => r.conversions > 0);
  const best = rowsWithConversions.length > 0 ? rowsWithConversions.reduce((a, b) => (a.cpl < b.cpl ? a : b)) : null;

  if (isLoading) return <div className="p-12 text-center text-muted-foreground"><Clock className="w-8 h-8 mx-auto mb-2 animate-spin opacity-20" /><p>Scanning Google demographics...</p></div>;

  if (!data?.available) {
    return (
      <Card className="m-6 bg-muted/20 border-border/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-base text-muted-foreground">
            {data?.message || "Google breakdown data not yet synced for this cadence."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="m-6 bg-muted/20 border-border/50" >
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-base text-muted-foreground">
            No {activeTab.toLowerCase()} segments detected for the selected period.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-[#F0BC00]" />
          <h1 className="t-page-title text-foreground">Google Breakdown Intelligence</h1>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard icon={IndianRupee} label="Total Cost" value={formatINR(totalCost, 0)} color="text-[#F0BC00]" />
        <MetricCard icon={Trophy} label="Best Google Performance" value={best ? best.dimension : "—"} subValue={best ? `CPL ${formatINR(best.cpl, 0)}` : ""} color="text-emerald-400" />
      </div>

      <div className="flex items-center gap-1 bg-muted/20 p-1.5 rounded-xl border border-border/40 w-fit">
        {GOOGLE_TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setExpandedIds(new Set()); }}
            className={cn("px-6 py-2.5 text-xs font-bold uppercase tracking-widest rounded-lg transition-all", activeTab === tab ? "bg-[#F0BC00] text-black shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted/30")}>
            {tab}
          </button>
        ))}
      </div>

      <Card className="border-border/40 shadow-sm overflow-hidden bg-card/30">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              <tr className="bg-muted/20 border-b border-border/50">
                <th className="p-3 w-10"></th>
                <th className="p-3 text-left text-sm font-bold uppercase tracking-widest text-muted-foreground">Dimension</th>
                <th className="p-3 text-right text-sm font-bold uppercase tracking-widest text-muted-foreground">Cost</th>
                <th className="p-3 text-right text-sm font-bold uppercase tracking-widest text-muted-foreground">Clicks</th>
                <th className="p-3 text-right text-sm font-bold uppercase tracking-widest text-muted-foreground">CTR</th>
                <th className="p-3 text-right text-sm font-bold uppercase tracking-widest text-muted-foreground">Conv</th>
                <th className="p-3 text-right text-sm font-bold uppercase tracking-widest text-muted-foreground">CPL</th>
                <th className="p-3 text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isExpanded = expandedIds.has(row.dimension);
                const itemId = `google-${activeTab}-${row.dimension}`;
                return (
                  <React.Fragment key={i}>
                    <tr className={cn("border-b border-border/30 hover:bg-muted/20 transition-all cursor-pointer", isExpanded && "bg-[#F0BC00]/5")} onClick={() => toggleExpand(row.dimension)}>
                      <td className="p-3"><Button variant="ghost" size="sm" className="h-6 w-6 p-0">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Button></td>
                      <td className="p-3 font-semibold text-foreground">{row.dimension}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{formatINR(row.cost, 0)}</td>
                      <td className="p-3 text-right tabular-nums text-muted-foreground">{formatNumber(row.clicks)}</td>
                      <td className="p-3 text-right tabular-nums">{formatPct(row.ctr)}</td>
                      <td className="p-3 text-right tabular-nums font-bold text-foreground">{formatNumber(row.conversions)}</td>
                      <td className={cn("p-3 text-right tabular-nums font-bold", row.cpl > 0 && row.cpl < 850 ? "text-emerald-400" : "text-foreground")}>{row.cpl > 0 ? formatINR(row.cpl, 0) : "—"}</td>
                      <td className="p-3 text-center">
                        <UnifiedActions compact item={{ id: itemId, description: `Google ${activeTab}: ${row.dimension}`, autoExecutable: false }}
                          entityId={itemId} entityName={`${activeTab}: ${row.dimension}`} entityType="adset" actionType="MANUAL_ACTION"
                          recommendation="Monitor segment" onStateChange={() => { }} />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/5">
                        <td colSpan={8} className="p-8 border-b border-border/40 space-y-6">
                          <HealthScoreBreakdown
                            entityName={row.dimension}
                            scoreBreakdown={{
                              "CPL_Efficiency": row.cpl > 0 && row.cpl < 850 ? 80 : 40,
                              "Conversion_Volume": row.conversions > 0 ? 90 : 20,
                              "CTR_Impact": row.ctr > 1 ? 85 : 45
                            }}
                            detailedBreakdown={{
                              "CPL_Efficiency": { actual: row.cpl, target: 850, unit: "currency", contribution: row.cpl > 0 && row.cpl < 850 ? 40 : 20, weight: 50 },
                              "Conversion_Volume": { actual: row.conversions, target: 5, unit: "number", contribution: row.conversions > 0 ? 18 : 4, weight: 20 },
                              "CTR_Impact": { actual: row.ctr / 100, target: 0.012, unit: "percent", contribution: row.ctr > 1 ? 17 : 9, weight: 20 }
                            }}
                          />
                          <div className="p-5 rounded-xl border border-border/40 bg-background/80 shadow-sm mt-4">
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Strategic analysis:</p>
                            <p className="text-base font-medium text-foreground leading-relaxed">
                              Strategic analysis for Google segment <strong>{row.dimension}</strong>. Cost per lead is {row.cpl > 0 ? formatINR(row.cpl, 0) : "not yet established"}. 
                              {row.cpl > 0 && row.cpl < 850 ? " Performance is within acceptable Google benchmarks." : " Intervention may be required to qualify traffic and reduce CPA drift."}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Shared UI Components ──────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, subValue, color }: any) {
  return (
    <Card className="bg-card shadow-lg border-border/40 hover:shadow-xl transition-shadow duration-200">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className={cn(
            "p-2 rounded-lg",
            color === "text-[#F0BC00]" ? "bg-[#F0BC00]/10" : 
            color.includes("emerald") ? "bg-emerald-500/10" : 
            color.includes("blue") ? "bg-blue-500/10" : "bg-muted/50"
          )}>
            <Icon className={cn("w-4 h-4", color.replace('400', '600'))} />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        </div>
        <p className="text-xl font-bold tracking-tight text-foreground">{value}</p>
        {subValue && <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-2">{subValue}</p>}
      </CardContent>
    </Card>
  );
}

function ProgressBar({ pct, color }: { pct: number, color: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full", color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right font-medium">{pct.toFixed(0)}%</span>
    </div>
  );
}
