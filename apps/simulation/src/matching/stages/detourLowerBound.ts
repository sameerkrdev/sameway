import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 7. Placeholder — implemented in Task 16. */
export const detourLowerBoundStage: MatchingStage = {
  id: "detourLowerBound",
  name: "Detour Lower Bound",
  description: "Prunes sequences whose straight-line lower bound already fails.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("LOWER_BOUND_OK", "Straight-line lower bound is within budget")],
    }));

    return Promise.resolve({ verdicts });
  },
};
