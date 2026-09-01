import type { MatchingSettings, StageId } from "./entities";

/**
 * Stage order: Layer 1 corridor discovery first, then cheap eligibility filters,
 * then insertion/routing/decision stages.
 *
 * Stages after corridor still have strict data dependencies — road routing must
 * run before incremental cost — so only diagnostic sub-pipelines may reorder.
 */
export const DEFAULT_STAGE_ORDER: StageId[] = [
  "requestValidation",
  "h3RouteCorridor",
  "basicEligibility",
  "operationalState",
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
];

export const DEFAULT_SETTINGS: MatchingSettings = {
  h3Resolution: 9,
  minimumUsableCandidates: 10,
  maxH3Ring: 3,

  // Corridor proximity (stages 4 and 5 after Layer 1 discovery).
  maxPickupToRouteDistanceKm: 1.5,
  maxBearingDifferenceDeg: 75,

  // Straight-line ETA estimation for the stage 6 pre-filter only.
  estimatedSpeedKmh: 24,

  maxExistingPassengerDelayPercent: 50,
  shortTripSoloEtaMaxMin: 5,
  shortTripDelayPercent: 250,
  maxNewPassengerPickupDelayMin: 8,
  maxNewPassengerRideDetourMin: 12,

  maxPooledPassengers: 4,

  maxRoutedInsertionsPerDriver: 6,
  maxRoutingCallsPerRun: 150,
  maxOptimizerCallsPerRun: 40,
  optimizerTimeoutMs: 10_000,
  cacheCoordinatePrecision: null,

  routingMode: "AUTO",
  stageOrder: DEFAULT_STAGE_ORDER,
  weights: {
    driverImpact: 30,
    existingPassengerImpact: 30,
    newPassengerImpact: 25,
    pickupDelay: 15,
  },
};

/**
 * Fallback per-passenger delay tolerances used wherever a `Passenger` is
 * constructed without explicit budgets (scenario builders, presets, the
 * random generator, and the v1-to-v2 migrator when the source document has no
 * `settings`). Mirrors `DEFAULT_SETTINGS`'s own defaults so a fresh passenger
 * and a freshly-initialized scenario agree on what "default" means.
 */
export const DEFAULT_PASSENGER_DELAY_BUDGETS = {
  maxPickupDelayMin: DEFAULT_SETTINGS.maxNewPassengerPickupDelayMin,
  maxDropDelayPercent: DEFAULT_SETTINGS.maxExistingPassengerDelayPercent,
} as const;

export function cloneSettings(settings: MatchingSettings): MatchingSettings {
  return {
    ...settings,
    stageOrder: [...settings.stageOrder],
    weights: { ...settings.weights },
  };
}

/** Google's Routes API accepts at most 25 intermediate waypoints per request. */
export const MAX_INTERMEDIATE_WAYPOINTS = 25;

/** RouteMatrix accepts at most 625 origin x destination elements per call. */
export const MAX_MATRIX_ELEMENTS = 625;
