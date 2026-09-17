import type { RouteLegResult } from "@/routing/types";

import type { PassengerDelay, ProposedStop } from "./types";

/**
 * Cumulative arrival time, in minutes from the driver's current position, at
 * each stop.
 *
 * Waypoints are `[driverLocation, ...stops]`, so a well-formed route returns
 * exactly one leg per stop. A mismatch means the routing provider collapsed or
 * merged waypoints (coincident stops can cause this) and the leg-to-stop
 * mapping can no longer be trusted, so callers must fail rather than
 * mis-attribute durations to the wrong passenger.
 */
export function buildArrivalTimeline(
  stops: readonly ProposedStop[],
  legs: readonly RouteLegResult[],
): Map<string, number> | null {
  if (legs.length !== stops.length) {
    return null;
  }

  const arrivals = new Map<string, number>();
  let cumulative = 0;

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const leg = legs[index];
    if (!stop || !leg) {
      return null;
    }

    cumulative += leg.durationMin;
    arrivals.set(stop.id, cumulative);
  }

  return arrivals;
}

export interface ExistingDelaysResult {
  delays: PassengerDelay[];
  maximumDelayMin: number;
}

/**
 * How much later each existing passenger reaches their destination.
 *
 * This is the constraint aggregate detour structurally cannot see: a route can
 * be only 8% longer overall while pushing one rider fifteen minutes late.
 * Pickup delays for waiting passengers are computed too, but only drop delay
 * is thresholded by default.
 */
export function computeExistingPassengerDelays(
  existingStops: readonly ProposedStop[],
  arrivalsBefore: ReadonlyMap<string, number>,
  arrivalsAfter: ReadonlyMap<string, number>,
): ExistingDelaysResult {
  const delays: PassengerDelay[] = [];
  let maximumDelayMin = 0;

  for (const stop of existingStops) {
    if (stop.type !== "DROP") {
      continue;
    }

    const before = arrivalsBefore.get(stop.id);
    const after = arrivalsAfter.get(stop.id);

    if (before === undefined || after === undefined) {
      continue;
    }

    const delayMin = after - before;
    delays.push({
      passengerId: stop.passengerId,
      stopId: stop.id,
      arrivalBeforeMin: before,
      arrivalAfterMin: after,
      delayMin,
    });

    maximumDelayMin = Math.max(maximumDelayMin, delayMin);
  }

  return { delays, maximumDelayMin };
}

/** Pickup-side delays, surfaced for inspection but not thresholded by default. */
export function computeExistingPickupDelays(
  existingStops: readonly ProposedStop[],
  arrivalsBefore: ReadonlyMap<string, number>,
  arrivalsAfter: ReadonlyMap<string, number>,
): PassengerDelay[] {
  const delays: PassengerDelay[] = [];

  for (const stop of existingStops) {
    if (stop.type !== "PICKUP") {
      continue;
    }

    const before = arrivalsBefore.get(stop.id);
    const after = arrivalsAfter.get(stop.id);

    if (before === undefined || after === undefined) {
      continue;
    }

    delays.push({
      passengerId: stop.passengerId,
      stopId: stop.id,
      arrivalBeforeMin: before,
      arrivalAfterMin: after,
      delayMin: after - before,
    });
  }

  return delays;
}
