import { describe, expect, it } from "vitest";

import type { Passenger, RideRequest } from "@/domain/entities";
import { buildOptimizeToursRequest } from "@/optimization/ShipmentModelBuilder";
import type { ProposedStop } from "@/matching/types";

function passenger(id: string, pickupBudget: number, dropPercent: number): Passenger {
  return {
    id,
    name: id,
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
    maxPickupDelayMin: pickupBudget,
    maxDropDelayPercent: dropPercent,
  };
}

function stop(id: string, passengerId: string, type: "PICKUP" | "DROP", eta: number): ProposedStop & { originalEtaMin: number } {
  return {
    id,
    passengerId,
    type,
    location: { lat: 28.6, lng: 77.2 },
    seats: 1,
    isNew: false,
    originalEtaMin: eta,
  };
}

const request: RideRequest = {
  id: "req_1",
  passengerId: "pNew",
  seatsRequired: 2,
  pickup: { lat: 28.61, lng: 77.21 },
  drop: { lat: 28.62, lng: 77.22 },
  intermediateStops: [],
  poolingAllowed: true,
  vehiclePreference: "ANY",
  requiresWheelchairAccess: false,
  luggageCount: 0,
  maxWaitMinutes: 8,
  maxWalkingDistanceM: 300,
  priority: 0,
};

const baseInput = {
  driverId: "d1",
  vehicleStart: { lat: 28.6, lng: 77.19 },
  seatCapacity: 4,
  committedStops: [stop("s1", "pA", "PICKUP", 4), stop("s2", "pA", "DROP", 15)],
  passengersById: new Map([["pA", passenger("pA", 5, 50)]]),
  dropBudgetMinByStopId: new Map([["s2", 5.5]]),
  request,
  newPassengerSoftDeadlineMin: 8,
  softDeadlineCostPerHour: 50,
  timeoutMs: 400,
};

describe("buildOptimizeToursRequest", () => {
  it("makes committed passengers mandatory", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(committed.penaltyCost).toBeNull();
  });

  it("makes the new passenger skippable", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const fresh = built.shipments.find((shipment) => shipment.passengerId === "pNew")!;
    expect(fresh.penaltyCost).toBeGreaterThan(0);
    expect(fresh.softPickupDeadlineMin).toBe(8);
    expect(fresh.softDeadlineCostPerHour).toBe(50);
  });

  it("derives hard deadlines from promise, travel floor, and computed drop budget", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(committed.pickupDeadlineMin).toBeGreaterThanOrEqual(9);
    expect(committed.dropDeadlineMin).toBeGreaterThanOrEqual(20.5);
    expect(committed.dropDeadlineMin! - committed.pickupDeadlineMin!).toBeGreaterThanOrEqual(0);
  });

  it("carries the new passenger's seat count into loadDemands", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const fresh = built.shipments.find((shipment) => shipment.passengerId === "pNew")!;
    expect(fresh.seats).toBe(2);
  });

  it("does not lock committed visits — the solver may interleave the new rider", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.lockedVisits).toEqual([]);
    expect(built.committedPrecedence).toEqual([
      { shipmentId: "ship_pA", type: "PICKUP", startMin: 4 },
      { shipmentId: "ship_pA", type: "DROP", startMin: 15 },
    ]);
  });

  it("never emits two shipments with the same id (Google rejects double pickups)", () => {
    expect(() =>
      buildOptimizeToursRequest({
        ...baseInput,
        request: { ...request, passengerId: "pA" },
      }),
    ).toThrow(/already on this ride|already committed/i);
  });

  it("models an onboard passenger as delivery-only (pre-loaded, no pickup)", () => {
    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [stop("s2", "pA", "DROP", 15)],
      passengersById: new Map([["pA", { ...passenger("pA", 5, 50), state: "IN_RIDE" as const }]]),
      dropBudgetMinByStopId: new Map([["s2", 7.5]]),
    });

    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(committed.pickup).toBeUndefined();
    expect(committed.pickupDeadlineMin).toBeUndefined();
    expect(built.lockedVisits).toEqual([]);
  });

  it("keeps a waiting passenger as pickup-delivery beside an onboard drop", () => {
    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [
        stop("sDropA", "pA", "DROP", 10),
        stop("sPickB", "pB", "PICKUP", 14),
        stop("sDropB", "pB", "DROP", 22),
      ],
      passengersById: new Map([
        ["pA", { ...passenger("pA", 5, 50), state: "IN_RIDE" as const }],
        ["pB", passenger("pB", 5, 50)],
      ]),
      dropBudgetMinByStopId: new Map([
        ["sDropA", 5],
        ["sDropB", 4],
      ]),
    });

    expect(built.lockedVisits).toEqual([]);
    const onboard = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    const waiting = built.shipments.find((shipment) => shipment.passengerId === "pB")!;
    expect(onboard.pickup).toBeUndefined();
    expect(waiting.pickup).toEqual({ lat: 28.6, lng: 77.2 });
  });

  it("models multiple onboard passengers without locking visit order", () => {
    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [
        stop("sDropA", "pA", "DROP", 10),
        stop("sDropB", "pB", "DROP", 22),
      ],
      passengersById: new Map([
        ["pA", { ...passenger("pA", 5, 50), state: "IN_RIDE" as const }],
        ["pB", { ...passenger("pB", 5, 50), state: "IN_RIDE" as const }],
      ]),
      dropBudgetMinByStopId: new Map([
        ["sDropA", 5],
        ["sDropB", 11],
      ]),
    });

    expect(built.lockedVisits).toEqual([]);
  });

  it("floors hard deadlines with slack'd travel so Google windows stay reachable", () => {
    const farDrop = stop("s2", "pA", "DROP", 0);
    farDrop.location = { lat: 28.6, lng: 77.5 };

    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [farDrop],
      passengersById: new Map([["pA", { ...passenger("pA", 5, 50), state: "IN_RIDE" as const }]]),
      dropBudgetMinByStopId: new Map([["s2", 8]]),
    });

    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(committed.dropDeadlineMin).toBeGreaterThan(8);
  });

  it("passes the vehicle capacity and timeout through", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.seatCapacity).toBe(4);
    expect(built.timeoutMs).toBe(400);
    expect(built.vehicleStart).toEqual({ lat: 28.6, lng: 77.19 });
  });
});
