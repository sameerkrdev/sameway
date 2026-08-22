import { describe, expect, it } from "vitest";

import type { Driver, Passenger, Ride } from "@/domain/entities";
import { getH3CellFor } from "@/lib/h3";
import { buildCorridors, indexCorridorsByCell } from "@/matching/corridor";

const RESOLUTION = 9;

function passenger(id: string, state: Passenger["state"]): Passenger {
  return {
    id,
    name: id,
    seatsRequired: 1,
    state,
    specialRequirements: [],
    allowsPooling: true,
    maxPickupDelayMin: 5,
    maxDropDelayMin: 8,
  };
}

function driver(id: string, lat: number, lng: number, rideId: string | null): Driver {
  return {
    id,
    name: id,
    status: "ONLINE",
    location: { lat, lng },
    vehicleId: "v1",
    currentRideId: rideId,
    history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 0 },
  };
}

// A ride heading due east. The passenger is already onboard, so their pickup
// is behind the vehicle and must not appear in the corridor.
const onboardRide: Ride = {
  id: "r1",
  driverId: "d1",
  passengerIds: ["p1"],
  stops: [
    {
      id: "s1",
      rideId: "r1",
      passengerId: "p1",
      type: "PICKUP",
      location: { lat: 28.6, lng: 77.1 },
      sequence: 0,
      originalEtaMin: 0,
    },
    {
      id: "s2",
      rideId: "r1",
      passengerId: "p1",
      type: "DROP",
      location: { lat: 28.6, lng: 77.3 },
      sequence: 1,
      originalEtaMin: 20,
    },
  ],
};

describe("buildCorridors", () => {
  it("excludes stops the vehicle has already passed", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const corridor = corridors.get("d1")!;
    expect(corridor.remainingStops.map((stop) => stop.id)).toEqual(["s2"]);
    expect(corridor.isIdle).toBe(false);
  });

  it("does not cover a point on the historical route behind the vehicle", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    // The original pickup at lng 77.1 is behind the driver, who is at 77.2.
    const behindCell = getH3CellFor({ lat: 28.6, lng: 77.1 }, RESOLUTION);
    expect(corridors.get("d1")!.cells.has(behindCell)).toBe(false);
  });

  it("covers a point ahead of the vehicle on the remaining route", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const aheadCell = getH3CellFor({ lat: 28.6, lng: 77.25 }, RESOLUTION);
    expect(corridors.get("d1")!.cells.has(aheadCell)).toBe(true);
  });

  it("gives an idle driver a single-cell corridor at their location", () => {
    const corridors = buildCorridors({
      drivers: [driver("d2", 28.7, 77.4, null)],
      rides: [],
      passengersById: new Map(),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const corridor = corridors.get("d2")!;
    expect(corridor.isIdle).toBe(true);
    expect(corridor.remainingStops).toEqual([]);
    expect(corridor.cells.has(getH3CellFor({ lat: 28.7, lng: 77.4 }, RESOLUTION))).toBe(true);
  });

  it("keeps a waiting passenger's pickup in the corridor", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.05, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "WAITING")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    expect(corridors.get("d1")!.remainingStops.map((stop) => stop.id)).toEqual(["s1", "s2"]);
  });
});

describe("indexCorridorsByCell", () => {
  it("maps every corridor cell to its driver, without duplicates", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1"), driver("d2", 28.6, 77.25, null)],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const index = indexCorridorsByCell(corridors);
    const sharedCell = getH3CellFor({ lat: 28.6, lng: 77.25 }, RESOLUTION);
    const drivers = index.get(sharedCell) ?? [];

    expect(drivers).toContain("d1");
    expect(drivers).toContain("d2");
    expect(new Set(drivers).size).toBe(drivers.length);
  });
});
