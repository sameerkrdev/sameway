import { describe, expect, it } from "vitest";

import { enumerateInsertions } from "@/matching/insertion";
import type { ProposedStop } from "@/matching/types";

function stop(id: string, type: ProposedStop["type"], passengerId: string): ProposedStop {
  return {
    id,
    passengerId,
    type,
    seats: 1,
    location: { lat: 28.6 + id.length / 100, lng: 77.2 + id.length / 100 },
    isNew: false,
  };
}

const NEW_PICKUP: ProposedStop = {
  id: "new_pickup",
  passengerId: "NEW",
  type: "PICKUP",
  seats: 1,
  location: { lat: 28.64, lng: 77.24 },
  isNew: true,
};

const NEW_DROP: ProposedStop = {
  id: "new_drop",
  passengerId: "NEW",
  type: "DROP",
  seats: 1,
  location: { lat: 28.66, lng: 77.28 },
  isNew: true,
};

function existingRoute(pairs: number): ProposedStop[] {
  const stops: ProposedStop[] = [];
  for (let i = 0; i < pairs; i += 1) {
    stops.push(stop(`p${i}`, "PICKUP", `P${i}`));
  }
  for (let i = 0; i < pairs; i += 1) {
    stops.push(stop(`d${i}`, "DROP", `P${i}`));
  }
  return stops;
}

describe("insertion enumeration", () => {
  it.each([0, 1, 4, 6, 9])("produces exactly (n+1)(n+2)/2 candidates for n=%i", (n) => {
    const existing = Array.from({ length: n }, (_, index) =>
      stop(`s${index}`, index % 2 === 0 ? "PICKUP" : "DROP", `P${index}`),
    );

    const candidates = enumerateInsertions(existing, NEW_PICKUP, NEW_DROP);
    expect(candidates).toHaveLength(((n + 1) * (n + 2)) / 2);
  });

  it("always places the new pickup before the new drop", () => {
    const candidates = enumerateInsertions(existingRoute(3), NEW_PICKUP, NEW_DROP);

    for (const candidate of candidates) {
      const pickupAt = candidate.stops.findIndex((entry) => entry.id === NEW_PICKUP.id);
      const dropAt = candidate.stops.findIndex((entry) => entry.id === NEW_DROP.id);

      expect(pickupAt).toBeGreaterThanOrEqual(0);
      expect(dropAt).toBeGreaterThan(pickupAt);
    }
  });

  it("preserves the existing stop order exactly", () => {
    // Existing stops are commitments already made to real passengers, so no
    // insertion may reshuffle them.
    const existing = existingRoute(4);
    const expectedOrder = existing.map((entry) => entry.id);

    for (const candidate of enumerateInsertions(existing, NEW_PICKUP, NEW_DROP)) {
      const actualOrder = candidate.stops
        .filter((entry) => !entry.isNew)
        .map((entry) => entry.id);

      expect(actualOrder).toEqual(expectedOrder);
      expect(candidate.stops).toHaveLength(existing.length + 2);
    }
  });
});

/*
 * `findBestInsertion` is gone: stage 8 owns all routing now, and the file that
 * held it was deleted in Task 17. Its seven assertions did not vanish with it.
 *
 * Already restored, against the stages that took the behaviour over:
 *
 * - waypoint limit                 → stopSequenceGeneration.test.ts
 * - segment capacity rejection     → stopSequenceGeneration.test.ts
 * - a drop making room for a rider → stopSequenceGeneration.test.ts
 * - the routed-candidate cap       → detourLowerBound.test.ts
 * - an idle driver has no detour   → detourLowerBound.test.ts
 *
 * Still owed, both of them stage 9 material and due in Task 18:
 *
 * - detour reported as the proportional increase over the baseline route
 *   (10 km becoming 11 km is exactly 10%)
 * - a rejected insertion still carries its least-bad attempt, so the map can
 *   draw what was tried
 */
