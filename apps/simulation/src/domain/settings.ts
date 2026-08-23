import type { MatchingSettings, StageId } from "./entities";

/**
 * The Overview's stage order, and the only order the engine supports.
 *
 * The previous `BRIEF_STAGE_ORDER` A/B existed because two stages were merely
 * a cost trade-off against each other. These thirteen have strict data
 * dependencies — stage 9 cannot measure what stage 8 has not yet routed — so a
 * reorderable list would mostly express configurations that cannot run.
 */
export const DEFAULT_STAGE_ORDER: StageId[] = [
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
];

export const DEFAULT_SETTINGS: MatchingSettings = {
  h3Resolution: 9,
  minimumUsableCandidates: 10,
  maxH3Ring: 3,

  // Corridor proximity (stages 3 and 4).
  maxPickupToRouteDistanceKm: 1.5,
  maxDropToRouteDistanceKm: 3,
  maxBearingDifferenceDeg: 75,

  // Straight-line ETA estimation for the stage 6 pre-filter only.
  estimatedSpeedKmh: 24,

  maxDetourPercent: 15,
  maxAdditionalDistanceKm: 5,
  maxAdditionalDurationMin: 12,
  maxExistingPassengerDelayMin: 8,
  maxNewPassengerPickupDelayMin: 6,
  maxNewPassengerRideDetourMin: 10,

  maxPooledPassengers: 4,

  maxRoutedInsertionsPerDriver: 6,
  maxRoutingCallsPerRun: 150,
  maxOptimizerCallsPerRun: 40,
  optimizerTimeoutMs: 400,
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
  maxDropDelayMin: DEFAULT_SETTINGS.maxExistingPassengerDelayMin,
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
