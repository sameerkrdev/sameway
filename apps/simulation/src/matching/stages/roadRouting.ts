import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage 8. Placeholder — implemented in Task 17. */
export const roadRoutingStage: MatchingStage = {
  id: "roadRouting",
  name: "Road Routing",
  description: "Google OptimizeTours returns the winning sequence and its leg data.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("OPTIMIZER_SOLVED", "Solver returned a sequence")],
    }));

    return Promise.resolve({ verdicts });
  },
};
