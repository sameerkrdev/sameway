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
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayPercent: 50 }],
    });

    const outcome = await operationalStateStage.execute(context);
    const budgets = (outcome.notes?.budgetsByDriver as Record<string, unknown[]>).d1;

    expect(budgets).toHaveLength(2);
  });

  it("uses pickup minutes and a drop percent of solo trip ETA", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayPercent: 50 }],
    });

    const outcome = await operationalStateStage.execute(context);
    const budgets = (
      outcome.notes?.budgetsByDriver as Record<
        string,
        { stopId: string; budgetMin: number; soloEtaMin: number }[]
      >
    ).d1!;

    expect(budgets.find((entry) => entry.stopId === "s1")!.budgetMin).toBe(5);
    expect(budgets.find((entry) => entry.stopId === "s2")!.soloEtaMin).toBe(11);
    expect(budgets.find((entry) => entry.stopId === "s2")!.budgetMin).toBe(5.5);
  });

  it("applies 250% on short solo trips", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 2 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 6 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayPercent: 50 }],
    });

    const outcome = await operationalStateStage.execute(context);
    const dropBudget = (
      outcome.notes?.budgetsByDriver as Record<string, { stopId: string; budgetMin: number }[]>
    ).d1!.find((entry) => entry.stopId === "s2")!;

    expect(dropBudget.budgetMin).toBe(10);
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
        { id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 30 },
        { id: "pB", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 60 },
      ],
    });

    await operationalStateStage.execute(context);

    expect(context.getMetrics("d1").tightestDelayBudgetMin).toBe(3);
  });

  it("rejects a driver whose every committed stop has a zero budget", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [{ id: "s1", passengerId: "pA", type: "DROP", originalEtaMin: 10 }],
      passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 0, maxDropDelayPercent: 0 }],
    });

    const outcome = await operationalStateStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPERATIONAL_NO_FLEXIBILITY");
  });
});
