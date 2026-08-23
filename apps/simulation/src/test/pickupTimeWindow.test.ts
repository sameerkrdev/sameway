import { describe, expect, it } from "vitest";

import { operationalStateStage } from "@/matching/stages/operationalState";
import { pickupTimeWindowStage } from "@/matching/stages/pickupTimeWindow";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";

import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function run(input: MakeContextInput) {
  const context = makeContext(input);
  await operationalStateStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  const outcome = await pickupTimeWindowStage.execute(context);
  return { context, outcome };
}

// pA is waiting far along the route; the new rider's pickup sits before them.
const waitingRider: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4, lat: 28.6, lng: 77.24 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 20, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 20, maxDropDelayMin: 20 }],
  request: { pickup: { lat: 28.6, lng: 77.22 }, drop: { lat: 28.6, lng: 77.3 } },
};

describe("pickupTimeWindow", () => {
  it("keeps orderings that respect a generous budget", async () => {
    const { context, outcome } = await run(waitingRider);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(context.getSequences("d1").length).toBeGreaterThan(0);
  });

  it("drops orderings that breach a strict passenger's own budget", async () => {
    const generous = await run(waitingRider);
    const strict = await run({
      ...waitingRider,
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
    });

    expect(strict.context.getSequences("d1").length).toBeLessThan(
      generous.context.getSequences("d1").length,
    );
  });

  it("rejects the driver only when every ordering breaches a budget", async () => {
    const { outcome } = await run({
      ...waitingRider,
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
      request: {
        pickup: { lat: 28.7, lng: 77.22 },
        drop: { lat: 28.7, lng: 77.3 },
      },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(["COMMITTED_PICKUP_DELAY_TOO_HIGH", "COMMITTED_DROP_DELAY_TOO_HIGH"]).toContain(
      outcome.verdicts[0]!.reasons[0]!.code,
    );
  });

  it("passes an idle driver untouched", async () => {
    const { outcome } = await run({
      driverId: "d2",
      committedStops: [],
      passengers: [],
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("records how many orderings survived", async () => {
    const { context } = await run(waitingRider);

    expect(context.getMetrics("d1").timeWindowFeasibleSequences).toBe(
      context.getSequences("d1").length,
    );
  });
});
