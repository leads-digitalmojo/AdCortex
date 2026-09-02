export type Classification = "WINNER" | "WATCH" | "UNDERPERFORMER" | "NOT_SCORED";

/** Score at or above this, with CPL on target, is a WINNER. */
export const WINNER_SCORE = 75;
/** Below this score an entity is an UNDERPERFORMER regardless of anything else. */
export const UNDERPERFORMER_SCORE = 50;
/** CPL above this multiple of target forces UNDERPERFORMER, whatever the score. */
export const CPL_UNDERPERFORMER_MULTIPLE = 1.3;

/**
 * Mojo AdCortex Classification Logic — the single definition, shared by the Meta
 * and Google transforms. Mirrors get_interpretation() in
 * ads_agent/scoring_engine.py; the two must agree.
 *
 *   WINNER:         score >= 75 AND (no CPL target, or CPL <= target)
 *   UNDERPERFORMER: score < 50  OR  CPL > 1.3 x target
 *   WATCH:          everything in between
 *   NOT_SCORED:     no score available
 *
 * The CPL override matters: an entity can carry a healthy composite on its
 * supporting metrics while losing money on every lead. Score alone cannot see that.
 *
 * A missing score returns NOT_SCORED rather than defaulting to 0 — an entity that
 * failed to score is not the same as an entity that scored badly, and must never be
 * swept into a bulk pause on that basis.
 */
export function getClassification(
  healthScore: number | null | undefined,
  cpl?: number | null,
  targetCpl?: number | null
): Classification {
  if (healthScore === null || healthScore === undefined || !Number.isFinite(healthScore)) {
    return "NOT_SCORED";
  }

  const hasCplTarget = typeof targetCpl === "number" && Number.isFinite(targetCpl) && targetCpl > 0;
  const hasCpl = typeof cpl === "number" && Number.isFinite(cpl);

  if (hasCplTarget && hasCpl && (cpl as number) > (targetCpl as number) * CPL_UNDERPERFORMER_MULTIPLE) {
    return "UNDERPERFORMER";
  }

  if (healthScore < UNDERPERFORMER_SCORE) {
    return "UNDERPERFORMER";
  }

  if (healthScore >= WINNER_SCORE) {
    // A winner must also be paying no more than target for its leads.
    if (!hasCplTarget || !hasCpl || (cpl as number) <= (targetCpl as number)) {
      return "WINNER";
    }
    return "WATCH";
  }

  return "WATCH";
}
