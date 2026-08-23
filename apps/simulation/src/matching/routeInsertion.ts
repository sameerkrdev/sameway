import type { LatLng, MatchingSettings } from "@/domain/entities";
import { MAX_INTERMEDIATE_WAYPOINTS } from "@/domain/settings";
import { pathLengthKm } from "@/lib/geo";
import { RoutingBudgetExceededError, type RouteResult, type RoutingEngine } from "@/routing/types";

import { buildArrivalTimeline, computeExistingPassengerDelays } from "./delays";
import { enumerateInsertions } from "./insertion";
import { computeSegmentOccupancy } from "./occupancy";
import { reason, type MatchReason } from "./reasons";
import type {
  InsertionAttemptStats,
  PassengerDelay,
  ProposedStop,
  RouteInsertionCandidate,
  RouteInsertionResult,
  SegmentOccupancy,
} from "./types";

export interface RouteInsertionInput {
  driverLocation: LatLng;
  /** The driver's committed stops, in execution order. Never reordered. */
  existingStops: readonly ProposedStop[];
  onboardSeats: number;
  totalSeats: number;
  newPickup: ProposedStop;
  newDrop: ProposedStop;
  routing: RoutingEngine;
  settings: MatchingSettings;
  /** Direct driver-to-pickup ETA from the stage 5 matrix, when available. */
  directPickupEtaMin?: number;
  /** Direct pickup-to-drop duration, used to measure the new rider's own detour. */
  directPickupToDropDurationMin?: number;
}

interface EvaluatedCandidate {
  candidate: RouteInsertionCandidate;
  route: RouteResult;
  occupancy: SegmentOccupancy[];
  peakOccupancy: number;
  detourPercentage: number;
  additionalDistanceKm: number;
  additionalDurationMin: number;
  newPassengerPickupEtaMin: number;
  newPassengerPickupDelayMin: number;
  newPassengerRideDetourMin: number;
  existingDelays: PassengerDelay[];
  maximumExistingDelayMin: number;
  rejection?: MatchReason;
}

/**
 * Decides whether a new rider can be inserted into a driver's committed route.
 *
 * The question is deliberately narrow: *can this ride be inserted*, not *what
 * is the globally optimal route for everybody*. Existing stops are promises
 * already made to real passengers, so their relative order is frozen and only
 * two new stops are placed around them.
 */
