import type { LatLng, Passenger, RideRequest } from "@/domain/entities";
import { mockLeg } from "@/routing/MockRoutingEngine";

import type { OptimizerShipment, OptimizerVisitRef, OptimizeToursRequest } from "./types";

/**
 * Cost charged for leaving the new passenger unserved.
 *
 * Any finite value works — it only has to be large enough that the solver
 * prefers serving them when serving them is feasible, and small enough that it
 * never distorts the committed passengers' mandatory constraints. What matters
 * is that it is finite: that is what turns infeasibility into a
 * `skippedShipments[]` entry instead of a failed request.
 */
const NEW_PASSENGER_PENALTY_COST = 1000;

/**
 * Google's road+traffic times routinely exceed our mock legs. Hard visit
 * windows on the wire must clear that gap, or OptimizeTours rejects the
 * injected spine as infeasible after fetching travel times
 * (`INVALID_REQUEST_AFTER_GETTING_TRAVEL_TIMES`).
 */
const GOOGLE_TRAVEL_SLACK = 2;

/** A committed stop, carrying the promise stage 6 and 10 protect. */
export interface CommittedStopInput {
  id: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  location: LatLng;
  seats: number;
  originalEtaMin: number;
}

export interface BuildShipmentModelInput {
  driverId: string;
  vehicleStart: LatLng;
  seatCapacity: number;
  /** The driver's remaining committed stops, in execution order. */
  committedStops: readonly CommittedStopInput[];
  passengersById: ReadonlyMap<string, Passenger>;
  request: RideRequest;
  /** Soft pickup deadline for the new rider, in minutes from now. */
  newPassengerSoftDeadlineMin: number;
  softDeadlineCostPerHour: number;
  timeoutMs: number;
  /** Best legal sequence from stage 7, if any — guides the solver. */
  firstSolutionVisits?: OptimizerVisitRef[];
}

export function shipmentIdFor(passengerId: string): string {
  return `ship_${passengerId}`;
}

/** Maps committed scenario stops to solver visit refs for precedence / hints. */
export function committedPrecedenceFrom(
  committedStops: readonly CommittedStopInput[],
): OptimizerVisitRef[] {
  return committedStops.map((stop) => ({
    shipmentId: shipmentIdFor(stop.passengerId),
    type: stop.type,
    startMin: stop.originalEtaMin,
  }));
}

/**
 * Lower-bound arrival minutes for each committed stop, using a slack'd mock
 * leg so hard Google windows stay reachable under real road times.
 */
function travelFloorsAlongSpine(
  vehicleStart: LatLng,
  committedStops: readonly CommittedStopInput[],
): { pickup: Map<string, number>; drop: Map<string, number> } {
  const pickup = new Map<string, number>();
  const drop = new Map<string, number>();
  let cumulativeMin = 0;
  let previous = vehicleStart;

  for (const stop of committedStops) {
    cumulativeMin += mockLeg(previous, stop.location).durationMin * GOOGLE_TRAVEL_SLACK;
    previous = stop.location;
    if (stop.type === "PICKUP") {
      pickup.set(stop.passengerId, cumulativeMin);
    } else {
      drop.set(stop.passengerId, cumulativeMin);
    }
  }

  return { pickup, drop };
}

/**
 * Turns a driver's committed route plus one new request into a solver model.
 *
 * The committed spine goes in as mandatory shipments with hard deadlines.
 * Those deadlines say "you may not make these people late" while still
 * allowing the solver to interleave the new rider when pickup-before-drop,
 * capacity, and per-passenger delay budgets permit.
 */
export function buildOptimizeToursRequest(
  input: BuildShipmentModelInput,
): OptimizeToursRequest {
  const {
    driverId,
    vehicleStart,
    seatCapacity,
    committedStops,
    passengersById,
    request,
    newPassengerSoftDeadlineMin,
    softDeadlineCostPerHour,
    timeoutMs,
    firstSolutionVisits,
  } = input;

  const byPassenger = new Map<string, { pickup?: CommittedStopInput; drop?: CommittedStopInput }>();

  for (const stop of committedStops) {
    const entry = byPassenger.get(stop.passengerId) ?? {};
    if (stop.type === "PICKUP") {
      entry.pickup = stop;
    } else {
      entry.drop = stop;
    }
    byPassenger.set(stop.passengerId, entry);
  }

  const travelFloor = travelFloorsAlongSpine(vehicleStart, committedStops);
  const shipments: OptimizerShipment[] = [];

  for (const [passengerId, stops] of byPassenger) {
    const passenger = passengersById.get(passengerId);
    const drop = stops.drop;

    // A passenger with no remaining drop has nothing left to schedule.
    if (!passenger || !drop) {
      continue;
    }

    const dropFloor = Math.max(drop.originalEtaMin, travelFloor.drop.get(passengerId) ?? 0);

    const shipment: OptimizerShipment = {
      id: shipmentIdFor(passengerId),
      passengerId,
      drop: drop.location,
      seats: passenger.seatsRequired,
      dropDeadlineMin: dropFloor + passenger.maxDropDelayMin,
      penaltyCost: null,
    };

    if (stops.pickup) {
      shipment.pickup = stops.pickup.location;
      const pickupFloor = Math.max(
        stops.pickup.originalEtaMin,
        travelFloor.pickup.get(passengerId) ?? 0,
      );
      shipment.pickupDeadlineMin = pickupFloor + passenger.maxPickupDelayMin;
    }

    shipments.push(shipment);
  }

  if (byPassenger.has(request.passengerId)) {
    throw new Error(
      `Request passenger ${request.passengerId} is already committed on this ride; matching a duplicate shipment would make OptimizeTours reject the model.`,
    );
  }

  shipments.push({
    id: shipmentIdFor(request.passengerId),
    passengerId: request.passengerId,
    pickup: request.pickup,
    drop: request.drop,
    seats: request.seatsRequired,
    penaltyCost: NEW_PASSENGER_PENALTY_COST,
    softPickupDeadlineMin: newPassengerSoftDeadlineMin,
    softDeadlineCostPerHour,
  });

  return {
    driverId,
    vehicleStart,
    seatCapacity,
    shipments,
    committedPrecedence: committedPrecedenceFrom(committedStops),
    firstSolutionVisits,
    lockedVisits: [],
    timeoutMs,
  };
}
