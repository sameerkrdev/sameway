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
  it("returns 0 for no harm and 100 at the threshold", () => {
    // The scale measures harm, so it runs upward from zero. Stage 11 sums
    // these, and the winner is the lowest total.
    expect(normalizeLowerIsBetter(0, 15)).toBe(0);
    expect(normalizeLowerIsBetter(15, 15)).toBe(100);
    expect(normalizeLowerIsBetter(7.5, 15)).toBe(50);
  });

  it("clamps rather than running past the threshold", () => {
    // Twice over the limit is not twice as rejected — stage 10 already
    // rejected it.
    expect(normalizeLowerIsBetter(30, 15)).toBe(100);
    expect(normalizeLowerIsBetter(-5, 15)).toBe(0);
  });

  it("scores an absent measurement as zero rather than NaN", () => {
    expect(normalizeLowerIsBetter(undefined, 15)).toBe(0);
    expect(normalizeLowerIsBetter(Number.NaN, 15)).toBe(0);
  });

  it("rescales weights to sum to one so contributions stay on a 0-100 scale", () => {
    const weights = normalizeWeights({
      driverImpact: 30,
      existingPassengerImpact: 30,
      newPassengerImpact: 25,
      pickupDelay: 15,
    });

    expect(weights.driverImpact).toBeCloseTo(0.3, 10);
    expect(weights.pickupDelay).toBeCloseTo(0.15, 10);

    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("falls back to an equal split rather than dividing by zero", () => {
    const weights = normalizeWeights({
      driverImpact: 0,
      existingPassengerImpact: 0,
      newPassengerImpact: 0,
      pickupDelay: 0,
    });

    expect(weights.driverImpact).toBeCloseTo(0.25, 10);
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});
