// Intelligence Ads Dashboard v1.1 - Force Reload
import React, { useState, useMemo, useEffect, Fragment, Component, type ReactNode, type ErrorInfo } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Info,
  BarChart3,
  Pause,
  Play,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { ExecutionButton } from "@/components/execution-button";
import { useExecution } from "@/hooks/use-execution";
import {
  formatINR,
  formatPct,
  formatNumber,
  getCplColor,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { ScoreIndicator } from "@/components/score-indicator";
import { HealthScoreBreakdown } from "@/components/health-score-breakdown";

// ─── Helpers ──────────────────────────────────────────────────────

const normalizeRate = (val: any) => {
  const n = parseFloat(val) || 0;
  if (n > 0 && n <= 1.0) return n * 100;
  return n;
};

// ─── Types ──────────────────────────────────────────────────────────

interface ErrorState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorLocation?: string;
}

type AdsPanelCreative = {
  id: string;
  name: string;
  campaignName: string;
  adsetName: string;
  isVideo: boolean;
  isSearch: boolean;
  format: string;
  status: string;
  classification: string;
  health_score: number;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
  cvr: number;
  avg_cpc: number;
  cpm: number;
  tsr: number;
  vhr: number;
  ffr: number;
  video_p100: number;
  ad_strength: string;
  h_best: number;
  d_best: number;
  kwi_headlines: number;
  expected_ctr: number;
  age_days: number;
  score_breakdown?: Record<string, number>;
  detailed_breakdown?: Record<string, any>;
  [key: string]: any;
};

type ColDef = {
  key: string;
  label: string;
  align: "left" | "right";
};

// ─── Error Boundary ─────────────────────────────────────────────────

