import { beforeAll, describe, expect, it } from "vitest";

import type { MatchingResult } from "@/matching/types";

import { buildDelhiScenario, delhiRequest } from "./fixtures/delhiScenario";
import { evaluationFor, failureCodes, runFixture, stageStatus } from "./fixtures/runEngine";

/**
 * One scenario that walks the pipeline end to end.
 *
 * Eleven of the thirteen stages are still no-op placeholders, so only stage 0
 * rejects anything today. The assertions below deliberately pin that: what
 * eligibility decides, and the fact that every later stage passes everyone
 * through. Tasks 10-21 add each stage's own rejections back, one task at a
 * time, and tighten this file as they go.
 */
describe("Delhi NCR morning pool", () => {
  let result: MatchingResult;

  beforeAll(async () => {
    const scenario = buildDelhiScenario();
    result = await runFixture(scenario, delhiRequest(scenario));
  });

  it("ranks every driver that clears basic eligibility", () => {
    // D002, D003 and D004 fail stage 0; the rest survive a pipeline whose
    // remaining filters are not implemented yet.
    expect(result.ranked.map((entry) => entry.driverId)).toEqual([
      "D001",
      "D005",
      "D006",
      "D007",
      "D008",
    ]);

    const winner = evaluationFor(result, "D001");
    expect(winner.finalStatus).toBe("PASSED");
    expect(winner.rank).toBe(1);
    expect(winner.stageResults.every((stage) => stage.status === "PASSED")).toBe(true);
  });

  it("rejects an offline driver at basic eligibility", () => {
    expect(failureCodes(result, "D002")).toEqual(["DRIVER_OFFLINE"]);
    expect(evaluationFor(result, "D002").failedAtStageId).toBe("basicEligibility");
  });

  it("rejects an incompatible vehicle type", () => {
    expect(failureCodes(result, "D003")).toEqual(["VEHICLE_TYPE_MISMATCH"]);
    expect(evaluationFor(result, "D003").failedAtStageId).toBe("basicEligibility");
  });

  it("rejects a vehicle with no free seats", () => {
    const evaluation = evaluationFor(result, "D004");
    expect(failureCodes(result, "D004")).toEqual(["INSUFFICIENT_CAPACITY"]);
    expect(evaluation.failedAtStageId).toBe("basicEligibility");
    expect(evaluation.metrics.availableSeats).toBe(0);
    expect(evaluation.metrics.totalSeats).toBe(4);
  });

  it("keeps the three merged eligibility codes distinct", () => {
    // The single stage absorbed three; it must not collapse their reason codes,
    // because "no supply", "wrong supply" and "full supply" are different
    // product problems.
    const codes = ["D002", "D003", "D004"].map((driverId) => failureCodes(result, driverId)[0]);
    expect(new Set(codes).size).toBe(3);
  });

  it("passes every eligible driver through the unimplemented stages", () => {
    // Placeholder stages must be transparent, not silently rejecting.
    for (const stageId of [
      "operationalState",
      "h3RouteCorridor",
      "pickupRouteDistance",
      "directionCompatibility",
      "stopSequenceGeneration",
      "pickupTimeWindow",
      "detourLowerBound",
      "roadRouting",
      "incrementalCost",
      "hardConstraints",
      "commit",
    ]) {
      expect(stageStatus(result, "D001", stageId)).toBe("PASSED");
      // A driver that already failed stays NOT_EVALUATED rather than failing again.
      expect(stageStatus(result, "D004", stageId)).toBe("NOT_EVALUATED");
    }
  });

  it("reports a funnel that narrows at the only implemented filter", () => {
    const counts = result.stageResults.map((stage) => ({
      id: stage.stageId,
      out: stage.outputCount,
    }));

    expect(counts).toEqual([
      { id: "requestValidation", out: 8 },
      { id: "basicEligibility", out: 5 },
      { id: "operationalState", out: 5 },
      { id: "h3RouteCorridor", out: 5 },
      { id: "pickupRouteDistance", out: 5 },
      { id: "directionCompatibility", out: 5 },
      { id: "stopSequenceGeneration", out: 5 },
      { id: "pickupTimeWindow", out: 5 },
      { id: "detourLowerBound", out: 5 },
      { id: "roadRouting", out: 5 },
      { id: "incrementalCost", out: 5 },
      { id: "hardConstraints", out: 5 },
      { id: "scoring", out: 5 },
      { id: "commit", out: 5 },
    ]);

    // Candidates now come from the corridor stage rather than H3 ring growth.
    expect(result.summary.candidates).toBe(5);
    expect(result.summary.passed).toBe(5);
    expect(result.summary.rejected).toBe(3);
  });

  it("aggregates rejections by reason code for the dashboard", () => {
    const codes = Object.fromEntries(
      result.summary.rejectionsByCode.map((group) => [group.code, group.count]),
    );

    expect(codes).toEqual({
      DRIVER_OFFLINE: 1,
      VEHICLE_TYPE_MISMATCH: 1,
      INSUFFICIENT_CAPACITY: 1,
    });
  });

  it("issues no routing calls while every routing stage is a placeholder", () => {
    expect(result.telemetry.engine).toBe("MOCK");
    expect(result.telemetry.matrixCalls).toBe(0);
    expect(result.telemetry.routeCalls).toBe(0);
  });

  it("explains every rejection with a value and a threshold where one applies", () => {
    for (const evaluation of result.evaluations) {
      if (evaluation.finalStatus !== "FAILED") {
        continue;
      }
      expect(evaluation.reasons.length).toBeGreaterThan(0);
      for (const reason of evaluation.reasons) {
        expect(reason.message.length).toBeGreaterThan(0);
        expect(reason.category).toBeTruthy();
        expect(reason.value).toBeDefined();
        expect(reason.threshold).toBeDefined();
      }
    }
  });
});
