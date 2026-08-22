import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 9. Placeholder — implemented in Task 18. */
export const incrementalCostStage: MatchingStage = {
  id: "incrementalCost",
  name: "Incremental Cost",
  description: "Measures what every party gains or loses. Rejects nothing.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("COST_MEASURED", "Impact on every party measured")],
    }));

    return Promise.resolve({ verdicts });
  },
};
