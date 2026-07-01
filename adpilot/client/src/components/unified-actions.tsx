import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useExecution } from "@/hooks/use-execution";
import { useClient } from "@/lib/client-context";
import { Loader2, Zap, Check, X, Brain } from "lucide-react";
import { formatINR } from "@/lib/format";

// ─── Types ─────────────────────────────────────────────────────────

export type ActionState = "pending" | "auto-executed" | "completed" | "rejected" | "deferred";

export interface UnifiedActionItem {
  id: string;
  description?: string;
  autoExecutable?: boolean;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  actionType?: string;
  platform?: string;
  recommendation?: string;
  currentMetrics?: Record<string, number>;
}

export interface UnifiedActionProps {
  entityId?: string;
  entityName?: string;
  entityType?: string; // campaign, adset, ad, creative, breakdown
  platform?: string;
  actionType?: string; // PAUSE, SCALE_UP, SCALE_DOWN, CREATIVE_REFRESH, etc.
  isAutoExecutable?: boolean; // true = can execute via API, false = manual only
  currentMetrics?: Record<string, number>;
  recommendation?: string; // text description of what's recommended
  onActionComplete?: () => void;
  compact?: boolean; // smaller buttons for inline use
  // Backward compat props (from old interface)
  item?: UnifiedActionItem;
  state?: ActionState;
  onStateChange?: (id: string, state: ActionState, strategicCall?: string) => void;
}

type DialogMode = "auto-execute" | "mark-complete" | "reject" | null;

const MIN_RATIONALE_LENGTH = 10;

// ─── Component ─────────────────────────────────────────────────────

