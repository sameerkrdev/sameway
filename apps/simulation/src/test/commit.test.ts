import { describe, expect, it } from "vitest";

import { commitStage } from "@/matching/stages/commit";
import type { CommitPlan } from "@/matching/types";

import { runToIncrementalCost } from "./fixtures/runStages";
import type { MakeContextInput } from "./fixtures/stageContext";

const pooled: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
};

function planFor(notes: Record<string, unknown> | undefined, driverId: string): CommitPlan {
  return (notes?.plansByDriver as Record<string, CommitPlan>)[driverId]!;
}

describe("commit", () => {
  it("builds a plan containing every stop of the winning sequence", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    expect(planFor(outcome.notes, "d1").stops).toHaveLength(
      context.getSolution("d1")!.stops.length,
    );
  });

  it("re-stamps originalEtaMin from the solved arrival times", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    const solution = context.getSolution("d1")!;
    for (const stop of planFor(outcome.notes, "d1").stops) {
      expect(stop.originalEtaMin).toBeCloseTo(solution.arrivalByStopId.get(stop.id)!, 5);
    }
  });

  it("re-stamps promises forward, not from the stale committed values", async () => {
    // The rolling-horizon property. A committed stop's promise was 3 and 25
    // minutes; after this insertion it must carry what the solver just said,
    // or the next request's delay maths is measured against a promise two
    // insertions out of date.
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    const stamped = new Map(
      planFor(outcome.notes, "d1").stops.map((stop) => [stop.id, stop.originalEtaMin]),
    );

    expect(stamped.get("s1")).not.toBe(3);
    expect(stamped.get("s2")).not.toBe(25);
    expect(stamped.get("s1")!).toBeLessThan(stamped.get("s2")!);
  });

  it("names the request being consumed and the passenger being added", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);
    const plan = planFor(outcome.notes, "d1");

    expect(plan.requestId).toBe("req_1");
    expect(plan.passengerId).toBe("pNew");
  });

  it("does not mutate the scenario", async () => {
    const context = await runToIncrementalCost(pooled);
    const before = structuredClone(context.scenario);

    await commitStage.execute(context);

    expect(context.scenario).toEqual(before);
  });

  it("rejects nobody", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    expect(outcome.verdicts.every((verdict) => verdict.status === "PASSED")).toBe(true);
  });

  it("carries the new rider's two stops into the committed sequence", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);
    const plan = planFor(outcome.notes, "d1");

    expect(plan.stops).toHaveLength(4);
    expect(plan.stops.filter((stop) => stop.passengerId === "pNew")).toHaveLength(2);
  });
});
