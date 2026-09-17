import type { LatLng } from "@/domain/entities";
import { MAX_INTERMEDIATE_WAYPOINTS } from "@/domain/settings";

import {
  RoutingUnavailableError,
  type MatrixElement,
  type MatrixResult,
  type RouteLegResult,
  type RouteOptions,
  type RouteResult,
  type RoutingEngine,
} from "./types";

/**
 * Minimal structural types for `google.maps.routes`.
 *
 * Declared locally rather than relying on @types/google.maps so the adapter
 * keeps compiling if the published typings lag behind the Routes library.
 */
interface GoogleRouteLeg {
  distanceMeters?: number;
  durationMillis?: number;
}

interface GoogleRoute {
  distanceMeters?: number;
  durationMillis?: number;
  legs?: GoogleRouteLeg[];
  path?: { lat: number | (() => number); lng: number | (() => number) }[];
}

interface GoogleRouteMatrixItem {
  condition?: string;
  distanceMeters?: number;
  durationMillis?: number;
}

export interface GoogleRoutesLibrary {
  Route: {
    computeRoutes(request: Record<string, unknown>): Promise<{ routes?: GoogleRoute[] }>;
  };
  RouteMatrix: {
    computeRouteMatrix(request: Record<string, unknown>): Promise<{
      matrix?: { rows?: { items?: GoogleRouteMatrixItem[] }[] };
    }>;
  };
}

/**
 * Adapter over the modern Routes library.
 *
 * Uses `Route.computeRoutes` and `RouteMatrix.computeRouteMatrix` rather than
 * the legacy DirectionsService and DistanceMatrixService, which Google moved
 * to Legacy status on 2025-03-01 and which are unavailable in Cloud projects
 * created after that date.
 *
 * This is the only file in the app that touches the Maps SDK for routing.
 * Everything upstream of it sees the `RoutingEngine` interface.
 */
export class GoogleRoutesEngine implements RoutingEngine {
  readonly kind = "GOOGLE" as const;

  constructor(private readonly library: GoogleRoutesLibrary) {}

  async getRoute(
    waypoints: readonly LatLng[],
    options?: Partial<RouteOptions>,
  ): Promise<RouteResult> {
    if (waypoints.length < 2) {
      return { distanceKm: 0, durationMin: 0, legs: [], path: [...waypoints] };
    }

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediates = waypoints.slice(1, -1);

    if (!origin || !destination) {
      throw new RoutingUnavailableError("Route requires both an origin and a destination");
    }

    if (intermediates.length > MAX_INTERMEDIATE_WAYPOINTS) {
      throw new RoutingUnavailableError(
        `Route has ${intermediates.length} intermediate waypoints, above the limit of ${MAX_INTERMEDIATE_WAYPOINTS}`,
      );
    }

    const { routes } = await this.library.Route.computeRoutes({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      // Every stop must be a stopover rather than a pass-through: only
      // non-`via` waypoints produce legs, and per-leg durations are the only
      // way to work out when each passenger actually arrives.
      intermediates: intermediates.map((point) => ({
        location: { lat: point.lat, lng: point.lng },
        vehicleStopover: true,
      })),
      travelMode: options?.travelMode ?? "DRIVING",
      routingPreference: options?.routingPreference ?? "TRAFFIC_UNAWARE",
      // Request exactly what the engine consumes and nothing more.
      fields: ["distanceMeters", "durationMillis", "legs", "path"],
    });

    const route = routes?.[0];

    if (!route) {
      throw new RoutingUnavailableError("Routes API returned no route for these waypoints");
    }

    const legs: RouteLegResult[] = (route.legs ?? []).map((leg) => ({
      distanceKm: metresToKm(leg.distanceMeters),
      durationMin: millisToMinutes(leg.durationMillis),
    }));

    return {
      distanceKm: metresToKm(route.distanceMeters),
      durationMin: millisToMinutes(route.durationMillis),
      legs,
      path: (route.path ?? []).map((point) => ({
        lat: typeof point.lat === "function" ? point.lat() : point.lat,
        lng: typeof point.lng === "function" ? point.lng() : point.lng,
      })),
    };
  }

  async getMatrix(
    origins: readonly LatLng[],
    destinations: readonly LatLng[],
    options?: Partial<RouteOptions>,
  ): Promise<MatrixResult> {
    if (origins.length === 0 || destinations.length === 0) {
      return { elements: [] };
    }

    const { matrix } = await this.library.RouteMatrix.computeRouteMatrix({
      origins: origins.map((point) => ({ lat: point.lat, lng: point.lng })),
      destinations: destinations.map((point) => ({ lat: point.lat, lng: point.lng })),
      travelMode: options?.travelMode ?? "DRIVING",
      routingPreference: options?.routingPreference ?? "TRAFFIC_UNAWARE",
      fields: ["distanceMeters", "durationMillis", "condition"],
    });

    const elements: MatrixElement[] = [];
    const rows = matrix?.rows ?? [];

    for (let originIndex = 0; originIndex < rows.length; originIndex += 1) {
      const items = rows[originIndex]?.items ?? [];

      for (let destinationIndex = 0; destinationIndex < items.length; destinationIndex += 1) {
        const item = items[destinationIndex];
        if (!item) {
          continue;
        }

        // An unreachable pair is a legitimate answer, not an error: the caller
        // reads `reachable` and decides what it means.
        const reachable = item.condition !== "ROUTE_NOT_FOUND" && item.distanceMeters !== undefined;

        elements.push({
          originIndex,
          destinationIndex,
          reachable,
          distanceKm: metresToKm(item.distanceMeters),
          durationMin: millisToMinutes(item.durationMillis),
        });
      }
    }

    return { elements };
  }
}

function metresToKm(metres: number | undefined): number {
  return metres === undefined ? 0 : metres / 1000;
}

function millisToMinutes(millis: number | undefined): number {
  if (millis === undefined || !Number.isFinite(millis)) {
    return 0;
  }
  return millis / 60000;
}