class AnalyticsErrorBoundary extends Component<{ children: ReactNode; location?: string }, ErrorState> {
  state: ErrorState = { hasError: false, error: null, errorInfo: null, errorLocation: this.props.location };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { this.setState({ error, errorInfo }); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 border border-destructive/20 bg-destructive/5 rounded-lg">
          <h2 className="text-lg font-bold text-foreground">
            Something went wrong {this.state.errorLocation ? `in ${this.state.errorLocation}` : ""}
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed">{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Column definitions ──────────────────────────────────────────────

const SEARCH_AD_GROUPS = [
  { label: "Identity", span: 3 },
  { label: "Ad Setup", span: 2 },
  { label: "Performance", span: 2 },
  { label: "Efficiency", span: 4 },
  { label: "Ad Assets", span: 2 },
  { label: "Asset Quality", span: 2 },
];

const DG_AD_GROUPS = [
  { label: "Identity", span: 2 },
  { label: "Health", span: 2 },
  { label: "Delivery", span: 2 },
  { label: "Performance", span: 4 },
  { label: "Efficiency", span: 3 },
  { label: "Video Metrics", span: 3 },
];

const META_AD_GROUPS = [
  { label: "Identity", span: 2 },
  { label: "Health", span: 2 },
  { label: "Status", span: 1 },
  { label: "Performance", span: 5 },
  { label: "Efficiency", span: 1 },
  { label: "Video", span: 3 },
];

const SEARCH_AD_COLS: ColDef[] = [
  { key: "name", label: "Ad Group / Ad", align: "left" },
  { key: "classification", label: "Class", align: "left" },
  { key: "health_score", label: "Health", align: "left" },
  { key: "ad_strength", label: "Strength", align: "left" },
  { key: "status", label: "Status", align: "left" },
  { key: "impressions", label: "Impr", align: "right" },
  { key: "clicks", label: "Clicks", align: "right" },
  { key: "ctr", label: "CTR", align: "right" },
  { key: "leads", label: "Leads", align: "right" },
  { key: "all_conversions", label: "SVs", align: "right" },
  { key: "cpl", label: "CPL", align: "right" },
  { key: "cpsv", label: "CPSV", align: "right" },
  { key: "cvr", label: "CVR", align: "right" },
  { key: "avg_cpc", label: "CPC", align: "right" },
  { key: "h_count", label: "Hdls", align: "right" },
  { key: "d_count", label: "Descs", align: "right" },
  { key: "h_best", label: "H-Perf", align: "right" },
  { key: "d_best", label: "D-Perf", align: "right" },
];

const DG_AD_COLS: ColDef[] = [
  { key: "name", label: "Ad / Creative", align: "left" },
  { key: "format", label: "Format", align: "left" },
  { key: "classification", label: "Class", align: "left" },
  { key: "health_score", label: "Health", align: "left" },
  { key: "status", label: "Status", align: "left" },
  { key: "age_days", label: "Age (d)", align: "right" },
  { key: "impressions", label: "Impr", align: "right" },
  { key: "clicks", label: "Clicks", align: "right" },
  { key: "leads", label: "Leads", align: "right" },
  { key: "all_conversions", label: "SVs", align: "right" },
  { key: "cpl", label: "CPL", align: "right" },
  { key: "cpsv", label: "CPSV", align: "right" },
  { key: "cpm", label: "CPM", align: "right" },
  { key: "ctr", label: "CTR", align: "right" },
  { key: "avg_cpc", label: "CPC", align: "right" },
  { key: "tsr", label: "TSR", align: "right" },
  { key: "vhr", label: "VHR", align: "right" },
  { key: "video_p100", label: "P100", align: "right" },
];

const META_AD_COLS: ColDef[] = [
  { key: "name", label: "Creative", align: "left" },
  { key: "format", label: "Type", align: "left" },
  { key: "classification", label: "Class", align: "left" },
  { key: "health_score", label: "Health", align: "left" },
  { key: "status", label: "Status", align: "left" },
  { key: "spend", label: "Spend", align: "right" },
  { key: "impressions", label: "Impr", align: "right" },
  { key: "leads", label: "Leads", align: "right" },
  { key: "cpl", label: "CPL", align: "right" },
  { key: "cpm", label: "CPM", align: "right" },
  { key: "ctr", label: "CTR", align: "right" },
  { key: "tsr", label: "TSR", align: "right" },
  { key: "vhr", label: "VHR", align: "right" },
  { key: "ffr", label: "FFR", align: "right" },
];

// ─── processAd helper ───────────────────────────────────────────────

function processAd(ad: any, campaignName: string, adsetName: string): AdsPanelCreative {
  return {
    id: ad.id || ad.ad_id || `${campaignName}-${adsetName}-${ad.name}`,
    name: ad.name || ad.ad_name || ad.headline || "Untitled Ad",
    campaignName: campaignName || "Unassigned Campaign",
    adsetName: adsetName || "Unassigned Group",
    isVideo: !!(ad.is_video || ad.ad_type === "VIDEO" || (ad.tsr && ad.tsr > 0)),
    isSearch: ad.ad_type === "RSA" || ad.ad_type === "RESPONSIVE_SEARCH_AD" || (campaignName || "").toLowerCase().includes("search"),
    format: ad.ad_type || (ad.is_video ? "Video" : "Static"),
    status: (ad.status || "ACTIVE").toUpperCase(),
    classification: ad.classification || "WATCH",
    health_score: ad.health_score ?? ad.creative_score ?? ad.performance_score ?? 0,
    spend: ad.spend || ad.cost || 0,
    impressions: ad.impressions || 0,
    clicks: ad.clicks || 0,
    leads: ad.leads || ad.conversions || 0,
    ctr: ad.ctr || 0,
    cpl: ad.cpl || 0,
    cvr: ad.cvr || 0,
    avg_cpc: ad.avg_cpc || ad.cpc || 0,
    cpm: ad.cpm || ad.avg_cpm || 0,
    tsr: normalizeRate(ad.tsr || ad.thumb_stop_pct || ad.thumb_stop_rate),
    vhr: normalizeRate(ad.vhr || ad.hold_rate_pct || ad.hold_rate),
    ffr: normalizeRate(
      (ad.video_views > 0 && ad.impressions > 0)
        ? (ad.video_views / ad.impressions) * 100
        : (ad.ffr || ad.first_frame_rate_pct || ad.first_frame_rate || ad.hook_rate || 0)
    ),
    video_p100: ad.video_p100 || 0,
    ad_strength: ad.ad_strength || "PENDING",
    h_best: ad.h_best || 0,
    d_best: ad.d_best || 0,
    kwi_headlines: ad.kwi_headlines_count || 0,
    expected_ctr: ad.expected_ctr || 0,
    age_days: ad.age_days || 0,
    score_breakdown: ad.score_breakdown,
    detailed_breakdown: ad.detailed_breakdown || ad.score_breakdown_detailed,
  };
}

// ─── renderAdCell helper ─────────────────────────────────────────────

function renderAdCell(c: AdsPanelCreative, col: ColDef, thresholds: any): React.ReactNode {
  const val = c[col.key];

  // Special renderers
  if (col.key === "classification") {
    return <td key={col.key} className="p-3"><StatusBadge classification={val} /></td>;
  }
  if (col.key === "health_score") {
    return (
      <td key={col.key} className="p-3">
        <ScoreIndicator score={val} breakdown={c.score_breakdown} label="Ad Health" description="Backend-calculated health score" />
      </td>
    );
  }
    if (col.key === "status") {
      const isActive = val === "ENABLED" || val === "ACTIVE";
      return (
        <td key={col.key} className="p-3">
          <Badge variant={isActive ? "outline" : "secondary"} className={`text-[11px] px-1 py-0.5 rounded font-bold uppercase w-[90px] justify-center tracking-wider ${isActive ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" : "text-red-600 bg-red-500/10 border-red-500/30"}`}>
            {val}
          </Badge>
        </td>
      );
    }
    if (col.key === "ad_strength") {
      const cls = val === "EXCELLENT" ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30"
        : val === "GOOD" ? "text-emerald-600 bg-emerald-500/5 border-emerald-500/20"
          : "text-amber-700 bg-amber-500/10 border-amber-500/30";
      return (
        <td key={col.key} className="p-3">
          <Badge variant="outline" className={`text-[11px] px-1.5 py-0.5 rounded font-bold uppercase w-[90px] justify-center tracking-wider ${cls}`}>{val || "PENDING"}</Badge>
        </td>
      );
    }
    if (col.key === "format") {
      const raw = (val || "").toString().toUpperCase();
      let label = raw.replace(/_/g, " ");
      
      // Shorten common long formats for better UI fit
      if (raw.includes("MULTI_ASSET")) label = "Multi-Asset";
      else if (raw.includes("VIDEO_RESPONSIVE")) label = "Video (R)";
      else if (raw.includes("RESPONSIVE_SEARCH")) label = "RSA";
      else if (raw.includes("IMAGE")) label = "Static";
      else if (raw.length > 15) label = label.split(" ").pop() || label;

      return (
        <td key={col.key} className="p-3">
          <Badge variant="secondary" className="text-[11px] px-1.5 py-0.5 rounded font-bold uppercase w-[90px] justify-center tracking-wider text-blue-700 bg-blue-50 border border-blue-200/50 shadow-sm leading-tight text-center">
            {label}
          </Badge>
        </td>
      );
    }
    if (col.key === "name") {
      return (
        <td key={col.key} className="p-3 max-w-[280px]">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="font-bold text-foreground truncate text-sm cursor-default transition-colors">{c.name}</div>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs max-w-[300px] whitespace-normal">{c.name}</p>
            </TooltipContent>
          </Tooltip>
          <div className="text-[11px] text-slate-500 font-medium truncate mt-0.5">{c.campaignName}</div>
        </td>
      );
    }

  // Numeric renderers
  const isPct = ["ctr", "cvr", "tsr", "vhr", "ffr", "video_p100", "expected_ctr"].includes(col.key);
  const isINR = ["spend", "cost", "cpl", "avg_cpc", "cpm", "cpsv"].includes(col.key);
  const numVal = typeof val === "number" ? val : (parseFloat(val) || 0);

  let displayVal: React.ReactNode = val ?? "—";
  let colorClass = "";

  if (isPct) {
    displayVal = numVal > 0 ? formatPct(numVal) : "—";
  } else if (isINR) {
    let calcVal = numVal;
    if (col.key === "cpsv") {
      calcVal = numVal || (c.all_conversions > 0 ? c.spend / c.all_conversions : 0);
    }
    displayVal = calcVal > 0 ? formatINR(calcVal, col.key === "avg_cpc" ? 2 : 0) : "—";
    if (col.key === "cpl") colorClass = getCplColor(calcVal, thresholds);
  } else if (typeof val === "number") {
    displayVal = formatNumber(val);
  }

  return (
    <td key={col.key} className={`p-3 tabular-nums text-xs ${col.align === "right" ? "text-right" : "text-left"} ${colorClass}`}>
      {displayVal}
    </td>
  );
}

// ─── Main page ───────────────────────────────────────────────────────

export default function AnalyticsAdsPage() {
  const clientContext = useClient();
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform } = clientContext ?? {};
  const isGoogle = activePlatform === "google";

  const [sortKey, setSortKey] = useState<string>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterClassification, setFilterClassification] = useState<string>("ALL");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const executionContext = useExecution();
  const { executeBatch, isExecuting: isBatchExecuting } = executionContext ?? {};

