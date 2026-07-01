import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/format";
import {
  Brain,
  Loader2,
  Pause,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  Play,
  Zap,
  BarChart3,
  AlertCircle,
  Info,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────

interface StrategicCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: string; // "PAUSE_AD" | "SCALE_BUDGET_UP" | "REJECT" | "MARK_COMPLETE" etc.
  entityName: string;
  entityType: string; // "campaign" | "adset" | "ad" | "ad_group"
  platform: string; // "meta" | "google"
  currentMetrics?: {
    spend?: number;
    leads?: number;
    cpl?: number;
    ctr?: number;
    impressions?: number;
    cpc?: number;
    cvr?: number;
  };
  onConfirm: (strategicCall: string) => void;
  isExecuting?: boolean;
  /** Override the confirm button label */
  confirmLabel?: string;
  /** Override the dialog title */
  titleOverride?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getActionDisplay(actionType: string): {
  label: string;
  icon: typeof Pause;
  color: string;
  bgColor: string;
} {
  if (actionType.startsWith("PAUSE"))
    return { label: actionType.replace(/_/g, " "), icon: Pause, color: "text-red-400", bgColor: "bg-red-500/10" };
  if (actionType.includes("SCALE_BUDGET_UP") || actionType.includes("ENABLE"))
    return { label: actionType.replace(/_/g, " "), icon: TrendingUp, color: "text-emerald-400", bgColor: "bg-emerald-500/10" };
  if (actionType.includes("SCALE_BUDGET_DOWN"))
    return { label: actionType.replace(/_/g, " "), icon: TrendingDown, color: "text-amber-400", bgColor: "bg-amber-500/10" };
  if (actionType.includes("SET_BUDGET") || actionType.includes("SET_CAMPAIGN_BUDGET"))
    return { label: "SET BUDGET", icon: IndianRupee, color: "text-purple-400", bgColor: "bg-purple-500/10" };
  return { label: actionType.replace(/_/g, " "), icon: Zap, color: "text-primary", bgColor: "bg-primary/10" };
}

function getPlaceholderText(actionType: string): string {
  if (actionType.startsWith("PAUSE"))
    return "e.g., CPL has been 40% above target for 5 days with declining CTR, pausing to reallocate budget to winners";
  if (actionType.includes("SCALE_BUDGET_UP"))
    return "e.g., This winner has maintained CPL 30% below target for 7 days with consistent volume — scaling to capture more leads";
  if (actionType.includes("SCALE_BUDGET_DOWN"))
    return "e.g., Performance declining over last 3 days, reducing budget while we test new creative variants";
  return "e.g., Describe the strategic reasoning behind this action — what data supports it, what outcome do you expect?";
}

const MIN_RATIONALE_LENGTH = 20;

// ─── Component ──────────────────────────────────────────────────────

export function StrategicCallDialog({
  open,
  onOpenChange,
  actionType,
  entityName,
  entityType,
  platform,
  currentMetrics,
  onConfirm,
  isExecuting = false,
  confirmLabel,
  titleOverride,
}: StrategicCallDialogProps) {
  const [rationale, setRationale] = useState("");
  const actionDisplay = getActionDisplay(actionType);
  const ActionIcon = actionDisplay.icon;
  const isValid = rationale.trim().length >= MIN_RATIONALE_LENGTH;

  function handleConfirm() {
    if (!isValid) return;
    onConfirm(rationale.trim());
    setRationale("");
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setRationale("");
    }
    onOpenChange(newOpen);
  }

  const metrics = currentMetrics || {};
  const hasMetrics = Object.values(metrics).some((v) => v != null && v !== 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-xl bg-card rounded-2xl shadow-2xl p-0 overflow-hidden border border-border/40" 
        data-testid="strategic-call-dialog"
      >
        {/* Header */}
        <DialogHeader className="p-6 pb-4 bg-muted/30 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
               <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shadow-inner">
                  <Brain className="w-5 h-5" />
               </div>
               <div>
                  <DialogTitle className="t-page-title text-foreground">
                     {titleOverride || "Strategic Decision Audit"}
                  </DialogTitle>
                  <p className="t-label text-muted-foreground mt-0.5">Decision Intelligence Layer</p>
               </div>
            </div>
            <div className={`px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-widest ${actionDisplay.bgColor} ${actionDisplay.color} border border-border/30 shadow-xs`}>
                {actionDisplay.label}
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-5">
           {/* Context Layer */}
           <div className="flex items-center gap-4 p-4 bg-accent/30 rounded-xl border border-accent/40 shadow-xs">
              <div className="flex flex-col items-center justify-center size-12 bg-card rounded-lg shadow-sm border border-border/60 shrink-0">
                 {platform === 'google' ? (
                   <img src="https://upload.wikimedia.org/wikipedia/commons/c/c7/Google_Ads_logo.svg" className="w-5 h-5" alt="Google" />
                 ) : (
                   <img src="https://upload.wikimedia.org/wikipedia/commons/e/ee/Logo_Meta_Platforms.svg" className="w-5 h-5" alt="Meta" />
                 )}
                 <span className="text-xs font-black uppercase mt-1 text-muted-foreground">{platform}</span>
              </div>
              <div className="flex-1 min-w-0">
                 <p className="t-label text-muted-foreground mb-0.5 tracking-wider">{entityType}</p>
                 <h4 className="t-body-sm font-bold text-foreground truncate leading-tight">{entityName}</h4>
              </div>
           </div>

           {/* Metrics Grid */}
           {hasMetrics && (
             <div className="space-y-2.5 px-1">
                <div className="flex items-center gap-2">
                   <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                   <span className="t-label text-muted-foreground uppercase tracking-widest">Decision Parameters</span>
                </div>
                <div className="grid grid-cols-4 gap-4 bg-muted/20 p-3.5 rounded-xl border border-border/30">
                   {metrics.spend != null && (
                     <div className="space-y-1">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-tighter">Spend</p>
                        <p className="text-base font-bold text-foreground tabular-nums">{formatINR(metrics.spend, 0)}</p>
                     </div>
                   )}
                   {metrics.cpl != null && metrics.cpl > 0 && (
                     <div className="space-y-1 border-l border-border/30 pl-4">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-tighter">CPL</p>
                        <p className="text-base font-bold text-foreground tabular-nums">{formatINR(metrics.cpl, 0)}</p>
                     </div>
                   )}
                   {metrics.ctr != null && (
                     <div className="space-y-1 border-l border-border/30 pl-4">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-tighter">CTR</p>
                        <p className="text-base font-bold text-foreground tabular-nums">{metrics.ctr.toFixed(2)}%</p>
                     </div>
                   )}
                   {metrics.leads != null && (
                     <div className="space-y-1 border-l border-border/30 pl-4">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-tighter">Leads</p>
                        <p className="text-base font-bold text-foreground tabular-nums">{metrics.leads}</p>
                     </div>
                   )}
                </div>
             </div>
           )}

           {/* Strategic Rationale Input */}
           <div className="space-y-2.5 pt-1 px-1">
              <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    <span className="t-label text-muted-foreground uppercase tracking-widest">Executive Rationale</span>
                 </div>
                 <span className={`text-xs font-black tabular-nums px-2 py-0.5 rounded-full border ${rationale.trim().length >= MIN_RATIONALE_LENGTH ? 'bg-emerald-50 text-emerald-500 border-emerald-100' : 'bg-muted text-muted-foreground border-border/40'}`}>
                    {rationale.trim().length}/{MIN_RATIONALE_LENGTH}
                 </span>
              </div>
              <div className="relative group">
                 <Textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder={getPlaceholderText(actionType)}
                    className="min-h-[120px] p-4 t-body-sm font-medium bg-muted/40 border-border/60 rounded-xl focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted-foreground resize-none shadow-inner"
                    data-testid="input-strategic-rationale"
                 />
                 {rationale.trim().length > 0 && rationale.trim().length < MIN_RATIONALE_LENGTH && (
                    <div className="absolute right-3 bottom-3 flex items-center gap-1.5 px-2 py-1 bg-card/90 backdrop-blur rounded-lg border border-primary/20 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                       <Info className="w-3 h-3 text-primary" strokeWidth={3} />
                       <span className="text-xs font-black text-primary uppercase">Min {MIN_RATIONALE_LENGTH-rationale.trim().length} chars</span>
                    </div>
                 )}
              </div>
           </div>
        </div>

        {/* Footer actions */}
        <DialogFooter className="p-5 border-t border-border/40 bg-muted/30 gap-3">
           <Button
              variant="ghost"
              className="t-label text-muted-foreground hover:bg-white/10"
              onClick={() => handleOpenChange(false)}
              disabled={isExecuting}
           >
              Dismiss
           </Button>
           <Button
              className="h-10 px-6 bg-primary hover:bg-[#f5c723] text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:scale-100 gap-2 border border-primary-border"
              onClick={handleConfirm}
              disabled={!isValid || isExecuting}
           >
              {isExecuting ? (
                 <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                 <Play className="w-4 h-4 fill-current" />
              )}
              <span>{confirmLabel || "Authorize Action"}</span>
           </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
