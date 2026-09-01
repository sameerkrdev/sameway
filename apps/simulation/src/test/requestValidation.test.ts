import { describe, expect, it } from "vitest";

import { requestValidationStage } from "@/matching/stages/requestValidation";

import { makeContext } from "./fixtures/stageContext";

describe("requestValidation", () => {
  it("rejects a request whose passenger is already on an active ride", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayPercent: 30 }],
      // Same passenger as the committed ride — sketch UI used to allow this.
      request: { passengerId: "pA" },
    });

    const outcome = await requestValidationStage.execute(context);

    expect(outcome.requestRejection?.code).toBe("REQUEST_PASSENGER_ALREADY_ON_RIDE");
  });

  it("accepts a request for a passenger who is not on any ride", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayPercent: 30 }],
      request: { passengerId: "pNew" },
    });

    const outcome = await requestValidationStage.execute(context);

    expect(outcome.requestRejection).toBeUndefined();
  });
});
