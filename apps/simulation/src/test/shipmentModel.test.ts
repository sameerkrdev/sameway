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

  it("derives hard deadlines from the passenger's own budget plus the promise", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    // pickup promised at 4 min, tolerates 5 more; drop promised at 15, tolerates 8.
    expect(committed.pickupDeadlineMin).toBe(9);
    expect(committed.dropDeadlineMin).toBe(23);
  });

  it("carries the new passenger's seat count into loadDemands", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const fresh = built.shipments.find((shipment) => shipment.passengerId === "pNew")!;
    expect(fresh.seats).toBe(2);
  });

  it("locks the committed visits in their committed order", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.lockedVisits).toEqual([
      { shipmentId: "ship_pA", type: "PICKUP" },
      { shipmentId: "ship_pA", type: "DROP" },
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
    expect(built.lockedVisits).toEqual([{ shipmentId: "ship_pA", type: "DROP" }]);
  });

  it("passes the vehicle capacity and timeout through", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.seatCapacity).toBe(4);
    expect(built.timeoutMs).toBe(400);
    expect(built.vehicleStart).toEqual({ lat: 28.6, lng: 77.19 });
  });
});
