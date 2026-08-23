import type { LatLng } from "@/domain/entities";
import { haversineKm } from "@/lib/geo";

import {
  DEFAULT_ROUTE_OPTIONS,
  type MatrixElement,
  type MatrixResult,
  type RouteLegResult,
  type RouteOptions,
  type RouteResult,
  type RoutingEngine,
} from "./types";

export interface MockRoutingOptions {
  /**
   * Multiplier from straight-line to road distance. 1.35 is a reasonable
   * average for dense Indian urban grids.
   */
  roadFactor: number;
  minSpeedKmh: number;
  maxSpeedKmh: number;
  /** How quickly average speed rises with trip length. */
  speedRampPerKm: number;
}

export const DEFAULT_MOCK_OPTIONS: MockRoutingOptions = {
  roadFactor: 1.35,
  minSpeedKmh: 18,
  maxSpeedKmh: 40,
  speedRampPerKm: 1.5,
};

/**
 * One synthetic leg: haversine scaled by the road factor, timed by the
 * length-dependent speed curve.
 *
 * Exported because more than one component has to agree on it. The test
 * suite's stub optimizer produces solver answers that stage 9 compares against
 * baselines from this engine, and the Delhi fixture stamps the promised ETAs
 * those comparisons are measured from. If any of the three used a different
 * road factor or speed, committed promises would be unachievable the moment
 * they were made — and the resulting rejections would be artefacts of the test
 * doubles rather than of the pipeline.
 */
export function mockLeg(
  from: LatLng,
  to: LatLng,
  options: MockRoutingOptions = DEFAULT_MOCK_OPTIONS,
): RouteLegResult {
  const distanceKm = haversineKm(from, to) * options.roadFactor;

  if (distanceKm === 0) {
    return { distanceKm: 0, durationMin: 0 };
  }

  const { minSpeedKmh, maxSpeedKmh, speedRampPerKm } = options;
  const averageSpeedKmh = Math.min(maxSpeedKmh, minSpeedKmh + distanceKm * speedRampPerKm);

  return { distanceKm, durationMin: (distanceKm / averageSpeedKmh) * 60 };
}

/**
 * Synthetic routing for development and for the deterministic test suite.
 *
 * Distances are haversine scaled by a constant road factor and durations come
 * from a length-dependent speed curve. There is no randomness anywhere, so the
 * same scenario always yields the same numbers.
 *
 * These figures are good enough to exercise algorithm logic and completely
 * unsuitable for tuning real-world thresholds, which is why the UI shows a
 * persistent banner whenever this engine is active.
 */
export class MockRoutingEngine implements RoutingEngine {
  readonly kind = "MOCK" as const;

  constructor(private readonly options: MockRoutingOptions = DEFAULT_MOCK_OPTIONS) {}

  private leg(from: LatLng, to: LatLng): RouteLegResult {
    return mockLeg(from, to, this.options);
  }

  getRoute(waypoints: readonly LatLng[], options?: Partial<RouteOptions>): Promise<RouteResult> {
    void options;

    if (waypoints.length < 2) {
      return Promise.resolve({ distanceKm: 0, durationMin: 0, legs: [], path: [...waypoints] });
    }

    const legs: RouteLegResult[] = [];
    let distanceKm = 0;
    let durationMin = 0;

    for (let i = 1; i < waypoints.length; i += 1) {
      const from = waypoints[i - 1];
      const to = waypoints[i];
      if (!from || !to) {
        continue;
      }

      const leg = this.leg(from, to);
      legs.push(leg);
      distanceKm += leg.distanceKm;
      durationMin += leg.durationMin;
    }

    return Promise.resolve({
      distanceKm,
      durationMin,
      legs,
      // Straight segments between waypoints. Visibly synthetic on the map,
      // which is the honest representation of what this engine knows.
      path: [...waypoints],
    });
  }

  getMatrix(
    origins: readonly LatLng[],
    destinations: readonly LatLng[],
    options?: Partial<RouteOptions>,
  ): Promise<MatrixResult> {
    void options;
    const elements: MatrixElement[] = [];

    for (let originIndex = 0; originIndex < origins.length; originIndex += 1) {
      const origin = origins[originIndex];
      if (!origin) {
        continue;
      }

      for (let destinationIndex = 0; destinationIndex < destinations.length; destinationIndex += 1) {
        const destination = destinations[destinationIndex];
        if (!destination) {
          continue;
        }

        const leg = this.leg(origin, destination);
        elements.push({
          originIndex,
          destinationIndex,
          reachable: true,
          distanceKm: leg.distanceKm,
          durationMin: leg.durationMin,
        });
      }
    }

    return Promise.resolve({ elements });
  }
}

export const DEFAULT_MOCK_ROUTE_OPTIONS = DEFAULT_ROUTE_OPTIONS;
