import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 2. Placeholder — implemented in Task 11. */
export const h3RouteCorridorStage: MatchingStage = {
  id: "h3RouteCorridor",
  name: "H3 Route Corridor",
  description: "Matches the pickup against each ride's remaining-route corridor.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("CORRIDOR_MATCH", "Pickup falls on the ride corridor")],
    }));

    return Promise.resolve({ verdicts });
  },
};
