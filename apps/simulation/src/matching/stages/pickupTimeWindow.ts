import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 6. Placeholder — implemented in Task 15. */
export const pickupTimeWindowStage: MatchingStage = {
  id: "pickupTimeWindow",
  name: "Pickup Time Window",
  description: "Drops orderings that breach a committed passenger's own delay budget.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("TIME_WINDOW_OK", "Every delay budget is respected")],
    }));

    return Promise.resolve({ verdicts });
  },
};
