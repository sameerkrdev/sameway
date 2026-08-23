import {
  bearingDeg,
  bearingDifferenceDeg,
  pointToPolylineKm,
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

      const routeBearing = polylineBearingDeg(corridor.polyline);
      const requestBearing = bearingDeg(request.pickup, request.drop);
      const difference =
        routeBearing === null ? 0 : bearingDifferenceDeg(routeBearing, requestBearing);

      const dropToRouteKm = pointToPolylineKm(request.drop, corridor.polyline);
      const dropProgressKm = projectOnPolylineKm(request.drop, corridor.polyline);
      // The corridor polyline starts at the vehicle, so the vehicle's own
      // progress along it is zero and every point is trivially "ahead" of it.
      // The question that actually discriminates is whether the destination is
      // ahead of the *pickup* along the direction of travel: a drop that
      // projects earlier than its own pickup means the rider wants to go back
      // the way this vehicle came.
      const pickupProgressKm = projectOnPolylineKm(request.pickup, corridor.polyline);

      context.recordMetrics(driverId, {
        bearingDifferenceDeg: round(difference, 1),
        dropToRouteKm: round(dropToRouteKm, 2),
        dropProgressKm: round(dropProgressKm, 2),
        pickupProgressKm: round(pickupProgressKm, 2),
      });

      const failure = firstDirectionFailure({
        difference,
        dropToRouteKm,
        dropProgressKm,
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
  dropToRouteKm: number;
  dropProgressKm: number;
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

  if (args.dropToRouteKm > args.maxDropToRouteDistanceKm) {
    return reason("DESTINATION_OFF_CORRIDOR", "Destination sits well off this route's corridor", {
      value: round(args.dropToRouteKm, 2),
      threshold: args.maxDropToRouteDistanceKm,
    });
  }

  // A destination the vehicle would have to double back to reach is a reject
  // however close it is to the line — the same failure mode as a pickup behind
  // the vehicle, one stop further along.
  if (args.dropProgressKm < args.pickupProgressKm) {
    return reason(
      "DESTINATION_BEHIND_VEHICLE",
      "Destination lies behind the pickup along this route's direction of travel",
      {
        value: round(args.dropProgressKm, 2),
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
