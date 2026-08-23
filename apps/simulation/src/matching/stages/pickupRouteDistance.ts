import { pointToPolylineKm } from "@/lib/geo";

import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 3. Tightens stage 2's cell-level match into real geometry.
 *
 * H3 corridor intersection is approximate — a cell is hundreds of metres
 * across, and the one-ring padding widens it further. This measures the actual
 * perpendicular distance from the pickup to the remaining-route polyline.
 *
 * It remains a *cheap approximation of proximity*, never the real detour: a
 * pickup 500 m off the line can mean driving 500 m out and 500 m back. Only
 * stage 8 knows that number. This stage exists to stop obviously-too-far
 * candidates from ever reaching the solver.
 */
export const pickupRouteDistanceStage: MatchingStage = {
  id: "pickupRouteDistance",
  name: "Pickup → Route Distance",
  description: "Point-to-polyline distance from the pickup to the remaining route.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);

      if (!corridor) {
        continue;
      }

      const distanceKm = pointToPolylineKm(request.pickup, corridor.polyline);
      context.recordMetrics(driverId, { pickupToRouteKm: distanceKm });

      if (distanceKm > settings.maxPickupToRouteDistanceKm) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason("PICKUP_TOO_FAR_FROM_ROUTE", "Pickup is too far from this ride's route", {
              value: round(distanceKm, 2),
              threshold: settings.maxPickupToRouteDistanceKm,
            }),
          ],
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("PICKUP_ON_ROUTE", "Pickup is close to this ride's route", {
            value: round(distanceKm, 2),
            threshold: settings.maxPickupToRouteDistanceKm,
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