  const thresholds = (data as any)?.dynamic_thresholds;

  // ─── Normalize all ads from backend ─────────────────────────────
  const allAds = useMemo<AdsPanelCreative[]>(() => {
    if (!data) return [];
    let list: AdsPanelCreative[] = [];

    // Primary: creative_health array (preferred output from agent)
    const source = (data as any)?.creative_health || [];
    if (source.length > 0) {
      list = source.map((c: any) => processAd(c, c.campaign_name || "", c.adset_name || c.ad_group_name || ""));
    } else {
      // Fallback: walk campaign_audit → ad_groups → ads
      const campaigns = ((data as any)?.campaign_audit || (data as any)?.campaigns || []) as any[];
      campaigns.forEach((campaign) => {
        const groups = campaign.ad_sets || campaign.ad_groups || [];
        groups.forEach((group: any) => {
          (group.ads || []).forEach((ad: any) => {
            list.push(processAd(ad, campaign.campaign_name || campaign.name, group.name || group.ad_group_name));
          });
        });
      });
    }
    return list;
  }, [data]);

  // ─── Filtered + sorted list ──────────────────────────────────────
  const creatives = useMemo(() => {
    let list = [...allAds];
    if (filterStatus !== "ALL") list = list.filter(c => c.status === filterStatus);
    if (filterClassification !== "ALL") list = list.filter(c => c.classification === filterClassification);
    list.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return list;
  }, [allAds, filterStatus, filterClassification, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [filterStatus, filterClassification]);

  const paginated = useMemo(() => creatives.slice((page - 1) * pageSize, page * pageSize), [creatives, page, pageSize]);
  const searchAds = useMemo(() => paginated.filter(c => c.isSearch), [paginated]);
  const dgAds = useMemo(() => paginated.filter(c => !c.isSearch && isGoogle), [paginated, isGoogle]);

  const totalSpend = useMemo(() => allAds.reduce((s, c) => s + c.spend, 0), [allAds]);

  // ─── Ad row renderer ─────────────────────────────────────────────
  const handleToggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const handleSelectAll = (rows: AdsPanelCreative[], checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      rows.forEach(c => checked ? next.add(c.id) : next.delete(c.id));
      return next;
    });
  };

  // ─── Loading state ───────────────────────────────────────────────
  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <AnalyticsErrorBoundary location="Ads Panel">
      <div className="p-6 space-y-6 max-w-[1900px]">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h1 className="t-page-title text-foreground">Ads Panel</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-bold">{allAds.length}</span> creatives · <span className="font-bold">{formatINR(totalSpend, 0)}</span> total spend
            </p>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full animate-in fade-in">
              <span className="text-xs font-bold text-primary">{selectedIds.size} Selected</span>
              <div className="h-4 w-px bg-primary/20 mx-1" />
              <Button
                variant="ghost" size="sm"
                className="h-7 text-xs font-bold uppercase text-primary hover:bg-primary/20"
                onClick={async () => {
                  const actions = Array.from(selectedIds).map(id => ({
                    action: "PAUSE_AD" as const,
                    entityId: id,
                    entityName: allAds.find(c => c.id === id)?.name || id,
                    entityType: "ad" as const,
                    strategicCall: "Bulk pause from Ads Panel",
                  }));
                  if (executeBatch) await executeBatch(actions);
                  setSelectedIds(new Set());
                }}
                disabled={isBatchExecuting}
              >
                {isBatchExecuting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Pause className="w-3 h-3 mr-1" />}
                Pause All
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-7 text-xs font-bold uppercase text-emerald-500 hover:bg-emerald-500/10"
                onClick={async () => {
                  const actions = Array.from(selectedIds).map(id => ({
                    action: isGoogle ? ("ENABLE_AD" as const) : ("UNPAUSE_AD" as const),
                    entityId: id,
                    entityName: allAds.find(c => c.id === id)?.name || id,
                    entityType: "ad" as const,
                    strategicCall: "Bulk resume from Ads Panel",
                  }));
                  if (executeBatch) await executeBatch(actions);
                  setSelectedIds(new Set());
                }}
                disabled={isBatchExecuting}
              >
                <Play className="w-3 h-3 mr-1" /> Resume All
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-7 text-xs font-bold text-muted-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="ENABLED">Enabled</option>
              <option value="PAUSED">Paused</option>
              <option value="DISABLED">Disabled</option>
            </select>
            <select
              className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
              value={filterClassification}
              onChange={e => setFilterClassification(e.target.value)}
            >
              <option value="ALL">All Classifications</option>
              <option value="WINNER">Winner</option>
              <option value="WATCH">Watch</option>
              <option value="UNDERPERFORMER">Underperformer</option>
            </select>
          </div>
        </div>

        {/* ── Tables ─────────────────────────────────────────────── */}
        {isGoogle ? (
          <div className="space-y-8">
            <AdTable
              title="Search Ads (RSA)"
              rows={searchAds}
              cols={SEARCH_AD_COLS}
              groups={SEARCH_AD_GROUPS}
              accent="blue"
              isGoogle={isGoogle}
              thresholds={thresholds}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => {
                if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
                else { setSortKey(key); setSortDir("desc"); }
              }}
            />
            <AdTable
              title="Demand Gen Ads"
              rows={dgAds}
              cols={DG_AD_COLS}
              groups={DG_AD_GROUPS}
              accent="purple"
              isGoogle={isGoogle}
              thresholds={thresholds}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => {
                if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
                else { setSortKey(key); setSortDir("desc"); }
              }}
            />
            <DataTablePagination
              totalItems={creatives.length}
              pageSize={pageSize}
              currentPage={page}
              onPageChange={p => { setPage(p); setSelectedIds(new Set()); }}
              onPageSizeChange={s => { setPageSize(s); setPage(1); setSelectedIds(new Set()); }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <AdTable
              title="Meta Creatives"
              rows={paginated}
              cols={META_AD_COLS}
              groups={META_AD_GROUPS}
              accent="blue"
              isGoogle={isGoogle}
              thresholds={thresholds}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => {
                if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
                else { setSortKey(key); setSortDir("desc"); }
              }}
            />
            <DataTablePagination
              totalItems={creatives.length}
              pageSize={pageSize}
              currentPage={page}
              onPageChange={p => { setPage(p); setSelectedIds(new Set()); }}
              onPageSizeChange={s => { setPageSize(s); setPage(1); setSelectedIds(new Set()); }}
            />
          </div>
        )}
      </div>
    </AnalyticsErrorBoundary>
  );
}

