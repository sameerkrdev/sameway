import { useMemo } from "react";

import type { LatLng, Ride, Scenario } from "@/domain/entities";
import type { DriverEvaluation } from "@/matching/types";

import { usePolyline } from "./useMapPrimitives";

const COMMITTED_ROUTE_COLOR = "#94a3b8";
const ORIGINAL_ROUTE_COLOR = "#64748b";
const PROPOSED_ROUTE_COLOR = "#22c55e";
const REJECTED_ROUTE_COLOR = "#ef4444";

function rideToPath(scenario: Scenario, ride: Ride): LatLng[] {
  const driver = scenario.drivers.find((entry) => entry.id === ride.driverId);
  const stops = [...ride.stops].sort((a, b) => a.sequence - b.sequence);
  const path = stops.map((stop) => stop.location);
  return driver ? [driver.location, ...path] : path;
}

/** One driver's committed route, drawn faintly for context. */
function CommittedRoute({ path, dimmed }: { path: LatLng[]; dimmed: boolean }) {
  usePolyline(
    path.length >= 2
      ? {
          path,
          color: COMMITTED_ROUTE_COLOR,
          weight: 2,
          opacity: dimmed ? 0.18 : 0.45,
          zIndex: 1,
        }
      : null,
  );
  return null;
}

/**
 * Original versus proposed route for the selected driver.
 *
 * Both are drawn together, and the proposed one turns red when it was
 * rejected, so a failure shows *what was attempted* rather than just
 * disappearing.
 */
function SelectedRoute({
  originalPath,
  proposedPath,
  feasible,
}: {
  originalPath: LatLng[] | undefined;
  proposedPath: LatLng[] | undefined;
  feasible: boolean;
}) {
  usePolyline(
    originalPath && originalPath.length >= 2
      ? { path: originalPath, color: ORIGINAL_ROUTE_COLOR, weight: 5, opacity: 0.6, zIndex: 5 }
      : null,
  );

  usePolyline(
    proposedPath && proposedPath.length >= 2
      ? {
          path: proposedPath,
          color: feasible ? PROPOSED_ROUTE_COLOR : REJECTED_ROUTE_COLOR,
          weight: 4,
          dashed: !feasible,
          zIndex: 6,
        }
      : null,
  );

  return null;
}

export function RouteLayer({
  scenario,
  showAllRoutes,
  selectedDriverId,
  selectedEvaluation,
  visibleDriverIds,
}: {
  scenario: Scenario;
  showAllRoutes: boolean;
  selectedDriverId: string | null;
  selectedEvaluation: DriverEvaluation | undefined;
  visibleDriverIds: Set<string> | null;
}) {
  const committedRoutes = useMemo(() => {
    if (!showAllRoutes) {
      // Drawing every committed route for 200 rides is unreadable and slow, so
      // by default only the selected driver's route is shown.
      const ride = scenario.rides.find((entry) => entry.driverId === selectedDriverId);
      return ride ? [{ id: ride.id, path: rideToPath(scenario, ride), dimmed: false }] : [];
    }

    return scenario.rides.map((ride) => ({
      id: ride.id,
      path: rideToPath(scenario, ride),
      dimmed: visibleDriverIds !== null && !visibleDriverIds.has(ride.driverId),
    }));
  }, [scenario, showAllRoutes, selectedDriverId, visibleDriverIds]);

  const insertion = selectedEvaluation?.insertion;

  return (
    <>
      {committedRoutes.map((route) => (
        <CommittedRoute key={route.id} path={route.path} dimmed={route.dimmed} />
      ))}
      <SelectedRoute
        originalPath={insertion?.originalPath}
        proposedPath={insertion?.path}
        feasible={insertion?.feasible ?? false}
      />
    </>
  );
}
