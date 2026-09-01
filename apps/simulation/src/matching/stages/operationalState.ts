import type { Passenger, Stop } from "@/domain/entities";

import {
  delayBudgetMinFromPercent,
  resolveDelayPercent,
  soloEtaMinForStop,
} from "../delayBudget";
import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** How much later one committed stop may happen than it was promised. */
export interface StopDelayBudget {
  stopId: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  originalEtaMin: number;
  /** Solo trip ETA the percent is measured against. */
  soloEtaMin: number;
  /** Percent of solo ETA that was applied (250% on short trips). */
  budgetPercent: number;
  budgetMin: number;
}

/**
 * Stage 1. What is this *ride* currently doing?
 *
 * A driver is not an available/unavailable resource — it is a live route with
 * promises attached. This stage does not freeze those promises; it prices
 * them. Every committed stop gets a delay budget, and stages 5 and 6 use those
 * budgets to decide which orderings are legal. Rejecting the driver outright
 * here would silently throw away perfectly good matches, which was the whole
 * point of the Overview's flexible-commitment policy.
 */
export const operationalStateStage: MatchingStage = {
  id: "operationalState",
  name: "Operational State",
  description: "Computes each committed passenger's remaining delay budget.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const passengersById = new Map<string, Passenger>(
      context.scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];
    const budgetsByDriver: Record<string, StopDelayBudget[]> = {};

    for (const driverId of context.liveDriverIds) {
      const ride = context.getRideForDriver(driverId);
      const rideStops: Stop[] = ride?.stops ?? [];
      const budgets: StopDelayBudget[] = [];

      for (const stop of rideStops) {
        const passenger = passengersById.get(stop.passengerId);
        if (!passenger || passenger.state === "DROPPED" || passenger.state === "CANCELLED") {
          continue;
        }

        // An onboard passenger's pickup already happened, so it carries no
        // remaining budget — only their drop is still a promise.
        if (
          stop.type === "PICKUP" &&
          (passenger.state === "PICKED_UP" || passenger.state === "IN_RIDE")
        ) {
          continue;
        }

        const soloEtaMin = soloEtaMinForStop(stop, rideStops);
        const personalDropBudgetMin = delayBudgetMinFromPercent(
          soloEtaMin,
          passenger.maxDropDelayPercent,
          settings,
        );
        const globalDropBudgetMin = delayBudgetMinFromPercent(
          soloEtaMin,
          settings.maxExistingPassengerDelayPercent,
          settings,
        );
        const effectiveDropBudgetMin = Math.min(personalDropBudgetMin, globalDropBudgetMin);
        const effectiveDropPercent = Math.min(
          resolveDelayPercent(soloEtaMin, passenger.maxDropDelayPercent, settings),
          resolveDelayPercent(soloEtaMin, settings.maxExistingPassengerDelayPercent, settings),
        );

        const budget =
          stop.type === "PICKUP"
            ? {
                stopId: stop.id,
                passengerId: stop.passengerId,
                type: stop.type,
                originalEtaMin: stop.originalEtaMin,
                soloEtaMin,
                budgetPercent: 0,
                budgetMin: passenger.maxPickupDelayMin,
              }
            : {
                stopId: stop.id,
                passengerId: stop.passengerId,
                type: stop.type,
                originalEtaMin: stop.originalEtaMin,
                soloEtaMin,
                budgetPercent: effectiveDropPercent,
                budgetMin: effectiveDropBudgetMin,
              };

        budgets.push(budget);
      }

      budgetsByDriver[driverId] = budgets;
      context.setDelayBudgets(driverId, budgets);

      const tightest = budgets.reduce<number | undefined>(
        (min, budget) => (min === undefined ? budget.budgetMin : Math.min(min, budget.budgetMin)),
        undefined,
      );

      context.recordMetrics(driverId, {
        flexibleStopCount: budgets.filter((budget) => budget.budgetMin > 0).length,
        ...(tightest === undefined ? {} : { tightestDelayBudgetMin: tightest }),
      });

      if (budgets.length > 0 && budgets.every((budget) => budget.budgetMin <= 0)) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "OPERATIONAL_NO_FLEXIBILITY",
              "Every committed stop on this ride is already at zero delay tolerance",
              { value: 0, threshold: 1 },
            ),
          ],
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason(
            "OPERATIONAL_FLEXIBLE",
            budgets.length === 0
              ? "Driver has no committed stops"
              : `${String(budgets.length)} committed stop(s) with delay tolerance`,
            { value: budgets.length },
          ),
        ],
      });
    }

    return Promise.resolve({ verdicts, notes: { budgetsByDriver } });
  },
};
