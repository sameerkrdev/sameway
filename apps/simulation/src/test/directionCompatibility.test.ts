import { describe, expect, it } from "vitest";

import { directionCompatibilityStage } from "@/matching/stages/directionCompatibility";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";

import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function run(input: MakeContextInput) {
  const context = makeContext(input);
  await h3RouteCorridorStage.execute(context);
  const outcome = await directionCompatibilityStage.execute(context);
  return { context, outcome };
}

// Route runs due east from the driver at 77.20 to a drop at 77.40.
const eastbound: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 30, lat: 28.6, lng: 77.4 },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 8 }],
};

describe("directionCompatibility", () => {
  it("passes a request travelling the same way as the route", async () => {
    const { outcome } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.35 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("DIRECTION_COMPATIBLE");
  });

  it("rejects a request travelling back the way the route came", async () => {
    const { outcome } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.3 }, drop: { lat: 28.6, lng: 77.22 } },
      settings: { maxBearingDifferenceDeg: 75 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("BEARING_INCOMPATIBLE");
  });

  it("passes a destination far off the corridor when bearing and progress allow", async () => {
    const { outcome } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.9, lng: 77.31 } },
      settings: { maxBearingDifferenceDeg: 180 },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("DIRECTION_COMPATIBLE");
  });

  it("rejects a destination behind the vehicle even when it is close to the line", async () => {
    const { outcome } = await run({
      ...eastbound,
      driverLocation: { lat: 28.6, lng: 77.3 },
      request: { pickup: { lat: 28.6, lng: 77.32 }, drop: { lat: 28.6, lng: 77.28 } },
      settings: { maxBearingDifferenceDeg: 180 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("DESTINATION_BEHIND_VEHICLE");
  });

  it("passes an idle driver, who has no direction to disagree with", async () => {
    const { outcome } = await run({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.21 }, drop: { lat: 28.4, lng: 77.05 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("passes a same-direction drop extending past the route terminus", async () => {
    const { outcome, context } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.5 } },
      settings: { maxBearingDifferenceDeg: 75 },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(context.getMetrics("d1").corridorExtensionKm).toBeGreaterThan(5);
  });

  it("records direction signals as metrics", async () => {
    const { context } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.35 } },
    });

    const metrics = context.getMetrics("d1");
    expect(metrics.bearingDifferenceDeg).toBeLessThan(10);
    expect(metrics.dropToRouteKm).toBeLessThan(1);
    expect(metrics.dropProgressKm).toBeGreaterThan(metrics.pickupProgressKm ?? 0);
  });
});
