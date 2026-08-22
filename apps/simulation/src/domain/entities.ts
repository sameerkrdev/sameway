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
}

export interface Stop {
  id: string;
  rideId: string;
  passengerId: string;
  type: StopType;
  location: LatLng;
  address?: string;
  sequence: number;
}

export interface Ride {
  id: string;
  driverId: string;
  passengerIds: string[];
  stops: Stop[];
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
  maxDetourPercent: number;
  maxWalkingDistanceM: number;
  priority: number;
}

export type RoutingMode = "AUTO" | "GOOGLE" | "MOCK";

export interface ScoringWeights {
  eta: number;
  distance: number;
  detour: number;
  routeQuality: number;
  /** Experimental. Defaults to 0 so fairness never perturbs a run silently. */
  fairness: number;
}

export type StageId =
  | "requestValidation"
  | "h3CandidateGeneration"
  | "driverStatusFilter"
  | "vehicleFilter"
  | "capacityPreFilter"
  | "pickupEtaFilter"
  | "routeFeasibility"
  | "poolingRules"
  | "scoring";

export interface MatchingSettings {
  // Spatial candidate generation. These bound the H3 search and nothing else;
  // no H3 value is ever used as a distance.
  h3Resolution: number;
  minimumUsableCandidates: number;
  maxH3Ring: number;

  // Pickup proximity.
  maxPickupEtaMin: number;
  maxPickupRoadDistanceKm: number;

  // Route feasibility.
  maxDetourPercent: number;
  maxAdditionalDistanceKm: number;
  maxAdditionalDurationMin: number;
  maxExistingPassengerDelayMin: number;
  maxNewPassengerPickupDelayMin: number;

  // Pooling business rules.
  maxPooledPassengers: number;

  // Cost control.
  maxRoutedInsertionsPerDriver: number;
  maxRoutingCallsPerRun: number;
  /** Decimal places to round coordinates to in cache keys; null disables rounding. */
  cacheCoordinatePrecision: number | null;

  routingMode: RoutingMode;
  stageOrder: StageId[];
  weights: ScoringWeights;
}

export interface Scenario {
  schemaVersion: 1;
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

export const SCENARIO_SCHEMA_VERSION = 1 as const;
