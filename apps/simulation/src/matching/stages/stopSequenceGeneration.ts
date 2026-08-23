import type { Passenger } from "@/domain/entities";
import { MAX_INTERMEDIATE_WAYPOINTS } from "@/domain/settings";

import { enumerateInsertions } from "../insertion";
import { computeOnboardSeats, computeSegmentOccupancy } from "../occupancy";
import { reason } from "../reasons";
import { newRiderStops, toProposedStops } from "../stops";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionCandidate,
  StageOutcome,
} from "../types";

/**
 * Stage 5. Where could the new rider actually be inserted?
 *
 * Naively there are `(k+2)!` orderings of `k` committed stops plus two new
 * ones. Almost all are illegal. Treating the committed stops as a frozen spine
 * and searching only for where the two new stops slot in gives exactly
 * `(n+1)(n+2)/2` candidates — polynomial rather than factorial, and every one
 * of them precedence-correct by construction rather than by filtering.
 *
 * Occupancy pruning runs here because it is free. On a busy vehicle it removes
 * most candidates before a single expensive thing has happened.
 */
export const stopSequenceGenerationStage: MatchingStage = {
  id: "stopSequenceGeneration",
  name: "Stop Sequence Generation",
  description: "Enumerates legal insertion positions under precedence and capacity.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const { pickup, drop } = newRiderStops(request);
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const vehicle = context.getVehicleForDriver(driverId);
      const ride = context.getRideForDriver(driverId);

      if (!vehicle) {
        continue;
      }

      const existingStops = ride ? toProposedStops(ride.stops, passengersById) : [];
      const onboardSeats = ride ? computeOnboardSeats(ride.passengerIds, passengersById) : 0;

      // Every candidate has the same waypoint count, so this is a route-level
      // gate rather than a per-candidate one.
      const intermediateCount = existingStops.length + 1;
      if (intermediateCount > MAX_INTERMEDIATE_WAYPOINTS) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "WAYPOINT_LIMIT_EXCEEDED",
              "Route exceeds the maximum intermediate waypoints the routing provider accepts",
              { value: intermediateCount, threshold: MAX_INTERMEDIATE_WAYPOINTS },
            ),
          ],
        });
        continue;
      }

      const candidates = enumerateInsertions(existingStops, pickup, drop);
      const feasible: RouteInsertionCandidate[] = [];
      let worstPeak = 0;

      for (const candidate of candidates) {
        const occupancy = computeSegmentOccupancy(candidate.stops, onboardSeats, vehicle.totalSeats);

        if (occupancy.overflowAtIndex === null) {
          feasible.push(candidate);
        } else {
          worstPeak = Math.max(worstPeak, occupancy.peakOccupancy);
        }
      }

      context.recordMetrics(driverId, {
        enumeratedSequences: candidates.length,
        capacityFeasibleSequences: feasible.length,
        totalSeats: vehicle.totalSeats,
      });

      if (feasible.length === 0) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "SEGMENT_CAPACITY_EXCEEDED",
              "No insertion position keeps the vehicle within capacity on every segment",
              { value: worstPeak, threshold: vehicle.totalSeats },
            ),
          ],
        });
        continue;
      }

      context.setSequences(driverId, feasible);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("SEQUENCE_GENERATED", `${String(feasible.length)} legal ordering(s) available`, {
            value: feasible.length,
            threshold: candidates.length,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};
