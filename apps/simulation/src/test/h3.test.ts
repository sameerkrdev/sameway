import { describe, expect, it } from "vitest";

import type { LatLng } from "@/domain/entities";
import { getCellsByRing, getH3Cell, getH3Distance, indexByCell } from "@/lib/h3";

describe("h3 wrapper", () => {
  it("maps a known coordinate to its documented cell", () => {
    expect(getH3Cell(37.3615593, -122.0553238, 7)).toBe("87283472bffffff");
  });

  it("groups ring expansion by hop distance", () => {
    const origin = getH3Cell(28.6315, 77.2167, 9);
    const rings = getCellsByRing(origin, 3);

    expect(rings).toHaveLength(4);
    expect(rings[0]).toHaveLength(1);
    expect(rings[0]?.[0]).toBe(origin);
    // Hexagonal rings grow by six per step.
    expect(rings[1]).toHaveLength(6);
    expect(rings[2]).toHaveLength(12);
    expect(rings[3]).toHaveLength(18);
  });

  it("attributes every cell to the ring matching its grid distance", () => {
    const origin = getH3Cell(28.6315, 77.2167, 9);
    const rings = getCellsByRing(origin, 3);

    rings.forEach((cells, ringIndex) => {
      for (const cell of cells) {
        expect(getH3Distance(origin, cell)).toBe(ringIndex);
      }
    });
  });

  it("returns nothing for a negative ring count", () => {
    expect(getCellsByRing(getH3Cell(28.6315, 77.2167, 9), -1)).toEqual([]);
  });

  it("buckets entities by cell so a ring lookup never rescans the pool", () => {
    const points: { id: string; location: LatLng }[] = [
      { id: "a", location: { lat: 28.6315, lng: 77.2167 } },
      { id: "b", location: { lat: 28.6315, lng: 77.2167 } },
      { id: "c", location: { lat: 28.7041, lng: 77.1025 } },
    ];

    const index = indexByCell(points, (point) => point.location, 9);
    const cellForA = getH3Cell(28.6315, 77.2167, 9);

    expect(index.get(cellForA)?.map((point) => point.id)).toEqual(["a", "b"]);
    expect(index.size).toBe(2);
  });

  it("never reports a driver twice when rings overlap a shared cell", () => {
    const origin = getH3Cell(28.6315, 77.2167, 9);
    const rings = getCellsByRing(origin, 3);
    const flattened = rings.flat();

    expect(new Set(flattened).size).toBe(flattened.length);
  });
});
