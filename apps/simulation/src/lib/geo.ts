import type { LatLng } from "@/domain/entities";

export const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Great-circle distance. This is straight-line distance, explicitly not road
 * distance; it is only ever used for cheap pruning and for display alongside
 * the road figures so the two can be compared.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total straight-line length of an ordered path. */
export function pathLengthKm(points: readonly LatLng[]): number {
  let total = 0;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous && current) {
      total += haversineKm(previous, current);
    }
  }

  return total;
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute angle between two bearings, 0-180 degrees. */
export function bearingDifferenceDeg(bearingA: number, bearingB: number): number {
  const difference = Math.abs(bearingA - bearingB) % 360;
  return difference > 180 ? 360 - difference : difference;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function boundsOf(points: readonly LatLng[]): BoundingBox | null {
  const first = points[0];
  if (!first) {
    return null;
  }

  let north = first.lat;
  let south = first.lat;
  let east = first.lng;
  let west = first.lng;

  for (const point of points) {
    north = Math.max(north, point.lat);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lng);
    west = Math.min(west, point.lng);
  }

  return { north, south, east, west };
}

export function padBounds(bounds: BoundingBox, paddingDegrees: number): BoundingBox {
  return {
    north: bounds.north + paddingDegrees,
    south: bounds.south - paddingDegrees,
    east: bounds.east + paddingDegrees,
    west: bounds.west - paddingDegrees,
  };
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

export function sameLocation(a: LatLng, b: LatLng, toleranceDegrees = 1e-7): boolean {
  return Math.abs(a.lat - b.lat) <= toleranceDegrees && Math.abs(a.lng - b.lng) <= toleranceDegrees;
}

/**
 * Offsets a point by a distance and bearing. Used by the scenario generator to
 * scatter entities around an anchor without drifting into invalid coordinates.
 */
export function offsetBy(origin: LatLng, distanceKm: number, bearingDegrees: number): LatLng {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDegrees(lat2),
    lng: ((toDegrees(lng2) + 540) % 360) - 180,
  };
}
