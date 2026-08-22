import { ANY_VEHICLE } from "@/domain/entities";

import { reason, type MatchReason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 3. Physical vehicle compatibility.
 *
 * Deliberately excludes pooling capability: whether a pool is *permitted* is a
 * business rule and belongs to stage 7, so that "this vehicle physically
 * cannot serve you" and "policy forbids this pool" stay separately countable
 * in the rejection dashboard.
 */
export const vehicleFilterStage: MatchingStage = {
  id: "vehicleFilter",
  name: "Vehicle Compatibility",
  description: "Matches vehicle type, accessibility and luggage capacity against the request.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const vehicle = context.getVehicleForDriver(driverId);

      if (!vehicle) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason("VEHICLE_NOT_FOUND", "Driver references a vehicle that is not in the scenario"),
          ],
        });
        continue;
      }

      const failure = firstIncompatibility(context, vehicle);

      if (failure) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [failure],
          metrics: { vehicle: vehicle.label, totalSeats: vehicle.totalSeats },
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("VEHICLE_COMPATIBLE", `${vehicle.label} satisfies the request`, {
            value: vehicle.label,
            threshold: request.vehiclePreference,
          }),
        ],
        metrics: { vehicle: vehicle.label, totalSeats: vehicle.totalSeats },
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function firstIncompatibility(
  context: MatchingContext,
  vehicle: { label: string; wheelchairAccessible: boolean; luggageCapacity: number },
): MatchReason | undefined {
  const { request } = context;

  if (request.vehiclePreference !== ANY_VEHICLE && vehicle.label !== request.vehiclePreference) {
    return reason("VEHICLE_TYPE_MISMATCH", "Vehicle type does not satisfy the request preference", {
      value: vehicle.label,
      threshold: request.vehiclePreference,
    });
  }

  if (request.requiresWheelchairAccess && !vehicle.wheelchairAccessible) {
    return reason("VEHICLE_ACCESSIBILITY_MISMATCH", "Vehicle is not wheelchair accessible", {
      value: "false",
      threshold: "true",
    });
  }

  if (request.luggageCount > vehicle.luggageCapacity) {
    return reason("VEHICLE_LUGGAGE_EXCEEDED", "Luggage exceeds the vehicle's capacity", {
      value: request.luggageCount,
      threshold: vehicle.luggageCapacity,
    });
  }

  return undefined;
}
