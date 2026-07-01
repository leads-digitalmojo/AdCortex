import { useState, useMemo, useEffect, Fragment } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
import type { AdsetAnalysis } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowUpDown, ChevronDown, ChevronUp, AlertCircle, Pause, Play, TrendingUp, TrendingDown, Loader2, SlidersHorizontal, Info } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ScoreIndicator } from "@/components/score-indicator";
import { HealthScoreBreakdown } from "@/components/health-score-breakdown";
import {
  formatINR,
  formatPct,
  formatNumber,
  getLayerColor,
  getLearningStatusColor,
  getCplColor,
  getCtrColor,
  getCtrColorWithBenchmarks,
  getFrequencyColor,
  getFrequencyColorWithBenchmarks,
  truncate,
} from "@/lib/format";
import { useMetaBenchmarks, useDynamicThresholds } from "@/hooks/use-meta-benchmarks";
import { useExecution } from "@/hooks/use-execution";
import { ExecutionButton } from "@/components/execution-button";
import { usePausedEntities } from "@/hooks/use-paused-entities";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type SortKey = keyof AdsetAnalysis;
type SortDir = "asc" | "desc";

// ─── Benchmark comparison badge ─────────────────────────────────────
function BenchmarkBadge({ value, benchmark, label }: { value: number; benchmark: number; label?: string }) {
  if (!benchmark || !value) return null;
  const pct = ((value - benchmark) / benchmark) * 100;
  const isAbove = value > benchmark;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center text-xs font-medium px-1 py-0 rounded ml-1 cursor-default ${isAbove ? "text-red-400 bg-red-500/10" : "text-emerald-400 bg-emerald-500/10"}`}>
          {isAbove ? "▲" : "▼"} {Math.abs(Math.round(pct))}%
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="t-caption">
        {label || "Benchmark"}: {formatINR(benchmark, 0)} — {isAbove ? "Above" : "Within"} benchmark
      </TooltipContent>
    </Tooltip>
  );
}

export default function AdsetsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform, activeClient } = useClient();
  const { executeBatch, isExecuting } = useExecution();
  const { isPaused: isEntityPaused } = usePausedEntities();
  const isGoogle = activePlatform === "google";
  const apiBase = `/api/clients/${activeClient?.id}/${activePlatform}`;
  const queryClient = useQueryClient();

  // Use centralized benchmarks hook for reactive updates
  const metaBenchmarks = useMetaBenchmarks();
  const dynamicThresholds = useDynamicThresholds();

  // Refetch adset data when benchmarks change (for Meta only)
  useEffect(() => {
    if (!isGoogle && activeClient?.id && metaBenchmarks.raw && Object.keys(metaBenchmarks.raw).length > 0) {
      // Invalidate analysis queries to trigger refetch with new benchmarks
      queryClient.invalidateQueries({ queryKey: [apiBase, "analysis"] });
    }
  }, [metaBenchmarks.raw, isGoogle, activeClient?.id, apiBase, queryClient]);
  const entityLabel = isGoogle ? "Ad Group" : "Adset";
  const entityLabelPlural = isGoogle ? "Ad Groups" : "Adsets";

  const [sortKey, setSortKey] = useState<SortKey>("health_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const queryParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const initialFilter = queryParams.get("filter")?.toUpperCase() || "ALL";
  const initialCampaignId = queryParams.get("campaignId") || "ALL";

  const [filterLayer, setFilterLayer] = useState<string>("ALL");
  const [filterClassification, setFilterClassification] = useState<string>(initialFilter);
  const [filterLearning, setFilterLearning] = useState<string>("ALL");
  const [filterCampaign, setFilterCampaign] = useState<string>(initialCampaignId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const hasSelection = selectedIds.size > 0;
  const [bulkConfirm, setBulkConfirm] = useState<{ open: boolean; action: "pause" | "activate" }>({ open: false, action: "pause" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchPage, setSearchPage] = useState(1);
  const [searchPageSize, setSearchPageSize] = useState(25);
  const [dgPage, setDgPage] = useState(1);
  const [dgPageSize, setDgPageSize] = useState(25);

  const formatMetricValue = (metricKey: string, value: any, unit?: string) => {
    if (value == null || Number.isNaN(Number(value))) return "—";
    const n = Number(value);
    if (unit === "currency" || metricKey === "cpl" || metricKey === "cpm") return formatINR(n, 0);
    if (unit === "percent" || metricKey === "ctr" || metricKey === "cvr" || metricKey === "budget") return `${n.toFixed(1)}%`;
    if (metricKey === "leads") return formatNumber(n);
    if (metricKey === "freq") return n.toFixed(2);
    return formatNumber(n);
  };

  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const f = q.get("filter")?.toUpperCase();
    if (f && f !== filterClassification) setFilterClassification(f);
    const cid = q.get("campaignId");
    if (cid && cid !== filterCampaign) setFilterCampaign(cid);
  }, [window.location.hash]);

  useEffect(() => { setPage(1); setSearchPage(1); setDgPage(1); }, [filterLayer, filterClassification, filterLearning, filterCampaign]);

  const source = useMemo(() => {
    if (!data) return [];
    return isGoogle ? ((data as any)?.ad_group_analysis || []) : (data?.adset_analysis || []);
  }, [data, isGoogle]);

  const campaignList = useMemo(() => {
    if (!isGoogle || !data) return [];
    const campaigns = (data as any)?.campaigns || [];
    return campaigns.map((c: any) => ({
      id: c.id || c.campaign_id,
      name: c.name || c.campaign_name,
      type: c.campaign_type,
    }));
  }, [data, isGoogle]);

  const adsets = useMemo(() => {
    if (!source) return [];
    let list = source.map((a: any) => ({ ...a }));

    list = list.filter((a: any) => {
      const status = (a.status || "").toUpperCase();
      if (status === "ACTIVE" || status === "ENABLED" || !status) return true;
      if (status === "PAUSED" && (a.spend || a.cost || 0) > 0) return true;
      return false;
    });

    if (isGoogle && filterCampaign !== "ALL") {
      list = list.filter((a: any) => (a.campaign_id || a.campaign_name) === filterCampaign);
    }

    if (filterLayer !== "ALL") list = list.filter((a: any) => a.layer === filterLayer);
    if (filterClassification !== "ALL") list = list.filter((a: any) => a.classification === filterClassification);
    if (filterLearning !== "ALL") list = list.filter((a: any) => a.learning_status === filterLearning);

    list.sort((a: any, b: any) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
    return list;
  }, [source, data, sortKey, sortDir, filterLayer, filterClassification, filterLearning, filterCampaign, isGoogle]);

  const searchAdGroups = useMemo(() => {
    if (!isGoogle) return [];
    return adsets.filter((a: any) => a.campaign_type === "branded" || a.campaign_type === "location");
  }, [adsets, isGoogle]);

  const dgAdGroups = useMemo(() => {
    if (!isGoogle) return [];
    return adsets.filter((a: any) => a.campaign_type === "demand_gen");
  }, [adsets, isGoogle]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === adsets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(adsets.map((a: any) => isGoogle ? a.ad_group_id : a.adset_id)));
    }
  }

  async function handleBulkAction(action: "pause" | "activate") {
    setBulkConfirm({ open: false, action: "pause" });
    const getId = (a: any) => isGoogle ? a.ad_group_id : a.adset_id;
    const getName = (a: any) => isGoogle ? a.ad_group_name : a.adset_name;
    const selectedAdsets = adsets.filter((a: any) => selectedIds.has(getId(a)));
    const pauseAction = isGoogle ? "PAUSE_AD_GROUP" : "PAUSE_ADSET";
    const activateAction = isGoogle ? "ENABLE_AD_GROUP" : "UNPAUSE_ADSET";
    const actions = selectedAdsets.map((a: any) => ({
      action: action === "pause" ? pauseAction : activateAction,
      entityId: getId(a),
      entityName: getName(a),
      entityType: (isGoogle ? "ad_group" : "adset") as any,
      params: { reason: `Bulk ${action} from ${entityLabelPlural} page` },
    }));
    await executeBatch(actions);
    setSelectedIds(new Set());
  }

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  const googleAgColumns = [
    { key: "ad_group_name" as SortKey, label: "Ad Group", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "status" as SortKey, label: "Status", align: "left" },
    { key: "keywords_count" as SortKey, label: "KWs", align: "right" },
    { key: "cost" as SortKey, label: "Spend", align: "right" },
    { key: "conversions" as SortKey, label: "Leads", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "avg_cpc" as SortKey, label: "CPC", align: "right" },
    { key: "cvr" as SortKey, label: "CVR", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "impressions" as SortKey, label: "Impr", align: "right" },
    { key: "clicks" as SortKey, label: "Clicks", align: "right" },
    { key: "all_conversions" as SortKey, label: "SVs", align: "right" },
    { key: "cpsv" as SortKey, label: "CPSV", align: "right" },
    { key: "qs_avg" as SortKey, label: "QS Avg", align: "right" },
    { key: "impression_share" as SortKey, label: "IS %", align: "right" },
    { key: "top_is_pct" as SortKey, label: "Top IS %", align: "right" },
    { key: "rsa_count" as SortKey, label: "RSAs", align: "right" },
    { key: "recommendation" as SortKey, label: "Action", align: "left" },
  ];

  const googleDgAgColumns = [
    { key: "ad_group_name" as SortKey, label: "Ad Group", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "status" as SortKey, label: "Status", align: "left" },
    { key: "audience" as SortKey, label: "Audience", align: "left" },
    { key: "targeting" as SortKey, label: "Targeting", align: "left" },
    { key: "cost" as SortKey, label: "Spend", align: "right" },
    { key: "conversions" as SortKey, label: "Leads", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "cpm" as SortKey, label: "CPM", align: "right" },
    { key: "cvr" as SortKey, label: "CVR", align: "right" },
    { key: "avg_cpc" as SortKey, label: "CPC", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "impressions" as SortKey, label: "Impr", align: "right" },
    { key: "clicks" as SortKey, label: "Clicks", align: "right" },
    { key: "all_conversions" as SortKey, label: "SVs", align: "right" },
    { key: "cpsv" as SortKey, label: "CPSV", align: "right" },
    { key: "creative_count" as SortKey, label: "Ads", align: "right" },
    { key: "recommendation" as SortKey, label: "Action", align: "left" },
  ];

  const GOOGLE_SEARCH_AG_GROUPS = [
    { label: "Identity", span: 4 },
    { label: "Setup", span: 1 },
    { label: "Finance", span: 1 },
    { label: "Performance", span: 3 },
    { label: "Efficiency", span: 2 },
    { label: "Delivery", span: 2 },
    { label: "SVs", span: 2 },
    { label: "Quality", span: 4 },
  ];

  const GOOGLE_DG_AG_GROUPS = [
    { label: "Identity", span: 4 },
    { label: "Audience", span: 2 },
    { label: "Finance", span: 1 },
    { label: "Performance", span: 2 },
    { label: "Efficiency", span: 4 },
    { label: "Delivery", span: 2 },
    { label: "SVs", span: 2 },
    { label: "Setup", span: 1 },
  ];

  // Meta column groups for visual separation
  const metaColumnGroups = [
    { label: "Identity", span: 3 },
    { label: "Health", span: 2 },
    { label: "Budget", span: 3 },
    { label: "Performance", span: 2 },
    { label: "Efficiency", span: 3 },
    { label: "Delivery", span: 4 },
    { label: "", span: 2 }, // Action + Pause
  ];

  const metaColumns = [
    // Identity
    { key: "adset_name" as SortKey, label: "Adset", align: "left", group: "identity" },
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left", group: "identity" },
    { key: "layer" as SortKey, label: "Audience", align: "left", group: "identity" },
    // Health
    { key: "classification" as SortKey, label: "Class", align: "left", group: "health" },
    { key: "health_score" as SortKey, label: "Health", align: "left", group: "health" },
    // Budget
    { key: "daily_budget" as SortKey, label: "Budget", align: "right", group: "budget" },
    { key: "spend" as SortKey, label: "Spend", align: "right", group: "budget" },
    { key: "budget_utilization_pct" as SortKey, label: "Util%", align: "right", group: "budget" },
    // Performance
    { key: "leads" as SortKey, label: "Leads", align: "right", group: "perf" },
    { key: "cpl" as SortKey, label: "CPL", align: "right", group: "perf" },
    // Efficiency
    { key: "ctr" as SortKey, label: "CTR", align: "right", group: "eff" },
    { key: "cvr" as SortKey, label: "CVR", align: "right", group: "eff" },
    { key: "cpc" as SortKey, label: "CPC", align: "right", group: "eff" },
    // Delivery
    { key: "impressions" as SortKey, label: "Impr", align: "right", group: "delivery" },
    { key: "clicks" as SortKey, label: "Clicks", align: "right", group: "delivery" },
    { key: "frequency" as SortKey, label: "Freq", align: "right", group: "delivery" },
    { key: "cpm" as SortKey, label: "CPM", align: "right", group: "delivery" },
  ];

  function renderAgCell(a: any, col: { key: SortKey, align: string, label: string }, isSearch: boolean) {
    const val = a[col.key];

    if ((col.key as string) === "classification") return <td className="p-3"><StatusBadge classification={val} /></td>;
    if ((col.key as string) === "recommendation") return <td className="p-3"><Badge variant="outline" className="text-xs font-bold uppercase py-0">{val || "Hold"}</Badge></td>;
    if ((col.key as string) === "health_score") return (
      <td className="p-3">
        <ScoreIndicator score={val} breakdown={a.score_breakdown} label="Ad Group Health" description="Backend-calculated ad group health score" />
      </td>
    );
    if ((col.key as string) === "status") {
      const isActive = val === "ENABLED" || val === "ACTIVE";
      return (
        <td className="p-3">
          <Badge variant={isActive ? "outline" : "secondary"} className={`text-[11px] px-1 py-0.5 rounded font-bold uppercase w-[90px] justify-center tracking-normal ${isActive ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" : "text-red-600 bg-red-500/10 border-red-500/30"}`}>
            {val}
          </Badge>
        </td>
      );
    }

    const isPct = ["ctr", "cvr", "impression_share", "top_is_pct"].includes(col.key as string);
    const isINR = ["cost", "spend", "cpl", "avg_cpc", "cpm", "cpsv"].includes(col.key as string);

    let displayVal: React.ReactNode = val ?? "—";
    let colorClass = "";

    if (isPct) {
      displayVal = formatPct(val ?? 0);
    } else if (isINR) {
      let calcVal = val;
      if ((col.key as string) === "cpsv") {
        calcVal = val || (a.all_conversions > 0 ? a.cost / a.all_conversions : 0);
      }
      displayVal = formatINR(calcVal ?? 0, (col.key as string) === "avg_cpc" ? 2 : 0);
      if (col.key === "cpl") colorClass = getCplColor(calcVal, dynamicThresholds);
    } else if (typeof val === "number") {
      displayVal = formatNumber(val);
    }

    return (
      <td className={`p-3 text-xs tabular-nums ${col.align === "right" ? "text-right" : "text-left"} ${colorClass}`}>
        {displayVal}
      </td>
    );
  }

  function renderGoogleAgRow(a: any, columns: any[], isSearch: boolean) {
    const entityId = a.ad_group_id || a.id;
    const entityName = a.ad_group_name || a.name;
    const isPaused = isEntityPaused(entityId) || a.status === "PAUSED";
    const isSelected = selectedIds.has(entityId);
    const isExpanded = expandedIds.has(entityId);
    return (
      <Fragment key={entityId}>
        <tr className={`border-b border-border/30 hover:bg-muted/3 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""} ${isPaused ? "opacity-50" : ""} ${a.classification === "UNDERPERFORMER" ? "border-l-2 border-l-red-500" : ""}`}
          onClick={() => {
            setExpandedIds(prev => {
              const next = new Set(prev);
              if (next.has(entityId)) next.delete(entityId);
              else next.add(entityId);
              return next;
            });
          }}
        >
          <td className="p-3" onClick={(e) => e.stopPropagation()}><Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(entityId)} /></td>

          <td className="p-3 font-semibold text-foreground truncate max-w-[200px]">{entityName}</td>

          {columns.slice(1).map(col => renderAgCell(a, col, isSearch))}

          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
            <ExecutionButton action={isPaused ? "ENABLE_AD_GROUP" : "PAUSE_AD_GROUP"} entityId={entityId} entityName={entityName} entityType="ad_group" variant={(!isPaused && a.classification === "UNDERPERFORMER") ? "destructive" : "ghost"} size="icon" icon={isPaused ? <Play className="w-3.5 h-3.5 text-emerald-500" /> : <Pause className="w-3.5 h-3.5" />} />
          </td>
        </tr>
        {isExpanded && a.score_breakdown && (
          <tr className="border-b border-border/30 bg-muted/20">
            <td colSpan={columns.length + 2} className="p-4">
              <HealthScoreBreakdown
                entityName={entityName}
                scoreBreakdown={a.score_breakdown}
                scoreBands={a.score_bands}
                detailedBreakdown={a.detailed_breakdown}
              />
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  function renderAgTable(rows: any[], columns: any[], groups: any[], isSearch: boolean, pg: number, ps: number, setPg: any, setPs: any) {
    const paginatedItems = rows.slice((pg - 1) * ps, pg * ps);
    return (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="t-table w-full">
              <thead>
                {/* Pivot Group Header Row */}
                <tr className="border-b border-border/10 bg-muted/5">
                  <th className="p-0 w-8"></th>
                  <th className="p-0 w-[200px]"></th>
                  {groups.slice(0, -1).map((g, i) => (
                    <th key={i} colSpan={g.span} className="px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 last:border-0 text-center">
                      {g.label}
                    </th>
                  ))}
                  <th className="p-0"></th>
                </tr>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="p-3 w-8"><Checkbox checked={rows.length > 0 && rows.every(r => selectedIds.has(r.ad_group_id || r.id))} onCheckedChange={(c) => {
                    const ids = rows.map(r => r.ad_group_id || r.id);
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      ids.forEach(id => c ? next.add(id) : next.delete(id));
                      return next;
                    });
                  }} /></th>
                  {columns.map(col => (
                    <th
                      key={col.key}
                      className={`px-3 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground cursor-pointer border-r border-border/5 last:border-0 ${col.align === "right" ? "text-right" : "text-left"}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">{col.label} <SortIcon col={col.key} /></span>
                    </th>
                  ))}
                  <th className="px-3 py-4 t-label text-center font-bold uppercase tracking-widest text-muted-foreground">Act</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map(a => renderGoogleAgRow(a, columns, isSearch))}
                {rows.length === 0 && <tr><td colSpan={columns.length + 2} className="p-8 text-center text-muted-foreground text-xs">No entries found</td></tr>}
              </tbody>
            </table>
          </div>
          <DataTablePagination totalItems={rows.length} pageSize={ps} currentPage={pg} onPageChange={setPg} onPageSizeChange={setPs} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      <AlertDialog open={bulkConfirm.open} onOpenChange={(o) => !o && setBulkConfirm({ open: false, action: "pause" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkConfirm.action === "pause" ? "Pause" : "Activate"} {selectedIds.size} {entityLabelPlural}?</AlertDialogTitle>
            <AlertDialogDescription>This will push standard execution to the platform immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleBulkAction(bulkConfirm.action)}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="t-page-title text-foreground">{entityLabelPlural}</h1>
          <p className="text-xs text-muted-foreground"><span className="font-bold">{adsets.length}</span> active entities in current view</p>
        </div>
        <div className="flex items-center gap-2">
          {isGoogle && campaignList.length > 0 && (
            <select className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50" value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}>
              <option value="ALL">All Campaigns</option>
              {campaignList.map((c: any) => <option key={c.id} value={c.id}>{truncate(c.name, 30)}</option>)}
            </select>
          )}
          {!isGoogle && (
            <>
              <select className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50" value={filterLayer} onChange={e => setFilterLayer(e.target.value)}>
                <option value="ALL">All Layers</option>
                <option value="TOFU">TOFU</option><option value="MOFU">MOFU</option><option value="BOFU">BOFU</option>
              </select>
              <select className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50" value={filterClassification} onChange={e => setFilterClassification(e.target.value)}>
                <option value="ALL">All Scores</option>
                <option value="WINNER">Winners</option><option value="WATCH">Watch</option><option value="UNDERPERFORMER">Underperformers</option>
              </select>
            </>
          )}
        </div>
      </div>

      {hasSelection && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 animate-in slide-in-from-top-2">
          <span className="text-xs font-bold text-primary tabular-nums">{selectedIds.size} selected</span>
          <Button size="sm" variant="destructive" className="h-7 text-xs uppercase font-black" onClick={() => setBulkConfirm({ open: true, action: "pause" })}>Pause Selection</Button>
          <Button size="sm" variant="default" className="h-7 text-xs uppercase font-black bg-emerald-600" onClick={() => setBulkConfirm({ open: true, action: "activate" })}>Activate Selection</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs uppercase font-bold" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </div>
      )}

      {isGoogle ? (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-slate-950 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> Search Ad Groups
            </h2>
            {renderAgTable(searchAdGroups, googleAgColumns, GOOGLE_SEARCH_AG_GROUPS, true, searchPage, searchPageSize, setSearchPage, setSearchPageSize)}
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-500" /> Demand Gen Ad Groups
            </h2>
            {renderAgTable(dgAdGroups, googleDgAgColumns, GOOGLE_DG_AG_GROUPS, false, dgPage, dgPageSize, setDgPage, setDgPageSize)}
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="t-table w-full">
                <thead>
                  {/* Column group labels */}
                  <tr className="border-b border-border/20 bg-muted/20">
                    <th className="w-8 p-0" />
                    {metaColumnGroups.map((g, i) => (
                      <th
                        key={i}
                        colSpan={g.span}
                        className={`px-3 py-1.5 text-xs uppercase tracking-widest font-bold text-muted-foreground ${i < metaColumnGroups.length - 1 ? (i % 2 === 0 ? "text-left" : "text-right") : ""} border-r border-border/20 last:border-r-0`}
                      >
                        {g.label}
                      </th>
                    ))}
                    <th className="w-10 p-0 border-l border-border/20" />
                  </tr>
                  {/* Column headers */}
                  <tr className="border-b border-border/50">
                    <th className="p-3 w-8">
                      <Checkbox
                        checked={adsets.length > 0 && selectedIds.size === adsets.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    {metaColumns.map(col => (
                      <th
                        key={col.key}
                        className={`p-3 t-label font-bold uppercase tracking-widest text-muted-foreground cursor-pointer whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"}`}
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">{col.label} <SortIcon col={col.key} /></span>
                      </th>
                    ))}
                    <th className="p-3 t-label text-center font-bold uppercase tracking-widest text-muted-foreground w-10">Act</th>
                  </tr>
                </thead>
                <tbody>
                  {adsets.slice((page - 1) * pageSize, page * pageSize).map((a: any) => {
                    const isPaused = isEntityPaused(a.adset_id) || a.delivery_status === "PAUSED";
                    const isSelected = selectedIds.has(a.adset_id);
                    const isExpanded = expandedIds.has(a.adset_id);

                    // Compute derived metrics
                    const cvr = a.cvr ?? (a.clicks > 0 && a.leads > 0 ? (a.leads / a.clicks) * 100 : 0);
                    const cpc = a.cpc ?? (a.clicks > 0 ? a.spend / a.clicks : 0);
                    const cpm = a.cpm ?? (a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0);

                    return (
                      <Fragment key={a.adset_id}>
                        <tr
                          className={`border-b border-border/20 hover:bg-muted/5 transition-colors cursor-pointer
                            ${isSelected ? "bg-primary/5" : ""}
                            ${isPaused ? "opacity-50" : ""}
                            ${a.classification === "UNDERPERFORMER" ? "border-l-2 border-l-red-500" : ""}
                            ${a.should_pause ? "bg-red-500/3" : ""}
                          `}
                          onClick={() => {
                            setExpandedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(a.adset_id)) next.delete(a.adset_id);
                              else next.add(a.adset_id);
                              return next;
                            });
                          }}
                        >
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(a.adset_id)} />
                          </td>

                          {/* adset_name */}
                          <td className="p-3 max-w-[180px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="font-medium text-foreground text-xs truncate cursor-default">
                                  {a.adset_name}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">{a.adset_name}</TooltipContent>
                            </Tooltip>
                            {a.learning_status && a.learning_status !== "ACTIVE" && (
                              <span className={`text-xs font-bold uppercase ${getLearningStatusColor(a.learning_status)}`}>
                                {a.learning_status.replace(/_/g, " ")}
                              </span>
                            )}
                          </td>

                          {/* campaign_name */}
                          <td className="p-3 max-w-[140px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="text-[11px] text-slate-500 truncate">{a.campaign_name || "—"}</p>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="text-xs">{a.campaign_name || "—"}</p>
                              </TooltipContent>
                            </Tooltip>
                          </td>

                          {/* layer */}
                          <td className="p-3">
                            <Badge variant="outline" className={`text-xs font-black uppercase px-1.5 py-0 ${getLayerColor(a.layer)}`}>
                              {a.layer || "—"}
                            </Badge>
                          </td>

                          {/* classification */}
                          <td className="p-3">
                            <StatusBadge classification={a.classification} />
                          </td>

                          {/* health_score */}
                          <td className="p-3">
                            <ScoreIndicator
                              score={a.health_score}
                              breakdown={a.score_breakdown}
                              detailedBreakdown={a.detailed_breakdown}
                              label="Adset Health"
                              description="Backend-calculated adset health score"
                            />
                          </td>

                          {/* daily_budget */}
                          <td className="p-3 text-right tabular-nums text-xs">
                            {a.daily_budget > 0 ? formatINR(a.daily_budget, 0) : "—"}
                          </td>

                          {/* spend */}
                          <td className="p-3 text-right tabular-nums text-xs font-bold">
                            {formatINR(a.spend ?? 0, 0)}
                          </td>

                          {/* budget_utilization_pct */}
                          <td className="p-3 text-right tabular-nums text-xs">
                            {a.budget_utilization_pct > 0 ? (
                              <span className={
                                a.budget_utilization_pct > 90 ? "text-red-400 font-bold" :
                                  a.budget_utilization_pct > 70 ? "text-amber-400" :
                                    "text-muted-foreground"
                              }>
                                {a.budget_utilization_pct.toFixed(0)}%
                              </span>
                            ) : "—"}
                          </td>

                          {/* leads */}
                          <td className="p-3 text-right tabular-nums text-xs font-bold">
                            <span className={
                              (a.leads ?? 0) >= 5 ? "text-emerald-400" :
                                (a.leads ?? 0) >= 1 ? "text-amber-400" :
                                  "text-muted-foreground"
                            }>
                              {a.leads ?? 0}
                            </span>
                          </td>

                          {/* cpl */}
                          <td className={`p-3 text-right tabular-nums text-xs font-black ${(a.leads ?? 0) > 0 ? getCplColor(a.cpl, dynamicThresholds) : "text-muted-foreground"}`}>
                            {(a.leads ?? 0) > 0 ? formatINR(a.cpl ?? 0, 0) : "—"}
                          </td>

                          {/* ctr */}
                          <td className="p-3 text-right tabular-nums text-xs">
                            <span className={
                              !isGoogle
                                ? getCtrColorWithBenchmarks(a.ctr ?? 0, metaBenchmarks.raw)
                                : (a.ctr ?? 0) >= 1 ? "text-emerald-400 font-bold" :
                                  (a.ctr ?? 0) >= 0.5 ? "text-amber-400" :
                                    "text-muted-foreground"
                            }>
                              {(a.ctr ?? 0) > 0 ? formatPct(a.ctr) : "—"}
                            </span>
                          </td>

                          {/* cvr */}
                          <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">
                            {cvr > 0 ? `${cvr.toFixed(2)}%` : "—"}
                          </td>

                          {/* cpc */}
                          <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">
                            {cpc > 0 ? formatINR(cpc, 0) : "—"}
                          </td>

                          {/* impressions */}
                          <td className="p-3 text-right tabular-nums text-xs">
                            {(a.impressions ?? 0) > 0 ? formatNumber(a.impressions) : "—"}
                          </td>

                          {/* clicks */}
                          <td className="p-3 text-right tabular-nums text-xs">
                            {(a.clicks ?? 0) > 0 ? formatNumber(a.clicks) : "—"}
                          </td>

                          {/* frequency */}
                          <td className="p-3 text-right tabular-nums text-xs">
                            {(a.frequency ?? 0) > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={`cursor-default ${!isGoogle
                                    ? getFrequencyColorWithBenchmarks(a.frequency ?? 0, metaBenchmarks.raw)
                                    : (a.frequency ?? 0) > 3 ? "text-red-400 font-bold" : (a.frequency ?? 0) > 2 ? "text-amber-400" : ""}`}>
                                    {(a.frequency ?? 0).toFixed(2)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  {(a.frequency ?? 0) > (metaBenchmarks.frequencySevere || 2.5) ? "High frequency — creative fatigue risk" :
                                    (a.frequency ?? 0) > (metaBenchmarks.frequencyWarn || 1.8) ? "Monitor — approaching fatigue threshold" :
                                      "Frequency within healthy range"}
                                </TooltipContent>
                              </Tooltip>
                            ) : "—"}
                          </td>

                          {/* cpm */}
                          <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">
                            {cpm > 0 ? formatINR(cpm, 0) : "—"}
                          </td>

                          {/* Pause / Activate action */}
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <ExecutionButton
                              action={isPaused ? "UNPAUSE_ADSET" : "PAUSE_ADSET"}
                              entityId={a.adset_id}
                              entityName={a.adset_name}
                              entityType="adset"
                              variant={(!isPaused && a.classification === "UNDERPERFORMER") ? "destructive" : "ghost"}
                              size="icon"
                              icon={isPaused
                                ? <Play className="w-3.5 h-3.5 text-emerald-500" />
                                : <Pause className="w-3.5 h-3.5" />
                              }
                            />
                          </td>
                        </tr>
                        {isExpanded && a.score_breakdown && (
                          <tr className="border-b border-border/30 bg-muted/20">
                            <td colSpan={20} className="p-4">
                              <HealthScoreBreakdown
                                entityName={a.adset_name}
                                scoreBreakdown={a.score_breakdown}
                                detailedBreakdown={a.detailed_breakdown}
                                scoreBands={a.score_bands}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {adsets.length === 0 && (
                    <tr>
                      <td colSpan={metaColumns.length + 2} className="p-10 text-center text-muted-foreground text-xs">
                        No active adsets found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <DataTablePagination
              totalItems={adsets.length}
              pageSize={pageSize}
              currentPage={page}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
