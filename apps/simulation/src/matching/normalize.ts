import type { ScoringWeights } from "@/domain/entities";

/**
 * Maps a harm measurement onto 0-100, where 0 is no harm and 100 is at the
 * threshold.
 *
 * Values past the threshold clamp at 100 — a route twice over the limit is not
 * twice as rejected; it was already rejected at stage 10. Raw metrics must
 * never be summed directly: adding minutes to percentages to kilometres
 * produces a number whose weights do not mean what the UI says they mean.
 */
export function normalizeLowerIsBetter(value: number | undefined, threshold: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  if (threshold <= 0) {
    return value <= 0 ? 0 : 100;
  }
  return clamp((value / threshold) * 100, 0, 100);
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
  const keys: WeightKey[] = [
    "driverImpact",
    "existingPassengerImpact",
    "newPassengerImpact",
    "pickupDelay",
  ];
  const total = keys.reduce((sum, key) => sum + Math.max(0, weights[key]), 0);

  // Every weight zeroed: fall back to an equal split rather than dividing by
  // zero and producing NaN scores.
  const share = (key: WeightKey): number =>
    total <= 0 ? 1 / keys.length : Math.max(0, weights[key]) / total;

  return {
    driverImpact: share("driverImpact"),
    existingPassengerImpact: share("existingPassengerImpact"),
    newPassengerImpact: share("newPassengerImpact"),
    pickupDelay: share("pickupDelay"),
  };
}
