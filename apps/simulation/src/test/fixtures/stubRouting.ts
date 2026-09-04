import type { LatLng } from "@/domain/entities";
import type {
  MatrixResult,
  RouteLegResult,
  RouteResult,
  RoutingEngine,
} from "@/routing/types";

/**
 * A routing engine whose answers are dictated by the test rather than derived
 * from geometry, so arithmetic like detour percentage can be asserted exactly.
 */
export class ScriptedRoutingEngine implements RoutingEngine {
  readonly kind = "MOCK" as const;
  readonly routeCalls: number[] = [];

  constructor(
    private readonly distanceForWaypointCount: (count: number) => {
      distanceKm: number;
      durationMin: number;
    },
  ) {}

  getRoute(waypoints: readonly LatLng[]): Promise<RouteResult> {
    this.routeCalls.push(waypoints.length);
    const { distanceKm, durationMin } = this.distanceForWaypointCount(waypoints.length);
    const legCount = Math.max(0, waypoints.length - 1);

    const legs: RouteLegResult[] = Array.from({ length: legCount }, () => ({
      distanceKm: distanceKm / legCount,
      durationMin: durationMin / legCount,
    }));

    return Promise.resolve({ distanceKm, durationMin, legs, path: [...waypoints] });
  }

  getMatrix(origins: readonly LatLng[], destinations: readonly LatLng[]): Promise<MatrixResult> {
    return Promise.resolve({
      elements: origins.flatMap((_, originIndex) =>
        destinations.map((__, destinationIndex) => ({
          originIndex,
          destinationIndex,
          reachable: true,
          distanceKm: 1,
          durationMin: 1,
        })),
      ),
    });
  }
}
