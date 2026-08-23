import { describe, expect, it } from "vitest";

import {
  buildMultiRideSketchCommit,
  buildRideSketchCommit,
  emptyRideSketchDraft,
  inferPassengerState,
  loadDraftFromScenario,
  validateRideSketchDraft,
} from "@/lib/rideSketch";
import {
  FLEET,
  makeDriver,
  makePassenger,
  makeRide,
  makeScenario,
  makeVehicle,
} from "@/scenarios/builders";

const origin = { lat: 28.61, lng: 77.2 };
const pickup = { lat: 28.62, lng: 77.21 };
const drop = { lat: 28.63, lng: 77.22 };
const coveredA = { lat: 28.605, lng: 77.195 };

function baseScenario() {
  return makeScenario({
    id: "sketch-test",
    name: "Sketch test",
    vehicles: [makeVehicle({ id: "V1", label: "Sedan" })],
    drivers: [
      makeDriver({
        id: "D001",
        location: origin,
        vehicleId: "V1",
        status: "BUSY",
        currentRideId: "ride_1",
      }),
    ],
    passengers: [makePassenger({ id: "P001", name: "Ada", state: "IN_RIDE" })],
    rides: [
      makeRide(
        "ride_1",
        "D001",
        [
          {
            id: "s2",
            passengerId: "P001",
            type: "DROP",
            location: drop,
            originalEtaMin: 8,
          },
        ],
        [coveredA, origin],
      ),
    ],
    requests: [],
  });
}

describe("rideSketch", () => {
  it("loads vehicle, covered path, and remaining stops from an existing ride", () => {
    const draft = loadDraftFromScenario(baseScenario(), "D001");

    expect(draft.driverId).toBe("D001");
    expect(draft.vehicleLocation).toEqual(origin);
    expect(draft.driverStatus).toBe("BUSY");
    expect(draft.vehicleId).toBe("V1");
    expect(draft.hasActiveRide).toBe(true);
    expect(draft.coveredPath).toEqual([coveredA, origin]);
    expect(draft.stops).toHaveLength(1);
    expect(draft.stops[0]?.type).toBe("DROP");
  });

  it("requires a vehicle location before Apply", () => {
    const draft = {
      ...emptyRideSketchDraft(),
      isNewDriver: true,
      driverId: null,
      vehicleLocation: null,
    };

    expect(validateRideSketchDraft(draft)).toMatch(/vehicle/i);
  });

  it("creates an idle driver without a ride when hasActiveRide is false", () => {
    const scenario = baseScenario();
    const draft = {
      ...emptyRideSketchDraft("Driver 2", scenario),
      isNewDriver: true,
      driverStatus: "ONLINE" as const,
      vehicleId: FLEET.cab6.id,
      hasActiveRide: false,
      vehicleLocation: { lat: 28.64, lng: 77.23 },
    };

    const commit = buildRideSketchCommit(draft, scenario, [], new Set());
    expect("error" in commit).toBe(false);
    if ("error" in commit) {
      return;
    }

    expect(commit.ride).toBeNull();
    expect(commit.driver.status).toBe("ONLINE");
    expect(commit.driver.vehicleId).toBe(FLEET.cab6.id);
    expect(commit.vehicleToCreate?.id).toBe(FLEET.cab6.id);
  });

  it("infers IN_RIDE when only a DROP remains", () => {
    expect(
      inferPassengerState("P001", [{ id: "1", passengerId: "P001", type: "DROP", location: drop }]),
    ).toBe("IN_RIDE");
    expect(
      inferPassengerState("P001", [
        { id: "1", passengerId: "P001", type: "PICKUP", location: pickup },
        { id: "2", passengerId: "P001", type: "DROP", location: drop },
      ]),
    ).toBe("WAITING");
  });

  it("keeps ONLINE status when committing an active ride so the driver stays poolable", () => {
    const scenario = baseScenario();
    const draft = {
      ...emptyRideSketchDraft("Ride 1", scenario),
      driverId: "D001",
      isNewDriver: false,
      driverStatus: "ONLINE" as const,
      vehicleId: "V1",
      hasActiveRide: true,
      rideId: "ride_1",
      vehicleLocation: origin,
      coveredPath: [coveredA],
      pathWaypoints: [origin, drop],
      stops: [
        {
          id: "sk1",
          passengerId: "P001",
          type: "DROP" as const,
          location: drop,
        },
      ],
    };

    const commit = buildRideSketchCommit(draft, scenario, [], new Set());
    expect("error" in commit).toBe(false);
    if ("error" in commit) {
      return;
    }

    expect(commit.driver.status).toBe("ONLINE");
    expect(commit.ride?.coveredPath).toEqual([coveredA, origin]);
    expect(commit.ride?.stops.map((stop) => `${stop.passengerId}:${stop.type}`)).toEqual([
      "P001:DROP",
    ]);
  });

  it("applies multiple rides plus a shared new request", () => {
    const scenario = baseScenario();
    const pending = makePassenger({ id: "P_NEW", name: "Bea" });
    const rideA = {
      ...loadDraftFromScenario(scenario, "D001"),
    };
    const rideB = {
      ...emptyRideSketchDraft("Ride 2", scenario),
      isNewDriver: true,
      driverStatus: "ONLINE" as const,
      vehicleId: "V1",
      hasActiveRide: true,
      vehicleLocation: { lat: 28.64, lng: 77.23 },
      coveredPath: [{ lat: 28.638, lng: 77.228 }],
      stops: [
        {
          id: "b1",
          passengerId: "P_NEW",
          type: "PICKUP" as const,
          location: { lat: 28.642, lng: 77.232 },
        },
        {
          id: "b2",
          passengerId: "P_NEW",
          type: "DROP" as const,
          location: { lat: 28.65, lng: 77.24 },
        },
      ],
    };

    const commit = buildMultiRideSketchCommit(
      [rideA, rideB],
      {
        requestPickup: { lat: 28.62, lng: 77.21 },
        requestDrop: { lat: 28.66, lng: 77.25 },
        requestPassengerId: "P_NEW",
      },
      [pending],
      scenario,
    );

    expect("error" in commit).toBe(false);
    if ("error" in commit) {
      return;
    }

    expect(commit.rides).toHaveLength(2);
    expect(commit.rides[0]?.driver.id).toBe("D001");
    expect(commit.rides[1]?.driver.id).not.toBe("D001");
    expect(commit.request?.passengerId).toBe("P_NEW");
    expect(commit.sharedPassengers.some((passenger) => passenger.id === "P001")).toBe(true);
  });
});
