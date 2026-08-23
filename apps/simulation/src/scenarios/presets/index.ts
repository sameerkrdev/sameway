import type { Scenario } from "@/domain/entities";
import { offsetBy } from "@/lib/geo";

import {
  attachRide,
  DELHI_PLACES,
  FLEET,
  makeDriver,
  makePassenger,
  makeRequest,
  makeRide,
  makeScenario,
} from "../builders";
import { generateScenario } from "../randomGenerator";

export interface ScenarioPreset {
  id: string;
  name: string;
  /** What behaviour this preset is designed to provoke. */
  tests: string;
  build(): Scenario;
}

const CP = DELHI_PLACES.connaughtPlace;

function ring(count: number, radiusKm: number, startBearing = 0) {
  return Array.from({ length: count }, (_, index) =>
    offsetBy(CP, radiusKm, startBearing + (360 / count) * index),
  );
}

const simpleSingleRide: ScenarioPreset = {
  id: "simple-single-ride",
  name: "Simple Single Ride",
  tests: "The happy path: idle drivers, no pooling constraints, a clean match.",
  build: () =>
    makeScenario({
      id: "sc_simple",
      name: "Simple Single Ride",
      drivers: ring(4, 1).map((location, index) =>
        makeDriver({ id: `D00${index + 1}`, location, vehicleId: FLEET.cab4.id }),
      ),
      passengers: [makePassenger({ id: "P001", name: "Aman" })],
      requests: [
        makeRequest({
          id: "R100",
          passengerId: "P001",
          pickup: CP,
          drop: DELHI_PLACES.noida62,
        }),
      ],
    }),
};

const busyDelhi: ScenarioPreset = {
  id: "busy-delhi",
  name: "Busy Delhi",
  tests: "Dense supply — the minimum-candidate threshold is met in ring 0, so no expansion occurs.",
  build: () =>
    generateScenario({
      seed: 4242,
      driverCount: 120,
      passengerCount: 80,
      rideCount: 40,
      areaRadiusKm: 2.5,
      onlinePercent: 85,
    }),
};

const airportPooling: ScenarioPreset = {
  id: "airport-pooling",
  name: "Airport Pooling",
  tests: "A long shared corridor where insertion detour stays small and pooling should succeed.",
  build: () => {
    const rides = [
      makeRide("R_AIR1", "D001", [
        {
          id: "S_A1_P",
          passengerId: "P001",
          type: "PICKUP",
          location: offsetBy(CP, 0.6, 200),
          originalEtaMin: 0,
        },
        {
          id: "S_A1_D",
          passengerId: "P001",
          type: "DROP",
          location: DELHI_PLACES.igiAirport,
          originalEtaMin: 0,
        },
      ]),
      makeRide("R_AIR2", "D002", [
        {
          id: "S_A2_P",
          passengerId: "P002",
          type: "PICKUP",
          location: offsetBy(CP, 1.1, 215),
          originalEtaMin: 0,
        },
        {
          id: "S_A2_D",
          passengerId: "P002",
          type: "DROP",
          location: offsetBy(DELHI_PLACES.igiAirport, 0.8, 90),
          originalEtaMin: 0,
        },
      ]),
    ];

    const drivers = attachRide(
      [
        makeDriver({ id: "D001", location: offsetBy(CP, 0.7, 190), vehicleId: FLEET.cab6.id }),
        makeDriver({ id: "D002", location: offsetBy(CP, 0.9, 210), vehicleId: FLEET.cab4.id }),
        makeDriver({ id: "D003", location: offsetBy(CP, 1.2, 180), vehicleId: FLEET.cab4.id }),
      ],
      rides,
    );

    return makeScenario({
      id: "sc_airport",
      name: "Airport Pooling",
      drivers,
      passengers: [
        makePassenger({ id: "P001", name: "Nikhil" }),
        makePassenger({ id: "P002", name: "Sara" }),
        makePassenger({ id: "P_NEW", name: "Ishaan" }),
      ],
      rides,
      requests: [
        makeRequest({
          id: "R_AIRPORT",
          passengerId: "P_NEW",
          pickup: offsetBy(CP, 0.4, 195),
          drop: DELHI_PLACES.igiAirport,
          maxDetourPercent: 25,
        }),
      ],
      settings: { maxDetourPercent: 25, maxAdditionalDistanceKm: 8 },
    });
  },
};

