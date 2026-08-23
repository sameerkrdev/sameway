import type { Passenger } from "@/domain/entities";

import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** How much later one committed stop may happen than it was promised. */
export interface StopDelayBudget {
  stopId: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  originalEtaMin: number;
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
    const passengersById = new Map<string, Passenger>(
      context.scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];
    const budgetsByDriver: Record<string, StopDelayBudget[]> = {};

    for (const driverId of context.liveDriverIds) {
      const ride = context.getRideForDriver(driverId);
      const budgets: StopDelayBudget[] = [];

      for (const stop of ride?.stops ?? []) {
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

        budgets.push({
          stopId: stop.id,
          passengerId: stop.passengerId,
          type: stop.type,
          originalEtaMin: stop.originalEtaMin,
          budgetMin:
            stop.type === "PICKUP" ? passenger.maxPickupDelayMin : passenger.maxDropDelayMin,
        });
      }

      budgetsByDriver[driverId] = budgets;

      const tightest = budgets.reduce<number | undefined>(
        (min, budget) => (min === undefined ? budget.budgetMin : Math.min(min, budget.budgetMin)),
        undefined,
      );

      context.recordMetrics(driverId, {
        flexibleStopCount: budgets.filter((budget) => budget.budgetMin > 0).length,
        ...(tightest === undefined ? {} : { tightestDelayBudgetMin: tightest }),
      });

      // An idle driver has no commitments to protect, so there is nothing
      // rigid about them. Only a driver whose every promise is already at zero
      // slack is a genuine dead end.
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
