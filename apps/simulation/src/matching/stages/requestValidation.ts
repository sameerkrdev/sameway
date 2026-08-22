import { ANY_VEHICLE } from "@/domain/entities";
import { sameLocation } from "@/lib/geo";

import { reason, type MatchReason } from "../reasons";
import type { MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 0. Judges the request itself, before any driver is considered.
 *
 * A failure here aborts the run: it is pointless to report that forty drivers
 * were rejected when the request was never answerable.
 */
export const requestValidationStage: MatchingStage = {
  id: "requestValidation",
  name: "Request Validation",
  description: "Rejects malformed requests before any driver is evaluated.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario, settings } = context;
    const rejection = validate(context);

    void scenario;
    void settings;

    return Promise.resolve({
      verdicts: [],
      notes: {
        requestId: request.id,
        seatsRequired: request.seatsRequired,
        poolingAllowed: request.poolingAllowed,
        vehiclePreference: request.vehiclePreference,
      },
      ...(rejection ? { requestRejection: rejection } : {}),
    });
  },
};

function validate(context: MatchingContext): MatchReason | undefined {
  const { request, scenario } = context;

  if (!Number.isFinite(request.pickup.lat) || !Number.isFinite(request.pickup.lng)) {
    return reason("REQUEST_PICKUP_MISSING", "The request has no valid pickup location");
  }

  if (!Number.isFinite(request.drop.lat) || !Number.isFinite(request.drop.lng)) {
    return reason("REQUEST_DROP_MISSING", "The request has no valid drop location");
  }

  if (sameLocation(request.pickup, request.drop)) {
    return reason("REQUEST_PICKUP_EQUALS_DROP", "Pickup and drop are the same location");
  }

  if (!Number.isInteger(request.seatsRequired) || request.seatsRequired < 1) {
    return reason("REQUEST_SEATS_INVALID", "Seats required must be a positive whole number", {
      value: request.seatsRequired,
      threshold: 1,
    });
  }

  const passengerExists = scenario.passengers.some(
    (passenger) => passenger.id === request.passengerId,
  );
  if (!passengerExists) {
    return reason("REQUEST_PASSENGER_UNKNOWN", "The request references an unknown passenger", {
      value: request.passengerId,
    });
  }

  if (request.vehiclePreference !== ANY_VEHICLE) {
    const known = scenario.vehicles.some(
      (vehicle) => vehicle.label === request.vehiclePreference,
    );
    if (!known) {
      return reason(
        "REQUEST_VEHICLE_PREFERENCE_UNKNOWN",
        "No vehicle in the scenario matches the requested type",
        { value: request.vehiclePreference },
      );
    }
  }

  if (request.maxWaitMinutes < 0) {
    return reason("REQUEST_THRESHOLD_INVALID", "Maximum wait time cannot be negative", {
      value: request.maxWaitMinutes,
      threshold: 0,
    });
  }

  if (request.maxDetourPercent < 0) {
    return reason("REQUEST_THRESHOLD_INVALID", "Maximum detour cannot be negative", {
      value: request.maxDetourPercent,
      threshold: 0,
    });
  }

  return undefined;
}
