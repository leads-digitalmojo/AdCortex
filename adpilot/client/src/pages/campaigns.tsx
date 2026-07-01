import { useState, useMemo, useEffect, Fragment } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
import type { CampaignAudit } from "@shared/schema";
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
import { ArrowUpDown, ChevronDown, ChevronUp, AlertCircle, Pause, Play, TrendingUp, TrendingDown, Loader2, SlidersHorizontal, BarChart3, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { ScoreIndicator } from "@/components/score-indicator";
import { HealthScoreBreakdown } from "@/components/health-score-breakdown";
import {
  formatINR,
  formatPct,
  formatNumber,
  getHealthBgColor,
  getHealthBarBg,
  getLayerColor,
  getClassificationColor,
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
import { UnifiedActions } from "@/components/unified-actions";
import { usePausedEntities } from "@/hooks/use-paused-entities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type SortKey = keyof CampaignAudit;
type SortDir = "asc" | "desc";

// ─── Google campaign type badge colors ──────────────────────────────
function getCampaignTypeBadge(type: string): { bg: string; text: string; label: string } {
  const t = (type || "").toLowerCase();
  if (t === "branded") return { bg: "bg-amber-500/15", text: "text-amber-600", label: "Branded" };
  if (t === "location" || t.startsWith("location")) return { bg: "bg-emerald-500/15", text: "text-emerald-600", label: "Location" };
  if (t === "demand_gen" || t === "dg" || t.includes("demand_gen")) return { bg: "bg-purple-500/15", text: "text-purple-600", label: "Demand Gen" };
  if (t === "search") return { bg: "bg-blue-500/15", text: "text-blue-600", label: "Search" };
  
  // Default fallback for other types
  const label = (type || "—").toString().replace(/_/g, " ");
  return { bg: "bg-gray-500/15", text: "text-gray-600", label: label };
}

// ─── Health score methodology tooltip ───────────────────────────────
function HealthMethodology() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3 h-3 text-muted-foreground cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs space-y-1">
          <p className="font-medium">Health Score Methodology</p>
          <p>Weighted composite of performance metrics (CPL, CTR, CVR, Efficiency) vs established benchmarks. Leads and Budget pacing are excluded from health scoring but tracked for table delivery.</p>
          <p className="text-muted-foreground">Benchmarks are derived from account-level health and cross-entity performance history if not explicitly set.</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

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

export default function CampaignsPage() {
  const {
    analysisData: data,
    isLoadingAnalysis: isLoading,
    activePlatform,
    activeClient,
    benchmarks
  } = useClient();
  const { executeBatch, isExecuting } = useExecution();
  const { isPaused: isEntityPaused } = usePausedEntities();
  const isGoogle = activePlatform === "google";
  const apiBase = `/api/clients/${activeClient?.id}/${activePlatform}`;

  const [sortKey, setSortKey] = useState<SortKey>("health_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterLayer, setFilterLayer] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterClassification, setFilterClassification] = useState<string>("ALL");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{ open: boolean; action: "pause" | "activate" }>({ open: false, action: "pause" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchPage, setSearchPage] = useState(1);
  const [searchPageSize, setSearchPageSize] = useState(25);
  const [dgPage, setDgPage] = useState(1);
  const [dgPageSize, setDgPageSize] = useState(25);

  const queryClient = useQueryClient();

  // Use centralized benchmarks hook for reactive updates
  const metaBenchmarks = useMetaBenchmarks();
  const dynamicThresholds = useDynamicThresholds();

  // Refetch campaign data when benchmarks change (for Meta only)
  useEffect(() => {
    if (!isGoogle && activeClient?.id && metaBenchmarks.raw && Object.keys(metaBenchmarks.raw).length > 0) {
      // Invalidate analysis queries to trigger refetch with new benchmarks
      queryClient.invalidateQueries({ queryKey: [apiBase, "analysis"] });
    }
  }, [metaBenchmarks.raw, isGoogle, activeClient?.id, apiBase, queryClient]);

  const getTargetCpl = (c: any) => {
    return metaBenchmarks.cplTarget;
  };

  const formatMetricValue = (metricKey: string, value: any, unit?: string) => {
    if (value == null || Number.isNaN(Number(value))) return "—";
    const n = Number(value);
    if (unit === "currency" || metricKey === "cpl" || metricKey === "cpm") return formatINR(n, 0);
    if (unit === "percent" || metricKey === "ctr" || metricKey === "cvr" || metricKey === "budget") return `${n.toFixed(1)}%`;
    if (metricKey === "leads") return formatNumber(n);
    if (metricKey === "freq") return n.toFixed(2);
    return formatNumber(n);
  };

  // campaign classification is now derived from the unified intelligence pipeline
  const getClassification = (c: any) => {
    return c.classification || "WATCH";
  };

  const campaigns = useMemo(() => {
    if (!data) return [];
    const source = (data as any).campaign_audit || (data as any).campaigns || [];
    if (!source) return [];
    let list = source.map((c: any) => ({ ...c }));

    if (filterLayer !== "ALL") {
      const fl = filterLayer.toLowerCase();
      list = list.filter((c: any) => {
        const l = (c.layer || "").toLowerCase();
        const ct = (c.campaign_type || "").toLowerCase();
        return l.includes(fl) || ct.includes(fl);
      });
    }
    if (filterStatus !== "ALL") {
      list = list.filter((c: any) => {
        const s = (c.status || "").toUpperCase();
        if (filterStatus === "ACTIVE") return s === "ACTIVE" || s === "ENABLED";
        return s === filterStatus;
      });
    }
    if (filterClassification !== "ALL") list = list.filter((c: any) => c.classification === filterClassification);
    list.sort((a: any, b: any) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return list;
  }, [data, sortKey, sortDir, filterLayer, filterStatus, filterClassification]);

  // Google-specific: split campaigns into Search and DG
  const searchCampaigns = useMemo(() => {
    if (!isGoogle) return [];
    return campaigns.filter((c: any) => {
      const t = (c.theme || c.layer || c.campaign_type || "").toLowerCase();
      return t.includes("branded") || t.includes("location") || t === "search";
    });
  }, [campaigns, isGoogle]);

  const getScoreColor = (c: any, metric: string, rawValColor?: string) => {
    const score = c.score_breakdown?.[metric];
    if (score == null) return rawValColor || "text-foreground";
    if (score >= 85) return "text-emerald-400";
    if (score >= 70) return "text-emerald-400";
    if (score >= 40) return "text-amber-400";
    return "text-red-400";
  };

  const dgCampaigns = useMemo(() => {
    if (!isGoogle) return [];
    return campaigns.filter((c: any) => {
      const t = (c.theme || c.layer || c.campaign_type || "").toLowerCase();
      return t.includes("demand") || t.includes("dg") || t.includes("demand_gen");
    });
  }, [campaigns, isGoogle]);


  // Search and DG summaries
  const searchSummary = isGoogle ? (data as any)?.search_summary : null;
  const dgSummary = isGoogle ? (data as any)?.dg_summary : null;

  // Reset page to 1 when filters change
  useEffect(() => { setPage(1); setSearchPage(1); setDgPage(1); }, [filterLayer, filterStatus, filterClassification]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === campaigns.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(campaigns.map((c: any) => c.campaign_id)));
    }
  }

  async function handleBulkAction(action: "pause" | "activate") {
    setBulkConfirm({ open: false, action: "pause" });
    const selected = campaigns.filter((c: any) => selectedIds.has(c.campaign_id));
    const activateAction = isGoogle ? "ENABLE_CAMPAIGN" : "UNPAUSE_CAMPAIGN";
    const actions = selected.map((c: any) => ({
      action: action === "pause" ? "PAUSE_CAMPAIGN" : activateAction,
      entityId: c.campaign_id,
      entityName: c.campaign_name,
      entityType: "campaign" as const,
      params: { reason: `Bulk ${action} from Campaigns page` },
    }));
    await executeBatch(actions);
    setSelectedIds(new Set());
  }

  // Use live benchmarks for thresholds - falls back to data.dynamic_thresholds if needed
  const thresholds = useMemo(() => {
    return dynamicThresholds || data?.dynamic_thresholds;
  }, [dynamicThresholds, data?.dynamic_thresholds]);

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  const hasSelection = selectedIds.size > 0;

  // ─── Column Groupings (Pivot Table Style) ─────────────────────────
  const googleSearchGroups = [
    { label: "Identity", span: 3 },
    { label: "Health", span: 2 },
    { label: "Bidding & Budget", span: 3 },
    { label: "Performance", span: 4 },
    { label: "Efficiency", span: 3 },
    { label: "Delivery", span: 3 },
    { label: "", span: 1 }, // Actions
  ];

  const googleDgGroups = [
    { label: "Identity", span: 3 },
    { label: "Health", span: 2 },
    { label: "Bidding & Budget", span: 2 },
    { label: "Performance", span: 4 },
    { label: "Efficiency", span: 3 },
    { label: "", span: 1 }, // Actions
  ];

  const metaColumnGroups = [
    { label: "Identity", span: 5 },
    { label: "Health", span: 1 },
    { label: "Bidding & Budget", span: 1 },
    { label: "Performance", span: 3 },
    { label: "Efficiency", span: 3 },
    { label: "Delivery", span: 2 },
    { label: "", span: 1 }, // Actions
  ];

  const googleSearchColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "campaign_type" as SortKey, label: "Type", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "status" as SortKey, label: "Status", align: "left" },
    { key: "bidding_strategy" as SortKey, label: "Bidding", align: "left" },
    { key: "target_cpa" as SortKey, label: "tCPA", align: "right" },
    { key: "daily_budget" as SortKey, label: "Budget", align: "right" },
    { key: "spend" as SortKey, label: "Spend", align: "right" },
    { key: "impressions" as SortKey, label: "Impr.", align: "right" },
    { key: "clicks" as SortKey, label: "Clicks", align: "right" },
    { key: "leads" as SortKey, label: "Leads", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "cvr" as SortKey, label: "CVR", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "search_impression_share" as SortKey, label: "Imp. Share", align: "right" },
    { key: "search_rank_lost_is" as SortKey, label: "Rank Lost", align: "right" },
    { key: "search_budget_lost_is" as SortKey, label: "Budg. Lost", align: "right" },
  ];

  const googleDgColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "campaign_type" as SortKey, label: "Type", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "status" as SortKey, label: "Status", align: "left" },
    { key: "bidding_strategy" as SortKey, label: "Bidding", align: "left" },
    { key: "daily_budget" as SortKey, label: "Budget", align: "right" },
    { key: "spend" as SortKey, label: "Spend", align: "right" },
    { key: "leads" as SortKey, label: "Leads", align: "right" },
    { key: "tsr" as SortKey, label: "TSR", align: "right" },
    { key: "vhr" as SortKey, label: "VHR", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "cvr" as SortKey, label: "CVR", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
  ];

  const metaColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "layer" as SortKey, label: "Layer", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "learning_status" as SortKey, label: "Learn", align: "left" },
    { key: "delivery_status" as SortKey, label: "Deliv", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "daily_budget" as SortKey, label: "Budget", align: "right" },
    { key: "spend" as SortKey, label: "Spend", align: "right" },
    { key: "leads" as SortKey, label: "Leads", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "cpc" as SortKey, label: "CPC", align: "right" },
    { key: "cpm" as SortKey, label: "CPM", align: "right" },
    { key: "frequency" as SortKey, label: "Freq", align: "right" },
    { key: "budget_utilization_pct" as SortKey, label: "Utility", align: "right" },
  ];

  // ─── Render a campaign table cell (reusable helper) ───────────────
  function renderCell(c: any, col: { key: SortKey, align: string, label: string }, sectionType: "search" | "dg") {
    const isSearch = sectionType === "search";

    const val = c[col.key];

    // Edge case handling
    const impressions = c.impressions || 0;
    const health = c.health_score || 0;

    if (col.key === "campaign_type") {
      const typeInfo = getCampaignTypeBadge(val);
      return (
        <td key={col.key} className="p-3">
          <Badge variant="outline" className={`${typeInfo.bg} ${typeInfo.text} border-transparent text-[11px] uppercase font-bold w-[90px] justify-center py-0.5 tracking-normal`}>
            {typeInfo.label}
          </Badge>
        </td>
      );
    }

    if (col.key === "status") {
      const isActive = val === "ENABLED" || val === "ACTIVE";
      return (
        <td key={col.key} className="p-3">
          <Badge variant={isActive ? "outline" : "secondary"} className={`text-[11px] px-1 py-0.5 rounded font-bold uppercase w-[90px] justify-center tracking-normal ${isActive ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" : "text-red-600 bg-red-500/10 border-red-500/30"}`}>
            {val}
          </Badge>
        </td>
      );
    }

    if (col.key === "classification") return <td key={col.key} className="p-3"><StatusBadge classification={val} /></td>;

    if (col.key === "health_score") return (
      <td key={col.key} className="p-3">
        <ScoreIndicator
          score={health}
          detailedBreakdown={(c as any).detailed_breakdown}
          label={isSearch ? "Search Health" : "DG Health"}
        />
      </td>
    );

    if (col.key === "bidding_strategy") return (
      <td key={col.key} className="p-3 text-[8px] text-muted-foreground uppercase tracking-tight leading-tight max-w-[100px]">
        {(val || "—").toString().replace(/_/g, " ")}
      </td>
    );

    const rowIsPct = ["ctr", "cvr", "search_impression_share", "search_rank_lost_is", "search_budget_lost_is", "top_is", "tsr", "vhr", "ptr"].includes(col.key as string);
    const rowIsINR = ["daily_budget", "cost", "spend", "cpl", "avg_cpc", "average_cpm", "target_cpa", "cpsv"].includes(col.key as string);

    let displayVal: React.ReactNode = val ?? "—";
    let colorClass = "";

    if (rowIsPct) {
      if (impressions === 0 && ["ctr", "cvr"].includes(col.key as string)) return <td key={col.key} className="p-3 text-right text-muted-foreground text-xs">No Delivery</td>;

      if (typeof val === "number") {
        const pctValue = val < 1 && val > 0 ? val * 100 : val;
        displayVal = `${pctValue.toFixed(col.key === "ctr" ? 2 : 1)}%`;

        if (col.key === "ctr") {
          const rawCtr = val < 1 ? val : val / 100;
          colorClass = rawCtr >= (isSearch ? 0.015 : 0.008) ? "text-emerald-400" : rawCtr >= 0.004 ? "text-amber-400" : "text-red-400";
        } else if (col.key === "search_budget_lost_is") {
          colorClass = pctValue > 30 ? "text-red-400" : pctValue > 10 ? "text-amber-400" : "text-emerald-400";
        }
      }
    } else if (rowIsINR) {
      if (col.key === "cpl" && (c.leads || c.conversions || 0) === 0 && (c.spend || c.cost || 0) > 0) {
        displayVal = "∞";
        colorClass = "text-red-400";
      } else {
        displayVal = formatINR(val ?? 0, ((col.key as string) === "avg_cpc" || (col.key as string) === "average_cpm") ? 2 : 0);
        if (col.key === "cpl") {
          colorClass = getCplColor(val, thresholds);
        }
      }
    } else if (typeof val === "number") {
      displayVal = formatNumber(val);
    }

    return (
      <td key={col.key} className={`p-3 text-xs tabular-nums ${col.align === "right" ? "text-right" : "text-left"} ${colorClass}`}>
        {displayVal}
      </td>
    );
  }


  function renderGoogleRow(c: any, sectionType: "search" | "dg") {
    const isPaused = c.status === "PAUSED" || c.delivery_status === "NOT_DELIVERING" || isEntityPaused(c.campaign_id);
    const isSelected = selectedIds.has(c.campaign_id);
    const isExpanded = expandedIds.has(c.campaign_id);
    const columns = sectionType === "search" ? googleSearchColumns : googleDgColumns;

    return (
      <Fragment key={c.campaign_id || c.id}>
        <tr
          key={c.campaign_id}
          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""
            } ${isPaused ? "opacity-50" : ""} ${getClassification(c) === "UNDERPERFORMER" ? "border-l-4 border-l-red-500" : ""}`}
          onClick={() => {
            setExpandedIds(prev => {
              const next = new Set(prev);
              if (next.has(c.campaign_id)) next.delete(c.campaign_id);
              else next.add(c.campaign_id);
              return next;
            });
          }}
          data-testid={`row-campaign-${c.campaign_id}`}
        >
          <td className="p-3" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelect(c.campaign_id)}
              data-testid={`checkbox-campaign-${c.campaign_id}`}
            />
          </td>

          {/* Main Table Body: Render all columns via renderCell */}
          {columns.map(col => {
            if (col.key === "campaign_name") {
              return (
                <td key={col.key} className="p-3 max-w-[200px]">
                  <div className="flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate block cursor-default text-foreground font-semibold">
                          {truncate(c.campaign_name || c.name, 30)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs max-w-sm">{c.campaign_name || c.name}</p>
                      </TooltipContent>
                    </Tooltip>
                    {isPaused && (
                      <Badge variant="secondary" className="text-xs px-1 py-0 text-red-400 shrink-0">PAUSED</Badge>
                    )}
                  </div>
                </td>
              );
            }
            return renderCell(c, col, sectionType);
          })}

          {/* Execution Actions Cell */}
          <td className="p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 justify-center">
              {!isPaused ? (
                <ExecutionButton
                  action="PAUSE_CAMPAIGN"
                  entityId={c.campaign_id || c.id}
                  entityName={c.campaign_name || c.name}
                  entityType="campaign"
                  label=""
                  variant={getClassification(c) === "UNDERPERFORMER" ? "destructive" : "ghost"}
                  size="icon"
                  icon={<Pause className="w-3.5 h-3.5" />}
                  confirmMessage={`Pause campaign "${c.campaign_name || c.name}"?`}
                  params={{ reason: "Manual pause from Campaigns page" }}
                  className="h-7 w-7"
                  data-testid={`button-pause-campaign-${c.campaign_id || c.id}`}
                />
              ) : (
                <ExecutionButton
                  action="ENABLE_CAMPAIGN"
                  entityId={c.campaign_id || c.id}
                  entityName={c.campaign_name || c.name}
                  entityType="campaign"
                  label=""
                  variant="ghost"
                  size="icon"
                  icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                  confirmMessage={`Activate campaign "${c.campaign_name || c.name}"?`}
                  params={{ reason: "Manual activation from Campaigns page" }}
                  className="h-7 w-7"
                  data-testid={`button-activate-campaign-${c.campaign_id || c.id}`}
                />
              )}
              {!isPaused && (
                <ExecutionButton
                  action="SCALE_BUDGET_UP"
                  entityId={c.campaign_id || c.id}
                  entityName={c.campaign_name || c.name}
                  entityType="campaign"
                  label=""
                  variant="ghost"
                  size="icon"
                  icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
                  confirmMessage={`Scale up budget by 20% on "${c.campaign_name || c.name}"?\nCurrent daily budget: ${formatINR(c.daily_budget || 0, 0)}`}
                  params={{ scalePercent: 20, reason: "Manual scale up from Campaigns page" }}
                  className="h-7 w-7"
                  data-testid={`button-scaleup-campaign-${c.campaign_id || c.id}`}
                />
              )}
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr key={`${c.campaign_id}-expanded`} className="border-b border-border/30 bg-muted/20">
            <td colSpan={columns.length + 2} className="p-4">
              {c.score_breakdown ? (
                <HealthScoreBreakdown
                  entityName={c.campaign_name || c.name}
                  scoreBreakdown={c.score_breakdown}
                  detailedBreakdown={(c as any).detailed_breakdown}
                  scoreBands={c.score_bands}
                />
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="p-2 rounded-md bg-card border border-border/30">
                    <p className="text-xs text-muted-foreground">CTR</p>
                    <p className="text-base font-semibold tabular-nums">{formatPct(c.ctr || 0)}</p>
                  </div>
                  <div className="p-2 rounded-md bg-card border border-border/30">
                    <p className="text-xs text-muted-foreground">CVR</p>
                    <p className="text-base font-semibold tabular-nums">{c.cvr != null ? formatPct(c.cvr) : "—"}</p>
                  </div>
                  <div className="p-2 rounded-md bg-card border border-border/30">
                    <p className="text-xs text-muted-foreground">CPL</p>
                    <p className="text-base font-semibold tabular-nums">{(c.cpl || 0) > 0 ? formatINR(c.cpl, 0) : "—"}</p>
                  </div>
                  <div className="p-2 rounded-md bg-card border border-border/30">
                    <p className="text-xs text-muted-foreground">Cost Stack</p>
                    <p className="text-base font-semibold">{c.cost_stack?.overall || "—"}</p>
                  </div>
                  <div className="p-2 rounded-md bg-card border border-border/30">
                    <p className="text-xs text-muted-foreground">Scoring Weights</p>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <p>{isGoogle ? "CPL · CVR · CTR · IS · QS" : "CPL · CPM · CTR · CVR · Freq"}</p>
                      <p>Leads & Budget pacing excluded</p>
                    </div>
                  </div>
                </div>
              )}
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  // ─── Google campaign table (used for each section) ────────────────
  function renderGoogleTable(rows: any[], sectionId: string, sectionType: "search" | "dg", pg: number, pgSize: number, setPg: (p: number) => void, setPgSize: (s: number) => void) {
    const columns = sectionType === "search" ? googleSearchColumns : googleDgColumns;
    const paginatedRows = pgSize >= rows.length ? rows : rows.slice((pg - 1) * pgSize, pg * pgSize);

    // Group columns for header
    const groups: Record<string, number> = {};
    columns.forEach(c => {
      const g = (c as any).group || "Other";
      groups[g] = (groups[g] || 0) + 1;
    });

    return (
      <Card>
        <CardContent className="card-content-premium p-0">
          <div className="overflow-x-auto">
            <table className="t-table w-full" data-testid={`table-${sectionId}`}>
              <thead>
                {/* Pivot Group Header Row */}
                <tr className="border-b border-border/10 bg-muted/5">
                  <th className="p-0 w-8"></th>
                  {(sectionType === "search" ? googleSearchGroups : googleDgGroups).map((g, i) => (
                    <th key={i} colSpan={g.span} className="px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 last:border-0 text-center">
                      {g.label}
                    </th>
                  ))}
                  <th className="p-0 w-10"></th>
                </tr>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="p-3 w-8">
                    <div className="flex flex-col gap-2">
                      <Checkbox
                        checked={rows.length > 0 && rows.every((c: any) => selectedIds.has(c.campaign_id || c.id))}
                        onCheckedChange={() => {
                          const ids = rows.map((c: any) => c.campaign_id || c.id);
                          const allSelected = ids.every((id) => selectedIds.has(id));
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
                            return next;
                          });
                        }}
                      />
                    </div>
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 t-label font-bold uppercase tracking-widest text-muted-foreground cursor-pointer select-none whitespace-nowrap border-r border-border/5 last:border-0 ${col.align === "right" ? "text-right" : "text-left"
                        }`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.label === "Health" && <HealthMethodology />}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground text-center whitespace-nowrap">
                    Act
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((c: any) => renderGoogleRow(c, sectionType))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 2} className="p-8 text-center text-xs text-muted-foreground">
                      No campaigns in this section.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DataTablePagination
            totalItems={rows.length}
            pageSize={pgSize}
            currentPage={pg}
            onPageChange={setPg}
            onPageSizeChange={setPgSize}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      {/* Bulk Action Confirm */}
      <AlertDialog open={bulkConfirm.open} onOpenChange={(o) => { if (!o) setBulkConfirm({ open: false, action: "pause" }); }}>
        <AlertDialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              {bulkConfirm.action === "pause" ? "Pause" : "Activate"} {selectedIds.size} Campaigns?
            </AlertDialogTitle>
            <AlertDialogDescription className="t-body">
              This will {bulkConfirm.action === "pause" ? "pause" : "activate"} {selectedIds.size} selected campaign{selectedIds.size !== 1 ? "s" : ""} on {isGoogle ? "Google Ads" : "Meta Ads"}.
              {bulkConfirm.action === "pause" && (
                <span className="block mt-1 text-amber-500">Paused campaigns will stop delivering immediately.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-bulk-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleBulkAction(bulkConfirm.action)} data-testid="button-bulk-confirm">
              {bulkConfirm.action === "pause" ? "Pause All" : "Activate All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-page-title text-foreground">Campaigns</h1>
          <p className="t-caption text-muted-foreground">
            <span className="font-bold">{campaigns.length}</span> campaigns · <span className="font-bold">{formatINR((data as any).summary?.total_spend || (data as any).account_pulse?.total_spend || 0, 0)}</span> total spend
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterLayer}
            onChange={(e) => setFilterLayer(e.target.value)}
            data-testid="select-filter-layer"
          >
            {isGoogle ? (
              <>
                <option value="ALL">All Types</option>
                <option value="branded">Branded</option>
                <option value="location">Location</option>
                <option value="demand_gen">Demand Gen</option>
              </>
            ) : (
              <>
                <option value="ALL">All Layers</option>
                <option value="TOFU">TOFU</option>
                <option value="MOFU">MOFU</option>
                <option value="BOFU">BOFU</option>
              </>
            )}
          </select>
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            data-testid="select-filter-status"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
          </select>
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterClassification}
            onChange={(e) => setFilterClassification(e.target.value)}
            data-testid="select-filter-classification"
          >
            <option value="ALL">All Classifications</option>
            <option value="WINNER">Winner</option>
            <option value="WATCH">Watch</option>
            <option value="UNDERPERFORMER">Underperformer</option>
          </select>
        </div>
      </div>

      {/* Bulk action toolbar */}
      {hasSelection && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            variant="destructive"
            className="t-caption"
            onClick={() => setBulkConfirm({ open: true, action: "pause" })}
            disabled={isExecuting}
            data-testid="button-bulk-pause"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
            Pause Selected
          </Button>
          <Button
            size="sm"
            variant="default"
            className="text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setBulkConfirm({ open: true, action: "activate" })}
            disabled={isExecuting}
            data-testid="button-bulk-activate"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
            Activate Selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="t-caption"
            onClick={() => setSelectedIds(new Set())}
            data-testid="button-clear-selection"
          >
            Clear
          </Button>
        </div>
      )}

      {/* ─── Google: Split into Search + DG sections ─────────────── */}
      {isGoogle ? (
        <div className="space-y-6">
          {/* Search Campaigns Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Search Campaigns (Branded + Location)</h2>
                {searchSummary && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-bold">{searchSummary.campaign_count}</span> campaigns · Spend <span className="font-bold">{formatINR(searchSummary.spend, 0)}</span> · Leads <span className="font-bold">{searchSummary.leads}</span> · CPL <span className="font-bold">{formatINR(searchSummary.cpl, 0)}</span> · CTR <span className="font-bold">{formatPct(searchSummary.ctr)}</span> · CVR <span className="font-bold">{formatPct(searchSummary.cvr)}</span>
                  </p>
                )}
              </div>
            </div>
            {renderGoogleTable(searchCampaigns, "search-campaigns", "search", searchPage, searchPageSize, setSearchPage, setSearchPageSize)}
          </div>

          {/* DG Campaigns Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Demand Gen Campaigns</h2>
                {dgSummary && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-bold">{dgSummary.campaign_count}</span> campaigns · Spend <span className="font-bold">{formatINR(dgSummary.spend, 0)}</span> · Leads <span className="font-bold">{dgSummary.leads}</span> · CPL <span className="font-bold">{formatINR(dgSummary.cpl, 0)}</span> · CTR <span className="font-bold">{formatPct(dgSummary.ctr)}</span> · CVR <span className="font-bold">{formatPct(dgSummary.cvr)}</span>
                    {dgSummary.video_metrics_aggregate && (
                      <> · TSR {dgSummary.video_metrics_aggregate.tsr_avg}% · VHR {dgSummary.video_metrics_aggregate.vhr_avg}%</>
                    )}
                  </p>
                )}
              </div>
            </div>
            {renderGoogleTable(dgCampaigns, "dg-campaigns", "dg", dgPage, dgPageSize, setDgPage, setDgPageSize)}
          </div>
        </div>
      ) : (
        /* ─── Meta: Original single table ──────────────────────────── */
        <Card>
          <CardContent className="card-content-premium p-0">
            <div className="overflow-x-auto">
              <table className="t-table w-full">
                <thead>
                  {/* Pivot Group Header Row */}
                  <tr className="border-b border-border/10 bg-muted/5">
                    <th className="p-0 w-8"></th>
                    {metaColumnGroups.map((g, i) => (
                      <th key={i} colSpan={g.span} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 last:border-0 text-center">
                        {g.label}
                      </th>
                    ))}
                    <th className="p-0 w-10"></th>
                  </tr>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="p-3 w-8">
                      <div className="flex flex-col gap-2">
                        <Checkbox
                          checked={campaigns.length > 0 && selectedIds.size === campaigns.length}
                          onCheckedChange={toggleSelectAll}
                          data-testid="checkbox-select-all"
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-4 w-4 opacity-50 hover:opacity-100">
                              <SlidersHorizontal className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => setColumnSize("compact")}>Compact Width</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setColumnSize("normal")}>Normal Width</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setColumnSize("wide")}>Wide Width</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </th>
                    {metaColumns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-4 py-4 t-label font-black uppercase tracking-widest text-muted-foreground cursor-pointer select-none whitespace-nowrap border-r border-border/5 last:border-0 ${col.align === "right" ? "text-right" : "text-left"
                          }`}
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          <SortIcon col={col.key} />
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-4 t-label font-black uppercase tracking-widest text-muted-foreground text-center whitespace-nowrap">
                      Act
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(pageSize >= campaigns.length ? campaigns : campaigns.slice((page - 1) * pageSize, page * pageSize)).map((c: any) => {
                    const isPaused = c.status === "PAUSED" || c.delivery_status === "NOT_DELIVERING" || isEntityPaused(c.campaign_id);
                    const isSelected = selectedIds.has(c.campaign_id);
                    const isExpanded = expandedIds.has(c.campaign_id);
                    const activateAction = "UNPAUSE_CAMPAIGN";

                    const isUnderperformerMeta = getClassification(c) === "UNDERPERFORMER";
                    return (
                      <Fragment key={c.campaign_id}>
                        <tr
                          key={c.campaign_id}
                          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""
                            } ${isPaused ? "opacity-50" : ""} ${isUnderperformerMeta ? "border-l-4 border-l-red-500" : ""}`}
                          onClick={() => {
                            setExpandedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.campaign_id)) next.delete(c.campaign_id);
                              else next.add(c.campaign_id);
                              return next;
                            });
                          }}
                          data-testid={`row-campaign-${c.campaign_id}`}
                        >
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(c.campaign_id)}
                              data-testid={`checkbox-campaign-${c.campaign_id}`}
                            />
                          </td>

                          {metaColumns.map((col) => {
                            const val = c[col.key];

                            if (col.key === "campaign_name") {
                              return (
                                <td key={col.key} className="p-3 max-w-[200px]">
                                  <div className="flex flex-col gap-0.5">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="truncate block cursor-default text-foreground font-medium text-xs">
                                          {truncate(c.campaign_name || c.name || "Unknown", 30)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p className="text-xs">{c.campaign_name || c.name || "Unknown"}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    {c.status === "PAUSED" && (
                                      <Badge variant="secondary" className="text-xs px-1 py-0 text-red-400 w-fit">PAUSED</Badge>
                                    )}
                                  </div>
                                </td>
                              );
                            }

                            if (col.key === "classification") return <td key={col.key} className="p-3"><StatusBadge classification={val} /></td>;

                            if (col.key === "health_score") return (
                              <td key={col.key} className="p-3">
                                <ScoreIndicator
                                  score={val}
                                  detailedBreakdown={(c as any).detailed_breakdown}
                                  label="Campaign Health"
                                />
                              </td>
                            );

                            if (["layer", "learning_status", "delivery_status"].includes(col.key as string)) {
                              return (
                                <td key={col.key} className="p-3">
                                  <Badge variant="outline" className={cn(
                                    "text-xs px-1.5 py-0 font-bold uppercase",
                                    col.key === "layer" ? getLayerColor(val) :
                                      col.key === "learning_status" ? getLearningStatusColor(val) :
                                        "text-muted-foreground border-border/40"
                                  )}>
                                    {val || "—"}
                                  </Badge>
                                </td>
                              );
                            }

                            const isINR = ["spend", "cpl", "cpc", "cpm", "daily_budget"].includes(col.key as string);
                            const isPct = ["ctr", "budget_utilization_pct"].includes(col.key as string);

                            let displayVal: React.ReactNode = val ?? "—";
                            let colorClass = "text-muted-foreground";

                            if (isINR) {
                              displayVal = formatINR(val || 0, col.key === "cpc" || col.key === "cpm" ? 2 : 0);
                              if (col.key === "cpl") {
                                colorClass = (c.leads ?? 0) > 0 ? getCplColor(val, thresholds) : "text-muted-foreground";
                              } else if (col.key === "spend") {
                                colorClass = "text-foreground font-bold";
                              }
                            } else if (isPct) {
                              displayVal = `${(val || 0).toFixed(col.key === "ctr" ? 2 : 0)}%`;
                              if (col.key === "ctr") {
                                // Use benchmark-aware color for Meta
                                colorClass = !isGoogle
                                  ? getCtrColorWithBenchmarks(val, metaBenchmarks.raw)
                                  : getCtrColor(val);
                              } else if (col.key === "budget_utilization_pct") {
                                colorClass = val > 90 ? "text-red-400 font-bold" : val > 70 ? "text-amber-400" : "text-muted-foreground";
                              }
                            } else if (col.key === "leads") {
                              displayVal = formatNumber(val || 0);
                              colorClass = val >= 5 ? "text-emerald-400 font-bold" : val >= 1 ? "text-amber-400" : "text-muted-foreground";
                            } else if (col.key === "frequency") {
                              displayVal = (val || 0).toFixed(2);
                              // Use benchmark-aware color for Meta
                              colorClass = !isGoogle
                                ? getFrequencyColorWithBenchmarks(val, metaBenchmarks.raw)
                                : getFrequencyColor(val);
                            } else if (typeof val === "number") {
                              displayVal = formatNumber(val);
                              colorClass = "text-foreground";
                            }

                            return (
                              <td key={col.key} className={`p-3 tabular-nums text-xs ${col.align === "right" ? "text-right" : "text-left"} ${colorClass}`}>
                                {displayVal}
                              </td>
                            );
                          })}
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1 justify-center">
                              {!isPaused ? (
                                <ExecutionButton
                                  action="PAUSE_CAMPAIGN"
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant={isUnderperformerMeta ? "destructive" : "ghost"}
                                  size="icon"
                                  icon={<Pause className="w-3.5 h-3.5" />}
                                  confirmMessage={`Pause campaign "${c.campaign_name}"?`}
                                  params={{ reason: "Manual pause from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-pause-campaign-${c.campaign_id}`}
                                />
                              ) : (
                                <ExecutionButton
                                  action={activateAction}
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant="ghost"
                                  size="icon"
                                  icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                                  confirmMessage={`Activate campaign "${c.campaign_name}"?`}
                                  params={{ reason: "Manual activation from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-activate-campaign-${c.campaign_id}`}
                                />
                              )}
                              {!isPaused && (
                                <ExecutionButton
                                  action="SCALE_BUDGET_UP"
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant="ghost"
                                  size="icon"
                                  icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
                                  confirmMessage={`Scale up budget by 20% on "${c.campaign_name}"?\nCurrent daily budget: ${formatINR(c.daily_budget, 0)}`}
                                  params={{ scalePercent: 20, reason: "Manual scale up from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-scaleup-campaign-${c.campaign_id}`}
                                />
                              )}
                              {!isPaused && (
                                <ExecutionButton
                                  action="SCALE_BUDGET_DOWN"
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant="ghost"
                                  size="icon"
                                  icon={<TrendingDown className="w-3.5 h-3.5 text-orange-400" />}
                                  confirmMessage={`Scale down budget by 20% on "${c.campaign_name}"?\nCurrent daily budget: ${formatINR(c.daily_budget, 0)}`}
                                  params={{ scalePercent: -20, reason: "Manual scale down from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-scaledown-campaign-${c.campaign_id}`}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && c.score_breakdown && (
                          <tr key={`${c.campaign_id}-expanded`} className="border-b border-border/30 bg-muted/20">
                            <td colSpan={metaColumns.length + 2} className="p-4">
                              <div className="space-y-3">
                                <HealthScoreBreakdown
                                  entityName={c.campaign_name}
                                  scoreBreakdown={c.score_breakdown}
                                  detailedBreakdown={(c as any).detailed_breakdown}
                                  scoreBands={c.score_bands}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DataTablePagination
              totalItems={campaigns.length}
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
