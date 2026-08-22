import { describe, expect, it } from "vitest";

import {
  polylineBearingDeg,
  pointToPolylineKm,
  projectOnPolylineKm,
} from "@/lib/geo";

// A short due-east line near Delhi. At this latitude 0.01 degrees of longitude
// is roughly 0.98 km, which is close enough for order-of-magnitude assertions
// without hard-coding a projection.
const line = [
  { lat: 28.6, lng: 77.2 },
  { lat: 28.6, lng: 77.3 },
];

describe("pointToPolylineKm", () => {
  it("is zero for a point on the line", () => {
    expect(pointToPolylineKm({ lat: 28.6, lng: 77.25 }, line)).toBeCloseTo(0, 3);
  });

  it("measures perpendicular offset, not endpoint distance", () => {
    const offset = pointToPolylineKm({ lat: 28.605, lng: 77.25 }, line);
    expect(offset).toBeGreaterThan(0.4);
    expect(offset).toBeLessThan(0.7);
  });

  it("clamps to the nearest endpoint for a point beyond the line", () => {
    const beyond = pointToPolylineKm({ lat: 28.6, lng: 77.4 }, line);
    expect(beyond).toBeCloseTo(9.8, 0);
  });

  it("returns Infinity for an empty polyline", () => {
    expect(pointToPolylineKm({ lat: 28.6, lng: 77.2 }, [])).toBe(Infinity);
  });
});

describe("projectOnPolylineKm", () => {
  it("returns zero at the start", () => {
    expect(projectOnPolylineKm({ lat: 28.6, lng: 77.2 }, line)).toBeCloseTo(0, 2);
  });

  it("grows monotonically along the line", () => {
    const quarter = projectOnPolylineKm({ lat: 28.6, lng: 77.225 }, line);
    const half = projectOnPolylineKm({ lat: 28.6, lng: 77.25 }, line);
    expect(half).toBeGreaterThan(quarter);
  });

  it("is unaffected by perpendicular offset", () => {
    const onLine = projectOnPolylineKm({ lat: 28.6, lng: 77.25 }, line);
    const offLine = projectOnPolylineKm({ lat: 28.61, lng: 77.25 }, line);
    expect(offLine).toBeCloseTo(onLine, 1);
  });
});

describe("polylineBearingDeg", () => {
  it("is due east for an eastward line", () => {
    expect(polylineBearingDeg(line)).toBeCloseTo(90, 0);
  });

  it("is null for a degenerate polyline", () => {
    expect(polylineBearingDeg([{ lat: 28.6, lng: 77.2 }])).toBeNull();
  });
});