// ─── Sub-Components ────────────────────────────────────────────────

interface AdTableProps {
  title: string;
  rows: AdsPanelCreative[];
  cols: ColDef[];
  groups?: { label: string, span: number }[];
  accent?: string;
  isGoogle: boolean;
  thresholds: any;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onSelectAll: (rows: AdsPanelCreative[], checked: boolean) => void;
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
}

const AdTable = React.memo(({
  title, rows, cols, groups, accent = "primary",
  isGoogle, thresholds, expandedIds, onToggleExpand,
  selectedIds, onToggleSelect, onSelectAll,
  sortKey, sortDir, onSort
}: AdTableProps) => {
  return (
    <section>
      <h2 className="text-base font-semibold text-slate-950 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Info className={`w-4 h-4 text-${accent}-500`} />
        {title}
        <span className="text-muted-foreground font-normal ml-1">({rows.length})</span>
      </h2>
      <Card>
        <CardContent className="card-content-premium p-0 overflow-x-auto overflow-y-hidden">
          <table className="t-table w-full text-xs">
            <thead>
              {groups && (
                <tr className="border-b border-border/10 bg-muted/5">
                  <th className="p-0 w-10"></th>
                  {groups.map((g, i) => (
                    <th key={i} colSpan={g.span} className="px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 last:border-0 text-center">
                      {g.label}
                    </th>
                  ))}
                  <th className="p-0 w-10"></th>
                </tr>
              )}
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="p-3 w-10 text-center">
                  <Checkbox
                    checked={rows.length > 0 && rows.every(c => selectedIds.has(c.id))}
                    onCheckedChange={checked => onSelectAll(rows, !!checked)}
                  />
                </th>
                {cols.map(col => (
                  <th
                    key={col.key}
                    className={`px-3 py-4 text-sm font-bold uppercase tracking-widest text-muted-foreground hover:text-slate-900 transition-colors cursor-pointer select-none whitespace-nowrap border-r border-border/5 last:border-0 ${col.align === "right" ? "text-right" : "text-left"}`}
                    onClick={() => onSort(col.key)}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-4 text-sm font-bold uppercase tracking-widest text-muted-foreground text-center border-l border-border/5">
                  Act
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 2} className="p-12 text-center">
                    <div className="flex flex-col items-center gap-2 opacity-40">
                      <BarChart3 className="w-6 h-6" />
                      <p className="text-xs font-bold uppercase tracking-tight">No creatives matching current filters</p>
                    </div>
                  </td>
                </tr>
              ) : rows.map(c => (
                <AdRow
                  key={c.id}
                  c={c}
                  cols={cols}
                  isGoogle={isGoogle}
                  thresholds={thresholds}
                  isExpanded={expandedIds.has(c.id)}
                  onToggleExpand={() => onToggleExpand(c.id)}
                  isSelected={selectedIds.has(c.id)}
                  onToggleSelect={(checked) => onToggleSelect(c.id, checked)}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
});

AdTable.displayName = "AdTable";

const AdRow = React.memo(({
  c, cols, isGoogle, thresholds, isExpanded, onToggleExpand, isSelected, onToggleSelect
}: {
  c: AdsPanelCreative,
  cols: ColDef[],
  isGoogle: boolean,
  thresholds: any,
  isExpanded: boolean,
  onToggleExpand: () => void,
  isSelected: boolean,
  onToggleSelect: (checked: boolean) => void
}) => {
  const isPaused = c.status === "PAUSED" || c.status === "DISABLED";

  return (
    <Fragment>
      <tr
        className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isPaused ? "opacity-50" : ""} ${c.classification === "UNDERPERFORMER" ? "border-l-2 border-l-red-500" : ""}`}
        onClick={onToggleExpand}
      >
        <td className="p-3 w-10 text-center" onClick={e => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelect(!!checked)}
          />
        </td>

        {cols.map(col => renderAdCell(c, col, thresholds))}

        <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
          <ExecutionButton
            action={isPaused ? (isGoogle ? "ENABLE_AD" : "UNPAUSE_AD") : "PAUSE_AD"}
            entityId={c.id}
            entityName={c.name}
            entityType="ad"
            label=""
            variant={(!isPaused && c.classification === "UNDERPERFORMER") ? "destructive" : "ghost"}
            size="icon"
            icon={isPaused
              ? <Play className="w-3.5 h-3.5 text-emerald-500" />
              : <Pause className="w-3.5 h-3.5" />
            }
            confirmMessage={`${isPaused ? "Resume" : "Pause"} ad "${c.name}"?`}
            className="h-8 w-8 hover:bg-muted"
            currentMetrics={{ spend: c.spend, leads: c.leads, cpl: c.cpl, ctr: c.ctr, impressions: c.impressions }}
          />
        </td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-border/30 bg-muted/20 animate-in fade-in duration-200">
          <td colSpan={cols.length + 2} className="p-4">
            <HealthScoreBreakdown
              entityName={c.name}
              scoreBreakdown={c.score_breakdown || {}}
              detailedBreakdown={c.detailed_breakdown}
              scoreBands={c.score_bands}
              className="py-1"
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
});

AdRow.displayName = "AdRow";