export async function findBestInsertion(
  input: RouteInsertionInput,
): Promise<RouteInsertionResult> {
  const { existingStops, newPickup, newDrop, routing, settings } = input;

  const stats: InsertionAttemptStats = {
    enumerated: 0,
    waypointLimitPruned: 0,
    occupancyPruned: 0,
    geographicallyPruned: 0,
    routed: 0,
    cacheHits: 0,
    feasible: 0,
  };

  const candidates = enumerateInsertions(existingStops, newPickup, newDrop);
  stats.enumerated = candidates.length;

  // Every candidate has the same waypoint count, so this is a route-level gate.
  const intermediateCount = existingStops.length + 2 - 1;
  if (intermediateCount > MAX_INTERMEDIATE_WAYPOINTS) {
    stats.waypointLimitPruned = candidates.length;
    return {
      feasible: false,
      attemptStats: stats,
      rejectionReason: reason(
        "WAYPOINT_LIMIT_EXCEEDED",
        "Route exceeds the maximum number of intermediate waypoints supported by the routing provider",
        { value: intermediateCount, threshold: MAX_INTERMEDIATE_WAYPOINTS },
      ),
    };
  }

  // Occupancy is free to compute, so it runs before anything is routed. On a
  // busy vehicle it removes most candidates for zero cost.
  const capacityFeasible: RouteInsertionCandidate[] = [];
  let lastOverflow: MatchReason | undefined;

  for (const candidate of candidates) {
    const result = computeSegmentOccupancy(candidate.stops, input.onboardSeats, input.totalSeats);

    if (result.overflowAtIndex === null) {
      capacityFeasible.push(candidate);
    } else {
      stats.occupancyPruned += 1;
      lastOverflow = reason(
        "SEGMENT_CAPACITY_EXCEEDED",
        `Vehicle would carry ${result.peakOccupancy} passengers on one segment`,
        { value: result.peakOccupancy, threshold: input.totalSeats },
      );
    }
  }

  if (capacityFeasible.length === 0) {
    return {
      feasible: false,
      attemptStats: stats,
      rejectionReason:
        lastOverflow ??
        reason("SEGMENT_CAPACITY_EXCEEDED", "No insertion position keeps the vehicle within capacity", {
          threshold: input.totalSeats,
        }),
    };
  }

  // Cheap straight-line pruning keeps the number of billed route calls bounded
  // regardless of how many stops the driver already has.
  const shortlisted = pruneGeographically(
    capacityFeasible,
    input.driverLocation,
    existingStops,
    settings.maxRoutedInsertionsPerDriver,
  );
  stats.geographicallyPruned = capacityFeasible.length - shortlisted.length;

  const hasExistingRoute = existingStops.length > 0;

  try {
    const baseline = hasExistingRoute
      ? await routing.getRoute([input.driverLocation, ...existingStops.map((stop) => stop.location)])
      : null;

    const arrivalsBefore = baseline
      ? buildArrivalTimeline(existingStops, baseline.legs)
      : new Map<string, number>();

    if (baseline && !arrivalsBefore) {
      return {
        feasible: false,
        attemptStats: stats,
        rejectionReason: reason(
          "ROUTE_LEG_MISMATCH",
          "Routing provider returned a leg count that does not match the stop sequence",
          { value: baseline.legs.length, threshold: existingStops.length },
        ),
      };
    }

    const evaluated: EvaluatedCandidate[] = [];

    for (const candidate of shortlisted) {
      const route = await routing.getRoute([
        input.driverLocation,
        ...candidate.stops.map((stop) => stop.location),
      ]);
      stats.routed += 1;

      const arrivalsAfter = buildArrivalTimeline(candidate.stops, route.legs);
      if (!arrivalsAfter) {
        continue;
      }

      const evaluation = evaluateCandidate({
        input,
        candidate,
        route,
        baseline,
        arrivalsBefore: arrivalsBefore ?? new Map<string, number>(),
        arrivalsAfter,
        hasExistingRoute,
      });

      evaluated.push(evaluation);

      if (!evaluation.rejection) {
        stats.feasible += 1;
      }
    }

    if (evaluated.length === 0) {
      return {
        feasible: false,
        attemptStats: stats,
        rejectionReason: reason(
          "ROUTE_NO_FEASIBLE_INSERTION",
          "No insertion candidate could be evaluated for this driver",
        ),
      };
    }

    const feasible = evaluated.filter((entry) => !entry.rejection);
    const winner = pickLowestDetour(feasible);

    if (winner) {
      return buildResult(winner, baseline, stats, true);
    }

    // Nothing worked, but the least-bad attempt is still worth returning so the
    // map can show what was tried and exactly which threshold broke it.
    const leastBad = pickLowestDetour(evaluated);
    return leastBad
      ? buildResult(leastBad, baseline, stats, false)
      : {
          feasible: false,
          attemptStats: stats,
          rejectionReason: reason("ROUTE_NO_FEASIBLE_INSERTION", "No feasible insertion found"),
        };
  } catch (error) {
    if (error instanceof RoutingBudgetExceededError) {
      return {
        feasible: false,
        attemptStats: stats,
        rejectionReason: reason(
          "ROUTING_BUDGET_EXCEEDED",
          "Routing call budget for this run was exhausted before this driver could be evaluated",
          { threshold: settings.maxRoutingCallsPerRun },
        ),
      };
    }

    return {
      feasible: false,
      attemptStats: stats,
      rejectionReason: reason(
        "ROUTING_FAILED",
        error instanceof Error ? error.message : "Routing call failed",
      ),
    };
  }
}

