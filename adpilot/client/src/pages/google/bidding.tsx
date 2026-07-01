import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertTriangle,
  TrendingUp,
  Loader2,
  Zap,
  Info,
  ShieldCheck,
  Target,
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  PenLine,
  ArrowUpRight,
  BarChart3,
  MousePointerClick,
  Activity,
  SlidersHorizontal,
  Eye,
  Ban,
  History,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Check,
  Lightbulb,
  RotateCcw,
  Gauge,
  Layers,
} from "lucide-react";
import { formatINR, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BiddingAlert {
  severity: "critical" | "warning" | "info";
  message: string;
}

interface CampaignRecommendation {
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  status: string;
  current_strategy: string;
  avg_cpc: number;
  cvr: number;
  ctr: number;
  conversions_30d: number;
  conversions_14d: number;
  cost_per_conversion: number;
  search_impression_share: number | null;
  lost_is_rank: number | null;
  lost_is_budget: number | null;
  clicks: number;
  recommendation: "stay_max_clicks" | "switch_tcpa" | "hold" | "revert_max_clicks";
  confidence: "high" | "medium" | "low";
  reasons: string[];
  alerts: BiddingAlert[];
  computed_bid_limit: number;
  bid_limit_by_top_of_page: number;
  bid_limit_by_cpa: number;
  suggested_tcpa: number;
  target_cpa: number;
  cvr_variance_14d: number | null;
  tracking_stable: boolean;
  low_top_of_page_cpc: number;
}

interface BiddingMeta {
  generated_at: string;
  data_available: boolean;
  total_campaigns: number;
  alert_count: number;
  on_correct_strategy: number;
  target_cpa: number;
}

interface BiddingHistoryEntry {
  id: number;
  timestamp: string;
  campaign_id: string;
  campaign_name: string;
  action: "apply" | "reject" | "manual_apply";
  recommendation: string;
  rationale: string;
  params: Record<string, any>;
}

interface BiddingData {
  campaigns: CampaignRecommendation[];
  meta: BiddingMeta;
  history: BiddingHistoryEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRecommendationConfig(rec: string) {
  switch (rec) {
    case "switch_tcpa":
      return {
        label: "Switch to tCPA",
        shortLabel: "→ tCPA",
        color: "text-emerald-400",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/30",
        icon: <Zap className="w-3.5 h-3.5" />,
      };
    case "hold":
      return {
        label: "Hold — Do Not Switch",
        shortLabel: "Hold",
        color: "text-amber-400",
        bg: "bg-amber-500/10",
        border: "border-amber-500/30",
        icon: <Ban className="w-3.5 h-3.5" />,
      };
    case "revert_max_clicks":
      return {
        label: "Revert to Max Clicks",
        shortLabel: "← Revert",
        color: "text-red-400",
        bg: "bg-red-500/10",
        border: "border-red-500/30",
        icon: <RotateCcw className="w-3.5 h-3.5" />,
      };
    default:
      return {
        label: "Stay: Max Clicks",
        shortLabel: "Max Clicks",
        color: "text-blue-400",
        bg: "bg-blue-500/10",
        border: "border-blue-500/30",
        icon: <MousePointerClick className="w-3.5 h-3.5" />,
      };
  }
}

function getConfidenceConfig(conf: string) {
  switch (conf) {
    case "high":
      return { label: "High", cls: "bg-emerald-500/15 text-emerald-400", dot: "bg-emerald-500" };
    case "medium":
      return { label: "Medium", cls: "bg-amber-500/15 text-amber-400", dot: "bg-amber-500" };
    default:
      return { label: "Low", cls: "bg-red-500/15 text-red-400", dot: "bg-red-500" };
  }
}

function getAlertConfig(severity: string) {
  switch (severity) {
    case "critical":
      return { icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" />, cls: "text-red-400 bg-red-500/5 border-red-500/20" };
    case "warning":
      return { icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />, cls: "text-amber-400 bg-amber-500/5 border-amber-500/20" };
    default:
      return { icon: <Info className="w-3.5 h-3.5 shrink-0" />, cls: "text-blue-400 bg-blue-500/5 border-blue-500/20" };
  }
}

function formatStrategy(s: string) {
  if (!s) return "Manual CPC";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Maximize Clicks", "Max Clicks")
    .replace("Target Cpa", "tCPA");
}

// ─── A2 SOP Formula Strip ─────────────────────────────────────────────────────

function SOPFormulaStrip() {
  const rules = [
    {
      label: "Primary Formula",
      value: "Bid Limit = MIN(Low Top-of-Page CPC × 1.35, Target CPA × CVR)",
      note: "SOP 2.3 · +35% default, adjust 30–40% by risk",
      color: "text-primary",
      icon: <Gauge className="w-3.5 h-3.5 text-primary" />,
    },
    {
      label: "Default Strategy",
      value: "Max Clicks with Bid Cap",
      note: "All new campaigns start here. Never launch on tCPA.",
      color: "text-blue-400",
      icon: <MousePointerClick className="w-3.5 h-3.5 text-blue-400" />,
    },
    {
      label: "Upgrade Trigger",
      value: "Switch after ≥ 30 stable conv / 30d",
      note: "CVR variance < ±20% over 2 weeks, stable tracking",
      color: "text-emerald-400",
      icon: <Zap className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      label: "tCPA Seed",
      value: "Current CPA × 0.80",
      note: "Seed 20% below trailing CPA — conservative start",
      color: "text-purple-400",
      icon: <Target className="w-3.5 h-3.5 text-purple-400" />,
    },
    {
      label: "Guardrail",
      value: "NEVER switch if IS Lost (Budget) > 20%",
      note: "Fix budget first — tCPA cannot help budget-limited campaigns",
      color: "text-amber-400",
      icon: <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />,
    },
    {
      label: "Revert Trigger",
      value: "CPL > Target × 1.4 AND conv < 10 on tCPA",
      note: "Revert bid limit = Avg CPC × 1.2",
      color: "text-red-400",
      icon: <RotateCcw className="w-3.5 h-3.5 text-red-400" />,
    },
  ];

  return (
    <Card className="border-primary/20 bg-primary/3">
      <CardContent className="card-content-premium">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            SOP Formula Reference — Digital Mojo Bidding Rules
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {rules.map((rule) => (
            <div key={rule.label} className="space-y-1">
              <div className="flex items-center gap-1">
                {rule.icon}
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">{rule.label}</p>
              </div>
              <p className={cn("text-xs font-bold leading-snug", rule.color)}>{rule.value}</p>
              <p className="text-xs text-muted-foreground leading-tight">{rule.note}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── A3 Metric Chips ──────────────────────────────────────────────────────────

function MetricChip({
  label,
  value,
  colorClass,
  icon,
  tooltip,
  sub,
}: {
  label: string;
  value: string;
  colorClass: string;
  icon: React.ReactNode;
  tooltip?: string;
  sub?: string;
}) {
  const content = (
    <div className="flex items-center gap-1 cursor-default">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("font-bold tabular-nums text-xs", colorClass)}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );

  if (!tooltip) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ─── Action Dialog ─────────────────────────────────────────────────────────────

interface ActionDialogState {
  open: boolean;
  type: "apply" | "reject" | "manual_apply";
  campaign: CampaignRecommendation;
}

function ActionDialog({
  state,
  onClose,
  onSubmit,
  isPending,
}: {
  state: ActionDialogState;
  onClose: () => void;
  onSubmit: (rationale: string) => void;
  isPending: boolean;
}) {
  const [rationale, setRationale] = useState("");
  const rec = getRecommendationConfig(state.campaign.recommendation);

  const actionLabels = {
    apply: { title: "Auto Apply Recommendation", btn: "Apply Change", btnCls: "bg-emerald-600 hover:bg-emerald-700" },
    manual_apply: { title: "Manual Apply", btn: "Confirm Manual Apply", btnCls: "bg-blue-600 hover:bg-blue-700" },
    reject: { title: "Reject Recommendation", btn: "Reject", btnCls: "bg-red-600 hover:bg-red-700" },
  };
  const labels = actionLabels[state.type];

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.type === "reject" ? (
              <XCircle className="w-5 h-5 text-red-400" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            )}
            {labels.title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 mt-1">
              <div className={cn("p-3 rounded-lg border text-xs", rec.bg, rec.border)}>
                <p className="font-bold text-foreground mb-1 text-base">{truncate(state.campaign.campaign_name, 40)}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-muted-foreground">Current:</span>
                  <span className="font-medium">{formatStrategy(state.campaign.current_strategy)}</span>
                  {state.campaign.recommendation === "switch_tcpa" && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={cn("font-bold", rec.color)}>tCPA @ {formatINR(state.campaign.suggested_tcpa, 0)}</span>
                    </>
                  )}
                  {state.campaign.recommendation === "stay_max_clicks" && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={cn("font-bold", rec.color)}>Bid cap {formatINR(state.campaign.computed_bid_limit, 0)}</span>
                    </>
                  )}
                  {state.campaign.recommendation === "revert_max_clicks" && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={cn("font-bold", rec.color)}>Max Clicks · bid cap {formatINR(state.campaign.avg_cpc * 1.2, 0)}</span>
                    </>
                  )}
                </div>
              </div>
              {state.type !== "reject" && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {(Array.isArray(state.campaign.reasons) ? state.campaign.reasons : []).map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">·</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <PenLine className="w-3.5 h-3.5 text-primary" />
            <label className="t-page-title text-foreground">
              Strategic Rationale <span className="text-red-400">*</span>
            </label>
          </div>
          <Textarea
            placeholder="Enter your strategic reasoning for this decision (required)..."
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            className="min-h-[90px] text-base resize-none"
            data-testid="input-rationale"
          />
          <p className="text-xs text-muted-foreground">
            All bidding decisions are logged with rationale for audit and team accountability.
            {rationale.length < 10 && rationale.length > 0 && (
              <span className="text-red-400 ml-1">Min 10 characters required ({10 - rationale.length} more)</span>
            )}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            className={cn("gap-2", labels.btnCls)}
            onClick={() => onSubmit(rationale)}
            disabled={isPending || rationale.trim().length < 10}
            data-testid="button-confirm-action"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {labels.btn}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Campaign Recommendation Card ─────────────────────────────────────────────

function CampaignRecommendationCard({
  camp,
  onAction,
}: {
  camp: CampaignRecommendation;
  onAction: (type: "apply" | "reject" | "manual_apply") => void;
}) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const rec = getRecommendationConfig(camp.recommendation);
  const conf = getConfidenceConfig(camp.confidence);
  const alerts = Array.isArray(camp.alerts) ? camp.alerts : [];
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");

  // Metric chip colors
  const cpcColor =
    camp.avg_cpc > camp.computed_bid_limit * 1.1
      ? "text-red-400"
      : camp.avg_cpc > camp.computed_bid_limit
      ? "text-amber-400"
      : "text-emerald-400";

  const cvrColor =
    camp.cvr < 1 ? "text-red-400" : camp.cvr >= 4 ? "text-emerald-400" : "text-amber-400";

  const conv30Color =
    camp.conversions_30d >= 50
      ? "text-emerald-400"
      : camp.conversions_30d >= 30
      ? "text-amber-400"
      : "text-red-400";

  const isColor =
    (camp.search_impression_share ?? 0) >= 60
      ? "text-emerald-400"
      : (camp.search_impression_share ?? 0) >= 40
      ? "text-amber-400"
      : "text-red-400";

  const rankColor =
    (camp.lost_is_rank ?? 0) < 10
      ? "text-emerald-400"
      : (camp.lost_is_rank ?? 0) <= 40
      ? "text-amber-400"
      : "text-red-400";

  const budgetColor =
    (camp.lost_is_budget ?? 0) < 10
      ? "text-emerald-400"
      : (camp.lost_is_budget ?? 0) <= 20
      ? "text-amber-400"
      : "text-red-400";

  const cplColor =
    camp.cost_per_conversion <= camp.target_cpa
      ? "text-emerald-400"
      : camp.cost_per_conversion <= camp.target_cpa * 1.2
      ? "text-amber-400"
      : "text-red-400";

  const clickColor =
    camp.clicks > 200 ? "text-emerald-400" : camp.clicks >= 50 ? "text-amber-400" : "text-red-400";

  const cvrVarColor =
    camp.cvr_variance_14d == null
      ? "text-muted-foreground"
      : Math.abs(camp.cvr_variance_14d) < 10
      ? "text-emerald-400"
      : Math.abs(camp.cvr_variance_14d) <= 20
      ? "text-amber-400"
      : "text-red-400";

  const revertBidCap = camp.avg_cpc * 1.2;

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-200",
        criticalAlerts.length > 0
          ? "border-red-500/30 bg-red-500/3"
          : warningAlerts.length > 0
          ? "border-amber-500/30 bg-amber-500/3"
          : "border-border/50 bg-card/60"
      )}
    >
      {/* Main Row */}
      <div className="p-4 grid grid-cols-[1fr_auto] gap-4 items-start">
        <div className="min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-base font-semibold text-foreground">
                {truncate(camp.campaign_name, 48)}
              </span>
            </button>
            {camp.campaign_type && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {camp.campaign_type}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs px-1.5 py-0 text-muted-foreground">
              {formatStrategy(camp.current_strategy)}
            </Badge>
            {criticalAlerts.length > 0 && (
              <Badge className="text-xs px-1.5 py-0 bg-red-500/15 text-red-400 border-red-500/30">
                {criticalAlerts.length} critical
              </Badge>
            )}
          </div>

          {/* ── A3 Metric Chips ── */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
            {/* 1. CPC vs Bid Cap */}
            <MetricChip
              label="CPC"
              value={formatINR(camp.avg_cpc, 0)}
              colorClass={cpcColor}
              icon={<Activity className="w-3 h-3" />}
              sub={camp.computed_bid_limit > 0 ? `/ cap ${formatINR(camp.computed_bid_limit, 0)}` : undefined}
              tooltip={`Bid Limit = MIN(Low Top-of-Page CPC × 1.35, Target CPA × CVR)\n= MIN(${formatINR(camp.bid_limit_by_top_of_page, 0)}, ${formatINR(camp.bid_limit_by_cpa, 0)})\n= ${formatINR(camp.computed_bid_limit, 0)}`}
            />

            {/* 2. CVR */}
            <MetricChip
              label="CVR"
              value={`${camp.cvr.toFixed(1)}%`}
              colorClass={cvrColor}
              icon={<TrendingUp className="w-3 h-3" />}
              tooltip="Conversion Rate = Conversions / Clicks. Critical for Route B bid math."
            />

            {/* 3. Conversions / 30d */}
            <MetricChip
              label="Conv/30d"
              value={String(camp.conversions_30d)}
              colorClass={conv30Color}
              icon={<BarChart3 className="w-3 h-3" />}
              sub="(need ≥30)"
              tooltip="≥50 = high confidence tCPA, ≥30 = eligible, <30 = stay Max Clicks"
            />

            {/* 4. Search IS */}
            {camp.search_impression_share != null && (
              <MetricChip
                label="Search IS"
                value={`${camp.search_impression_share.toFixed(0)}%`}
                colorClass={isColor}
                icon={<Eye className="w-3 h-3" />}
                tooltip="Search Impression Share. ≥60% = good, 40–60% = moderate, <40% = serious visibility gap"
              />
            )}

            {/* 5. IS Lost Rank */}
            {camp.lost_is_rank != null && (
              <MetricChip
                label="Lost(Rank)"
                value={`${camp.lost_is_rank.toFixed(0)}%`}
                colorClass={rankColor}
                icon={<ArrowUpRight className="w-3 h-3" />}
                tooltip="IS lost due to Ad Rank (QS + bid). >40% = CRITICAL rank problem. Fix QS before raising bids."
              />
            )}

            {/* 6. IS Lost Budget */}
            {camp.lost_is_budget != null && (
              <MetricChip
                label="Lost(Budget)"
                value={`${camp.lost_is_budget.toFixed(0)}%`}
                colorClass={budgetColor}
                icon={<AlertTriangle className="w-3 h-3" />}
                tooltip=">20% = budget-limited. Blocks tCPA switch. Increase budget by 20% — do NOT raise bids."
              />
            )}

            {/* 7. Cost / Conv */}
            {camp.cost_per_conversion > 0 && (
              <MetricChip
                label="CPL"
                value={formatINR(camp.cost_per_conversion, 0)}
                colorClass={cplColor}
                sub={camp.target_cpa > 0 ? `/ target ${formatINR(camp.target_cpa, 0)}` : undefined}
                icon={<Target className="w-3 h-3" />}
                tooltip="Cost per lead vs Target CPA. >Target×1.2 triggers revert from tCPA."
              />
            )}

            {/* 8. Clicks */}
            <MetricChip
              label="Clicks"
              value={camp.clicks.toLocaleString()}
              colorClass={clickColor}
              icon={<MousePointerClick className="w-3 h-3" />}
              tooltip=">200 = high data confidence, 50–200 = moderate, <50 = low data"
            />

            {/* 9. CVR Variance 14d */}
            {camp.cvr_variance_14d != null && (
              <MetricChip
                label="CVR Var 14d"
                value={`±${Math.abs(camp.cvr_variance_14d).toFixed(0)}%`}
                colorClass={cvrVarColor}
                icon={<Gauge className="w-3 h-3" />}
                tooltip="CVR variance over 14 days. Must be <±20% for tCPA switch. ±10–20% = caution, >±20% = too volatile."
              />
            )}

            {/* 10. Tracking Stable */}
            <MetricChip
              label="Tracking"
              value={camp.tracking_stable ? "Stable" : "Unstable"}
              colorClass={camp.tracking_stable ? "text-emerald-400" : "text-red-400"}
              icon={camp.tracking_stable ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              tooltip="Conversion tracking consistency check. Must be TRUE before switching to tCPA."
            />
          </div>

          {/* ── A5 Alerts ── */}
          {alerts.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-3">
              {alerts.map((alert, i) => {
                const ac = getAlertConfig(alert.severity);
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity",
                      ac.cls
                    )}
                    onClick={() => navigate(`/campaigns?campaign_id=${camp.campaign_id}`)}
                    title="Click to view campaign"
                  >
                    {ac.icon}
                    <span>{alert.message}</span>
                    <ExternalLink className="w-3 h-3 ml-auto shrink-0 opacity-50" />
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Recommendation pill + reasons ── */}
          <div className={cn("flex items-start gap-2 p-2.5 rounded-lg border text-xs", rec.bg, rec.border)}>
            <div className={cn("flex items-center gap-1.5 font-bold shrink-0 mt-0.5", rec.color)}>
              {rec.icon}
              <span>{rec.label}</span>
            </div>
            <div className="text-muted-foreground space-y-0.5">
              {(Array.isArray(camp.reasons) ? camp.reasons : []).map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col items-end gap-3 shrink-0">
          {/* Confidence badge */}
          <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-bold", conf.cls)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", conf.dot)} />
            {conf.label} Confidence
          </div>

          {/* tCPA target */}
          {camp.recommendation === "switch_tcpa" && camp.suggested_tcpa > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Suggested tCPA</p>
              <p className="text-lg font-black text-emerald-400 tabular-nums">{formatINR(camp.suggested_tcpa, 0)}</p>
              <p className="text-xs text-muted-foreground">Current CPA × 0.80</p>
            </div>
          )}

          {/* Bid cap for Max Clicks */}
          {camp.recommendation === "stay_max_clicks" && camp.computed_bid_limit > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Bid Cap</p>
              <p className="text-lg font-black text-blue-400 tabular-nums">{formatINR(camp.computed_bid_limit, 0)}</p>
              <p className="text-xs text-muted-foreground">SOP Formula</p>
            </div>
          )}

          {/* Revert bid cap */}
          {camp.recommendation === "revert_max_clicks" && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Revert Bid Cap</p>
              <p className="text-lg font-black text-red-400 tabular-nums">{formatINR(revertBidCap, 0)}</p>
              <p className="text-xs text-muted-foreground">Avg CPC × 1.20</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-1.5 w-full">
            {camp.recommendation !== "hold" && (
              <Button
                size="sm"
                className="gap-1.5 text-xs h-8 px-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() => onAction("apply")}
                data-testid={`button-apply-${camp.campaign_id}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Auto Apply
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-8 px-3 w-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              onClick={() => onAction("manual_apply")}
              data-testid={`button-manual-${camp.campaign_id}`}
            >
              <PenLine className="w-3.5 h-3.5" />
              Manual Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs h-8 px-3 w-full text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              onClick={() => onAction("reject")}
              data-testid={`button-reject-${camp.campaign_id}`}
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </Button>
          </div>

          {/* Navigate to campaign */}
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs h-6 text-muted-foreground hover:text-primary w-full"
            onClick={() => navigate(`/campaigns?campaign_id=${camp.campaign_id}`)}
          >
            <ExternalLink className="w-3 h-3" />
            View Campaign
          </Button>
        </div>
      </div>

      {/* ── A6 Bid Formula Breakdown (expanded) ── */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/30 pt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            A6 · Bid Limit Formula Breakdown
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {[
              {
                label: "Route A · Top-of-Page",
                formula: "Low Top CPC × 1.35",
                value: formatINR(camp.bid_limit_by_top_of_page, 0),
                sub: `${formatINR(camp.low_top_of_page_cpc, 0)} × 1.35`,
                color: "text-blue-400",
                note: "Auction benchmark + 35% markup",
              },
              {
                label: "Route B · CPA Math",
                formula: "Target CPA × CVR",
                value: camp.cvr > 0 ? formatINR(camp.bid_limit_by_cpa, 0) : "N/A — no CVR",
                sub: camp.cvr > 0 ? `${formatINR(camp.target_cpa, 0)} × ${camp.cvr.toFixed(2)}%` : "Route A only",
                color: "text-purple-400",
                note: "Max affordable CPC from conversion math",
              },
              {
                label: "Final Bid Limit",
                formula: "MIN(Route A, Route B)",
                value: formatINR(camp.computed_bid_limit, 0),
                sub: "Conservative — lower value wins",
                color: camp.avg_cpc > camp.computed_bid_limit ? "text-red-400" : "text-emerald-400",
                note: "Used as bid cap for Max Clicks",
              },
              camp.recommendation === "switch_tcpa"
                ? {
                    label: "tCPA Seed",
                    formula: "Current CPA × 0.80",
                    value: formatINR(camp.suggested_tcpa, 0),
                    sub: `${formatINR(camp.cost_per_conversion, 0)} × 0.80`,
                    color: "text-emerald-400",
                    note: "20% below trailing CPA — safe algorithm start",
                  }
                : camp.recommendation === "revert_max_clicks"
                ? {
                    label: "Revert Bid Limit",
                    formula: "Avg CPC × 1.20",
                    value: formatINR(camp.avg_cpc * 1.2, 0),
                    sub: `${formatINR(camp.avg_cpc, 0)} × 1.20`,
                    color: "text-red-400",
                    note: "Used when reverting from tCPA",
                  }
                : {
                    label: "tCPA Seed",
                    formula: "Current CPA × 0.80",
                    value: camp.cost_per_conversion > 0 ? formatINR(camp.cost_per_conversion * 0.8, 0) : "—",
                    sub: "Hypothetical if switched",
                    color: "text-muted-foreground",
                    note: "Not applicable — not eligible yet",
                  },
            ].map((item) => (
              <div key={item.label} className="p-3 rounded-lg bg-muted/20 border border-border/30">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{item.label}</p>
                <p className="text-xs text-muted-foreground font-mono mb-1">{item.formula}</p>
                <p className={cn("text-base font-extrabold tabular-nums", item.color)}>{item.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>
                <p className="text-xs text-muted-foreground mt-1 ">{item.note}</p>
              </div>
            ))}
          </div>

          {/* tCPA readiness checklist */}
          {camp.recommendation === "switch_tcpa" && (
            <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <p className="text-xs font-bold text-emerald-400 mb-2">tCPA Readiness Checklist</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {[
                  { label: "Conv ≥ 30", pass: camp.conversions_30d >= 30 },
                  { label: "CVR Var < ±20%", pass: camp.cvr_variance_14d == null || Math.abs(camp.cvr_variance_14d) < 20 },
                  { label: "Tracking Stable", pass: camp.tracking_stable },
                  { label: "Budget OK (IS Lost Budget ≤20%)", pass: (camp.lost_is_budget ?? 0) <= 20 },
                ].map((check) => (
                  <div key={check.label} className="flex items-center gap-1.5">
                    {check.pass ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    )}
                    <span className={check.pass ? "text-foreground" : "text-red-400"}>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── A7 Action History Table ───────────────────────────────────────────────────

function ActionHistoryTable({ history }: { history: BiddingHistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <History className="w-8 h-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No actions recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 border-b border-border/40">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          Bidding Action History
          <span className="text-xs font-normal text-muted-foreground ml-1">· All decisions logged with rationale</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="card-content-premium p-0">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              <tr className="border-b border-border/30 bg-muted/20">
                {["Time", "Campaign", "Action", "Strategy", "Rationale", "Parameters"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground text-left"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((entry) => (
                <tr key={entry.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 tabular-nums text-muted-foreground whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="p-3 max-w-[160px]">
                    <span className="truncate block">{truncate(entry.campaign_name, 25)}</span>
                  </td>
                  <td className="p-3">
                    <Badge
                      className={cn(
                        "text-xs px-1.5",
                        entry.action === "apply"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : entry.action === "reject"
                          ? "bg-red-500/15 text-red-400"
                          : "bg-blue-500/15 text-blue-400"
                      )}
                    >
                      {entry.action.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">{getRecommendationConfig(entry.recommendation).label}</td>
                  <td className="p-3 text-muted-foreground max-w-[200px]">
                    <span className="truncate block" title={entry.rationale}>
                      {truncate(entry.rationale, 50)}
                    </span>
                  </td>
                  <td className="p-3 max-w-[180px]">
                    {entry.params && Object.keys(entry.params).length > 0 ? (
                      <div className="space-y-0.5">
                        {Object.entries(entry.params).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-1">
                            <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</span>
                            <span className="font-bold text-foreground">
                              {typeof v === "number" ? formatINR(v, 0) : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── A8 Recommended Enhancements ──────────────────────────────────────────────

const ENHANCEMENTS = [
  {
    priority: "HIGH",
    effort: "LOW",
    title: "Weekly CPC Cap Recalculation",
    description: "Auto-refresh bid limits weekly using latest CVR and IS data, with a diff view showing old vs new cap.",
  },
  {
    priority: "HIGH",
    effort: "MEDIUM",
    title: "Ad Group-Level Bid Intelligence",
    description: "Per-AG CVR, CPC cap, and IS metrics drill-down. SOP computes CVR per ad group and adjusts caps per ad group.",
  },
  {
    priority: "HIGH",
    effort: "MEDIUM",
    title: "Auction Insights Integration",
    description: "Competitor overlap trend tracking and automated alerts. If overlap + outranking grows and Top IS falls, isolate competitor shield ad group.",
  },
  {
    priority: "HIGH",
    effort: "LOW",
    title: "Brand vs Non-Brand Strategy Split",
    description: "Apply different thresholds for branded campaigns (lower CPC caps, higher IS targets) vs location/generic campaigns.",
  },
  {
    priority: "MEDIUM",
    effort: "MEDIUM",
    title: "Geo/Device/Day-Part Bid Adjustments",
    description: "+/-10-20% modifier recommendations where CVR differs materially by geo, device, or day-part.",
  },
  {
    priority: "MEDIUM",
    effort: "LOW",
    title: "Budget Pacing Alert",
    description: "When IS Lost Budget >10% on profitable segments, show budget utilization trend and recommended daily budget.",
  },
  {
    priority: "MEDIUM",
    effort: "LOW",
    title: "Historical Bid Performance Tracking",
    description: "Sparkline showing CPC, CVR, IS, and CPL trend per campaign to validate whether past bid changes improved performance.",
  },
  {
    priority: "MEDIUM",
    effort: "HIGH",
    title: "OCI (Offline Conversion Import) tCPA",
    description: "With OCI feeding Site-Visit/Booking data, support tCPA on segments closest to bookings with downstream conversion import.",
  },
];

function EnhancementsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
      >
        <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
        <span className="font-semibold">A8 · SOP Recommended Enhancements ({ENHANCEMENTS.length})</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {ENHANCEMENTS.map((e) => (
            <div key={e.title} className="p-3 rounded-lg bg-muted/20 border border-border/30">
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                <Badge
                  className={cn(
                    "text-xs px-1.5 py-0",
                    e.priority === "HIGH"
                      ? "bg-red-500/15 text-red-400"
                      : "bg-amber-500/15 text-amber-400"
                  )}
                >
                  {e.priority}
                </Badge>
                <Badge className="text-xs px-1.5 py-0 bg-muted text-muted-foreground">{e.effort} EFFORT</Badge>
              </div>
              <p className="text-xs font-semibold text-foreground mb-1">{e.title}</p>
              <p className="text-xs text-muted-foreground leading-snug">{e.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rule Engine Sheet ─────────────────────────────────────────────────────────

function RuleEngine({ open, onClose, platform }: { open: boolean; onClose: () => void; platform: string }) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader className="pb-6 border-b">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-primary" />
            <SheetTitle>Bidding Rule Engine</SheetTitle>
          </div>
          <SheetDescription>
            SOP thresholds and safety guardrails for {platform === "google" ? "Google Ads" : "Meta"}.
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-6">
          {[
            {
              title: "1. tCPA Upgrade Gate",
              items: [
                { label: "Min Conversions / 30d", value: "≥ 30 (high confidence) / ≥ 15 (medium)" },
                { label: "CVR Variance 14d", value: "< ±20% required" },
                { label: "Tracking Status", value: "Must be Stable" },
                { label: "IS Lost (Budget)", value: "Must be ≤ 20%" },
              ],
            },
            {
              title: "2. Revert Trigger",
              items: [
                { label: "CPL threshold", value: "> Target CPA × 1.4" },
                { label: "Min Conversions on tCPA", value: "< 10 to trigger revert" },
                { label: "Revert Bid Limit", value: "Avg CPC × 1.20" },
              ],
            },
            {
              title: "3. Bid Limit Formula (SOP 2.3)",
              items: [
                { label: "Route A multiplier", value: "Low Top-of-Page CPC × 1.35 (range: 1.30–1.40)" },
                { label: "Route B formula", value: "Target CPA × CVR" },
                { label: "Final", value: "MIN(Route A, Route B)" },
                { label: "tCPA Seed", value: "Current CPA × 0.80" },
              ],
            },
            {
              title: "4. Auto-Pause Logic",
              items: [
                { label: "Pause Ad Groups if CPL >", value: "2.0× Target" },
                { label: "Min Impressions before pause", value: "1,500" },
              ],
            },
          ].map((section) => (
            <div key={section.title} className="space-y-3">
              <h3 className="text-base font-bold text-foreground">{section.title}</h3>
              <div className="grid gap-2 p-4 border rounded-lg bg-muted/20">
                {section.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4">
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <span className="text-xs font-bold text-foreground text-right">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GoogleBiddingPage() {
  const { activeClientId, apiBase, activePlatform } = useClient();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [filterRec, setFilterRec] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"alerts" | "confidence" | "conversions">("alerts");
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, error, refetch } = useQuery<BiddingData>({
    queryKey: ["/api/clients", activeClientId, "google/bidding-recommendations"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `${apiBase}/bidding-recommendations`
      );
      return res.json();
    },
    enabled: !!activeClientId,
    refetchInterval: 5 * 60 * 1000,
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: {
      campaign_id: string;
      campaign_name: string;
      action: string;
      recommendation: string;
      rationale: string;
      params: Record<string, any>;
    }) => {
      const res = await apiRequest(
        "POST",
        `${apiBase}/bidding-recommendations/action`,
        payload
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({
        title: vars.action === "reject" ? "Recommendation Rejected" : "Action Recorded",
        description: `Logged with rationale. ${vars.action !== "reject" ? "Apply changes in Google Ads." : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/clients", activeClientId, "google/bidding-recommendations"] });
      setActionDialog(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleAction(campaign: CampaignRecommendation, type: "apply" | "reject" | "manual_apply") {
    setActionDialog({ open: true, type, campaign });
  }

  function handleSubmitAction(rationale: string) {
    if (!actionDialog) return;
    const { campaign, type } = actionDialog;
    actionMutation.mutate({
      campaign_id: campaign.campaign_id,
      campaign_name: campaign.campaign_name,
      action: type,
      recommendation: campaign.recommendation,
      rationale,
      params:
        campaign.recommendation === "switch_tcpa"
          ? { strategy: "TARGET_CPA", target_cpa: campaign.suggested_tcpa }
          : campaign.recommendation === "revert_max_clicks"
          ? { strategy: "MAXIMIZE_CLICKS", bid_limit: campaign.avg_cpc * 1.2 }
          : { bid_limit: campaign.computed_bid_limit },
    });
  }

  const processedCampaigns = useMemo(() => {
    if (!data?.campaigns) return [];
    let list = [...data.campaigns];

    if (filterRec !== "all") {
      list = list.filter((c) => c.recommendation === filterRec);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.campaign_name.toLowerCase().includes(q));
    }

    return list.sort((a, b) => {
      if (sortBy === "alerts") {
        const score = (c: CampaignRecommendation) =>
          (c.alerts || []).filter((x) => x.severity === "critical").length * 10 +
          (c.alerts || []).filter((x) => x.severity === "warning").length;
        return score(b) - score(a);
      }
      if (sortBy === "confidence") {
        const order: Record<string, number> = { high: 3, medium: 2, low: 1 };
        return (order[b.confidence] || 0) - (order[a.confidence] || 0);
      }
      return (b.conversions_30d || 0) - (a.conversions_30d || 0);
    });
  }, [data, filterRec, sortBy, searchQuery]);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px]">
        <Skeleton className="h-10 w-72 mb-6" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  // ── Error / no data state ──
  if (error || !data?.meta?.data_available) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">Bidding Intelligence</h1>
            <p className="text-xs text-muted-foreground">Max Clicks ↔ tCPA decision engine</p>
          </div>
        </div>
        <SOPFormulaStrip />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <AlertTriangle className="w-12 h-12 text-muted-foreground" />
            <div>
              <p className="text-base font-medium text-foreground">No Bidding Data Available</p>
              <p className="text-xs text-muted-foreground mt-1">
                Run the Google Ads agent to generate bidding analysis.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const meta = data.meta;
  const campaignList = Array.isArray(data.campaigns) ? data.campaigns : [];
  const tcpaCandidates = campaignList.filter((c) => c.recommendation === "switch_tcpa").length;
  const holdCandidates = campaignList.filter((c) => c.recommendation === "hold").length;
  const criticalAlertCount = campaignList.reduce(
    (sum, c) =>
      sum + (Array.isArray(c.alerts) ? c.alerts.filter((a) => a.severity === "critical").length : 0),
    0
  );
  const totalAlerts = meta.alert_count;

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      {/* Action Dialog */}
      {actionDialog && (
        <ActionDialog
          state={actionDialog}
          onClose={() => setActionDialog(null)}
          onSubmit={handleSubmitAction}
          isPending={actionMutation.isPending}
        />
      )}

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 shadow-sm">
            <Brain className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">Bidding Intelligence</h1>
            <p className="text-xs text-muted-foreground">
              SOP-aligned decision engine · Max Clicks ↔ tCPA · Target CPA:{" "}
              {formatINR(meta.target_cpa, 0)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-primary/20 hover:bg-primary/5"
            onClick={() => setShowRules(true)}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Rule Engine
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-1.5 text-xs", showHistory && "bg-primary/5 border-primary/30")}
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="w-3.5 h-3.5" />
            Action History
            {data.history.length > 0 && (
              <Badge className="ml-1 text-xs px-1 py-0 bg-primary/20 text-primary">
                {data.history.length}
              </Badge>
            )}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ─── A1 Overview Summary Cards ──────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Total Campaigns */}
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Total Campaigns</p>
            </div>
            <p className="text-3xl font-black tabular-nums text-foreground">{meta.total_campaigns}</p>
            <p className="text-xs text-muted-foreground mt-1">Active under analysis</p>
          </CardContent>
        </Card>

        {/* Active Alerts */}
        <Card
          className={cn(
            "border-border/50",
            criticalAlertCount > 0 ? "border-red-500/40" : totalAlerts > 0 ? "border-amber-500/30" : "border-emerald-500/30"
          )}
        >
          <CardContent className="card-content-premium">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Active Alerts</p>
            </div>
            <div className="flex items-end gap-2">
              <p
                className={cn(
                  "text-3xl font-black tabular-nums",
                  criticalAlertCount > 0 ? "text-red-400" : totalAlerts > 0 ? "text-amber-400" : "text-emerald-400"
                )}
              >
                {totalAlerts}
              </p>
              {criticalAlertCount > 0 && (
                <Badge className="mb-1 text-xs px-1.5 bg-red-500/15 text-red-400 border-red-500/30">
                  {criticalAlertCount} critical
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {criticalAlertCount > 0
                ? `${criticalAlertCount} require immediate action`
                : totalAlerts > 0
                ? "Warnings — review recommended"
                : "No active alerts"}
            </p>
          </CardContent>
        </Card>

        {/* tCPA Candidates */}
        <Card className={cn("border-border/50", tcpaCandidates > 0 && "border-emerald-500/40")}>
          <CardContent className="card-content-premium">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground">tCPA Candidates</p>
            </div>
            <p
              className={cn(
                "text-3xl font-black tabular-nums",
                tcpaCandidates > 0 ? "text-emerald-400" : "text-foreground"
              )}
            >
              {tcpaCandidates}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Ready to switch strategy</p>
          </CardContent>
        </Card>

        {/* Hold / Monitor */}
        <Card className={cn("border-border/50", holdCandidates > 0 && "border-amber-500/40")}>
          <CardContent className="card-content-premium">
            <div className="flex items-center gap-2 mb-1">
              <Ban className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Hold / Monitor</p>
            </div>
            <p
              className={cn(
                "text-3xl font-black tabular-nums",
                holdCandidates > 0 ? "text-amber-400" : "text-foreground"
              )}
            >
              {holdCandidates}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Budget / tracking issues</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── A2 SOP Formula Strip ────────────────────────────────────── */}
      <SOPFormulaStrip />

      {/* ─── A7 Action History ────────────────────────────────────────── */}
      {showHistory && <ActionHistoryTable history={data.history} />}

      {/* ─── Filters + Search ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 p-1 bg-muted/30 rounded-lg border border-border/50">
          {[
            { key: "all", label: "All" },
            { key: "switch_tcpa", label: `→ tCPA (${tcpaCandidates})` },
            { key: "stay_max_clicks", label: "Max Clicks" },
            { key: "hold", label: `Hold (${holdCandidates})` },
            { key: "revert_max_clicks", label: "Revert" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilterRec(f.key)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-md transition-all",
                filterRec === f.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 p-1 bg-muted/30 rounded-lg border border-border/50 ml-auto">
          <span className="text-xs text-muted-foreground px-2">Sort:</span>
          {[
            { key: "alerts" as const, label: "Alerts" },
            { key: "confidence" as const, label: "Confidence" },
            { key: "conversions" as const, label: "Conversions" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded-md transition-all",
                sortBy === s.key
                  ? "bg-background text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <Input
          placeholder="Search campaigns..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-48 h-9 text-xs border-border/50"
        />
      </div>

      {/* ─── A3+A4+A5+A6 Campaign Cards ──────────────────────────────── */}
      <div className="space-y-3">
        {processedCampaigns.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400/40 mb-3" />
              <p className="text-base font-medium text-foreground">No campaigns match this filter</p>
              <p className="text-xs text-muted-foreground mt-1">Try a different filter or search term.</p>
            </CardContent>
          </Card>
        ) : (
          processedCampaigns.map((camp) => (
            <CampaignRecommendationCard
              key={camp.campaign_id}
              camp={camp}
              onAction={(type) => handleAction(camp, type)}
            />
          ))
        )}
      </div>

      {/* ─── A8 Recommended Enhancements ─────────────────────────────── */}
      <div className="border-t border-border/30 pt-4">
        <EnhancementsPanel />
      </div>

      {/* ─── Footer ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pb-2">
        <span>
          Last computed:{" "}
          {new Date(meta.generated_at).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-primary" />
          SOP-enforced · Digital Mojo Bidding Rules · AI Decision Engine
        </span>
      </div>

      {/* ─── Rule Engine Sheet ─────────────────────────────────────────── */}
      <RuleEngine
        open={showRules}
        onClose={() => setShowRules(false)}
        platform={activePlatform}
      />
    </div>
  );
}
