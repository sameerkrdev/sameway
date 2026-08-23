import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/domain/settings";
import { enumerateInsertions } from "@/matching/insertion";
import { findBestInsertion } from "@/matching/routeInsertion";
import type { ProposedStop } from "@/matching/types";
import { MockRoutingEngine } from "@/routing/MockRoutingEngine";

import { ScriptedRoutingEngine } from "./fixtures/stubRouting";

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

describe("findBestInsertion", () => {
  const baseInput = {
    driverLocation: { lat: 28.63, lng: 77.21 },
    onboardSeats: 0,
    totalSeats: 4,
    newPickup: NEW_PICKUP,
    newDrop: NEW_DROP,
    settings: DEFAULT_SETTINGS,
  };

  it("computes detour as the proportional increase over the baseline route", () => {
    // 10 km baseline becoming 11 km is exactly 10%.
    const routing = new ScriptedRoutingEngine((waypointCount) =>
      waypointCount === 2
        ? { distanceKm: 10, durationMin: 20 }
        : { distanceKm: 11, durationMin: 22 },
    );

    return findBestInsertion({
      ...baseInput,
      existingStops: [stop("d0", "DROP", "P0")],
      onboardSeats: 1,
      routing,
    }).then((result) => {
      expect(result.originalDistanceKm).toBe(10);
      expect(result.newDistanceKm).toBe(11);
      expect(result.additionalDistanceKm).toBeCloseTo(1, 10);
      expect(result.detourPercentage).toBeCloseTo(10, 10);
      expect(result.feasible).toBe(true);
    });
  });

  it("rejects a route that needs more waypoints than the provider accepts", async () => {
    const result = await findBestInsertion({
      ...baseInput,
      // 25 existing stops plus two new ones is 26 intermediates, one over.
      existingStops: Array.from({ length: 25 }, (_, index) =>
        stop(`s${index}`, "DROP", `P${index}`),
      ),
      totalSeats: 40,
      onboardSeats: 30,
      routing: new MockRoutingEngine(),
    });

    expect(result.feasible).toBe(false);
    expect(result.rejectionReason?.code).toBe("WAYPOINT_LIMIT_EXCEEDED");
    expect(result.rejectionReason?.value).toBe(26);
    expect(result.rejectionReason?.threshold).toBe(25);
  });

  it("rejects when no insertion position keeps the vehicle within capacity", async () => {
    // A full vehicle with nobody getting out has no room anywhere in the route.
    const result = await findBestInsertion({
      ...baseInput,
      existingStops: [],
      onboardSeats: 4,
      totalSeats: 4,
      routing: new MockRoutingEngine(),
    });

    expect(result.feasible).toBe(false);
    expect(result.rejectionReason?.code).toBe("SEGMENT_CAPACITY_EXCEEDED");
    // Rejected before anything was billed.
    expect(result.attemptStats.routed).toBe(0);
  });

  it("uses an existing rider's drop to make room instead of rejecting outright", async () => {
    // The vehicle is full right now, so the new pickup only fits *after* the
    // existing passenger gets out. This is the whole reason capacity is
    // evaluated per segment rather than as a single seat count.
    const routing = new ScriptedRoutingEngine((waypointCount) =>
      waypointCount === 2
        ? { distanceKm: 10, durationMin: 20 }
        : { distanceKm: 11, durationMin: 22 },
    );

    const result = await findBestInsertion({
      ...baseInput,
      existingStops: [stop("d0", "DROP", "P0")],
      onboardSeats: 4,
      totalSeats: 4,
      routing,
    });

    expect(result.feasible).toBe(true);
    expect(result.pickupIndex).toBe(1);
    // The two placements ahead of that drop were discarded for free.
    expect(result.attemptStats.occupancyPruned).toBe(2);
    expect(result.attemptStats.routed).toBe(1);
  });

  it("never routes more candidates than the configured cap", async () => {
    const routing = new ScriptedRoutingEngine(() => ({ distanceKm: 5, durationMin: 10 }));
    const settings = { ...DEFAULT_SETTINGS, maxRoutedInsertionsPerDriver: 3 };

    const result = await findBestInsertion({
      ...baseInput,
      existingStops: existingRoute(4),
      totalSeats: 8,
      settings,
      routing,
    });

    // 8 existing stops enumerate 45 candidates; only three may be billed.
    expect(result.attemptStats.enumerated).toBe(45);
    expect(result.attemptStats.routed).toBeLessThanOrEqual(3);
  });

  it("treats an idle driver as having no detour to make", async () => {
    const result = await findBestInsertion({
      ...baseInput,
      existingStops: [],
      routing: new MockRoutingEngine(),
    });

    expect(result.feasible).toBe(true);
    expect(result.detourPercentage).toBe(0);
    expect(result.originalDistanceKm).toBe(0);
  });

  it("returns the least-bad attempt so a rejection can still be drawn", async () => {
    const routing = new ScriptedRoutingEngine((waypointCount) =>
      waypointCount === 2
        ? { distanceKm: 10, durationMin: 20 }
        : { distanceKm: 30, durationMin: 60 },
    );

    const result = await findBestInsertion({
      ...baseInput,
      existingStops: [stop("d0", "DROP", "P0")],
      onboardSeats: 1,
      routing,
    });

    expect(result.feasible).toBe(false);
    expect(result.rejectionReason?.code).toBe("ROUTE_DETOUR_TOO_HIGH");
    expect(result.bestAttempt).toBeDefined();
    expect(result.insertedRoute).toBeDefined();
  });
});
