import { describe, expect, it } from "vitest";

import { InstrumentedOptimizerEngine } from "@/optimization/InstrumentedOptimizerEngine";
import { OptimizerCache } from "@/optimization/OptimizerCache";
import { OptimizerTelemetry } from "@/optimization/OptimizerTelemetry";
import {
  OptimizerBudgetExceededError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "@/optimization/types";

class CountingEngine implements OptimizerEngine {
  readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
  calls = 0;

  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    this.calls += 1;
    return Promise.resolve({
      visits: [],
      legs: [],
      totalDistanceKm: request.shipments.length,
      totalDurationMin: 0,
      skippedShipmentIds: [],
    });
  }
}

function request(driverId: string): OptimizeToursRequest {
  return {
    driverId,
    vehicleStart: { lat: 28.6, lng: 77.2 },
    seatCapacity: 4,
    shipments: [
      {
        id: "ship_p1",
        passengerId: "p1",
        pickup: { lat: 28.61, lng: 77.21 },
        drop: { lat: 28.62, lng: 77.22 },
        seats: 1,
        penaltyCost: null,
      },
    ],
    lockedVisits: [],
    timeoutMs: 400,
  };
}

function stack(limit: number) {
  const delegate = new CountingEngine();
  const telemetry = new OptimizerTelemetry("GOOGLE_OPTIMIZE_TOURS", limit);
  const cache = new OptimizerCache();
  const engine = new InstrumentedOptimizerEngine(delegate, cache, telemetry);
  return { delegate, telemetry, cache, engine };
}

describe("InstrumentedOptimizerEngine", () => {
  it("serves an identical request from cache without calling the delegate twice", async () => {
    const { delegate, engine, telemetry } = stack(10);

    await engine.optimize(request("d1"));
    await engine.optimize(request("d1"));

    expect(delegate.calls).toBe(1);
    expect(telemetry.snapshot().cacheHits).toBe(1);
    expect(telemetry.snapshot().cacheMisses).toBe(1);
  });

  it("treats a different driver as a different request", async () => {
    const { delegate, engine } = stack(10);

    await engine.optimize(request("d1"));
    await engine.optimize(request("d2"));

    expect(delegate.calls).toBe(2);
  });

  it("counts billed shipments, not just calls", async () => {
    const { engine, telemetry } = stack(10);

    await engine.optimize(request("d1"));

    expect(telemetry.snapshot().calls).toBe(1);
    expect(telemetry.snapshot().shipmentsBilled).toBe(1);
  });

  it("throws OptimizerBudgetExceededError past the limit", async () => {
    const { engine } = stack(1);

    await engine.optimize(request("d1"));

    await expect(engine.optimize(request("d2"))).rejects.toBeInstanceOf(
      OptimizerBudgetExceededError,
    );
  });

  it("does not spend budget on a cache hit", async () => {
    const { engine, telemetry } = stack(1);

    await engine.optimize(request("d1"));
    await engine.optimize(request("d1"));

    expect(telemetry.snapshot().budgetRemaining).toBe(0);
    expect(telemetry.snapshot().budgetUsed).toBe(1);
  });
});
