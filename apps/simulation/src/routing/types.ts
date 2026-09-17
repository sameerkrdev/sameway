import type { LatLng } from "@/domain/entities";

export type RoutingEngineKind = "GOOGLE" | "MOCK";

export type TravelMode = "DRIVING" | "TWO_WHEELER";

export type RoutingPreference = "TRAFFIC_UNAWARE" | "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";

export interface RouteOptions {
  travelMode: TravelMode;
  routingPreference: RoutingPreference;
  units: "METRIC" | "IMPERIAL";
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  travelMode: "DRIVING",
  routingPreference: "TRAFFIC_UNAWARE",
  units: "METRIC",
};

/**
 * One segment between consecutive non-`via` waypoints. Per-leg durations are
 * the only way to compute when each passenger actually arrives, which is why
 * every stop must be requested as a stopover rather than a pass-through.
 */
export interface RouteLegResult {
  distanceKm: number;
  durationMin: number;
}

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  legs: RouteLegResult[];
  /** Decoded polyline for map rendering; absent when not requested. */
  path?: LatLng[];
}

export interface MatrixElement {
  originIndex: number;
  destinationIndex: number;
  reachable: boolean;
  distanceKm: number;
  durationMin: number;
}

export interface MatrixResult {
  elements: MatrixElement[];
}

export interface RoutingEngine {
  readonly kind: RoutingEngineKind;
  getRoute(waypoints: readonly LatLng[], options?: Partial<RouteOptions>): Promise<RouteResult>;
  getMatrix(
    origins: readonly LatLng[],
    destinations: readonly LatLng[],
    options?: Partial<RouteOptions>,
  ): Promise<MatrixResult>;
}

export interface RoutingTelemetrySnapshot {
  engine: RoutingEngineKind;
  routeCalls: number;
  matrixCalls: number;
  matrixElements: number;
  cacheHits: number;
  cacheMisses: number;
  budgetLimit: number;
  budgetUsed: number;
  budgetRemaining: number;
  fallbackReason: string | null;
}

/**
 * Thrown when a run would exceed `maxRoutingCallsPerRun`. The engine converts
 * this into a NOT_EVALUATED verdict rather than letting a scenario quietly
 * issue hundreds of billed requests.
 */
export class RoutingBudgetExceededError extends Error {
  constructor(readonly limit: number) {
    super(`Routing budget of ${limit} calls exhausted for this run`);
    this.name = "RoutingBudgetExceededError";
  }
}

export class RoutingUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RoutingUnavailableError";
  }
}
