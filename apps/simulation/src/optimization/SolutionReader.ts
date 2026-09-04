import type { RouteLegResult } from "@/routing/types";
import type { ProposedStop } from "@/matching/types";

import type { OptimizerVisit, OptimizeToursRequest, OptimizeToursResult } from "./types";

interface RawVisit {
  shipmentIndex?: number;
  isPickup?: boolean;
  startTime?: string;
}

interface RawTransition {
  travelDistanceMeters?: number;
  travelDuration?: string;
}

interface RawRoute {
  visits?: RawVisit[];
  transitions?: RawTransition[];
  vehicleStartTime?: string;
}

interface RawResponse {
  routes?: RawRoute[];
  skippedShipments?: { index?: number }[];
}

/**
 * Google durations are protobuf `Duration` strings: a number of seconds plus
 * "s". A value that parses to `NaN` must not silently flow into
 * `totalDurationMin` — later stages compare measurements against thresholds
 * with `value > limit`, and `NaN > limit` is always `false`. A malformed
 * duration would therefore *clear* every hard constraint instead of tripping
 * one, producing a driver who silently passes checks it never actually met.
 * Refuse it the same way the transition-count mismatch is refused.
 */
function durationToMinutes(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value.replace(/s$/, ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Solver returned an unparseable travel duration: ${JSON.stringify(value)}`);
  }
  return parsed / 60;
}

/**
 * Same reasoning as `durationToMinutes`: a non-numeric distance must not
 * silently become `NaN` and clear downstream threshold checks. `undefined`
 * (the field genuinely absent) is treated as `0`; anything else must be a
 * finite number.
 */
function distanceMetersToKm(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Solver returned an unparseable travel distance: ${JSON.stringify(value)}`);
  }
  return value / 1000;
}

function minutesBetween(startIso: string | undefined, endIso: string | undefined): number {
  if (!startIso || !endIso) {
    return 0;
  }
  return (Date.parse(endIso) - Date.parse(startIso)) / 60000;
}

/**
 * Reads a raw `optimizeTours` response into our own shape.
 *
 * Google's wire format stops here: nothing downstream of this function knows
 * about `shipmentIndex`, protobuf durations, or ISO visit times. That is what
 * makes the Phase 3 in-house solver a drop-in replacement rather than a
 * rewrite.
 */
export function readOptimizeToursResponse(
  request: OptimizeToursRequest,
  body: unknown,
): OptimizeToursResult {
  const raw = (body ?? {}) as RawResponse;
  const route = raw.routes?.[0];

  const skippedShipmentIds = (raw.skippedShipments ?? [])
    .map((skipped) => request.shipments[skipped.index ?? 0]?.id)
    .filter((id): id is string => id !== undefined);

  if (!route || !route.visits || route.visits.length === 0) {
    return {
      visits: [],
      legs: [],
      totalDistanceKm: 0,
      totalDurationMin: 0,
      skippedShipmentIds,
    };
  }

  const rawVisits = route.visits;
  const transitions = route.transitions ?? [];

  // The API emits one transition before each visit, and optionally one more
  // returning to the depot. Anything else means the visit-to-leg mapping is
  // not trustworthy, and mis-attributing a leg puts the delay on the wrong
  // passenger — a silent, plausible-looking wrong answer. Fail loudly instead.
  if (transitions.length !== rawVisits.length && transitions.length !== rawVisits.length + 1) {
    throw new Error(
      `Solver returned ${transitions.length} transitions for ${rawVisits.length} visits`,
    );
  }

  const visits: OptimizerVisit[] = [];
  const legs: RouteLegResult[] = [];
  let totalDistanceKm = 0;
  let totalDurationMin = 0;

  for (let index = 0; index < rawVisits.length; index += 1) {
    const rawVisit = rawVisits[index]!;
    // Protobuf JSON omits default values: shipmentIndex 0 and isPickup false
    // simply do not appear on the wire.
    const shipmentIndex = rawVisit.shipmentIndex ?? 0;
    const shipment = request.shipments[shipmentIndex];

    if (!shipment) {
      throw new Error(`Solver referenced unknown shipmentIndex ${String(shipmentIndex)}`);
    }

    const type = rawVisit.isPickup === true ? "PICKUP" : "DROP";
    if (type === "PICKUP" && !shipment.pickup) {
      throw new Error(`Solver returned a pickup for delivery-only shipment ${shipment.id}`);
    }
    visits.push({
      shipmentId: shipment.id,
      passengerId: shipment.passengerId,
      type,
      location: type === "PICKUP" ? shipment.pickup! : shipment.drop,
      arrivalMin: minutesBetween(route.vehicleStartTime, rawVisit.startTime),
    });

    const transition = transitions[index] ?? {};
    const leg: RouteLegResult = {
      distanceKm: distanceMetersToKm(transition.travelDistanceMeters),
      durationMin: durationToMinutes(transition.travelDuration),
    };

    legs.push(leg);
    totalDistanceKm += leg.distanceKm;
    totalDurationMin += leg.durationMin;
  }

  return { visits, legs, totalDistanceKm, totalDurationMin, skippedShipmentIds };
}

/**
 * Converts a solved route into the `ProposedStop[]` the rest of the matching
 * engine already speaks, so stages 9–12 need no new vocabulary.
 */
export function toProposedStopSequence(
  result: OptimizeToursResult,
  newPassengerId: string,
): ProposedStop[] {
  return result.visits.map((visit) => ({
    id: `${visit.shipmentId}:${visit.type}`,
    passengerId: visit.passengerId,
    type: visit.type,
    location: visit.location,
    seats: 0,
    isNew: visit.passengerId === newPassengerId,
  }));
}
