/**
 * Scenario domain model.
 *
 * Nothing in this file may import React, `google.maps`, or any store. These
 * types travel with the matching engine into a Node service later.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type DriverStatus = "ONLINE" | "OFFLINE" | "BUSY" | "PAUSED";

export const DRIVER_STATUSES: readonly DriverStatus[] = [
  "ONLINE",
  "OFFLINE",
  "BUSY",
  "PAUSED",
] as const;

/**
 * A passenger occupies a seat from PICKED_UP until DROPPED. IN_RIDE is the
 * steady state between those two events; both consume capacity, which is why
 * the occupancy walk seeds from them rather than starting at zero.
 */
export type PassengerState = "WAITING" | "PICKED_UP" | "IN_RIDE" | "DROPPED" | "CANCELLED";

export const PASSENGER_STATES: readonly PassengerState[] = [
  "WAITING",
  "PICKED_UP",
  "IN_RIDE",
  "DROPPED",
  "CANCELLED",
] as const;

export const ONBOARD_PASSENGER_STATES: readonly PassengerState[] = [
  "PICKED_UP",
  "IN_RIDE",
] as const;

export type StopType = "PICKUP" | "DROP";

/**
 * Vehicle capability is data, never a hard-coded union in the engine. Adding a
 * new vehicle class is a scenario edit, not a code change.
 */
export interface Vehicle {
  id: string;
  label: string;
  totalSeats: number;
  luggageCapacity: number;
  poolingEnabled: boolean;
  wheelchairAccessible: boolean;
  airConditioned: boolean;
}

/** Inputs to the experimental fairness score. Not a production model. */
export interface DriverHistory {
  ridesCompletedToday: number;
  lastAssignmentAt: string | null;
  idleMinutes: number;
}

export interface Driver {
  id: string;
  name: string;
  status: DriverStatus;
  location: LatLng;
  address?: string;
  vehicleId: string;
  currentRideId: string | null;
  history: DriverHistory;
}

export interface Passenger {
  id: string;
  name: string;
  seatsRequired: number;
  state: PassengerState;
  specialRequirements: string[];
  allowsPooling: boolean;
  /**
   * How much later than promised this passenger will tolerate being collected.
   * Stage 1 turns it into a delay budget, stage 6 pre-filters orderings against
   * it, stage 8 encodes it as a hard time window, and stage 10 re-checks it
   * against the solver's real leg times. One source of truth, four consumers.
   */
  maxPickupDelayMin: number;
  /** Drop delay tolerance as a percent of this passenger's solo trip ETA. */
  maxDropDelayPercent: number;
}

export interface Stop {
  id: string;
  rideId: string;
  passengerId: string;
  type: StopType;
  location: LatLng;
  address?: string;
  sequence: number;
  /**
   * The ETA in minutes from the driver's position at the time this stop was
   * committed — the promise stages 6, 9 and 10 protect. Stage 12 re-stamps it
   * on commit, which is what makes the committed route the new baseline.
   */
  originalEtaMin: number;
}

export interface Ride {
  id: string;
  driverId: string;
  passengerIds: string[];
  stops: Stop[];
  /**
   * Already-driven trail for map visualization only. Matching uses
   * `driver.location` plus remaining `stops` — never this polyline.
   */
  coveredPath?: LatLng[];
}

export const ANY_VEHICLE = "ANY" as const;

export interface RideRequest {
  id: string;
  passengerId: string;
  seatsRequired: number;
  pickup: LatLng;
  drop: LatLng;
  pickupAddress?: string;
  dropAddress?: string;
  intermediateStops: Stop[];
  poolingAllowed: boolean;
  /** A `Vehicle.label` value, or `ANY`. */
  vehiclePreference: string;
  requiresWheelchairAccess: boolean;
  luggageCount: number;
  maxWaitMinutes: number;
  maxWalkingDistanceM: number;
  priority: number;
}

export type RoutingMode = "AUTO" | "GOOGLE" | "MOCK";

/**
 * The Overview's fairness formula. Lower is better throughout — these measure
 * harm, not merit, and the whole point is that the vehicle-cost-optimal route
 * is often not the fairest one.
 */
/**
 * The Overview's fairness formula. Lower is better throughout — these measure
 * harm, not merit, and the whole point is that the vehicle-cost-optimal route
 * is often not the fairest one.
 */
export interface ScoringWeights {
  driverImpact: number;
  existingPassengerImpact: number;
  newPassengerImpact: number;
  pickupDelay: number;
}

/**
 * The stages of `docs/Overview.md`, in the order the document numbers them.
 * `requestValidation` is a pre-stage: it judges the request alone, before any
 * driver is considered, so it has no Overview number.
 */
export type StageId =
  | "requestValidation"
  | "basicEligibility"
  | "operationalState"
  | "h3RouteCorridor"
  | "pickupRouteDistance"
  | "directionCompatibility"
  | "stopSequenceGeneration"
  | "pickupTimeWindow"
  | "detourLowerBound"
  | "roadRouting"
  | "incrementalCost"
  | "hardConstraints"
  | "scoring"
  | "commit";

export interface MatchingSettings {
  // Spatial candidate generation. These bound the H3 search and nothing else;
  // no H3 value is ever used as a distance.
  h3Resolution: number;
  minimumUsableCandidates: number;
  maxH3Ring: number;

  // Corridor proximity (stages 3 and 4).
  maxPickupToRouteDistanceKm: number;
  maxBearingDifferenceDeg: number;

  /**
   * Average road speed used only for stage 6's straight-line ETA pre-filter.
   * Never used for a reported ETA — those all come from stage 8.
   */
  estimatedSpeedKmh: number;

  // Route feasibility.
  maxExistingPassengerDelayPercent: number;
  /** Solo trips at or below this ETA use `shortTripDelayPercent` instead. */
  shortTripSoloEtaMaxMin: number;
  shortTripDelayPercent: number;
  maxNewPassengerPickupDelayMin: number;
  maxNewPassengerRideDetourMin: number;

  // Pooling business rules.
  maxPooledPassengers: number;

  // Cost control.
  maxRoutedInsertionsPerDriver: number;
  maxRoutingCallsPerRun: number;
  maxOptimizerCallsPerRun: number;
  optimizerTimeoutMs: number;
  /** Decimal places to round coordinates to in cache keys; null disables rounding. */
  cacheCoordinatePrecision: number | null;

  routingMode: RoutingMode;
  stageOrder: StageId[];
  weights: ScoringWeights;
}

export interface Scenario {
  schemaVersion: 2;
  id: string;
  name: string;
  /** Present when the scenario came from the seeded generator. */
  seed?: number;
  drivers: Driver[];
  vehicles: Vehicle[];
  passengers: Passenger[];
  rides: Ride[];
  requests: RideRequest[];
  settings: MatchingSettings;
}

export const SCENARIO_SCHEMA_VERSION = 2 as const;
