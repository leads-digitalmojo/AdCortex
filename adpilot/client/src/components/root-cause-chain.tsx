import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface RootCauseChainProps {
  steps: string[];
  className?: string;
}

function parseStep(step: string) {
  const match = step.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)\/100$/);
  if (!match) return { label: step, score: null };
  return {
    label: match[1].trim(),
    score: Number(match[2]),
  };
}

function getStepClasses(score: number | null) {
  if (score === null) {
    return "border-border/50 bg-background/60 text-foreground";
  }
  if (score < 60) {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (score >= 75) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

export function RootCauseChain({ steps, className }: RootCauseChainProps) {
  if (!steps.length) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {steps.map((step, index) => {
        const parsed = parseStep(step);
        return (
          <div key={`${step}-${index}`} className="flex items-center gap-2">
            <div className={cn("rounded-full border px-3 py-1.5 text-base font-semibold", getStepClasses(parsed.score))}>
              <span>{parsed.label}</span>
              {parsed.score !== null && <span className="ml-2 opacity-80">{parsed.score}/100</span>}
            </div>
            {index < steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        );
      })}
    </div>
  );
}
