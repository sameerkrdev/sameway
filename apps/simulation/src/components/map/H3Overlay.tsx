import { useMemo } from "react";

import type { LatLng } from "@/domain/entities";
import { getCellBoundary, getCellsByRing, getH3CellFor } from "@/lib/h3";

import { usePolygons, type PolygonSpec } from "./useMapPrimitives";

/** Ring 0 is the strongest; each further ring fades, so depth reads at a glance. */
const RING_FILL_OPACITY = [0.3, 0.2, 0.14, 0.09, 0.06, 0.04];

export function H3Overlay({
  pickup,
  resolution,
  maxRing,
  searchedRing,
  extraCells,
}: {
  pickup: LatLng | null;
  resolution: number;
  maxRing: number;
  /** How far the last run actually expanded; beyond this is drawn as unsearched. */
  searchedRing: number | null;
  extraCells?: string[];
}) {
  const specs = useMemo<PolygonSpec[]>(() => {
    if (!pickup) {
      return [];
    }

    const origin = getH3CellFor(pickup, resolution);
    const rings = getCellsByRing(origin, maxRing);
    const output: PolygonSpec[] = [];

    rings.forEach((cells, ring) => {
      const searched = searchedRing === null || ring <= searchedRing;
      const fillOpacity = searched ? (RING_FILL_OPACITY[ring] ?? 0.03) : 0;

      for (const cell of cells) {
        output.push({
          key: cell,
          paths: getCellBoundary(cell),
          fillColor: searched ? "#38bdf8" : "#64748b",
          fillOpacity,
          strokeColor: searched ? "#38bdf8" : "#475569",
          strokeWeight: ring === 0 ? 2 : 1,
        });
      }
    });

    for (const cell of extraCells ?? []) {
      output.push({
        key: `extra:${cell}`,
        paths: getCellBoundary(cell),
        fillColor: "#f59e0b",
        fillOpacity: 0.25,
        strokeColor: "#f59e0b",
        strokeWeight: 2,
      });
    }

    return output;
  }, [pickup, resolution, maxRing, searchedRing, extraCells]);

  usePolygons(specs);

  return null;
}
