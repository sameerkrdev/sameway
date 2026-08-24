import { describe, expect, it } from "vitest";

import type { Passenger, RideRequest } from "@/domain/entities";
import { buildOptimizeToursRequest } from "@/optimization/ShipmentModelBuilder";
import type { ProposedStop } from "@/matching/types";

function passenger(id: string, pickupBudget: number, dropBudget: number): Passenger {
  return {
    id,
    name: id,
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
    maxPickupDelayMin: pickupBudget,
    maxDropDelayMin: dropBudget,
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
  maxDetourPercent: 15,
  maxWalkingDistanceM: 300,
  priority: 0,
};

const baseInput = {
  driverId: "d1",
  vehicleStart: { lat: 28.6, lng: 77.19 },
  seatCapacity: 4,
  committedStops: [stop("s1", "pA", "PICKUP", 4), stop("s2", "pA", "DROP", 15)],
  passengersById: new Map([["pA", passenger("pA", 5, 8)]]),
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

  it("derives hard deadlines from promise, travel floor, and passenger budget", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    // Floored by slack'd travel when that exceeds originalEtaMin; then + budget.
    expect(committed.pickupDeadlineMin).toBeGreaterThanOrEqual(9);
    expect(committed.dropDeadlineMin).toBeGreaterThanOrEqual(23);
    expect(committed.dropDeadlineMin! - committed.pickupDeadlineMin!).toBeGreaterThanOrEqual(0);
  });

  it("carries the new passenger's seat count into loadDemands", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const fresh = built.shipments.find((shipment) => shipment.passengerId === "pNew")!;
    expect(fresh.seats).toBe(2);
  });

  it("locks the committed visits in their committed order", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.lockedVisits).toEqual([
      { shipmentId: "ship_pA", type: "PICKUP", startMin: 4 },
      { shipmentId: "ship_pA", type: "DROP", startMin: 15 },
    ]);
  });

  it("omits a pickup deadline for a passenger already aboard", () => {
    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [stop("s2", "pA", "DROP", 15)],
      passengersById: new Map([["pA", { ...passenger("pA", 5, 8), state: "IN_RIDE" as const }]]),
    });

    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(committed.pickupDeadlineMin).toBeUndefined();
    // Synthetic pickup must still appear in the lock so Google sees pickup
    // before delivery for the onboard shipment.
    expect(built.lockedVisits).toEqual([
      { shipmentId: "ship_pA", type: "PICKUP", startMin: 0 },
      { shipmentId: "ship_pA", type: "DROP", startMin: 15 },
    ]);
    expect(committed.pickup).toEqual(baseInput.vehicleStart);
  });

  it("injects synthetic onboard pickups ahead of every remaining stop", () => {
    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [
        stop("sDropA", "pA", "DROP", 10),
        stop("sPickB", "pB", "PICKUP", 14),
        stop("sDropB", "pB", "DROP", 22),
      ],
      passengersById: new Map([
        ["pA", { ...passenger("pA", 5, 8), state: "IN_RIDE" as const }],
        ["pB", passenger("pB", 5, 8)],
      ]),
    });

    // All synthetic pickups lead — never interleaved before each drop.
    expect(built.lockedVisits).toEqual([
      { shipmentId: "ship_pA", type: "PICKUP", startMin: 0 },
      { shipmentId: "ship_pA", type: "DROP", startMin: 10 },
      { shipmentId: "ship_pB", type: "PICKUP", startMin: 14 },
      { shipmentId: "ship_pB", type: "DROP", startMin: 22 },
    ]);
  });

  it("places every onboard synthetic pickup at the head when multiple are aboard", () => {
    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [
        stop("sDropA", "pA", "DROP", 10),
        stop("sDropB", "pB", "DROP", 22),
      ],
      passengersById: new Map([
        ["pA", { ...passenger("pA", 5, 8), state: "IN_RIDE" as const }],
        ["pB", { ...passenger("pB", 5, 8), state: "IN_RIDE" as const }],
      ]),
    });

    expect(built.lockedVisits).toEqual([
      { shipmentId: "ship_pA", type: "PICKUP", startMin: 0 },
      { shipmentId: "ship_pB", type: "PICKUP", startMin: 0 },
      { shipmentId: "ship_pA", type: "DROP", startMin: 10 },
      { shipmentId: "ship_pB", type: "DROP", startMin: 22 },
    ]);
  });

  it("floors hard deadlines with slack'd travel so Google windows stay reachable", () => {
    const farDrop = stop("s2", "pA", "DROP", 0);
    farDrop.location = { lat: 28.6, lng: 77.5 };

    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [farDrop],
      passengersById: new Map([["pA", { ...passenger("pA", 5, 8), state: "IN_RIDE" as const }]]),
    });

    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    // originalEtaMin is 0 and budget is 8 — without the travel floor the hard
    // window would be 8 min and Google would reject after road times land.
    expect(committed.dropDeadlineMin).toBeGreaterThan(8);
  });

  it("passes the vehicle capacity and timeout through", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.seatCapacity).toBe(4);
    expect(built.timeoutMs).toBe(400);
    expect(built.vehicleStart).toEqual({ lat: 28.6, lng: 77.19 });
  });
});
