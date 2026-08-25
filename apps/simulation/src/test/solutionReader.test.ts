import { describe, expect, it } from "vitest";

import { readOptimizeToursResponse, toProposedStopSequence } from "@/optimization/SolutionReader";
import type { OptimizeToursRequest } from "@/optimization/types";

const request: OptimizeToursRequest = {
  driverId: "d1",
  vehicleStart: { lat: 28.6, lng: 77.19 },
  seatCapacity: 4,
  shipments: [
    {
      id: "ship_pA",
      passengerId: "pA",
      pickup: { lat: 28.61, lng: 77.2 },
      drop: { lat: 28.63, lng: 77.24 },
      seats: 1,
      penaltyCost: null,
    },
    {
      id: "ship_pNew",
      passengerId: "pNew",
      pickup: { lat: 28.62, lng: 77.22 },
      drop: { lat: 28.64, lng: 77.26 },
      seats: 1,
      penaltyCost: 1000,
    },
  ],
  lockedVisits: [],
  committedPrecedence: [],
  timeoutMs: 400,
};

function response(): unknown {
  return {
    routes: [
      {
        visits: [
          { shipmentIndex: 0, isPickup: true, startTime: "1970-01-01T00:04:00Z" },
          { shipmentIndex: 1, isPickup: true, startTime: "1970-01-01T00:07:00Z" },
          { shipmentIndex: 0, isPickup: false, startTime: "1970-01-01T00:15:00Z" },
          { shipmentIndex: 1, isPickup: false, startTime: "1970-01-01T00:21:00Z" },
        ],
        transitions: [
          { travelDistanceMeters: 1400, travelDuration: "240s" },
          { travelDistanceMeters: 1000, travelDuration: "180s" },
          { travelDistanceMeters: 3500, travelDuration: "480s" },
          { travelDistanceMeters: 3000, travelDuration: "360s" },
        ],
        vehicleStartTime: "1970-01-01T00:00:00Z",
      },
    ],
    skippedShipments: [],
  };
}

describe("readOptimizeToursResponse", () => {
  it("reads visits in solver order with their passenger and type", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.visits.map((visit) => `${visit.passengerId}:${visit.type}`)).toEqual([
      "pA:PICKUP",
      "pNew:PICKUP",
      "pA:DROP",
      "pNew:DROP",
    ]);
  });

  it("converts transitions into one leg per visit", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.legs).toHaveLength(4);
    expect(result.legs[0]).toEqual({ distanceKm: 1.4, durationMin: 4 });
    expect(result.legs[2]).toEqual({ distanceKm: 3.5, durationMin: 8 });
  });

  it("totals distance and duration across the route", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.totalDistanceKm).toBeCloseTo(8.9, 5);
    expect(result.totalDurationMin).toBeCloseTo(21, 5);
  });

  it("reads arrival minutes relative to the vehicle start time", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.visits.map((visit) => visit.arrivalMin)).toEqual([4, 7, 15, 21]);
  });

  it("reports a skipped shipment by id", () => {
    const body = response() as { skippedShipments: unknown[] };
    body.skippedShipments = [{ index: 1, reasons: [{ code: "DEMAND_EXCEEDS_VEHICLE_CAPACITY" }] }];

    const result = readOptimizeToursResponse(request, body);
    expect(result.skippedShipmentIds).toEqual(["ship_pNew"]);
  });

  it("throws when the transition count cannot be mapped onto the visits", () => {
    const body = response() as { routes: { transitions: unknown[] }[] };
    body.routes[0]!.transitions = body.routes[0]!.transitions.slice(0, 2);

    expect(() => readOptimizeToursResponse(request, body)).toThrow(/transition/i);
  });

  it("returns an empty route when the solver produced none", () => {
    const result = readOptimizeToursResponse(request, { routes: [], skippedShipments: [] });

    expect(result.visits).toEqual([]);
    expect(result.legs).toEqual([]);
    expect(result.totalDistanceKm).toBe(0);
  });

  it("throws when a transition's travel duration cannot be parsed", () => {
    const body = response() as { routes: { transitions: { travelDuration: string }[] }[] };
    body.routes[0]!.transitions[0]!.travelDuration = "not-a-duration";

    expect(() => readOptimizeToursResponse(request, body)).toThrow(/not-a-duration/);
  });

  it("throws when a transition's travel distance is not a finite number", () => {
    const body = response() as { routes: { transitions: { travelDistanceMeters: unknown }[] }[] };
    body.routes[0]!.transitions[0]!.travelDistanceMeters = "not-a-number";

    expect(() => readOptimizeToursResponse(request, body)).toThrow(/not-a-number/);
  });

  it("treats omitted shipmentIndex and isPickup as protobuf defaults (0 / false)", () => {
    const singleShipmentRequest: OptimizeToursRequest = {
      ...request,
      shipments: [request.shipments[0]!],
    };
    const body = {
      routes: [
        {
          visits: [
            { isPickup: true, startTime: "1970-01-01T00:04:00Z" },
            { startTime: "1970-01-01T00:15:00Z" },
          ],
          transitions: [
            { travelDistanceMeters: 1400, travelDuration: "240s" },
            { travelDistanceMeters: 3500, travelDuration: "480s" },
          ],
          vehicleStartTime: "1970-01-01T00:00:00Z",
        },
      ],
      skippedShipments: [],
    };

    const result = readOptimizeToursResponse(singleShipmentRequest, body);

    expect(result.visits.map((visit) => `${visit.passengerId}:${visit.type}`)).toEqual([
      "pA:PICKUP",
      "pA:DROP",
    ]);
  });
});

describe("toProposedStopSequence", () => {
  it("marks only the new passenger's stops as new", () => {
    const result = readOptimizeToursResponse(request, response());
    const stops = toProposedStopSequence(result, "pNew");

    expect(stops.map((stop) => stop.isNew)).toEqual([false, true, false, true]);
    expect(stops.map((stop) => stop.id)).toEqual([
      "ship_pA:PICKUP",
      "ship_pNew:PICKUP",
      "ship_pA:DROP",
      "ship_pNew:DROP",
    ]);
  });
});
