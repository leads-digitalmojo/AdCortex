import { Badge } from "@/components/ui/badge";
import { getClassificationColor } from "@/lib/format";
import type { Classification } from "@shared/classification";

export function StatusBadge({ classification }: { classification: string | Classification | undefined }) {
  const rawValue = (classification || "WATCH").toString().toUpperCase();
  const normalized = ["GREEN", "YELLOW", "ORANGE", "RED", "WINNER", "WATCH", "UNDERPERFORMER", "CRITICAL", "ALERT", "POOR"].includes(rawValue)
    ? rawValue
    : "WATCH";
  const colors = getClassificationColor(normalized);
  const label = normalized === "UNDERPERFORMER" ? "UNDERPERF" : normalized;
  
  return (
    <Badge 
      variant="secondary" 
      className={`text-[11px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${colors.bg} ${colors.text} border-none shadow-sm w-[90px] justify-center`}
    >
      {label}
    </Badge>
  );
}
