import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 10. Placeholder — implemented in Task 19. */
export const hardConstraintsStage: MatchingStage = {
  id: "hardConstraints",
  name: "Hard Constraints",
  description: "Binary accept/reject against every configured maximum, plus pooling policy.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("ROUTE_FEASIBLE", "Within every configured maximum")],
    }));

    return Promise.resolve({ verdicts });
  },
};
