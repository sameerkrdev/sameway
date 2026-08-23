import { computeExistingPassengerDelays, computeExistingPickupDelays } from "../delays";
import { computeSegmentOccupancy } from "../occupancy";
import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionResult,
  StageOutcome,
} from "../types";

/**
 * Stage 9. Who gains, who loses, and by how much?
 *
 * This is the heart of fairness accounting. A route can look efficient in
 * total distance while badly hurting one specific passenger, and only a
 * per-person comparison against each party's own baseline exposes that.
 *
 * Nothing is rejected here. Measuring and judging are separate stages on
 * purpose: stage 10 does the judging, and keeping them apart is what lets the
 * UI show a driver's full impact profile even when they were rejected.
 */
export const incrementalCostStage: MatchingStage = {
  id: "incrementalCost",
  name: "Incremental Cost",
  description: "Measures what every party gains or loses. Rejects nothing.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const solution = context.getSolution(driverId);
      const corridor = context.getCorridor(driverId);
      const vehicle = context.getVehicleForDriver(driverId);

      if (!solution || !corridor || !vehicle) {
        continue;
      }

      const hasExistingRoute = corridor.remainingStops.length > 0;

      const additionalDistanceKm = solution.totalDistanceKm - solution.baselineDistanceKm;
      const additionalDurationMin = solution.totalDurationMin - solution.baselineDurationMin;

      // With no committed route there is nothing to detour from: the driver is
      // dedicated to this rider, so a detour percentage would be meaningless.
      const detourPercent = hasExistingRoute
        ? (additionalDistanceKm / solution.baselineDistanceKm) * 100
        : 0;

      const newPickupId = solution.stops.find((stop) => stop.isNew && stop.type === "PICKUP")?.id;
      const newDropId = solution.stops.find((stop) => stop.isNew && stop.type === "DROP")?.id;

      const newPassengerPickupEtaMin = newPickupId
        ? (solution.arrivalByStopId.get(newPickupId) ?? 0)
        : 0;
      const newPassengerDropEtaMin = newDropId
        ? (solution.arrivalByStopId.get(newDropId) ?? 0)
        : 0;

      const newPassengerRideDetourMin = Math.max(
        0,
        newPassengerDropEtaMin - newPassengerPickupEtaMin - solution.soloDurationMin,
      );

      const committedStops = solution.stops.filter((stop) => !stop.isNew);

      const { delays, maximumDelayMin } = computeExistingPassengerDelays(
        committedStops,
        solution.baselineArrivalByStopId,
        solution.arrivalByStopId,
      );

      const pickupDelays = computeExistingPickupDelays(
        committedStops,
        solution.baselineArrivalByStopId,
        solution.arrivalByStopId,
      );

      const occupancy = computeSegmentOccupancy(solution.stops, 0, vehicle.totalSeats);

      context.recordMetrics(driverId, {
        originalDistanceKm: round(solution.baselineDistanceKm, 3),
        newDistanceKm: round(solution.totalDistanceKm, 3),
        additionalDistanceKm: round(additionalDistanceKm, 3),
        detourPercent: round(detourPercent, 2),
        originalDurationMin: round(solution.baselineDurationMin, 2),
        newDurationMin: round(solution.totalDurationMin, 2),
        additionalDurationMin: round(additionalDurationMin, 2),
        newPassengerPickupEtaMin: round(newPassengerPickupEtaMin, 2),
        // The new rider waits from now; there is no earlier promise to
        // compare against, so their "delay" is simply their wait.
        newPassengerPickupDelayMin: round(newPassengerPickupEtaMin, 2),
        newPassengerRideDetourMin: round(newPassengerRideDetourMin, 2),
        maximumExistingPassengerDelayMin: round(maximumDelayMin, 2),
        peakOccupancy: occupancy.peakOccupancy,
        roadDistanceKm: round(solution.totalDistanceKm, 3),
        roadEtaMin: round(newPassengerPickupEtaMin, 2),
      });

      const metrics = context.getMetrics(driverId);

      const insertion: RouteInsertionResult = {
        feasible: true,
        insertedRoute: solution.stops,
        originalDistanceKm: solution.baselineDistanceKm,
        newDistanceKm: solution.totalDistanceKm,
        additionalDistanceKm,
        detourPercentage: detourPercent,
        originalDurationMin: solution.baselineDurationMin,
        newDurationMin: solution.totalDurationMin,
        additionalDurationMin,
        newPassengerPickupEtaMin,
        newPassengerPickupDelayMin: newPassengerPickupEtaMin,
        newPassengerRideDetourMin,
        existingPassengerDelays: [...delays, ...pickupDelays],
        maximumExistingPassengerDelayMin: maximumDelayMin,
        occupancyBySegment: occupancy.segments,
        attemptStats: {
          enumerated: metrics.enumeratedSequences ?? 0,
          waypointLimitPruned: 0,
          occupancyPruned:
            (metrics.enumeratedSequences ?? 0) - (metrics.capacityFeasibleSequences ?? 0),
          geographicallyPruned:
            (metrics.capacityFeasibleSequences ?? 0) - (metrics.shortlistedSequences ?? 0),
          routed: 1,
          cacheHits: 0,
          feasible: 1,
        },
      };

      context.recordInsertion(driverId, insertion);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("COST_MEASURED", "Impact measured for every affected party", {
            value: round(detourPercent, 2),
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
