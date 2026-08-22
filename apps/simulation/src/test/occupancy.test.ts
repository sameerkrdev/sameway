import { describe, expect, it } from "vitest";

import type { Passenger } from "@/domain/entities";
import { DEFAULT_PASSENGER_DELAY_BUDGETS } from "@/domain/settings";
import {
  computeOnboardSeats,
  computePeakCommittedSeats,
  computeSegmentOccupancy,
} from "@/matching/occupancy";
import type { ProposedStop } from "@/matching/types";

function stop(
  id: string,
  type: ProposedStop["type"],
  passengerId: string,
  seats = 1,
): ProposedStop {
  return {
    id,
    passengerId,
    type,
    seats,
    location: { lat: 28.6 + seats / 1000, lng: 77.2 },
    isNew: false,
  };
}

function passenger(id: string, seats: number, state: Passenger["state"]): Passenger {
  return {
    id,
    name: id,
    seatsRequired: seats,
    state,
    specialRequirements: [],
    allowsPooling: true,
    ...DEFAULT_PASSENGER_DELAY_BUDGETS,
  };
}

describe("segment occupancy", () => {
  it("tracks occupancy rising and falling along the route", () => {
    // The pooling case from the brief: A and B board, A leaves, C boards, and
    // so on. Occupancy is a timeline, not a single number.
    const stops = [
      stop("s1", "PICKUP", "A"),
      stop("s2", "PICKUP", "B"),
      stop("s3", "DROP", "A"),
      stop("s4", "PICKUP", "C"),
      stop("s5", "DROP", "B"),
      stop("s6", "DROP", "C"),
    ];

    const result = computeSegmentOccupancy(stops, 0, 6);

    expect(result.segments.map((segment) => segment.occupancy)).toEqual([1, 2, 1, 2, 1, 0]);
    expect(result.peakOccupancy).toBe(2);
    expect(result.overflowAtIndex).toBeNull();
  });

  it("passes when the request fits and fails when it does not", () => {
    const onboard = 3;
    const fits = computeSegmentOccupancy([stop("new_p", "PICKUP", "N", 1)], onboard, 4);
    expect(fits.overflowAtIndex).toBeNull();

    const overflows = computeSegmentOccupancy([stop("new_p", "PICKUP", "N", 2)], onboard, 4);
    expect(overflows.overflowAtIndex).toBe(0);
    expect(overflows.peakOccupancy).toBe(5);
  });

  it("counts passengers already aboard, whose pickups are no longer in the route", () => {
    // Two riders are already in a 4-seat vehicle. Only their drops remain, so a
    // walk starting from zero would see room for four more people.
    const remaining = [stop("dropA", "DROP", "A", 2), stop("dropB", "DROP", "B", 2)];
    const newPickup = stop("new_p", "PICKUP", "N", 2);

    const seeded = computeSegmentOccupancy([newPickup, ...remaining], 4, 4);
    expect(seeded.overflowAtIndex).toBe(0);
    expect(seeded.peakOccupancy).toBe(6);

    const naiveZeroSeeded = computeSegmentOccupancy([newPickup, ...remaining], 0, 4);
    expect(naiveZeroSeeded.overflowAtIndex).toBeNull();
  });

  it("derives the onboard seed from passenger state", () => {
    const passengers = new Map<string, Passenger>([
      ["A", passenger("A", 2, "IN_RIDE")],
      ["B", passenger("B", 1, "PICKED_UP")],
      ["C", passenger("C", 3, "WAITING")],
      ["D", passenger("D", 4, "DROPPED")],
      ["E", passenger("E", 4, "CANCELLED")],
    ]);

    expect(computeOnboardSeats(["A", "B", "C", "D", "E"], passengers)).toBe(3);
  });

  it("reports the peak of committed work for the cheap pre-filter", () => {
    const stops = [
      stop("p1", "PICKUP", "A", 2),
      stop("p2", "PICKUP", "B", 2),
      stop("d1", "DROP", "A", 2),
      stop("d2", "DROP", "B", 2),
    ];

    expect(computePeakCommittedSeats(stops, 0)).toBe(4);
    expect(computePeakCommittedSeats([], 2)).toBe(2);
  });
});
