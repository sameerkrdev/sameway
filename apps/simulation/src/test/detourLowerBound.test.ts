import { describe, expect, it } from "vitest";

import { pathLengthKm } from "@/lib/geo";
import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { directionCompatibilityStage } from "@/matching/stages/directionCompatibility";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";
import { MockRoutingEngine } from "@/routing";

import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function run(input: MakeContextInput) {
  const context = makeContext(input);
  await h3RouteCorridorStage.execute(context);
  await directionCompatibilityStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  const outcome = await detourLowerBoundStage.execute(context);
  return { context, outcome };
}

const onRoute: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.35 },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 20 }],
  request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.32 } },
};

describe("detourLowerBound", () => {
  it("passes a request that barely lengthens the route", async () => {
    const { outcome, context } = await run(onRoute);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(context.getMetrics("d1").lowerBoundAdditionalKm).toBeLessThan(1);
  });

  it("does not reject a long corridor extension on straight-line distance alone", async () => {
    const { outcome } = await run({
      driverId: "d1",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.35 },
      ],
      passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 20 }],
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.55 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("LOWER_BOUND_OK");
  });

  it("does not reject ordinary off-corridor pooling on added distance alone", async () => {
    const { outcome } = await run({
      ...onRoute,
      request: { pickup: { lat: 28.9, lng: 77.25 }, drop: { lat: 28.95, lng: 77.32 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("shortlists no more sequences than maxRoutedInsertionsPerDriver", async () => {
    const { context } = await run({
      driverId: "d1",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
        { id: "s2", passengerId: "pB", type: "PICKUP", originalEtaMin: 6, lat: 28.6, lng: 77.24 },
        { id: "s3", passengerId: "pA", type: "DROP", originalEtaMin: 18, lat: 28.6, lng: 77.3 },
        { id: "s4", passengerId: "pB", type: "DROP", originalEtaMin: 24, lat: 28.6, lng: 77.34 },
      ],
      passengers: [
        { id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayPercent: 30 },
        { id: "pB", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayPercent: 30 },
      ],
      vehicle: { totalSeats: 6 },
      settings: { maxRoutedInsertionsPerDriver: 3 },
      request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
    });

    expect(context.getSequences("d1").length).toBeLessThanOrEqual(3);
    expect(context.getMetrics("d1").shortlistedSequences).toBe(context.getSequences("d1").length);
  });

  it("keeps the cheapest sequence when shortlisting", async () => {
    const { context } = await run({ ...onRoute, settings: { maxRoutedInsertionsPerDriver: 1 } });

    expect(context.getSequences("d1")).toHaveLength(1);
  });

  it("never estimates a straight-line bound above the road distance for the same sequence", async () => {
    const context = makeContext(onRoute);
    await h3RouteCorridorStage.execute(context);
    await stopSequenceGenerationStage.execute(context);

    const corridor = context.getCorridor("d1")!;
    const start = corridor.polyline[0]!;
    const routing = new MockRoutingEngine();

    const baselineStraightKm = pathLengthKm(corridor.polyline);
    const baselineRoad = await routing.getRoute(corridor.polyline);

    for (const candidate of context.getSequences("d1")) {
      const points = [start, ...candidate.stops.map((stop) => stop.location)];

      const boundAddedKm = pathLengthKm(points) - baselineStraightKm;
      const routed = await routing.getRoute(points);
      const roadAddedKm = routed.distanceKm - baselineRoad.distanceKm;

      expect(boundAddedKm).toBeLessThanOrEqual(roadAddedKm + 1e-9);
    }
  });
});

describe("detourLowerBound and idle drivers", () => {
  it("does not treat an idle driver's whole fare as a detour", async () => {
    const { outcome } = await run({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.21 }, drop: { lat: 28.6, lng: 77.6 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("LOWER_BOUND_OK");
  });
});
