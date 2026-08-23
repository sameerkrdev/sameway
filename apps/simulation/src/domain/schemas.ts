import { z } from "zod";

import { haversineKm } from "@/lib/geo";

import { SCENARIO_SCHEMA_VERSION, type Scenario } from "./entities";
import { DEFAULT_SETTINGS, DEFAULT_STAGE_ORDER } from "./settings";

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
  "basicEligibility",
  "operationalState",
  "h3RouteCorridor",
  "pickupRouteDistance",
  "directionCompatibility",
  "stopSequenceGeneration",
  "pickupTimeWindow",
  "detourLowerBound",
  "roadRouting",
  "incrementalCost",
  "hardConstraints",
  "scoring",
  "commit",
]);

export const matchingSettingsSchema = z.object({
  h3Resolution: z.number().int().min(0).max(15),
  minimumUsableCandidates: z.number().int().min(1),
  maxH3Ring: z.number().int().min(0).max(12),
  maxPickupToRouteDistanceKm: z.number().min(0),
  maxDropToRouteDistanceKm: z.number().min(0),
  maxBearingDifferenceDeg: z.number().min(0).max(180),
  maxDetourPercent: z.number().min(0),
  maxAdditionalDistanceKm: z.number().min(0),
  maxAdditionalDurationMin: z.number().min(0),
  maxExistingPassengerDelayMin: z.number().min(0),
  maxNewPassengerPickupDelayMin: z.number().min(0),
  maxNewPassengerRideDetourMin: z.number().min(0),
  maxPooledPassengers: z.number().int().min(1),
  maxRoutedInsertionsPerDriver: z.number().int().min(1),
  maxRoutingCallsPerRun: z.number().int().min(1),
  maxOptimizerCallsPerRun: z.number().int().min(1),
  optimizerTimeoutMs: z.number().int().min(50),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Brings a v1 settings block up to the current shape.
 *
 * Two independent things break otherwise, and each one alone is enough to make
 * a genuine v1 document unimportable.
 *
 * A v1 block predates every settings field added since it was written, and
 * `matchingSettingsSchema` requires all of them — so missing keys are filled
 * from `DEFAULT_SETTINGS`. This has to keep working as the schema moves:
 * tasks are still adding and removing settings fields.
 *
 * And its `stageOrder` holds the nine pre-Overview stage ids, none of which
 * `stageIdSchema` still accepts. That array is replaced wholesale rather than
 * mapped: there is no correspondence between the old nine stages and the
 * current fourteen, and a v1 stage order carries no information worth
 * preserving. Obsolete keys left in the block are dropped by zod, which strips
 * unknown properties.
 */
function migrateSettings(legacy: Record<string, unknown>): Record<string, unknown> {
  return {
    ...DEFAULT_SETTINGS,
    ...legacy,
    stageOrder: [...DEFAULT_STAGE_ORDER],
    weights: isRecord(legacy.weights)
      ? { ...DEFAULT_SETTINGS.weights, ...legacy.weights }
      : { ...DEFAULT_SETTINGS.weights },
  };
}

/**
 * Upgrades a v1 scenario in place before validation.
 *
 * Migration runs before the schema rather than after, so a v1 document is
 * never reported to the user as "invalid" for lacking fields that did not
 * exist when it was exported.
 *
 * A v1 document is untrusted input: `passengers` might not be an array,
 * `rides` might contain `null`, a stop might be a string. Every loop below
 * guards its own shape assumption so a structurally broken document falls
 * through to zod (and comes back as `{ ok: false, errors: [...] }`) instead
 * of throwing out of this function and escaping the `ScenarioParseResult`
 * contract `parseScenario` promises its callers.
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
  const legacySettings = isRecord(clone.settings) ? clone.settings : {};
  const pickupBudget = numberOr(
    legacySettings.maxNewPassengerPickupDelayMin,
    DEFAULT_SETTINGS.maxNewPassengerPickupDelayMin,
  );
  const dropBudget = numberOr(
    legacySettings.maxExistingPassengerDelayMin,
    DEFAULT_SETTINGS.maxExistingPassengerDelayMin,
  );

  clone.schemaVersion = 2;
  clone.settings = migrateSettings(legacySettings);

  if (Array.isArray(clone.passengers)) {
    for (const passenger of clone.passengers as V1Passenger[]) {
      if (!isRecord(passenger)) {
        continue;
      }
      passenger.maxPickupDelayMin ??= pickupBudget;
      passenger.maxDropDelayMin ??= dropBudget;
    }
  }

  if (Array.isArray(clone.rides)) {
    for (const ride of clone.rides as { stops?: V1Stop[] }[]) {
      if (!isRecord(ride) || !Array.isArray(ride.stops)) {
        continue;
      }

      let cumulativeKm = 0;
      let previous: { lat: number; lng: number } | null = null;

      for (const stop of ride.stops) {
        if (!isRecord(stop) || !isRecord(stop.location)) {
          continue;
        }
        if (previous) {
          cumulativeKm += haversineKm(previous, stop.location as { lat: number; lng: number });
        }
        previous = stop.location as { lat: number; lng: number };
        stop.originalEtaMin ??= cumulativeKm * MIGRATION_MINUTES_PER_KM;
      }
    }
  }

  if (Array.isArray(clone.requests)) {
    for (const request of clone.requests as { intermediateStops?: V1Stop[] }[]) {
      if (!isRecord(request) || !Array.isArray(request.intermediateStops)) {
        continue;
      }
      for (const stop of request.intermediateStops) {
        if (!isRecord(stop)) {
          continue;
        }
        stop.originalEtaMin ??= 0;
      }
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