export function UnifiedActions(props: UnifiedActionProps) {
  // Support backward-compat `item` prop from old interface
  const {
    entityId: eidProp,
    entityName: enameProp,
    entityType: etypeProp,
    platform: platformProp,
    actionType: atypeProp,
    isAutoExecutable: autoExecProp = false,
    currentMetrics: metricsProp,
    recommendation: recProp,
    onActionComplete,
    compact = false,
    item,
    onStateChange,
  } = props;

  const entityId = eidProp || item?.entityId || item?.id || "unknown";
  const entityName = enameProp || item?.entityName || item?.description || item?.id || "Unknown";
  const entityType = etypeProp || item?.entityType || "ad";
  const actionType = atypeProp || item?.actionType || "MANUAL_ACTION";
  const isAutoExecutable = autoExecProp || item?.autoExecutable || false;
  const currentMetrics = metricsProp || item?.currentMetrics;
  const recommendation = recProp || item?.recommendation || item?.description;
  const handleActionComplete = () => {
    onActionComplete?.();
    onStateChange?.(entityId, "completed");
  };
  const { execute, isExecuting } = useExecution();
  const { activePlatform } = useClient();
  const platform = platformProp || activePlatform;

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [rationale, setRationale] = useState("");
  const isValid = rationale.trim().length >= MIN_RATIONALE_LENGTH;

  async function handleConfirm() {
    if (!isValid) return;

    // Determine the actual API action based on dialog mode
    let apiAction = actionType;
    let logParams: Record<string, any> = {
      reason: rationale.trim(),
      recommendation,
    };

    if (dialogMode === "mark-complete") {
      apiAction = "MARK_COMPLETE";
      logParams = {
        ...logParams,
        originalAction: actionType,
        completedBy: "user",
        userNote: rationale.trim(),
      };
    } else if (dialogMode === "reject") {
      apiAction = "REJECT_ACTION";
      logParams = {
        ...logParams,
        originalAction: actionType,
        rejectionReason: rationale.trim(),
      };
    } else if (dialogMode === "auto-execute") {
      // Keep the original actionType for auto-execute
      logParams = {
        ...logParams,
        strategicCall: rationale.trim(),
        executionMode: "auto",
      };
    }

    const result = await execute({
      action: apiAction,
      entityId,
      entityName,
      entityType: entityType as "campaign" | "adset" | "ad" | "ad_group",
      params: logParams,
      strategicCall: rationale.trim(),
    });

    if (result.success) {
      handleActionComplete();
    }

    setDialogMode(null);
    setRationale("");
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setDialogMode(null);
      setRationale("");
    }
  }

  const dialogConfig = {
    "auto-execute": {
      title: "Strategic Call — Auto-Execute",
      description: `Document your rationale before auto-executing "${actionType.replace(/_/g, " ")}" on ${entityName}.`,
      placeholder: "e.g., CPL consistently above target for 5+ days, auto-executing to reallocate budget to winners",
      confirmLabel: "Execute Action",
      confirmColor: "",
      icon: <Zap className="w-4 h-4 text-primary" />,
    },
    "mark-complete": {
      title: "Mark Complete — What did you do?",
      description: `Log what action you took manually for "${entityName}". This helps the learning engine track outcomes.`,
      placeholder: "e.g., Changed the hook in first 3 seconds, added face overlay, uploaded new variant",
      confirmLabel: "Log Completion",
      confirmColor: "",
      icon: <Check className="w-4 h-4 text-primary" />,
    },
    reject: {
      title: "Reject — Why are you rejecting?",
      description: `Explain why you're rejecting the recommendation for "${entityName}". This teaches the system your preferences.`,
      placeholder: "e.g., Creative is still performing well despite age, client preference to keep running",
      confirmLabel: "Log Rejection",
      confirmColor: "",
      icon: <X className="w-4 h-4 text-red-500" />,
    },
  };

  const btnSize = compact ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs";
  const iconSize = compact ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <>
      <div className="flex items-center gap-1 flex-wrap">
        {/* Auto-Execute — only if auto-executable */}
        {isAutoExecutable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className={`${btnSize} gap-1`}
                onClick={(e) => { e.stopPropagation(); setDialogMode("auto-execute"); }}
                disabled={isExecuting}
                data-testid={`ua-auto-${entityId}`}
              >
                <Zap className={iconSize} />
                {!compact && "Auto-Execute"}
              </Button>
            </TooltipTrigger>
            {compact && (
              <TooltipContent><p className="text-xs">Auto-Execute via API</p></TooltipContent>
            )}
          </Tooltip>
        )}

        {/* Mark Complete */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`${btnSize} border-primary/35 text-foreground hover:bg-primary/12 gap-1`}
              onClick={(e) => { e.stopPropagation(); setDialogMode("mark-complete"); }}
              disabled={isExecuting}
              data-testid={`ua-complete-${entityId}`}
            >
              <Check className={iconSize} />
              {!compact && "Mark Complete"}
            </Button>
          </TooltipTrigger>
          {compact && (
            <TooltipContent><p className="text-xs">Mark as completed manually</p></TooltipContent>
          )}
        </Tooltip>

        {/* Reject */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`${btnSize} border-red-500/35 text-red-500 hover:bg-red-500/10 gap-1`}
              onClick={(e) => { e.stopPropagation(); setDialogMode("reject"); }}
              disabled={isExecuting}
              data-testid={`ua-reject-${entityId}`}
            >
              <X className={iconSize} />
              {!compact && "Reject"}
            </Button>
          </TooltipTrigger>
          {compact && (
            <TooltipContent><p className="text-xs">Reject recommendation</p></TooltipContent>
          )}
        </Tooltip>

      </div>

      {/* Strategic Call Dialog */}
      {dialogMode && (
      <Dialog open={!!dialogMode} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg p-0" data-testid="unified-action-dialog">
          <DialogHeader className="p-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shrink-0">
                <Brain className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle>{dialogConfig[dialogMode].title}</DialogTitle>
                <DialogDescription className="mt-0.5">
                  {dialogConfig[dialogMode].description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <DialogBody className="p-0 space-y-4">
            <div className="p-5 space-y-4">
              {/* Context: recommendation + metrics */}
              <div className="rounded-xl p-4 border border-border/60 bg-muted/20 shadow-xs space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs font-black uppercase tracking-wider bg-primary/20 text-primary border-primary/20">
                    {actionType.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant="outline" className="text-xs font-bold uppercase tracking-wider">
                    {entityType}
                  </Badge>
                  <Badge variant="outline" className="text-xs font-bold uppercase tracking-wider">
                    {platform === "google" ? "Google" : "Meta"}
                  </Badge>
                </div>
                <p className="t-body-sm font-bold text-foreground leading-tight" title={entityName}>
                  {entityName}
                </p>
                {recommendation && (
                  <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/20 pl-3">
                    {recommendation}
                  </p>
                )}
                {currentMetrics && Object.keys(currentMetrics).length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2 border-t border-border/30">
                    {currentMetrics.spend != null && currentMetrics.spend > 0 && (
                      <span className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">
                        Spend: <span className="text-foreground tabular-nums">{formatINR(currentMetrics.spend, 0)}</span>
                      </span>
                    )}
                    {currentMetrics.leads != null && (
                      <span className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">
                        Leads: <span className="text-foreground tabular-nums">{currentMetrics.leads}</span>
                      </span>
                    )}
                    {currentMetrics.cpl != null && currentMetrics.cpl > 0 && (
                      <span className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">
                        CPL: <span className="text-foreground tabular-nums">{formatINR(currentMetrics.cpl, 0)}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Rationale Input */}
              <div className="space-y-2.5">
                <label className="t-label text-muted-foreground flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  {dialogMode === "mark-complete"
                    ? "Log Action Details"
                    : dialogMode === "reject"
                    ? "Rejection Strategic Rationale"
                    : "Executive Decision Audit"}
                </label>
                <div className="relative">
                   <Textarea
                     value={rationale}
                     onChange={(e) => setRationale(e.target.value)}
                     placeholder={dialogConfig[dialogMode].placeholder}
                     className="min-h-[110px] t-body-sm bg-muted/30 border-border/60 focus-visible:ring-primary/30 rounded-xl placeholder:text-muted-foreground resize-none shadow-inner"
                     data-testid="ua-rationale-input"
                   />
                   <div className="absolute right-3 bottom-3">
                      <span className={`text-xs font-black tabular-nums px-2 py-0.5 rounded-full border ${rationale.trim().length >= MIN_RATIONALE_LENGTH ? 'bg-emerald-50 text-emerald-500 border-emerald-100' : 'bg-muted text-muted-foreground border-border/40'}`}>
                         {rationale.trim().length}/{MIN_RATIONALE_LENGTH}
                      </span>
                   </div>
                </div>
              </div>
            </div>
          </DialogBody>

          <DialogFooter className="p-4 bg-muted/30">
            <Button
              variant="link"
              className="t-label text-muted-foreground"
              onClick={() => handleOpenChange(false)}
              disabled={isExecuting}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                "h-9 px-6 font-bold rounded-xl shadow-lg transition-all active:scale-95 gap-2",
                dialogMode === "reject" 
                  ? "bg-red-500 hover:bg-red-600 text-white border-red-600 shadow-red-500/20" 
                  : "bg-primary hover:bg-[#f5c723] text-primary-foreground border-primary-border shadow-primary/20",
                dialogConfig[dialogMode].confirmColor
              )}
              onClick={handleConfirm}
              disabled={!isValid || isExecuting}
              data-testid="ua-confirm-btn"
            >
              {isExecuting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                dialogConfig[dialogMode].icon
              )}
              <span>{dialogConfig[dialogMode].confirmLabel}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </>
  );
}

// ─── Compact inline variant for table rows ──────────────────────────

export function UnifiedActionsInline(props: UnifiedActionProps) {
  return <UnifiedActions {...props} compact />;
}

// ─── Backward-compatible wrapper: accepts `item` + `state` + `onStateChange` props ───
export function UnifiedActionsCompat({
  item,
  state,
  onStateChange,
  compact = false,
}: {
  item: UnifiedActionItem;
  state?: ActionState;
  onStateChange?: (id: string, state: ActionState, strategicCall?: string) => void;
  compact?: boolean;
}) {
  return (
    <UnifiedActions
      entityId={item.entityId || item.id}
      entityName={item.entityName || item.description || item.id}
      entityType={item.entityType || "ad"}
      actionType={item.actionType || "MANUAL_ACTION"}
      isAutoExecutable={item.autoExecutable}
      recommendation={item.recommendation || item.description}
      currentMetrics={item.currentMetrics}
      compact={compact}
      onActionComplete={() => {
        onStateChange?.(item.id, "completed");
      }}
    />
  );
}
