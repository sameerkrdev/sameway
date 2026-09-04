import { describe, expect, it } from "vitest";

import { toShipmentModel, type ProxyRequest } from "../../server/optimizerProxy";

/**
 * The wire format OptimizeTours actually accepts.
 *
 * These are validation rules, not preferences: the API rejects the whole
 * request with "Violation in ...: `nanos` must be unset" for a fractional
 * timestamp, and "invalid duration" for a sub-second timeout. Both were live
 * bugs — every run failed with OPTIMIZER_CALL_FAILED at stage 8 — and neither
 * is visible from any unit test of our own types, because our own types are
 * fine. Only the translation is wrong.
 *
 * Asserted by sweeping the built payload rather than by naming the four fields
 * we know about, so a timestamp added later is covered without anyone
 * remembering to extend this.
 */
function collectStrings(value: unknown, path = "$"): { path: string; value: string }[] {
  if (typeof value === "string") {
    return [{ path, value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStrings(entry, `${path}[${String(index)}]`));
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectStrings(entry, `${path}.${key}`),
    );
  }

  return [];
}

// 14:23:45.678 — deliberately off a second boundary, which is the normal case:
// deadlines are fractional minutes, so the instant almost never lands on one.
const NOW_MS = Date.UTC(2026, 7, 23, 14, 23, 45, 678);

const request: ProxyRequest = {
  vehicleStart: { lat: 28.6, lng: 77.2 },
  seatCapacity: 4,
  timeoutMs: 400,
  shipments: [
    {
      id: "ship_pA",
      pickup: { lat: 28.6, lng: 77.22 },
      drop: { lat: 28.6, lng: 77.34 },
      seats: 1,
      // Fractional minutes, as every real deadline is.
      pickupDeadlineMin: 7.317,
      dropDeadlineMin: 31.883,
      penaltyCost: null,
    },
    {
      id: "ship_pNew",
      pickup: { lat: 28.6, lng: 77.26 },
      drop: { lat: 28.6, lng: 77.31 },
      seats: 1,
      penaltyCost: 100,
      softPickupDeadlineMin: 6.5,
      softDeadlineCostPerHour: 50,
    },
  ],
  committedPrecedence: [
    { shipmentId: "ship_pA", type: "PICKUP" },
    { shipmentId: "ship_pA", type: "DROP" },
  ],
  lockedVisits: [],
};

