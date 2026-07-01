import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  RefreshCw,
  Brain,
  TrendingUp,
  TrendingDown,
  Timer,
  BarChart3,
  MessageSquareQuote,
  ChevronDown,
  ChevronUp,
  Loader2,
  ClipboardCheck,
  Info,
} from "lucide-react";
import { timeAgo, formatINR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  success: boolean;
  action: string;
  entityId: string;
  entityName: string;
  entityType: string;
  previousValue?: string;
  newValue?: string;
  error?: string;
  timestamp: string;
  requestedBy: string;
  requestedByName?: string;
  reason?: string;
  platform?: string;
  strategicCall?: string;
}

interface LearningEntry {
  executionId: string;
  entityId: string;
  entityName: string;
  entityType: string;
  action: string;
  reason?: string;
  strategicCall?: string;
  executedAt: string;
  platform?: string;
  beforeMetrics: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    impressions: number;
    cpm: number;
  };
  afterMetrics?: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    impressions: number;
    cpm: number;
    measuredAt: string;
  };
  outcome?: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "PENDING";
  outcomeReason?: string;
  daysElapsed?: number;
}

interface LearningSummary {
  totalEntries: number;
  outcomes: {
    POSITIVE: number;
    NEGATIVE: number;
    NEUTRAL: number;
    PENDING: number;
  };
  byAction: Record<
    string,
    { total: number; positive: number; negative: number; neutral: number; pending: number }
  >;
  patterns: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────

const VIEW_TABS = ["Audit Log", "Learning Insights"] as const;
type ViewTab = (typeof VIEW_TABS)[number];

const PLATFORM_TABS = ["All", "Google", "Meta"] as const;
type PlatformTab = (typeof PLATFORM_TABS)[number];

function getActionLabel(action: string): { label: string; color: string } {
  if (action.startsWith("PAUSE"))
    return { label: action.replace(/_/g, " "), color: "text-red-400 bg-red-500/10" };
  if (action.startsWith("UNPAUSE") || action.startsWith("ENABLE"))
    return { label: action.replace(/_/g, " "), color: "text-emerald-400 bg-emerald-500/10" };
  if (action.includes("SCALE_BUDGET_UP"))
    return { label: "SCALE UP", color: "text-blue-400 bg-blue-500/10" };
  if (action.includes("SCALE_BUDGET_DOWN"))
    return { label: "SCALE DOWN", color: "text-amber-400 bg-amber-500/10" };
  if (action.includes("SET_BUDGET") || action.includes("SET_CAMPAIGN_BUDGET"))
    return { label: "SET BUDGET", color: "text-purple-400 bg-purple-500/10" };
  if (action === "SET_CPC_BID_UP")
    return { label: "BID UP", color: "text-blue-400 bg-blue-500/10" };
  if (action === "SET_CPC_BID_DOWN")
    return { label: "BID DOWN", color: "text-amber-400 bg-amber-500/10" };
  if (action === "ADJUST_BID")
    return { label: "ADJUST BID", color: "text-purple-400 bg-purple-500/10" };
  if (action.includes("SET_CPC_BID"))
    return { label: "SET CPC BID", color: "text-purple-400 bg-purple-500/10" };
  if (action.includes("NEGATIVE") || action.includes("negative"))
    return { label: "ADD NEGATIVE", color: "text-amber-400 bg-amber-500/10" };
  if (action === "MANUAL_COMPLETE")
    return { label: "MANUAL COMPLETE", color: "text-blue-400 bg-blue-500/10" };
  return { label: action, color: "text-muted-foreground bg-muted/50" };
}

function getRequestedByBadge(by: string): { label: string; className: string } {
  switch (by) {
    case "auto":
      return { label: "Auto", className: "bg-blue-500/10 text-blue-400 border-blue-500/30" };
    case "user":
      return { label: "User", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
    case "agent":
      return { label: "Agent", className: "bg-purple-500/10 text-purple-400 border-purple-500/30" };
    default:
      return { label: by, className: "" };
  }
}

function getOutcomeBadge(outcome?: string): { label: string; icon: typeof CheckCircle2; className: string } {
  switch (outcome) {
    case "POSITIVE":
      return { label: "Positive", icon: TrendingUp, className: "text-emerald-400 bg-emerald-500/10" };
    case "NEGATIVE":
      return { label: "Negative", icon: TrendingDown, className: "text-red-400 bg-red-500/10" };
    case "NEUTRAL":
      return { label: "Neutral", icon: BarChart3, className: "text-muted-foreground bg-muted/50" };
    default:
      return { label: "Pending", icon: Timer, className: "text-amber-400 bg-amber-500/10" };
  }
}

function inferPlatform(entry: { action?: string; entityType?: string; platform?: string }): string {
  if (entry.platform) return entry.platform.toLowerCase();
  const action = (entry.action || "").toLowerCase();
  const entityType = (entry.entityType || "").toLowerCase();
  if (action.includes("google") || action.includes("cpc") || action.includes("negative_keyword") || entityType.includes("keyword") || entityType.includes("search")) return "google";
  if (action.includes("meta") || action.includes("facebook") || entityType.includes("adset") || entityType.includes("ad_set")) return "meta";
  return "unknown";
}

// ─── Strategic Call Expandable Cell ──────────────────────────────

function StrategicCallCell({ text }: { text?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return <span className="text-muted-foreground">—</span>;

  const truncated = text.length > 60 ? text.slice(0, 60) + "…" : text;

  return (
    <div className="max-w-[200px]">
      <button
        className="text-left text-xs text-amber-400/80 hover:text-amber-300 transition-colors"
        onClick={() => setExpanded(!expanded)}
        title={expanded ? "Collapse" : "Click to expand"}
      >
        {expanded ? text : truncated}
        {text.length > 60 && (
          <span className="ml-1 inline-flex">
            {expanded ? (
              <ChevronUp className="w-3 h-3 inline" />
            ) : (
              <ChevronDown className="w-3 h-3 inline" />
            )}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────

function AuditLogTab({
  entries,
  platformFilter,
  googleCount,
  metaCount,
}: {
  entries: AuditEntry[];
  platformFilter: PlatformTab;
  googleCount: number;
  metaCount: number;
}) {
  const filtered = platformFilter === "All"
    ? entries
    : entries.filter((e) => {
        const p = inferPlatform(e);
        return platformFilter === "Google" ? p === "google" : p === "meta";
      });

  if (filtered.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-base text-muted-foreground">
            {platformFilter === "All"
              ? "No execution history yet"
              : `No ${platformFilter} execution history`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Actions executed from the dashboard will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {googleCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-xs text-blue-400/80">
            Google actions are logged to{" "}
            <span className="font-mono">google_execution_audit_log.json</span>
          </span>
          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
            {googleCount} Google action{googleCount !== 1 ? "s" : ""} · {metaCount} Meta action{metaCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    <Card>
      <CardContent className="card-content-premium p-0">
        <div className="overflow-x-auto">
          <table className="t-table w-full" data-testid="table-audit-log">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Time
                </th>
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Platform
                </th>
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Action
                </th>
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Entity
                </th>
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Strategic Call
                </th>
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Before → After
                </th>
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="text-left p-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  By
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const actionInfo = getActionLabel(entry.action);
                const platform = inferPlatform(entry);
                return (
                  <tr
                    key={entry.id}
                    className={`border-b border-border/30 hover:bg-muted/30 transition-colors ${
                      entry.success ? "" : "bg-red-500/5"
                    }`}
                    data-testid={`row-audit-${entry.id}`}
                  >
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-foreground tabular-nums">
                          {new Date(entry.timestamp).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.timestamp).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          platform === "google"
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                            : platform === "meta"
                              ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
                              : "bg-muted/50 text-muted-foreground border-border"
                        )}
                      >
                        {platform === "google" ? "Google" : platform === "meta" ? "Meta" : "—"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary" className={`text-xs ${actionInfo.color}`}>
                        {actionInfo.label}
                      </Badge>
                    </td>
                    <td className="p-3 max-w-[200px]">
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate text-foreground" title={entry.entityName}>
                          {entry.entityName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {entry.entityType} · {entry.entityId}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <StrategicCallCell text={entry.strategicCall} />
                      {entry.reason && entry.reason !== entry.strategicCall && (
                        <p className="mt-1 max-w-[220px] text-xs text-muted-foreground" title={entry.reason}>
                          Reason: {entry.reason}
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      {entry.previousValue && entry.newValue ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">{entry.previousValue}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span
                            className={entry.success ? "text-foreground font-medium" : "text-red-400"}
                          >
                            {entry.newValue}
                          </span>
                        </div>
                      ) : entry.error ? (
                        <span className="text-red-400 text-xs">{entry.error}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {entry.success ? (
                        <Badge
                          variant="secondary"
                          className="text-xs text-emerald-400 bg-emerald-500/10"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Success
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs text-red-400 bg-red-500/10">
                          <XCircle className="w-3 h-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </td>
                    <td className="p-3">
                      {(() => {
                        const rbBadge = getRequestedByBadge(entry.requestedBy);
                        return (
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className={`w-fit text-xs ${rbBadge.className}`}>
                              {rbBadge.label}
                            </Badge>
                            {entry.requestedByName && (
                              <span className="text-xs text-muted-foreground">
                                {entry.requestedByName}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}

// ─── Manually Completed Dialog ──────────────────────────────────

function ManuallyCompletedDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (note: string) => void;
  isSubmitting: boolean;
}) {
  const [note, setNote] = useState("");

  function handleSubmit() {
    if (note.trim().length < 10) return;
    onSubmit(note.trim());
    setNote("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="w-5 h-5 text-blue-400" />
            Record Manually Completed Action
          </DialogTitle>
          <DialogDescription className="t-label">
            Record a manual action you completed outside the dashboard (e.g., creative refresh, audience restructuring).
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Describe what you did manually, e.g., 'Refreshed creatives for DM_Branded campaign with new testimonial video assets'"
          className="min-h-[80px] text-base"
          data-testid="input-manual-complete-note"
        />
        <div className="text-xs text-muted-foreground">
          {note.trim().length}/10 characters minimum
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            onClick={handleSubmit}
            disabled={note.trim().length < 10 || isSubmitting}
            data-testid="button-manual-complete-submit"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
            Record Completion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Learning Insights Tab ────────────────────────────────────────

function LearningInsightsTab({ platformFilter }: { platformFilter: PlatformTab }) {
  const { activeClientId, activePlatform } = useClient();
  const { toast } = useToast();
  const [manualDialogOpen, setManualDialogOpen] = useState(false);

  const { data: entries = [], isLoading: loadingEntries } = useQuery<LearningEntry[]>({
    queryKey: ["/api/execution-learning"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/execution-learning");
      return res.json();
    },
  });

  const { data: summary, isLoading: loadingSummary } = useQuery<LearningSummary>({
    queryKey: ["/api/execution-learning/summary"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/execution-learning/summary");
      return res.json();
    },
  });

  const updateOutcomesMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/execution-learning/update-outcomes", {
        clientId: activeClientId,
        platform: activePlatform,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/execution-learning"] });
      queryClient.invalidateQueries({ queryKey: ["/api/execution-learning/summary"] });
      toast({ title: "Outcomes Updated", description: "After-metrics have been refreshed for pending entries." });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message || "Failed to update outcomes", variant: "destructive" });
    },
  });

  const manualCompleteMutation = useMutation({
    mutationFn: async (note: string) => {
      await apiRequest("POST", "/api/execution-learning/manual-complete", {
        clientId: activeClientId,
        platform: activePlatform,
        note,
        timestamp: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      setManualDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/execution-learning"] });
      queryClient.invalidateQueries({ queryKey: ["/api/execution-learning/summary"] });
      toast({ title: "Recorded", description: "Manual action has been logged." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to record action", variant: "destructive" });
    },
  });

  if (loadingEntries || loadingSummary) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-[300px] rounded-md" />
      </div>
    );
  }

  const filtered = platformFilter === "All"
    ? entries
    : entries.filter((e) => {
        const p = inferPlatform(e);
        return platformFilter === "Google" ? p === "google" : p === "meta";
      });

  const outcomes = summary?.outcomes || { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, PENDING: 0 };
  const total = summary?.totalEntries || 0;

  return (
    <div className="space-y-4">
      {/* Action buttons row */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1.5"
          onClick={() => updateOutcomesMutation.mutate()}
          disabled={updateOutcomesMutation.isPending}
          data-testid="button-update-outcomes"
        >
          {updateOutcomesMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Update Outcomes
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1.5 text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
          onClick={() => setManualDialogOpen(true)}
          data-testid="button-manually-completed"
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          Manually Completed
        </Button>
      </div>

      {/* Manually Completed Dialog */}
      <ManuallyCompletedDialog
        open={manualDialogOpen}
        onOpenChange={setManualDialogOpen}
        onSubmit={(note) => manualCompleteMutation.mutate(note)}
        isSubmitting={manualCompleteMutation.isPending}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Brain className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Total Tracked
              </span>
            </div>
            <p className="text-base font-semibold tabular-nums">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Positive
              </span>
            </div>
            <p className="text-base font-semibold text-emerald-400 tabular-nums">
              {outcomes.POSITIVE}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Negative
              </span>
            </div>
            <p className="text-base font-semibold text-red-400 tabular-nums">
              {outcomes.NEGATIVE}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Pending
              </span>
            </div>
            <p className="text-base font-semibold text-amber-400 tabular-nums">
              {outcomes.PENDING}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pattern insights */}
      {summary?.byAction && Object.keys(summary.byAction).length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Action Patterns
            </h3>
            {Object.entries(summary.byAction).map(([action, stats]) => {
              const successRate =
                stats.total - stats.pending > 0
                  ? ((stats.positive / (stats.total - stats.pending)) * 100).toFixed(0)
                  : "—";
              const actionLabel = getActionLabel(action);
              return (
                <div key={action} className="flex items-center gap-3 text-xs">
                  <Badge variant="secondary" className={`text-xs ${actionLabel.color}`}>
                    {actionLabel.label}
                  </Badge>
                  <span className="text-muted-foreground">
                    {stats.positive} positive / {stats.total} total
                    {successRate !== "—" && (
                      <span
                        className={
                          Number(successRate) >= 60
                            ? "text-emerald-400 ml-1"
                            : Number(successRate) >= 40
                              ? "text-amber-400 ml-1"
                              : "text-red-400 ml-1"
                        }
                      >
                        ({successRate}% success)
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {summary.patterns &&
              summary.patterns.length > 0 &&
              summary.patterns.map((insight, i) => (
                <p key={i} className="text-xs text-muted-foreground pl-1 pt-1">
                  {insight}
                </p>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Google Insights sub-section */}
      {(() => {
        const googleEntries = entries.filter((e) => inferPlatform(e) === "google");
        if (googleEntries.length === 0) return null;

        // Bid changes: SET_CPC_BID_UP, SET_CPC_BID_DOWN, ADJUST_BID
        const bidActions = ["SET_CPC_BID_UP", "SET_CPC_BID_DOWN", "ADJUST_BID", "SET_CPC_BID"];
        const bidEntries = googleEntries.filter((e) =>
          bidActions.some((a) => e.action.includes(a))
        );
        const bidWithAfter = bidEntries.filter((e) => e.afterMetrics);
        const bidCplImproved = bidWithAfter.filter(
          (e) => e.afterMetrics && e.beforeMetrics.cpl > 0 && e.afterMetrics.cpl < e.beforeMetrics.cpl
        );
        const bidSuccessRate =
          bidWithAfter.length > 0
            ? Math.round((bidCplImproved.length / bidWithAfter.length) * 100)
            : null;

        // Paused entities
        const pauseEntries = googleEntries.filter((e) => e.action.startsWith("PAUSE"));
        const pauseWithAfter = pauseEntries.filter((e) => e.afterMetrics);
        // "positive reallocation" = overall spend went elsewhere (leads increased or cpl improved)
        const pausePositive = pauseWithAfter.filter(
          (e) => e.outcome === "POSITIVE"
        );
        const pauseEffectiveness =
          pauseWithAfter.length > 0
            ? Math.round((pausePositive.length / pauseWithAfter.length) * 100)
            : null;

        // Budget adjustments
        const budgetEntries = googleEntries.filter(
          (e) => e.action.includes("BUDGET") || e.action.includes("SCALE_BUDGET")
        );
        const budgetWithAfter = budgetEntries.filter(
          (e) => e.afterMetrics && e.beforeMetrics.cpl > 0 && e.afterMetrics.cpl != null
        );
        const avgBudgetCplChange =
          budgetWithAfter.length > 0
            ? Math.round(
                budgetWithAfter.reduce((sum, e) => {
                  const before = e.beforeMetrics.cpl;
                  const after = e.afterMetrics!.cpl;
                  return sum + ((after - before) / before) * 100;
                }, 0) / budgetWithAfter.length
              )
            : null;

        return (
          <Card>
            <CardContent className="p-4 space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Google Insights
              </h3>
              <div className="space-y-1.5 text-xs">
                {bidSuccessRate !== null ? (
                  <p className="text-muted-foreground">
                    Bid change success rate:{" "}
                    <span
                      className={
                        bidSuccessRate >= 60
                          ? "text-emerald-400 font-medium"
                          : bidSuccessRate >= 40
                            ? "text-amber-400 font-medium"
                            : "text-red-400 font-medium"
                      }
                    >
                      {bidSuccessRate}%
                    </span>{" "}
                    of bid adjustments led to CPL improvement
                  </p>
                ) : (
                  <p className="text-muted-foreground ">
                    Bid change success rate: no measured outcomes yet
                  </p>
                )}
                {pauseEffectiveness !== null ? (
                  <p className="text-muted-foreground">
                    Pause effectiveness:{" "}
                    <span
                      className={
                        pauseEffectiveness >= 60
                          ? "text-emerald-400 font-medium"
                          : pauseEffectiveness >= 40
                            ? "text-amber-400 font-medium"
                            : "text-red-400 font-medium"
                      }
                    >
                      {pauseEffectiveness}%
                    </span>{" "}
                    of paused entities showed positive reallocation effect
                  </p>
                ) : (
                  <p className="text-muted-foreground ">
                    Pause effectiveness: no measured outcomes yet
                  </p>
                )}
                {avgBudgetCplChange !== null ? (
                  <p className="text-muted-foreground">
                    Budget adjustment impact: avg{" "}
                    <span
                      className={
                        avgBudgetCplChange < 0
                          ? "text-emerald-400 font-medium"
                          : avgBudgetCplChange > 0
                            ? "text-red-400 font-medium"
                            : "text-muted-foreground font-medium"
                      }
                    >
                      {avgBudgetCplChange > 0 ? "+" : ""}
                      {avgBudgetCplChange}%
                    </span>{" "}
                    CPL change after budget modifications
                  </p>
                ) : (
                  <p className="text-muted-foreground ">
                    Budget adjustment impact: no measured outcomes yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Learning entries as cards */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-base text-muted-foreground">
              {platformFilter === "All"
                ? "No learning data yet"
                : `No ${platformFilter} learning data`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              When actions are executed, the system tracks before/after metrics to learn what works.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const actionInfo = getActionLabel(entry.action);
            const badge = getOutcomeBadge(entry.outcome);
            const OutcomeIcon = badge.icon;
            const platform = inferPlatform(entry);
            const beforeCpl = entry.beforeMetrics?.cpl ?? 0;
            const afterCpl = entry.afterMetrics?.cpl;
            const cplChange =
              afterCpl != null && beforeCpl > 0
                ? ((afterCpl - beforeCpl) / beforeCpl) * 100
                : null;

            return (
              <Card key={entry.executionId} className="border-border/50">
                <CardContent className="p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className={`text-xs ${actionInfo.color}`}>
                        {actionInfo.label}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          platform === "google"
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                            : "bg-purple-500/10 text-purple-400 border-purple-500/30"
                        )}
                      >
                        {platform === "google" ? "Google" : "Meta"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {entry.daysElapsed != null ? `${entry.daysElapsed}d ago` : timeAgo(entry.executedAt)}
                      </span>
                    </div>
                    <Badge variant="secondary" className={`text-xs ${badge.className}`}>
                      <OutcomeIcon className="w-3 h-3 mr-1" />
                      {badge.label}
                    </Badge>
                  </div>

                  {/* Entity name */}
                  <div>
                    <p className="t-page-title">{entry.entityName}</p>
                    <p className="text-xs text-muted-foreground">{entry.entityType}</p>
                  </div>

                  {/* Strategic Call quote block */}
                  {entry.strategicCall && (
                    <div className="rounded-md p-3 border-l-2 border-amber-500/50 bg-amber-500/5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquareQuote className="w-3 h-3 text-amber-400" />
                        <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">
                          Strategic Call
                        </span>
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        "{entry.strategicCall}"
                      </p>
                    </div>
                  )}

                  {/* Before → After metrics comparison */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md p-2.5 bg-muted/30 border border-border/30">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Before
                      </span>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Spend</span>
                          <p className="font-medium tabular-nums">{formatINR(entry.beforeMetrics.spend, 0)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">CPL</span>
                          <p className="font-medium tabular-nums">{beforeCpl > 0 ? formatINR(beforeCpl, 0) : "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Leads</span>
                          <p className="font-medium tabular-nums">{entry.beforeMetrics.leads}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">CTR</span>
                          <p className="font-medium tabular-nums">{entry.beforeMetrics.ctr?.toFixed(2)}%</p>
                        </div>
                      </div>
                    </div>

                    <div className={cn(
                      "rounded-md p-2.5 border border-border/30",
                      entry.afterMetrics ? "bg-muted/30" : "bg-muted/10"
                    )}>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        After {entry.afterMetrics?.measuredAt ? `(${timeAgo(entry.afterMetrics.measuredAt)})` : ""}
                      </span>
                      {entry.afterMetrics ? (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Spend</span>
                            <p className="font-medium tabular-nums">{formatINR(entry.afterMetrics.spend, 0)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">CPL</span>
                            <p className={cn(
                              "font-medium tabular-nums",
                              cplChange != null && cplChange < 0 ? "text-emerald-400" : cplChange != null && cplChange > 0 ? "text-red-400" : ""
                            )}>
                              {afterCpl != null ? formatINR(afterCpl, 0) : "—"}
                              {cplChange != null && (
                                <span className="t-micro ml-1">
                                  ({cplChange > 0 ? "+" : ""}{cplChange.toFixed(0)}%)
                                </span>
                              )}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Leads</span>
                            <p className="font-medium tabular-nums">{entry.afterMetrics.leads}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">CTR</span>
                            <p className="font-medium tabular-nums">{entry.afterMetrics.ctr?.toFixed(2)}%</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground ">
                          Pending measurement...
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* MV2-16: Scheduling note */}
      <Card className="border-border/40">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automated 3d/7d/14d outcome tracking runs with the daily 9 AM agent. Manual refresh
              available via the &lsquo;Update Outcomes&rsquo; button above.
            </p>
          </div>
        </CardContent>
      </Card>

      {entries.filter((e) => e.afterMetrics).length === 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-400/80 leading-relaxed">
                No outcomes measured yet. Outcomes are tracked 3, 7, and 14 days after each action.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function ExecutionLogPage() {
  const { activePlatform, activeClientId } = useClient();
  const [activeView, setActiveView] = useState<ViewTab>("Audit Log");
  const [platformFilter, setPlatformFilter] = useState<PlatformTab>("All");

  // When platform filter is "All", fetch BOTH audit logs and merge
  const metaAuditQuery = useQuery<AuditEntry[]>({
    queryKey: [`/api/audit-log`, activeClientId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/audit-log?limit=100`);
      const data = await res.json();
      return (data as AuditEntry[]).map((e) => ({ ...e, platform: e.platform || "meta" }));
    },
    refetchInterval: 30000,
  });

  const googleAuditQuery = useQuery<AuditEntry[]>({
    queryKey: [`/api/google-audit-log`, activeClientId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/google-audit-log?limit=100`);
      const data = await res.json();
      return (data as AuditEntry[]).map((e) => ({ ...e, platform: e.platform || "google" }));
    },
    refetchInterval: 30000,
  });

  const isLoading = metaAuditQuery.isLoading || googleAuditQuery.isLoading;

  // Merge and sort by timestamp descending
  const mergedEntries = [
    ...(metaAuditQuery.data || []),
    ...(googleAuditQuery.data || []),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const googleAuditCount = (googleAuditQuery.data || []).length;
  const metaAuditCount = (metaAuditQuery.data || []).length;

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-[400px] rounded-md" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="t-page-title text-foreground">Execution Log</h1>
          <p className="t-label">
            {mergedEntries.length} recorded actions · auto-refreshes every 30s
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1.5"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: [`/api/audit-log`] });
            queryClient.invalidateQueries({ queryKey: [`/api/google-audit-log`] });
            queryClient.invalidateQueries({ queryKey: ["/api/execution-learning"] });
            queryClient.invalidateQueries({ queryKey: ["/api/execution-learning/summary"] });
          }}
          data-testid="button-refresh-log"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* View tabs */}
      <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-px">
        <div className="flex items-center gap-1">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors border-b-2",
                activeView === tab
                  ? "text-primary border-primary bg-primary/5"
                  : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50"
              )}
              onClick={() => setActiveView(tab)}
              data-testid={`tab-view-${tab.toLowerCase().replace(/\s/g, "-")}`}
            >
              {tab === "Learning Insights" && <Brain className="w-3 h-3 inline mr-1.5" />}
              {tab}
            </button>
          ))}
        </div>

        {/* Platform filter */}
        <div className="flex items-center gap-1">
          {PLATFORM_TABS.map((tab) => (
            <button
              key={tab}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                platformFilter === tab
                  ? tab === "Google"
                    ? "bg-blue-500/15 text-blue-400"
                    : tab === "Meta"
                      ? "bg-purple-500/15 text-purple-400"
                      : "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              onClick={() => setPlatformFilter(tab)}
              data-testid={`tab-platform-${tab.toLowerCase()}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeView === "Audit Log" ? (
        <AuditLogTab
          entries={mergedEntries}
          platformFilter={platformFilter}
          googleCount={googleAuditCount}
          metaCount={metaAuditCount}
        />
      ) : (
        <LearningInsightsTab platformFilter={platformFilter} />
      )}
    </div>
  );
}
