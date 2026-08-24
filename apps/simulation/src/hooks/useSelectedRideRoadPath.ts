import { useEffect, useMemo, useState } from "react";

import type { LatLng, Scenario } from "@/domain/entities";
import { MAX_INTERMEDIATE_WAYPOINTS } from "@/domain/settings";
import { rideToWaypoints } from "@/lib/ridePath";
import {
  createGoogleRoutesEngine,
  DEFAULT_ROUTE_OPTIONS,
  preloadRoutesLibrary,
  RoutingCache,
  routesLibraryStatus,
} from "@/routing";
import { useSettingsStore } from "@/stores/settingsStore";

/** Shared across selections so re-selecting the same ride does not re-bill. */
const previewCache = new RoutingCache({ coordinatePrecision: 5 });

function waypointsKey(waypoints: readonly LatLng[]): string {
  return waypoints.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(";");
}

/**
 * Road polyline for the selected driver's committed ride.
 *
 * Uses Google Routes when available; otherwise (and while loading) returns the
 * straight stop-to-stop path so the map never blanks. Preview fetches are
 * cached separately from the matching run budget.
 */
export function useSelectedRideRoadPath(
  scenario: Scenario,
  selectedDriverId: string | null,
): { path: LatLng[]; isRoad: boolean; loading: boolean } {
  const routingMode = useSettingsStore((state) => state.settings.routingMode);

  const waypoints = useMemo(() => {
    if (!selectedDriverId) {
      return [] as LatLng[];
    }
    const ride = scenario.rides.find((entry) => entry.driverId === selectedDriverId);
    return ride ? rideToWaypoints(scenario, ride) : [];
  }, [scenario, selectedDriverId]);

  const key = waypointsKey(waypoints);
  const [roadByKey, setRoadByKey] = useState<{ key: string; path: LatLng[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (waypoints.length < 2 || routingMode === "MOCK") {
      setLoading(false);
      return;
    }

    const intermediates = waypoints.length - 2;
    if (intermediates > MAX_INTERMEDIATE_WAYPOINTS) {
      setLoading(false);
      return;
    }

    const cacheKey = previewCache.routeKey(waypoints, DEFAULT_ROUTE_OPTIONS);
    const cached = previewCache.getRoute(cacheKey);
    if (cached?.path && cached.path.length >= 2) {
      setRoadByKey({ key, path: cached.path });
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await preloadRoutesLibrary();
          if (cancelled) {
            return;
          }

          if (!routesLibraryStatus().loaded) {
            return;
          }

          const engine = createGoogleRoutesEngine();
          if (!engine) {
            return;
          }
          const result = await engine.getRoute(waypoints);
          if (cancelled) {
            return;
          }

          if (result.path && result.path.length >= 2) {
            previewCache.setRoute(cacheKey, result);
            setRoadByKey({ key, path: result.path });
          }
        } catch {
          // Straight-line fallback stays visible.
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, routingMode, waypoints]);

  const roadPath = roadByKey?.key === key ? roadByKey.path : null;

  return {
    path: roadPath && roadPath.length >= 2 ? roadPath : waypoints,
    isRoad: Boolean(roadPath && roadPath.length >= 2),
    loading: waypoints.length >= 2 && routingMode !== "MOCK" && loading && !roadPath,
  };
}
