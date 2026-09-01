import { describe, expect, it } from "vitest";

import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { operationalStateStage } from "@/matching/stages/operationalState";
import { roadRoutingStage } from "@/matching/stages/roadRouting";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";
import {
  OptimizerBudgetExceededError,
  OptimizerCredentialsMissingError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "@/optimization/types";

import { makeContext, type MakeContextInput } from "./fixtures/stageContext";
import { StubOptimizerEngine } from "./fixtures/stubOptimizer";

async function run(input: MakeContextInput & { optimizer?: OptimizerEngine }) {
  const context = makeContext(input);
  await h3RouteCorridorStage.execute(context);
  await operationalStateStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  await detourLowerBoundStage.execute(context);
  const outcome = await roadRoutingStage.execute(context);
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

describe("roadRouting", () => {
  it("produces a solved route with one leg per stop", async () => {
    const { context, outcome } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    const solution = context.getSolution("d1")!;
    expect(solution.legs).toHaveLength(solution.stops.length);
  });

  it("keeps the new rider's pickup before their drop", async () => {
    const { context } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    const ids = context.getSolution("d1")!.stops.map((stop) => `${stop.passengerId}:${stop.type}`);
    expect(ids.indexOf("pNew:PICKUP")).toBeLessThan(ids.indexOf("pNew:DROP"));
  });

  it("records an arrival time for every stop", async () => {
    const { context } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    const solution = context.getSolution("d1")!;
    for (const stop of solution.stops) {
      expect(solution.arrivalByStopId.get(stop.id)).toBeGreaterThan(0);
    }
  });

  it("computes a baseline for the pre-insertion route", async () => {
    const { context } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    const solution = context.getSolution("d1")!;
    expect(solution.baselineDistanceKm).toBeGreaterThan(0);
    expect(solution.totalDistanceKm).toBeGreaterThanOrEqual(solution.baselineDistanceKm);
  });

  it("rejects with OPTIMIZER_INFEASIBLE when the new rider is skipped", async () => {
    class SkippingEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
        const newShipment = request.shipments.find((shipment) => shipment.penaltyCost !== null)!;
        return Promise.resolve({
          visits: [],
          legs: [],
          totalDistanceKm: 0,
          totalDurationMin: 0,
          skippedShipmentIds: [newShipment.id],
        });
      }
    }

    const { outcome } = await run({ ...pooled, optimizer: new SkippingEngine() });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPTIMIZER_INFEASIBLE");
  });

  it("reports NOT_EVALUATED when the optimizer budget is exhausted", async () => {
    class BrokeEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(): Promise<OptimizeToursResult> {
        return Promise.reject(new OptimizerBudgetExceededError(0));
      }
    }

    const { outcome } = await run({ ...pooled, optimizer: new BrokeEngine() });

    expect(outcome.verdicts[0]!.status).toBe("NOT_EVALUATED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPTIMIZER_BUDGET_EXCEEDED");
  });

  it("propagates a credentials failure rather than turning it into a verdict", async () => {
    class UnauthenticatedEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(): Promise<OptimizeToursResult> {
        return Promise.reject(new OptimizerCredentialsMissingError("no ADC"));
      }
    }

    await expect(run({ ...pooled, optimizer: new UnauthenticatedEngine() })).rejects.toBeInstanceOf(
      OptimizerCredentialsMissingError,
    );
  });

  it("fails with a SYSTEM reason if the solver drops a committed passenger", async () => {
    class BadEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
        const mandatory = request.shipments.find((shipment) => shipment.penaltyCost === null)!;
        return Promise.resolve({
          visits: [],
          legs: [],
          totalDistanceKm: 0,
          totalDurationMin: 0,
          skippedShipmentIds: [mandatory.id],
        });
      }
    }

    const { outcome } = await run({ ...pooled, optimizer: new BadEngine() });

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED");
  });

  it("passes stage 7's best sequence as a first-solution hint", async () => {
    const optimizer = new StubOptimizerEngine();
    await run({ ...pooled, optimizer });

    const sent = optimizer.requests[0]!;
    expect(sent.firstSolutionVisits?.length).toBeGreaterThan(0);
    expect(sent.firstSolutionVisits!.some((visit) => visit.shipmentId.includes("pNew"))).toBe(
      true,
    );
    expect(sent.lockedVisits).toEqual([]);
    expect(sent.committedPrecedence.length).toBeGreaterThan(0);
  });

  it("models an onboard passenger as delivery-only so the injected hint stays Google-valid", async () => {
    const optimizer = new StubOptimizerEngine();
    const { context, outcome } = await run({
      driverId: "d1",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
      ],
      passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 30, maxDropDelayPercent: 30 }],
      request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
      optimizer,
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");

    const sent = optimizer.requests[0]!;
    const onboard = sent.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(onboard.pickup).toBeUndefined();

    const onboardHint = (sent.firstSolutionVisits ?? []).filter(
      (visit) => visit.shipmentId === onboard.id,
    );
    expect(onboardHint.some((visit) => visit.type === "DROP")).toBe(true);
    expect(onboardHint.some((visit) => visit.type === "PICKUP")).toBe(false);

    const ids = context.getSolution("d1")!.stops.map((stop) => `${stop.passengerId}:${stop.type}`);
    expect(ids).not.toContain("pA:PICKUP");
    expect(ids).toContain("pA:DROP");
  });
});

describe("roadRouting stop identity", () => {
  it("keys committed stops by their scenario ids, not the solver's shipment ids", async () => {
    // The baseline arrivals are keyed by committed stop id. If the solved
    // stops kept the solver's own ids the two maps would never intersect, and
    // every existing-passenger delay would silently measure zero.
    const { context } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });
    const solution = context.getSolution("d1")!;

    const committedIds = solution.stops.filter((stop) => !stop.isNew).map((stop) => stop.id);
    expect(committedIds.sort()).toEqual(["s1", "s2"]);

    for (const id of committedIds) {
      expect(solution.arrivalByStopId.has(id)).toBe(true);
      expect(solution.baselineArrivalByStopId.has(id)).toBe(true);
    }
  });
});
