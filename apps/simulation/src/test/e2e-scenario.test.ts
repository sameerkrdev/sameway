import { beforeAll, describe, expect, it } from "vitest";

import type { MatchingResult } from "@/matching/types";

import { buildDelhiScenario, delhiRequest } from "./fixtures/delhiScenario";
import { evaluationFor, failureCodes, runFixture, stageStatus } from "./fixtures/runEngine";

/**
 * One scenario that walks the pipeline end to end.
 *
 * All fourteen stages are implemented. The assertions below pin what each
 * filter decides and what the funnel looks like end to end; Tasks 22-24 build
 * the UI, the presets and the documentation on top of it.
 */
describe("Delhi NCR morning pool", () => {
  let result: MatchingResult;

  beforeAll(async () => {
    const scenario = buildDelhiScenario();
    result = await runFixture(scenario, delhiRequest(scenario));
  });

  it("ranks every driver that clears eligibility, corridor and direction", () => {
    // D002, D003 and D004 fail stage 0. D008 clears stage 0 but is idle 10 km
    // out, so its single-point corridor never reaches the pickup. D005 is idle
    // 2.5 km out: near enough for the ring search, too far once stage 3
    // measures it. D006 is on the westbound ride and the request heads east.
    // D007 is the textbook pool: pickup on an eastbound committed route. D001
    // wins on score; D007 is the runner-up.
    expect(result.ranked.map((entry) => entry.driverId)).toEqual(["D001", "D007"]);
    const winner = evaluationFor(result, "D001");
    expect(winner.finalStatus).toBe("PASSED");
    expect(winner.rank).toBe(1);
    expect(winner.stageResults.every((stage) => stage.status === "PASSED")).toBe(true);
    expect(evaluationFor(result, "D007").finalStatus).toBe("PASSED");
    expect(evaluationFor(result, "D007").rank).toBe(2);
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

  it("marks a driver NOT_EVALUATED after the stage that failed it, never FAILED twice", () => {
    // Each driver has exactly one attributable failure point. D004 dies at
    // stage 0, so every later stage must record it as not evaluated rather
    // than re-rejecting it — otherwise the rejection dashboard would count one
    // driver against a dozen reason codes.
    const failedAt = "basicEligibility";
    let seenFailure = false;

    for (const stage of result.stageResults) {
      const status = stageStatus(result, "D004", stage.stageId);

      if (stage.stageId === failedAt) {
        expect(status).toBe("FAILED");
        seenFailure = true;
        continue;
      }

      expect(status).toBe(seenFailure ? "NOT_EVALUATED" : "PASSED");
    }

    expect(seenFailure).toBe(true);
    expect(failureCodes(result, "D004")).toHaveLength(1);

    // And the winner passes every one of the fourteen.
    for (const stage of result.stageResults) {
      expect(stageStatus(result, "D001", stage.stageId)).toBe("PASSED");
    }
  });

  it("reports a funnel that narrows at each implemented filter", () => {
    const counts = result.stageResults.map((stage) => ({
      id: stage.stageId,
      out: stage.outputCount,
    }));
    expect(counts).toEqual([
      { id: "requestValidation", out: 8 },
      { id: "basicEligibility", out: 5 },
      { id: "operationalState", out: 5 },
      { id: "h3RouteCorridor", out: 4 },
      { id: "pickupRouteDistance", out: 3 },
      { id: "directionCompatibility", out: 2 },
      { id: "stopSequenceGeneration", out: 2 },
      { id: "pickupTimeWindow", out: 2 },
      { id: "detourLowerBound", out: 2 },
      { id: "roadRouting", out: 2 },
      { id: "incrementalCost", out: 2 },
      { id: "hardConstraints", out: 2 },
      { id: "scoring", out: 2 },
      { id: "commit", out: 2 },
    ]);
    // Candidates now come from the corridor stage rather than H3 ring growth.
    expect(result.summary.candidates).toBe(4);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.rejected).toBe(6);
  });

  it("passes D007 for textbook pooling on an eastbound committed route", () => {
    // D007's rider is going 14 km east and the new rider's pickup is at the
    // start of that run. Without a locked spine the solver interleaves the new
    // pickup on the way and the detour stays within limits.
    expect(failureCodes(result, "D007")).toEqual([]);

    const evaluation = evaluationFor(result, "D007");
    expect(evaluation.finalStatus).toBe("PASSED");
    expect(evaluation.metrics.detourPercent).toBeLessThan(15);
  });

  it("rejects a ride heading the other way", () => {
    // D006 runs the westbound ride; the request is Connaught Place to Noida.
    // The pickup is near its corridor — the destination is what disqualifies it.
    expect(failureCodes(result, "D006")).toEqual(["BEARING_INCOMPATIBLE"]);
    expect(evaluationFor(result, "D006").failedAtStageId).toBe("directionCompatibility");
  });

  it("rejects a driver whose corridor never reaches the pickup", () => {
    // The load-bearing property of stage 2: matching is against the ride's
    // remaining route, not the driver's raw proximity.
    expect(failureCodes(result, "D008")).toEqual(["CORRIDOR_NO_MATCH"]);
    expect(evaluationFor(result, "D008").failedAtStageId).toBe("h3RouteCorridor");
  });

  it("rejects a driver the corridor reached but the geometry does not", () => {
    // Stage 2's cells are coarse and padded; stage 3 is the exact measurement
    // that overrules them.
    expect(failureCodes(result, "D005")).toEqual(["PICKUP_TOO_FAR_FROM_ROUTE"]);
    const evaluation = evaluationFor(result, "D005");
    expect(evaluation.failedAtStageId).toBe("pickupRouteDistance");
    expect(evaluation.metrics.pickupToRouteKm).toBeGreaterThan(1.5);
  });

  it("aggregates rejections by reason code for the dashboard", () => {
    const codes = Object.fromEntries(
      result.summary.rejectionsByCode.map((group) => [group.code, group.count]),
    );
    expect(codes).toEqual({
      DRIVER_OFFLINE: 1,
      VEHICLE_TYPE_MISMATCH: 1,
      INSUFFICIENT_CAPACITY: 1,
      CORRIDOR_NO_MATCH: 1,
      PICKUP_TOO_FAR_FROM_ROUTE: 1,
      BEARING_INCOMPATIBLE: 1,
    });
  });

  it("spends the routing API on baselines only, and the solver on sequencing", () => {
    // The division of labour stage 8 rests on. Routing answers "what does this
    // already-decided route cost", which is a measurement with no optimisation
    // in it and must not be billed at solver prices. OptimizeTours answers
    // "where does the new rider go", once per surviving driver.
    expect(result.telemetry.engine).toBe("MOCK");
    expect(result.telemetry.matrixCalls).toBe(0);

    // One shared solo route for the new rider, plus one baseline per surviving
    // driver with a committed route, plus one solved-route polyline per driver
    // that clears stage 8 (for map display).
    expect(result.telemetry.routeCalls).toBe(4);

    expect(result.optimizerTelemetry.calls).toBe(2);
    expect(result.optimizerTelemetry.unavailableReason).toBeNull();
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
