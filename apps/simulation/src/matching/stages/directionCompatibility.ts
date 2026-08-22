import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 4. Placeholder — implemented in Task 13. */
export const directionCompatibilityStage: MatchingStage = {
  id: "directionCompatibility",
  name: "Direction Compatibility",
  description: "Bearing, destination proximity and destination progress along the route.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("DIRECTION_COMPATIBLE", "Request travels with the vehicle")],
    }));

    return Promise.resolve({ verdicts });
  },
};
