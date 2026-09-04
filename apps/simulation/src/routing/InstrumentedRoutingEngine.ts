import type { LatLng } from "@/domain/entities";

import type { RoutingCache } from "./RoutingCache";
import type { RoutingTelemetry } from "./RoutingTelemetry";
import {
  DEFAULT_ROUTE_OPTIONS,
  type MatrixResult,
  type RouteOptions,
  type RouteResult,
  type RoutingEngine,
  type RoutingEngineKind,
} from "./types";

/**
 * Wraps a routing engine with caching, budget enforcement and telemetry.
 *
 * Keeping these concerns here rather than inside each engine means the mock
 * and the Google adapter are measured identically, and neither can forget to
 * check the budget.
 */
export class InstrumentedRoutingEngine implements RoutingEngine {
  constructor(
    private readonly delegate: RoutingEngine,
    private readonly cache: RoutingCache,
    private readonly telemetry: RoutingTelemetry,
  ) {}

  get kind(): RoutingEngineKind {
    return this.delegate.kind;
  }

  async getRoute(
    waypoints: readonly LatLng[],
    options?: Partial<RouteOptions>,
  ): Promise<RouteResult> {
    const resolved = resolveOptions(options);
    const key = this.cache.routeKey(waypoints, resolved);
    const cached = this.cache.getRoute(key);

    if (cached) {
      this.telemetry.recordCacheHit();
      return cached;
    }

    // Reserve budget before the call so an over-budget run never reaches the
    // network. Throws RoutingBudgetExceededError, which stages translate into
    // a NOT_EVALUATED verdict.
    this.telemetry.consumeRouteCall();

    const result = await this.delegate.getRoute(waypoints, resolved);
    this.cache.setRoute(key, result);
    return result;
  }

  async getMatrix(
    origins: readonly LatLng[],
    destinations: readonly LatLng[],
    options?: Partial<RouteOptions>,
  ): Promise<MatrixResult> {
    const resolved = resolveOptions(options);
    const key = this.cache.matrixKey(origins, destinations, resolved);
    const cached = this.cache.getMatrix(key);

    if (cached) {
      this.telemetry.recordCacheHit();
      return cached;
    }

    this.telemetry.consumeMatrixCall(origins.length * destinations.length);

    const result = await this.delegate.getMatrix(origins, destinations, resolved);
    this.cache.setMatrix(key, result);
    return result;
  }
}

function resolveOptions(options?: Partial<RouteOptions>): RouteOptions {
  return { ...DEFAULT_ROUTE_OPTIONS, ...options };
}
