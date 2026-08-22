import { normalizeLowerIsBetter, normalizeWeights } from "../normalize";
import { reason } from "../reasons";
import type {
  DriverMetrics,
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  ScoreBreakdown,
  ScoreComponent,
  StageOutcome,
} from "../types";

/** Idle time at which the experimental fairness component saturates at 100. */
const FAIRNESS_REFERENCE_IDLE_MINUTES = 60;

/**
 * Stage 8. Ranks the survivors.
 *
 * Every component is normalised to 0-100 against its own configured threshold
 * before any weighting happens, and the weights themselves are rescaled to sum
 * to 1. That keeps the final score on the same 0-100 scale as its parts and
 * makes each component's contribution a real, displayable number rather than
 * an artefact of unit choice.
 *
 * Nothing is rejected here — a driver that failed a hard filter never reaches
 * this stage.
 */
export const scoringStage: MatchingStage = {
  id: "scoring",
  name: "Scoring",
  description: "Normalises each metric to 0-100 and applies the configured weights.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const weights = normalizeWeights(settings.weights);
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const driver = context.getDriver(driverId);
      const metrics = context.getMetrics(driverId);

      const components: ScoreComponent[] = [
        {
          key: "eta",
          label: "Pickup ETA",
          rawValue: metrics.roadEtaMin,
          // Task 20 rewrites scoring against the optimizer's real leg data.
          // Until then the closest surviving threshold stands in for the
          // deleted `maxPickupEtaMin`.
          normalized: normalizeLowerIsBetter(
            metrics.roadEtaMin,
            settings.maxNewPassengerPickupDelayMin,
          ),
          weight: weights.eta,
          contribution: 0,
        },
        {
          key: "distance",
          label: "Pickup distance",
          rawValue: metrics.roadDistanceKm,
          normalized: normalizeLowerIsBetter(
            metrics.roadDistanceKm,
            settings.maxPickupToRouteDistanceKm,
          ),
          weight: weights.distance,
          contribution: 0,
        },
        {
          key: "detour",
          label: "Route detour",
          rawValue: metrics.detourPercent,
          normalized: normalizeLowerIsBetter(metrics.detourPercent ?? 0, settings.maxDetourPercent),
          weight: weights.detour,
          contribution: 0,
        },
        {
          key: "routeQuality",
          label: "Existing rider impact",
          rawValue: metrics.maximumExistingPassengerDelayMin,
          normalized: normalizeLowerIsBetter(
            metrics.maximumExistingPassengerDelayMin ?? 0,
            settings.maxExistingPassengerDelayMin,
          ),
          weight: weights.routeQuality,
          contribution: 0,
        },
        {
          key: "fairness",
          label: "Driver fairness",
          rawValue: driver?.history.idleMinutes,
          normalized: fairnessScore(driver?.history.idleMinutes),
          weight: weights.fairness,
          contribution: 0,
          // We do not have a real fairness model. Labelling it keeps anyone
          // from reading the number as more than the placeholder it is; its
          // default weight of zero keeps it out of results entirely.
          experimental: true,
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
          reason("ROUTE_FEASIBLE", `Scored ${finalScore.toFixed(1)} out of 100`, {
            value: Number(finalScore.toFixed(2)),
            threshold: 100,
          }),
        ],
        metrics: scoreMetrics(components, finalScore, metrics),
      });
    }

    return Promise.resolve({
      verdicts,
      notes: { weights, fairnessReferenceIdleMinutes: FAIRNESS_REFERENCE_IDLE_MINUTES },
    });
  },
};

function fairnessScore(idleMinutes: number | undefined): number {
  if (idleMinutes === undefined) {
    return 0;
  }
  return Math.min(100, (idleMinutes / FAIRNESS_REFERENCE_IDLE_MINUTES) * 100);
}

function scoreMetrics(
  components: readonly ScoreComponent[],
  finalScore: number,
  metrics: DriverMetrics,
): Record<string, number> {
  const output: Record<string, number> = { finalScore: round(finalScore, 2) };

  for (const component of components) {
    output[`${component.key}Score`] = round(component.normalized, 1);
    output[`${component.key}Contribution`] = round(component.contribution, 2);
  }

  if (metrics.roadEtaMin !== undefined) {
    output.roadEtaMin = round(metrics.roadEtaMin, 2);
  }

  return output;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
