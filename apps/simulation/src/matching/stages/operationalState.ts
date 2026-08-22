import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 1. Placeholder — implemented in Task 10. */
export const operationalStateStage: MatchingStage = {
  id: "operationalState",
  name: "Operational State",
  description: "Computes each committed passenger's remaining delay budget.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("OPERATIONAL_FLEXIBLE", "Committed stops still have delay budget")],
    }));

    return Promise.resolve({ verdicts });
  },
};
