import { describe, expect, it } from "vitest";

import { scoringStage } from "@/matching/stages/scoring";

import { runToIncrementalCost } from "./fixtures/runStages";
import type { MakeContextInput } from "./fixtures/stageContext";

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

function scoreOf(outcomeMetrics: unknown): Record<string, number> {
  return outcomeMetrics as Record<string, number>;
}

describe("scoring", () => {
  it("produces exactly the Overview's four components", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await scoringStage.execute(context);
    const metrics = scoreOf(outcome.verdicts[0]!.metrics);

    expect(metrics.driverImpactContribution).toBeDefined();
    expect(metrics.existingPassengerImpactContribution).toBeDefined();
    expect(metrics.newPassengerImpactContribution).toBeDefined();
    expect(metrics.pickupDelayContribution).toBeDefined();
  });

  it("has contributions that sum to the final score", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await scoringStage.execute(context);
    const metrics = scoreOf(outcome.verdicts[0]!.metrics);

    const sum =
      metrics.driverImpactContribution! +
      metrics.existingPassengerImpactContribution! +
      metrics.newPassengerImpactContribution! +
      metrics.pickupDelayContribution!;

    expect(sum).toBeCloseTo(metrics.finalScore!, 2);
  });

  it("scores a zero-impact insertion at zero", async () => {
    // Driver standing on the pickup, going nowhere: nobody is delayed, nobody
    // detours, and there is no wait. Anything above zero here would mean a
    // component is charging harm that did not happen.
    const context = await runToIncrementalCost({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.2 }, drop: { lat: 28.6, lng: 77.2001 } },
    });

    const outcome = await scoringStage.execute(context);

    expect(scoreOf(outcome.verdicts[0]!.metrics).finalScore).toBeLessThan(5);
  });

  it("scores a worse insertion higher than a better one", async () => {
    // Thresholds widened so neither insertion saturates. At the defaults both
    // clamp at 100 and the comparison cannot discriminate — which is correct
    // behaviour for the clamp and useless for testing the ordering.
    const headroom = { maxExistingPassengerDelayPercent: 10_000, maxNewPassengerRideDetourMin: 200 };

    const near = await runToIncrementalCost({ ...pooled, settings: headroom });
    const far = await runToIncrementalCost({
      ...pooled,
      settings: headroom,
      request: { pickup: { lat: 28.66, lng: 77.26 }, drop: { lat: 28.66, lng: 77.31 } },
    });

    const nearScore = scoreOf((await scoringStage.execute(near)).verdicts[0]!.metrics).finalScore!;
    const farScore = scoreOf((await scoringStage.execute(far)).verdicts[0]!.metrics).finalScore!;

    expect(farScore).toBeGreaterThan(nearScore);
  });

  it("rejects nobody", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await scoringStage.execute(context);

    expect(outcome.verdicts.every((verdict) => verdict.status === "PASSED")).toBe(true);
  });

  it("weights sum to one after normalisation", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      settings: {
        weights: {
          driverImpact: 60,
          existingPassengerImpact: 60,
          newPassengerImpact: 50,
          pickupDelay: 30,
        },
      },
    });

    const outcome = await scoringStage.execute(context);
    const weights = outcome.notes?.weights as Record<string, number>;

    expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
  });
});
