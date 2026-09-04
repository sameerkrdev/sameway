import { normalizeLowerIsBetter, normalizeWeights } from "../normalize";
import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  ScoreBreakdown,
  ScoreComponent,
  StageOutcome,
} from "../types";

/**
 * Stage 11. Among the routes that are all valid, which is best?
 *
 * Validity is not optimality. Several insertions can clear every hard limit
 * while distributing the cost very differently, and the vehicle-cost-cheapest
 * one is frequently the one that hurts a single rider most. That is exactly
 * why this scoring stays in-house rather than being delegated to the solver,
 * whose objective is the vehicle's cost and nobody else's.
 *
 * Every component measures harm and is normalised against its own threshold,
 * so the total stays on one 0-100 scale and each contribution is a real
 * displayable number rather than an artefact of unit choice. Driver impact
 * uses `maxNewPassengerRideDetourMin`; existing rider impact uses the
 * tightest computed drop-delay budget from stage 9.
 *
 * Known limitation: `OptimizeTours` returns one sequence per driver, so this
 * ranks *across drivers*, not across sequences for a single driver. The
 * Overview's Route 1/2/3 example — our fairness score overriding Google's
 * winner among several candidate sequences — needs the Phase 3 in-house
 * insertion search. The results panel says so.
 */
export const scoringStage: MatchingStage = {
  id: "scoring",
  name: "Scoring",
  description: "Fairness-weighted ranking across drivers. Lower is better.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const weights = normalizeWeights(settings.weights);
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const metrics = context.getMetrics(driverId);
      const isIdle = context.getCorridor(driverId)?.isIdle ?? true;

      // An idle driver's `additionalDurationMin` is measured against a zero
      // baseline, so it is the whole fare rather than a detour. Scoring that as
      // driver harm would penalise every idle driver in proportion to the
      // length of the trip they were offered, which is backwards. Stages 7 and
      // 10 already exempt them for the same reason.
      const driverImpactMin = isIdle ? 0 : (metrics.additionalDurationMin ?? 0);
      const existingDelayBudgetMin =
        metrics.maximumExistingPassengerDelayBudgetMin ??
        settings.maxNewPassengerRideDetourMin;

      const components: ScoreComponent[] = [
        {
          key: "driverImpact",
          label: "Driver impact",
          rawValue: driverImpactMin,
          normalized: normalizeLowerIsBetter(
            driverImpactMin,
            settings.maxNewPassengerRideDetourMin,
          ),
          weight: weights.driverImpact,
          contribution: 0,
        },
        {
          key: "existingPassengerImpact",
          label: "Existing rider impact",
          rawValue: metrics.maximumExistingPassengerDelayMin,
          normalized: normalizeLowerIsBetter(
            metrics.maximumExistingPassengerDelayMin ?? 0,
            existingDelayBudgetMin,
          ),
          weight: weights.existingPassengerImpact,
          contribution: 0,
        },
        {
          key: "newPassengerImpact",
          label: "New rider impact",
          rawValue: metrics.newPassengerRideDetourMin,
          normalized: normalizeLowerIsBetter(
            metrics.newPassengerRideDetourMin ?? 0,
            settings.maxNewPassengerRideDetourMin,
          ),
          weight: weights.newPassengerImpact,
          contribution: 0,
        },
        {
          key: "pickupDelay",
          label: "Pickup wait",
          rawValue: metrics.newPassengerPickupDelayMin,
          normalized: normalizeLowerIsBetter(
            metrics.newPassengerPickupDelayMin ?? 0,
            settings.maxNewPassengerPickupDelayMin,
          ),
          weight: weights.pickupDelay,
          contribution: 0,
        },
      ];

      let finalScore = 0;

      for (const component of components) {
        component.contribution = component.normalized * component.weight;
        finalScore += component.contribution;
      }

      const breakdown: ScoreBreakdown = { components, finalScore };
      context.recordScore(driverId, breakdown);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("ROUTE_FEASIBLE", `Fairness score ${finalScore.toFixed(1)} (lower is better)`, {
            value: Number(finalScore.toFixed(2)),
            threshold: 0,
          }),
        ],
        metrics: scoreMetrics(components, finalScore),
      });
    }

    return Promise.resolve({ verdicts, notes: { weights } });
  },
};

function scoreMetrics(
  components: readonly ScoreComponent[],
  finalScore: number,
): Record<string, number> {
  const output: Record<string, number> = { finalScore: round(finalScore, 2) };

  for (const component of components) {
    output[`${component.key}Score`] = round(component.normalized, 1);
    output[`${component.key}Contribution`] = round(component.contribution, 2);
  }

  return output;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