const multiplePassengers: ScenarioPreset = {
  id: "multiple-passengers",
  name: "Multiple Passengers",
  tests: "A six-seater already carrying three riders, exercising deep insertion enumeration.",
  build: () => {
    const rides = [
      makeRide("R_MULTI", "D001", [
        {
          id: "S_M_P2",
          passengerId: "P002",
          type: "PICKUP",
          location: offsetBy(CP, 1.0, 80),
          originalEtaMin: 0,
        },
        {
          id: "S_M_D1",
          passengerId: "P001",
          type: "DROP",
          location: offsetBy(CP, 2.0, 85),
          originalEtaMin: 0,
        },
        {
          id: "S_M_P3",
          passengerId: "P003",
          type: "PICKUP",
          location: offsetBy(CP, 2.6, 88),
          originalEtaMin: 0,
        },
        {
          id: "S_M_D2",
          passengerId: "P002",
          type: "DROP",
          location: offsetBy(CP, 4.0, 90),
          originalEtaMin: 0,
        },
        {
          id: "S_M_D3",
          passengerId: "P003",
          type: "DROP",
          location: offsetBy(CP, 5.5, 92),
          originalEtaMin: 0,
        },
      ]),
    ];

    return makeScenario({
      id: "sc_multi",
      name: "Multiple Passengers",
      drivers: attachRide(
        [
          makeDriver({ id: "D001", location: offsetBy(CP, 0.5, 75), vehicleId: FLEET.cab6.id }),
          makeDriver({ id: "D002", location: offsetBy(CP, 0.8, 100), vehicleId: FLEET.cab4.id }),
        ],
        rides,
      ),
      passengers: [
        // P001 is already aboard, so only their drop remains in the route.
        makePassenger({ id: "P001", name: "Rahul", state: "IN_RIDE" }),
        makePassenger({ id: "P002", name: "Priya" }),
        makePassenger({ id: "P003", name: "Kabir" }),
        makePassenger({ id: "P_NEW", name: "Meera" }),
      ],
      rides,
      requests: [
        makeRequest({
          id: "R_MULTI_REQ",
          passengerId: "P_NEW",
          pickup: offsetBy(CP, 1.4, 82),
          drop: offsetBy(CP, 4.6, 91),
          maxDetourPercent: 30,
        }),
      ],
      settings: { maxDetourPercent: 30 },
    });
  },
};

const vehicleCapacityTest: ScenarioPreset = {
  id: "vehicle-capacity-test",
  name: "Vehicle Capacity Test",
  tests:
    "The cheap pre-filter and segment occupancy disagree: D001 looks full but frees a seat mid-route.",
  build: () => {
    const rides = [
      makeRide("R_CAP", "D001", [
        // Both riders are aboard; the first drop is what creates room.
        {
          id: "S_C_D1",
          passengerId: "P001",
          type: "DROP",
          location: offsetBy(CP, 1.2, 45),
          originalEtaMin: 0,
        },
        {
          id: "S_C_D2",
          passengerId: "P002",
          type: "DROP",
          location: offsetBy(CP, 3.0, 50),
          originalEtaMin: 0,
        },
      ]),
    ];

    return makeScenario({
      id: "sc_capacity",
      name: "Vehicle Capacity Test",
      drivers: attachRide(
        [
          makeDriver({ id: "D001", location: offsetBy(CP, 0.5, 40), vehicleId: FLEET.cab4.id }),
          makeDriver({ id: "D002", location: offsetBy(CP, 0.7, 60), vehicleId: FLEET.auto3.id }),
        ],
        rides,
      ),
      passengers: [
        makePassenger({ id: "P001", name: "Vikram", seatsRequired: 2, state: "IN_RIDE" }),
        makePassenger({ id: "P002", name: "Divya", seatsRequired: 2, state: "IN_RIDE" }),
        makePassenger({ id: "P_NEW", name: "Arjun", seatsRequired: 2 }),
      ],
      rides,
      requests: [
        makeRequest({
          id: "R_CAP_REQ",
          passengerId: "P_NEW",
          seatsRequired: 2,
          pickup: offsetBy(CP, 1.5, 47),
          drop: offsetBy(CP, 4.0, 52),
          maxDetourPercent: 40,
        }),
      ],
      settings: { maxDetourPercent: 40 },
    });
  },
};

