import { describe, expect, it } from "vitest";

import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";

import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

const twoStopRide: MakeContextInput = {
  driverId: "d1",
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayPercent: 8 }],
};

describe("stopSequenceGeneration", () => {
  it("enumerates exactly (n+1)(n+2)/2 candidates for n committed stops", async () => {
    const context = makeContext(twoStopRide);

    await stopSequenceGenerationStage.execute(context);

    // n = 2 → 3 × 4 / 2 = 6
    expect(context.getMetrics("d1").enumeratedSequences).toBe(6);
  });

  it("publishes the surviving sequences for later stages", async () => {
    const context = makeContext(twoStopRide);

    await stopSequenceGenerationStage.execute(context);

    expect(context.getSequences("d1").length).toBeGreaterThan(0);
    for (const candidate of context.getSequences("d1")) {
      const ids = candidate.stops.map((stop) => stop.id);
      expect(ids.indexOf("req_1:pickup")).toBeLessThan(ids.indexOf("req_1:drop"));
    }
  });

  it("never reorders the committed stops relative to each other", async () => {
    const context = makeContext(twoStopRide);

    await stopSequenceGenerationStage.execute(context);

    for (const candidate of context.getSequences("d1")) {
      const committed = candidate.stops.filter((stop) => !stop.isNew).map((stop) => stop.id);
      expect(committed).toEqual(["s1", "s2"]);
    }
  });

  it("prunes sequences that exceed capacity at any segment", async () => {
    const context = makeContext({
      ...twoStopRide,
      vehicle: { totalSeats: 1 },
      passengers: [
        { id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayPercent: 8, seatsRequired: 1 },
      ],
    });

    await stopSequenceGenerationStage.execute(context);
    const metrics = context.getMetrics("d1");

    // Only the ordering where the new rider is fully served before pA boards,
    // or fully after pA alights, keeps a one-seat vehicle legal.
    expect(metrics.capacityFeasibleSequences).toBeLessThan(metrics.enumeratedSequences ?? 0);
  });

  it("places a rider after the drop that frees the seats, on a full vehicle", async () => {
    // A vehicle that is full *right now* is not a vehicle with no room. Once
    // pA alights, the seats are free. Finding that placement is the whole
    // point of walking occupancy per segment rather than comparing head counts.
    const context = makeContext({
      driverId: "d1",
      committedStops: [{ id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 }],
      passengers: [
        { id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 8, seatsRequired: 4 },
      ],
      vehicle: { totalSeats: 4 },
    });

    const outcome = await stopSequenceGenerationStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");

    const surviving = context.getSequences("d1");
    expect(surviving).toHaveLength(1);
    expect(surviving[0]!.stops.map((stop) => stop.id)).toEqual([
      "s2",
      "req_1:pickup",
      "req_1:drop",
    ]);
  });

  it("fails a driver with no capacity-feasible ordering", async () => {
    // Genuinely impossible: the rider needs more seats than the vehicle has,
    // so no position in any ordering can accommodate them.
    const context = makeContext({
      driverId: "d1",
      committedStops: [{ id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 }],
      passengers: [
        { id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayPercent: 8, seatsRequired: 4 },
      ],
      vehicle: { totalSeats: 4 },
      request: { seatsRequired: 5 },
    });

    const outcome = await stopSequenceGenerationStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("SEGMENT_CAPACITY_EXCEEDED");
  });

  it("rejects a route that would exceed the provider's waypoint limit", async () => {
    const manyStops = Array.from({ length: 26 }, (_, index) => ({
      id: `s${String(index)}`,
      passengerId: `p${String(index)}`,
      type: index % 2 === 0 ? ("PICKUP" as const) : ("DROP" as const),
      originalEtaMin: index,
    }));

    const context = makeContext({
      driverId: "d1",
      committedStops: manyStops,
      passengers: manyStops.map((stop) => ({
        id: stop.passengerId,
        state: "WAITING" as const,
        maxPickupDelayMin: 5,
        maxDropDelayPercent: 8,
      })),
      vehicle: { totalSeats: 40 },
    });

    const outcome = await stopSequenceGenerationStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("WAYPOINT_LIMIT_EXCEEDED");
  });
});
