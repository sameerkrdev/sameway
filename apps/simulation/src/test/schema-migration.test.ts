import { describe, expect, it } from "vitest";

import { parseScenario } from "@/domain/schemas";

/**
 * A real v1 settings block, frozen as a literal.
 *
 * This deliberately does NOT spread `DEFAULT_SETTINGS`. The fixture used to,
 * and that made it useless: the spread tracked whatever the current schema
 * happened to be, so the "v1" document was really a v2 document wearing a
 * `schemaVersion: 1` label and could never detect a migration break. Two such
 * breaks had already accumulated undetected by Task 9.
 *
 * These are the exact fields and the exact nine stage ids a v1 export carried.
 * Leave them frozen. When a task adds or removes a settings field, this object
 * must stay behind — that gap is the whole point of the fixture.
 */
const V1_SETTINGS = Object.freeze({
  h3Resolution: 9,
  minimumUsableCandidates: 10,
  maxH3Ring: 3,
  maxPickupEtaMin: 6,
  maxPickupRoadDistanceKm: 8,
  maxDetourPercent: 15,
  maxAdditionalDistanceKm: 5,
  maxAdditionalDurationMin: 12,
  maxExistingPassengerDelayMin: 8,
  maxNewPassengerPickupDelayMin: 6,
  maxPooledPassengers: 4,
  maxRoutedInsertionsPerDriver: 6,
  maxRoutingCallsPerRun: 150,
  cacheCoordinatePrecision: null,
  routingMode: "AUTO",
  stageOrder: [
    "requestValidation",
    "h3CandidateGeneration",
    "driverStatusFilter",
    "vehicleFilter",
    "capacityPreFilter",
    "pickupEtaFilter",
    "routeFeasibility",
    "poolingRules",
    "scoring",
  ],
  weights: { eta: 30, distance: 20, detour: 30, routeQuality: 20, fairness: 0 },
});

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
    settings: structuredClone(V1_SETTINGS),
  };
}

describe("scenario schema v2", () => {
  it("migrates a v1 document, filling passenger delay budgets from settings", () => {
    const result = parseScenario(v1Scenario());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scenario.schemaVersion).toBe(2);
    const passenger = result.scenario.passengers[0]!;
    // Budgets come from the v1 document's own settings fields, not today's defaults.
    expect(passenger.maxPickupDelayMin).toBe(V1_SETTINGS.maxNewPassengerPickupDelayMin);
    expect(passenger.maxDropDelayMin).toBe(V1_SETTINGS.maxExistingPassengerDelayMin);
    expect(result.scenario.settings.maxNewPassengerPickupDelayMin).toBe(
      V1_SETTINGS.maxNewPassengerPickupDelayMin,
    );
    expect(result.scenario.settings.maxExistingPassengerDelayMin).toBe(
      V1_SETTINGS.maxExistingPassengerDelayMin,
    );
    expect("maxDetourPercent" in result.scenario.settings).toBe(false);
    expect("maxAdditionalDistanceKm" in result.scenario.settings).toBe(false);
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

  it("rejects a v1 document with a non-array passengers field instead of throwing", () => {
    const broken = v1Scenario() as Record<string, unknown>;
    broken.passengers = "corrupt";

    expect(() => parseScenario(broken)).not.toThrow();
    const result = parseScenario(broken);
    expect(result.ok).toBe(false);
  });

  it("rejects a v1 document with a null entry in rides instead of throwing", () => {
    const broken = v1Scenario() as Record<string, unknown>;
    broken.rides = [null];

    expect(() => parseScenario(broken)).not.toThrow();
    const result = parseScenario(broken);
    expect(result.ok).toBe(false);
  });
});
