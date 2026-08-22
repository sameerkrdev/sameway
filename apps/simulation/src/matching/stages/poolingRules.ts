import type { Passenger } from "@/domain/entities";

import { reason, type MatchReason } from "../reasons";
import { activePassengerIds } from "../stops";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 7. Business policy, not physics.
 *
 * Everything reaching this stage is already known to be technically feasible.
 * The only question left is whether we are willing to allow it. Keeping this
 * separate from stage 6 is what makes the rejection dashboard useful: "the car
 * cannot fit them" and "our rules forbid this pool" call for entirely
 * different product responses.
 *
 * Costs nothing — no routing, no geometry.
 */
export const poolingRulesStage: MatchingStage = {
  id: "poolingRules",
  name: "Pooling Rules",
  description: "Applies pooling policy to routes that are already technically feasible.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario, settings } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const vehicle = context.getVehicleForDriver(driverId);
      if (!vehicle) {
        continue;
      }

      const ride = context.getRideForDriver(driverId);
      const existing = ride ? activePassengerIds(ride.passengerIds, passengersById) : [];
      const pooledCount = existing.length + 1;

      context.recordMetrics(driverId, {
        existingPassengerCount: existing.length,
        pooledPassengerCount: pooledCount,
      });

      const metrics = {
        existingPassengers: existing.length,
        pooledPassengers: pooledCount,
        vehiclePoolingEnabled: vehicle.poolingEnabled,
        requestAllowsPooling: request.poolingAllowed,
      };

      // A solo ride is not a pool. A vehicle with pooling switched off is still
      // perfectly able to carry one passenger, so none of these rules apply
      // until an actual sharing situation exists.
      if (existing.length === 0) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [
            reason("POOLING_COMPATIBLE", "Solo ride — no pooling rules apply", {
              value: pooledCount,
              threshold: settings.maxPooledPassengers,
            }),
          ],
          metrics,
        });
        continue;
      }

      const failure = firstPolicyViolation({
        context,
        existing,
        passengersById,
        pooledCount,
        vehiclePoolingEnabled: vehicle.poolingEnabled,
      });

      if (failure) {
        verdicts.push({ driverId, status: "FAILED", reasons: [failure], metrics });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("POOLING_COMPATIBLE", `Pool of ${pooledCount} passengers is permitted`, {
            value: pooledCount,
            threshold: settings.maxPooledPassengers,
          }),
        ],
        metrics,
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function firstPolicyViolation(args: {
  context: MatchingContext;
  existing: readonly string[];
  passengersById: ReadonlyMap<string, Passenger>;
  pooledCount: number;
  vehiclePoolingEnabled: boolean;
}): MatchReason | undefined {
  const { context, existing, passengersById, pooledCount, vehiclePoolingEnabled } = args;
  const { request, settings } = context;

  if (!vehiclePoolingEnabled) {
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
