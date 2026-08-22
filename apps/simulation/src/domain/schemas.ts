import { z } from "zod";

import { haversineKm } from "@/lib/geo";

import { SCENARIO_SCHEMA_VERSION, type Scenario } from "./entities";

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const driverStatusSchema = z.enum(["ONLINE", "OFFLINE", "BUSY", "PAUSED"]);
const passengerStateSchema = z.enum([
  "WAITING",
  "PICKED_UP",
  "IN_RIDE",
  "DROPPED",
  "CANCELLED",
]);

const vehicleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  totalSeats: z.number().int().min(1),
  luggageCapacity: z.number().int().min(0),
  poolingEnabled: z.boolean(),
  wheelchairAccessible: z.boolean(),
  airConditioned: z.boolean(),
});

const driverHistorySchema = z.object({
  ridesCompletedToday: z.number().int().min(0),
  lastAssignmentAt: z.string().nullable(),
  idleMinutes: z.number().min(0),
});

const driverSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: driverStatusSchema,
  location: latLngSchema,
  address: z.string().optional(),
  vehicleId: z.string().min(1),
  currentRideId: z.string().nullable(),
  history: driverHistorySchema,
});

const passengerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  seatsRequired: z.number().int().min(1),
  state: passengerStateSchema,
  specialRequirements: z.array(z.string()),
  allowsPooling: z.boolean(),
  maxPickupDelayMin: z.number().min(0),
  maxDropDelayMin: z.number().min(0),
});

const stopSchema = z.object({
  id: z.string().min(1),
  rideId: z.string(),
  passengerId: z.string().min(1),
  type: z.enum(["PICKUP", "DROP"]),
  location: latLngSchema,
  address: z.string().optional(),
  sequence: z.number().int().min(0),
  originalEtaMin: z.number().min(0),
});

const rideSchema = z.object({
  id: z.string().min(1),
  driverId: z.string().min(1),
  passengerIds: z.array(z.string()),
  stops: z.array(stopSchema),
});

const rideRequestSchema = z.object({
  id: z.string().min(1),
  passengerId: z.string().min(1),
  seatsRequired: z.number().int().min(1),
  pickup: latLngSchema,
  drop: latLngSchema,
  pickupAddress: z.string().optional(),
  dropAddress: z.string().optional(),
  intermediateStops: z.array(stopSchema),
  poolingAllowed: z.boolean(),
  vehiclePreference: z.string().min(1),
  requiresWheelchairAccess: z.boolean(),
  luggageCount: z.number().int().min(0),
  maxWaitMinutes: z.number().min(0),
  maxDetourPercent: z.number().min(0),
  maxWalkingDistanceM: z.number().min(0),
  priority: z.number().int(),
});

const scoringWeightsSchema = z.object({
  eta: z.number().min(0),
  distance: z.number().min(0),
  detour: z.number().min(0),
  routeQuality: z.number().min(0),
  fairness: z.number().min(0),
});

const stageIdSchema = z.enum([
  "requestValidation",
  "h3CandidateGeneration",
  "driverStatusFilter",
  "vehicleFilter",
  "capacityPreFilter",
  "pickupEtaFilter",
  "routeFeasibility",
  "poolingRules",
  "scoring",
]);

export const matchingSettingsSchema = z.object({
  h3Resolution: z.number().int().min(0).max(15),
  minimumUsableCandidates: z.number().int().min(1),
  maxH3Ring: z.number().int().min(0).max(12),
  maxPickupEtaMin: z.number().min(0),
  maxPickupRoadDistanceKm: z.number().min(0),
  maxDetourPercent: z.number().min(0),
  maxAdditionalDistanceKm: z.number().min(0),
  maxAdditionalDurationMin: z.number().min(0),
  maxExistingPassengerDelayMin: z.number().min(0),
  maxNewPassengerPickupDelayMin: z.number().min(0),
  maxPooledPassengers: z.number().int().min(1),
  maxRoutedInsertionsPerDriver: z.number().int().min(1),
  maxRoutingCallsPerRun: z.number().int().min(1),
  cacheCoordinatePrecision: z.number().int().min(0).max(12).nullable(),
  routingMode: z.enum(["AUTO", "GOOGLE", "MOCK"]),
  stageOrder: z.array(stageIdSchema).min(1),
  weights: scoringWeightsSchema,
});

