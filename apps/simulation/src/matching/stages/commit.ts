import { reason } from "../reasons";
import type {
  CommitPlan,
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  StageOutcome,
} from "../types";

/**
 * Stage 12. Turn the winning sequence into the new baseline.
 *
 * The route is a living object, not a one-shot answer. Once a passenger is
 * committed, the very next request is matched against the post-commit route
 * rather than recomputed from scratch — the rolling-horizon principle. That
 * only works if the promises are re-stamped here: every remaining stop's
 * `originalEtaMin` becomes what the solver just said it would be, so the next
 * request's delay measurements are taken against reality rather than against
 * a promise two insertions old.
 *
 * This stage builds the plan; it does not apply it. `runMatching` must stay
 * pure — `e2e-scenario.test.ts` asserts the scenario is never written during a
 * run, and `scenarioStore.commitMatch` is what actually mutates.
 */
export const commitStage: MatchingStage = {
  id: "commit",
  name: "Commit",
  description: "Builds the commit plan that makes the winning route the new baseline.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request } = context;
    const verdicts: DriverVerdict[] = [];
    const plansByDriver: Record<string, CommitPlan> = {};

    for (const driverId of context.liveDriverIds) {
      const solution = context.getSolution(driverId);
      const corridor = context.getCorridor(driverId);

      if (!solution) {
        continue;
      }

      const plan: CommitPlan = {
        driverId,
        rideId: corridor?.rideId ?? null,
        passengerId: request.passengerId,
        requestId: request.id,
        stops: solution.stops.map((stop) => ({
          id: stop.id,
          passengerId: stop.passengerId,
          type: stop.type,
          location: stop.location,
          originalEtaMin: solution.arrivalByStopId.get(stop.id) ?? 0,
        })),
      };

      plansByDriver[driverId] = plan;
      context.recordCommitPlan(driverId, plan);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("COMMIT_READY", `Plan ready: ${String(solution.stops.length)} stops`, {
            value: solution.stops.length,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts, notes: { plansByDriver } });
  },
};
