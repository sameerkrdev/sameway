import { describe, expect, it, vi } from "vitest";

import { OptimizeToursEngine } from "@/optimization/OptimizeToursEngine";
import {
  OptimizerCredentialsMissingError,
  OptimizerUnavailableError,
  type OptimizeToursRequest,
} from "@/optimization/types";

function request(): OptimizeToursRequest {
  return {
    driverId: "d1",
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
  committedPrecedence: [],
    timeoutMs: 400,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unparseableResponse(status: number): Response {
  return new Response("not json {", {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OptimizeToursEngine", () => {
  it("maps a 503 to OptimizerCredentialsMissingError, carrying the proxy's error string", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(503, { error: "no ADC credentials found" })),
      );
    const engine = new OptimizeToursEngine("/api/optimize-tours", fetchImpl);

    const failure = engine.optimize(request());
    await expect(failure).rejects.toBeInstanceOf(OptimizerCredentialsMissingError);
    await expect(failure).rejects.toThrow("no ADC credentials found");
  });

  it("maps a non-2xx status to OptimizerUnavailableError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "solver crashed" }));
    const engine = new OptimizeToursEngine("/api/optimize-tours", fetchImpl);

    await expect(engine.optimize(request())).rejects.toBeInstanceOf(OptimizerUnavailableError);
  });

  it("maps a rejecting fetch to OptimizerUnavailableError with the original error as cause", async () => {
    const networkError = new Error("connection refused");
    const fetchImpl = vi.fn().mockRejectedValue(networkError);
    const engine = new OptimizeToursEngine("/api/optimize-tours", fetchImpl);

    const failure = engine.optimize(request());
    await expect(failure).rejects.toBeInstanceOf(OptimizerUnavailableError);
    await failure.catch((error: unknown) => {
      expect((error as OptimizerUnavailableError).cause).toBe(networkError);
    });
  });

  it("maps a 200 with an unparseable body to OptimizerUnavailableError instead of a fake empty result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(unparseableResponse(200));
    const engine = new OptimizeToursEngine("/api/optimize-tours", fetchImpl);

    await expect(engine.optimize(request())).rejects.toBeInstanceOf(OptimizerUnavailableError);
  });

  it("parses a 200 with a valid body through readOptimizeToursResponse", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        routes: [
          {
            vehicleStartTime: "2026-01-01T00:00:00Z",
            visits: [{ shipmentIndex: 0, isPickup: true, startTime: "2026-01-01T00:05:00Z" }],
            transitions: [{ travelDistanceMeters: 1000, travelDuration: "300s" }],
          },
        ],
        skippedShipments: [],
      }),
    );
    const engine = new OptimizeToursEngine("/api/optimize-tours", fetchImpl);

    const result = await engine.optimize(request());

    expect(result.visits).toHaveLength(1);
    expect(result.visits[0]).toMatchObject({ shipmentId: "ship_p1", type: "PICKUP" });
    expect(result.skippedShipmentIds).toEqual([]);
  });
});
