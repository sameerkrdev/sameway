import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";

import type { LatLng } from "@/domain/entities";

export interface PolylineOptions {
  path: LatLng[];
  color: string;
  weight?: number;
  opacity?: number;
  dashed?: boolean;
  zIndex?: number;
  visible?: boolean;
}

/**
 * Imperative polyline.
 *
 * Google's overlays are not React components, so they are created once and
 * mutated in place. Re-creating them on every render would thrash the map on
 * scenarios with hundreds of routes.
 */
export function usePolyline(options: PolylineOptions | null): void {
  const map = useMap();
  const ref = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || !options) {
      ref.current?.setMap(null);
      ref.current = null;
      return;
    }

    const strokeOptions: google.maps.PolylineOptions = {
      path: options.path,
      strokeColor: options.color,
      strokeOpacity: options.dashed ? 0 : (options.opacity ?? 0.9),
      strokeWeight: options.weight ?? 4,
      zIndex: options.zIndex ?? 1,
      visible: options.visible ?? true,
      clickable: false,
      ...(options.dashed
        ? {
            icons: [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeOpacity: options.opacity ?? 0.9,
                  strokeColor: options.color,
                  strokeWeight: options.weight ?? 4,
                  scale: 3,
                },
                offset: "0",
                repeat: "14px",
              },
            ],
          }
        : {}),
    };

    if (!ref.current) {
      ref.current = new google.maps.Polyline(strokeOptions);
      ref.current.setMap(map);
    } else {
      ref.current.setOptions(strokeOptions);
    }
  }, [map, options]);

  useEffect(
    () => () => {
      ref.current?.setMap(null);
      ref.current = null;
    },
    [],
  );
}

export interface PolygonSpec {
  key: string;
  paths: LatLng[];
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWeight?: number;
}

/**
 * Renders a batch of polygons, reusing overlay instances across renders.
 *
 * H3 grids can easily reach a few hundred hexagons; allocating fresh overlays
 * each time is what makes a hex grid feel sluggish.
 */
export function usePolygons(specs: PolygonSpec[]): void {
  const map = useMap();
  const pool = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map) {
      return;
    }

    while (pool.current.length < specs.length) {
      const polygon = new google.maps.Polygon({ clickable: false });
      polygon.setMap(map);
      pool.current.push(polygon);
    }

    specs.forEach((spec, index) => {
      const polygon = pool.current[index];
      if (!polygon) {
        return;
      }
      polygon.setOptions({
        paths: spec.paths,
        fillColor: spec.fillColor,
        fillOpacity: spec.fillOpacity,
        strokeColor: spec.strokeColor,
        strokeWeight: spec.strokeWeight ?? 1,
        strokeOpacity: 0.6,
        visible: true,
        zIndex: 0,
      });
    });

    for (let index = specs.length; index < pool.current.length; index += 1) {
      pool.current[index]?.setOptions({ visible: false, paths: [] });
    }
  }, [map, specs]);

  useEffect(() => {
    const polygons = pool.current;
    return () => {
      for (const polygon of polygons) {
        polygon.setMap(null);
      }
      pool.current = [];
    };
  }, []);
}

export function useFitBounds(points: LatLng[] | null, nonce: number | null): void {
  const map = useMap();

  useEffect(() => {
    if (!map || !points || points.length === 0 || nonce === null) {
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    for (const point of points) {
      bounds.extend(point);
    }

    map.fitBounds(bounds, 96);
  }, [map, points, nonce]);
}
