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
 * Stage 7. Is this provably too expensive, using only free arithmetic?
 *
 * Road distance can never be shorter than straight-line distance, so the
 * straight-line added length is an admissible lower bound — the same principle
 * as an admissible heuristic in A*. For corridor extensions, if that bound
 * already exceeds `maxCorridorExtensionKm`, a solver call would only confirm
 * the reject expensively. Ordinary pooling no longer has an added-km cap, so
 * this stage only ranks and shortlists candidates for stage 8.
 */
export const detourLowerBoundStage: MatchingStage = {
  id: "detourLowerBound",
  name: "Detour Lower Bound",
  description: "Prunes hopeless corridor extensions; shortlists cheapest sequences.",

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
      const metrics = context.getMetrics(driverId);
      const isCorridorExtension = (metrics.corridorExtensionKm ?? 0) > 0;
      const extensionCap = settings.maxCorridorExtensionKm;

      const scored = candidates.map((candidate) => ({
        candidate,
        addedKm: pathLengthKm([start, ...candidate.stops.map((stop) => stop.location)]) - baselineKm,
      }));

      scored.sort((a, b) => a.addedKm - b.addedKm);

      const best = scored[0]!;
      context.recordMetrics(driverId, {
        lowerBoundAdditionalKm: round(best.addedKm, 2),
      });

      // Idle drivers: baseline is zero; "added" is the whole trip, not a detour.
      if (!corridor.isIdle && isCorridorExtension && best.addedKm > extensionCap) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "DETOUR_LOWER_BOUND_EXCEEDED",
              "Even the straight-line lower bound exceeds the corridor-extension cap",
              { value: round(best.addedKm, 2), threshold: extensionCap },
            ),
          ],
        });
        continue;
      }

      const withinBound =
        !corridor.isIdle && isCorridorExtension
          ? scored.filter((entry) => entry.addedKm <= extensionCap)
          : scored;

      const shortlisted: RouteInsertionCandidate[] = withinBound
        .slice(0, settings.maxRoutedInsertionsPerDriver)
        .map((entry) => entry.candidate);

      context.recordMetrics(driverId, {
        boundFeasibleSequences: withinBound.length,
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
            : isCorridorExtension
              ? reason("LOWER_BOUND_OK", "Extension is within the corridor-extension cap", {
                  value: round(best.addedKm, 2),
                  threshold: extensionCap,
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
