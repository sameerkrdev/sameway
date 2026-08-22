import type { Passenger, RideRequest, Stop, StopType } from "@/domain/entities";

import type { ProposedStop } from "./types";

/**
 * Converts committed ride stops into the engine's working representation,
 * resolving each stop's seat count from its passenger.
 *
 * Stops whose passenger has already been dropped or has cancelled are removed:
 * they are historical, and leaving them in would both distort the baseline
 * route and corrupt the occupancy walk.
 */
export function toProposedStops(
  stops: readonly Stop[],
  passengersById: ReadonlyMap<string, Passenger>,
): ProposedStop[] {
  const proposed: ProposedStop[] = [];

  for (const stop of stops) {
    const passenger = passengersById.get(stop.passengerId);
    if (!passenger || passenger.state === "DROPPED" || passenger.state === "CANCELLED") {
      continue;
    }

    // An onboard passenger's pickup already happened; it is not a remaining
    // stop, and their seats are accounted for by the occupancy seed instead.
    if (stop.type === "PICKUP" && (passenger.state === "PICKED_UP" || passenger.state === "IN_RIDE")) {
      continue;
    }

    proposed.push({
      id: stop.id,
      passengerId: stop.passengerId,
      type: stop.type,
      location: stop.location,
      seats: passenger.seatsRequired,
      isNew: false,
    });
  }

  return proposed;
}

export function newRiderStops(request: RideRequest): { pickup: ProposedStop; drop: ProposedStop } {
  return {
    pickup: {
      id: `${request.id}:pickup`,
      passengerId: request.passengerId,
      type: "PICKUP",
      location: request.pickup,
      seats: request.seatsRequired,
      isNew: true,
    },
    drop: {
      id: `${request.id}:drop`,
      passengerId: request.passengerId,
      type: "DROP",
      location: request.drop,
      seats: request.seatsRequired,
      isNew: true,
    },
  };
}

export interface OrderingViolation {
  passengerId: string;
  message: string;
}

/**
 * Finds passengers whose drop is scheduled before their pickup.
 *
 * Used by the route editor after a manual reorder. The insertion engine cannot
 * produce these by construction, but a human dragging stops around certainly
 * can.
 */
export function findOrderingViolations(
  stops: readonly { passengerId: string; type: StopType }[],
  nameFor: (passengerId: string) => string = (id) => id,
): OrderingViolation[] {
  const pickupIndex = new Map<string, number>();
  const violations: OrderingViolation[] = [];

  stops.forEach((stop, index) => {
    if (stop.type === "PICKUP") {
      if (!pickupIndex.has(stop.passengerId)) {
        pickupIndex.set(stop.passengerId, index);
      }
      return;
    }

    if (!pickupIndex.has(stop.passengerId)) {
      violations.push({
        passengerId: stop.passengerId,
        message: `${nameFor(stop.passengerId)} is dropped before being picked up.`,
      });
    }
  });

  return violations;
}

/** Passengers still consuming or about to consume a seat on this ride. */
export function activePassengerIds(
  passengerIds: readonly string[],
  passengersById: ReadonlyMap<string, Passenger>,
): string[] {
  return passengerIds.filter((passengerId) => {
    const passenger = passengersById.get(passengerId);
    return passenger !== undefined && passenger.state !== "DROPPED" && passenger.state !== "CANCELLED";
  });
}
