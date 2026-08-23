import type { LatLng, Passenger } from "@/domain/entities";
import {
  buildOptimizeToursRequest,
  OptimizerBudgetExceededError,
  OptimizerCredentialsMissingError,
  shipmentIdFor,
  toProposedStopSequence,
  type CommittedStopInput,
} from "@/optimization";
import type { RouteLegResult } from "@/routing/types";

import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  ProposedStop,
  SolvedRoute,
  StageOutcome,
} from "../types";

/**
 * Stage 8. What does the road actually say?
 *
 * Everything before this point was approximation. Geometric proximity lies:
 * a river, a one-way street or a central median turns a 300 m crow-flight
 * pickup into a 2.5 km detour. This is where ground truth enters.
 *
 * One `OptimizeTours` call per driver. Sending every driver as a vehicle in
 * one call would be cheaper, but the solver would then choose the driver —
 * erasing the per-driver rejection reasons this whole tool exists to show, and
 * replacing our fairness scoring with Google's vehicle-cost objective.
 */
export const roadRoutingStage: MatchingStage = {
  id: "roadRouting",
  name: "Road Routing",
  description: "Google OptimizeTours returns the winning sequence and its leg data.",

  async execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario, settings } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    // Shared across every driver: what this trip would cost the new rider
    // alone. It is the reference their own detour is measured against.
    const solo = await context.routing.getRoute([request.pickup, request.drop]);

    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);
      const vehicle = context.getVehicleForDriver(driverId);

      if (!corridor || !vehicle) {
        continue;
      }

      // Keyed by stop id, not by position. The budget list and the remaining
      // stops are built by different filters; if they ever diverge, positional
      // indexing would silently promise one passenger another's ETA.
      const originalEtaByStopId = new Map(
        context.getDelayBudgets(driverId).map((budget) => [budget.stopId, budget.originalEtaMin]),
      );

      const committedStops: CommittedStopInput[] = corridor.remainingStops.map((stop) => ({
        id: stop.id,
        passengerId: stop.passengerId,
        type: stop.type,
        location: stop.location,
        seats: stop.seats,
        originalEtaMin: originalEtaByStopId.get(stop.id) ?? 0,
      }));

      const optimizerRequest = buildOptimizeToursRequest({
        driverId,
        vehicleStart: corridor.polyline[0]!,
        seatCapacity: vehicle.totalSeats,
        committedStops,
        passengersById,
        request,
        newPassengerSoftDeadlineMin: request.maxWaitMinutes,
        softDeadlineCostPerHour: 50,
        timeoutMs: settings.optimizerTimeoutMs,
      });

      let solved;

      try {
        solved = await context.optimizer.optimize(optimizerRequest);
      } catch (error) {
        // A missing credential is not an opinion about this driver — it means
        // the run cannot happen at all. Let it escape.
        if (error instanceof OptimizerCredentialsMissingError) {
          throw error;
        }

        if (error instanceof OptimizerBudgetExceededError) {
          verdicts.push({
            driverId,
            status: "NOT_EVALUATED",
            reasons: [
              reason(
                "OPTIMIZER_BUDGET_EXCEEDED",
                "Optimizer budget for this run was exhausted before this driver was evaluated",
                { threshold: settings.maxOptimizerCallsPerRun },
              ),
            ],
          });
          continue;
        }

        verdicts.push({
          driverId,
          status: "NOT_EVALUATED",
          reasons: [
            reason(
              "OPTIMIZER_CALL_FAILED",
              error instanceof Error ? error.message : "Optimizer call failed",
            ),
          ],
        });
        continue;
      }

      const newShipmentId = shipmentIdFor(request.passengerId);
      const mandatorySkipped = solved.skippedShipmentIds.filter((id) => id !== newShipmentId);

      // The solver was told these shipments could not be dropped. If one comes
      // back skipped, our model is wrong, not the driver.
      if (mandatorySkipped.length > 0) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED",
              `Solver dropped ${String(mandatorySkipped.length)} committed passenger(s), which the model forbids`,
              { value: mandatorySkipped.length, threshold: 0 },
            ),
          ],
        });
        continue;
      }

      if (solved.skippedShipmentIds.includes(newShipmentId)) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "OPTIMIZER_INFEASIBLE",
              "No insertion satisfies this ride's capacity and time-window constraints",
            ),
          ],
        });
        continue;
      }

      if (solved.legs.length !== solved.visits.length) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "ROUTE_LEG_MISMATCH",
              "Solver returned a leg count that does not match the visit sequence",
              { value: solved.legs.length, threshold: solved.visits.length },
            ),
          ],
        });
        continue;
      }

      const stops: ProposedStop[] = toProposedStopSequence(solved, request.passengerId).map(
        (stop) => ({
          ...stop,
          seats: passengersById.get(stop.passengerId)?.seatsRequired ?? 0,
        }),
      );

      const arrivalByStopId = new Map<string, number>();
      solved.visits.forEach((visit, index) => {
        arrivalByStopId.set(stops[index]!.id, visit.arrivalMin);
      });

      const baseline = await computeBaseline(context, driverId, corridor.polyline);

      const solution: SolvedRoute = {
        stops,
        legs: solved.legs,
        arrivalByStopId,
        totalDistanceKm: solved.totalDistanceKm,
        totalDurationMin: solved.totalDurationMin,
        baselineDistanceKm: baseline.distanceKm,
        baselineDurationMin: baseline.durationMin,
        baselineArrivalByStopId: baseline.arrivalByStopId,
        soloDurationMin: solo.durationMin,
      };

      context.setSolution(driverId, solution);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("OPTIMIZER_SOLVED", `Solved a ${String(stops.length)}-stop sequence`, {
            value: stops.length,
          }),
        ],
      });
    }

    return { verdicts };
  },
};

/**
 * The driver's pre-insertion route, from the Routes API rather than the
 * optimizer.
 *
 * There is nothing to optimise about a route that is already decided, and
 * `OptimizeTours` bills per shipment — so paying solver pricing for a pure
 * measurement would be waste. The routing cache also means an unchanged
 * baseline is billed once across many runs.
 */
async function computeBaseline(
  context: MatchingContext,
  driverId: string,
  polyline: readonly LatLng[],
): Promise<{
  distanceKm: number;
  durationMin: number;
  arrivalByStopId: Map<string, number>;
}> {
  const corridor = context.getCorridor(driverId);
  const arrivalByStopId = new Map<string, number>();

  if (!corridor || corridor.remainingStops.length === 0) {
    return { distanceKm: 0, durationMin: 0, arrivalByStopId };
  }

  const route = await context.routing.getRoute(polyline);
  let cumulative = 0;

  corridor.remainingStops.forEach((stop, index) => {
    const leg: RouteLegResult | undefined = route.legs[index];
    if (leg) {
      cumulative += leg.durationMin;
      arrivalByStopId.set(stop.id, cumulative);
    }
  });

  return {
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    arrivalByStopId,
  };
}
