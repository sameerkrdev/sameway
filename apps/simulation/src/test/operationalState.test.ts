import { describe, expect, it } from "vitest";

import { operationalStateStage } from "@/matching/stages/operationalState";

import { makeContext } from "./fixtures/stageContext";

describe("operationalState", () => {
  it("records a delay budget for every committed stop", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayMin: 8 }],
    });

    const outcome = await operationalStateStage.execute(context);
    const budgets = (outcome.notes?.budgetsByDriver as Record<string, unknown[]>).d1;

    expect(budgets).toHaveLength(2);
  });

  it("uses the pickup budget for a pickup and the drop budget for a drop", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayMin: 8 }],
    });

    const outcome = await operationalStateStage.execute(context);
    const budgets = (
      outcome.notes?.budgetsByDriver as Record<string, { stopId: string; budgetMin: number }[]>
    ).d1!;

    expect(budgets.find((entry) => entry.stopId === "s1")!.budgetMin).toBe(5);
    expect(budgets.find((entry) => entry.stopId === "s2")!.budgetMin).toBe(8);
  });

  it("passes an idle driver with no committed stops", async () => {
    const context = makeContext({ driverId: "d1", committedStops: [], passengers: [] });

    const outcome = await operationalStateStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("records the tightest budget as a metric", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "DROP", originalEtaMin: 10 },
        { id: "s2", passengerId: "pB", type: "DROP", originalEtaMin: 20 },
      ],
      passengers: [
        { id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 3 },
        { id: "pB", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 12 },
      ],
    });

    await operationalStateStage.execute(context);

    expect(context.getMetrics("d1").tightestDelayBudgetMin).toBe(3);
  });

  it("rejects a driver whose every committed stop has a zero budget", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [{ id: "s1", passengerId: "pA", type: "DROP", originalEtaMin: 10 }],
      passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
    });

    const outcome = await operationalStateStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPERATIONAL_NO_FLEXIBILITY");
  });
});
