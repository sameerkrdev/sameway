import { describe, expect, it } from "vitest";

import { buildArrivalTimeline, computeExistingPassengerDelays } from "@/matching/delays";
import type { ProposedStop } from "@/matching/types";
import type { RouteLegResult } from "@/routing/types";

function stop(id: string, type: ProposedStop["type"], passengerId: string): ProposedStop {
  return {
    id,
    passengerId,
    type,
    seats: 1,
    location: { lat: 28.6, lng: 77.2 },
    isNew: false,
  };
}

function legs(...durations: number[]): RouteLegResult[] {
  return durations.map((durationMin) => ({ distanceKm: durationMin / 2, durationMin }));
}

describe("arrival timelines", () => {
  it("accumulates leg durations into arrival times", () => {
    const stops = [stop("a", "PICKUP", "A"), stop("b", "DROP", "A")];
    const timeline = buildArrivalTimeline(stops, legs(5, 15));

    expect(timeline?.get("a")).toBe(5);
    expect(timeline?.get("b")).toBe(20);
  });

  it("refuses to map legs when the provider collapsed waypoints", () => {
    // One leg for two stops means we can no longer tell which duration belongs
    // to which passenger. Guessing would silently mis-attribute a delay.
    const stops = [stop("a", "PICKUP", "A"), stop("b", "DROP", "A")];
    expect(buildArrivalTimeline(stops, legs(5))).toBeNull();
  });
});

describe("existing passenger delay", () => {
  it("measures how much later each rider reaches their destination", () => {
    const existing = [stop("pickA", "PICKUP", "A"), stop("dropA", "DROP", "A")];

    const before = buildArrivalTimeline(existing, legs(4, 16));
    expect(before?.get("dropA")).toBe(20);

    // The same two stops, now with the new rider's pickup wedged in front.
    const after = new Map<string, number>([
      ["newPickup", 3],
      ["pickA", 9],
      ["dropA", 28],
    ]);

    const result = computeExistingPassengerDelays(existing, before ?? new Map(), after);

    expect(result.maximumDelayMin).toBe(8);
    expect(result.delays).toHaveLength(1);
    expect(result.delays[0]).toMatchObject({
      passengerId: "A",
      arrivalBeforeMin: 20,
      arrivalAfterMin: 28,
      delayMin: 8,
    });
  });

  it("only thresholds drop stops", () => {
    const existing = [stop("pickA", "PICKUP", "A"), stop("dropA", "DROP", "A")];
    const before = new Map([
      ["pickA", 4],
      ["dropA", 20],
    ]);
    const after = new Map([
      ["pickA", 14],
      ["dropA", 21],
    ]);

    const result = computeExistingPassengerDelays(existing, before, after);

    // The pickup slipped ten minutes but only the one-minute drop delay counts.
    expect(result.delays).toHaveLength(1);
    expect(result.maximumDelayMin).toBe(1);
  });
});
