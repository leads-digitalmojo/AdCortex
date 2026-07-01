export type Classification = "WINNER" | "WATCH" | "UNDERPERFORMER";

/**
 * Mojo AdCortex Classification Logic
 * WINNER: Health ≥ 75, CPL ≤ target
 * WATCH: Health 50–74
 * UNDERPERFORMER: Health < 50 OR CPL > 1.3× target
 */
export function getClassification(
  healthScore: number
): Classification {
  if (healthScore >= 70) {
    return "WINNER";
  }
  
  if (healthScore < 35) {
    return "UNDERPERFORMER";
  }
  
  return "WATCH";
}
