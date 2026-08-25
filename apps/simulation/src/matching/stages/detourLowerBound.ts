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
 * as an admissible heuristic in A*. If the optimistic bound already breaks a
 * hard limit, the pessimistic reality certainly will, and a solver call would
 * only confirm that expensively.
 *
 * This stage changes no outcome. It only changes how many calls stage 8 makes.
 * That distinction matters: a bound that pruned a candidate stage 10 would
 * have accepted would be a bug, not an optimisation.
 */
export const detourLowerBoundStage: MatchingStage = {
  id: "detourLowerBound",
  name: "Detour Lower Bound",
  description: "Prunes sequences whose straight-line lower bound already fails.",

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
      const distanceCap = isCorridorExtension
        ? settings.maxCorridorExtensionKm
        : settings.maxAdditionalDistanceKm;

      const scored = candidates.map((candidate) => ({
        candidate,
        addedKm: pathLengthKm([start, ...candidate.stops.map((stop) => stop.location)]) - baselineKm,
      }));

      scored.sort((a, b) => a.addedKm - b.addedKm);

      const best = scored[0]!;
      context.recordMetrics(driverId, {
        lowerBoundAdditionalKm: round(best.addedKm, 2),
      });

      // An idle driver has no committed route, so its baseline length is zero
      // and "added distance" comes out as the rider's entire fare. That is not
      // a detour — `maxAdditionalDistanceKm` caps the extra a driver travels
      // *because of pooling*, and there is no pooling here. Applying it would
      // reject every idle driver on any trip longer than the cap. Their real
      // cost is still measured at stages 9 and 10, against the rider's solo
      // route rather than against a route that does not exist.
      if (!corridor.isIdle && best.addedKm > distanceCap) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "DETOUR_LOWER_BOUND_EXCEEDED",
              isCorridorExtension
                ? "Even the straight-line lower bound exceeds the corridor-extension cap"
                : "Even the straight-line lower bound exceeds the added-distance cap",
              { value: round(best.addedKm, 2), threshold: distanceCap },
            ),
          ],
        });
        continue;
      }

      const withinBound = corridor.isIdle
        ? scored
        : scored.filter((entry) => entry.addedKm <= distanceCap);

      // A separate, blunter cap on top of the bound. The bound removes only
      // provably-hopeless candidates; this one bounds spend regardless of how
      // many plausible candidates survive.
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
                threshold: settings.maxAdditionalDistanceKm,
              })
            : reason("LOWER_BOUND_OK", "Insertion is within the added-distance cap", {
                value: round(best.addedKm, 2),
                threshold: distanceCap,
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
