import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Terminal,
  Send,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  Zap,
  Pause,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  ListChecks,
  StickyNote,
  Info,
  Plus,
  Trash2,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────

interface Instruction {
  id: string;
  clientId: string;
  platform: string;
  instruction: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "normal" | "low";
  createdAt: string;
  executedAt: string | null;
  result: string | null;
}

interface ManualTask {
  id: string;
  text: string;
  status: "pending" | "completed" | "rejected";
  strategicCall?: string;
  rejectionReason?: string;
  createdAt: string;
  completedAt?: string;
}

interface PresetAction {
  action: string;
  entityId: string;
  entityName: string;
  entityType: "campaign" | "adset" | "ad" | "ad_group";
  params?: Record<string, any>;
}

// ─── Quick Action Configs ─────────────────────────────────────

const BASE_QUICK_ACTIONS = [
  {
    key: "pause-losers",
    label: "Pause All Losers (Score ≤ 35)",
    description: "Auto-pause all entities with health score ≤ 35 via Meta/Google API",
    icon: Pause,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
    actionType: "auto-execute-now" as const,
    platforms: ["meta", "google"] as const,
  },
  {
    key: "scale-winners",
    label: "Scale Winners (Score ≥ 70) +20%",
    description: "Increase budget by 20% on all entities classified as WINNER",
    icon: TrendingUp,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/30",
    actionType: "SCALE_WINNERS" as const,
    platforms: ["meta", "google"] as const,
  },
  {
    key: "fix-learning-limited",
    label: "Fix Learning Limited",
    description: "Scale budget +30% on adsets stuck in LEARNING_LIMITED phase",
    icon: RefreshCw,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/30",
    actionType: "FIX_LEARNING_LIMITED" as const,
    platforms: ["meta"] as const,
  },
  {
    key: "pause-high-cpl",
    label: "Pause High-CPL Ads (> CPL Max)",
    description: "Auto-pause entities flagged for high CPL based on benchmark thresholds",
    icon: Ban,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10 border-orange-500/30",
    actionType: "PAUSE_UNDERPERFORMERS" as const,
    platforms: ["meta", "google"] as const,
  },
  {
    key: "add-top-negatives",
    label: "Add Top Negative Keywords",
    description: "Add high-spend, zero-conversion search terms as negative keywords",
    icon: Ban,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    actionType: "ADD_NEGATIVES" as const,
    platforms: ["google"] as const,
  },
  {
    key: "boost-branded-is",
    label: "Boost Branded IS",
    description: "Increase bids on branded campaigns where Impression Share < 70%",
    icon: TrendingUp,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/30",
    actionType: "BOOST_BRANDED_IS" as const,
    platforms: ["google"] as const,
  },
  {
    key: "review-low-qs",
    label: "Review Low QS Ad Groups",
    description: "Flag ad groups with Quality Score < 5 for review and optimization",
    icon: AlertTriangle,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/30",
    actionType: "REVIEW_LOW_QS" as const,
    platforms: ["google"] as const,
  },
];

// ─── In-memory storage for manual tasks ────────────────────────

const _manualTasksCache: Record<string, ManualTask[]> = {};

function getManualTasks(clientId: string): ManualTask[] {
  return _manualTasksCache[clientId] || [];
}

function saveManualTasks(clientId: string, tasks: ManualTask[]) {
  _manualTasksCache[clientId] = tasks;
}

// ─── Command Input Component ──────────────────────────────────────

interface ParsedAction {
  action: string;
  entityId: string;
  entityName: string;
  entityType: string;
  params: Record<string, any>;
  description: string;
}

