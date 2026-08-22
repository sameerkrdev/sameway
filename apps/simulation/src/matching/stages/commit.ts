import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 12. Placeholder — implemented in Task 21. */
export const commitStage: MatchingStage = {
  id: "commit",
  name: "Commit",
  description: "Builds the commit plan that makes the winning route the new baseline.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("COMMIT_READY", "Commit plan ready")],
    }));

    return Promise.resolve({ verdicts });
  },
};
