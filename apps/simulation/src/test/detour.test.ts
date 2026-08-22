import { describe, expect, it } from "vitest";

import { normalizeLowerIsBetter, normalizeWeights } from "@/matching/normalize";

describe("detour arithmetic", () => {
  it.each([
    { original: 10, updated: 11, expected: 10 },
    { original: 10, updated: 13, expected: 30 },
    { original: 12.4, updated: 15.8, expected: 27.419 },
    { original: 10, updated: 10, expected: 0 },
  ])("$original km becoming $updated km is $expected%", ({ original, updated, expected }) => {
    const detour = ((updated - original) / original) * 100;
    expect(detour).toBeCloseTo(expected, 3);
  });
});

describe("score normalisation", () => {
  it("returns 100 at zero and 0 at the threshold", () => {
    expect(normalizeLowerIsBetter(0, 15)).toBe(100);
    expect(normalizeLowerIsBetter(15, 15)).toBe(0);
    expect(normalizeLowerIsBetter(7.5, 15)).toBe(50);
  });

  it("clamps rather than going negative past the threshold", () => {
    expect(normalizeLowerIsBetter(30, 15)).toBe(0);
    expect(normalizeLowerIsBetter(-5, 15)).toBe(100);
  });

  it("scores an absent measurement as zero rather than NaN", () => {
    expect(normalizeLowerIsBetter(undefined, 15)).toBe(0);
    expect(normalizeLowerIsBetter(Number.NaN, 15)).toBe(0);
  });

  it("rescales weights to sum to one so contributions stay on a 0-100 scale", () => {
    const weights = normalizeWeights({
      eta: 30,
      distance: 20,
      detour: 30,
      routeQuality: 20,
      fairness: 0,
    });

    expect(weights.eta).toBeCloseTo(0.3, 10);
    expect(weights.fairness).toBe(0);

    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("falls back to an equal split rather than dividing by zero", () => {
    const weights = normalizeWeights({
      eta: 0,
      distance: 0,
      detour: 0,
      routeQuality: 0,
      fairness: 0,
    });

    expect(weights.eta).toBeCloseTo(0.2, 10);
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});
