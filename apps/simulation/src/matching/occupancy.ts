import type { Passenger } from "@/domain/entities";
import { ONBOARD_PASSENGER_STATES } from "@/domain/entities";

import type { ProposedStop, SegmentOccupancy } from "./types";

export interface OccupancyResult {
  segments: SegmentOccupancy[];
  peakOccupancy: number;
  /** Index of the first stop after which the vehicle is over capacity. */
  overflowAtIndex: number | null;
}

/**
 * Seats consumed by passengers who are already in the vehicle.
 *
 * These passengers have no pickup stop left in the route, so a walk that
 * started at zero would under-count every segment and wrongly pass a full
 * vehicle. This is the seed term that prevents that.
 */
export function computeOnboardSeats(
  passengerIds: readonly string[],
  passengersById: ReadonlyMap<string, Passenger>,
): number {
  let seats = 0;

  for (const passengerId of passengerIds) {
    const passenger = passengersById.get(passengerId);
    if (passenger && ONBOARD_PASSENGER_STATES.includes(passenger.state)) {
      seats += passenger.seatsRequired;
    }
  }

  return seats;
}

/**
 * Walks the stop sequence accumulating occupancy per segment.
 *
 * Capacity is not `totalSeats - passengerCount`. Occupancy rises and falls
 * along the route, so whether a new rider fits depends on *where* their pickup
 * and drop land, not merely on how many people the vehicle currently carries.
 */
export function computeSegmentOccupancy(
  stops: readonly ProposedStop[],
  onboardSeats: number,
  totalSeats: number,
): OccupancyResult {
  const segments: SegmentOccupancy[] = [];
  let occupancy = onboardSeats;
  let peakOccupancy = onboardSeats;
  let overflowAtIndex: number | null = null;

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    if (!stop) {
      continue;
    }

    occupancy += stop.type === "PICKUP" ? stop.seats : -stop.seats;
    peakOccupancy = Math.max(peakOccupancy, occupancy);

    segments.push({
      stopIndex: index,
      stopId: stop.id,
      stopType: stop.type,
      passengerId: stop.passengerId,
      occupancy,
    });

    if (overflowAtIndex === null && occupancy > totalSeats) {
      overflowAtIndex = index;
    }
  }

  return { segments, peakOccupancy, overflowAtIndex };
}

/**
 * Peak occupancy of the driver's *existing* commitments, used by the cheap
 * stage 4 pre-filter. Conservative on purpose: it asks whether the vehicle is
 * ever full, not whether the new rider would actually collide with that peak.
 */
export function computePeakCommittedSeats(
  stops: readonly ProposedStop[],
  onboardSeats: number,
): number {
  let occupancy = onboardSeats;
  let peak = onboardSeats;

  for (const stop of stops) {
    occupancy += stop.type === "PICKUP" ? stop.seats : -stop.seats;
    peak = Math.max(peak, occupancy);
  }

  return peak;
}