function pruneGeographically(
  candidates: readonly RouteInsertionCandidate[],
  driverLocation: LatLng,
  existingStops: readonly ProposedStop[],
  keep: number,
): RouteInsertionCandidate[] {
  if (candidates.length <= keep) {
    return [...candidates];
  }

  const baselineKm = pathLengthKm([driverLocation, ...existingStops.map((stop) => stop.location)]);

  const scored = candidates.map((candidate) => ({
    candidate,
    deltaKm:
      pathLengthKm([driverLocation, ...candidate.stops.map((stop) => stop.location)]) - baselineKm,
  }));

  scored.sort((a, b) => a.deltaKm - b.deltaKm);

  return scored.slice(0, keep).map((entry) => entry.candidate);
}

function evaluateCandidate(args: {
  input: RouteInsertionInput;
  candidate: RouteInsertionCandidate;
  route: RouteResult;
  baseline: RouteResult | null;
  arrivalsBefore: ReadonlyMap<string, number>;
  arrivalsAfter: ReadonlyMap<string, number>;
  hasExistingRoute: boolean;
}): EvaluatedCandidate {
  const { input, candidate, route, baseline, arrivalsBefore, arrivalsAfter, hasExistingRoute } =
    args;
  const { settings, existingStops, newPickup, newDrop } = input;

  const occupancyResult = computeSegmentOccupancy(
    candidate.stops,
    input.onboardSeats,
    input.totalSeats,
  );

  const originalDistanceKm = baseline?.distanceKm ?? 0;
  const originalDurationMin = baseline?.durationMin ?? 0;
  const additionalDistanceKm = route.distanceKm - originalDistanceKm;
  const additionalDurationMin = route.durationMin - originalDurationMin;

  // With no committed route there is nothing to detour from: the driver is
  // dedicated to this rider, so pooling constraints simply do not apply.
  const detourPercentage = hasExistingRoute
    ? (additionalDistanceKm / originalDistanceKm) * 100
    : 0;

  const newPassengerPickupEtaMin = arrivalsAfter.get(newPickup.id) ?? 0;
  const newPassengerDropEtaMin = arrivalsAfter.get(newDrop.id) ?? 0;
  const newPassengerPickupDelayMin =
    input.directPickupEtaMin === undefined
      ? 0
      : newPassengerPickupEtaMin - input.directPickupEtaMin;
  const newPassengerRideDetourMin =
    input.directPickupToDropDurationMin === undefined
      ? 0
      : newPassengerDropEtaMin - newPassengerPickupEtaMin - input.directPickupToDropDurationMin;

  const { delays, maximumDelayMin } = computeExistingPassengerDelays(
    existingStops,
    arrivalsBefore,
    arrivalsAfter,
  );

  return {
    candidate,
    route,
    occupancy: occupancyResult.segments,
    peakOccupancy: occupancyResult.peakOccupancy,
    detourPercentage,
    additionalDistanceKm,
    additionalDurationMin,
    newPassengerPickupEtaMin,
    newPassengerPickupDelayMin,
    newPassengerRideDetourMin,
    existingDelays: delays,
    maximumExistingDelayMin: maximumDelayMin,
    ...(() => {
      const rejection = firstViolatedThreshold({
        hasExistingRoute,
        settings,
        detourPercentage,
        additionalDistanceKm,
        additionalDurationMin,
        newPassengerPickupDelayMin,
        maximumExistingDelayMin: maximumDelayMin,
      });
      return rejection ? { rejection } : {};
    })(),
  };
}

/**
 * Thresholds are checked in a fixed order so the reported rejection reason is
 * deterministic across runs rather than depending on evaluation order.
 */