describe("OptimizeTours wire format", () => {
  it("emits no timestamp with a fractional second anywhere in the payload", () => {
    const payload = toShipmentModel(request, NOW_MS);

    const timestamps = collectStrings(payload).filter((entry) =>
      /^\d{4}-\d{2}-\d{2}T/.test(entry.value),
    );

    // Guard the guard: if the payload stops containing timestamps this test
    // would pass by vacuously finding none.
    expect(timestamps.length).toBeGreaterThanOrEqual(4);

    for (const { path, value } of timestamps) {
      expect(value, path).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });

  it("truncates rather than rounds, so a deadline is never moved later", () => {
    const payload = toShipmentModel(request, NOW_MS);
    const model = payload.model as Record<string, unknown>;

    // 14:23:45.678 + 0 min → 14:23:45, not 14:23:46.
    expect(model.globalStartTime).toBe("2026-08-23T14:23:45Z");
    // + 7.317 min = 14:31:04.698 → 14:31:04.
    const shipments = model.shipments as Record<string, unknown>[];
    const pickup = (shipments[0]!.pickups as Record<string, unknown>[])[0]!;
    const windows = pickup.timeWindows as Record<string, unknown>[];

    expect(windows[0]!.endTime).toBe("2026-08-23T14:31:04Z");
  });

  it("sends the solver timeout as a whole-second Duration", () => {
    // 400 ms was the default and produced "0.4s", which the API rejects.
    expect(toShipmentModel(request, NOW_MS).timeout).toBe("1s");
    expect(toShipmentModel({ ...request, timeoutMs: 2400 }, NOW_MS).timeout).toBe("3s");
    expect(toShipmentModel({ ...request, timeoutMs: 9_000_000 }, NOW_MS).timeout).toBe("1800s");
  });

  it("omits penaltyCost entirely for a mandatory shipment", () => {
    const model = toShipmentModel(request, NOW_MS).model as Record<string, unknown>;
    const shipments = model.shipments as Record<string, unknown>[];

    // null would be rejected; absence is how the API spells "mandatory".
    expect("penaltyCost" in shipments[0]!).toBe(false);
    expect(shipments[1]!.penaltyCost).toBe(100);
  });

  it("does not append-lock the route — committed order uses precedenceRules", () => {
    // Same-shipment pickup→drop is already implicit in ShipmentModel;
    // OptimizeTours rejects first_index == second_index. Only cross-shipment
    // consecutive pairs become rules.
    const payload = toShipmentModel(
      {
        ...request,
        shipments: [
          ...request.shipments.slice(0, 1),
          {
            id: "ship_pB",
            pickup: { lat: 28.61, lng: 77.23 },
            drop: { lat: 28.62, lng: 77.35 },
            seats: 1,
            dropDeadlineMin: 40,
            penaltyCost: null,
          },
          request.shipments[1]!,
        ],
        committedPrecedence: [
          { shipmentId: "ship_pA", type: "PICKUP" },
          { shipmentId: "ship_pA", type: "DROP" },
          { shipmentId: "ship_pB", type: "DROP" },
        ],
      },
      NOW_MS,
    );
    expect(payload.injectedSolutionConstraint).toBeUndefined();

    const model = payload.model as Record<string, unknown>;
    const rules = model.precedenceRules as Record<string, unknown>[];

    // P001 pickup→drop skipped (same index); only drop_A → drop_B remains.
    expect(rules).toEqual([
      {
        firstIndex: 0,
        firstIsDelivery: true,
        secondIndex: 1,
        secondIsDelivery: true,
        offsetDuration: "0s",
      },
    ]);
  });

  it("omits precedenceRules when every consecutive pair is the same shipment", () => {
    const model = toShipmentModel(request, NOW_MS).model as Record<string, unknown>;
    expect(model.precedenceRules).toBeUndefined();
  });

  it("emits injectedFirstSolutionRoutes as a hint when stage 7 provides a sequence", () => {
    const payload = toShipmentModel(
      {
        ...request,
        firstSolutionVisits: [
          { shipmentId: "ship_pA", type: "PICKUP", startMin: 0 },
          { shipmentId: "ship_pNew", type: "PICKUP", startMin: 4 },
          { shipmentId: "ship_pA", type: "DROP", startMin: 20 },
          { shipmentId: "ship_pNew", type: "DROP", startMin: 25 },
        ],
      },
      NOW_MS,
    );

    expect(payload.injectedSolutionConstraint).toBeUndefined();
    const routes = payload.injectedFirstSolutionRoutes as Record<string, unknown>[];
    const route = routes[0]!;

    expect(route.vehicleStartTime).toBe("2026-08-23T14:23:45Z");
    expect(route.visits).toEqual([
      { shipmentIndex: 0, isPickup: true, startTime: "2026-08-23T14:23:45Z" },
      { shipmentIndex: 1, isPickup: true, startTime: "2026-08-23T14:27:45Z" },
      { shipmentIndex: 0, isPickup: false, startTime: "2026-08-23T14:43:45Z" },
      { shipmentIndex: 1, isPickup: false, startTime: "2026-08-23T14:48:45Z" },
    ]);
  });

  it("rejects a committed visit naming a shipment that is not in the model", () => {
    expect(() =>
      toShipmentModel(
        {
          ...request,
          committedPrecedence: [{ shipmentId: "ship_ghost", type: "PICKUP" }],
        },
        NOW_MS,
      ),
    ).toThrow(/ship_ghost/);
  });

  it("omits pickups[] for a delivery-only (already onboard) shipment", () => {
    const payload = toShipmentModel(
      {
        ...request,
        shipments: [
          {
            id: "ship_pA",
            drop: { lat: 28.6, lng: 77.34 },
            seats: 1,
            dropDeadlineMin: 31.883,
            penaltyCost: null,
          },
          request.shipments[1]!,
        ],
        committedPrecedence: [{ shipmentId: "ship_pA", type: "DROP" }],
        firstSolutionVisits: [
          { shipmentId: "ship_pNew", type: "PICKUP", startMin: 4 },
          { shipmentId: "ship_pA", type: "DROP", startMin: 20 },
          { shipmentId: "ship_pNew", type: "DROP", startMin: 25 },
        ],
      },
      NOW_MS,
    );

    const shipments = (payload.model as Record<string, unknown>).shipments as Record<
      string,
      unknown
    >[];
    expect(shipments[0]!.pickups).toBeUndefined();
    expect(shipments[0]!.deliveries).toHaveLength(1);
    expect("pickups" in shipments[1]!).toBe(true);

    const visits = (
      (payload.injectedFirstSolutionRoutes as Record<string, unknown>[])[0]!
        .visits as Record<string, unknown>[]
    );
    // Delivery of shipment 0 without a matching pickup is valid because that
    // shipment is delivery-only. Google rejects the same visits when pickups[]
    // is present ("shipment #0 has its delivery performed, but not its pickup").
    expect(visits).toEqual([
      { shipmentIndex: 1, isPickup: true, startTime: "2026-08-23T14:27:45Z" },
      { shipmentIndex: 0, isPickup: false, startTime: "2026-08-23T14:43:45Z" },
      { shipmentIndex: 1, isPickup: false, startTime: "2026-08-23T14:48:45Z" },
    ]);
  });
});

describe("legacy append-only locked spine", () => {
  const lockedRequest: ProxyRequest = {
    ...request,
    committedPrecedence: [],
    lockedVisits: [
      { shipmentId: "ship_pA", type: "PICKUP" },
      { shipmentId: "ship_pA", type: "DROP" },
    ],
  };

  it("resolves locked visits to shipment indices in order", () => {
    const payload = toShipmentModel(lockedRequest, NOW_MS);
    const constraint = payload.injectedSolutionConstraint as Record<string, unknown>;
    const routes = constraint.routes as Record<string, unknown>[];
    const route = routes[0]!;

    expect(route.vehicleStartTime).toBe("2026-08-23T14:23:45Z");
    expect(route.vehicleEndTime).toBe("2026-08-23T16:23:45Z");
    expect(route.visits).toEqual([
      { shipmentIndex: 0, isPickup: true, startTime: "2026-08-23T14:23:45Z" },
      { shipmentIndex: 0, isPickup: false, startTime: "2026-08-23T14:24:45Z" },
    ]);
  });

  it("emits dual relaxations: free times from start, append-only after the spine", () => {
    const payload = toShipmentModel(lockedRequest, NOW_MS);
    const constraint = payload.injectedSolutionConstraint as Record<string, unknown>;
    const groups = constraint.constraintRelaxations as Record<string, unknown>[];
    const relaxations = groups[0]!.relaxations as Record<string, unknown>[];

    expect(relaxations).toEqual([
      { level: "RELAX_VISIT_TIMES_AFTER_THRESHOLD", thresholdVisitCount: 0 },
      { level: "RELAX_ALL_AFTER_THRESHOLD", thresholdVisitCount: 3 },
    ]);
  });

  it("uses startMin when provided and keeps times non-decreasing", () => {
    const payload = toShipmentModel(
      {
        ...lockedRequest,
        lockedVisits: [
          { shipmentId: "ship_pA", type: "PICKUP", startMin: 4 },
          { shipmentId: "ship_pA", type: "DROP", startMin: 2 },
        ],
      },
      NOW_MS,
    );
    const constraint = payload.injectedSolutionConstraint as Record<string, unknown>;
    const routes = constraint.routes as Record<string, unknown>[];
    const visits = routes[0]!.visits as { startTime: string }[];

    // Second visit's startMin=2 is clamped up to 4 so the chain stays valid.
    expect(visits[0]!.startTime).toBe("2026-08-23T14:27:45Z");
    expect(visits[1]!.startTime).toBe("2026-08-23T14:27:45Z");
  });

  it("rejects a locked visit naming a shipment that is not in the model", () => {
    expect(() =>
      toShipmentModel(
        { ...lockedRequest, lockedVisits: [{ shipmentId: "ship_ghost", type: "PICKUP" }] },
        NOW_MS,
      ),
    ).toThrow(/ship_ghost/);
  });
});
