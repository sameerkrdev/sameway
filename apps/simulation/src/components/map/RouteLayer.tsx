import { useMemo } from "react";

import type { LatLng, Ride, Scenario } from "@/domain/entities";
import { rideToWaypoints } from "@/lib/ridePath";
import type { DriverEvaluation } from "@/matching/types";

import { usePolyline } from "./useMapPrimitives";

const COMMITTED_ROUTE_COLOR = "#94a3b8";
const COVERED_ROUTE_COLOR = "#64748b";
const ORIGINAL_ROUTE_COLOR = "#64748b";
const PROPOSED_ROUTE_COLOR = "#22c55e";
const REJECTED_ROUTE_COLOR = "#ef4444";
const SELECTED_ROAD_COLOR = "#3b82f6";

/** Already-driven trail behind the vehicle. */
function CoveredRoute({ path, dimmed }: { path: LatLng[]; dimmed: boolean }) {
  usePolyline(
    path.length >= 2
      ? {
          path,
          color: COVERED_ROUTE_COLOR,
          weight: 4,
          opacity: dimmed ? 0.15 : 0.55,
          zIndex: 0,
        }
      : null,
  );
  return null;
}

/** One driver's committed remaining route. */
function CommittedRoute({
  path,
  dimmed,
  emphasized,
}: {
  path: LatLng[];
  dimmed: boolean;
  emphasized?: boolean;
}) {
  usePolyline(
    path.length >= 2
      ? {
          path,
          color: emphasized ? SELECTED_ROAD_COLOR : COMMITTED_ROUTE_COLOR,
          weight: emphasized ? 5 : 2,
          opacity: dimmed ? 0.18 : emphasized ? 0.9 : 0.45,
          zIndex: emphasized ? 4 : 1,
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
          weight: 5,
          opacity: 0.9,
          dashed: !feasible,
          zIndex: 7,
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
  selectedRoadPath,
  selectedRoadIsRoad,
  visibleDriverIds,
}: {
  scenario: Scenario;
  showAllRoutes: boolean;
  selectedDriverId: string | null;
  selectedEvaluation: DriverEvaluation | undefined;
  /** Google (or fallback) polyline for the selected driver's committed ride. */
  selectedRoadPath: LatLng[];
  selectedRoadIsRoad: boolean;
  visibleDriverIds: Set<string> | null;
}) {
  const insertion = selectedEvaluation?.insertion;
  const showSolvedRoute = Boolean(insertion?.path && insertion.path.length >= 2);

  const committedRoutes = useMemo(() => {
    const pathFor = (ride: Ride, isSelected: boolean): LatLng[] => {
      if (isSelected && selectedRoadPath.length >= 2) {
        return selectedRoadPath;
      }
      return rideToWaypoints(scenario, ride);
    };

    if (!showAllRoutes) {
      const ride = scenario.rides.find((entry) => entry.driverId === selectedDriverId);
      return ride
        ? [
            {
              id: ride.id,
              path: showSolvedRoute ? [] : pathFor(ride, true),
              coveredPath: ride.coveredPath ?? [],
              dimmed: false,
              emphasized: !showSolvedRoute && selectedRoadIsRoad,
            },
          ]
        : [];
    }

    return scenario.rides.map((ride) => {
      const isSelected = ride.driverId === selectedDriverId;
      const hideForSolved = isSelected && showSolvedRoute;
      return {
        id: ride.id,
        path: hideForSolved ? [] : pathFor(ride, isSelected),
        coveredPath: ride.coveredPath ?? [],
        dimmed: visibleDriverIds !== null && !visibleDriverIds.has(ride.driverId),
        emphasized: isSelected && !hideForSolved && selectedRoadIsRoad,
      };
    });
  }, [
    scenario,
    showAllRoutes,
    selectedDriverId,
    selectedRoadPath,
    selectedRoadIsRoad,
    visibleDriverIds,
    showSolvedRoute,
  ]);

  return (
    <>
      {committedRoutes.map((route) => (
        <span key={route.id}>
          <CoveredRoute path={route.coveredPath} dimmed={route.dimmed} />
          <CommittedRoute path={route.path} dimmed={route.dimmed} emphasized={route.emphasized} />
        </span>
      ))}
      <SelectedRoute
        originalPath={insertion?.originalPath}
        proposedPath={insertion?.path}
        feasible={selectedEvaluation?.finalStatus === "PASSED"}
      />
    </>
  );
}
