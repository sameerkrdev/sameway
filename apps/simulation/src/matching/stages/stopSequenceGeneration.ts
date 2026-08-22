import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 5. Placeholder — implemented in Task 14. */
export const stopSequenceGenerationStage: MatchingStage = {
  id: "stopSequenceGeneration",
  name: "Stop Sequence Generation",
  description: "Enumerates legal insertion positions under precedence and capacity.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("SEQUENCE_GENERATED", "At least one legal stop sequence exists")],
    }));

    return Promise.resolve({ verdicts });
  },
};
