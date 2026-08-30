import {
  bearingDeg,
  bearingDifferenceDeg,
  classifyDropRelativeToRoute,
  polylineBearingDeg,
  projectOnPolylineKm,
} from "@/lib/geo";

import { reason, type MatchReason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 4. Pickup proximity is not enough.
 *
 * A pickup can sit perfectly on the corridor while the destination drags the
 * vehicle somewhere else entirely. Three cheap geometric signals catch that
 * before a solver call is spent: which way the trip is heading, whether the
 * destination is anywhere near the corridor, and whether it is ahead of the
 * vehicle or behind it.
 *
 * All three are approximations — roads are not straight lines, so a moderate
 * bearing difference is not proof of anything. The thresholds are deliberately
 * loose; this stage is here to catch the obviously wrong, not to be clever.
 */
export const directionCompatibilityStage: MatchingStage = {
  id: "directionCompatibility",
  name: "Direction Compatibility",
  description: "Bearing, destination proximity and destination progress along the route.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);

      if (!corridor) {
        continue;
      }

      // An idle driver's "route" is a single point: there is no direction to
      // be incompatible with, and every destination is ahead of them.
      if (corridor.isIdle) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [reason("DIRECTION_COMPATIBLE", "Driver is idle — no route to conflict with")],
        });
        continue;
      }

      // Check 5.1 — bearing difference. The corridor polyline is [driver.location,
      // …remainingStops]; polylineBearingDeg uses only the first and last point
      // (V → final remaining stop), not V → next stop and not segment-by-segment
      // turns. Compared against the new request's pickup → drop bearing.
      const routeBearing = polylineBearingDeg(corridor.polyline);
      const requestBearing = bearingDeg(request.pickup, request.drop);
      const difference =
        routeBearing === null ? 0 : bearingDifferenceDeg(routeBearing, requestBearing);

      const dropClass = classifyDropRelativeToRoute(
        request.drop,
        corridor.polyline,
        settings.maxBearingDifferenceDeg,
      );
      const pickupProgressKm = projectOnPolylineKm(request.pickup, corridor.polyline);

      context.recordMetrics(driverId, {
        bearingDifferenceDeg: round(difference, 1),
        dropToRouteKm: round(dropClass.perpendicularKm, 2),
        dropProgressKm: round(dropClass.dropProgressKm, 2),
        pickupProgressKm: round(pickupProgressKm, 2),
        corridorExtensionKm: dropClass.isAheadExtension ? round(dropClass.extensionKm, 2) : 0,
      });

      const failure = firstDirectionFailure({
        difference,
        dropClass,
        pickupProgressKm,
        maxBearingDifferenceDeg: settings.maxBearingDifferenceDeg,
        maxDropToRouteDistanceKm: settings.maxDropToRouteDistanceKm,
      });

      if (failure) {
        verdicts.push({ driverId, status: "FAILED", reasons: [failure] });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("DIRECTION_COMPATIBLE", "Request travels compatibly with this route", {
            value: round(difference, 1),
            threshold: settings.maxBearingDifferenceDeg,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

/** Checked in a fixed order so the reported reason is deterministic. */
function firstDirectionFailure(args: {
  difference: number;
  dropClass: ReturnType<typeof classifyDropRelativeToRoute>;
  pickupProgressKm: number;
  maxBearingDifferenceDeg: number;
  maxDropToRouteDistanceKm: number;
}): MatchReason | undefined {
  if (args.difference > args.maxBearingDifferenceDeg) {
    return reason("BEARING_INCOMPATIBLE", "Request heads in a different direction to this route", {
      value: round(args.difference, 1),
      threshold: args.maxBearingDifferenceDeg,
    });
  }

  // Forward extension on the same corridor uses lateral offset, not distance-to-endpoint.
  const offCorridorKm = args.dropClass.isAheadExtension
    ? args.dropClass.lateralKm
    : args.dropClass.perpendicularKm;

  if (offCorridorKm > args.maxDropToRouteDistanceKm) {
    return reason("DESTINATION_OFF_CORRIDOR", "Destination sits well off this route's corridor", {
      value: round(offCorridorKm, 2),
      threshold: args.maxDropToRouteDistanceKm,
    });
  }

  // A destination the vehicle would have to double back to reach is a reject
  // however close it is to the line — the same failure mode as a pickup behind
  // the vehicle, one stop further along.
  if (args.dropClass.dropProgressKm < args.pickupProgressKm) {
    return reason(
      "DESTINATION_BEHIND_VEHICLE",
      "Destination lies behind the pickup along this route's direction of travel",
      {
        value: round(args.dropClass.dropProgressKm, 2),
        threshold: round(args.pickupProgressKm, 2),
      },
    );
  }

  return undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
