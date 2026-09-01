import { pathLengthKm } from "@/lib/geo";

import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionCandidate,
  StageOutcome,
} from "../types";

/**
 * Stage 7. Rank insertion candidates by straight-line cost and shortlist the
 * cheapest for the solver.
 *
 * Road distance can never be shorter than straight-line distance, so added
 * length is a useful sort key. There is no hard reject here — passenger delay
 * and ride-detour budgets in stage 11 decide whether a match is acceptable.
 */
export const detourLowerBoundStage: MatchingStage = {
  id: "detourLowerBound",
  name: "Detour Lower Bound",
  description: "Shortlists cheapest stop sequences by straight-line added length.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);
      const candidates = context.getSequences(driverId);

      if (!corridor || candidates.length === 0) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [reason("LOWER_BOUND_OK", "No sequences to bound")],
        });
        continue;
      }

      const start = corridor.polyline[0]!;
      const baselineKm = pathLengthKm(corridor.polyline);

      const scored = candidates.map((candidate) => ({
        candidate,
        addedKm: pathLengthKm([start, ...candidate.stops.map((stop) => stop.location)]) - baselineKm,
      }));

      scored.sort((a, b) => a.addedKm - b.addedKm);

      const best = scored[0]!;
      context.recordMetrics(driverId, {
        lowerBoundAdditionalKm: round(best.addedKm, 2),
        boundFeasibleSequences: scored.length,
      });

      const shortlisted: RouteInsertionCandidate[] = scored
        .slice(0, settings.maxRoutedInsertionsPerDriver)
        .map((entry) => entry.candidate);

      context.recordMetrics(driverId, {
        shortlistedSequences: shortlisted.length,
      });

      context.setSequences(driverId, shortlisted);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          corridor.isIdle
            ? reason("LOWER_BOUND_OK", "Driver is idle — the trip is not a detour", {
                value: round(best.addedKm, 2),
              })
            : reason("LOWER_BOUND_OK", "Sequences shortlisted by straight-line cost", {
                value: round(best.addedKm, 2),
              }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
