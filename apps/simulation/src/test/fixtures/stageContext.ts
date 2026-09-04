import type {
  Driver,
  MatchingSettings,
  Passenger,
  RideRequest,
  Scenario,
  Stop,
  Vehicle,
} from "@/domain/entities";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type { RideCorridor } from "@/matching/corridor";
import type { StopDelayBudget } from "@/matching/stages/operationalState";
import type {
  CommitPlan,
  DriverMetrics,
  MatchingContext,
  RouteInsertionCandidate,
  RouteInsertionResult,
  ScoreBreakdown,
  SolvedRoute,
} from "@/matching/types";
import type { OptimizerEngine } from "@/optimization/types";
import { MockRoutingEngine } from "@/routing";
import type { RoutingEngine } from "@/routing/types";

import { StubOptimizerEngine } from "./stubOptimizer";

export interface StubStop {
  id: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  originalEtaMin: number;
  lat?: number;
  lng?: number;
}

export interface StubPassenger {
  id: string;
  state: Passenger["state"];
  maxPickupDelayMin: number;
  maxDropDelayPercent?: number;
  seatsRequired?: number;
  allowsPooling?: boolean;
}

export interface MakeContextInput {
  driverId: string;
  committedStops: StubStop[];
  passengers: StubPassenger[];
  driverLocation?: { lat: number; lng: number };
  request?: Partial<RideRequest>;
  settings?: Partial<MatchingSettings>;
  vehicle?: Partial<Vehicle>;
  routing?: RoutingEngine;
  optimizer?: OptimizerEngine;
}

/**
 * Builds a `MatchingContext` around one driver.
 *
 * Stage tests want to assert one stage's behaviour, not assemble a whole
 * scenario. This keeps each test to the three or four facts it actually cares
 * about and fills the rest with defaults.
 */
export function makeContext(input: MakeContextInput): MatchingContext & {
  metrics: Map<string, DriverMetrics>;
} {
  const vehicle: Vehicle = {
    id: "v1",
    label: "Sedan",
    totalSeats: 4,
    luggageCapacity: 2,
    poolingEnabled: true,
    wheelchairAccessible: false,
    airConditioned: true,
    ...input.vehicle,
  };

  const passengers: Passenger[] = input.passengers.map((stub) => ({
    id: stub.id,
    name: stub.id,
    seatsRequired: stub.seatsRequired ?? 1,
    state: stub.state,
    specialRequirements: [],
    allowsPooling: stub.allowsPooling ?? true,
    maxPickupDelayMin: stub.maxPickupDelayMin,
    maxDropDelayPercent: stub.maxDropDelayPercent ?? 50,
  }));

  const stops: Stop[] = input.committedStops.map((stub, index) => ({
    id: stub.id,
    rideId: "r1",
    passengerId: stub.passengerId,
    type: stub.type,
    location: { lat: stub.lat ?? 28.6 + index * 0.01, lng: stub.lng ?? 77.2 + index * 0.01 },
    sequence: index,
    originalEtaMin: stub.originalEtaMin,
  }));

  const hasRide = stops.length > 0;

  const driver: Driver = {
    id: input.driverId,
    name: input.driverId,
    status: "ONLINE",
    location: input.driverLocation ?? { lat: 28.6, lng: 77.19 },
    vehicleId: vehicle.id,
    currentRideId: hasRide ? "r1" : null,
    history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 0 },
  };

  const newPassenger: Passenger = {
    id: "pNew",
    name: "pNew",
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
    maxPickupDelayMin: 6,
    maxDropDelayPercent: 50,
  };

  const request: RideRequest = {
    id: "req_1",
    passengerId: "pNew",
    seatsRequired: 1,
    pickup: { lat: 28.605, lng: 77.205 },
    drop: { lat: 28.64, lng: 77.26 },
    intermediateStops: [],
    poolingAllowed: true,
    vehiclePreference: "ANY",
    requiresWheelchairAccess: false,
    luggageCount: 0,
    maxWaitMinutes: 8,
    maxWalkingDistanceM: 300,
    priority: 0,
    ...input.request,
  };

  const settings: MatchingSettings = { ...DEFAULT_SETTINGS, ...input.settings };

  const scenario: Scenario = {
    schemaVersion: 2,
    id: "sc_test",
    name: "Stage fixture",
    drivers: [driver],
    vehicles: [vehicle],
    passengers: [...passengers, newPassenger],
    rides: hasRide
      ? [{ id: "r1", driverId: driver.id, passengerIds: passengers.map((p) => p.id), stops }]
      : [],
    requests: [request],
    settings,
  };

  const metrics = new Map<string, DriverMetrics>();
  const corridors = new Map<string, RideCorridor>();
  const sequences = new Map<string, RouteInsertionCandidate[]>();
  const delayBudgets = new Map<string, StopDelayBudget[]>();
  const solutions = new Map<string, SolvedRoute>();
  const insertions = new Map<string, RouteInsertionResult>();
  const scores = new Map<string, ScoreBreakdown>();
  const commitPlans = new Map<string, CommitPlan>();

  return {
    scenario,
    request,
    settings,
    routing: input.routing ?? new MockRoutingEngine(),
    optimizer: input.optimizer ?? new StubOptimizerEngine(),
    liveDriverIds: [driver.id],
    metrics,
    getDriver: (id) => (id === driver.id ? driver : undefined),
    getVehicleForDriver: (id) => (id === driver.id ? vehicle : undefined),
    getRideForDriver: (id) =>
      id === driver.id && hasRide
        ? { stops, passengerIds: passengers.map((p) => p.id) }
        : undefined,
    getMetrics: (id) => metrics.get(id) ?? {},
    getCorridor: (id) => corridors.get(id),
    setCorridor: (id, corridor) => {
      corridors.set(id, corridor);
    },
    getSequences: (id) => sequences.get(id) ?? [],
    setSequences: (id, candidates) => {
      sequences.set(id, candidates);
    },
    getSolution: (id) => solutions.get(id),
    setSolution: (id, solution) => {
      solutions.set(id, solution);
    },
    getDelayBudgets: (id) => delayBudgets.get(id) ?? [],
    setDelayBudgets: (id, budgets) => {
      delayBudgets.set(id, budgets);
    },
    recordMetrics: (id, patch) => {
      metrics.set(id, { ...(metrics.get(id) ?? {}), ...patch });
    },
    recordInsertion: (id, insertion) => {
      insertions.set(id, insertion);
    },
    recordCommitPlan: (id, plan) => {
      commitPlans.set(id, plan);
    },
    recordScore: (id, breakdown) => {
      scores.set(id, breakdown);
    },
  };
}
