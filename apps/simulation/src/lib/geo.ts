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

/**
 * Local planar approximation of a lat/lng pair, in kilometres, around an
 * anchor point.
 *
 * Point-to-segment projection has no closed form on a sphere. Over the few
 * kilometres a route corridor spans, flattening to a local tangent plane is
 * accurate to well under the H3 cell size we compare against, and it makes the
 * projection a two-line dot product instead of a spherical solve.
 */
function toLocalKm(point: LatLng, anchor: LatLng): { x: number; y: number } {
  const latRad = (anchor.lat * Math.PI) / 180;
  const kmPerDegLat = (Math.PI * EARTH_RADIUS_KM) / 180;
  const kmPerDegLng = kmPerDegLat * Math.cos(latRad);

  return {
    x: (point.lng - anchor.lng) * kmPerDegLng,
    y: (point.lat - anchor.lat) * kmPerDegLat,
  };
}

/** Fraction along `a → b` at which `p` projects; may exceed [0, 1] beyond segment ends. */
function segmentProjectionFractionUnclamped(p: LatLng, a: LatLng, b: LatLng): number {
  const pa = toLocalKm(p, a);
  const ba = toLocalKm(b, a);
  const lengthSquared = ba.x * ba.x + ba.y * ba.y;

  if (lengthSquared === 0) {
    return 0;
  }

  return (pa.x * ba.x + pa.y * ba.y) / lengthSquared;
}

/** Perpendicular distance from `p` to the infinite line through `a → b`. */
function perpendicularToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const pa = toLocalKm(p, a);
  const ba = toLocalKm(b, a);
  const length = Math.sqrt(ba.x * ba.x + ba.y * ba.y);

  if (length === 0) {
    return haversineKm(p, a);
  }

  return Math.abs(pa.x * ba.y - pa.y * ba.x) / length;
}

export interface DropRouteClassification {
  /** Shortest distance to any segment of the polyline. */
  perpendicularKm: number;
  /** Distance past the route terminus when the drop extends forward on-axis. */
  extensionKm: number;
  /** Lateral offset from the forward ray leaving the last segment. */
  lateralKm: number;
  /** Drop continues the corridor in the same direction beyond the last stop. */
  isAheadExtension: boolean;
  dropProgressKm: number;
  routeLengthKm: number;
}

/**
 * Classifies how a request drop relates to the driver's remaining-route polyline.
 *
 * `pointToPolylineKm` treats a drop 10 km past the last stop as "10 km off
 * corridor" even when it is colinear and same-direction. Extension pooling needs
 * that case split into forward extension vs sideways deviation.
 */
export function classifyDropRelativeToRoute(
  drop: LatLng,
  polyline: readonly LatLng[],
  maxBearingDifferenceDeg: number,
): DropRouteClassification {
  const perpendicularKm = pointToPolylineKm(drop, polyline);
  const routeLengthKm = pathLengthKm(polyline);
  const dropProgressKm = projectOnPolylineKm(drop, polyline);

  if (polyline.length < 2) {
    return {
      perpendicularKm,
      extensionKm: 0,
      lateralKm: perpendicularKm,
      isAheadExtension: false,
      dropProgressKm,
      routeLengthKm,
    };
  }

  const a = polyline[polyline.length - 2]!;
  const b = polyline[polyline.length - 1]!;
  const forwardBearing = bearingDeg(a, b);
  const extensionBearing = bearingDeg(b, drop);
  const bearingOk = bearingDifferenceDeg(forwardBearing, extensionBearing) <= maxBearingDifferenceDeg;
  const t = segmentProjectionFractionUnclamped(drop, a, b);
  const beyondTerminus = t >= 1 || dropProgressKm >= routeLengthKm - 0.05;
  const lateralKm = perpendicularToSegmentKm(drop, a, b);
  const extensionKm = beyondTerminus && bearingOk ? haversineKm(b, drop) : 0;
  const isAheadExtension = beyondTerminus && bearingOk && extensionKm > 0.05;

  return {
    perpendicularKm,
    extensionKm,
    lateralKm,
    isAheadExtension,
    dropProgressKm,
    routeLengthKm,
  };
}

/** Fraction along `a → b` at which `p` projects, clamped to the segment. */
function segmentProjectionFraction(p: LatLng, a: LatLng, b: LatLng): number {
  const pa = toLocalKm(p, a);
  const ba = toLocalKm(b, a);
  const lengthSquared = ba.x * ba.x + ba.y * ba.y;

  if (lengthSquared === 0) {
    return 0;
  }

  const t = (pa.x * ba.x + pa.y * ba.y) / lengthSquared;
  return Math.min(1, Math.max(0, t));
}

function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Minimum distance from a point to a polyline, in kilometres.
 *
 * This is a cheap geometric approximation of "how far off the route is this
 * pickup", never the real detour: a pickup 500 m off the line can cost a 1 km
 * round trip once one-way streets and medians are involved. Only stage 8 knows
 * the real number.
 */
export function pointToPolylineKm(point: LatLng, polyline: readonly LatLng[]): number {
  if (polyline.length === 0) {
    return Infinity;
  }

  if (polyline.length === 1) {
    return haversineKm(point, polyline[0]!);
  }

  let best = Infinity;

  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index]!;
    const b = polyline[index + 1]!;
    const nearest = interpolate(a, b, segmentProjectionFraction(point, a, b));
    best = Math.min(best, haversineKm(point, nearest));
  }

  return best;
}

/**
 * Distance along the polyline, from its start, of the point nearest to `point`.
 *
 * Stage 4 uses this to answer "is this destination ahead of the vehicle or
 * behind it" — a question raw proximity cannot answer, and the reason a pickup
 * sitting on the historical route must still be rejected.
 */
export function projectOnPolylineKm(point: LatLng, polyline: readonly LatLng[]): number {
  if (polyline.length < 2) {
    return 0;
  }

  let bestDistance = Infinity;
  let bestAlong = 0;
  let cumulative = 0;

  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index]!;
    const b = polyline[index + 1]!;
    const segmentKm = haversineKm(a, b);
    const t = segmentProjectionFraction(point, a, b);
    const nearest = interpolate(a, b, t);
    const distance = haversineKm(point, nearest);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = cumulative + segmentKm * t;
    }

    cumulative += segmentKm;
  }

  return bestAlong;
}

/** Start-to-end bearing of a polyline, or null if it has fewer than two points. */
export function polylineBearingDeg(polyline: readonly LatLng[]): number | null {
  if (polyline.length < 2) {
    return null;
  }

  return bearingDeg(polyline[0]!, polyline[polyline.length - 1]!);
}