function firstViolatedThreshold(args: {
  hasExistingRoute: boolean;
  settings: MatchingSettings;
  detourPercentage: number;
  additionalDistanceKm: number;
  additionalDurationMin: number;
  newPassengerPickupDelayMin: number;
  maximumExistingDelayMin: number;
}): MatchReason | undefined {
  const { settings, hasExistingRoute } = args;

  if (hasExistingRoute) {
    if (args.detourPercentage > settings.maxDetourPercent) {
      return reason("ROUTE_DETOUR_TOO_HIGH", "Route detour exceeds the configured maximum", {
        value: round(args.detourPercentage, 2),
        threshold: settings.maxDetourPercent,
      });
    }

    if (args.additionalDistanceKm > settings.maxAdditionalDistanceKm) {
      return reason("ADDITIONAL_DISTANCE_TOO_HIGH", "Insertion adds too much distance", {
        value: round(args.additionalDistanceKm, 2),
        threshold: settings.maxAdditionalDistanceKm,
      });
    }

    if (args.additionalDurationMin > settings.maxAdditionalDurationMin) {
      return reason("ADDITIONAL_DURATION_TOO_HIGH", "Insertion adds too much travel time", {
        value: round(args.additionalDurationMin, 2),
        threshold: settings.maxAdditionalDurationMin,
      });
    }
  }

  if (args.newPassengerPickupDelayMin > settings.maxNewPassengerPickupDelayMin) {
    return reason(
      "NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH",
      "New passenger waits too long compared with a dedicated pickup",
      {
        value: round(args.newPassengerPickupDelayMin, 2),
        threshold: settings.maxNewPassengerPickupDelayMin,
      },
    );
  }

  if (hasExistingRoute && args.maximumExistingDelayMin > settings.maxExistingPassengerDelayMin) {
    return reason(
      "EXISTING_PASSENGER_DELAY_TOO_HIGH",
      "An existing passenger would arrive too much later than promised",
      {
        value: round(args.maximumExistingDelayMin, 2),
        threshold: settings.maxExistingPassengerDelayMin,
      },
    );
  }

  return undefined;
}

function pickLowestDetour(entries: readonly EvaluatedCandidate[]): EvaluatedCandidate | undefined {
  let best: EvaluatedCandidate | undefined;

  for (const entry of entries) {
    if (!best || entry.detourPercentage < best.detourPercentage) {
      best = entry;
    }
  }

  return best;
}

function buildResult(
  entry: EvaluatedCandidate,
  baseline: RouteResult | null,
  stats: InsertionAttemptStats,
  feasible: boolean,
): RouteInsertionResult {
  return {
    feasible,
    insertedRoute: entry.candidate.stops,
    pickupIndex: entry.candidate.pickupIndex,
    dropIndex: entry.candidate.dropIndex,
    originalDistanceKm: baseline?.distanceKm ?? 0,
    newDistanceKm: entry.route.distanceKm,
    additionalDistanceKm: entry.additionalDistanceKm,
    detourPercentage: entry.detourPercentage,
    originalDurationMin: baseline?.durationMin ?? 0,
    newDurationMin: entry.route.durationMin,
    additionalDurationMin: entry.additionalDurationMin,
    newPassengerPickupEtaMin: entry.newPassengerPickupEtaMin,
    newPassengerPickupDelayMin: entry.newPassengerPickupDelayMin,
    newPassengerRideDetourMin: entry.newPassengerRideDetourMin,
    existingPassengerDelays: entry.existingDelays,
    maximumExistingPassengerDelayMin: entry.maximumExistingDelayMin,
    occupancyBySegment: entry.occupancy,
    ...(entry.route.path ? { path: entry.route.path } : {}),
    ...(baseline?.path ? { originalPath: baseline.path } : {}),
    bestAttempt: entry.candidate,
    attemptStats: stats,
    ...(entry.rejection ? { rejectionReason: entry.rejection } : {}),
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
