import type { LatLng } from "@/domain/entities";

import type { MatrixResult, RouteOptions, RouteResult } from "./types";

export interface RoutingCacheOptions {
  /**
   * Decimal places to round coordinates to before keying. `null` keeps full
   * precision, which is the default: rounding produces cache hits across
   * genuinely different pickups in dense areas, so it must be opted into.
   */
  coordinatePrecision: number | null;
}

/**
 * Keys include every parameter that can change the answer, not just the
 * coordinates. Two requests differing only in routing preference are different
 * routes and must not share a cache entry.
 */
export class RoutingCache {
  private readonly routes = new Map<string, RouteResult>();
  private readonly matrices = new Map<string, MatrixResult>();

  constructor(private readonly options: RoutingCacheOptions = { coordinatePrecision: null }) {}

  private formatPoint(point: LatLng): string {
    const precision = this.options.coordinatePrecision;
    if (precision === null) {
      return `${point.lat},${point.lng}`;
    }
    return `${point.lat.toFixed(precision)},${point.lng.toFixed(precision)}`;
  }

  private optionsKey(options: RouteOptions): string {
    return `${options.travelMode}|${options.routingPreference}|${options.units}`;
  }

  routeKey(waypoints: readonly LatLng[], options: RouteOptions): string {
    const points = waypoints.map((point) => this.formatPoint(point)).join(";");
    return `route|${this.optionsKey(options)}|distanceMeters,durationMillis,legs,path|${points}`;
  }

  matrixKey(
    origins: readonly LatLng[],
    destinations: readonly LatLng[],
    options: RouteOptions,
  ): string {
    const from = origins.map((point) => this.formatPoint(point)).join(";");
    const to = destinations.map((point) => this.formatPoint(point)).join(";");
    return `matrix|${this.optionsKey(options)}|distanceMeters,durationMillis|${from}=>${to}`;
  }

  getRoute(key: string): RouteResult | undefined {
    return this.routes.get(key);
  }

  setRoute(key: string, value: RouteResult): void {
    this.routes.set(key, value);
  }

  getMatrix(key: string): MatrixResult | undefined {
    return this.matrices.get(key);
  }

  setMatrix(key: string, value: MatrixResult): void {
    this.matrices.set(key, value);
  }

  get size(): number {
    return this.routes.size + this.matrices.size;
  }

  clear(): void {
    this.routes.clear();
    this.matrices.clear();
  }
}
