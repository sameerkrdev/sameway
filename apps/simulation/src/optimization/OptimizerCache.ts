import type { OptimizeToursRequest, OptimizeToursResult } from "./types";

/**
 * Memoises solver answers within a session.
 *
 * The key must cover every input that could change the answer — not merely the
 * coordinates. A stale hit here does not just cost accuracy, it silently
 * reports a delay budget that was never actually checked.
 */
export class OptimizerCache {
  private readonly entries = new Map<string, OptimizeToursResult>();

  static keyFor(request: OptimizeToursRequest): string {
    const shipments = request.shipments
      .map((shipment) =>
        [
          shipment.id,
          shipment.pickup.lat,
          shipment.pickup.lng,
          shipment.drop.lat,
          shipment.drop.lng,
          shipment.seats,
          shipment.pickupDeadlineMin ?? "-",
          shipment.dropDeadlineMin ?? "-",
          shipment.penaltyCost ?? "mandatory",
          shipment.softPickupDeadlineMin ?? "-",
          shipment.softDeadlineCostPerHour ?? "-",
        ].join(","),
      )
      .join("|");

    const locked = request.lockedVisits
      .map((visit) => `${visit.shipmentId}:${visit.type}`)
      .join(">");

    const precedence = request.committedPrecedence
      .map((visit) => `${visit.shipmentId}:${visit.type}`)
      .join(">");

    const hint = (request.firstSolutionVisits ?? [])
      .map((visit) => `${visit.shipmentId}:${visit.type}`)
      .join(">");

    return [
      request.driverId,
      request.vehicleStart.lat,
      request.vehicleStart.lng,
      request.seatCapacity,
      request.timeoutMs,
      shipments,
      locked,
      precedence,
      hint,
    ].join("::");
  }

  get(request: OptimizeToursRequest): OptimizeToursResult | undefined {
    return this.entries.get(OptimizerCache.keyFor(request));
  }

  set(request: OptimizeToursRequest, result: OptimizeToursResult): void {
    this.entries.set(OptimizerCache.keyFor(request), result);
  }

  clear(): void {
    this.entries.clear();
  }
}