const routeDetourTest: ScenarioPreset = {
  id: "route-detour-test",
  name: "Route Detour Test",
  tests: "A perpendicular request that forces a ROUTE_DETOUR_TOO_HIGH rejection.",
  build: () => {
    const rides = [
      makeRide("R_WEST", "D001", [
        {
          id: "S_W_P",
          passengerId: "P001",
          type: "PICKUP",
          location: offsetBy(CP, 1.5, 270),
          originalEtaMin: 0,
        },
        {
          id: "S_W_D",
          passengerId: "P001",
          type: "DROP",
          location: offsetBy(CP, 3.5, 270),
          originalEtaMin: 0,
        },
      ]),
    ];

    return makeScenario({
      id: "sc_detour",
      name: "Route Detour Test",
      drivers: attachRide(
        [
          makeDriver({ id: "D001", location: offsetBy(CP, 0.8, 270), vehicleId: FLEET.cab4.id }),
          makeDriver({ id: "D002", location: offsetBy(CP, 1.0, 90), vehicleId: FLEET.cab4.id }),
        ],
        rides,
      ),
      passengers: [
        makePassenger({ id: "P001", name: "Sunil" }),
        makePassenger({ id: "P_NEW", name: "Tara" }),
      ],
      rides,
      requests: [
        makeRequest({
          id: "R_DETOUR",
          passengerId: "P_NEW",
          pickup: CP,
          drop: DELHI_PLACES.noida62,
        }),
      ],
    });
  },
};

const sparseDriverArea: ScenarioPreset = {
  id: "sparse-driver-area",
  name: "Sparse Driver Area",
  tests: "Supply thin enough that ring expansion runs to maxH3Ring without meeting the threshold.",
  build: () =>
    makeScenario({
      id: "sc_sparse",
      name: "Sparse Driver Area",
      drivers: [
        makeDriver({ id: "D001", location: offsetBy(CP, 0.9, 30), vehicleId: FLEET.cab4.id }),
        makeDriver({ id: "D002", location: offsetBy(CP, 4.5, 120), vehicleId: FLEET.auto3.id }),
        makeDriver({ id: "D003", location: offsetBy(CP, 9.0, 240), vehicleId: FLEET.cab4.id }),
      ],
      passengers: [makePassenger({ id: "P_NEW", name: "Zoya" })],
      requests: [
        makeRequest({ id: "R_SPARSE", passengerId: "P_NEW", pickup: CP, drop: DELHI_PLACES.saket }),
      ],
      settings: { minimumUsableCandidates: 10, maxH3Ring: 3 },
    }),
};

const denseDriverArea: ScenarioPreset = {
  id: "dense-driver-area",
  name: "Dense Driver Area",
  tests: "Enough usable drivers in ring 0 that the search stops immediately.",
  build: () =>
    makeScenario({
      id: "sc_dense",
      name: "Dense Driver Area",
      drivers: ring(14, 0.12).map((location, index) =>
        makeDriver({
          id: `D${String(index + 1).padStart(3, "0")}`,
          location,
          vehicleId: FLEET.cab4.id,
        }),
      ),
      passengers: [makePassenger({ id: "P_NEW", name: "Rohit" })],
      requests: [
        makeRequest({ id: "R_DENSE", passengerId: "P_NEW", pickup: CP, drop: DELHI_PLACES.saket }),
      ],
      settings: { minimumUsableCandidates: 6 },
    }),
};

const corridorBehindVehicle: ScenarioPreset = {
  id: "corridor-behind-vehicle",
  name: "Corridor Behind Vehicle",
  tests:
    "A pickup sitting exactly on the route the vehicle has already driven. The single most important corridor regression: proximity to the historical route must never make a ride look compatible.",
  build: () => {
    // D_BEHIND is mid-trip, running east. Its rider is aboard, so the only
    // remaining stop is the drop further east — everything west of the driver
    // is history. D_AHEAD runs the same corridor but has not reached the
    // pickup yet, so it must still match: the preset would prove nothing if
    // the pickup were simply unreachable for everyone.
    const rides = [
      makeRide("R_BEHIND", "D_BEHIND", [
        {
          id: "S_BEHIND_D",
          passengerId: "P_ABOARD",
          type: "DROP",
          location: offsetBy(CP, 14, 90),
          originalEtaMin: 0,
        },
      ]),
      makeRide("R_AHEAD", "D_AHEAD", [
        {
          id: "S_AHEAD_D",
          passengerId: "P_ABOARD_2",
          type: "DROP",
          location: offsetBy(CP, 14, 90),
          originalEtaMin: 0,
        },
      ]),
    ];

    const drivers = attachRide(
      [
        // Already 8 km east. The pickup at 2 km east is 6 km behind it, well
        // past what ring expansion plus corridor padding can reach, so stage 2
        // is the stage that must reject it. A smaller gap is still rejected,
        // but by stage 3's exact geometry, which would make this preset
        // demonstrate the wrong thing.
        makeDriver({
          id: "D_BEHIND",
          location: offsetBy(CP, 8, 90),
          vehicleId: FLEET.cab4.id,
        }),
        // Only 1 km east; the same pickup is still ahead of it.
        makeDriver({
          id: "D_AHEAD",
          location: offsetBy(CP, 1, 90),
          vehicleId: FLEET.cab4.id,
        }),
      ],
      rides,
    );

    return makeScenario({
      id: "sc_behind",
      name: "Corridor Behind Vehicle",
      drivers,
      rides,
      passengers: [
        makePassenger({ id: "P_ABOARD", name: "Meera", state: "IN_RIDE" }),
        makePassenger({ id: "P_ABOARD_2", name: "Vikram", state: "IN_RIDE" }),
        makePassenger({ id: "P_NEW", name: "Arjun" }),
      ],
      requests: [
        makeRequest({
          id: "R_BEHIND_REQ",
          passengerId: "P_NEW",
          pickup: offsetBy(CP, 2, 90),
          drop: offsetBy(CP, 8, 90),
        }),
      ],
      settings: { h3Resolution: 8, maxH3Ring: 3 },
    });
  },
};

