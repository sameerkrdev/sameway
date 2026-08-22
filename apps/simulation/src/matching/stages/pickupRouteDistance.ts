import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 3. Placeholder — implemented in Task 12. */
export const pickupRouteDistanceStage: MatchingStage = {
  id: "pickupRouteDistance",
  name: "Pickup → Route Distance",
  description: "Point-to-polyline distance from the pickup to the remaining route.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("PICKUP_ON_ROUTE", "Pickup is close to the remaining route")],
    }));

    return Promise.resolve({ verdicts });
  },
};
