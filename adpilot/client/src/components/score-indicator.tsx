import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHealthBgColor, getHealthBarBg } from "@/lib/format";

export interface ScoreIndicatorProps {
  score: number;
  breakdown?: Record<string, number>;
  detailedBreakdown?: Record<string, { contribution: number; weight: number }>;
  label?: string;
  description?: string;
}

export function ScoreIndicator({ score, breakdown, detailedBreakdown, label, description }: ScoreIndicatorProps) {
  const safeScore = Math.round(Math.max(0, Math.min(100, score || 0)));
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 group cursor-help">
          <div className={`w-14 h-1.5 rounded-full overflow-hidden ${getHealthBarBg(safeScore)}`}>
            <div 
              className={`h-full rounded-full transition-all duration-500 ${getHealthBgColor(safeScore)}`} 
              style={{ width: `${safeScore}%` }} 
            />
          </div>
          <span className="tabular-nums text-xs font-bold text-muted-foreground group-hover:text-foreground transition-colors w-6">
            {safeScore}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs p-3">
        <div className="text-xs space-y-1.5">
          <div className="flex items-center justify-between border-b border-border/50 pb-1.5 mb-1.5">
            <p className="font-bold">{label || "Scoring Breakdown"}</p>
            <span className={`text-xs font-black ${getHealthBgColor(safeScore).replace('bg-', 'text-')}`}>
              {safeScore}/100
            </span>
          </div>
          
          {description && <p className="text-xs text-muted-foreground pb-1">{description}</p>}
          
          {detailedBreakdown || breakdown ? (
            <div className="space-y-1">
              {Object.entries(detailedBreakdown || breakdown || {}).map(([k, v]) => {
                const isDetailed = detailedBreakdown && detailedBreakdown[k];
                const displayVal = isDetailed 
                  ? `${detailedBreakdown[k].contribution.toFixed(1)} / ${detailedBreakdown[k].weight}`
                  : (typeof v === "number" ? Math.round(v) : 0);
                
                // For color coding, use normalized score if available
                const scoreForColor = isDetailed ? (detailedBreakdown[k].contribution / detailedBreakdown[k].weight) * 100 : (typeof v === "number" ? v : 0);

                let color = "text-muted-foreground";
                if (scoreForColor >= 85) color = "text-emerald-400";
                else if (scoreForColor >= 70) color = "text-emerald-500/80";
                else if (scoreForColor >= 40) color = "text-amber-400";
                else color = "text-red-400";

                return (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="uppercase text-xs font-bold opacity-70">{k.replace(/_/g, ' ')}</span>
                    <span className={`font-bold tabular-nums text-xs ${color}`}>{displayVal}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">Detailed breakdown unavailable</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
