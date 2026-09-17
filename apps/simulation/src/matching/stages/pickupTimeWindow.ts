import { haversineKm } from "@/lib/geo";

import { reason, type MatchReason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionCandidate,
  StageOutcome,
} from "../types";

/**
 * Stage 6. Does this ordering break a promise we already made?
 *
 * This is stage 1's flexible-commitment policy applied per ordering. A
 * committed passenger is not frozen — inserting ahead of them is allowed
 * exactly as long as their own tolerance absorbs the delay. What gets rejected
 * is the *ordering*, never the driver: a driver survives as long as any one
 * ordering works.
 *
 * The ETA used here is a straight-line estimate, deliberately. This is a
 * pre-filter whose only job is to shrink the solver's search space; stage 10
 * re-checks the identical budgets against the solver's real leg times, and the
 * same budgets go to the solver as hard time windows. Three checks, one source
 * of truth — the passenger record.
 */
export const pickupTimeWindowStage: MatchingStage = {
  id: "pickupTimeWindow",
  name: "Pickup Time Window",
  description: "Drops orderings that breach a committed passenger's own delay budget.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const driver = context.getDriver(driverId);

      if (!driver) {
        continue;
      }

      const budgets = context.getDelayBudgets(driverId);
      const candidates = context.getSequences(driverId);

      if (candidates.length === 0 || budgets.length === 0) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [reason("TIME_WINDOW_OK", "No committed promises to protect")],
        });
        continue;
      }

      // The route starts where the vehicle is. That is the corridor's first
      // point by construction, so this reads the driver directly rather than
      // making a delay-budget check depend on stage 2 having published — a
      // filter that quietly stops filtering when an upstream stage is absent
      // is worse than one that is simply wrong.
      const start = context.getCorridor(driverId)?.polyline[0] ?? driver.location;

      const budgetByStopId = new Map(budgets.map((budget) => [budget.stopId, budget]));
      const surviving: RouteInsertionCandidate[] = [];
      let lastFailure: MatchReason | undefined;

      for (const candidate of candidates) {
        const failure = firstBudgetBreach({
          candidate,
          start,
          budgetByStopId,
          speedKmh: settings.estimatedSpeedKmh,
        });

        if (failure) {
          lastFailure = failure;
        } else {
          surviving.push(candidate);
        }
      }

      context.recordMetrics(driverId, { timeWindowFeasibleSequences: surviving.length });
      // Published before the failure branch, not after it. Leaving the stale
      // pre-filter list in place for a rejected driver would make
      // `getSequences` claim orderings that this stage has just ruled out.
      context.setSequences(driverId, surviving);

      if (surviving.length === 0) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            lastFailure ??
              reason(
                "COMMITTED_PICKUP_DELAY_TOO_HIGH",
                "No ordering keeps every committed promise within its delay budget",
              ),
          ],
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("TIME_WINDOW_OK", `${String(surviving.length)} ordering(s) keep every promise`, {
            value: surviving.length,
            threshold: candidates.length,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function firstBudgetBreach(args: {
  candidate: RouteInsertionCandidate;
  start: { lat: number; lng: number };
  budgetByStopId: ReadonlyMap<
    string,
    { budgetMin: number; originalEtaMin: number; type: "PICKUP" | "DROP" }
  >;
  speedKmh: number;
}): MatchReason | undefined {
  const { candidate, start, budgetByStopId, speedKmh } = args;

  let cumulativeKm = 0;
  let previous = start;

  for (const stop of candidate.stops) {
    cumulativeKm += haversineKm(previous, stop.location);
    previous = stop.location;

    const budget = budgetByStopId.get(stop.id);
    if (!budget) {
      continue;
    }

    const projectedEtaMin = (cumulativeKm / speedKmh) * 60;
    const delayMin = projectedEtaMin - budget.originalEtaMin;

    if (delayMin > budget.budgetMin) {
      return reason(
        budget.type === "PICKUP"
          ? "COMMITTED_PICKUP_DELAY_TOO_HIGH"
          : "COMMITTED_DROP_DELAY_TOO_HIGH",
        budget.type === "PICKUP"
          ? "This ordering would collect a committed passenger later than they accept"
          : "This ordering would drop a committed passenger later than they accept",
        { value: round(delayMin, 2), threshold: budget.budgetMin },
      );
    }
  }

  return undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
