import type { LatLng, Passenger, RideRequest } from "@/domain/entities";

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
 * Turns a driver's committed route plus one new request into a solver model.
 *
 * The committed spine goes in twice — once as mandatory shipments with hard
 * deadlines, and once as `lockedVisits`. The deadlines say "you may not make
 * these people late"; the locked visits say "and you may not reshuffle them
 * relative to each other". Both are needed: without the lock, the solver would
 * happily reorder two passengers who are both still within tolerance, breaking
 * promises we already made about who gets collected first.
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

  const shipments: OptimizerShipment[] = [];

  for (const [passengerId, stops] of byPassenger) {
    const passenger = passengersById.get(passengerId);
    const drop = stops.drop;

    // A passenger with no remaining drop has nothing left to schedule.
    if (!passenger || !drop) {
      continue;
    }

    const shipment: OptimizerShipment = {
      id: shipmentIdFor(passengerId),
      passengerId,
      // An onboard passenger has no remaining pickup, so the vehicle's own
      // start position stands in for it: they are collected where the vehicle
      // already is, at time zero.
      pickup: stops.pickup?.location ?? vehicleStart,
      drop: drop.location,
      seats: passenger.seatsRequired,
      dropDeadlineMin: drop.originalEtaMin + passenger.maxDropDelayMin,
      penaltyCost: null,
    };

    if (stops.pickup) {
      shipment.pickupDeadlineMin = stops.pickup.originalEtaMin + passenger.maxPickupDelayMin;
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

  const lockedVisits = committedStops.map((stop) => ({
    shipmentId: shipmentIdFor(stop.passengerId),
    type: stop.type,
  }));

  return {
    driverId,
    vehicleStart,
    seatCapacity,
    shipments,
    lockedVisits,
    timeoutMs,
  };
}
