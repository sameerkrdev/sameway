import { describe, expect, it } from "vitest";

import { createRng } from "@/lib/rng";

describe("seeded rng", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = createRng(12345);
    const b = createRng(12345);

    const first = Array.from({ length: 20 }, () => a.next());
    const second = Array.from({ length: 20 }, () => b.next());

    expect(first).toEqual(second);
  });

  it("produces a different sequence for a different seed", () => {
    const a = Array.from({ length: 10 }, createRng(1).next);
    const b = Array.from({ length: 10 }, createRng(2).next);

    expect(a).not.toEqual(b);
  });

  it("stays within bounds", () => {
    const rng = createRng(99);

    for (let i = 0; i < 500; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);

      const integer = rng.int(3, 7);
      expect(integer).toBeGreaterThanOrEqual(3);
      expect(integer).toBeLessThanOrEqual(7);
    }
  });

  it("reproduces weighted picks and shuffles", () => {
    const entries = [
      { value: "cab", weight: 40 },
      { value: "auto", weight: 30 },
      { value: "rickshaw", weight: 30 },
    ];

    const a = createRng(2024);
    const b = createRng(2024);

    const picksA = Array.from({ length: 50 }, () => a.weightedPick(entries));
    const picksB = Array.from({ length: 50 }, () => b.weightedPick(entries));
    expect(picksA).toEqual(picksB);

    expect(createRng(7).shuffle([1, 2, 3, 4, 5])).toEqual(createRng(7).shuffle([1, 2, 3, 4, 5]));
  });

  it("honours relative weights", () => {
    const rng = createRng(5);
    const counts = { heavy: 0, light: 0 };

    for (let i = 0; i < 2000; i += 1) {
      counts[
        rng.weightedPick([
          { value: "heavy" as const, weight: 9 },
          { value: "light" as const, weight: 1 },
        ])
      ] += 1;
    }

    expect(counts.heavy).toBeGreaterThan(counts.light * 5);
  });
});
