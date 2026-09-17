import { describe, expect, it } from "vitest";

import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { pickupRouteDistanceStage } from "@/matching/stages/pickupRouteDistance";

import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function runWithCorridor(input: MakeContextInput) {
  const context = makeContext(input);
  await h3RouteCorridorStage.execute(context);
  const outcome = await pickupRouteDistanceStage.execute(context);
  return { context, outcome };
}

const eastbound: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 20, lat: 28.6, lng: 77.3 },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 8 }],
};

describe("pickupRouteDistance", () => {
  it("passes a pickup sitting on the route", async () => {
    const { outcome } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("PICKUP_ON_ROUTE");
  });

  it("rejects a pickup far off the route", async () => {
    const { outcome } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.75, lng: 77.25 } },
      settings: { maxPickupToRouteDistanceKm: 1.5 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("PICKUP_TOO_FAR_FROM_ROUTE");
  });

  it("attaches both the measurement and the threshold", async () => {
    const { outcome } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.75, lng: 77.25 } },
      settings: { maxPickupToRouteDistanceKm: 1.5 },
    });

    const rejection = outcome.verdicts[0]!.reasons[0]!;
    expect(rejection.threshold).toBe(1.5);
    expect(Number(rejection.value)).toBeGreaterThan(1.5);
  });

  it("records the distance as a metric", async () => {
    const { context } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    expect(context.getMetrics("d1").pickupToRouteKm).toBeLessThan(0.2);
  });

  it("measures from the driver's position for an idle driver", async () => {
    const { context, outcome } = await runWithCorridor({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.21 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(context.getMetrics("d2").pickupToRouteKm).toBeGreaterThan(0);
  });
});