export const scenarioSchema = z.object({
  schemaVersion: z.literal(SCENARIO_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  seed: z.number().int().optional(),
  drivers: z.array(driverSchema),
  vehicles: z.array(vehicleSchema),
  passengers: z.array(passengerSchema),
  rides: z.array(rideSchema),
  requests: z.array(rideRequestSchema),
  settings: matchingSettingsSchema,
});

export interface ScenarioParseSuccess {
  ok: true;
  scenario: Scenario;
}

export interface ScenarioParseFailure {
  ok: false;
  /** Human-readable `path: message` lines, ready to render in an import dialog. */
  errors: string[];
}

export type ScenarioParseResult = ScenarioParseSuccess | ScenarioParseFailure;

/**
 * Straight-line minutes per kilometre used to seed `originalEtaMin` on a
 * migrated v1 stop.
 *
 * A v1 document never recorded what was promised, so any value here is an
 * invention. A geometric estimate is the honest one: it is reproducible, needs
 * no network, and stage 12 overwrites it with real solver data the first time
 * the ride is committed to.
 */
const MIGRATION_MINUTES_PER_KM = 3;

interface V1Passenger {
  maxPickupDelayMin?: number;
  maxDropDelayMin?: number;
}

interface V1Stop {
  location: { lat: number; lng: number };
  originalEtaMin?: number;
}

/**
 * Upgrades a v1 scenario in place before validation.
 *
 * Migration runs before the schema rather than after, so a v1 document is
 * never reported to the user as "invalid" for lacking fields that did not
 * exist when it was exported.
 */
function migrateToV2(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const document = input as Record<string, unknown>;
  if (document.schemaVersion !== 1) {
    return input;
  }

  const clone = structuredClone(document);
  const settings = (clone.settings ?? {}) as Record<string, number>;
  const pickupBudget = settings.maxNewPassengerPickupDelayMin ?? 6;
  const dropBudget = settings.maxExistingPassengerDelayMin ?? 8;

  clone.schemaVersion = 2;

  for (const passenger of (clone.passengers ?? []) as V1Passenger[]) {
    passenger.maxPickupDelayMin ??= pickupBudget;
    passenger.maxDropDelayMin ??= dropBudget;
  }

  for (const ride of (clone.rides ?? []) as { stops?: V1Stop[] }[]) {
    let cumulativeKm = 0;
    let previous: { lat: number; lng: number } | null = null;

    for (const stop of ride.stops ?? []) {
      if (previous) {
        cumulativeKm += haversineKm(previous, stop.location);
      }
      previous = stop.location;
      stop.originalEtaMin ??= cumulativeKm * MIGRATION_MINUTES_PER_KM;
    }
  }

  for (const request of (clone.requests ?? []) as { intermediateStops?: V1Stop[] }[]) {
    for (const stop of request.intermediateStops ?? []) {
      stop.originalEtaMin ??= 0;
    }
  }

  return clone;
}

/**
 * Validates untrusted scenario JSON. A malformed bug repro must fail loudly
 * rather than half-loading and quietly changing what the engine is fed.
 */
export function parseScenario(input: unknown): ScenarioParseResult {
  const result = scenarioSchema.safeParse(migrateToV2(input));

  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${path}: ${issue.message}`;
      }),
    };
  }

  const parsed: Scenario = result.data;
  const referenceErrors = collectReferenceErrors(parsed);

  if (referenceErrors.length > 0) {
    return { ok: false, errors: referenceErrors };
  }

  return { ok: true, scenario: parsed };
}

/**
 * Structural validity is not enough: a scenario whose driver points at a
 * missing vehicle would crash mid-pipeline with a far less useful message.
 */
function collectReferenceErrors(scenario: Scenario): string[] {
  const errors: string[] = [];
  const vehicleIds = new Set(scenario.vehicles.map((vehicle) => vehicle.id));
  const passengerIds = new Set(scenario.passengers.map((passenger) => passenger.id));
  const rideIds = new Set(scenario.rides.map((ride) => ride.id));

  for (const driver of scenario.drivers) {
    if (!vehicleIds.has(driver.vehicleId)) {
      errors.push(`drivers.${driver.id}: unknown vehicleId "${driver.vehicleId}"`);
    }
    if (driver.currentRideId !== null && !rideIds.has(driver.currentRideId)) {
      errors.push(`drivers.${driver.id}: unknown currentRideId "${driver.currentRideId}"`);
    }
  }

  for (const ride of scenario.rides) {
    for (const passengerId of ride.passengerIds) {
      if (!passengerIds.has(passengerId)) {
        errors.push(`rides.${ride.id}: unknown passengerId "${passengerId}"`);
      }
    }
    for (const stop of ride.stops) {
      if (!passengerIds.has(stop.passengerId)) {
        errors.push(`rides.${ride.id}.stops.${stop.id}: unknown passengerId "${stop.passengerId}"`);
      }
    }
  }

  for (const request of scenario.requests) {
    if (!passengerIds.has(request.passengerId)) {
      errors.push(`requests.${request.id}: unknown passengerId "${request.passengerId}"`);
    }
  }

  return errors;
}
