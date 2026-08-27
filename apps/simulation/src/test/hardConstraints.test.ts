import { describe, expect, it } from "vitest";

import { hardConstraintsStage } from "@/matching/stages/hardConstraints";
import type {
  OptimizerEngine,
  OptimizeToursRequest,
  OptimizeToursResult,
} from "@/optimization/types";

import { runToIncrementalCost } from "./fixtures/runStages";
import type { MakeContextInput } from "./fixtures/stageContext";
import { StubOptimizerEngine } from "./fixtures/stubOptimizer";

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

/**
 * A solver that returns a route regardless of the time windows it was given.
 *
 * Stands in for the case stage 10 exists to catch: a provider that hands back
 * something breaching a promise we made. The honest stub refuses such a model
 * outright, which is correct of it and useless for testing the backstop.
 */
class DeadlineBlindOptimizerEngine implements OptimizerEngine {
  readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
  private readonly inner = new StubOptimizerEngine();

  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    return this.inner.optimize({
      ...request,
      shipments: request.shipments.map((shipment) => {
        const { pickupDeadlineMin, dropDeadlineMin, ...rest } = shipment;
        void pickupDeadlineMin;
        void dropDeadlineMin;
        return rest;
      }),
    });
  }
}

/** Wide enough that only the limit under test can be the one that fires. */
const permissive = {
  maxCorridorExtensionKm: 10000,
  maxAdditionalDurationMin: 10000,
  maxExistingPassengerDelayMin: 10000,
  maxNewPassengerPickupDelayMin: 10000,
  maxNewPassengerRideDetourMin: 10000,
};

const eastboundExtension: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 30, lat: 28.6, lng: 77.4 },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 30, maxDropDelayMin: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.5 } },
};

describe("hardConstraints", () => {
  it("passes a route within every limit", async () => {
    const context = await runToIncrementalCost({ ...pooled, settings: permissive });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("ROUTE_FEASIBLE");
  });

  it("passes ordinary pooling without a detour-percent or added-km cap", async () => {
    const context = await runToIncrementalCost({ ...pooled, settings: permissive });
    context.recordMetrics("d1", {
      detourPercent: 50,
      additionalDistanceKm: 10,
      corridorExtensionKm: 0,
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("passes a same-direction corridor extension under the extension cap", async () => {
    const context = await runToIncrementalCost({
      ...eastboundExtension,
      settings: { ...permissive, maxCorridorExtensionKm: 15 },
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect((context.getMetrics("d1").corridorExtensionKm ?? 0)).toBeGreaterThan(5);
  });

  it("rejects a corridor extension that exceeds maxCorridorExtensionKm", async () => {
    const context = await runToIncrementalCost({
      ...eastboundExtension,
      settings: { ...permissive, maxCorridorExtensionKm: 1 },
    });
    context.recordMetrics("d1", {
      corridorExtensionKm: 10,
      additionalDistanceKm: 10,
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("CORRIDOR_EXTENSION_TOO_LONG");
  });

  it("rejects on an existing passenger's own budget, not the global ceiling", async () => {
    // Driven by a solver that ignores deadlines, which is the whole reason this
    // check is kept. With the honest stub the solver enforces the same budget
    // and returns OPTIMIZER_INFEASIBLE first, so stage 10 is never reached and
    // the re-check would be untested. A solver that hands back a route
    // breaching a promise is exactly what stage 10 is a backstop against.
    const context = await runToIncrementalCost({
      ...pooled,
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
      settings: permissive,
      optimizer: new DeadlineBlindOptimizerEngine(),
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("EXISTING_PASSENGER_DELAY_TOO_HIGH");
    // The personal budget is what fired, even though the global ceiling is wide
    // open — the rejection has to name the promise that was actually broken.
    expect(outcome.verdicts[0]!.reasons[0]!.threshold).toBe(0);
  });

  it("rejects a pool the vehicle is not configured for", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      vehicle: { poolingEnabled: false },
      settings: permissive,
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("POOLING_NOT_SUPPORTED");
  });

  it("does not apply pooling rules to a solo ride", async () => {
    const context = await runToIncrementalCost({
      driverId: "d2",
      committedStops: [],
      passengers: [],
      vehicle: { poolingEnabled: false },
      request: { pickup: { lat: 28.6, lng: 77.21 }, drop: { lat: 28.6, lng: 77.28 } },
      settings: permissive,
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("rejects a pool larger than the configured maximum", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      settings: { ...permissive, maxPooledPassengers: 1 },
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("MAX_POOLED_PASSENGERS_EXCEEDED");
  });
});
