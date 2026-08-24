import type { LatLng, Passenger, RideRequest } from "@/domain/entities";
import { mockLeg } from "@/routing/MockRoutingEngine";

import type { OptimizerShipment, OptimizeToursRequest } from "./types";

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
}

export function shipmentIdFor(passengerId: string): string {
  return `ship_${passengerId}`;
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
 * The committed spine goes in twice — once as mandatory shipments with hard
 * deadlines, and once as `lockedVisits`. The deadlines say "you may not make
 * these people late"; the locked visits say "and you may not reshuffle them
 * relative to each other". Both are needed: without the lock, the solver would
 * happily reorder two passengers who are both still within tolerance, breaking
 * promises we already made about who gets collected first.
 *
 * UNRESOLVED — `lockedVisits` is stronger than that description.
 *
 * The proxy maps it to two relaxations on the injected route:
 *   1. `RELAX_VISIT_TIMES_AFTER_THRESHOLD` at `thresholdVisitCount = 0` so
 *      rough / zero ETAs cannot make the spine travel-infeasible.
 *   2. `RELAX_ALL_AFTER_THRESHOLD` at `thresholdVisitCount = spineLength + 1`
 *      so only the vehicle end (and anything after the locked visits) is
 *      free — new stops may only be appended after the committed spine.
 *
 * That still contradicts the Overview's flexible-commitment policy, which
 * allows inserting ahead of a committed pickup whenever that passenger's own
 * `maxPickupDelayMin` absorbs the delay — and it is the reason stages 5 and 6
 * enumerate and filter orderings at all. It also has two live consequences:
 * a rider can never be collected on the way to an existing rider's drop, which
 * is the most common pooling case; and committed arrivals never move relative
 * to each other in sequence, so existing-passenger delay from reordering is
 * structurally zero and the 30% existing-passenger term in stage 11's fairness
 * score is always zero with it.
 *
 * Relaxing it to a genuine relative-order constraint is a product decision
 * about how much freedom the solver gets over promises already made, so it is
 * left as specified rather than changed here. `incrementalCost.test.ts` pins
 * the current behaviour so the consequence stays visible.
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
      // An onboard passenger has no remaining pickup, so the vehicle's own
      // start position stands in for it: they are collected where the vehicle
      // already is, at time zero.
      pickup: stops.pickup?.location ?? vehicleStart,
      drop: drop.location,
      seats: passenger.seatsRequired,
      dropDeadlineMin: dropFloor + passenger.maxDropDelayMin,
      penaltyCost: null,
    };

    if (stops.pickup) {
      const pickupFloor = Math.max(
        stops.pickup.originalEtaMin,
        travelFloor.pickup.get(passengerId) ?? 0,
      );
      shipment.pickupDeadlineMin = pickupFloor + passenger.maxPickupDelayMin;
    }

    shipments.push(shipment);
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

  // Onboard passengers need a synthetic pickup at the vehicle start so Google
  // sees pickup-before-delivery. All of those pickups must lead the lock —
  // inserting one just before each drop would force a phantom return to the
  // vehicle start between drops and make the injected route travel-infeasible.
  const lockedVisits: OptimizeToursRequest["lockedVisits"] = [];
  const syntheticPickupOrder: string[] = [];
  const syntheticSeen = new Set<string>();

  for (const stop of committedStops) {
    if (
      stop.type === "DROP" &&
      !byPassenger.get(stop.passengerId)?.pickup &&
      !syntheticSeen.has(stop.passengerId)
    ) {
      syntheticPickupOrder.push(stop.passengerId);
      syntheticSeen.add(stop.passengerId);
    }
  }

  for (const passengerId of syntheticPickupOrder) {
    lockedVisits.push({ shipmentId: shipmentIdFor(passengerId), type: "PICKUP", startMin: 0 });
  }

  for (const stop of committedStops) {
    lockedVisits.push({
      shipmentId: shipmentIdFor(stop.passengerId),
      type: stop.type,
      startMin: stop.originalEtaMin,
    });
  }

  return {
    driverId,
    vehicleStart,
    seatCapacity,
    shipments,
    lockedVisits,
    timeoutMs,
  };
}