function CommandInput({ clientId, platform, apiBase }: { clientId: string; platform: string; apiBase: string }) {
  const [commandText, setCommandText] = useState("");
  const [parsedActions, setParsedActions] = useState<ParsedAction[]>([]);
  const [parseMessage, setParseMessage] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const { toast } = useToast();

  async function parseCommand() {
    if (!commandText.trim()) return;
    setIsParsing(true);
    setParsedActions([]);
    setParseMessage("");
    try {
      const res = await apiRequest("POST", "/api/parse-command", {
        command: commandText.trim(),
        clientId,
        platform,
      });
      const result = await res.json();
      setParsedActions(result.parsed || []);
      setParseMessage(result.message || "");
    } catch (err: any) {
      setParseMessage(err.message || "Failed to parse command");
    }
    setIsParsing(false);
  }

  async function executeActions() {
    if (parsedActions.length === 0) return;
    setIsExecuting(true);
    try {
      const actions = parsedActions.map((a) => ({
        action: a.action,
        entityId: a.entityId,
        entityName: a.entityName,
        entityType: a.entityType,
        params: a.params,
      }));

      // Execute one by one for proper tracking
      let succeeded = 0;
      for (const action of actions) {
        try {
          await apiRequest("POST", `${apiBase}/execute-action`, {
            ...action,
            strategicCall: `Command: ${commandText}`,
          });
          succeeded++;
        } catch { /* continue */ }
      }

      toast({
        title: succeeded === actions.length ? "All Actions Executed" : "Partial Execution",
        description: `${succeeded}/${actions.length} actions completed successfully`,
        variant: succeeded === actions.length ? "default" : "destructive",
      });

      // Clear state
      setParsedActions([]);
      setCommandText("");
      setParseMessage("");

      // Refresh data
      queryClient.invalidateQueries({ queryKey: [apiBase, "analysis"] });
    } catch (err: any) {
      toast({ title: "Execution Failed", description: err.message, variant: "destructive" });
    }
    setIsExecuting(false);
  }

  return (
    <Card className="border-primary/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Terminal className="w-4 h-4 text-primary" />
          <h3 className="px-4 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground">Execute Command</h3>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder='Type a command... e.g., "pause campaign Amara TOFU" or "scale all winners 20%"'
            className="flex-1 text-base bg-muted/30"
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") parseCommand(); }}
          />
          <Button size="sm" onClick={parseCommand} disabled={isParsing || !commandText.trim()} className="gap-1">
            {isParsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Parse
          </Button>
        </div>
        {parseMessage && parsedActions.length === 0 && (
          <p className="text-xs text-muted-foreground">{parseMessage}</p>
        )}
        {parsedActions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{parsedActions.length} action(s) parsed:</p>
            {parsedActions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/30">
                <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-xs text-foreground flex-1">{a.description}</span>
                <Badge variant="secondary" className="t-micro">{a.action}</Badge>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={executeActions} disabled={isExecuting} className="gap-1">
                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Execute All ({parsedActions.length})
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setParsedActions([]); setParseMessage(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page Component ───────────────────────────────────────────────

export default function CommandCenterPage() {
  const { activeClientId, activePlatform, analysisData: data, apiBase } = useClient();
  const { toast } = useToast();

  // Quick Actions state
  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<typeof BASE_QUICK_ACTIONS[0] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [strategicCallText, setStrategicCallText] = useState("");
  const [batchResults, setBatchResults] = useState<{ label: string; succeeded: number; total: number } | null>(null);

  // Manual Task Tracker state
  const [manualTasks, setManualTasks] = useState<ManualTask[]>(() => getManualTasks(activeClientId));
  const [newTaskText, setNewTaskText] = useState("");
  const [completeDialogTask, setCompleteDialogTask] = useState<ManualTask | null>(null);
  const [rejectDialogTask, setRejectDialogTask] = useState<ManualTask | null>(null);
  const [taskStrategicCall, setTaskStrategicCall] = useState("");
  const [taskRejectionReason, setTaskRejectionReason] = useState("");
  const [taskFilterTab, setTaskFilterTab] = useState<"pending" | "completed" | "rejected">("pending");

  // Agent Instructions state
  const [noteText, setNoteText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    setManualTasks(getManualTasks(activeClientId));
  }, [activeClientId]);

  // Count entities that will be affected
  const isGoogle = activePlatform === "google";
  const entitySource = isGoogle
    ? (data as any)?.ad_group_analysis
    : data?.adset_analysis;

  function countAffected(actionKey: string): number {
    if (!entitySource) return 0;
    switch (actionKey) {
      case "pause-losers":
        return entitySource.filter((a: any) => a.should_pause || (a.health_score != null && a.health_score <= 35)).length;
      case "scale-winners":
        return entitySource.filter((a: any) => a.classification === "WINNER").length;
      case "fix-learning-limited":
        return entitySource.filter((a: any) =>
          isGoogle ? a.status === "LIMITED" : a.learning_status === "LEARNING_LIMITED"
        ).length;
      case "pause-high-cpl":
        return entitySource.filter((a: any) =>
          a.should_pause === true || a.classification === "UNDERPERFORMER"
        ).length;
      case "add-top-negatives":
        return ((data as any)?.search_terms || []).filter((t: any) => t.conversions === 0 && (t.cost || 0) > 0).length;
      case "boost-branded-is":
        return ((data as any)?.campaigns || []).filter((c: any) => c.campaign_type === "branded" && (c.search_impression_share || 0) < 70).length;
      case "review-low-qs":
        return ((data as any)?.quality_score_analysis?.keywords || []).filter((k: any) => k.quality_score < 5).length;
      default:
        return 0;
    }
  }

  // Fetch instructions for agent notes
  const { data: instructions = [], isLoading: isLoadingInstructions } = useQuery<Instruction[]>({
    queryKey: ["/api/clients", activeClientId, "instructions"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/instructions`);
      return res.json();
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: async (mutationData: { instruction: string; platform: string; priority: string }) => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/instructions`, mutationData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, "instructions"] });
      setNoteText("");
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/clients/${activeClientId}/instructions/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, "instructions"] });
    },
  });

  // ─── Quick Action Execution ─────────────────────────

  async function executeQuickAction(action: typeof BASE_QUICK_ACTIONS[0]) {
    if (!strategicCallText.trim()) {
      toast({ title: "Strategic call required", description: "Please explain why you're taking this action.", variant: "destructive" });
      return;
    }

    setConfirmOpen(false);
    setQuickActionLoading(action.key);

    try {
      let endpoint: string;
      let body: any;

      if (action.actionType === "auto-execute-now") {
        endpoint = `${apiBase}/auto-execute-now`;
        body = { strategicCall: strategicCallText };
      } else {
        endpoint = `${apiBase}/quick-action`;
        body = {
          actionType: action.actionType,
          scalePercent: action.actionType === "SCALE_WINNERS" ? 20 : undefined,
          strategicCall: strategicCallText,
        };
      }

      const res = await apiRequest("POST", endpoint, body);
      const result = await res.json();
      const succeeded = result.results?.filter((r: any) => r.success).length ?? 0;
      const total = result.results?.length ?? 0;

      setBatchResults({ label: action.label, succeeded, total });
      toast({
        title: succeeded === total && total > 0 ? "Quick Action Complete" : total === 0 ? "No Entities Found" : "Partial Success",
        description: total === 0
          ? `${action.label}: No matching entities found`
          : `${action.label}: ${succeeded}/${total} actions succeeded`,
        variant: succeeded === total ? "default" : "destructive",
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [apiBase, "analysis"] });
    } catch (err: any) {
      toast({
        title: "Execution Failed",
        description: err.message || "Quick action failed",
        variant: "destructive",
      });
    }

    setQuickActionLoading(null);
    setStrategicCallText("");
    setConfirmAction(null);
  }

  // ─── Manual Task Handlers ─────────────────────────

  function addManualTask() {
    if (!newTaskText.trim()) return;
    const task: ManualTask = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      text: newTaskText.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const updated = [task, ...manualTasks];
    setManualTasks(updated);
    saveManualTasks(activeClientId, updated);
    setNewTaskText("");
  }

  function completeTask(task: ManualTask) {
    if (!taskStrategicCall.trim()) return;
    const updated = manualTasks.map(t =>
      t.id === task.id
        ? { ...t, status: "completed" as const, strategicCall: taskStrategicCall, completedAt: new Date().toISOString() }
        : t
    );
    setManualTasks(updated);
    saveManualTasks(activeClientId, updated);
    setCompleteDialogTask(null);
    setTaskStrategicCall("");
    toast({ title: "Task Completed", description: `"${task.text}" marked as done` });
  }

  function rejectTask(task: ManualTask) {
    if (!taskRejectionReason.trim()) return;
    const updated = manualTasks.map(t =>
      t.id === task.id
        ? { ...t, status: "rejected" as const, rejectionReason: taskRejectionReason, strategicCall: taskStrategicCall, completedAt: new Date().toISOString() }
        : t
    );
    setManualTasks(updated);
    saveManualTasks(activeClientId, updated);
    setRejectDialogTask(null);
    setTaskRejectionReason("");
    setTaskStrategicCall("");
    toast({ title: "Task Rejected", description: `"${task.text}" rejected` });
  }

  function deleteTask(taskId: string) {
    const updated = manualTasks.filter(t => t.id !== taskId);
    setManualTasks(updated);
    saveManualTasks(activeClientId, updated);
  }

  const filteredTasks = manualTasks.filter(t => t.status === taskFilterTab);
  const pendingCount = manualTasks.filter(t => t.status === "pending").length;
  const completedCount = manualTasks.filter(t => t.status === "completed").length;
  const rejectedCount = manualTasks.filter(t => t.status === "rejected").length;

  const activeNotes = instructions.filter(i => i.status === "pending" || i.status === "in_progress");
  const completedNotes = instructions.filter(i => i.status === "completed" || i.status === "cancelled");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Quick Action Confirm Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { setConfirmOpen(open); if (!open) { setStrategicCallText(""); setConfirmAction(null); } }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Execute: {confirmAction?.label}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-base text-muted-foreground">{confirmAction?.description}</p>
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/30">
                  <Badge variant="secondary" className="t-label">
                    {countAffected(confirmAction?.key || "")} {isGoogle ? "ad groups" : "adsets"} will be affected
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Strategic Call (required)</label>
                  <Textarea
                    placeholder="Why are you taking this action? e.g., 'CPL has been consistently above target for 5 days'"
                    className="min-h-[80px] resize-none bg-muted/30 text-base"
                    value={strategicCallText}
                    onChange={(e) => setStrategicCallText(e.target.value)}
                  />
                </div>
                <p className="text-xs text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  This will make live changes to your {isGoogle ? "Google Ads" : "Meta Ads"} account.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && executeQuickAction(confirmAction)}
              disabled={!strategicCallText.trim()}
            >
              Execute Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Complete Task Dialog */}
      <AlertDialog open={!!completeDialogTask} onOpenChange={(open) => { if (!open) { setCompleteDialogTask(null); setTaskStrategicCall(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Task Complete</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-base text-muted-foreground">"{completeDialogTask?.text}"</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Strategic Call (required)</label>
                  <Textarea
                    placeholder="What did you do and why?"
                    className="min-h-[60px] resize-none bg-muted/30 text-base"
                    value={taskStrategicCall}
                    onChange={(e) => setTaskStrategicCall(e.target.value)}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => completeDialogTask && completeTask(completeDialogTask)}
              disabled={!taskStrategicCall.trim()}
            >
              Mark Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Task Dialog */}
      <AlertDialog open={!!rejectDialogTask} onOpenChange={(open) => { if (!open) { setRejectDialogTask(null); setTaskRejectionReason(""); setTaskStrategicCall(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Task</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-base text-muted-foreground">"{rejectDialogTask?.text}"</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Why are you rejecting this?</label>
                  <Textarea
                    placeholder="Reason for rejection..."
                    className="min-h-[60px] resize-none bg-muted/30 text-base"
                    value={taskRejectionReason}
                    onChange={(e) => setTaskRejectionReason(e.target.value)}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rejectDialogTask && rejectTask(rejectDialogTask)}
              disabled={!taskRejectionReason.trim()}
              className="bg-red-600 hover:bg-red-700"
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15">
          <Terminal className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="t-page-title text-foreground">Command Center</h1>
          <p className="text-xs text-muted-foreground">
            Quick actions, manual task tracking, and agent notes
          </p>
        </div>
      </div>

      {/* Batch results banner */}
      {batchResults && (
        <Card className={batchResults.succeeded === batchResults.total && batchResults.total > 0
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"
        }>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {batchResults.succeeded === batchResults.total && batchResults.total > 0 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-xs text-foreground">
                {batchResults.label}: {batchResults.total === 0
                  ? "No matching entities found"
                  : `${batchResults.succeeded}/${batchResults.total} actions succeeded`
                }
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setBatchResults(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══ SECTION 0: Natural Language Command Input ═══ */}
      <CommandInput clientId={activeClientId} platform={activePlatform} apiBase={apiBase} />

      {/* ═══ SECTION 1: Quick Actions (These EXECUTE immediately) ═══ */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" />
          Quick Actions — These Execute Immediately
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          These buttons call the Meta/Google API directly. Changes are applied to your live ad account.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BASE_QUICK_ACTIONS.filter(a => (a.platforms as readonly string[]).includes(isGoogle ? "google" : "meta")).map((action) => {
            const affected = countAffected(action.key);
            const isLoading = quickActionLoading === action.key;
            return (
              <button
                key={action.key}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left group",
                  action.bgColor
                )}
                onClick={() => {
                  setConfirmAction(action);
                  setConfirmOpen(true);
                }}
                disabled={isLoading || !!quickActionLoading || affected === 0}
                data-testid={`button-quick-${action.key}`}
              >
                {isLoading ? (
                  <Loader2 className={cn("w-4 h-4 shrink-0 animate-spin", action.color)} />
                ) : (
                  <action.icon className={cn("w-4 h-4 shrink-0", action.color)} />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-foreground font-medium block">
                    ⚡ {action.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {affected > 0 ? `${affected} ${isGoogle ? "ad groups" : "adsets"} will be affected` : "No matching entities found"}
                  </span>
                </div>
                {affected > 0 && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {affected}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ SECTION 2: Manual Task Tracker ═══ */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5" />
          Manual Task Tracker
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Your manual action items — track what you need to do outside the dashboard. This is NOT an AI execution engine.
        </p>

        {/* Add task input */}
        <Card className="border-border/50 mb-3">
          <CardContent className="p-3">
            <div className="flex gap-2">
              <Input
                placeholder='Add a task... e.g., "Refresh creatives for TOFU campaign"'
                className="flex-1 text-base bg-muted/30"
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addManualTask(); }}
              />
              <Button
                size="sm"
                onClick={addManualTask}
                disabled={!newTaskText.trim()}
                className="gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Task filter tabs */}
        <div className="flex items-center gap-1 mb-3">
          {([
            { key: "pending" as const, label: "Pending", count: pendingCount },
            { key: "completed" as const, label: "Completed", count: completedCount },
            { key: "rejected" as const, label: "Rejected", count: rejectedCount },
          ]).map((tab) => (
            <button
              key={tab.key}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md transition-colors border",
                taskFilterTab === tab.key
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "text-muted-foreground border-border/50 hover:bg-muted/50"
              )}
              onClick={() => setTaskFilterTab(tab.key)}
            >
              {tab.label}
              {tab.count > 0 && (
                <Badge variant="secondary" className="text-xs ml-1.5 px-1 py-0">
                  {tab.count}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Task list */}
        {filteredTasks.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="p-6 text-center">
              <ListChecks className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">
                No {taskFilterTab} tasks
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredTasks.map((task) => (
              <Card key={task.id} className={cn(
                "border-border/50",
                task.status === "completed" && "border-emerald-500/20 bg-emerald-500/5",
                task.status === "rejected" && "border-red-500/20 bg-red-500/5 opacity-75",
              )}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className={cn(
                        "text-base leading-relaxed",
                        task.status === "completed" && "text-foreground/70 line-through",
                        task.status === "rejected" && "text-foreground/50 line-through",
                      )}>
                        {task.text}
                      </p>
                      {task.strategicCall && (
                        <div className="text-xs text-muted-foreground bg-muted/30 rounded p-1.5">
                          Strategic call: {task.strategicCall}
                        </div>
                      )}
                      {task.rejectionReason && (
                        <div className="text-xs text-red-400 bg-red-500/10 rounded p-1.5">
                          Rejection: {task.rejectionReason}
                        </div>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(task.createdAt)}
                        {task.completedAt && ` · ${task.status === "completed" ? "completed" : "rejected"} ${timeAgo(task.completedAt)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {task.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                            onClick={() => { setCompleteDialogTask(task); setTaskStrategicCall(""); }}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                            onClick={() => { setRejectDialogTask(task); setTaskRejectionReason(""); setTaskStrategicCall(""); }}
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Reject
                          </Button>
                        </>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400"
                        onClick={() => deleteTask(task.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ═══ SECTION 3: Agent Instructions Queue ═══ */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
          <StickyNote className="w-3.5 h-3.5" />
          Agent Instructions Queue
        </h2>

        <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-blue-500/5 border border-blue-500/20">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <p className="t-label font-bold text-blue-400">
            These instructions are stored for reference during scheduled audits. They do NOT auto-execute.
            The agent will review them during the next 9 AM daily run.
          </p>
        </div>

        {/* Add note input */}
        <Card className="border-border/50 mb-3">
          <CardContent className="p-3 space-y-2">
            <Textarea
              placeholder="Add a note for the agent... e.g., Prioritize TOFU campaigns next week or Do not pause Campaign X"
              className="min-h-[70px] resize-none bg-muted/30 border-border/50 text-base placeholder:text-muted-foreground"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  if (noteText.trim()) {
                    createNoteMutation.mutate({
                      instruction: noteText,
                      platform: activePlatform,
                      priority: "normal",
                    });
                  }
                }
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Press Ctrl+Enter to send
              </p>
              <Button
                size="sm"
                onClick={() => {
                  if (noteText.trim()) {
                    createNoteMutation.mutate({
                      instruction: noteText,
                      platform: activePlatform,
                      priority: "normal",
                    });
                  }
                }}
                disabled={!noteText.trim() || createNoteMutation.isPending}
                className="gap-1"
              >
                {createNoteMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Add Note
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Active notes */}
        {isLoadingInstructions ? (
          <Card className="border-border/50">
            <CardContent className="p-8 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : activeNotes.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="p-6 text-center">
              <StickyNote className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">No active notes for the agent</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {activeNotes.map((item) => (
              <Card key={item.id} className="border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-base text-foreground leading-relaxed">{item.instruction}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          Pending Review
                        </Badge>
                        <span className="text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-400"
                      onClick={() => deleteNoteMutation.mutate(item.id)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Completed notes (collapsible) */}
        {completedNotes.length > 0 && (
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="mt-3">
            <CollapsibleTrigger asChild>
              <button
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors w-full"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                History
                <Badge variant="secondary" className="text-xs ml-1">
                  {completedNotes.length}
                </Badge>
                <ChevronDown className={cn("w-3.5 h-3.5 ml-auto transition-transform", historyOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {completedNotes.map((item) => (
                <Card key={item.id} className="border-border/50 opacity-60">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-base text-foreground/70 leading-relaxed">{item.instruction}</p>
                        {item.result && (
                          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2 mt-1">
                            {item.result}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn(
                            "text-xs",
                            item.status === "completed"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : "bg-gray-500/10 text-gray-400 border-gray-500/30"
                          )}>
                            {item.status === "completed" ? "Reviewed" : "Cancelled"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {item.executedAt ? timeAgo(item.executedAt) : timeAgo(item.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-400"
                        onClick={() => deleteNoteMutation.mutate(item.id)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
