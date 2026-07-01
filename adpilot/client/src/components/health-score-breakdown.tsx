// Unified Diagnostic UI v1.1 - Force Reload
import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatINR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface HealthScoreBreakdownProps {
  entityName: string;
  scoreBreakdown: Record<string, number | string>;
  detailedBreakdown?: Record<string, any>;
  scoreBands?: Record<string, string>;
  className?: string;
}

const formatMetricValue = (metricKey: string, value: any, unit?: string) => {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (unit === "currency" || metricKey === "cpl" || metricKey === "cpm") return formatINR(n, 0);
  if (unit === "percent" || metricKey === "ctr" || metricKey === "cvr" || metricKey === "budget") return `${n.toFixed(1)}%`;
  if (metricKey === "leads") return formatNumber(n);
  if (metricKey === "freq") return n.toFixed(2);
  return formatNumber(n);
};

const getBandInfo = (score: number, maxScore: number) => {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;

  let band = "CRITICAL";
  if (pct >= 80) band = "EXCELLENT";
  else if (pct >= 60) band = "GOOD";
  else if (pct >= 40) band = "WATCH";
  else if (pct >= 15) band = "ALERT";

  let colorClass = "text-red-700 bg-red-500/10 border-red-500/20";
  if (band === "EXCELLENT" || band === "GOOD") {
    colorClass = "text-emerald-600 bg-emerald-500/10 border-emerald-500/20";
  } else if (band === "WATCH") {
    colorClass = "text-amber-600 bg-amber-500/10 border-amber-500/20";
  }

  return { band, colorClass };
};

export const HealthScoreBreakdown: React.FC<HealthScoreBreakdownProps> = React.memo(({
  entityName,
  scoreBreakdown,
  detailedBreakdown,
  scoreBands,
  className
}) => {
  if (!scoreBreakdown || Object.keys(scoreBreakdown).length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-sm font-semibold text-slate-950 uppercase tracking-wider">
        HEALTH SCORE BREAKDOWN — {entityName}
      </p>
      <div className="flex flex-wrap gap-2.5">
        {Object.entries(scoreBreakdown).map(([metric, score]) => {
          const detailed = detailedBreakdown?.[metric];
          const displayScore = detailed && detailed.weight
            ? `${Math.round(detailed.contribution)} / ${Math.round(detailed.weight)}`
            : (typeof score === "number" ? String(Math.round(score)) : String(score));
          
          const numericScore = detailed && detailed.contribution !== undefined ? detailed.contribution : (typeof score === "number" ? score : 0);
          const maxScore = detailed?.weight || 100;
          
          const { band, colorClass } = getBandInfo(numericScore, maxScore);

          return (
            <Tooltip key={metric}>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-card/50 border border-border/40 min-w-[160px] flex-1 cursor-help transition-all hover:border-primary/20 hover:bg-card">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                      {metric.replace(/_/g, " ")}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-foreground tracking-tight">
                      {displayScore}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("text-[11px] font-bold tracking-normal px-1.5 py-0.5 border-none shadow-none uppercase w-[90px] justify-center", colorClass)}>
                    {band}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="space-y-1.5 p-3">
                <p className="text-xs font-black uppercase tracking-wider border-b border-border/50 pb-1 text-primary">
                  {metric.replace(/_/g, " ")}
                </p>
                <div className="space-y-1">
                  <div className="flex justify-between gap-6 text-xs">
                    <span className="text-muted-foreground font-medium">Current:</span>
                    <span className="font-bold text-foreground">
                      {formatMetricValue(metric, detailed?.actual, detailed?.unit)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-6 text-xs">
                    <span className="text-muted-foreground font-medium">Target:</span>
                    <span className="font-bold text-foreground">
                      {formatMetricValue(metric, detailed?.target, detailed?.unit)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-6 text-xs border-t border-border/30 pt-1 mt-1">
                    <span className="text-muted-foreground font-medium">Contribution:</span>
                    <span className="font-bold text-primary">
                      {Math.round(detailed?.contribution || (typeof score === 'number' ? score : 0))} pts
                    </span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
});

HealthScoreBreakdown.displayName = "HealthScoreBreakdown";
