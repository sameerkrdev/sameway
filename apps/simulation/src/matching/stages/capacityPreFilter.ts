import type { Passenger } from "@/domain/entities";

import { computeOnboardSeats, computePeakCommittedSeats } from "../occupancy";
import { reason } from "../reasons";
import { toProposedStops } from "../stops";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 4. A cheap, conservative seat check.
 *
 * This asks whether the vehicle is *ever* full along its committed route. It
 * is deliberately not authoritative — a driver who peaks at capacity midway
 * may still be able to carry the new rider on an earlier or later stretch.
 * Stage 6's segment occupancy walk makes that call. This stage exists only to
 * reject the hopeless cases before anything is routed.
 */
export const capacityPreFilterStage: MatchingStage = {
  id: "capacityPreFilter",
  name: "Capacity Pre-filter",
  description: "Rejects drivers whose committed route never has room for the request.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario } = context;
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
      const onboardSeats = ride ? computeOnboardSeats(ride.passengerIds, passengersById) : 0;
      const remainingStops = ride ? toProposedStops(ride.stops, passengersById) : [];
      const peakCommittedSeats = computePeakCommittedSeats(remainingStops, onboardSeats);
      const availableSeats = vehicle.totalSeats - peakCommittedSeats;

      context.recordMetrics(driverId, {
        totalSeats: vehicle.totalSeats,
        committedSeats: peakCommittedSeats,
        availableSeats,
      });

      const metrics = {
        totalSeats: vehicle.totalSeats,
        peakCommittedSeats,
        availableSeats,
        requiredSeats: request.seatsRequired,
      };

      if (availableSeats >= request.seatsRequired) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [
            reason("CAPACITY_AVAILABLE", `${availableSeats} seats free at the busiest point`, {
              value: availableSeats,
              threshold: request.seatsRequired,
            }),
          ],
          metrics,
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "FAILED",
        reasons: [
          reason("INSUFFICIENT_CAPACITY", "Vehicle never has enough free seats for this request", {
            value: availableSeats,
            threshold: request.seatsRequired,
          }),
        ],
        metrics,
      });
    }

    return Promise.resolve({ verdicts });
  },
};
