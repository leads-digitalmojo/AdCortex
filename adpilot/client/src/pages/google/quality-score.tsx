import { useState, useMemo, useEffect } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
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
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart2,
  RefreshCcw,
  Info,
  AlertCircle,
  TrendingUp,
  Target,
  BarChart3,
  MousePointerClick,
  Trophy,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  ArrowUpDown
} from "lucide-react";
import { formatINR, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { Button } from "@/components/ui/button";

// ─── 1. DATA CONTRACT ────────────────────────────────────────────────

interface QsKeyword {
  keyword_id: string;
  keyword_text: string;
  campaign_name: string;
  ad_group_name: string;
  match_type: string;
  quality_score: number;
  expected_ctr: string;
  landing_page_experience: string;
  ad_relevance: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
  cpc: number;
  cpl: number;
  optimization_actions: string[];
}

interface QsCampaignSummary {
  campaign_name: string;
  avg_qs: number;
  keyword_count: number;
  below_4: number;
  below_6: number;
}

interface QualityScoreData {
  keywords: QsKeyword[];
  campaigns: Array<{ id: string; name: string }>;
  perCampaign: QsCampaignSummary[];
  alerts: string[];
  distribution: Array<{ score: string; count: number }>;
  summary: {
    total: number;
    avgQs: number;
    below4: number;
    below6: number;
    excellentPct: number;
    poorPct: number;
  };
}

// ─── 2. UTILITIES ────────────────────────────────────────────────────

const safeArray = <T,>(arr: any): T[] => (Array.isArray(arr) ? arr : []);
const safeNumber = (val: any): number => (typeof val === "number" && !isNaN(val) ? val : 0);
const safeString = (val: any, fallback = "—"): string => (typeof val === "string" ? val : fallback);

/**
 * Normalization Layer: Converts raw API data into a strict, crash-proof object.
 */
function normalizeQualityScore(rawData: any): QualityScoreData {
  const analysis = rawData?.quality_score_analysis || {};
  const rawKeywords = safeArray<any>(analysis.keywords);
  const rawCampaigns = safeArray<any>(rawData?.campaigns);

  // Normalize Keywords
  const keywords: QsKeyword[] = rawKeywords.map(k => ({
    keyword_id: safeString(k?.keyword_id),
    keyword_text: safeString(k?.keyword_text, "Unknown Keyword"),
    campaign_name: safeString(k?.campaign_name, "Unknown Campaign"),
    ad_group_name: safeString(k?.ad_group_name, "Unknown Ad Group"),
    match_type: safeString(k?.match_type, "BROAD"),
    quality_score: safeNumber(k?.quality_score),
    expected_ctr: safeString(k?.expected_ctr, "AVERAGE"),
    landing_page_experience: safeString(k?.landing_page_experience, "AVERAGE"),
    ad_relevance: safeString(k?.ad_relevance, "AVERAGE"),
    impressions: safeNumber(k?.impressions),
    clicks: safeNumber(k?.clicks),
    conversions: safeNumber(k?.conversions),
    cost: safeNumber(k?.cost),
    cpc: safeNumber(k?.cpc),
    cpl: safeNumber(k?.cpl),
    optimization_actions: safeArray(k?.optimization_actions),
  }));

  // Normalize Campaign Options
  const campaigns = rawCampaigns
    .filter((c: any) => c && (c.campaign_type === "branded" || c.campaign_type === "location"))
    .map((c: any) => ({
      id: safeString(c.campaign_id || c.id || c.name),
      name: safeString(c.name)
    }));

  // Build Score Distribution
  const distribution = Array.from({ length: 10 }, (_, i) => {
    const score = i + 1;
    return {
      score: String(score),
      count: keywords.filter(k => Math.round(k.quality_score) === score).length
    };
  });

  // Calculate Aggregates
  const total = keywords.length;
  const avgQs = total > 0 ? keywords.reduce((s, k) => s + k.quality_score, 0) / total : 0;
  const below4 = keywords.filter(k => k.quality_score < 4).length;
  const below6 = keywords.filter(k => k.quality_score < 6).length;
  const excellentCount = keywords.filter(k => k.quality_score >= 7).length;
  const poorCount = keywords.filter(k => k.quality_score < 5).length;

  return {
    keywords,
    campaigns,
    perCampaign: safeArray<any>(analysis.per_campaign).map(pc => ({
      campaign_name: safeString(pc?.campaign_name),
      avg_qs: safeNumber(pc?.avg_qs),
      keyword_count: safeNumber(pc?.keyword_count),
      below_4: safeNumber(pc?.below_4),
      below_6: safeNumber(pc?.below_6),
    })),
    alerts: safeArray(analysis.alerts),
    distribution,
    summary: {
      total,
      avgQs,
      below4,
      below6,
      excellentPct: total > 0 ? (excellentCount / total) * 100 : 0,
      poorPct: total > 0 ? (poorCount / total) * 100 : 0,
    }
  };
}

// ─── 3. UI HELPERS ───────────────────────────────────────────────────

function subFactorBadge(value: string) {
  const v = value.toUpperCase();
  if (v === "ABOVE_AVERAGE") return { label: "ABOVE AVG", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold tracking-[0.1em]" };
  if (v === "AVERAGE") return { label: "AVERAGE", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold tracking-[0.1em]" };
  if (v === "BELOW_AVERAGE") return { label: "BELOW AVG", cls: "bg-red-500/10 text-red-600 border-red-500/20 font-bold tracking-[0.1em]" };
  return { label: value || "—", cls: "bg-gray-500/10 text-gray-500 border-gray-500/20 font-bold tracking-[0.1em]" };
}

const qsColor = (qs: number) => qs > 6 ? "text-emerald-500" : qs >= 4 ? "text-amber-500" : "text-red-500";
const qsBgColor = (qs: number) => qs > 6 ? "bg-emerald-500" : qs >= 4 ? "bg-amber-500" : "bg-red-500";
const qsBarBg = (qs: number) => qs > 6 ? "bg-emerald-500/20" : qs >= 4 ? "bg-amber-500/20" : "bg-red-500/20";

const ALL_CAMPAIGNS = "__all__";

// ─── 4. COMPONENT ────────────────────────────────────────────────────

export default function GoogleQualityScorePage() {
  const { analysisData: rawData, isLoadingAnalysis: isLoading } = useClient();

  // Normalized Data Access
  const data = useMemo(() => normalizeQualityScore(rawData), [rawData]);

  // Viewport State
  const [selectedCampaign, setSelectedCampaign] = useState(ALL_CAMPAIGNS);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<keyof QsKeyword>("quality_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [openAdGroups, setOpenAdGroups] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sync Log for Debugging
  useEffect(() => {
    if (rawData) console.log("[GQS] Raw Data Update:", rawData);
  }, [rawData]);

  // Derived: Filtered Keywords
  const filteredKeywords = useMemo(() => {
    let list = [...data.keywords];

    if (selectedCampaign !== ALL_CAMPAIGNS) {
      const camp = data.campaigns.find(c => c.id === selectedCampaign);
      if (camp) list = list.filter(k => k.campaign_name === camp.name);
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(k =>
        k.keyword_text.toLowerCase().includes(q) ||
        k.ad_group_name.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [data, selectedCampaign, searchTerm, sortKey, sortDir]);

  // Derived: Grouped Map
  const adGroupMap = useMemo(() => {
    const map: Record<string, QsKeyword[]> = {};
    filteredKeywords.forEach(kw => {
      if (!map[kw.ad_group_name]) map[kw.ad_group_name] = [];
      map[kw.ad_group_name].push(kw);
    });
    return map;
  }, [filteredKeywords]);

  // ─── RENDER GUARDS ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-56 mb-4" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
        <Skeleton className="h-[400px] rounded-md" />
      </div>
    );
  }

  if (data.keywords.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-[1800px]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            Quality Score Analysis
          </h1>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RefreshCcw className="w-3 h-3 mr-2" /> Refresh Data
          </Button>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-3 rounded-full bg-muted mb-4 text-muted-foreground">
              <Info className="w-8 h-8" />
            </div>
            <h3 className="t-page-title">No keyword data found</h3>
            <p className="text-base text-muted-foreground max-w-md mt-2">
              Quality Score monitoring is active, but we couldn't find keywords for this client.
              Ensure 'keyword_view' is enabled in your Google Ads agent configuration.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-page-title text-foreground">Quality Score Explorer</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-[0.15em] font-medium mt-1">
            Analyzing <span className="font-black text-foreground tabular-nums">{data.summary.total}</span> keywords across <span className="font-black text-foreground tabular-nums">{data.campaigns.length}</span> search campaigns
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search keywords or ad groups..."
              className="pl-10 pr-4 py-2 text-sm rounded-xl bg-card border border-border/60 text-foreground w-72 focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="w-[300px] h-10 text-sm bg-card border-border/60 rounded-xl shadow-sm">
              <SelectValue placeholder="All Search Campaigns" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/60 shadow-2xl">
              <SelectItem value={ALL_CAMPAIGNS} className="font-semibold">All Search Campaigns</SelectItem>
              {data.campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{truncate(c.name, 40)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ─── KPI Overview ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Avg QS", value: data.summary.avgQs.toFixed(1), icon: BarChart3, color: qsColor(data.summary.avgQs), bg: qsColor(data.summary.avgQs).replace('text-', 'bg-') + '/10', suffix: "/ 10" },
          { label: "Critical", value: data.summary.below4, icon: ShieldAlert, color: data.summary.below4 > 0 ? "text-red-500" : "text-emerald-500", bg: data.summary.below4 > 0 ? "bg-red-500/10" : "bg-emerald-500/10" },
          { label: "Poor", value: data.summary.below6, icon: AlertCircle, color: data.summary.below6 > 0 ? "text-amber-500" : "text-emerald-500", bg: data.summary.below6 > 0 ? "bg-amber-500/10" : "bg-emerald-500/10" },
          { label: "Total Keywords", value: data.summary.total, icon: Search, color: "text-primary", bg: "bg-primary/10" },
          { label: "Green Ratio", value: `${data.summary.excellentPct.toFixed(0)}%`, icon: Trophy, color: data.summary.excellentPct > 50 ? "text-emerald-500" : "text-amber-500", bg: data.summary.excellentPct > 50 ? "bg-emerald-500/10" : "bg-amber-500/10" },
          { label: "Red Ratio", value: `${data.summary.poorPct.toFixed(0)}%`, icon: TrendingUp, color: data.summary.poorPct > 20 ? "text-red-500" : "text-emerald-500", bg: data.summary.poorPct > 20 ? "bg-red-500/10" : "bg-emerald-500/10" },
        ].map((kpi, i) => (
          <Card key={i} className="bg-card shadow-lg border-border/40 hover:shadow-xl transition-shadow duration-200">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn("p-2 rounded-lg", kpi.bg)}>
                  <kpi.icon className={cn("w-4 h-4", kpi.color)} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground leading-tight">{kpi.label}</span>
              </div>
              <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums leading-none">
                {kpi.value}
                {kpi.suffix && <span className="text-sm font-medium ml-1 text-muted-foreground">{kpi.suffix}</span>}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Distribution & Campaign View ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card shadow-lg border-border/40">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <BarChart2 className="w-4 h-4 text-primary" />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">QS Distribution</p>
              </div>
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 font-bold tracking-wider px-2 py-0.5 border border-emerald-200/50">LIVE SCAN</Badge>
            </div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.distribution} barSize={24}>
                  <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} opacity={0.2} />
                  <XAxis 
                    dataKey="score" 
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", fontWeight: 700 }} 
                    axisLine={false} 
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis hide />
                  <RechartsTooltip 
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.1 }} 
                    content={<CustomTooltip />} 
                    animationDuration={200}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} animationBegin={0} animationDuration={1000}>
                    {data.distribution.map((entry, idx) => (
                      <Cell key={idx} fill={qsBgColor(Number(entry.score))} opacity={0.9} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-lg border-border/40">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">QS by Campaign</p>
            </div>
            <div className="space-y-5 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
              {data.perCampaign.slice(0, 10).map((pc, i) => (
                <div key={i} className="group">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-foreground truncate max-w-[240px] uppercase tracking-tight">{pc.campaign_name}</span>
                    <span className={cn("text-xs font-black tabular-nums", qsColor(pc.avg_qs))}>{pc.avg_qs.toFixed(1)}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full transition-all duration-1000", qsBgColor(pc.avg_qs))}
                      style={{ width: `${(pc.avg_qs / 10) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Alerts Banner ─── */}
      {data.alerts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-4 flex gap-4 shadow-sm">
          <ShieldAlert className="w-6 h-6 text-amber-500 shrink-0" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-amber-600 uppercase tracking-widest">Strategic Intelligence Alerts</p>
            {data.alerts.map((a, i) => <p key={i} className="text-xs text-amber-900/70 font-medium leading-relaxed">· {a}</p>)}
          </div>
        </div>
      )}

      {/* ─── Ad Group Sections ─── */}
      <div className="space-y-2 pt-2">
        {(() => {
          const allEntries = Object.entries(adGroupMap);
          const paginated = allEntries.slice((page - 1) * pageSize, page * pageSize);

          return paginated.map(([name, keywords]) => {
            const agAvg = keywords.reduce((s, k) => s + k.quality_score, 0) / keywords.length;
            const agCritical = keywords.filter(k => k.quality_score < 4).length;
            const isOpen = openAdGroups[name] !== false;

            return (
              <Collapsible key={name} open={isOpen} onOpenChange={() => setOpenAdGroups(p => ({ ...p, [name]: !p[name] }))}>
                <Card className={cn("transition-all border-l-4",
                  agAvg >= 7 ? "border-l-emerald-500" : agAvg >= 5 ? "border-l-amber-500" : "border-l-red-500"
                )}>
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center gap-6 px-6 py-5 cursor-pointer hover:bg-muted/20 transition-colors">
                      <div className="flex flex-col gap-1">
                        <span className="text-lg font-bold text-foreground tracking-[0.1em] uppercase">{name}</span>
                        <span className="text-xs text-slate-500 uppercase font-bold tracking-[0.15em] opacity-70">{keywords.length} KEYWORDS DETECTED</span>
                      </div>
                      <div className="flex items-center gap-6 ml-auto">
                        <div className="text-right">
                          <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground mb-1">AD GROUP SCORE</p>
                          <p className={cn("text-2xl font-bold tabular-nums leading-none", qsColor(agAvg))}>{agAvg.toFixed(1)}</p>
                        </div>
                        {agCritical > 0 && (
                          <Badge variant="destructive" className="bg-red-500/10 text-red-500 border-red-500/20 h-8 px-3 font-bold text-xs uppercase tracking-widest shadow-sm">
                            {agCritical} CRITICAL ALERTS
                          </Badge>
                        )}
                        <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center border border-border/40">
                          <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform duration-300", isOpen && "rotate-180")} />
                        </div>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="overflow-x-auto border-t border-border/40">
                      <table className="t-table w-full text-left">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border/60">
                            {["Keyword / Ad Group", "Quality Score", "Exp. CTR", "Ad Relevance", "LP Experience", "Conv.", "CPL", "Doctor Recommendations"].map(h => (
                              <th key={h} className="px-6 py-4 text-sm font-bold uppercase tracking-[0.15em] text-muted-foreground border-r border-border/5 last:border-0">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {keywords.map((kw, idx) => (
                            <tr key={idx} className="border-b last:border-0 hover:bg-muted/10">
                              <td className="p-6 max-w-[320px]">
                                <p className="font-semibold text-foreground text-base tracking-[0.02em] leading-tight">{kw.keyword_text}</p>
                                <p className="text-[12px] text-slate-500 font-semibold uppercase mt-1.5 tracking-wider opacity-80">{kw.match_type}</p>
                              </td>
                              <td className="p-6">
                                <div className="flex items-center gap-3">
                                  <div className={cn("w-16 h-2 rounded-full shadow-inner bg-muted/40 overflow-hidden")}>
                                    <div className={cn("h-full rounded-full transition-all duration-700", qsBgColor(kw.quality_score))} style={{ width: `${(kw.quality_score / 10) * 100}%` }} />
                                  </div>
                                  <span className={cn("font-bold tabular-nums text-base", qsColor(kw.quality_score))}>{kw.quality_score}</span>
                                </div>
                              </td>
                              <td className="p-6"><FactorBadge val={kw.expected_ctr} /></td>
                              <td className="p-6"><FactorBadge val={kw.ad_relevance} /></td>
                              <td className="p-6"><FactorBadge val={kw.landing_page_experience} /></td>
                              <td className="p-6 font-bold text-foreground tabular-nums text-base">{Math.round(kw.conversions)}</td>
                              <td className="p-6 font-bold text-foreground/80 tabular-nums text-base">{kw.cpl > 0 ? formatINR(kw.cpl, 0) : "—"}</td>
                              <td className="p-6">
                                {kw.optimization_actions && kw.optimization_actions.length > 0 ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center gap-1.5 cursor-help group/doc">
                                        <Badge variant="outline" className="text-[11px] bg-amber-500/10 text-amber-700 border-amber-500/30 px-3 py-1.5 rounded font-bold uppercase tracking-[0.1em] whitespace-normal text-left shadow-sm group-hover/doc:bg-amber-500/20 transition-colors leading-relaxed">
                                          {kw.optimization_actions[0]}
                                        </Badge>
                                        {kw.optimization_actions.length > 1 && (
                                          <div className="size-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                                            <AlertCircle className="w-2.5 h-2.5 text-amber-500" />
                                          </div>
                                        )}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="p-3 space-y-2 max-w-[280px]">
                                      <p className="font-bold text-xs border-b border-border/40 pb-1.5">QS Doctor Recommendations</p>
                                      <div className="space-y-1.5">
                                        {kw.optimization_actions.map((action, i) => (
                                          <p key={i} className="text-xs leading-relaxed text-muted-foreground flex gap-2">
                                            <span className="text-amber-600 font-bold">{i+1}.</span>
                                            {action}
                                          </p>
                                        ))}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <span className="text-xs text-muted-foreground ">Optimal QS</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* SOP Section */}
                    {agAvg < 6 && (
                      <div className="bg-primary/5 p-4 flex gap-4 border-t">
                        <Info className="w-5 h-5 text-primary shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-primary uppercase">AdPilot SOP Recommendation</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            This ad group has a sub-optimal QS. Ensure your RSA ad copy contains these keywords in headlines 1-3
                            and that the landing page H1 precisely matches the high-volume terms in this set.
                          </p>
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          });
        })()}

        <DataTablePagination
          totalItems={Object.keys(adGroupMap).length}
          pageSize={pageSize}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}

function FactorBadge({ val }: { val: string }) {
  const b = subFactorBadge(val);
  return (
    <Badge variant="secondary" className={cn("px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] border shadow-xs justify-center min-w-[90px]", b.cls)}>
      {b.label}
    </Badge>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (active && payload?.[0]) {
    return (
      <div className="bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl shadow-2xl flex flex-col gap-1 min-w-[140px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70 mb-0.5">QS Intelligence</p>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white">Score {payload[0].payload.score}</span>
          <span className="text-xs font-black text-primary tabular-nums">{payload[0].value} KWs</span>
        </div>
        <div className="w-full h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
          <div className={cn("h-full", qsBgColor(Number(payload[0].payload.score)))} style={{ width: '100%' }} />
        </div>
      </div>
    );
  }
  return null;
}
