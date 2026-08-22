import type { MatchingSettings, StageId } from "./entities";

/**
 * The default stage order runs the cheap matrix-backed ETA gate before the
 * expensive per-insertion route calls. The brief lists route feasibility first;
 * that order is still selectable because `stageOrder` is data, not code.
 */
export const DEFAULT_STAGE_ORDER: StageId[] = [
  "requestValidation",
  "h3CandidateGeneration",
  "driverStatusFilter",
  "vehicleFilter",
  "capacityPreFilter",
  "pickupEtaFilter",
  "routeFeasibility",
  "poolingRules",
  "scoring",
];

/** The order written in the original brief, kept selectable for comparison. */
export const BRIEF_STAGE_ORDER: StageId[] = [
  "requestValidation",
  "h3CandidateGeneration",
  "driverStatusFilter",
  "vehicleFilter",
  "capacityPreFilter",
  "routeFeasibility",
  "pickupEtaFilter",
  "poolingRules",
  "scoring",
];

export const DEFAULT_SETTINGS: MatchingSettings = {
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
  stageOrder: DEFAULT_STAGE_ORDER,
  weights: {
    eta: 30,
    distance: 20,
    detour: 30,
    routeQuality: 20,
    fairness: 0,
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
