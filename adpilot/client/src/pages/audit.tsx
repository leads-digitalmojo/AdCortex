import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Target,
  Brain,
  Activity,
  ArrowRight,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Unified Types ───────────────────────────────────────────────

interface UnifiedInsight {
  issue: string;
  impact: string;
  recommendation: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  entityId?: string;
  entityName?: string;
  entityType?: string;
  confidence: number;
  source: "SOP" | "AI" | "MIXED";
}

// ─── Audit Page Component ─────────────────────────────────────────

export default function AuditPage() {
  const { activeClient, activePlatform, activePlatformInfo } = useClient();

  // 1. Fetch Pipeline Unified Insights
  const { data: pipelineData, isLoading } = useQuery<{ insights: UnifiedInsight[], trace: any }>({
    queryKey: ["/api/intelligence", activeClient?.id, activePlatform, "insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/intelligence/${activeClient?.id}/${activePlatform}/insights`);
      return res.json();
    },
    enabled: !!activeClient?.id && !!activePlatform,
  });

  const insights = pipelineData?.insights || [];
  const criticalCount = insights.filter(i => i.priority === "CRITICAL").length;
  const highCount = insights.filter(i => i.priority === "HIGH").length;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-page-title text-foreground flex items-center gap-2">
            System Performance Audit
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/5 gap-1.5 py-1">
              <ShieldCheck className="w-3 h-3" /> Audit Review
            </Badge>
          </h1>
          <p className="t-label text-muted-foreground mt-0.5">
            {activeClient?.name} · {activePlatformInfo?.label}
          </p>
        </div>
      </div>

      {/* Global Status Bar */}
      <Card className={cn(
        "border-2",
        criticalCount > 0 ? "border-red-500/30 bg-red-500/5" : highCount > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"
      )}>
        <CardContent className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={cn(
              "size-12 rounded-full flex items-center justify-center shadow-lg",
              criticalCount > 0 ? "bg-red-500 text-white" : highCount > 0 ? "bg-amber-500 text-white" : "bg-emerald-500 text-white"
            )}>
              {criticalCount > 0 ? <ShieldX className="w-7 h-7" /> : highCount > 0 ? <ShieldAlert className="w-7 h-7" /> : <ShieldCheck className="w-7 h-7" />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {criticalCount > 0 ? "Critical System Deviations" : highCount > 0 ? "Performance Warnings" : "System in Optimal Equilibrium"}
              </h2>
              <p className="text-base text-muted-foreground">
                {criticalCount > 0 
                  ? `${criticalCount} mission-critical issues require immediate intervention.` 
                  : highCount > 0 
                    ? `${highCount} performance warnings detected. Audit suggest corrective rebalancing.` 
                    : "No metric anomalies or SOP deviations detected by the intelligence layer."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="text-right">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Pipeline Health</p>
                <p className="text-lg font-black text-foreground tabular-nums">{criticalCount > 0 ? "34%" : highCount > 0 ? "78%" : "100%"}</p>
             </div>
             <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                <div 
                   className={cn("h-full", criticalCount > 0 ? "bg-red-500" : highCount > 0 ? "bg-amber-500" : "bg-emerald-500")}
                   style={{ width: criticalCount > 0 ? "34%" : highCount > 0 ? "78%" : "100%" }}
                />
             </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Pipeline Results */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Layer 2: SOP Determinations */}
        <Card className="border-border/50">
          <CardHeader className="border-b border-border/40">
            <CardTitle className="t-section-title flex items-center gap-2">
               <Zap className="w-4 h-4 text-emerald-400" /> Audit Findings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {insights.filter(i => i.source === "SOP").length > 0 ? (
              <div className="divide-y divide-border/30">
                {insights.filter(i => i.source === "SOP").map((ins, idx) => (
                  <div key={idx} className="p-4 space-y-2 hover:bg-muted/10 transition-colors">
                     <div className="flex items-center justify-between">
                        <Badge variant="outline" className={cn(
                          "text-xs px-1.5 py-0",
                          ins.priority === "CRITICAL" ? "border-red-500/30 text-red-400" : "border-amber-500/30 text-amber-400"
                        )}>
                           {ins.priority}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-medium uppercase">{ins.entityType || "Account"}</span>
                     </div>
                     <p className="text-base font-bold text-foreground ">"{ins.issue}"</p>
                     <p className="text-xs text-muted-foreground leading-relaxed">{ins.impact}</p>
                     <div className="flex items-start gap-2 bg-emerald-500/5 border border-emerald-500/10 p-2.5 rounded-lg">
                        <ArrowRight className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-xs font-semibold text-emerald-400 leading-snug">{ins.recommendation}</p>
                     </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center space-y-3">
                 <ShieldCheck className="w-10 h-10 text-emerald-500/40 mx-auto" />
                 <p className="text-base text-muted-foreground">All deterministic SOP rules are in a passing state.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Layer 3: AI Reasoning Results (Strategic) */}
        <Card className="border-border/50">
          <CardHeader className="border-b border-border/40 bg-blue-500/3">
             <CardTitle className="t-section-title flex items-center gap-2">
                <Brain className="w-4 h-4 text-blue-400" /> Strategic Recommendations
             </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {insights.filter(i => i.source === "AI").length > 0 ? (
              <div className="divide-y divide-border/30">
                {insights.filter(i => i.source === "AI").map((ins, idx) => (
                  <div key={idx} className="p-4 space-y-2 hover:bg-muted/10 transition-colors">
                     <div className="flex items-center justify-between">
                        <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs px-1.5 py-0">
                           AI STRATEGY
                        </Badge>
                        <span className="text-xs text-muted-foreground font-medium uppercase">{ins.entityType || "Account"}</span>
                     </div>
                     <p className="text-base font-bold text-foreground ">"{ins.issue}"</p>
                     <p className="text-xs text-muted-foreground leading-relaxed">{ins.impact}</p>
                     <div className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/10 p-2.5 rounded-lg">
                        <Brain className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                        <p className="text-xs font-semibold text-blue-400 leading-snug">{ins.recommendation}</p>
                     </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center space-y-3">
                 <Activity className="w-10 h-10 text-blue-500/40 mx-auto" />
                 <p className="text-base text-muted-foreground">AI hasn't identified any strategic shifts beyond SOP baselines.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit Info */}
      <div className="p-4 bg-muted/20 border border-border/40 rounded-xl flex items-start gap-4">
         <div className="size-8 rounded-lg bg-background flex items-center justify-center border border-border/40">
            <ShieldCheck className="w-4 h-4 text-primary" />
         </div>
         <div className="space-y-1">
            <p className="text-xs font-bold text-foreground">Audit Complete</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
               This audit reviews campaign performance against standard operating procedures and identifies optimization opportunities.
            </p>
         </div>
      </div>
    </div>
  );
}
