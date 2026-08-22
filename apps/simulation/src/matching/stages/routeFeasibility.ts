import type { Passenger } from "@/domain/entities";
import { RoutingBudgetExceededError } from "@/routing/types";

import { computeOnboardSeats } from "../occupancy";
import { reason } from "../reasons";
import { findBestInsertion } from "../routeInsertion";
import { activePassengerIds, newRiderStops, toProposedStops } from "../stops";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 6. The authoritative feasibility test.
 *
 * Answers a purely technical question: can this rider physically be inserted
 * into the driver's committed route? Ordering, segment occupancy, detour,
 * added distance and duration, and — critically — how much later every
 * existing passenger would arrive. Whether the resulting pool is *allowed* is
 * a separate question, answered by stage 7.
 */
export const routeFeasibilityStage: MatchingStage = {
  id: "routeFeasibility",
  name: "Route Feasibility",
  description: "Tests whether the new rider can be inserted into each driver's committed route.",

  async execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario, settings } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );
    const { pickup: newPickup, drop: newDrop } = newRiderStops(request);

    // One cached call establishes what a direct trip would cost, which is the
    // reference the new rider's own detour is measured against.
    const directPickupToDropDurationMin = await safeDirectDuration(context);

    const verdicts: DriverVerdict[] = [];
    let budgetExhausted = false;
    let totalRouted = 0;
    let totalEnumerated = 0;
    let totalPruned = 0;

    for (const driverId of context.liveDriverIds) {
      const driver = context.getDriver(driverId);
      const vehicle = context.getVehicleForDriver(driverId);

      if (!driver || !vehicle) {
        continue;
      }

      if (budgetExhausted) {
        verdicts.push(budgetVerdict(driverId, settings.maxRoutingCallsPerRun));
        continue;
      }

      const ride = context.getRideForDriver(driverId);
      const existingStops = ride ? toProposedStops(ride.stops, passengersById) : [];
      const onboardSeats = ride ? computeOnboardSeats(ride.passengerIds, passengersById) : 0;
      const metrics = context.getMetrics(driverId);

      const insertion = await findBestInsertion({
        driverLocation: driver.location,
        existingStops,
        onboardSeats,
        totalSeats: vehicle.totalSeats,
        newPickup,
        newDrop,
        routing: context.routing,
        settings,
        ...(metrics.roadEtaMin !== undefined ? { directPickupEtaMin: metrics.roadEtaMin } : {}),
        ...(directPickupToDropDurationMin !== undefined
          ? { directPickupToDropDurationMin }
          : {}),
      });

      context.recordInsertion(driverId, insertion);
      totalEnumerated += insertion.attemptStats.enumerated;
      totalRouted += insertion.attemptStats.routed;
      totalPruned +=
        insertion.attemptStats.occupancyPruned + insertion.attemptStats.geographicallyPruned;

      context.recordMetrics(driverId, {
        ...(insertion.originalDistanceKm !== undefined
          ? { originalDistanceKm: insertion.originalDistanceKm }
          : {}),
        ...(insertion.newDistanceKm !== undefined
          ? { newDistanceKm: insertion.newDistanceKm }
          : {}),
        ...(insertion.additionalDistanceKm !== undefined
          ? { additionalDistanceKm: insertion.additionalDistanceKm }
          : {}),
        ...(insertion.detourPercentage !== undefined
          ? { detourPercent: insertion.detourPercentage }
          : {}),
        ...(insertion.originalDurationMin !== undefined
          ? { originalDurationMin: insertion.originalDurationMin }
          : {}),
        ...(insertion.newDurationMin !== undefined
          ? { newDurationMin: insertion.newDurationMin }
          : {}),
        ...(insertion.additionalDurationMin !== undefined
          ? { additionalDurationMin: insertion.additionalDurationMin }
          : {}),
        ...(insertion.newPassengerPickupEtaMin !== undefined
          ? { newPassengerPickupEtaMin: insertion.newPassengerPickupEtaMin }
          : {}),
        ...(insertion.newPassengerPickupDelayMin !== undefined
          ? { newPassengerPickupDelayMin: insertion.newPassengerPickupDelayMin }
          : {}),
        ...(insertion.newPassengerRideDetourMin !== undefined
          ? { newPassengerRideDetourMin: insertion.newPassengerRideDetourMin }
          : {}),
        ...(insertion.maximumExistingPassengerDelayMin !== undefined
          ? { maximumExistingPassengerDelayMin: insertion.maximumExistingPassengerDelayMin }
          : {}),
        peakOccupancy: peakOf(insertion.occupancyBySegment, onboardSeats),
        existingPassengerCount: ride
          ? activePassengerIds(ride.passengerIds, passengersById).length
          : 0,
      });

      const stageMetrics = {
        enumerated: insertion.attemptStats.enumerated,
        routed: insertion.attemptStats.routed,
        feasibleInsertions: insertion.attemptStats.feasible,
        ...(insertion.detourPercentage !== undefined
          ? { detourPercent: round(insertion.detourPercentage, 2) }
          : {}),
        ...(insertion.maximumExistingPassengerDelayMin !== undefined
          ? { maxExistingDelayMin: round(insertion.maximumExistingPassengerDelayMin, 2) }
          : {}),
      };

      if (insertion.feasible) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [
            reason("ROUTE_FEASIBLE", "New rider fits into the driver's route", {
              value:
                insertion.detourPercentage !== undefined
                  ? round(insertion.detourPercentage, 2)
                  : 0,
              threshold: settings.maxDetourPercent,
            }),
          ],
          metrics: stageMetrics,
        });
        continue;
      }

      const rejection =
        insertion.rejectionReason ??
        reason("ROUTE_NO_FEASIBLE_INSERTION", "No feasible insertion position exists");

      if (rejection.code === "ROUTING_BUDGET_EXCEEDED") {
        budgetExhausted = true;
        verdicts.push(budgetVerdict(driverId, settings.maxRoutingCallsPerRun));
        continue;
      }

      verdicts.push({
        driverId,
        status: "FAILED",
        reasons: [rejection],
        metrics: stageMetrics,
      });
    }

    return {
      verdicts,
      notes: {
        insertionsEnumerated: totalEnumerated,
        insertionsPrunedBeforeRouting: totalPruned,
        insertionsRouted: totalRouted,
        directPickupToDropDurationMin,
        budgetExhausted,
      },
    };
  },
};

function budgetVerdict(driverId: string, limit: number): DriverVerdict {
  return {
    driverId,
    // Not an algorithmic rejection: we ran out of budget before forming an
    // opinion, and saying "route infeasible" here would be a lie.
    status: "NOT_EVALUATED",
    reasons: [
      reason(
        "ROUTING_BUDGET_EXCEEDED",
        "Routing call budget for this run was exhausted before this driver was evaluated",
        { threshold: limit },
      ),
    ],
  };
}

async function safeDirectDuration(context: MatchingContext): Promise<number | undefined> {
  try {
    const route = await context.routing.getRoute([context.request.pickup, context.request.drop]);
    return route.durationMin;
  } catch (error) {
    if (error instanceof RoutingBudgetExceededError) {
      return undefined;
    }
    return undefined;
  }
}

function peakOf(
  segments: { occupancy: number }[] | undefined,
  onboardSeats: number,
): number {
  if (!segments || segments.length === 0) {
    return onboardSeats;
  }
  return segments.reduce((peak, segment) => Math.max(peak, segment.occupancy), onboardSeats);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
