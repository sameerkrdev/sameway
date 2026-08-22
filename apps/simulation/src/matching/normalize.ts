import type { ScoringWeights } from "@/domain/entities";

/**
 * Maps a measurement onto 0-100 where lower is better.
 *
 * Returns 100 at zero and 0 at the threshold, clamped at both ends. Raw
 * metrics must never be summed directly: adding minutes to percentages to
 * kilometres produces a number whose weights do not mean what the UI says they
 * mean.
 */
export function normalizeLowerIsBetter(
  value: number | undefined,
  threshold: number,
): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  if (threshold <= 0) {
    return value <= 0 ? 100 : 0;
  }
  return clamp(100 * (1 - value / threshold), 0, 100);
}

/** Maps a measurement onto 0-100 where higher is better, saturating at `reference`. */
export function normalizeHigherIsBetter(value: number | undefined, reference: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  if (reference <= 0) {
    return 100;
  }
  return clamp((value / reference) * 100, 0, 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type WeightKey = keyof ScoringWeights;

/**
 * Rescales configured weights so they sum to 1, which is what makes the final
 * score land on the same 0-100 scale as its components and lets the UI show
 * honest per-component contributions.
 */
export function normalizeWeights(weights: ScoringWeights): Record<WeightKey, number> {
  const keys: WeightKey[] = ["eta", "distance", "detour", "routeQuality", "fairness"];
  const total = keys.reduce((sum, key) => sum + Math.max(0, weights[key]), 0);

  if (total <= 0) {
    // Every weight zeroed: fall back to an equal split rather than dividing by
    // zero and producing NaN scores.
    const equal = 1 / keys.length;
    return { eta: equal, distance: equal, detour: equal, routeQuality: equal, fairness: equal };
  }

  return {
    eta: Math.max(0, weights.eta) / total,
    distance: Math.max(0, weights.distance) / total,
    detour: Math.max(0, weights.detour) / total,
    routeQuality: Math.max(0, weights.routeQuality) / total,
    fairness: Math.max(0, weights.fairness) / total,
  };
}
