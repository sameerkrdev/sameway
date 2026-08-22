/**
 * Seeded pseudo-random number generation.
 *
 * Stress-test bugs found with `Math.random()` are unreproducible, which makes
 * them nearly impossible to fix. Every generated scenario threads one of these
 * through and stores its seed.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  bool(probability?: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Picks by relative weight; weights need not sum to 1. */
  weightedPick<T>(entries: readonly { value: T; weight: number }[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32: small, fast, and good enough for scenario generation. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);

  const int = (min: number, max: number): number => Math.floor(float(min, max + 1));

  const bool = (probability = 0.5): boolean => next() < probability;

  const pick = <T,>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) {
      throw new Error("Rng.pick called with an empty list");
    }
    return item;
  };

  const weightedPick = <T,>(entries: readonly { value: T; weight: number }[]): T => {
    const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);

    if (total <= 0) {
      throw new Error("Rng.weightedPick requires at least one positive weight");
    }

    let threshold = next() * total;

    for (const entry of entries) {
      threshold -= Math.max(0, entry.weight);
      if (threshold <= 0) {
        return entry.value;
      }
    }

    const last = entries[entries.length - 1];
    if (!last) {
      throw new Error("Rng.weightedPick called with an empty list");
    }
    return last.value;
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const output = [...items];

    for (let i = output.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const a = output[i];
      const b = output[j];
      if (a !== undefined && b !== undefined) {
        output[i] = b;
        output[j] = a;
      }
    }

    return output;
  };

  return { next, float, int, bool, pick, weightedPick, shuffle };
}
