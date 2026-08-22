import { describe, expect, it } from "vitest";

import { parseScenario } from "@/domain/schemas";
import { DEFAULT_SETTINGS } from "@/domain/settings";

function v1Scenario() {
  return {
    schemaVersion: 1,
    id: "sc_1",
    name: "Legacy",
    drivers: [
      {
        id: "d1",
        name: "D1",
        status: "ONLINE",
        location: { lat: 28.6, lng: 77.2 },
        vehicleId: "v1",
        currentRideId: "r1",
        history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 0 },
      },
    ],
    vehicles: [
      {
        id: "v1",
        label: "Sedan",
        totalSeats: 4,
        luggageCapacity: 2,
        poolingEnabled: true,
        wheelchairAccessible: false,
        airConditioned: true,
      },
    ],
    passengers: [
      {
        id: "p1",
        name: "P1",
        seatsRequired: 1,
        state: "WAITING",
        specialRequirements: [],
        allowsPooling: true,
      },
    ],
    rides: [
      {
        id: "r1",
        driverId: "d1",
        passengerIds: ["p1"],
        stops: [
          {
            id: "s1",
            rideId: "r1",
            passengerId: "p1",
            type: "PICKUP",
            location: { lat: 28.61, lng: 77.21 },
            sequence: 0,
          },
          {
            id: "s2",
            rideId: "r1",
            passengerId: "p1",
            type: "DROP",
            location: { lat: 28.62, lng: 77.22 },
            sequence: 1,
          },
        ],
      },
    ],
    requests: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

describe("scenario schema v2", () => {
  it("migrates a v1 document, filling passenger delay budgets from settings", () => {
    const result = parseScenario(v1Scenario());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scenario.schemaVersion).toBe(2);
    const passenger = result.scenario.passengers[0]!;
    expect(passenger.maxPickupDelayMin).toBe(DEFAULT_SETTINGS.maxNewPassengerPickupDelayMin);
    expect(passenger.maxDropDelayMin).toBe(DEFAULT_SETTINGS.maxExistingPassengerDelayMin);
  });

  it("fills originalEtaMin on every migrated stop", () => {
    const result = parseScenario(v1Scenario());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const stop of result.scenario.rides[0]!.stops) {
      expect(stop.originalEtaMin).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(stop.originalEtaMin)).toBe(true);
    }
  });

  it("accepts a native v2 document unchanged", () => {
    const migrated = parseScenario(v1Scenario());
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    const reparsed = parseScenario(structuredClone(migrated.scenario));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.scenario).toEqual(migrated.scenario);
  });

  it("rejects a v2 document missing the new passenger fields", () => {
    const broken = structuredClone(v1Scenario()) as Record<string, unknown>;
    broken.schemaVersion = 2;

    const result = parseScenario(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("maxPickupDelayMin");
  });
});
