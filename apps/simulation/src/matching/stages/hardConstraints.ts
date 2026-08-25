import type { Passenger } from "@/domain/entities";

import { reason, type MatchReason } from "../reasons";
import { activePassengerIds } from "../stops";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 10. Is this acceptable at all?
 *
 * A route is only acceptable if *everyone* affected stays within their limits.
 * Efficiency for one party never justifies excessive harm to another — that is
 * a product principle, not an optimisation, which is why it lives in a
 * separate binary stage rather than as a penalty term in the score.
 *
 * These checks are kept even though the solver enforced the time windows
 * itself. The solver was never told about the driver's extra-distance cap or
 * our pooling policy, and an independent re-check is what makes the answer
 * trustworthy rather than merely plausible.
 */
export const hardConstraintsStage: MatchingStage = {
  id: "hardConstraints",
  name: "Hard Constraints",
  description: "Binary accept/reject against every configured maximum, plus pooling policy.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { scenario } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const failure =
        firstThresholdBreach(driverId, context) ??
        firstPolicyViolation(driverId, context, passengersById);

      if (failure) {
        verdicts.push({ driverId, status: "FAILED", reasons: [failure] });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [reason("ROUTE_FEASIBLE", "Every party stays within their limits")],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

/** Fixed order, so the reported rejection is deterministic across runs. */
function firstThresholdBreach(
  driverId: string,
  context: MatchingContext,
): MatchReason | undefined {
  const { settings } = context;
  const metrics = context.getMetrics(driverId);
  const corridor = context.getCorridor(driverId);
  const hasExistingRoute = (corridor?.remainingStops.length ?? 0) > 0;
  const isCorridorExtension = (metrics.corridorExtensionKm ?? 0) > 0;
  const distanceCap = isCorridorExtension
    ? settings.maxCorridorExtensionKm
    : settings.maxAdditionalDistanceKm;

  if (hasExistingRoute) {
    if (!isCorridorExtension && (metrics.detourPercent ?? 0) > settings.maxDetourPercent) {
      return reason("ROUTE_DETOUR_TOO_HIGH", "Route detour exceeds the configured maximum", {
        value: metrics.detourPercent,
        threshold: settings.maxDetourPercent,
      });
    }

    if ((metrics.additionalDistanceKm ?? 0) > distanceCap) {
      return reason(
        isCorridorExtension ? "CORRIDOR_EXTENSION_TOO_LONG" : "ADDITIONAL_DISTANCE_TOO_HIGH",
        isCorridorExtension
          ? "Same-direction extension adds too much distance"
          : "Insertion adds too much distance",
        {
          value: metrics.additionalDistanceKm,
          threshold: distanceCap,
        },
      );
    }

    if ((metrics.additionalDurationMin ?? 0) > settings.maxAdditionalDurationMin) {
      return reason("ADDITIONAL_DURATION_TOO_HIGH", "Insertion adds too much travel time", {
        value: metrics.additionalDurationMin,
        threshold: settings.maxAdditionalDurationMin,
      });
    }

    const budgetBreach = firstBudgetBreach(driverId, context);
    if (budgetBreach) {
      return budgetBreach;
    }
  }

  if ((metrics.newPassengerPickupDelayMin ?? 0) > settings.maxNewPassengerPickupDelayMin) {
    return reason(
      "NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH",
      "New passenger waits longer than the configured maximum",
      {
        value: metrics.newPassengerPickupDelayMin,
        threshold: settings.maxNewPassengerPickupDelayMin,
      },
    );
  }

  if ((metrics.newPassengerRideDetourMin ?? 0) > settings.maxNewPassengerRideDetourMin) {
    return reason(
      "NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH",
      "New passenger's own journey is stretched too far by sharing",
      {
        value: metrics.newPassengerRideDetourMin,
        threshold: settings.maxNewPassengerRideDetourMin,
      },
    );
  }

  return undefined;
}

/**
 * Each committed passenger against their *own* tolerance first, then the
 * global ceiling.
 *
 * The per-passenger budget is the promise we actually made; the global setting
 * is a backstop for scenarios that never set one. Checking the personal budget
 * first means the rejection names the real constraint.
 */
function firstBudgetBreach(driverId: string, context: MatchingContext): MatchReason | undefined {
  const solution = context.getSolution(driverId);
  const budgets = context.getDelayBudgets(driverId);

  if (!solution) {
    return undefined;
  }

  for (const budget of budgets) {
    const after = solution.arrivalByStopId.get(budget.stopId);
    if (after === undefined) {
      continue;
    }

    const delayMin = after - budget.originalEtaMin;

    if (delayMin > budget.budgetMin) {
      return reason(
        "EXISTING_PASSENGER_DELAY_TOO_HIGH",
        `Passenger ${budget.passengerId} would be ${delayMin.toFixed(1)} min later than promised`,
        { value: round(delayMin, 2), threshold: budget.budgetMin },
      );
    }
  }

  const worst = context.getMetrics(driverId).maximumExistingPassengerDelayMin ?? 0;

  if (worst > context.settings.maxExistingPassengerDelayMin) {
    return reason(
      "EXISTING_PASSENGER_DELAY_TOO_HIGH",
      "An existing passenger would arrive too much later than promised",
      { value: worst, threshold: context.settings.maxExistingPassengerDelayMin },
    );
  }

  return undefined;
}

/**
 * Business policy, not physics.
 *
 * Kept as its own function with its own reason codes so the dashboard can
 * still tell "the car cannot fit them" from "our rules forbid this pool" —
 * two findings that call for completely different product responses.
 */
function firstPolicyViolation(
  driverId: string,
  context: MatchingContext,
  passengersById: ReadonlyMap<string, Passenger>,
): MatchReason | undefined {
  const { request, settings } = context;
  const vehicle = context.getVehicleForDriver(driverId);
  const ride = context.getRideForDriver(driverId);

  if (!vehicle) {
    return undefined;
  }

  const existing = ride ? activePassengerIds(ride.passengerIds, passengersById) : [];
  const pooledCount = existing.length + 1;

  context.recordMetrics(driverId, {
    existingPassengerCount: existing.length,
    pooledPassengerCount: pooledCount,
  });

  // A solo ride is not a pool. A vehicle with pooling switched off can still
  // carry one passenger perfectly well.
  if (existing.length === 0) {
    return undefined;
  }

  if (!vehicle.poolingEnabled) {
    return reason("POOLING_NOT_SUPPORTED", "Vehicle is not configured for pooling", {
      value: "false",
      threshold: "true",
    });
  }

  if (!request.poolingAllowed) {
    return reason(
      "POOLING_NOT_ALLOWED_BY_REQUEST",
      "The request refuses pooling but this driver already carries passengers",
      { value: existing.length, threshold: 0 },
    );
  }

  for (const passengerId of existing) {
    const passenger = passengersById.get(passengerId);
    if (passenger && !passenger.allowsPooling) {
      return reason(
        "POOLING_NOT_ALLOWED_BY_EXISTING_RIDER",
        `Existing passenger ${passenger.name} declined to share this ride`,
        { value: passenger.id },
      );
    }
  }

  if (pooledCount > settings.maxPooledPassengers) {
    return reason(
      "MAX_POOLED_PASSENGERS_EXCEEDED",
      "Pool would exceed the maximum number of shared passengers",
      { value: pooledCount, threshold: settings.maxPooledPassengers },
    );
  }

  return undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
