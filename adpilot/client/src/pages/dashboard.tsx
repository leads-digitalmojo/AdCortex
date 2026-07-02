import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import type { AnalysisData } from "@shared/schema";
import { useNow } from "@/hooks/use-now";
import { formatHoursAgo, parseSyncTimestamp } from "@/lib/sync-state";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import {
  IndianRupee,
  Users,
  Target,
  MousePointerClick,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Gauge,
  Pause,
  Play,
  Zap,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  BarChart3,
  Trophy,
  Activity,
  Bell,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingDown,
  CalendarCheck,
  CalendarClock,
  Filter,
  Eye,
  MousePointer2,
  UserCheck,
  Home,
  Star,
  Check,
  ChevronDown,
  Facebook,
  Globe,
  Plus,
  Brain,
  Database,
  Ban,
  PlusCircle,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Bar,
  ReferenceLine,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { ExecutionButton } from "@/components/execution-button";
import { UnifiedActions } from "@/components/unified-actions";
import {
  formatINR,
  formatPct,
  formatNumber,
  getTrendInfo,
  getHealthBgColor,
  getHealthBarBg,
  getLayerColor,
  getStatusColor,
  getMetricStatus,
  getMetricStatusColor,
  getFrequencyColor,
  truncate,
  getCplColorWithBenchmarks,
  getCtrColorWithBenchmarks,
  getFrequencyColorWithBenchmarks,
  getHealthColor,
  getClassificationColor as getClassificationStyle,
  type MetricStatus,
} from "@/lib/format";
import { useMetaBenchmarks } from "@/hooks/use-meta-benchmarks";

/**
 * DASHBOARD INTELLIGENCE
 * Enforcing 4-Layer Intelligence Pipeline globally.
 * Hardcoded suggestions and local engines have been removed in favor of unified service.
 */

interface AdaptiveSuggestion {
  text: string;
  source: "SOP" | "AI";
  confidence: "High" | "Medium";
  score: number;
}

// useRecommendationEngine removed. Unified insights are fetched directly from pipeline.
function FixSuggestionModal({ alert, onClose, intellectInsights }: { alert: any; onClose: () => void; intellectInsights?: any[] }) {
  const { activeClient, activePlatform } = useClient();
  const { toast } = useToast();

  // Build live account metrics to send as alert context (so Claude gets exact numbers)
  const alertMetrics = useMemo(() => {
    if (!alert) return undefined;
    const campaigns: any[] = (alert.campaigns || []);
    const m: Record<string, string | number> = {};
    if (alert.value) m[`${alert.metric} (current)`] = alert.value;
    if (alert.benchmark) m[`${alert.metric} (target)`] = alert.benchmark;
    if (campaigns.length > 0) {
      m["Affected campaigns"] = campaigns.map((c: any) => c.name).join(", ");
    }
    return Object.keys(m).length > 0 ? m : undefined;
  }, [alert]);

  const pipelineQueryKey = useMemo(() => {
    if (!alert) return null;
    return ["/api/intelligence", activeClient?.id, activePlatform, "insights", alert.summary, alert.metric];
  }, [alert, activeClient?.id, activePlatform]);

  const { data: pipelineData, isLoading: isLoadingPipeline, isFetched: hasFetchedPipeline } = useQuery<{
    insights: any[];
    recommendations: any[];
    recommendation_tiers?: { CRITICAL?: any[]; MEDIUM?: any[]; LOW?: any[] };
  }>({
    queryKey: pipelineQueryKey ?? ["/api/intelligence", activeClient?.id, activePlatform, "insights"],
    queryFn: async () => {
      if (!activeClient?.id || !activePlatform || !alert) return { insights: [], recommendations: [], recommendation_tiers: { CRITICAL: [], MEDIUM: [], LOW: [] } };
      const params = new URLSearchParams({ type: "recommendation" });
      if (alert.summary) params.set("alert_problem", alert.summary);
      if (alert.metric) params.set("alert_metric", alert.metric);
      if (alertMetrics) params.set("alert_metrics", JSON.stringify(alertMetrics));
      const res = await apiRequest("GET", `/api/intelligence/${activeClient.id}/${activePlatform}/insights?${params.toString()}`);
      return res.json();
    },
    enabled: !!activeClient?.id && !!activePlatform && !!alert,
    staleTime: 0, // Always re-fetch for each distinct alert
  });

  const isLoadingAI = isLoadingPipeline && !!pipelineQueryKey;

  const suggestions = useMemo(() => {
    const directRecommendations = Array.isArray(pipelineData?.recommendations) ? pipelineData.recommendations : [];
    const tierCards = [
      ...(pipelineData?.recommendation_tiers?.CRITICAL || []),
      ...(pipelineData?.recommendation_tiers?.MEDIUM || []),
      ...(pipelineData?.recommendation_tiers?.LOW || []),
    ];

    const recs = directRecommendations.length > 0
      ? directRecommendations
      : tierCards.map((card: any) => {
        const primary = Array.isArray(card?.solutions) ? card.solutions[0] : null;
        return {
          action: primary?.title || card?.diagnosis?.symptom || "Review issue",
          reasoning: primary?.rationale || card?.diagnosis?.problem || "",
          execution_type: primary?.classification === "AUTO-EXECUTE" ? "auto" : primary?.classification === "REJECT" ? "confirm" : "manual",
          action_payload: {
            action: { type: primary?.actionPayload?.action?.type || "" },
            execution_plan: primary?.steps || [],
          },
        };
      });

    return recs.map((rec: any, idx: number) => ({
      rank: idx + 1,
      issue: rec.action, // Title of the card
      action: rec.action,
      reasoning: rec.reasoning,
      executionPlan: rec.action_payload?.execution_plan || rec.executionPlan || [],
      source: "AI", // Vertical recommendations are AI-consolidated
      executionType: rec.execution_type || "manual",
      actionType: rec.action_payload?.action?.type || "",
    }));
  }, [pipelineData]);

  const hasSuggestions = suggestions.length > 0;

  if (!alert) return null;

  // Map action types to readable impact labels
  const getActionTypeBadge = (executionType: string, actionType: string) => {
    if (executionType === "auto") return { label: "Auto-Execute", className: "bg-green-500/10 text-green-400 border-green-500/20" };
    if (executionType === "confirm") return { label: "Needs Approval", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    if (actionType?.includes("creative")) return { label: "Creative Work", className: "bg-purple-500/10 text-purple-400 border-purple-500/20" };
    if (actionType?.includes("audience")) return { label: "Audience Change", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
    if (actionType?.includes("funnel") || actionType?.includes("landing")) return { label: "Funnel Audit", className: "bg-orange-500/10 text-orange-400 border-orange-500/20" };
    return { label: "Strategic", className: "bg-muted text-muted-foreground border-border/60" };
  };

  return (
    <Dialog open={!!alert} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[680px] p-0 overflow-hidden border-0 shadow-2xl">
        <DialogHeader className="p-6 pb-4 bg-muted/20 relative border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
              <Brain className="w-5 h-5 animate-pulse-slow" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="t-page-title text-foreground text-xl">4-Layer AI Diagnosis</DialogTitle>
                {isLoadingAI && (
                  <Badge variant="outline" className="animate-pulse bg-primary/10 text-primary border-primary/20 text-xs font-black uppercase py-0">
                    Strategic AI Reasoning...
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="secondary" className="text-xs font-black uppercase tracking-wider bg-primary/20 text-primary border-primary/20 px-1.5 py-0.5">
                  {alert.metric} ALERT
                </Badge>
                <span className="text-xs text-muted-foreground font-medium truncate opacity-70">
                  {isLoadingAI ? "Parallelizing SOP, Data & Execution History..." : "Root-cause analysis across all 4 layers"}
                </span>
              </div>
            </div>
          </div>
          {/* Alert problem statement */}
          <div className="mt-3 p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
            <p className="text-xs font-semibold text-red-400 leading-snug">{alert.summary}</p>
          </div>
        </DialogHeader>

        <DialogBody className="p-5 space-y-3 max-h-[72vh] overflow-y-auto">
          {isLoadingAI && (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          )}

          {!isLoadingAI && hasFetchedPipeline && !hasSuggestions && (
            <div className="rounded-xl border border-border/40 bg-card p-5 text-center space-y-2">
              <p className="text-base font-semibold text-foreground">No fix suggestions matched this alert</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The dashboard request loaded, but the alert-specific filter did not find any recommendation cards for this issue.
              </p>
            </div>
          )}

          {suggestions.map((s: any, i: number) => {
            const typeBadge = getActionTypeBadge(s.executionType, s.actionType);
            return (
              <div key={i} className="rounded-xl border border-border/40 bg-card hover:border-primary/30 transition-all overflow-hidden">
                {/* Card header row */}
                <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                  <div className="size-5 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-xs font-black text-primary">{i + 1}</span>
                  </div>
                  <span className="text-xs font-black text-foreground uppercase tracking-wide flex-1 truncate">{s.issue}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn(
                      "text-xs font-black uppercase tracking-tight px-1.5 py-0.5 rounded border",
                      s.source === "AI" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    )}>
                      {s.source}
                    </span>
                    <span className={cn("text-xs font-bold uppercase tracking-tight px-1.5 py-0.5 rounded border", typeBadge.className)}>
                      {typeBadge.label}
                    </span>
                  </div>
                </div>

                {/* Root-cause reasoning — this is the GPT-quality analysis */}
                {s.reasoning && (
                  <div className="px-4 pb-2">
                    <p className="text-[12px] text-foreground/75 leading-relaxed">{s.reasoning}</p>
                  </div>
                )}

                {/* Action — the actual fix */}
                <div className="mx-4 mb-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-start gap-2">
                    <Zap className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <p className="text-[12px] font-semibold text-foreground leading-snug">{s.action}</p>
                  </div>
                </div>

                {/* Execution plan steps */}
                {Array.isArray(s.executionPlan) && s.executionPlan.length > 0 && (
                  <div className="px-4 pb-3.5">
                    <p className="text-xs text-muted-foreground uppercase font-black tracking-widest mb-1.5">Execution Steps</p>
                    <ol className="space-y-1">
                      {s.executionPlan.map((step: string, si: number) => (
                        <li key={si} className="flex items-start gap-2">
                          <span className="text-xs font-black text-primary/60 mt-0.5 shrink-0">{si + 1}.</span>
                          <span className="text-xs text-foreground/70 leading-snug">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            );
          })}

          {/* Diagnostic context */}
          {alert.campaigns?.length > 0 && (
            <div className="p-3.5 rounded-xl bg-muted/10 border border-border/30">
              <p className="text-xs text-muted-foreground uppercase font-black tracking-widest mb-2">Affected Entities ({alert.campaigns.length})</p>
              <div className="grid grid-cols-1 gap-1">
                {alert.campaigns.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs font-semibold text-foreground/80 bg-background/40 p-1.5 px-2 rounded-lg border border-border/20">
                    <span className="truncate">{c.name}</span>
                    <span className="text-primary tabular-nums shrink-0 ml-2">{c.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="p-4 px-6 bg-muted/20 border-t border-border/40 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-primary opacity-60" />
            <span className="t-micro text-muted-foreground font-bold uppercase tracking-tight">AI Engine + SOP Layer Validated</span>
          </div>
          <Button
            className="h-10 px-6 font-bold shadow-lg shadow-primary/20 bg-primary hover:bg-[#f5c723] text-primary-foreground transition-all active:scale-[0.97]"
            onClick={onClose}
          >
            Acknowledge Fix
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const calculateCTR = (clicks: number, impressions: number) => {
  if (!impressions || impressions === 0) return 0;
  return (clicks / impressions) * 100;
};

function KpiCard({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  icon: Icon,
  isInverse,
  status,
  todayValue,
  children,
}: {
  title: string;
  value: string;
  subtitle?: string;
  trend?: string;
  trendValue?: string;
  icon: any;
  isInverse?: boolean;
  status?: {
    label: string;
    variant?: "success" | "warning" | "destructive" | "info" | "secondary";
    className?: string;
  };
  todayValue?: string;
  children?: React.ReactNode;
}) {
  const { activeCadence } = useClient();
  const trendInfo = trend ? getTrendInfo(trend, isInverse) : null;
  const hideTrend = activeCadence === "daily";

  return (
    <Card className="relative overflow-hidden border-[1.5px] border-foreground/85 shadow-none transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        {/* Title row */}
        <div className="flex items-center justify-between gap-1 mb-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-foreground/70 leading-none truncate pr-1">
            {title}
          </h3>
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Icon className="size-4 text-primary-foreground" />
          </div>
        </div>
        <div
          className="t-kpi text-foreground break-all"
          data-testid={`text-kpi-${title.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
        </div>
        {todayValue && (
          <div className="t-micro font-bold text-primary mt-1 flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-primary animate-pulse" />
            YESTERDAY: {todayValue}
          </div>
        )}
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between gap-1">
            {trendInfo && trendValue && !hideTrend ? (
              <span className={`t-body-sm font-semibold tabular-nums shrink-0 ${trendInfo.color}`}>
                {trendInfo.arrow} {trendValue}
              </span>
            ) : <span />}
            {subtitle && (
              <span className="t-micro text-muted-foreground truncate text-right">{subtitle}</span>
            )}
          </div>
          {status && (
            <div>
              <Badge
                variant={status.variant ?? "secondary"}
                className={`text-xs px-1.5 py-0 ${status.className ?? ""}`}
              >
                {status.label}
              </Badge>
            </div>
          )}
        </div>
        {children && <div className="mt-3 border-t border-border/40 pt-2.5">{children}</div>}
      </CardContent>
    </Card>
  );
}

const CHART_COLORS = {
  gold: "hsl(47, 85%, 65%)",
  purple: "hsl(220, 50%, 65%)",
  blue: "hsl(215, 60%, 60%)",
  green: "hsl(146, 40%, 60%)",
  red: "hsl(0, 50%, 65%)",
  amber: "hsl(35, 70%, 60%)",
};

const FUNNEL_COLORS: Record<string, string> = {
  TOFU: "hsl(220, 70%, 55%)",
  MOFU: "hsl(262, 60%, 55%)",
  BOFU: "hsl(35, 90%, 55%)",
};

// Comprehensive funnel/spend color map covering both Meta (TOFU/MOFU/BOFU) and Google (Search/DG)
const activeFunnelColors: Record<string, string> = {
  ...FUNNEL_COLORS,
  Search: "hsl(210, 70%, 55%)",
  "Demand Gen": "hsl(35, 80%, 55%)",
  DG: "hsl(35, 80%, 55%)",
  Display: "hsl(280, 60%, 55%)",
  Video: "hsl(160, 50%, 50%)",
  Shopping: "hsl(120, 50%, 50%)",
  Performance: "hsl(0, 60%, 55%)",
};

const cadenceDisplayMap: Record<string, string> = {
  daily: "Last 1 Day",
  twice_weekly: "Last 7 Days",
  weekly: "Last 14 Days",
  biweekly: "Last 30 Days",
  monthly: "Month to Date",
};

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border/50 bg-card p-2 shadow-md">
      <p className="t-label-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => {
        const isVideoMetric = entry.name.toLowerCase().includes("tsr") || entry.name.toLowerCase().includes("vhr");
        const hasPct = entry.name.includes("%");
        return (
          <p key={i} className="t-body tabular-nums" style={{ color: entry.color }}>
            {entry.name}{isVideoMetric ? " (Video Only)" : ""}: {typeof entry.value === "number" ? entry.value.toLocaleString("en-IN") : entry.value}
            {(hasPct || isVideoMetric) && !entry.name.includes("%") ? "%" : ""}
          </p>
        );
      })}
    </div>
  );
}

// Dynamic cadence label
function getCadencePeriodLabel(cadence: string): string {
  switch (cadence) {
    case "daily": return "1d";
    case "twice_weekly": return "7d";
    case "weekly": return "14d";
    case "biweekly": return "30d";
    case "monthly": return "MTD";
    default: return "7d";
  }
}

export default function DashboardPage() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("ALL");
  const [activeFixAlert, setActiveFixAlert] = useState<any>(null);
  const { toast } = useToast();
  const [showAllCriticalAlerts, setShowAllCriticalAlerts] = useState(false);
  const [showAllFatigueAlerts, setShowAllFatigueAlerts] = useState(false);
  const [isTriggeringAgent, setIsTriggeringAgent] = useState(false);



  // ─── 1. Helper Functions ─────────────────────────────────────────

  function findAdIdByName(adName: string, creativeHealthData: any[]): string | null {
    if (!Array.isArray(creativeHealthData)) return null;
    const ad = creativeHealthData.find((a: any) => a?.ad_name === adName);
    return ad?.ad_id || null;
  }

  function findCampaignByEntity(entity: string, campaignData: any[]): { id: string; name: string } | null {
    if (!Array.isArray(campaignData)) return null;
    const campaign = campaignData.find((c: any) =>
      entity.toLowerCase().includes((c?.campaign_name || c?.name || "").toLowerCase()) ||
      (c?.campaign_name || c?.name || "").toLowerCase().includes(entity.toLowerCase())
    );
    if (campaign) return {
      id: campaign.campaign_id || campaign.id,
      name: campaign.campaign_name || campaign.name
    };
    return null;
  }

  function formatRangeDate(value: string) {
    const parsed = new Date(`${value}T00:00:00`);
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // ─── 2. Hooks ────────────────────────────────────────────────────
  const {
    analysisData: data,
    isLoadingAnalysis: isLoading,
    analysisError,
    activeClient,
    activeClientId,
    clients,
    setActiveClientId,
    setActivePlatform,
    activePlatformInfo,
    activePlatform,
    activeCadence,
    syncState,
    mtdAnalysisData,
  } = useClient();
  const now = useNow();

  // --- Stateful Performance Alerts ---
  const { data: statefulAlerts = [] as any[], refetch: refetchAlerts } = useQuery<any[]>({
    queryKey: [`/api/performance-alerts/${activeClient?.id}/${activePlatform}`],
    enabled: !!activeClient?.id && !!activePlatform
  });

  const completeAlert = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/performance-alerts/${id}/complete`);
    },
    onSuccess: () => {
      refetchAlerts();
      toast({ title: "Alert resolved", description: "Marked as completed" });
    }
  });

  const rejectAlert = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/performance-alerts/${id}/reject`);
    },
    onSuccess: () => {
      refetchAlerts();
      toast({ title: "Alert dismissed", description: "Alert has been rejected" });
    }
  });

  const handleComplete = (id: number) => completeAlert.mutate(id);
  const handleReject = (id: number) => rejectAlert.mutate(id);

  const { data: verifyData } = useQuery<{
    verified: boolean;
    apiSpend: number;
    agentSpend: number;
    discrepancy: number;
    discrepancyPct: number;
    apiLeads: number;
    agentLeads: number;
    leadsDiscrepancy: number;
    leadsDiscrepancyPct: number;
    creativeHealthLeads: number | null;
    campaignAnalysisLeads: number | null;
    leadsCorrectionApplied: boolean;
    leadsCorrectionFactor: number;
    status: string;
    lastVerified: string | null;
  }>({
    queryKey: ["/api/clients", activeClientId, activePlatform, "verify-data"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/${activePlatform}/verify-data`);
      return res.json();
    },
    enabled: !!activeClientId && !!activePlatform,
    staleTime: 5 * 60 * 1000,
  });

  const { data: newEntities } = useQuery<{
    hasNewEntities: boolean;
    newCampaigns: Array<{ id: string; name: string; type: string }>;
    newAdsets: Array<{ id: string; name: string }>;
    totalNew: number;
    lastAnalysis: string | null;
  }>({
    queryKey: ["/api/clients", activeClientId, activePlatform, "check-new-entities"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/${activePlatform}/check-new-entities`);
      return res.json();
    },
    enabled: !!activeClientId && !!activePlatform,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes for new entities
  });

  const { data: recentAuditLog } = useQuery<Array<{
    id: string;
    success: boolean;
    action: string;
    entityId: string;
    entityName: string;
    entityType: string;
    timestamp: string;
    requestedBy: string;
    reason?: string;
    error?: string;
  }>>({
    queryKey: ["/api/audit-log", 3],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/audit-log?limit=3`);
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  // MTD Deliverables — authoritative source for SVs, Qualified Leads, Closures
  const { data: mtdData } = useQuery<{
    client_id: string;
    month: string;
    mtd: {
      spend: number;
      leads: number;
      qualified_leads: number;
      svs: number;
      closures: number;
      cpl: number;
      cpql: number;
      cpsv: number;
      impressions: number;
      clicks: number;
      positive_pct: number;
    };
    status: { data_complete: boolean; manual_input_missing: boolean; tracking_issue_flag: boolean };
    last_updated: string;
  }>({
    queryKey: ["/api/mtd-deliverables", activeClientId, activePlatform],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mtd-deliverables?client_id=${activeClientId}&platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId,
    // MTD data is entered manually or via agent — 5 min cache avoids re-fetch waterfall
    staleTime: 5 * 60 * 1000,
  });


  // ─── 4. Base Constants & Raw Data ──────────────────────────────────

  const isGoogle = activePlatform === "google";
  const cadenceLabel = (data as any)?.cadence || activeCadence || "";
  const periodLabel = getCadencePeriodLabel(cadenceLabel);
  const rawAp = (data as any)?.account_pulse || {};
  const rawCampaignAudit = Array.isArray((data as any)?.campaign_audit) ? (data as any)?.campaign_audit : Array.isArray((data as any)?.campaigns) ? (data as any)?.campaigns : [];
  const thresholds = (data as any)?.dynamic_thresholds || (data as any)?.thresholds || {};

  // ── Centralized Reactive Benchmarks ──
  const metaBenchmarksData = useMetaBenchmarks();
  const metaBenchmarks = metaBenchmarksData.raw; // For backward compat with existing uses of 'benchmarks'
  const {
    cplTarget: t_cpl_target,
    cplCritical: t_cpl_critical,
    ctrTarget: t_ctr_min,
    cpsvTarget: t_cpsv_target,
    cpqlTarget: t_cpql_target,
    budgetTarget: t_budget_target,
    leadsTarget: t_leads_target,
  } = metaBenchmarksData;

  const rawFatigueAlerts = Array.isArray((data as any)?.fatigue_alerts) ? (data as any)?.fatigue_alerts : [];
  const rawAdRecommendations = Array.isArray((data as any)?.recommendations) ? (data as any)?.recommendations : [];
  const rawAdsetAnalysis = Array.isArray((data as any)?.adset_analysis) ? (data as any)?.adset_analysis : Array.isArray((data as any)?.ad_group_analysis) ? (data as any)?.ad_group_analysis : [];
  const rawCreativeHealth = Array.isArray((data as any)?.creative_health) ? (data as any)?.creative_health : [];
  const rawIntellectInsights = Array.isArray((data as any)?.intellect_insights) ? (data as any)?.intellect_insights : [];
  const rawAutoPauseCandidates = Array.isArray((data as any)?.auto_pause_candidates) ? (data as any)?.auto_pause_candidates : [];
  const rawMp = (data as any)?.monthly_pacing;
  const rawMtdPacing = ((data as any)?.account_pulse || rawAp)?.mtd_pacing;
  const clientTargets = activeClient?.targets?.[activePlatform];

  // ─── Authoritative MTD Metrics (Must be early for hooks) ───────────
  const authMtd = useMemo(() => {
    const apiMtd = mtdData?.mtd;
    // For agentMtd, we look in both rawMp and rawMtdPacing
    const agentMtd = rawMp?.mtd || rawMtdPacing;

    return {
      spend: apiMtd?.spend ?? agentMtd?.spend ?? agentMtd?.spend_mtd ?? 0,
      leads: apiMtd?.leads ?? agentMtd?.leads ?? agentMtd?.leads_mtd ?? 0,
      svs: apiMtd?.svs ?? agentMtd?.svs ?? agentMtd?.svs_mtd ?? metaBenchmarks?.svs_mtd ?? 0,
      qualified_leads: apiMtd?.qualified_leads ?? agentMtd?.qualified_leads ?? agentMtd?.qualified_leads_mtd ?? agentMtd?.positive_leads_mtd ?? metaBenchmarks?.positive_leads_mtd ?? 0,
      closures: apiMtd?.closures ?? agentMtd?.closures ?? agentMtd?.closures_mtd ?? 0,
      impressions: apiMtd?.impressions ?? agentMtd?.impressions ?? agentMtd?.impressions_mtd ?? rawAp?.total_impressions ?? 0,
      clicks: agentMtd?.clicks ?? agentMtd?.clicks_mtd ?? rawAp?.total_clicks ?? 0,
    };
  }, [mtdData, rawMp, rawMtdPacing, metaBenchmarks, rawAp]);

  // ─── 5. Core useMemo Hooks ─────────────────────────────────────────

  const filteredCampaign = useMemo(() => {
    if (selectedCampaignId === "ALL") return null;
    return rawCampaignAudit.find((c: any) => c.campaign_id === selectedCampaignId);
  }, [selectedCampaignId, rawCampaignAudit]);

  const campaignAudit = useMemo(() =>
    selectedCampaignId === "ALL" ? rawCampaignAudit : rawCampaignAudit.filter((c: any) => c.campaign_id === selectedCampaignId),
    [rawCampaignAudit, selectedCampaignId]
  );

  const fatigueAlerts = useMemo(() =>
    selectedCampaignId === "ALL" ? rawFatigueAlerts : rawFatigueAlerts.filter((f: any) => f.campaign === filteredCampaign?.campaign_name),
    [rawFatigueAlerts, selectedCampaignId, filteredCampaign]
  );

  const adRecommendations = useMemo(() =>
    selectedCampaignId === "ALL" ? rawAdRecommendations : rawAdRecommendations.filter((r: any) => r.campaign === filteredCampaign?.campaign_name || r.campaign_id === selectedCampaignId),
    [rawAdRecommendations, selectedCampaignId, filteredCampaign]
  );

  const campaignAnalysis = useMemo(() =>
    selectedCampaignId === "ALL" ? rawCampaignAudit : rawCampaignAudit.filter((c: any) => c.campaign_id === selectedCampaignId),
    [rawCampaignAudit, selectedCampaignId]
  );

  const creativeHealth = useMemo(() =>
    selectedCampaignId === "ALL" ? rawCreativeHealth : rawCreativeHealth.filter((c: any) => c.campaign_name === filteredCampaign?.campaign_name),
    [rawCreativeHealth, selectedCampaignId, filteredCampaign]
  );

  const intellectInsights = useMemo(() =>
    selectedCampaignId === "ALL" ? rawIntellectInsights : rawIntellectInsights.filter((i: any) => i.entity && i.entity.includes(filteredCampaign?.campaign_name || "")),
    [rawIntellectInsights, selectedCampaignId, filteredCampaign]
  );

  const autoPauseCandidates = useMemo(() =>
    selectedCampaignId === "ALL" ? rawAutoPauseCandidates : rawAutoPauseCandidates.filter((c: any) => c.campaign_name === filteredCampaign?.campaign_name || c.campaign_id === selectedCampaignId),
    [rawAutoPauseCandidates, selectedCampaignId, filteredCampaign]
  );

  // Normalize base ap & mp for use in other hooks.
  // The daily_trends fallback for Google is handled here (inside the memo) to
  // avoid mutating the computed object after creation — which breaks React's
  // immutability contract and can cause stale-closure bugs.
  const ap = useMemo(() => {
    let daily_spends: number[] = rawAp.daily_spends || [];
    let daily_leads: number[] = rawAp.daily_leads || [];
    let daily_ctrs: number[] = rawAp.daily_ctrs || [];
    let daily_cpms: number[] = rawAp.daily_cpms || [];
    let daily_tsrs: number[] = rawAp.daily_tsrs || [];
    let daily_vhrs: number[] = rawAp.daily_vhrs || [];

    // Google fallback: extract daily arrays from daily_trends when not yet present
    if (daily_spends.length === 0) {
      const dt: any[] = rawAp.daily_trends || (data as any)?.daily_trends || [];
      if (dt.length > 0) {
        daily_spends = dt.map((d: any) => d.spend ?? d.cost ?? 0);
        daily_leads = dt.map((d: any) => d.leads ?? d.conversions ?? 0);
        daily_ctrs = dt.map((d: any) => d.ctr ?? 0);
        daily_cpms = dt.map((d: any) => d.cpm ?? 0);
        daily_tsrs = dt.map((d: any) => d.tsr ?? 0);
        daily_vhrs = dt.map((d: any) => d.vhr ?? 0);
      }
    }

    return {
      ...rawAp,
      total_spend_30d: rawAp.total_spend_30d ?? rawAp.total_spend ?? 0,
      total_leads_30d: rawAp.total_leads_30d ?? Math.round(rawAp.total_leads ?? 0),
      overall_cpl: rawAp.overall_cpl ?? 0,
      overall_ctr: rawAp.overall_ctr ?? 0,
      overall_cpm: rawAp.overall_cpm ?? 0,
      overall_cpc: rawAp.overall_cpc ?? 0,
      spend_trend: rawAp.spend_trend || "flat",
      spend_change_pct: rawAp.spend_change_pct ?? 0,
      leads_trend: rawAp.leads_trend || "flat",
      leads_change_pct: rawAp.leads_change_pct ?? 0,
      ctr_trend: rawAp.ctr_trend || "flat",
      ctr_change_pct: rawAp.ctr_change_pct ?? 0,
      daily_spends,
      daily_leads,
      daily_ctrs,
      daily_cpms,
      daily_tsrs,
      daily_vhrs,
    };
  }, [rawAp, data]);

  const todayStats = useMemo(() => {
    const dailySpend = ap.daily_spends || [];
    const dailyLeads = ap.daily_leads || [];
    const conversionSanity = isGoogle ? (data as any)?.conversion_sanity : null;
    const googleLeadsToday = conversionSanity?.leads_today ?? null;
    const spendToday = dailySpend.length > 0 ? dailySpend[dailySpend.length - 1] : 0;
    const leadsToday = isGoogle && googleLeadsToday !== null
      ? googleLeadsToday
      : (dailyLeads.length > 0 ? dailyLeads[dailyLeads.length - 1] : 0);
    const cplToday = leadsToday > 0 ? spendToday / leadsToday : (spendToday > 0 ? spendToday : 0);
    return { spendToday, leadsToday, cplToday };
  }, [ap, isGoogle, data]);

  const mp = useMemo(() => rawMp ? rawMp : rawMtdPacing ? {
    month: new Date().toISOString().slice(0, 7),
    days_elapsed: rawMtdPacing.days_elapsed ?? 0,
    days_remaining: rawMtdPacing.days_remaining ?? 0,
    pct_through_month: rawMtdPacing.days_elapsed && rawMtdPacing.days_remaining
      ? (rawMtdPacing.days_elapsed / (rawMtdPacing.days_elapsed + rawMtdPacing.days_remaining)) * 100
      : 0,
    targets: {
      budget: rawMtdPacing.target_budget ?? clientTargets?.budget ?? 0,
      leads: rawMtdPacing.target_leads ?? clientTargets?.leads ?? 0,
      cpl: rawMtdPacing.target_cpl ?? clientTargets?.cpl ?? 0,
      svs: clientTargets?.svs ?? { low: 0, high: 0 },
      cpsv: clientTargets?.cpsv ?? { low: 0, high: 0 },
    },
    mtd: {
      spend: authMtd.spend,
      leads: authMtd.leads,
      svs: authMtd.svs,
      qualified_leads: authMtd.qualified_leads,
      cpl: authMtd.leads > 0 ? (authMtd.spend / authMtd.leads) : 0,
    },
    projected_eom: {
      spend: rawMtdPacing.projected_spend ?? 0,
      leads: rawMtdPacing.projected_leads ?? 0,
      cpl: rawMtdPacing.projected_leads > 0 ? (rawMtdPacing.projected_spend / rawMtdPacing.projected_leads) : 0,
    },
    pacing: {
      spend_pct: rawMtdPacing.pacing_spend_pct ?? 0,
      spend_status: rawMtdPacing.on_track ? "ON_TRACK" : (rawMtdPacing.pacing_spend_pct > 100 ? "AHEAD" : "BEHIND"),
      leads_pct: rawMtdPacing.pacing_leads_pct ?? 0,
      leads_status: rawMtdPacing.on_track ? "ON_TRACK" : (rawMtdPacing.pacing_leads_pct > 80 ? "ON_TRACK" : "BEHIND"),
      cpl_status: rawMtdPacing.leads_mtd > 0 && (rawMtdPacing.spend_mtd / rawMtdPacing.leads_mtd) <= (rawMtdPacing.target_cpl ?? 850) ? "ON TARGET" : "HIGH",
    },
    daily_needed: {
      spend: rawMtdPacing.days_remaining > 0 ? ((rawMtdPacing.target_budget ?? 0) - (rawMtdPacing.spend_mtd ?? 0)) / rawMtdPacing.days_remaining : 0,
      leads: rawMtdPacing.days_remaining > 0 ? ((rawMtdPacing.target_leads ?? 0) - (rawMtdPacing.leads_mtd ?? 0)) / rawMtdPacing.days_remaining : 0,
    },
    alerts: ((data as any)?.account_pulse || rawAp)?.alerts?.map((a: any) => typeof a === "string" ? a : a.message || a.alert || JSON.stringify(a)) || [],
  } : null, [rawMp, rawMtdPacing, clientTargets, data, rawAp, authMtd]);

  const displayAp = useMemo(() => {
    if (!filteredCampaign) return ap;
    return {
      ...ap,
      total_spend_30d: filteredCampaign.spend || 0,
      total_leads_30d: filteredCampaign.leads || 0,
      overall_cpl: filteredCampaign.cpl || 0,
      overall_ctr: filteredCampaign.ctr || 0,
    };
  }, [ap, filteredCampaign]);



  const criticalAlerts = useMemo(() => {
    // 1. Snapshot-based alerts
    type AlertItem = {
      id?: number;
      message: string;
      level: "critical" | "warning";
      metric: string;
      value?: string | number;
      benchmark?: string | number;
      campaignId?: string;
      campaignName?: string;
      type: string;
      isStateful?: boolean;
    };
    const raw: AlertItem[] = [];
    const cplCrit = t_cpl_critical;
    const ctrM = t_ctr_min;

    const MIN_LEADS_FOR_CPL_ALERT = 5;
    const MIN_IMPRESSIONS_FOR_CTR_ALERT = 1000;

    // A. Account Level & Health Drivers
    if (selectedCampaignId === "ALL") {
      // 1. Hardcoded thresholds (fallback)
      if (cplCrit > 0 && ap.overall_cpl > cplCrit && ap.total_leads_30d >= MIN_LEADS_FOR_CPL_ALERT) {
        raw.push({ metric: "CPL", message: "Account Avg CPL critical", value: `₹${Math.round(ap.overall_cpl)}`, benchmark: `₹${Math.round(cplCrit)}`, level: "critical", type: "ACCOUNT_CPL" });
      }

      // 2. Real-time Breakdown Audit (Captures issues like 0.00 CPQL score instantly)
      const healthBreakdown = (data as any)?.account_health_breakdown;
      if (healthBreakdown) {
        const weights: Record<string, number> = { cpsv: 25, budget: 25, cpql: 20, cpl: 20, creative: 10 };
        Object.entries(healthBreakdown).forEach(([m, s]: [string, any]) => {
          const w = weights[m] || 20;
          const ratio = s / w;
          if (ratio < 0.5) {
            let msg = "";
            switch (m) {
              case 'cpl': msg = "Cost Per Lead (CPL) is dragging down account health."; break;
              case 'cpql': msg = "Quality Lead cost (CPQL) is critical (currently 0.00 or excessive)."; break;
              case 'cpsv': msg = "Cost Per Site Visit (MTD) is inefficient."; break;
              case 'budget': msg = "Budget pacing is erratic (underspend/overspend)."; break;
              case 'creative': msg = "Creative engagement is lagging."; break;
              default: msg = `${m.toUpperCase()} performance is critical.`;
            }
            raw.push({
              metric: m.toUpperCase(),
              message: msg,
              level: ratio < 0.2 ? "critical" : "warning",
              type: `LIVE_HEALTH_${m.toUpperCase()}`
            });
          }
        });
      }
    }

    // B. Campaign Level
    const campaignsToCheck = filteredCampaign ? [filteredCampaign] : campaignAudit;
    campaignsToCheck.forEach((c: any) => {
      const name = c.campaign_name || "Unknown Campaign";
      if (c.status === "ACTIVE" || c.status === "ENABLED") {
        if (cplCrit > 0 && c.cpl > cplCrit && (c.leads ?? c.conversions ?? 0) >= MIN_LEADS_FOR_CPL_ALERT) {
          raw.push({ metric: "CPL", message: "Campaign CPL critical", value: `₹${Math.round(c.cpl)}`, benchmark: `₹${Math.round(cplCrit)}`, level: "critical", campaignId: c.campaign_id, campaignName: name, type: "CAMPAIGN_CPL" });
        }
      }
    });

    // 2. Merge with Stateful Alerts from DB
    // These alerts are now synchronized with Health Drivers (CPSV, CPL, CPQL, Budget, Creative)
    (statefulAlerts as any[]).forEach((a: any) => {
      if (a.status === "active" && (a.severity === "CRITICAL" || a.severity === "HIGH")) {
        raw.push({
          id: a.id,
          metric: a.metric || a.type,
          message: a.message,
          level: (a.severity === "CRITICAL" || a.type === "HEALTH_DRIVER") ? "critical" : "warning",
          campaignName: a.entityName,
          type: a.type,
          isStateful: true
        });
      }
    });

    // 3. Deduplicate
    const uniqueMap = new Map();
    raw.forEach(a => {
      const key = `${a.type}-${a.campaignId || a.campaignName || "all"}-${a.metric}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, a);
      }
    });
    const uniqueRaw = Array.from(uniqueMap.values());

    // 4. Group for UI
    const grouped: Array<{
      id?: number;
      metric: string;
      summary: string;
      level: "critical" | "warning";
      value?: string | number;
      benchmark?: string | number;
      campaigns: Array<{ id: string; name: string; value?: string | number }>;
      isGeneric?: boolean;
      isStateful?: boolean;
      type: string;
    }> = [];

    uniqueRaw.forEach((alert) => {
      const existing = grouped.find(g => g.metric === alert.metric && g.summary === alert.message);
      if (existing && alert.campaignId) {
        existing.campaigns.push({ id: alert.campaignId, name: alert.campaignName || "Campaign", value: alert.value });
      } else {
        grouped.push({
          id: alert.id,
          metric: alert.metric,
          summary: alert.message,
          level: alert.level,
          value: alert.value,
          benchmark: alert.benchmark,
          isGeneric: !alert.campaignId,
          isStateful: alert.isStateful,
          type: alert.type,
          campaigns: alert.campaignId ? [{ id: alert.campaignId, name: alert.campaignName || "Campaign", value: alert.value }] : []
        });
      }
    });

    return grouped;
  }, [ap, filteredCampaign, campaignAudit, statefulAlerts, t_cpl_critical, t_ctr_min, mp, isGoogle]);

  // --- Global Alerts (Used for Dropdown Indicators to avoid context-switching glitch) ---
  const allCampaignAlerts = useMemo(() => {
    type AlertItem = {
      id?: number;
      message: string;
      level: "critical" | "warning";
      metric: string;
      value?: string | number;
      benchmark?: string | number;
      campaignId?: string;
      campaignName?: string;
      type: string;
      isStateful?: boolean;
    };
    const raw: AlertItem[] = [];
    const cplCrit = t_cpl_critical;

    const MIN_LEADS_FOR_CPL_ALERT = 5;

    // A. Account Level
    if (cplCrit > 0 && ap.overall_cpl > cplCrit && ap.total_leads_30d >= MIN_LEADS_FOR_CPL_ALERT) {
      raw.push({ metric: "CPL", message: "Account Avg CPL critical", value: `₹${Math.round(ap.overall_cpl)}`, benchmark: `₹${Math.round(cplCrit)}`, level: "critical", type: "ACCOUNT_CPL" });
    }

    // B. Campaign Level (Always check all campaigns for the dropdown)
    rawCampaignAudit.forEach((c: any) => {
      const name = c.campaign_name || "Unknown Campaign";
      if (c.status === "ACTIVE" || c.status === "ENABLED") {
        if (cplCrit > 0 && c.cpl > cplCrit && (c.leads ?? c.conversions ?? 0) >= MIN_LEADS_FOR_CPL_ALERT) {
          raw.push({ metric: "CPL", message: "Campaign CPL critical", value: `₹${Math.round(c.cpl)}`, benchmark: `₹${Math.round(cplCrit)}`, level: "critical", campaignId: c.campaign_id, campaignName: name, type: "CAMPAIGN_CPL" });
        }
      }
    });

    // 2. Merge with Stateful Alerts (Always global)
    (statefulAlerts as any[]).forEach((a: any) => {
      if (a.status === "active" && (a.severity === "CRITICAL" || a.severity === "HIGH")) {
        raw.push({
          id: a.id,
          metric: a.metric || a.type,
          message: a.message,
          level: (a.severity === "CRITICAL" || a.type === "HEALTH_DRIVER") ? "critical" : "warning",
          campaignName: a.entityName,
          type: a.type,
          isStateful: true
        });
      }
    });

    // Deduplicate and group
    const uniqueMap = new Map();
    raw.forEach(a => {
      const key = `${a.type}-${a.campaignId || a.campaignName || "all"}-${a.metric}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, a);
    });

    const uniqueRaw = Array.from(uniqueMap.values());
    const grouped: any[] = [];

    uniqueRaw.forEach((alert: any) => {
      const existing = grouped.find(g => g.metric === alert.metric && g.summary === alert.message);
      if (existing && alert.campaignId) {
        existing.campaigns.push({ id: alert.campaignId, name: alert.campaignName || "Campaign", value: alert.value });
      } else {
        grouped.push({
          id: alert.id,
          metric: alert.metric,
          summary: alert.message,
          level: alert.level,
          value: alert.value,
          benchmark: alert.benchmark,
          isGeneric: !alert.campaignId,
          isStateful: alert.isStateful,
          type: alert.type,
          campaigns: alert.campaignId ? [{ id: alert.campaignId, name: alert.campaignName || "Campaign", value: alert.value }] : []
        });
      }
    });

    return grouped;
  }, [ap, rawCampaignAudit, statefulAlerts, t_cpl_critical]);


  // ─── Chart-data derivations (memoized so Recharts doesn't re-render on unrelated state changes) ───

  const displayDateRange = useMemo(() => {
    const googleWindow = (data as any)?.window;
    if (googleWindow?.since && googleWindow?.until) return { since: googleWindow.since, until: googleWindow.until };
    const dateRange = (data as any)?.date_range;
    if (dateRange?.since && dateRange?.until) return { since: dateRange.since, until: dateRange.until };
    const period = (data as any)?.period?.primary;
    if (period?.start && period?.end) return { since: period.start, until: period.end };
    return null;
  }, [data]);

  const dayLabels = useMemo(() =>
    ap.daily_spends.map((_: number, i: number) => {
      if (displayDateRange?.since) {
        const d = new Date(`${displayDateRange.since}T00:00:00`);
        d.setDate(d.getDate() + i);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }
      return `Day ${i + 1}`;
    }),
    [ap.daily_spends, displayDateRange]);

  const dailyChartData = useMemo(() =>
    ap.daily_spends.map((spend: number, i: number) => {
      const leads = ap.daily_leads[i] ?? 0;
      return {
        day: dayLabels[i] || `Day ${i + 1}`,
        spend: Math.round(spend),
        leads,
        cpl: leads > 0 ? Math.round(spend / leads) : 0,
      };
    }),
    [ap.daily_spends, ap.daily_leads, dayLabels]);

  const safeCreativeHealth: any[] = useMemo(
    () => Array.isArray(creativeHealth) ? creativeHealth : [],
    [creativeHealth]
  );

  const { videoCreatives, blendedTSR, blendedVHR } = useMemo(() => {
    const vids = safeCreativeHealth.filter((c: any) => c.is_video && c.impressions > 0);
    const totalImp = vids.reduce((s: number, c: any) => s + c.impressions, 0);
    return {
      videoCreatives: vids,
      blendedTSR: totalImp > 0 ? vids.reduce((s: number, c: any) => s + c.thumb_stop_pct * c.impressions, 0) / totalImp : null,
      blendedVHR: totalImp > 0 ? vids.reduce((s: number, c: any) => s + c.hold_rate_pct * c.impressions, 0) / totalImp : null,
    };
  }, [safeCreativeHealth]);

  const multiMetricChartData = useMemo(() => {
    const dailyVhrs = ap.daily_vhrs ?? [];
    const allVhrZero = dailyVhrs.length === 0 || dailyVhrs.every((v: number) => !v || v === 0);
    const dailyTsrs = ap.daily_tsrs ?? [];
    const allTsrZero = dailyTsrs.length === 0 || dailyTsrs.every((v: number) => !v || v === 0);
    return (Array.isArray(ap.daily_ctrs) ? ap.daily_ctrs : []).map((_: number, i: number) => {
      const dailyClick = ap.daily_clicks?.[i] ?? 0;
      const dailyImp = ap.daily_impressions?.[i] ?? 0;
      return {
        day: dayLabels[i],
        ctr: parseFloat(calculateCTR(dailyClick, dailyImp).toFixed(2)),
        tsr: allTsrZero ? (blendedTSR ?? 0) : (dailyTsrs[i] ?? blendedTSR ?? 0),
        vhr: allVhrZero ? (blendedVHR ?? 0) : (dailyVhrs[i] ?? blendedVHR ?? 0),
        cpm: ap.daily_cpms?.[i] ?? ap.overall_cpm,
      };
    });
  }, [ap.daily_ctrs, ap.daily_clicks, ap.daily_impressions, ap.daily_tsrs, ap.daily_vhrs, ap.daily_cpms, ap.overall_cpm, dayLabels, blendedTSR, blendedVHR]);

  // ─── 6. Derived Performance Metrics (Must be before early returns) ────────
  const lastSuccessfulFetch =
    syncState?.last_successful_fetch ||
    (data as any)?.last_successful_fetch ||
    (data as any)?.generated_at ||
    (data as any)?.timestamp ||
    null;
  const lastSuccessfulFetchDate = parseSyncTimestamp(lastSuccessfulFetch);

  const analysisSummary = (data as any)?.summary || {
    total_fatigue_alerts: ((data as any)?.frequency_audit?.alerts || []).length,
    immediate_actions: ((data as any)?.auto_pause_candidates || []).length,
  };

  const costStack = (data as any)?.cost_stack || {};
  const rawScoringSummary = (data as any)?.scoring_summary || {};

  const scoringSummary = useMemo(() => {
    if (campaignAnalysis.length === 0) return null;

    return {
      total: campaignAnalysis.length,
      winners: campaignAnalysis.filter((a: any) => (a.health_score ?? a.score ?? 0) >= 70).length,
      watch: campaignAnalysis.filter((a: any) => (a.health_score ?? a.score ?? 0) >= 35 && (a.health_score ?? a.score ?? 0) < 70).length,
      underperformers: campaignAnalysis.filter((a: any) => (a.health_score ?? a.score ?? 0) < 35).length,
      auto_pause: Array.isArray(rawScoringSummary?.campaign_scores?.auto_pause)
        ? rawScoringSummary.campaign_scores.auto_pause
        : [],
    };
  }, [campaignAnalysis, rawScoringSummary]);

  const funnelData = costStack?.funnel_split_actual
    ? Object.entries(costStack.funnel_split_actual)
      .filter(([, v]) => (v as number) > 0)
      .map(([key, val]) => ({ name: key, value: val as number }))
    : isGoogle && (data as any)?.search_summary && (data as any)?.dg_summary && ap.total_spend_30d > 0
      ? [
        { name: "Search", value: Math.round(((((data as any)?.search_summary?.spend ?? 0) / ap.total_spend_30d) * 100)) || 0 },
        { name: "Demand Gen", value: Math.round(((((data as any)?.dg_summary?.spend ?? 0) / ap.total_spend_30d) * 100)) || 0 },
      ].filter(d => d.value > 0)
      : [];

  const mtdFixedData = (mtdAnalysisData as any) || (data as any);
  const backendHealthScore = mtdFixedData?.account_health_score;
  const backendBreakdown = mtdFixedData?.account_health_breakdown || {};
  const accountHealthScore = typeof backendHealthScore === "number" ? backendHealthScore : 0;

  const accountHealthClassification = useMemo(() => {
    if (accountHealthScore >= 70) return "WINNER";
    if (accountHealthScore < 35) return "UNDERPERFORMER";
    return "WATCH";
  }, [accountHealthScore]);

  const mtdStats = (mtdData as any)?.mtd;
  const healthScoreComponents = {
    cpsv: backendBreakdown?.cpsv ?? 0,
    pacing_budget: backendBreakdown?.budget ?? 0,
    cpql: backendBreakdown?.cpql ?? 0,
    cpl: backendBreakdown?.cpl ?? 0,
    creative: backendBreakdown?.creative ?? 0,
  };

  const svsMtd = authMtd.svs;
  const qLeadsMtd = authMtd.qualified_leads;
  const cpsvMtd = authMtd.svs > 0 ? authMtd.spend / authMtd.svs : 0;
  const targetCpsvValue = t_cpsv_target || (isGoogle ? 20000 : 0);

  const pacingSpendStatus = mp?.pacing?.spend_status || "UNKNOWN";
  const healthBreakdownItems = useMemo(() => {
    const items = [
      { label: "CPSV", score: healthScoreComponents.cpsv, weight: 25, value: mtdStats?.cpsv, target: t_cpsv_target },
      { label: "Budget", score: healthScoreComponents.pacing_budget, weight: 25, value: mtdStats?.spend, target: t_budget_target },
      { label: "CPQL", score: healthScoreComponents.cpql, weight: 20, value: mtdStats?.cpql, target: t_cpql_target },
      { label: "CPL", score: healthScoreComponents.cpl, weight: 20, value: mtdStats?.cpl, target: t_cpl_target },
      { label: "Creative", score: healthScoreComponents.creative, weight: 10 },
    ];
    return items.map(item => ({
      ...item,
      status: getMetricStatus(item.score, item.weight)
    }));
  }, [healthScoreComponents, mtdStats, t_cpsv_target, t_budget_target, t_cpql_target, t_cpl_target]);

  const agentVersion: string = (data as any)?.agent_version || "";
  const searchSummary: any = isGoogle ? (data as any)?.search_summary || null : null;
  const dgSummary: any = isGoogle ? (data as any)?.dg_summary || null : null;
  const patternAnalysis: any = (data as any)?.pattern_analysis || null;
  const playbooksTriggered: any[] = (data as any)?.playbooks_triggered || (data as any)?.sop_triggers || [];
  const totalAdsAnalyzed: number = creativeHealth?.length || 0;
  const totalCampaignsAnalyzed: number = campaignAudit?.length || 0;

  const adsWithLeads = creativeHealth.filter((a: any) => (a.leads ?? 0) > 0 && (a.spend ?? 0) > 0);
  const bestAd: any = adsWithLeads.length > 0
    ? adsWithLeads.reduce((best: any, cur: any) => ((cur.cpl || Infinity) < (best.cpl || Infinity) ? cur : best), adsWithLeads[0])
    : null;
  const worstAd: any = adsWithLeads.length > 0
    ? adsWithLeads.reduce((worst: any, cur: any) => ((cur.cpl || 0) > (worst.cpl || 0) ? cur : worst), adsWithLeads[0])
    : null;

  const targetCpl: number = t_cpl_target;
  const totalAdSpend = creativeHealth.reduce((s: number, a: any) => s + (a.spend || 0), 0);
  const wastedSpend = creativeHealth
    .filter((a: any) => (a.cpl || 0) > targetCpl && (a.spend || 0) > 0)
    .reduce((s: number, a: any) => s + (a.spend || 0), 0);
  const budgetEfficiencyPct: number = totalAdSpend > 0 ? Math.round((wastedSpend / totalAdSpend) * 100) : 0;

  const proRatedBudgetThreshold = useMemo(() => {
    const budget = t_budget_target || 0;
    if (mp?.pct_through_month && budget > 0) {
      return budget * (mp.pct_through_month / 100);
    }
    return budget;
  }, [t_budget_target, mp?.pct_through_month]);

  const budgetTargetMonthly = t_budget_target || clientTargets?.budget || 0;
  const leadsTargetMonthly = t_leads_target || clientTargets?.leads || 0;
  const daysInMonth = (mp?.days_elapsed || 0) + (mp?.days_remaining || 1);

  // --- Lifted KPI Card UI Logic Hooks ---
  const kpiCplStatus = useMemo(() => (
    metaBenchmarksData
      ? displayAp.overall_cpl <= t_cpl_target
        ? { label: "On Target", variant: "success" as const }
        : displayAp.overall_cpl <= t_cpl_critical
          ? { label: "Watch", variant: "warning" as const }
          : { label: "Alert", variant: "destructive" as const }
      : undefined
  ), [displayAp.overall_cpl, t_cpl_target, t_cpl_critical, metaBenchmarksData]);

  const kpiCpsvStatus = useMemo(() => (
    (cpsvMtd || 0) > 0
      ? (cpsvMtd || 0) <= targetCpsvValue
        ? { label: "On Target", variant: "success" as const }
        : (cpsvMtd || 0) <= targetCpsvValue * 1.3
          ? { label: "Watch", variant: "warning" as const }
          : { label: "Alert", variant: "destructive" as const }
      : { label: "Awaiting Data", variant: "secondary" as const }
  ), [cpsvMtd, targetCpsvValue]);

  const kpiPacingValue = useMemo(() => (
    authMtd.spend && proRatedBudgetThreshold > 0
      ? `${Math.round((authMtd.spend / proRatedBudgetThreshold) * 100)}%`
      : "—"
  ), [authMtd.spend, proRatedBudgetThreshold]);

  const kpiPacingStatus = useMemo(() => {
    if (!authMtd.spend || !proRatedBudgetThreshold || proRatedBudgetThreshold <= 0) return { label: "N/A", variant: "secondary" as const };
    const ratio = authMtd.spend / proRatedBudgetThreshold;
    if (ratio >= 0.9 && ratio <= 1.1) return { label: "On Track", variant: "success" as const };
    if (ratio > 1.1) return { label: "Ahead", variant: "warning" as const };
    return { label: "Behind", variant: "destructive" as const };
  }, [authMtd.spend, proRatedBudgetThreshold]);

  // ─── 7. Data Loading & Errors (Below hooks) ─────────────────────────

  if (analysisError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-200">
          Failed to load dashboard data: {analysisError.message.replace(/^\d+:\s*/, "")}
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  // ─── 8. Component View (Rendering Starts Here) ──────────────────────

  return (
    <div className="page-shell max-w-[1600px] mx-auto grid-cols-1">
      {/* Top bar */}
      <section className="page-zone min-w-0" aria-labelledby="dashboard-title">
        <div className="flex items-center justify-between gap-4 flex-wrap rounded-[10px] border border-border/70 bg-card/80 px-5 py-4 shadow-sm">
          <div className="page-subsection">
            <div>
              <h1 id="dashboard-title" className="text-2xl font-bold text-foreground tracking-[0.8px]">Dashboard</h1>
              <p className="type-base text-muted-foreground">
                {activeClient?.name || ""} · {activePlatformInfo?.label || ""} · {cadenceLabel.replace(/_/g, " ")} analysis{agentVersion ? ` · ${agentVersion}` : ""}
              </p>
            </div>
            <div className="page-subsection gap-2">
              <Badge variant="warning" className="w-fit font-semibold">
                {displayDateRange
                  ? `Showing: ${cadenceDisplayMap[cadenceLabel] || "Last 7 Days"} | ${formatRangeDate(displayDateRange.since)} – ${formatRangeDate(displayDateRange.until)}`
                  : `Showing: ${cadenceDisplayMap[cadenceLabel] || "Last 7 Days"}`}
              </Badge>
              {lastSuccessfulFetchDate && (
                <Badge variant="secondary" className="w-fit text-muted-foreground">
                  Data as of: {lastSuccessfulFetchDate.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ({formatHoursAgo(lastSuccessfulFetch, now)})
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-muted/50 border-border/70 text-xs font-semibold tracking-wide h-9 min-w-[200px] justify-between transition-all hover:bg-muted/80 px-3"
                  disabled={rawCampaignAudit.length === 0}
                >
                  <span className="truncate mr-2">
                    {selectedCampaignId === "ALL"
                      ? (rawCampaignAudit.length === 0 ? "No data yet" : "All Campaigns")
                      : (rawCampaignAudit.find((c: any) => c.campaign_id === selectedCampaignId)?.campaign_name || "Select Campaign")
                    }
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[300px] bg-background/95 backdrop-blur-xl border-border/60 shadow-2xl p-1.5" align="end">
                <DropdownMenuItem
                  className="group text-sm font-medium tracking-wide cursor-pointer rounded-md focus:bg-primary/10 focus:text-black hover:text-black transition-colors py-2.5 px-3 mb-0.5"
                  onClick={() => setSelectedCampaignId("ALL")}
                >
                  <div className="flex items-center gap-2 overflow-hidden group-hover:text-black">
                    <div className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      allCampaignAlerts.length === 0 ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                    )} />
                    All Campaigns
                  </div>
                </DropdownMenuItem>

                <div className="h-px bg-border/40 my-1.5 mx-1" />

                {rawCampaignAudit.map((c: any) => {
                  const hasAlerts = allCampaignAlerts.some((g: any) => g.campaigns.some((camp: any) => camp.id === c.campaign_id));
                  return (
                    <DropdownMenuItem
                      key={c.campaign_id}
                      className="group text-sm font-medium tracking-wide cursor-pointer rounded-md focus:bg-primary/10 focus:text-black hover:text-black transition-colors py-2.5 px-3 mb-0.5"
                      onClick={() => setSelectedCampaignId(c.campaign_id)}
                    >
                      <div className="flex items-center justify-between w-full gap-3 overflow-hidden">
                        <div className="flex items-center gap-2 truncate">
                          <div className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            !hasAlerts ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                          )} />
                          <span className={cn(
                            "truncate transition-colors group-hover:text-black",
                            !hasAlerts ? "text-emerald-700 dark:text-emerald-500" : "text-foreground"
                          )}>
                            {c.campaign_name}
                          </span>
                        </div>
                        {hasAlerts && (
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-amber-300 bg-amber-100 text-amber-800 font-bold shrink-0 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/50">
                            Action
                          </Badge>
                        )}
                        {!hasAlerts && (
                          <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 opacity-40" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] rounded-lg border border-black bg-black text-white hover:bg-white hover:text-black transition-colors"
                  disabled={isTriggeringAgent}
                  aria-disabled={isTriggeringAgent}
                  onClick={async () => {
                    if (isTriggeringAgent) return;
                    setIsTriggeringAgent(true);
                    try {
                      const res = await fetch("/api/scheduler/run-now", { method: "POST" });
                      if (!res.ok) {
                        let msg = `Failed to trigger agent run (HTTP ${res.status})`;
                        try {
                          const json = await res.json();
                          msg = json?.message || json?.error || msg;
                        } catch { }
                        throw new Error(msg);
                      }
                      toast({
                        title: "Agent run triggered",
                        description: "Watch the sync status — data will refresh automatically when the run completes.",
                      });
                    } catch (e: any) {
                      console.error("[Run Agent] trigger failed:", e);
                      toast({
                        title: "Run Agent failed",
                        description: e?.message || "Could not trigger agent run.",
                        variant: "destructive",
                      });
                    } finally {
                      setIsTriggeringAgent(false);
                    }
                  }}
                  data-testid="button-run-audit"
                >
                  {isTriggeringAgent ? "Triggering…" : "Run Agent now"}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Click to trigger an immediate agent run. Normally runs daily at 9 AM IST.</p>
              </TooltipContent>
            </Tooltip>
          </div>

        </div>
      </section>

      {/* Critical Alerts Banner */}
      {criticalAlerts.length > 0 && (
        <section className="page-subsection min-w-0" aria-labelledby="dashboard-critical-alerts">
          <h2 id="dashboard-critical-alerts" className="sr-only">Critical alerts</h2>
          <div className="space-y-3">
            {(showAllCriticalAlerts ? criticalAlerts : criticalAlerts.slice(0, 3)).map((group, i) => {
              const isCritical = group.level === "critical";
              const isWarning = group.level === "warning";

              return (
                <div
                  key={i}
                  className={cn(
                    "group relative flex flex-col gap-2 p-3.5 rounded-xl border transition-all hover:shadow-sm overflow-hidden",
                    isCritical ? "bg-red-500/[0.03] border-red-500/10" :
                      isWarning ? "bg-amber-500/[0.03] border-amber-500/10" :
                        "bg-blue-500/[0.03] border-blue-500/10"
                  )}
                >
                  {/* Metric Tag & Summary */}
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-bold tracking-tight px-1.5 py-0 rounded h-4 border-0 shrink-0 mt-0.5",
                          isCritical ? "bg-red-500/15 text-red-400" :
                            isWarning ? "bg-amber-500/15 text-amber-600" :
                              "bg-blue-500/15 text-blue-600"
                        )}
                      >
                        {group.metric}
                      </Badge>
                      <span className={cn(
                        "text-[13px] font-semibold leading-tight break-words min-w-0 flex-1",
                        isCritical ? "text-red-900/90" : isWarning ? "text-amber-900/90" : "text-blue-900/90"
                      )}>
                        {group.summary}
                        {group.campaigns.length > 1 && ` in ${group.campaigns.length} campaigns`}
                      </span>
                    </div>
                    <AlertTriangle className={cn(
                      "w-3.5 h-3.5 opacity-40 shrink-0 mt-0.5",
                      isCritical ? "text-red-500" : isWarning ? "text-amber-500" : "text-blue-500"
                    )} />
                  </div>

                  {/* Context & Values */}
                  <div className="flex flex-col gap-1.5 ml-1">
                    {group.isGeneric ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span className="font-medium text-foreground">{group.value}</span>
                        {group.benchmark && (
                          <>
                            <ArrowRight className="w-2.5 h-2.5 opacity-30" />
                            <span>Target: <span className="font-semibold text-foreground">{group.benchmark}</span></span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {group.campaigns.map((camp, ci) => (
                          <div key={ci} className="flex items-center justify-between group/line gap-2 min-w-0">
                            <div className="flex items-center gap-2 overflow-hidden min-w-0 flex-1">
                              <div className="w-1 h-1 rounded-full bg-current opacity-20 shrink-0" />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground truncate transition-colors cursor-help block min-w-0">
                                    {camp.name}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="text-xs">{camp.name}</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            {camp.value && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-xs font-bold text-foreground">{camp.value}</span>
                                {group.benchmark && (
                                  <span className="text-xs text-muted-foreground opacity-60">vs {group.benchmark}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Quick Actions */}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1 transition-all duration-200 flex-wrap">
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2 py-0 border border-current/10 hover:bg-white/40 font-bold"
                        onClick={() => setActiveFixAlert(group)}
                      >
                        Fix Suggestion
                      </Button>
                      {group.campaigns.length === 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2 py-0 border border-current/10 hover:bg-white/40 font-bold"
                          onClick={() => setSelectedCampaignId(group.campaigns[0].id)}
                        >
                          View Campaign
                        </Button>
                      )}
                    </div>
                    {group.isStateful && group.id && (
                      <div className="flex gap-1.5 flex-wrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2 py-0 border border-emerald-500/20 text-emerald-600 hover:bg-emerald-50 font-bold flex items-center gap-1"
                          onClick={() => handleComplete(group.id!)}
                        >
                          <Check className="w-2.5 h-2.5" />
                          Mark as Complete
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2 py-0 border border-red-500/20 text-red-600 hover:bg-red-50 font-bold flex items-center gap-1"
                          onClick={() => handleReject(group.id!)}
                        >
                          <Ban className="w-2.5 h-2.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {criticalAlerts.length > 3 && (
              <button
                onClick={() => setShowAllCriticalAlerts(prev => !prev)}
                className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-1.5 border border-border/30 rounded-lg bg-muted/20 hover:bg-muted/40"
              >
                {showAllCriticalAlerts ? "Show less" : `Show ${criticalAlerts.length - 3} more alert${criticalAlerts.length - 3 > 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* New Entity Detection Banner */}
      {newEntities?.hasNewEntities && (
        <section aria-labelledby="dashboard-new-entities">
          <h2 id="dashboard-new-entities" className="sr-only">New entities detected</h2>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">
              {newEntities.totalNew} new {newEntities.totalNew === 1 ? "entity" : "entities"} detected since last analysis
              {newEntities.newCampaigns.length > 0 && ` (${newEntities.newCampaigns.length} campaign${newEntities.newCampaigns.length > 1 ? "s" : ""})`}
              {newEntities.newAdsets.length > 0 && ` (${newEntities.newAdsets.length} ad set${newEntities.newAdsets.length > 1 ? "s" : ""})`}
              . Run agent to include them.
            </span>
          </div>
        </section>
      )}

      {/* Zero/Failed Data State Banner */}
      {rawCampaignAudit.length === 0 && displayAp.total_spend_30d === 0 && (
        <section className="page-zone mb-6">
          <Card className={`border-dashed border-2 ${syncState?.status === "failed" ? "border-red-500/30 bg-red-500/5" : "border-primary/20 bg-primary/5"}`}>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className={`h-12 w-12 rounded-full flex items-center justify-center mb-4 ${syncState?.status === "failed" ? "bg-red-500/10" : "bg-primary/10"}`}>
                {syncState?.status === "failed" ? (
                  <XCircle className="h-6 w-6 text-red-500" />
                ) : (
                  <Database className="h-6 w-6 text-primary" />
                )}
              </div>
              <h2 className="text-xl font-bold text-foreground">
                {syncState?.status === "failed" ? "Data Synchronization Failed" : "No Performance Data Available"}
              </h2>
              <p className="text-base text-muted-foreground mt-2 max-w-md">
                {syncState?.status === "failed"
                  ? "The last attempt to communicate with the advertising platform encountered an error. Please verify your connection settings or run the agent again."
                  : "We haven't received any campaigns or spend data for this client yet. Click 'Run Agent now' at the top to initiate the first extraction."}
              </p>
              {syncState?.error && (
                <div className="mt-4 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs font-mono text-left max-w-lg break-words">
                  {syncState.error}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* KPI Cards */}
      <section className="page-zone min-w-0" aria-labelledby="dashboard-kpis">
        <h2 id="dashboard-kpis" className="sr-only">Key performance indicators</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <KpiCard
            title={`Spend · ${periodLabel}`}
            value={formatINR(displayAp.total_spend_30d, 0)}
            trend={ap.spend_trend}
            trendValue={`${Math.abs(ap.spend_change_pct ?? 0).toFixed(1)}%`}
            icon={IndianRupee}
            subtitle={`MTD: ${formatINR(mp?.mtd?.spend || 0, 0)}`}
            todayValue={formatINR(todayStats.spendToday, 0)}
            status={verifyData ? (
              verifyData.verified
                ? { label: "Verified ✓", variant: "success" }
                : { label: `Mismatch: ${(verifyData.discrepancyPct ?? 0).toFixed(1)}%`, variant: "warning" }
            ) : undefined}
          />
          <KpiCard
            title={`Leads · ${periodLabel}`}
            value={(displayAp.total_leads_30d || 0).toString()}
            trend={ap.leads_trend}
            trendValue={`${Math.abs(ap.leads_change_pct ?? 0).toFixed(1)}%`}
            icon={Users}
            subtitle={`MTD: ${mp?.mtd?.leads || 0} leads`}
            todayValue={todayStats.leadsToday.toString()}
            status={verifyData ? (
              verifyData.leadsDiscrepancyPct <= 2
                ? { label: "Leads Verified ✓", variant: "success" }
                : verifyData.leadsDiscrepancyPct <= 10
                  ? { label: `Leads Δ: ${(verifyData.leadsDiscrepancyPct ?? 0).toFixed(1)}%`, variant: "warning" }
                  : { label: `Leads Mismatch: ${(verifyData.leadsDiscrepancyPct ?? 0).toFixed(1)}%`, variant: "destructive" }
            ) : undefined}
          />
          <KpiCard
            title={`Avg CPL · ${periodLabel}`}
            value={formatINR(displayAp.overall_cpl, 0)}
            trend={ap.spend_trend}
            trendValue={`${Math.abs((ap as any).cpl_change_pct || ap.spend_change_pct || 0).toFixed(1)}%`}
            icon={Target}
            isInverse
            subtitle={`MTD CPL: ${formatINR(mp?.mtd?.cpl || 0, 0)}`}
            todayValue={formatINR(todayStats.cplToday, 0)}
            status={kpiCplStatus}
          />

          <KpiCard
            title="Avg CPSV (MTD)"
            value={formatINR(cpsvMtd || 0, 0)}
            icon={Zap}
            isInverse
            status={kpiCpsvStatus}
            subtitle={`vs target (${formatINR(targetCpsvValue, 0)})`}
          >
            {(cpsvMtd || 0) === 0 && (
              <Link href="/mtd-deliverables">
                <Button variant="outline" size="sm" className="w-full h-8 text-[11px] font-bold gap-1.5 bg-primary/5 border-primary/20 hover:bg-primary/10">
                  <PlusCircle className="w-3.5 h-3.5" />
                  SYNC SITE VISITS
                </Button>
              </Link>
            )}
          </KpiCard>

          <KpiCard
            title="Monthly Pacing"
            value={kpiPacingValue}
            icon={Gauge}
            status={kpiPacingStatus}
            subtitle={proRatedBudgetThreshold > 0 ? `Target: ${formatINR(proRatedBudgetThreshold, 0)}` : "No pacing data"}
          />
          <KpiCard
            title="Active Alerts"
            value={`${criticalAlerts.length}`}
            icon={AlertTriangle}
            subtitle={selectedCampaignId === "ALL" ? "Combined critical issues" : "Campaign critical issues"}
            status={criticalAlerts.length > 0 ? { label: "Attention Required", variant: "destructive" } : { label: "Clear", variant: "success" }}
          />
        </div>


      </section>

      {/* Data Verification Widget */}
      {verifyData && (
        <Card className={
          verifyData.verified
            ? "border-emerald-500/30"
            : (verifyData.discrepancyPct <= 5 && verifyData.leadsDiscrepancyPct <= 5)
              ? "border-amber-500/30"
              : "border-red-500/30"
        }>
          <CardContent className="card-content-premium overflow-x-auto">
            <div className="space-y-3 min-w-[700px]">
              {/* Header */}
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${verifyData.verified ? "bg-emerald-500/10" : (verifyData.discrepancyPct <= 5 && verifyData.leadsDiscrepancyPct <= 5) ? "bg-amber-500/10" : "bg-red-500/10"
                    }`}>
                    {verifyData.verified
                      ? <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      : (verifyData.discrepancyPct <= 5 && verifyData.leadsDiscrepancyPct <= 5)
                        ? <ShieldAlert className="w-4 h-4 text-amber-400" />
                        : <ShieldX className="w-4 h-4 text-red-400" />
                    }
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-base text-slate-900 text-muted-foreground uppercase tracking-wider">Data Verification</h3>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Validates consistency between the backend Intelligence agent and live platform APIs. Cross-checks spend and lead counts across daily arrays, entity-level aggregations, and reported totals.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      {verifyData.status === "verified" ? "Cross-checked with API" : verifyData.status === "cross_checked" ? "Cross-checked across cadences" : "Single source"}
                      {verifyData.lastVerified && ` · ${new Date(verifyData.lastVerified).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {verifyData.leadsCorrectionApplied && (
                    <Badge variant="secondary" className="text-xs px-2 py-0.5 text-blue-400 bg-blue-500/10">
                      Daily leads auto-corrected ({verifyData.leadsCorrectionFactor}x → 1x)
                    </Badge>
                  )}
                  <Badge variant="secondary" className={`text-xs px-2 py-1.5 ${verifyData.verified ? "text-emerald-400 bg-emerald-500/10" : (verifyData.discrepancyPct <= 5 && verifyData.leadsDiscrepancyPct <= 5) ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10"
                    }`}>
                    {verifyData.verified ? "All Verified" : (verifyData.discrepancyPct <= 5 && verifyData.leadsDiscrepancyPct <= 5) ? "Warning" : "Mismatch"}
                  </Badge>
                </div>
              </div>
              {/* Spend Verification Row */}
              <div className="flex items-center gap-6 text-center border-t border-border/30 pt-3">
                <div className="w-20 text-left">
                  <p className="text-xg text-muted-foreground uppercase tracking-wider font-bold">Spend</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground/80">API Spend</p>
                  <p className="text-xg font-semibold tabular-nums text-foreground">{formatINR(verifyData.apiSpend, 0)}</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground/80">Agent Spend</p>
                  <p className="text-xg font-semibold tabular-nums text-foreground">{formatINR(verifyData.agentSpend, 0)}</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground/80">Difference</p>
                  <p className={`text-xg font-bold tabular-nums ${verifyData.discrepancyPct <= 2 ? "text-emerald-400" : verifyData.discrepancyPct <= 5 ? "text-amber-400" : "text-red-400"}`}>
                    {(verifyData.discrepancyPct ?? 0).toFixed(1)}%
                  </p>
                </div>
                <Badge variant="secondary" className={`text-[13px] h-4 px-2.5 py-2.5 ${verifyData.discrepancyPct <= 2 ? "text-emerald-400 bg-emerald-500/10" : verifyData.discrepancyPct <= 5 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10"}`}>
                  {verifyData.discrepancyPct <= 2 ? "MATCH" : verifyData.discrepancyPct <= 5 ? "DRIFT" : "MISMATCH"}
                </Badge>
              </div>
              {/* Leads Verification Row */}
              <div className="flex items-center gap-6 text-center border-t border-border/30 pt-3">
                <div className="w-20 text-left">
                  <p className="text-xg text-muted-foreground uppercase tracking-wider font-bold">Leads</p>
                </div>
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-help">
                        <p className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground/80">Entity Leads</p>
                        <p className="text-xg font-semibold tabular-nums text-foreground">{formatNumber(verifyData.apiLeads)}</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-[10px]">
                      <p>Sum from entity-level arrays (creative_health / adset_analysis)</p>
                      {verifyData.creativeHealthLeads !== null && <p>Creative Health: {verifyData.creativeHealthLeads}</p>}
                      {verifyData.campaignAnalysisLeads !== null && <p>Campaign Analysis: {verifyData.campaignAnalysisLeads}</p>}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div>
                  <p className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground/80">Reported Leads</p>
                  <p className="text-xg font-semibold tabular-nums text-foreground">{formatNumber(verifyData.agentLeads)}</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground/80">Difference</p>
                  <p className={`text-xg font-bold tabular-nums ${verifyData.leadsDiscrepancyPct <= 2 ? "text-emerald-400" : verifyData.leadsDiscrepancyPct <= 10 ? "text-amber-400" : "text-red-400"}`}>
                    {(verifyData.leadsDiscrepancyPct ?? 0).toFixed(1)}%
                  </p>
                </div>
                <Badge variant="secondary" className={`text-[13px] h-4 px-2.5 py-2.5 ${verifyData.leadsDiscrepancyPct <= 2 ? "text-emerald-400 bg-emerald-500/10" : verifyData.leadsDiscrepancyPct <= 10 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10"}`}>
                  {verifyData.leadsDiscrepancyPct <= 2 ? "MATCH" : verifyData.leadsDiscrepancyPct <= 10 ? "DRIFT" : "MISMATCH"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Breakdown Sections */}
      <FixSuggestionModal alert={activeFixAlert} onClose={() => setActiveFixAlert(null)} intellectInsights={rawIntellectInsights} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="h-full flex flex-col">
          <CardContent className="p-4 flex flex-col justify-center flex-1">
            <div className="flex items-center gap-1.5 mb-4">
              <h3 className="text-base text-slate-900 text-muted-foreground uppercase tracking-wider">Account Health</h3>
              <Badge variant="secondary" className="text-xs px-1 py-1 text-blue-400 bg-blue-500/10 border-blue-500/20">MTD Fixed</Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs space-y-2 p-3">
                  <p className="font-semibold text-foreground border-b border-border/40 pb-1.5">Weighted Analysis Logic</p>
                  <div className="space-y-1 text-muted-foreground">
                    {isGoogle ? (
                      <>
                        <p>• 25% CPSV (Cost Per Site Visit)</p>
                        <p>• 20% Budget (MTD Pacing)</p>
                        <p>• 20% CPQL (Cost Per Quality Lead)</p>
                        <p>• 10% CPL (Cost Per Lead)</p>
                        <p>• 15% Campaign Health (Avg)</p>
                        <p>• 10% Creative Health (Avg)</p>
                      </>
                    ) : (
                      <>
                        <p>• 25% CPSV (Cost Per Site Visit)</p>
                        <p>• 25% Budget (MTD Pacing)</p>
                        <p>• 20% CPQL (Cost Per Quality Lead)</p>
                        <p>• 20% CPL (Cost Per Lead)</p>
                        <p>• 10% Creative Health (Avg)</p>
                      </>
                    )}
                  </div>
                  <p className="pt-1 text-xs ">Hover individual metrics for target details</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="t-micro font-medium uppercase tracking-wider text-muted-foreground">
                    Performance Intelligence Score
                  </p>
                  <p className="t-kpi text-foreground">{accountHealthScore}</p>
                </div>
                <StatusBadge classification={accountHealthClassification} />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className={`w-full h-2 rounded-full ${getHealthBarBg(accountHealthScore)}`}>
                  <div
                    className={`h-full rounded-full transition-all ${getHealthBgColor(accountHealthScore)}`}
                    style={{ width: `${Math.min(accountHealthScore || 0, 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right t-micro tabular-nums text-muted-foreground">
                  {accountHealthScore}
                </span>
              </div>
              <p className="mt-3 t-micro text-muted-foreground">
                MTD-based dual-gate health analysis
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2 h-full flex flex-col">
          <CardContent className="card-content-premium">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-base font-semibold text-slate-950 uppercase tracking-wider">Health Score Breakdown</h3>
              <Badge variant="secondary" className="text-xs px-1.5 py-1.5 text-blue-400 bg-blue-500/10 border-blue-500/20">MTD Fixed</Badge>
            </div>
            <div className={`grid gap-3 ${isGoogle ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-3"}`}>
              {healthBreakdownItems.map((item) => {
                const normalized = item.weight > 0 ? Math.max(0, Math.min((item.score / item.weight) * 100, 100)) : 0;
                const scoreOutOfWeight = item.score;
                const ratioStatus = getMetricStatus(item.score, item.weight);
                const ratioBarClass =
                  ratioStatus === "GREEN"
                    ? "bg-emerald-400"
                    : ratioStatus === "YELLOW"
                      ? "bg-amber-500"
                      : ratioStatus === "ORANGE"
                        ? "bg-orange-500"
                        : "bg-red-500";
                const ratioTrackClass =
                  ratioStatus === "GREEN"
                    ? "bg-emerald-400/20"
                    : ratioStatus === "YELLOW"
                      ? "bg-amber-500/20"
                      : ratioStatus === "ORANGE"
                        ? "bg-orange-500/20"
                        : "bg-red-500/20";

                const targetDisplay = (item.target && ["CPSV", "Budget", "CPQL", "CPL"].includes(item.label))
                  ? formatINR(item.target, 0)
                  : null;

                const cardContent = (
                  <div key={item.label} className="rounded-md border border-border/30 bg-card p-4 shadow-xs hover:border-primary/20 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <p className="t-label text-muted-foreground uppercase tracking-widest">
                            {item.label} ({item.weight})
                          </p>
                          <p className="text-lg font-semibold tabular-nums text-foreground whitespace-nowrap leading-none">
                            {scoreOutOfWeight.toFixed(2)}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`t-micro border shrink-0 whitespace-nowrap self-start ${getMetricStatusColor(item.status).bg} ${getMetricStatusColor(item.status).text} ${getMetricStatusColor(item.status).border}`}
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className={`w-full h-1.5 rounded-full ${ratioTrackClass}`}>
                          <div
                            className={`h-full rounded-full transition-all ${ratioBarClass}`}
                            style={{ width: `${normalized}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );

                if (targetDisplay) {
                  return (
                    <Tooltip key={item.label}>
                      <TooltipTrigger asChild>{cardContent}</TooltipTrigger>
                      <TooltipContent side="top" className="text-xs p-2.5">
                        <p className="font-semibold">{item.label} Intelligence</p>
                        <div className="mt-1.5 space-y-1">
                          <div className="flex justify-between gap-6">
                            <span className="text-muted-foreground">Current MTD:</span>
                            <span className="font-bold">{formatINR(item.value || 0, 0)}</span>
                          </div>
                          <div className="flex justify-between gap-6">
                            <span className="text-muted-foreground">Target Threshold:</span>
                            <span className="font-bold">{targetDisplay}</span>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return cardContent;
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Google: Campaign Split */}
      {isGoogle && searchSummary && dgSummary && (
        <Card>
          <CardContent className="card-content-premium">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-base font-semibold text-slate-950 uppercase tracking-wider">Campaign Split</h3>
              <div className="flex items-center gap-3">
                <span className="t-micro text-muted-foreground tabular-nums">
                  {(searchSummary.campaign_count || 0) + (dgSummary.campaign_count || 0)} active campaigns
                </span>
                <a href="/#/campaigns?filter=branded" className="cursor-pointer">
                  <Badge variant="secondary" className="t-micro px-2 py-0.5 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                    {searchSummary.campaign_count} Search · CPL {formatINR(searchSummary.cpl, 0)} →
                  </Badge>
                </a>
                <a href="/#/campaigns?filter=demand_gen" className="cursor-pointer">
                  <Badge variant="secondary" className="t-micro px-2 py-0.5 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
                    {dgSummary.campaign_count} DG · CPL {formatINR(dgSummary.cpl, 0)} →
                  </Badge>
                </a>
                {autoPauseCandidates.length > 0 && (
                  <Badge variant="secondary" className="t-micro px-2 py-0.5 text-red-400 bg-red-500/10">
                    {autoPauseCandidates.length} Auto-Pause
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row — Daily Spend & Leads + Funnel Split */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Funnel Split */}
        <Card className="flex flex-col h-fit">
          <CardHeader className="card-header-premium">
            <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider">{isGoogle ? "Spend Split" : "Funnel Split"}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex-1">
            <div className="space-y-3">
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
                <div className="flex h-2 overflow-hidden rounded-full bg-muted/50">
                  {funnelData.map((entry) => (
                    <div
                      key={entry.name}
                      className="h-full transition-all"
                      style={{
                        width: `${Math.max(entry.value, 0)}%`,
                        backgroundColor: activeFunnelColors[entry.name] || "hsl(215, 15%, 55%)",
                      }}
                    />
                  ))}
                </div>
                <p className="mt-2 t-micro text-muted-foreground">
                  {isGoogle ? "Share of spend by campaign type" : "Share of spend by funnel layer"}
                </p>
              </div>

              <div className="space-y-2">
                {funnelData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-3 rounded-md border border-border/30 bg-card p-3">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: activeFunnelColors[entry.name] || "hsl(215, 15%, 55%)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="t-micro uppercase tracking-wider text-muted-foreground">
                          {entry.name}
                        </p>
                        <p className="t-body font-semibold tabular-nums text-foreground">
                          {entry.value}%
                        </p>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted/50">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(entry.value, 0)}%`,
                            backgroundColor: activeFunnelColors[entry.name] || "hsl(215, 15%, 55%)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Pacing — Full Table */}
        {(() => {
          // ─── Pacing calculations (all backend-spec formulas) ─────────
          const daysElapsed = mp?.days_elapsed || 0;
          const daysRemaining = mp?.days_remaining ?? 1;
          const totalDays = daysElapsed + daysRemaining;

          // Helper: safe divide
          function div(a: number, b: number) { return b > 0 ? a / b : 0; }

          // MTD Target = (Monthly Target / totalDays) × daysElapsed
          function mtdTarget(monthlyTarget: number) {
            return totalDays > 0 ? (monthlyTarget / totalDays) * daysElapsed : 0;
          }
          // Projected = (MTD Delivered / daysElapsed) × totalDays
          function projected(delivered: number) {
            return daysElapsed > 0 ? (delivered / daysElapsed) * totalDays : 0;
          }
          // Daily Needed = max(0, Monthly Target - MTD Delivered) / Remaining Days
          function dailyNeeded(monthlyTarget: number, delivered: number) {
            return daysRemaining > 0 ? Math.max(0, monthlyTarget - delivered) / daysRemaining : 0;
          }
          // Ratio projections are computed from projected numerator / denominator.
          function projectedRatio(projectedNumerator: number, projectedDenominator: number) {
            return projectedDenominator > 0 ? div(projectedNumerator, projectedDenominator) : 0;
          }

          // Status logic — volume metrics (Leads, SVs, etc. — more is better)
          function pacingStatus(delivered: number, target: number): { label: string; status: MetricStatus } {
            if (target <= 0) return { label: "—", status: "YELLOW" };

            // Overperformance is good for volume metrics
            if (delivered >= target) return { label: "ON TRACK", status: "GREEN" };

            // Underperformance uses the Quadratic Deviation curve
            const b = (target - delivered) / target;
            const score = 100 * Math.max(0, 1 - b - 10 * b * b);

            if (score >= 75) return { label: "ON TRACK", status: "GREEN" };
            if (score >= 55) return { label: "SLIGHTLY BEHIND", status: "YELLOW" };
            if (score >= 35) return { label: "SIGNIFICANT DRIFT", status: "ORANGE" };
            return { label: "OFF TRACK", status: "RED" };
          }

          // Status logic — cost metrics (lower is better) using Quadratic Decay Formula
          function costStatus(delivered: number, target: number): { label: string; status: MetricStatus } {
            if (target <= 0 || delivered <= 0) return { label: "—", status: "YELLOW" };
            const d = Math.max(0, (delivered - target) / target);
            const score = 100 * Math.max(0, 1 - 1.5 * d - 5 * d * d);

            if (score >= 75) return { label: "ON TRACK", status: "GREEN" };
            if (score >= 55) return { label: "SLIGHTLY HIGH", status: "YELLOW" };
            if (score >= 35) return { label: "COST ALERT", status: "ORANGE" };
            return { label: "CRITICAL OVER", status: "RED" };
          }

          // Status logic — budget pacing using Absolute Quadratic Deviation Formula
          function budgetStatus(delivered: number, target: number): { label: string; status: MetricStatus } {
            if (target <= 0) return { label: "—", status: "YELLOW" };
            const b = Math.abs(delivered - target) / target;
            const score = 100 * Math.max(0, 1 - b - 10 * b * b);

            if (score >= 75) return { label: "ON TRACK", status: "GREEN" };
            if (score >= 55) return { label: "TIGHTEN SPEND", status: "YELLOW" };
            if (score >= 35) return { label: "PACING DRIFT", status: "ORANGE" };
            return { label: "OUT OF CONTROL", status: "RED" };
          }

          type RowDef = {
            label: string;
            target: React.ReactNode;
            mtdTarget: React.ReactNode;
            delivered: React.ReactNode;
            projectedNode: React.ReactNode;
            status: { label: string; status: MetricStatus; variant?: string };
            daily: React.ReactNode;
            highlight?: boolean;
          };
          const Dash = () => <span className="text-muted-foreground">—</span>;
          const mtdSpend = authMtd.spend;
          const mtdLeads = authMtd.leads;
          const mtdImpressions = authMtd.impressions;
          const mtdClicks = authMtd.clicks;
          const mtdQLeads = authMtd.qualified_leads;
          const mtdSvs = authMtd.svs;
          const mtdCpl = mtdLeads > 0 ? div(mtdSpend, mtdLeads) : 0;
          const mtdCpql = mtdQLeads > 0 ? div(mtdSpend, mtdQLeads) : 0;
          const mtdCpsv = mtdSvs > 0 ? div(mtdSpend, mtdSvs) : 0;
          const mtdCpm = mtdImpressions > 0 ? div(mtdSpend, mtdImpressions) * 1000 : 0;
          const mtdCpc = mtdClicks > 0 ? div(mtdSpend, mtdClicks) : 0;
          const mtdClosures = authMtd.closures;
          const projectedSpend = projected(mtdSpend);
          const projectedLeads = projected(mtdLeads);
          const projectedQLeads = projected(mtdQLeads);
          const projectedSvs = projected(mtdSvs);

          // ─── Targets ─────────────────────────────────────────────────
          const cplTargetVal = metaBenchmarks?.cpl ?? metaBenchmarks?.cpl_target ?? mp?.targets?.cpl ?? 0;
          const cpmTargetVal = metaBenchmarks?.cpm_max || (isGoogle ? 1200 : 450);
          const cpcTargetVal = metaBenchmarks?.cpc_max || (isGoogle ? 120 : 0);
          const cpqlTargetVal = metaBenchmarks?.cpql_target ?? 0;
          const svsTargetLow = metaBenchmarks?.svs_low ?? mp?.targets?.svs?.low ?? 0;
          const svsTargetHigh = metaBenchmarks?.svs_high ?? mp?.targets?.svs?.high ?? 0;
          const cpsvTargetLow = metaBenchmarks?.cpsv_low ?? mp?.targets?.cpsv?.low ?? 0;
          const cpsvTargetHigh = metaBenchmarks?.cpsv_high ?? mp?.targets?.cpsv?.high ?? 0;
          const qLeadTargetMonthly = metaBenchmarks?.positive_lead_target ?? 0;

          // ─── Row computations ─────────────────────────────────────────
          const budgetRow = {
            target: formatINR(budgetTargetMonthly, 0),
            mtdTarget: formatINR(mtdTarget(budgetTargetMonthly), 0),
            delivered: <span className="font-semibold">{formatINR(mtdSpend, 0)}</span>,
            projectedNode: formatINR(projectedSpend, 0),
            status: budgetStatus(mtdSpend, mtdTarget(budgetTargetMonthly)),
            daily: formatINR(dailyNeeded(budgetTargetMonthly, mtdSpend), 0),
          };
          const leadsRow = {
            target: Math.round(leadsTargetMonthly),
            mtdTarget: Math.round(mtdTarget(leadsTargetMonthly)),
            delivered: <span className="font-semibold">{Math.round(mtdLeads)}</span>,
            projectedNode: Math.round(projectedLeads),
            status: pacingStatus(mtdLeads, mtdTarget(leadsTargetMonthly)),
            daily: dailyNeeded(leadsTargetMonthly, mtdLeads).toFixed(1),
          };
          const cplRow = {
            target: formatINR(cplTargetVal, 0),
            mtdTarget: formatINR(cplTargetVal, 0),
            delivered: <span className="font-semibold">{mtdCpl > 0 ? formatINR(mtdCpl, 0) : <Dash />}</span>,
            projectedNode: projectedRatio(projectedSpend, projectedLeads) > 0 ? formatINR(projectedRatio(projectedSpend, projectedLeads), 0) : <Dash />,
            status: costStatus(mtdCpl, cplTargetVal),
            daily: <Dash />,
          };
          const qLeadsRow = {
            target: qLeadTargetMonthly > 0 ? Math.round(qLeadTargetMonthly) : <Dash />,
            mtdTarget: qLeadTargetMonthly > 0 ? Math.round(mtdTarget(qLeadTargetMonthly)) : <Dash />,
            delivered: <span className="font-semibold">{mtdQLeads > 0 ? mtdQLeads : <Dash />}</span>,
            projectedNode: projectedQLeads > 0 ? Math.round(projectedQLeads) : <Dash />,
            status: qLeadTargetMonthly > 0 ? pacingStatus(mtdQLeads, mtdTarget(qLeadTargetMonthly)) : { label: "Awaiting", status: "YELLOW" as MetricStatus, variant: "secondary" },
            daily: qLeadTargetMonthly > 0 && daysRemaining > 0 ? dailyNeeded(qLeadTargetMonthly, mtdQLeads).toFixed(1) : <Dash />,
          };
          const cpqlRow = {
            target: cpqlTargetVal > 0 ? formatINR(cpqlTargetVal, 0) : <Dash />,
            mtdTarget: cpqlTargetVal > 0 ? formatINR(cpqlTargetVal, 0) : <Dash />,
            delivered: <span className="font-semibold">{mtdCpql > 0 ? formatINR(mtdCpql, 0) : <Dash />}</span>,
            projectedNode: projectedRatio(projectedSpend, projectedQLeads) > 0 ? formatINR(projectedRatio(projectedSpend, projectedQLeads), 0) : <Dash />,
            status: cpqlTargetVal > 0 ? costStatus(mtdCpql, cpqlTargetVal) : { label: "Awaiting", status: "YELLOW" as MetricStatus, variant: "secondary" },
            daily: <Dash />,
          };
          const svsRow = {
            target: svsTargetLow > 0 ? `${svsTargetLow}–${svsTargetHigh}` : <Dash />,
            mtdTarget: svsTargetLow > 0 ? Math.round(mtdTarget(svsTargetLow)) : <Dash />,
            delivered: <span className="font-semibold">{mtdSvs > 0 ? mtdSvs : <Dash />}</span>,
            projectedNode: projectedSvs > 0 ? Math.round(projectedSvs) : <Dash />,
            status: mtdSvs > 0 ? pacingStatus(mtdSvs, mtdTarget(svsTargetLow)) : { label: "Awaiting data", status: "YELLOW" as MetricStatus, variant: "secondary" },
            daily: svsTargetLow > 0 && daysRemaining > 0 ? dailyNeeded(svsTargetLow, mtdSvs).toFixed(1) : <Dash />,
            highlight: true,
          };
          const cpsvRow = {
            target: cpsvTargetHigh > 0 ? `${formatINR(cpsvTargetLow, 0)}–${formatINR(cpsvTargetHigh, 0)}` : <Dash />,
            mtdTarget: cpsvTargetHigh > 0 ? `${formatINR(cpsvTargetLow, 0)}–${formatINR(cpsvTargetHigh, 0)}` : <Dash />,
            delivered: <span className="font-semibold">{mtdCpsv > 0 ? formatINR(mtdCpsv, 0) : <Dash />}</span>,
            projectedNode: projectedRatio(projectedSpend, projectedSvs) > 0 ? formatINR(projectedRatio(projectedSpend, projectedSvs), 0) : <Dash />,
            status: mtdCpsv > 0 ? costStatus(mtdCpsv, cpsvTargetHigh) : { label: "Awaiting data", status: "YELLOW" as MetricStatus, variant: "secondary" },
            daily: <Dash />,
          };
          const cpmRow = {
            label: "CPM",
            target: formatINR(cpmTargetVal, 0),
            mtdTarget: formatINR(cpmTargetVal, 0),
            delivered: <span className="font-semibold">{mtdCpm > 0 ? formatINR(mtdCpm, 0) : <Dash />}</span>,
            projectedNode: <Dash />,
            status: costStatus(mtdCpm, cpmTargetVal),
            daily: <Dash />,
          };
          const cpcRow = {
            label: "CPC",
            target: cpcTargetVal > 0 ? formatINR(cpcTargetVal, 1) : <Dash />,
            mtdTarget: cpcTargetVal > 0 ? formatINR(cpcTargetVal, 1) : <Dash />,
            delivered: <span className="font-semibold">{mtdCpc > 0 ? formatINR(mtdCpc, 1) : <Dash />}</span>,
            projectedNode: <Dash />,
            status: costStatus(mtdCpc, cpcTargetVal),
            daily: <Dash />,
          };
          const closuresRow = {
            label: "Closures",
            target: <Dash />,
            mtdTarget: <Dash />,
            delivered: <span className="font-semibold">{mtdClosures > 0 ? mtdClosures : <Dash />}</span>,
            projectedNode: <Dash />,
            status: mtdClosures > 0 ? { label: "TRACKING", status: "GREEN" as MetricStatus, variant: "success" } : { label: "Awaiting data", status: "YELLOW" as MetricStatus, variant: "secondary" },
            daily: <Dash />,
          };


          const rows: RowDef[] = isGoogle ? [
            { label: "Spend", ...budgetRow },
            { label: "Conversions", ...leadsRow },
            { label: "Cost/Conv.", ...cplRow },
            { ...cpcRow },
            { label: "Site Visits (SVs)", ...svsRow },
            { label: "CPSV", ...cpsvRow },
            { label: "Qualified Conversions", ...qLeadsRow },
            { label: "CPQL", ...cpqlRow },
            { ...closuresRow },
          ] : [
            { label: "Spend", ...budgetRow },
            { label: "Leads", ...leadsRow },
            { label: "CPL", ...cplRow },
            { ...cpmRow },
            { label: "Qualified Leads", ...qLeadsRow },
            { label: "CPQL", ...cpqlRow },
            { label: "SVs", ...svsRow },
            { label: "CPSV", ...cpsvRow },
            { ...closuresRow },
          ];

          const hasMtdMismatch = mtdData?.status?.tracking_issue_flag;
          const hasManualMissing = mtdData?.status?.manual_input_missing;

          return (
            <Card className="lg:col-span-2 h-full flex flex-col">
              <CardHeader className="card-header-premium">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider">
                      {isGoogle ? "Google Ads" : "Meta Ads"} Monthly Pacing — {mp?.month || new Date().toISOString().slice(0, 7)}
                    </CardTitle>

                    <p className="t-micro text-muted-foreground">
                      {daysElapsed} days elapsed · {daysRemaining} remaining · {((mp?.pct_through_month || 0)).toFixed(0)}% through month
                      {mtdData?.last_updated && (
                        <span className="ml-2 text-muted-foreground">· updated {new Date(mtdData.last_updated).toLocaleDateString()}</span>
                      )}
                    </p>
                  </div>
                  <a href="/#/mtd-deliverables" className="t-micro text-primary flex items-center gap-0.5 hover:underline">
                    Update MTD Deliverables <ArrowRight className="w-2.5 h-2.5" />
                  </a>
                </div>
                {/* Data integrity flags */}
                {hasMtdMismatch && (
                  <div className="flex items-center gap-1.5 t-micro text-red-400 mt-1 rounded bg-red-500/8 px-2 py-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Tracking issue detected — spend recorded but 0 leads. MTD data may be incomplete.
                  </div>
                )}
                {hasManualMissing && (
                  <div className="flex items-center gap-1.5 t-micro text-amber-400 mt-1 rounded bg-amber-500/8 px-2 py-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    SVs and Qualified Leads not entered yet — update MTD Deliverables for full pacing view.
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="overflow-x-auto">
                  <table className="t-table w-full">
                    <thead>
                      {/* Pivot Group Header Row */}
                      <tr className="border-b border-border/10 bg-muted/5">
                        <th className="p-0 w-8"></th>
                        <th colSpan={1} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Identity</th>
                        <th colSpan={2} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Targets</th>
                        <th colSpan={2} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Performance</th>
                        <th colSpan={1} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Health</th>
                        <th colSpan={1} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground text-center">Pace</th>
                      </tr>
                      <tr className="border-b border-border/50 bg-muted/20">
                        <th className="text-left px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground sticky left-0 bg-card border-r border-border/5">Metric</th>
                        <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Target</th>
                        <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5 cursor-help">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>MTD Target</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]">
                              (Monthly Target ÷ Total Days) × Days Elapsed
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">MTD Delivered</th>
                        <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5 cursor-help">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>Projected</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]">
                              (MTD Delivered ÷ Days Elapsed) × Total Days
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-center px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Status</th>
                        <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground cursor-help">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>Daily Needed</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]">
                              (Monthly Target − MTD Delivered) ÷ Remaining Days
                            </TooltipContent>
                          </Tooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={row.label} className={`border-b border-border/30 ${row.highlight ? "bg-primary/3" : ""} hover:bg-muted/20 transition-colors`}>
                          <td className="t-body font-medium sticky left-0 bg-card">{row.label}</td>
                          <td className="t-body tabular-nums text-muted-foreground text-right">{row.target}</td>
                          <td className="t-body tabular-nums text-foreground/80 text-right">{row.mtdTarget}</td>
                          <td className="t-body tabular-nums text-right">{row.delivered}</td>
                          <td className="t-body tabular-nums text-right">{row.projectedNode}</td>
                          <td className="text-right">
                            <Badge
                              variant={(row.status as any).variant || "outline"}
                              className={cn(
                                "t-micro border shrink-0 whitespace-nowrap self-start",
                                getMetricStatusColor(row.status.status).bg,
                                getMetricStatusColor(row.status.status).text,
                                getMetricStatusColor(row.status.status).border
                              )}
                            >
                              {row.status.label}
                            </Badge>
                          </td>
                          <td className="t-body tabular-nums text-foreground/80 text-right">{row.daily}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(mp?.alerts?.length || 0) > 0 && (
                  <div className="space-y-1 pt-2 mt-2 border-t border-border/30">
                    {(mp?.alerts || []).map((alert: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 t-micro text-amber-400">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{alert}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}
      </div>

      {/* ─── Adset/Ad Group Scoring ─────────────────────────────── */}
      {scoringSummary && (
        <Card>
          <CardContent className="card-content-premium">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <Link href="/campaigns" className="group flex items-center gap-1.5 cursor-pointer">
                <h3 className="text-base text-slate-900 text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">
                  Campaign Scoring
                </h3>
                <ArrowRight className="w-3 h-3 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </Link>
              <div className="flex items-center gap-3">
                <span className="t-micro text-muted-foreground tabular-nums">
                  {scoringSummary.total} total campaigns
                </span>

                <Badge variant="secondary" className="t-micro px-2 py-0.5 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors">
                  {scoringSummary.winners} Winners →
                </Badge>

                <Badge variant="secondary" className="t-micro px-2 py-0.5 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
                  {scoringSummary.watch} Watch →
                </Badge>
                <Badge variant="secondary" className="t-micro px-2 py-0.5 text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors">
                  {scoringSummary.underperformers} Underperformers →
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CTR Trend + Multi-Metric Chart & Monthly Pacing Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* CTR / TSR / VHR / CPM Multi-Metric Chart */}
        <Card className="h-full flex flex-col">
          <CardHeader className="card-header-premium">
            <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider">{isGoogle ? `Key Metrics (${periodLabel})` : `CTR · TSR · VHR · CPM (${periodLabel})`}</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <div className="h-56">
              {!isGoogle && multiMetricChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={multiMetricChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(260, 12%, 16%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                    <YAxis
                      yAxisId="pct"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `${(v ?? 0).toFixed(1)}%`}
                      domain={["auto", "auto"]}
                    />
                    <YAxis
                      yAxisId="rupee"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `₹${(v ?? 0).toFixed(0)}`}
                    />
                    <RechartsTooltip content={<CustomTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    <Line yAxisId="pct" type="monotone" dataKey="ctr" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 2 }} name="CTR %" />
                    <Line yAxisId="pct" type="monotone" dataKey="tsr" stroke={CHART_COLORS.amber} strokeWidth={2} dot={{ r: 2 }} name="TSR %" />
                    <Line yAxisId="pct" type="monotone" dataKey="vhr" stroke={CHART_COLORS.green} strokeWidth={2} dot={{ r: 2 }} name="VHR %" />
                    <Line yAxisId="rupee" type="monotone" dataKey="cpm" stroke={CHART_COLORS.red} strokeWidth={2} strokeDasharray="5 3" dot={false} name="CPM (₹)" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : isGoogle ? (
                // Google: CTR + CPM trend only — TSR/VHR are Meta-specific video metrics
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={multiMetricChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(260, 12%, 16%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                    <YAxis
                      yAxisId="pct"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `${(v ?? 0).toFixed(1)}%`}
                      domain={["auto", "auto"]}
                    />
                    <YAxis
                      yAxisId="rupee"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `₹${(v ?? 0).toFixed(0)}`}
                    />
                    <RechartsTooltip content={<CustomTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    <Line yAxisId="pct" type="monotone" dataKey="ctr" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.blue }} name="CTR %" />
                    <Line yAxisId="rupee" type="monotone" dataKey="cpm" stroke={CHART_COLORS.red} strokeWidth={2} strokeDasharray="5 3" dot={false} name="CPM (₹)" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full t-micro text-muted-foreground">No daily data available</div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-2 pt-2">
              {isGoogle ? (
                <>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="t-micro text-muted-foreground uppercase tracking-wider">Avg CPC</p>
                    <p className="t-body font-medium tabular-nums">{formatINR(ap.overall_cpc, 1)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="t-micro text-muted-foreground uppercase tracking-wider">Avg CPM</p>
                    <p className="t-body font-medium tabular-nums">{formatINR(ap.overall_cpm, 0)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="t-micro text-muted-foreground uppercase tracking-wider">CVR</p>
                    <p className="t-body font-medium tabular-nums">{formatPct(ap.overall_cvr || 0)}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="t-micro text-muted-foreground uppercase tracking-wider">Avg CPM</p>
                    <p className="t-body font-medium tabular-nums">{formatINR(ap.overall_cpm, 0)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="t-micro text-muted-foreground uppercase tracking-wider">Blended TSR</p>
                    <p className="t-body font-medium tabular-nums">{blendedTSR != null ? `${blendedTSR.toFixed(1)}%` : "—"}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="t-micro text-muted-foreground uppercase tracking-wider">Blended VHR</p>
                    <p className="t-body font-medium tabular-nums">{blendedVHR != null ? `${blendedVHR.toFixed(1)}%` : "—"}</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
        {/* Daily Spend + Leads — ComposedChart */}
        <Card className="lg:col-span-2 h-full flex flex-col">
          <CardHeader className="card-header-premium">
            <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider">Daily Spend & Leads</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <div className="h-56">
              {dailyChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyChartData}>
                    <defs>
                      <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.gold} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={CHART_COLORS.gold} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(260, 12%, 16%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                    <YAxis
                      yAxisId="spend"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `₹${((v ?? 0) / 1000).toFixed(0)}K`}
                    />
                    <YAxis
                      yAxisId="leads"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                    />
                    <RechartsTooltip content={<CustomTooltipContent />} />
                    <Area
                      yAxisId="spend"
                      type="monotone"
                      dataKey="spend"
                      stroke={CHART_COLORS.gold}
                      fill="url(#gradSpend)"
                      strokeWidth={2}
                      name="Spend (₹)"
                    />
                    {budgetTargetMonthly > 0 && (
                      <ReferenceLine
                        yAxisId="spend"
                        y={budgetTargetMonthly / daysInMonth}
                        stroke={CHART_COLORS.gold}
                        strokeDasharray="3 3"
                        label={{ value: "Daily Target", position: "insideBottomLeft", fill: CHART_COLORS.gold, fontSize: 8 }}
                      />
                    )}
                    <Line
                      yAxisId="leads"
                      type="monotone"
                      dataKey="leads"
                      stroke={CHART_COLORS.purple}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CHART_COLORS.purple }}
                      name="Leads"
                    />
                    {leadsTargetMonthly > 0 && (
                      <ReferenceLine
                        yAxisId="leads"
                        y={leadsTargetMonthly / daysInMonth}
                        stroke={CHART_COLORS.purple}
                        strokeDasharray="3 3"
                        label={{ value: "Target", position: "insideBottomRight", fill: CHART_COLORS.purple, fontSize: 8 }}
                      />
                    )}
                    <Line
                      yAxisId="spend"
                      type="monotone"
                      dataKey="cpl"
                      stroke={CHART_COLORS.red}
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={false}
                      name="CPL (₹)"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full t-micro text-muted-foreground">No daily data available</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Tracking Sanity Card ────────────────── */}
      {(() => {
        const monthlyAp = rawAp;
        const dailyLeads = ap.daily_leads || [];
        const latestDailyLeads = dailyLeads.length > 0 ? dailyLeads[dailyLeads.length - 1] : null;
        const prevDayLeads = dailyLeads.length > 1 ? dailyLeads[dailyLeads.length - 2] : null;

        // Monthly targets and MTD for tracking
        const targetLeads = mp?.targets?.leads || clientTargets?.leads || 0;
        const mtdLeads = mp?.mtd?.leads || monthlyAp.total_leads_30d || 0;
        const mtdLeadsTarget = targetLeads * ((mp?.pct_through_month || 0) / 100);
        const todayLeads = latestDailyLeads ?? 0;
        const daysRemaining = mp?.days_remaining || 15;
        const dailyRateNeeded = daysRemaining > 0 ? Math.max(0, ((targetLeads - mtdLeads) / daysRemaining)) : 0;

        const zeroLeadDays = (ap as any).zero_lead_days ?? dailyLeads.filter((d: number) => d === 0).length;

        const conversionSanity = isGoogle ? (data as any)?.conversion_sanity : null;
        const googleLeadsToday = conversionSanity?.leads_today ?? null;
        const ga4Match = conversionSanity?.ga4_match_status ?? null;
        const trackingAlerts = conversionSanity?.tracking_alerts || [];

        const isZeroToday = isGoogle
          ? (googleLeadsToday === 0 || googleLeadsToday === null)
          : (latestDailyLeads === 0 || latestDailyLeads === null);
        const leadsToday = isGoogle ? (googleLeadsToday ?? latestDailyLeads ?? 0) : todayLeads;
        const hasSuddenDrop = prevDayLeads !== null && prevDayLeads > 0 && leadsToday < prevDayLeads * 0.2;

        // Health status
        let healthStatus: "Healthy" | "On Track" | "Behind" | "Alert" = "Healthy";
        let trafficLight: "green" | "amber" | "red" = "green";
        if (isZeroToday || hasSuddenDrop || (isGoogle && trackingAlerts.length > 0)) {
          trafficLight = "red";
          healthStatus = "Alert";
        } else if (dailyRateNeeded > (todayLeads || 1) * 1.5 || zeroLeadDays > 1) {
          trafficLight = "amber";
          healthStatus = "Behind";
        } else if (mtdLeads >= targetLeads * ((mp?.pct_through_month || 50) / 100) * 0.85) {
          healthStatus = "On Track";
        }

        const lightColors = {
          green: { icon: ShieldCheck, bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400" },
          amber: { icon: ShieldAlert, bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400" },
          red: { icon: ShieldX, bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400" },
        };
        const light = lightColors[trafficLight];
        const LightIcon = light.icon;

        const lastVerified = lastSuccessfulFetchDate
          ? lastSuccessfulFetchDate.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
          : "Unknown";

        return (
          <Card className={light.border}>
            {isZeroToday && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg bg-red-500/15 border-b border-red-500/30">
                <ShieldX className="w-4 h-4 text-red-400 shrink-0" />
                <span className="t-micro text-red-700 dark:text-red-400 font-semibold">
                  TRACKING ALERT: Zero leads captured yesterday — verify {isGoogle ? "conversion setup / GA4 linking" : "pixel / conversion setup"}
                </span>
              </div>
            )}
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-5">
                <div className="flex items-center gap-4">
                  <div className={`flex items-center justify-center w-11 h-11 rounded-xl ${light.bg} shadow-sm`}>
                    <LightIcon className={`w-6 h-6 ${light.text}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-950 uppercase tracking-wider">Tracking Sanity</h3>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Monitors pixel/conversion stability by comparing MTD performance against expected daily velocity. Flags sudden drops or zero-lead days.
                        </TooltipContent>
                      </Tooltip>
                      <Badge variant="secondary" className={`t-micro px-2 py-0.5 ${light.text} ${light.bg} border-${light.text.split("-")[1]}-500/20`}>
                        {healthStatus}
                      </Badge>
                    </div>
                    <p className="t-micro text-muted-foreground mt-1">
                      Last verified: {lastVerified}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-6 text-center">
                  <div className="space-y-1">
                    <p className="t-micro text-muted-foreground">MTD Leads Target</p>
                    <p className="t-kpi-sm text-foreground">{Math.round(mtdLeadsTarget)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="t-micro text-muted-foreground">MTD Leads Delivered</p>
                    <p className="t-kpi-sm text-foreground">{mtdLeads}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="t-micro text-muted-foreground">Yesterday's Delivered</p>
                    <p className="t-kpi-sm text-foreground">{prevDayLeads || 0}</p>
                  </div>
                </div>
              </div>
              {isGoogle && conversionSanity && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30">
                  {ga4Match && (
                    <Badge variant="secondary" className={`t-micro px-2 py-0.5 ${ga4Match === "match" ? "text-emerald-400 bg-emerald-500/10" :
                      ga4Match === "mismatch" ? "text-amber-400 bg-amber-500/10" :
                        "text-muted-foreground"
                      }`}>
                      GA4: {ga4Match}
                    </Badge>
                  )}
                  {trackingAlerts.map((alert: string, i: number) => (
                    <span key={i} className="t-micro text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      {alert}
                    </span>
                  ))}
                </div>
              )}
              {hasSuddenDrop && !isZeroToday && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <span className="t-micro text-red-400 font-medium">
                    Sudden drop detected: {leadsToday} leads yesterday vs {prevDayLeads} the day before ({prevDayLeads && prevDayLeads > 0 ? ((1 - leadsToday / prevDayLeads) * 100).toFixed(0) : 0}% decrease)
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}


      {/* Ad Set Breakdown Table + Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Ad Set Table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
              Campaign Breakdown
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Detailed pacing and performance metrics for each campaign.
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <Link href="/campaigns" className="t-micro text-primary flex items-center gap-1" data-testid="link-view-campaigns">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="t-table w-full">
                <thead>
                  {/* Pivot Group Header Row */}
                  <tr className="border-b border-border/10 bg-muted/5">
                    <th colSpan={2} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Identity/Status</th>
                    <th colSpan={3} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Budget</th>
                    <th colSpan={3} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Performance</th>
                    <th colSpan={3} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Efficiency</th>
                    <th className="p-0"></th>
                  </tr>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="text-left px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Campaign</th>
                    <th className="text-left px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Class</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Budget</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Spend</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Utility</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Leads</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Impr</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">Clicks</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">CTR</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">CPM</th>
                    <th className="text-right px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/5">CPL</th>
                    <th className="text-center px-4 py-3 t-label font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap">Act</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {campaignAnalysis.map((c: any) => {
                    const statusColor = getStatusColor(c.status);
                    const isPaused = c.status === "PAUSED";
                    const id = c.campaign_id || c.id;
                    const name = c.campaign_name || c.name;
                    return (
                      <tr key={id} className="group hover:bg-muted/40 transition-colors">
                        <td className="p-3 py-4 max-w-[150px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block cursor-default t-micro font-medium text-foreground">{truncate(name, 35)}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs max-w-xs">{name}</p>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="p-2">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex px-1 py-0 rounded t-micro font-medium w-fit ${statusColor.bg} ${statusColor.text}`}>
                              {c.status || "ACTIVE"}
                            </span>
                            <span className={`inline-flex px-1 py-0 rounded t-micro font-medium uppercase w-fit ${getClassificationStyle(c.health_score >= 70 ? "WINNER" : c.health_score < 35 ? "UNDERPERFORMER" : "WATCH").bg} ${getClassificationStyle(c.health_score >= 70 ? "WINNER" : c.health_score < 35 ? "UNDERPERFORMER" : "WATCH").text}`}>
                              {c.health_score >= 70 ? "WINNER" : c.health_score < 35 ? "UNDERPERFORMER" : "WATCH"}
                            </span>
                          </div>
                        </td>
                        <td className="p-2 text-right tabular-nums t-micro">{formatINR(c.daily_budget || c.budget || 0, 0)}</td>
                        <td className="p-2 text-right tabular-nums t-micro">{formatINR(c.spend || 0, 0)}</td>
                        <td className="p-2 text-right tabular-nums t-micro text-muted-foreground">{c.spend_pct ? `${Math.round(c.spend_pct)}%` : "—"}</td>
                        <td className="p-2 text-right tabular-nums t-micro font-medium">{c.leads || 0}</td>
                        <td className="p-2 text-right tabular-nums t-micro text-muted-foreground">{c.impressions || 0}</td>
                        <td className="p-2 text-right tabular-nums t-micro text-muted-foreground">{c.clicks || 0}</td>
                        <td className="p-2 text-right tabular-nums t-micro">{formatPct(c.ctr || 0)}</td>
                        <td className="p-2 text-right tabular-nums t-micro">{formatINR(c.cpm || 0, 0)}</td>
                        <td className={`p-2 text-right tabular-nums t-micro font-medium ${c.cpl > 0 ? getCplColorWithBenchmarks(c.cpl, metaBenchmarks) : "text-foreground"}`}>
                          {c.cpl > 0 ? formatINR(c.cpl, 0) : "—"}
                        </td>
                        <td className="p-2 text-center">
                          {isPaused ? (
                            <ExecutionButton
                              action="ENABLE_CAMPAIGN"
                              entityId={id}
                              entityName={name}
                              entityType="campaign"
                              label=""
                              variant="ghost"
                              size="icon"
                              icon={<Play className="w-3 h-3 text-emerald-400" />}
                              confirmMessage={`Activate campaign "${name}"?`}
                              params={{ reason: "Manual activation from Dashboard" }}
                              className="h-6 w-6"
                              data-testid={`button-unpause-${id}`}
                            />
                          ) : (
                            <ExecutionButton
                              action="PAUSE_CAMPAIGN"
                              entityId={id}
                              entityName={name}
                              entityType="campaign"
                              label=""
                              variant="ghost"
                              size="icon"
                              icon={<Pause className="w-3 h-3 text-red-400" />}
                              confirmMessage={`Pause ${isGoogle ? "ad group" : "ad set"} "${name}"?`}
                              params={{ reason: "Manual pause from Dashboard" }}
                              className="h-6 w-6"
                              data-testid={`button-pause-${id}`}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Alerts & Actions */}
        <Card className="h-fit">
          <CardHeader className="card-header-premium">
            <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider">Alerts & Actions</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            {/* Fatigue Alerts */}
            {fatigueAlerts.length > 0 && (
              <div className="space-y-2">
                <h3 className="t-micro font-medium uppercase tracking-wider text-muted-foreground">
                  Fatigue Alerts
                </h3>
                {(showAllFatigueAlerts ? fatigueAlerts : fatigueAlerts.slice(0, 3)).map((alert: any, i: number) => {
                  const adId = findAdIdByName(alert.ad_name, creativeHealth);
                  return (
                    <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/30">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className={`t-micro px-1 py-0 ${alert.severity === "CRITICAL"
                              ? "text-red-400"
                              : "text-amber-400"
                              }`}
                          >
                            {alert.severity}
                          </Badge>
                          <span className="t-micro text-muted-foreground">{alert.type}</span>
                        </div>
                      </div>
                      <p className="t-micro text-foreground leading-relaxed mb-1.5">
                        {alert.message}
                      </p>
                      {adId && (
                        <UnifiedActions
                          entityId={adId}
                          entityName={alert.ad_name}
                          entityType="ad"
                          actionType="PAUSE_AD"
                          isAutoExecutable={true}
                          recommendation={`Fatigue alert: ${alert.message}`}
                          compact
                        />
                      )}
                    </div>
                  );
                })}
                {fatigueAlerts.length > 3 && (
                  <button
                    onClick={() => setShowAllFatigueAlerts(prev => !prev)}
                    className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-1.5 border border-border/30 rounded-lg bg-muted/20 hover:bg-muted/40"
                  >
                    {showAllFatigueAlerts ? "Show less" : `Show ${fatigueAlerts.length - 3} more alert${fatigueAlerts.length - 3 > 1 ? "s" : ""}`}
                  </button>
                )}
              </div>
            )}

            {/* Top Recommendations */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="t-micro font-medium uppercase tracking-wider text-muted-foreground">
                  Top Recommendations
                </h3>
                <Link href="/recommendations" className="t-micro text-primary flex items-center gap-0.5" data-testid="link-view-recs">
                  View All <ArrowRight className="w-2.5 h-2.5" />
                </Link>
              </div>
              {adRecommendations.slice(0, 3).map((rec: any, i: number) => (
                <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="t-micro font-bold tabular-nums text-primary">
                      ICE {rec.ice_score}
                    </span>
                    <span className={`t-micro px-1 py-0 rounded ${getLayerColor(rec.layer || rec.category || "unknown").bg} ${getLayerColor(rec.layer || rec.category || "unknown").text}`}>
                      {rec.layer || rec.category || ""}
                    </span>
                  </div>
                  <p className="t-micro text-foreground font-medium">
                    {truncate(rec.action || rec.description || rec.title || "", 60)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>


      {/* ─── Funnel Diagnostics (moved from Audit Panel) ────────── */}
      {(data as any).funnel_diagnostics && (
        <Card>
          <CardHeader className="card-header-premium">
            <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider">Funnel Diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries((data as any).funnel_diagnostics).map(([key, value]: [string, any]) => (
                <div key={key} className="p-2.5 rounded-md bg-muted/30 border border-border/30">
                  <p className="t-micro text-muted-foreground uppercase tracking-wider mb-1">{key.replace(/_/g, " ")}</p>
                  <p className="t-micro text-foreground leading-relaxed">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── MV2-N03: Recent Actions quick view ────────────────── */}
      <Card>
        <CardHeader className="card-header-premium">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Recent Actions
            </CardTitle>
            <Link href="/execution-log" className="t-micro text-primary flex items-center gap-0.5 hover:underline">
              View All <ArrowRight className="w-2.5 h-2.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {!recentAuditLog || recentAuditLog.length === 0 ? (
            <p className="t-micro text-muted-foreground">No recent actions</p>
          ) : (
            <div className="space-y-2">
              {recentAuditLog.map((entry) => {
                const ts = new Date(entry.timestamp);
                const timeLabel = ts.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
                const actionLabel = entry.action.replace(/_/g, " ");
                return (
                  <div key={entry.id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <span className="t-micro text-muted-foreground tabular-nums whitespace-nowrap shrink-0">{timeLabel}</span>
                    <Badge
                      variant="secondary"
                      className={`t-micro px-1.5 py-0 shrink-0 ${entry.action.includes("PAUSE") ? "text-amber-400 bg-amber-500/10" :
                        entry.action.includes("UNPAUSE") || entry.action.includes("PLAY") ? "text-emerald-400 bg-emerald-500/10" :
                          entry.action.includes("SCALE") || entry.action.includes("BUDGET") ? "text-blue-400 bg-blue-500/10" :
                            "text-muted-foreground"
                        }`}
                    >
                      {actionLabel}
                    </Badge>
                    <span className="t-micro text-foreground truncate flex-1" title={entry.entityName}>
                      {entry.entityName.length > 40 ? entry.entityName.slice(0, 40) + "…" : entry.entityName}
                    </span>
                    <span className={`t-micro font-medium shrink-0 flex items-center gap-1 ${entry.success ? "text-emerald-400" : "text-red-400"}`}>
                      {entry.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {entry.success ? "success" : "failed"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── MV2-N04: Acquisition Funnel visualization (Enhanced) ─────── */}
      {(() => {
        // Use strictly MTD data for the funnel
        const impressions: number = authMtd.impressions;
        const clicks: number = authMtd.clicks;
        const leads: number = authMtd.leads;
        const posLeads: number = authMtd.qualified_leads;
        const svsMtd: number = authMtd.svs;

        const steps = [
          {
            label: "Impressions",
            value: impressions,
            color: "from-blue-500/50 to-blue-300/50",
            sub: "Awareness",
            icon: Eye
          },
          {
            label: "Clicks",
            value: clicks,
            color: "from-indigo-500/50 to-indigo-300/50",
            sub: "Consideration",
            icon: MousePointer2
          },
          {
            label: "Leads",
            value: leads,
            color: "from-purple-500/50 to-purple-300/50",
            sub: "Intent",
            icon: UserCheck
          },
          ...(posLeads > 0 ? [{
            label: "Positive Leads",
            value: posLeads,
            color: "from-amber-500/50 to-amber-300/50",
            sub: "Quality",
            icon: Star
          }] : []),
          ...(svsMtd > 0 ? [{
            label: "SVs",
            value: svsMtd,
            color: "from-emerald-500/50 to-emerald-300/50",
            sub: "Conversion",
            icon: Home
          }] : []),

        ];

        const maxVal = steps[0]?.value || 1;

        const getConvRate = (from: number, to: number) =>
          from > 0 ? ((to / from) * 100).toFixed(2) : "0.00";

        const convRateLabels = steps.map((step, i) => {
          if (i === 0) return null;
          const prev = steps[i - 1];
          const labels: Record<number, string> = { 1: "CTR", 2: "CVR", 3: "Lead→SV", 4: "SV→Pos" };
          return { label: labels[i] || "Rate", rate: getConvRate(prev.value, step.value) };
        });

        if (impressions === 0 && leads === 0) return null;

        return (
          <Card className="overflow-hidden">
            <CardHeader className="pb-4 px-5 pt-5 border-b border-border/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider flex items-center gap-2">
                  <Filter className="w-4 h-4 text-primary" />
                  MTD Acquisition Funnel
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="space-y-0 text-center relative">
                {/* Connector line behind */}
                <div className="absolute left-[3.25rem] md:left-[5.25rem] top-8 bottom-8 w-px bg-gradient-to-b from-blue-500/20 via-purple-500/20 to-emerald-500/20 z-0 hidden sm:block" />

                {steps.map((step, i) => {
                  const widthPct = maxVal > 0 ? Math.max(15, (step.value / maxVal) * 100) : 15;
                  const conv = convRateLabels[i];
                  const Icon = step.icon;

                  return (
                    <div key={step.label} className="relative z-10 group">
                      {/* Conversion Gate Badge */}
                      {conv && (
                        <div className="flex justify-center -my-1 py-1 relative z-20">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="bg-background/80 backdrop-blur-md border border-border/60 rounded-full px-2.5 py-0.5 flex items-center gap-1.5 shadow-sm group-hover:border-primary/40 transition-colors cursor-help">
                                <TrendingDown className="w-2.5 h-2.5 text-muted-foreground" />
                                <span className="t-micro font-bold text-foreground">
                                  {conv.label}: <span className="text-primary">{conv.rate}%</span>
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs max-w-[200px]">
                              {conv.label === "CTR" ? "Click-Through Rate: Performance of creatives in driving traffic." :
                                conv.label === "CVR" ? "Conversion Rate: Effectiveness of your landing page in generating leads." :
                                  conv.label === "Lead→SV" ? "Lead-to-Site Visit: Quality of leads becoming qualified prospects." :
                                    "Progression rate between funnel stages."}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}

                      <div className="flex items-center gap-4 py-2">
                        {/* Label Layer */}
                        <div className="w-20 md:w-28 shrink-0 text-left">
                          <p className="t-label font-bold uppercase tracking-widest text-muted-foreground group-hover:text-primary/70 transition-colors">
                            {step.label}
                          </p>
                          <p className="t-micro font-medium text-muted-foreground ">
                            {step.sub}
                          </p>
                        </div>

                        {/* Bar Container */}
                        <div className="flex-1 relative">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="h-9 w-full bg-muted/10 rounded-lg overflow-hidden border border-border/5 group-hover:border-border/20 transition-all cursor-help backdrop-blur-[2px]">
                                <div
                                  className={`h-full bg-gradient-to-r ${step.color} rounded-r-md flex items-center justify-between px-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] transition-all`}
                                  style={{ width: `${widthPct}%` }}
                                >
                                  <Icon className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
                                  <span className="text-xs font-semibold text-slate-950 drop-shadow-sm tabular-nums">
                                    {step.value > 0 ? formatNumber(step.value) : "—"}
                                  </span>
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {step.label}: {formatNumber(step.value)} total {step.sub.toLowerCase()} actions
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Spend context
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-base font-bold text-primary">
                      {formatINR(ap.total_spend_30d, 0)}
                    </p>
                    <p className="text-xs text-muted-foreground uppercase">
                      {periodLabel} Window
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ─── MV2-N21: Audit completion tracking ─────────────────── */}
      {(() => {
        const generatedAt = lastSuccessfulFetchDate;
        const now = new Date();

        interface AuditCadenceDef {
          key: string;
          label: string;
          windowHours: number;
        }

        const cadenceDefs: AuditCadenceDef[] = [
          { key: "daily", label: "Daily", windowHours: 28 },
          { key: "twice_weekly", label: "Twice Weekly", windowHours: 72 },
          { key: "weekly", label: "Weekly", windowHours: 120 },
          { key: "biweekly", label: "Bi-Weekly", windowHours: 240 },
          { key: "monthly", label: "Monthly", windowHours: 744 },
        ];

        const hoursAgoData = generatedAt
          ? (now.getTime() - generatedAt.getTime()) / 3600000
          : null;

        const auditStatuses = cadenceDefs.map((def) => {
          let status: "Completed" | "Due" | "Overdue" = "Overdue";
          if (hoursAgoData !== null) {
            if (hoursAgoData <= def.windowHours * 0.5) {
              status = "Completed";
            } else if (hoursAgoData <= def.windowHours) {
              status = "Due";
            } else {
              status = "Overdue";
            }
          }
          const isCurrent = def.key === cadenceLabel;
          return { ...def, status, isCurrent };
        });

        const completedCount = auditStatuses.filter((a) => a.status === "Completed").length;
        const completionPct = Math.round((completedCount / cadenceDefs.length) * 100);
        const lastCompletedDate = generatedAt
          ? generatedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
          : "Never";

        const statusStyles: Record<string, string> = {
          Completed: "text-emerald-400 bg-emerald-500/10",
          Due: "text-amber-400 bg-amber-500/10",
          Overdue: "text-red-400 bg-red-500/10",
        };

        const StatusIcon = ({ s }: { s: "Completed" | "Due" | "Overdue" }) =>
          s === "Completed"
            ? <CalendarCheck className="w-3.5 h-3.5 text-emerald-400" />
            : s === "Due"
              ? <CalendarClock className="w-3.5 h-3.5 text-amber-400" />
              : <XCircle className="w-3.5 h-3.5 text-red-400" />;

        return (
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Audit Status
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  Audit Completion:{" "}
                  <span className={`font-semibold tabular-nums ${completionPct >= 80 ? "text-emerald-400" : completionPct >= 50 ? "text-amber-400" : "text-red-400"}`}>
                    {completionPct}%
                  </span>{" "}
                  this week
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {auditStatuses.map((a) => (
                  <div
                    key={a.key}
                    className={`flex flex-col gap-1 p-2.5 rounded-md border ${a.isCurrent ? "border-primary/30 bg-primary/5" : "border-border/30 bg-muted/20"}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-xs text-black font-medium uppercase tracking-wider ${a.isCurrent ? "text-primary" : "text-muted-foreground"}`}>
                        {a.label}{a.isCurrent ? " ●" : ""}
                      </span>
                      <StatusIcon s={a.status} />
                    </div>
                    <Badge variant="secondary" className={`text-xs px-1.5 py-0 self-start ${statusStyles[a.status]}`}>
                      {a.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground leading-tight">
                      {a.status === "Completed" ? `Last: ${lastCompletedDate}` : `Window: ${a.windowHours}h`}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
