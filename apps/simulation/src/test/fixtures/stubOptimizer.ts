import { mockLeg } from "@/routing/MockRoutingEngine";
import type {
  OptimizerEngine,
  OptimizerVisit,
  OptimizeToursRequest,
  OptimizeToursResult,
} from "@/optimization/types";
import type { RouteLegResult } from "@/routing/types";


interface Candidate {
  visits: { shipmentIndex: number; type: "PICKUP" | "DROP" }[];
}

/**
 * A deterministic stand-in for `OptimizeTours`.
 *
 * It honours the same contract the real solver does — committed precedence,
 * capacity, hard deadlines, mandatory versus skippable shipments — and picks the
 * shortest straight-line legal ordering. That is not what Google's solver
 * optimises for, and it does not need to be: these tests assert that the
 * pipeline handles a solution correctly, not that the solver is good.
 */
export class StubOptimizerEngine implements OptimizerEngine {
  readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
  readonly requests: OptimizeToursRequest[] = [];

  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    this.requests.push(request);

    const orderings = enumerateLegalOrderings(request);
    const scored = orderings
      .map((candidate) => ({ candidate, cost: costOf(request, candidate) }))
      .filter((entry) => Number.isFinite(entry.cost))
      .sort((a, b) => a.cost - b.cost);

    const winner = scored[0];

    if (!winner) {
      // Nothing legal serves everybody. Drop the skippable shipments and
      // report them, exactly as the real API does.
      const skippable = request.shipments.filter((shipment) => shipment.penaltyCost !== null);
      const reduced: OptimizeToursRequest = {
        ...request,
        shipments: request.shipments.filter((shipment) => shipment.penaltyCost === null),
      };

      if (skippable.length === 0 || reduced.shipments.length === request.shipments.length) {
        return Promise.resolve({
          visits: [],
          legs: [],
          totalDistanceKm: 0,
          totalDurationMin: 0,
          skippedShipmentIds: skippable.map((shipment) => shipment.id),
        });
      }

      return this.optimize(reduced).then((result) => ({
        ...result,
        skippedShipmentIds: [...result.skippedShipmentIds, ...skippable.map((s) => s.id)],
      }));
    }

    return Promise.resolve(materialise(request, winner.candidate));
  }
}

function enumerateLegalOrderings(request: OptimizeToursRequest): Candidate[] {
  const events = request.shipments.flatMap((shipment, index) =>
    shipment.pickup
      ? [
          { shipmentIndex: index, type: "PICKUP" as const },
          { shipmentIndex: index, type: "DROP" as const },
        ]
      : [{ shipmentIndex: index, type: "DROP" as const }],
  );

  const results: Candidate[] = [];

  const walk = (remaining: typeof events, built: typeof events): void => {
    if (remaining.length === 0) {
      results.push({ visits: [...built] });
      return;
    }

    for (let index = 0; index < remaining.length; index += 1) {
      const event = remaining[index]!;

      // Precedence: a drop may only follow its own pickup, unless the
      // shipment is delivery-only (already aboard / pre-loaded).
      if (event.type === "DROP") {
        const shipment = request.shipments[event.shipmentIndex]!;
        if (
          shipment.pickup &&
          !built.some((done) => done.shipmentIndex === event.shipmentIndex && done.type === "PICKUP")
        ) {
          continue;
        }
      }

      walk([...remaining.slice(0, index), ...remaining.slice(index + 1)], [...built, event]);
    }
  };

  walk(events, []);

  return results.filter((candidate) => respectsRouteConstraints(request, candidate));
}

/**
 * Legacy append-only lock: committed visits must sit at the head in order.
 * Otherwise `committedPrecedence` must appear as an ordered subsequence.
 */
function respectsRouteConstraints(request: OptimizeToursRequest, candidate: Candidate): boolean {
  const indexById = new Map(request.shipments.map((shipment, index) => [shipment.id, index]));

  if (request.lockedVisits.length > 0) {
    return request.lockedVisits.every((locked, position) => {
      const visit = candidate.visits[position];
      return (
        visit !== undefined &&
        visit.type === locked.type &&
        visit.shipmentIndex === indexById.get(locked.shipmentId)
      );
    });
  }

  const committed = request.committedPrecedence;
  if (committed.length === 0) {
    return true;
  }

  let searchFrom = 0;
  for (const locked of committed) {
    const shipmentIndex = indexById.get(locked.shipmentId);
    if (shipmentIndex === undefined) {
      return false;
    }

    let found = false;
    for (let index = searchFrom; index < candidate.visits.length; index += 1) {
      const visit = candidate.visits[index]!;
      if (visit.shipmentIndex === shipmentIndex && visit.type === locked.type) {
        searchFrom = index + 1;
        found = true;
        break;
      }
    }

    if (!found) {
      return false;
    }
  }

  return true;
}

function visitLocation(
  shipment: OptimizeToursRequest["shipments"][number],
  type: "PICKUP" | "DROP",
) {
  if (type === "PICKUP") {
    if (!shipment.pickup) {
      throw new Error(`Pickup visit for delivery-only shipment ${shipment.id}`);
    }
    return shipment.pickup;
  }
  return shipment.drop;
}

/** Road cost, or Infinity if capacity or a hard deadline is broken. */
function costOf(request: OptimizeToursRequest, candidate: Candidate): number {
  // Delivery-only shipments are already aboard: Google treats them as
  // pre-loaded, so occupancy starts at those seats rather than zero.
  let occupancy = request.shipments
    .filter((shipment) => !shipment.pickup)
    .reduce((sum, shipment) => sum + shipment.seats, 0);
  let cumulativeKm = 0;
  let arrivalMin = 0;
  let previous = request.vehicleStart;

  for (const visit of candidate.visits) {
    const shipment = request.shipments[visit.shipmentIndex]!;
    const location = visitLocation(shipment, visit.type);

    const leg = mockLeg(previous, location);
    cumulativeKm += leg.distanceKm;
    arrivalMin += leg.durationMin;
    previous = location;

    occupancy += visit.type === "PICKUP" ? shipment.seats : -shipment.seats;
    if (occupancy > request.seatCapacity) {
      return Infinity;
    }

    const deadline = visit.type === "PICKUP" ? shipment.pickupDeadlineMin : shipment.dropDeadlineMin;

    if (deadline !== undefined && arrivalMin > deadline) {
      return Infinity;
    }
  }

  return cumulativeKm;
}

function materialise(request: OptimizeToursRequest, candidate: Candidate): OptimizeToursResult {
  const visits: OptimizerVisit[] = [];
  const legs: RouteLegResult[] = [];
  let previous = request.vehicleStart;
  let cumulativeMin = 0;
  let totalDistanceKm = 0;

  for (const visit of candidate.visits) {
    const shipment = request.shipments[visit.shipmentIndex]!;
    const location = visitLocation(shipment, visit.type);
    const leg = mockLeg(previous, location);

    previous = location;
    cumulativeMin += leg.durationMin;
    totalDistanceKm += leg.distanceKm;

    legs.push(leg);
    visits.push({
      shipmentId: shipment.id,
      passengerId: shipment.passengerId,
      type: visit.type,
      location,
      arrivalMin: cumulativeMin,
    });
  }

  return {
    visits,
    legs,
    totalDistanceKm,
    totalDurationMin: cumulativeMin,
    skippedShipmentIds: [],
  };
}
