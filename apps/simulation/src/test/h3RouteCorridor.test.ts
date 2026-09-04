import { describe, expect, it } from "vitest";

import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";

import { makeContext } from "./fixtures/stageContext";

// A ride running due east from lng 77.10 to 77.30, driver currently at 77.20.
const eastboundRide = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    {
      id: "s1",
      passengerId: "pA",
      type: "PICKUP" as const,
      originalEtaMin: 0,
      lat: 28.6,
      lng: 77.1,
    },
    {
      id: "s2",
      passengerId: "pA",
      type: "DROP" as const,
      originalEtaMin: 20,
      lat: 28.6,
      lng: 77.3,
    },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE" as const, maxPickupDelayMin: 5, maxDropDelayPercent: 8 }],
};

describe("h3RouteCorridor", () => {
  it("accepts a pickup on the remaining route ahead of the vehicle", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.candidateDriverIds).toContain("d1");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("CORRIDOR_MATCH");
  });

  it("rejects a pickup on the historical route behind the vehicle", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.11 } },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.candidateDriverIds ?? []).not.toContain("d1");
  });

  it("finds an idle driver near the pickup", async () => {
    const context = makeContext({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.2 } },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.candidateDriverIds).toContain("d2");
  });

  it("records the discovered ring as a unitless hop count", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    await h3RouteCorridorStage.execute(context);
    const metrics = context.getMetrics("d1");

    expect(metrics.discoveredRing).toBe(0);
    expect(metrics.h3GridDistance).toBe(0);
    expect(metrics.straightLineKm).toBeGreaterThan(0);
  });

  it("exposes the corridor to later stages", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    await h3RouteCorridorStage.execute(context);

    expect(context.getCorridor("d1")!.remainingStops.map((stop) => stop.id)).toEqual(["s2"]);
  });

  it("reports the ring at which the search stopped", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
      settings: { minimumUsableCandidates: 1 },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.notes?.stoppedAtRing).toBe(0);
    expect(outcome.notes?.searchExhausted).toBe(false);
  });
});
