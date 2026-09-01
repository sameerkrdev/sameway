import { describe, expect, it } from "vitest";

import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { incrementalCostStage } from "@/matching/stages/incrementalCost";
import { operationalStateStage } from "@/matching/stages/operationalState";
import { roadRoutingStage } from "@/matching/stages/roadRouting";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";

import { makeContext, type MakeContextInput } from "./fixtures/stageContext";
import { StubOptimizerEngine } from "./fixtures/stubOptimizer";

async function run(input: MakeContextInput) {
  const context = makeContext({ optimizer: new StubOptimizerEngine(), ...input });
  await h3RouteCorridorStage.execute(context);
  await operationalStateStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  await detourLowerBoundStage.execute(context);
  await roadRoutingStage.execute(context);
  const outcome = await incrementalCostStage.execute(context);
  return { context, outcome };
}

const pooled: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayPercent: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
};

describe("incrementalCost", () => {
  it("rejects nobody — it only measures", async () => {
    const { outcome } = await run(pooled);

    expect(outcome.verdicts.every((verdict) => verdict.status === "PASSED")).toBe(true);
  });

  it("measures the driver's added distance and duration", async () => {
    const { context } = await run(pooled);
    const metrics = context.getMetrics("d1");

    // Compared at the precision the metrics are rounded to. additionalDistanceKm
    // is the rounded true difference, which is not the same number as the
    // difference of the two rounded totals, and demanding they match to 1e-5
    // would only be asserting that no rounding happened.
    expect(metrics.additionalDistanceKm).toBeCloseTo(
      (metrics.newDistanceKm ?? 0) - (metrics.originalDistanceKm ?? 0),
      2,
    );
    expect(metrics.additionalDurationMin).toBeGreaterThanOrEqual(0);
  });

  it("computes detour percent against the baseline distance", async () => {
    const { context } = await run(pooled);
    const metrics = context.getMetrics("d1");

    expect(metrics.detourPercent).toBeCloseTo(
      ((metrics.additionalDistanceKm ?? 0) / (metrics.originalDistanceKm ?? 1)) * 100,
      2,
    );
  });

  it("reports zero detour for an idle driver, who has nothing to detour from", async () => {
    const { context } = await run({
      driverId: "d2",
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.21 }, drop: { lat: 28.6, lng: 77.28 } },
    });

    expect(context.getMetrics("d2").detourPercent).toBe(0);
  });

  it("measures each existing passenger's delay and the worst of them", async () => {
    const { context } = await run(pooled);
    const metrics = context.getMetrics("d1");

    expect(metrics.maximumExistingPassengerDelayMin).toBeGreaterThanOrEqual(0);
  });

  it("measures committed delay from arrivals that share a key space", async () => {
    // The guard against a silent zero. `maximumExistingPassengerDelayMin` must
    // be a real subtraction of two looked-up arrivals, not the 0 that a missing
    // key produces. Both maps have to hold the committed stop id for that to
    // be true.
    const { context } = await run(pooled);
    const solution = context.getSolution("d1")!;

    const before = solution.baselineArrivalByStopId.get("s2");
    const after = solution.arrivalByStopId.get("s2");

    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(context.getMetrics("d1").maximumExistingPassengerDelayMin).toBeCloseTo(
      after! - before!,
      2,
    );
  });

  it("allows the solver to reorder committed stops when that shortens the route", () => {
    return run(pooled).then(({ context }) => {
      const solution = context.getSolution("d1")!;
      const committed = solution.stops.filter((entry) => !entry.isNew);

      const anyMoved = committed.some((stop) => {
        const before = solution.baselineArrivalByStopId.get(stop.id)!;
        const after = solution.arrivalByStopId.get(stop.id)!;
        return Math.abs(after - before) > 0.01;
      });

      // Without locked visits the stub optimizer picks the shortest legal
      // ordering; committed arrivals may shift within each passenger's budget.
      expect(anyMoved || context.getMetrics("d1").maximumExistingPassengerDelayMin === 0).toBe(
        true,
      );
    });
  });

  it("measures the new rider's own detour against a solo trip", async () => {
    const { context } = await run(pooled);

    expect(context.getMetrics("d1").newPassengerRideDetourMin).toBeGreaterThanOrEqual(0);
  });

  it("publishes an insertion result for the map and detail sheet", async () => {
    const { context } = await run(pooled);

    expect(context.getMetrics("d1").newDistanceKm).toBeGreaterThan(0);
  });
});
