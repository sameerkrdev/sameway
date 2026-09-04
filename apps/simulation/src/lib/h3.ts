/**
 * The only module permitted to import `h3-js` (enforced by an ESLint
 * `no-restricted-imports` rule).
 *
 * H3 answers spatial questions only: which cell, which ring, how many grid
 * hops. A grid distance is a topological hop count, never a distance in
 * kilometres and never an ETA. Callers that need proximity must use
 * `lib/geo.ts` for straight-line distance or the RoutingEngine for road
 * distance and travel time.
 */
import {
  cellToBoundary,
  cellToLatLng,
  getHexagonEdgeLengthAvg,
  gridDisk,
  gridDiskDistances,
  gridDistance,
  latLngToCell,
  polygonToCells,
} from "h3-js";

import type { LatLng } from "@/domain/entities";

import { haversineKm } from "./geo";

export type H3Index = string;

function edgeLengthKm(resolution: number): number {
  return getHexagonEdgeLengthAvg(resolution, "km");
}

export function getH3Cell(lat: number, lng: number, resolution: number): H3Index {
  return latLngToCell(lat, lng, resolution);
}

export function getH3CellFor(point: LatLng, resolution: number): H3Index {
  return latLngToCell(point.lat, point.lng, resolution);
}

/**
 * Returns cells grouped by ring distance from `origin`: index 0 holds the
 * origin cell, index 1 its six neighbours, and so on.
 *
 * Grouping comes straight from `gridDiskDistances`, so ring attribution is
 * exact and free. Flattening the disk and recomputing `gridDistance` per cell
 * afterwards would be both slower and lossier.
 */
export function getCellsByRing(origin: H3Index, maxRing: number): H3Index[][] {
  if (maxRing < 0) {
    return [];
  }
  return gridDiskDistances(origin, maxRing);
}

/** Unitless count of grid hops between two cells. Never a distance. */
export function getH3Distance(cellA: H3Index, cellB: H3Index): number {
  return gridDistance(cellA, cellB);
}

export function getCellBoundary(cell: H3Index): LatLng[] {
  return cellToBoundary(cell).map(([lat, lng]) => ({ lat, lng }));
}

export function getCellCenter(cell: H3Index): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

export function getCellsForPolygon(polygon: LatLng[], resolution: number): H3Index[] {
  const coordinates = polygon.map((point): [number, number] => [point.lat, point.lng]);
  return polygonToCells(coordinates, resolution);
}

/**
 * Buckets entities by H3 cell so candidate generation can look up a ring's
 * occupants directly instead of scanning every driver per ring.
 */
export function indexByCell<T>(
  items: readonly T[],
  getLocation: (item: T) => LatLng,
  resolution: number,
): Map<H3Index, T[]> {
  const index = new Map<H3Index, T[]>();

  for (const item of items) {
    const location = getLocation(item);
    const cell = latLngToCell(location.lat, location.lng, resolution);
    const bucket = index.get(cell);

    if (bucket) {
      bucket.push(item);
    } else {
      index.set(cell, [item]);
    }
  }

  return index;
}

/**
 * Every cell touched by a polyline, in order, deduplicated.
 *
 * `gridPathCells` between consecutive vertices would be the h3-js way to do
 * this, but it fails on cells that are not `gridDistance`-comparable across
 * pentagon boundaries. Sampling at a fraction of the cell edge length is
 * slower and completely robust, which is the right trade for a lab tool.
 */
export function cellsForPath(points: readonly LatLng[], resolution: number): H3Index[] {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    return [getH3CellFor(points[0]!, resolution)];
  }

  const stepKm = edgeLengthKm(resolution) / 2;
  const seen = new Set<H3Index>();
  const cells: H3Index[] = [];

  const push = (point: LatLng): void => {
    const cell = getH3CellFor(point, resolution);
    if (!seen.has(cell)) {
      seen.add(cell);
      cells.push(cell);
    }
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const segmentKm = haversineKm(a, b);
    const steps = Math.max(1, Math.ceil(segmentKm / stepKm));

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }

  return cells;
}

/** All cells within `ring` hops of `cell`, inclusive. A unitless hop count. */
export function gridDiskCells(cell: H3Index, ring: number): H3Index[] {
  return gridDisk(cell, ring);
}
