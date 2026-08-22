import { ANY_VEHICLE, type Passenger } from "@/domain/entities";

import { computeOnboardSeats, computePeakCommittedSeats } from "../occupancy";
import { reason, type MatchReason } from "../reasons";
import { toProposedStops } from "../stops";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 0. The cheapest possible filters — pure lookups, no geometry, no
 * routing.
 *
 * Status, vehicle capability and a conservative seat check were three separate
 * stages before. They are one stage now because the Overview treats them as
 * one, but each keeps its own reason code: "no supply", "supply that cannot
 * carry you" and "supply that is full" call for entirely different product
 * responses, and merging the codes would erase that.
 */
export const basicEligibilityStage: MatchingStage = {
  id: "basicEligibility",
  name: "Basic Eligibility",
  description: "Status, vehicle capability and a conservative seat check. Free.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { scenario } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const failure = firstEligibilityFailure(driverId, context, passengersById);

      if (failure) {
        verdicts.push({ driverId, status: "FAILED", reasons: [failure] });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [reason("CAPACITY_AVAILABLE", "Driver is eligible to be considered")],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function firstEligibilityFailure(
  driverId: string,
  context: MatchingContext,
  passengersById: ReadonlyMap<string, Passenger>,
): MatchReason | undefined {
  const { request } = context;
  const driver = context.getDriver(driverId);

  if (!driver) {
    return reason("VEHICLE_NOT_FOUND", "Driver record missing");
  }

  if (driver.status === "OFFLINE") {
    return reason("DRIVER_OFFLINE", "Driver is offline", {
      value: driver.status,
      threshold: "ONLINE",
    });
  }
  if (driver.status === "PAUSED") {
    return reason("DRIVER_PAUSED", "Driver is paused", {
      value: driver.status,
      threshold: "ONLINE",
    });
  }
  if (driver.status === "BUSY") {
    return reason("DRIVER_BUSY", "Driver is busy", { value: driver.status, threshold: "ONLINE" });
  }

  const vehicle = context.getVehicleForDriver(driverId);

  if (!vehicle) {
    return reason("VEHICLE_NOT_FOUND", "Driver points at a vehicle that does not exist");
  }

  if (request.vehiclePreference !== ANY_VEHICLE && vehicle.label !== request.vehiclePreference) {
    return reason("VEHICLE_TYPE_MISMATCH", "Vehicle type does not match the request preference", {
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
    return reason("VEHICLE_LUGGAGE_EXCEEDED", "Luggage exceeds the vehicle's hold", {
      value: request.luggageCount,
      threshold: vehicle.luggageCapacity,
    });
  }

  const ride = context.getRideForDriver(driverId);
  const committedStops = ride ? toProposedStops(ride.stops, passengersById) : [];
  const onboardSeats = ride ? computeOnboardSeats(ride.passengerIds, passengersById) : 0;
  const peakCommitted = computePeakCommittedSeats(committedStops, onboardSeats);
  const availableSeats = vehicle.totalSeats - peakCommitted;

  context.recordMetrics(driverId, {
    totalSeats: vehicle.totalSeats,
    committedSeats: peakCommitted,
    availableSeats,
  });

  // Conservative on purpose: it asks whether the vehicle is *ever* full, not
  // whether the new rider actually collides with that peak. Stage 5's segment
  // walk is the authoritative answer.
  if (availableSeats < request.seatsRequired) {
    return reason("INSUFFICIENT_CAPACITY", "Vehicle never has enough free seats", {
      value: availableSeats,
      threshold: request.seatsRequired,
    });
  }

  return undefined;
}