const noDriverAvailable: ScenarioPreset = {
  id: "no-driver-available",
  name: "No Driver Available",
  tests: "The empty-result path: every nearby driver is offline or paused.",
  build: () =>
    makeScenario({
      id: "sc_none",
      name: "No Driver Available",
      drivers: [
        makeDriver({
          id: "D001",
          location: offsetBy(CP, 0.5, 0),
          vehicleId: FLEET.cab4.id,
          status: "OFFLINE",
        }),
        makeDriver({
          id: "D002",
          location: offsetBy(CP, 0.7, 120),
          vehicleId: FLEET.cab4.id,
          status: "PAUSED",
        }),
        makeDriver({
          id: "D003",
          location: offsetBy(CP, 0.9, 240),
          vehicleId: FLEET.auto3.id,
          status: "BUSY",
        }),
      ],
      passengers: [makePassenger({ id: "P_NEW", name: "Neha" })],
      requests: [
        makeRequest({ id: "R_NONE", passengerId: "P_NEW", pickup: CP, drop: DELHI_PLACES.saket }),
      ],
    }),
};

const mixedVehicleFleet: ScenarioPreset = {
  id: "mixed-vehicle-fleet",
  name: "Mixed Vehicle Fleet",
  tests: "A specific vehicle preference so the vehicle filter does visible work.",
  build: () =>
    makeScenario({
      id: "sc_mixed",
      name: "Mixed Vehicle Fleet",
      drivers: [
        makeDriver({ id: "D001", location: offsetBy(CP, 0.6, 0), vehicleId: FLEET.cab6.id }),
        makeDriver({ id: "D002", location: offsetBy(CP, 0.7, 72), vehicleId: FLEET.cab4.id }),
        makeDriver({ id: "D003", location: offsetBy(CP, 0.8, 144), vehicleId: FLEET.auto3.id }),
        makeDriver({ id: "D004", location: offsetBy(CP, 0.9, 216), vehicleId: FLEET.eRickshaw.id }),
        makeDriver({ id: "D005", location: offsetBy(CP, 1.0, 288), vehicleId: FLEET.cab6.id }),
      ],
      passengers: [makePassenger({ id: "P_NEW", name: "Farhan", seatsRequired: 5 })],
      requests: [
        makeRequest({
          id: "R_MIXED",
          passengerId: "P_NEW",
          seatsRequired: 5,
          pickup: CP,
          drop: DELHI_PLACES.gurgaon,
          vehiclePreference: FLEET.cab6.label,
          luggageCount: 4,
        }),
      ],
    }),
};

const largePoolingScenario: ScenarioPreset = {
  id: "large-pooling-scenario",
  name: "Large Pooling Scenario",
  tests: "500 drivers and 200 rides — performance, and the routing budget doing its job.",
  build: () =>
    generateScenario({
      seed: 777,
      driverCount: 500,
      passengerCount: 300,
      rideCount: 200,
      areaRadiusKm: 8,
      onlinePercent: 82,
    }),
};

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  simpleSingleRide,
  busyDelhi,
  airportPooling,
  multiplePassengers,
  vehicleCapacityTest,
  routeDetourTest,
  sparseDriverArea,
  denseDriverArea,
  corridorBehindVehicle,
  noDriverAvailable,
  mixedVehicleFleet,
  largePoolingScenario,
];

export function getPreset(id: string): ScenarioPreset | undefined {
  return SCENARIO_PRESETS.find((preset) => preset.id === id);
}

export const DEFAULT_PRESET_ID = simpleSingleRide.id;
