import { beforeAll, describe, expect, it } from "vitest";

import type { MatchingResult } from "@/matching/types";

import { buildDelhiScenario, delhiRequest } from "./fixtures/delhiScenario";
import { evaluationFor, failureCodes, runFixture, stageStatus } from "./fixtures/runEngine";

/**
 * One scenario that walks every branch of the pipeline. If a refactor quietly
 * changes what a stage decides, one of these assertions moves.
 */
describe("Delhi NCR morning pool", () => {
  let result: MatchingResult;

  beforeAll(async () => {
    const scenario = buildDelhiScenario();
    result = await runFixture(scenario, delhiRequest(scenario));
  });

  it("matches the one driver that satisfies every filter", () => {
    expect(result.ranked.map((entry) => entry.driverId)).toEqual(["D001"]);
    expect(result.summary.bestDriverId).toBe("D001");

    const winner = evaluationFor(result, "D001");
    expect(winner.finalStatus).toBe("PASSED");
    expect(winner.rank).toBe(1);
    expect(winner.finalScore).toBeGreaterThan(0);
    expect(winner.stageResults.every((stage) => stage.status === "PASSED")).toBe(true);
  });

  it("rejects an offline driver at the status stage", () => {
    expect(failureCodes(result, "D002")).toEqual(["DRIVER_OFFLINE"]);
    expect(evaluationFor(result, "D002").failedAtStageId).toBe("driverStatusFilter");
  });

  it("rejects an incompatible vehicle type", () => {
    expect(failureCodes(result, "D003")).toEqual(["VEHICLE_TYPE_MISMATCH"]);
    expect(evaluationFor(result, "D003").failedAtStageId).toBe("vehicleFilter");
  });

  it("rejects a vehicle with no free seats", () => {
    const evaluation = evaluationFor(result, "D004");
    expect(failureCodes(result, "D004")).toEqual(["INSUFFICIENT_CAPACITY"]);
    expect(evaluation.metrics.availableSeats).toBe(0);
    expect(evaluation.metrics.totalSeats).toBe(4);
  });

  it("rejects a driver who cannot reach the pickup in time", () => {
    const evaluation = evaluationFor(result, "D005");
    expect(failureCodes(result, "D005")).toEqual(["PICKUP_ETA_TOO_HIGH"]);

    const [rejection] = evaluation.reasons;
    expect(Number(rejection?.value)).toBeGreaterThan(6);
    expect(rejection?.threshold).toBe(6);
  });

  it("rejects an insertion that detours too far", () => {
    const evaluation = evaluationFor(result, "D006");
    expect(failureCodes(result, "D006")).toEqual(["ROUTE_DETOUR_TOO_HIGH"]);

    const [rejection] = evaluation.reasons;
    expect(Number(rejection?.value)).toBeGreaterThan(15);
    expect(rejection?.threshold).toBe(15);

    // The attempt is still recorded so the map can draw what was tried.
    expect(evaluation.insertion?.bestAttempt).toBeDefined();
    expect(evaluation.insertion?.feasible).toBe(false);
  });

  it("separates a policy rejection from a feasibility rejection", () => {
    // D007's route works fine; the existing rider simply refuses to share.
    expect(stageStatus(result, "D007", "routeFeasibility")).toBe("PASSED");
    expect(failureCodes(result, "D007")).toEqual(["POOLING_NOT_ALLOWED_BY_EXISTING_RIDER"]);
    expect(evaluationFor(result, "D007").failedAtStageId).toBe("poolingRules");
  });

  it("rejects a driver outside the H3 search area", () => {
    expect(failureCodes(result, "D008")).toEqual(["H3_OUTSIDE_SEARCH"]);
    expect(evaluationFor(result, "D008").failedAtStageId).toBe("h3CandidateGeneration");
  });

  it("keeps H3 hop counts separate from real distances", () => {
    const winner = evaluationFor(result, "D001");

    expect(Number.isInteger(winner.metrics.h3GridDistance)).toBe(true);
    expect(winner.metrics.discoveredRing).toBe(winner.metrics.h3GridDistance);

    // Road distance exceeds straight-line distance, and neither equals the hop count.
    expect(winner.metrics.roadDistanceKm).toBeGreaterThan(winner.metrics.straightLineKm ?? 0);
    expect(winner.metrics.roadEtaMin).toBeGreaterThan(0);
  });

  it("reports a funnel that narrows stage by stage", () => {
    const counts = result.stageResults.map((stage) => ({
      id: stage.stageId,
      out: stage.outputCount,
    }));

    expect(counts).toEqual([
      { id: "requestValidation", out: 8 },
      { id: "h3CandidateGeneration", out: 7 },
      { id: "driverStatusFilter", out: 6 },
      { id: "vehicleFilter", out: 5 },
      { id: "capacityPreFilter", out: 4 },
      { id: "pickupEtaFilter", out: 3 },
      { id: "routeFeasibility", out: 2 },
      { id: "poolingRules", out: 1 },
      { id: "scoring", out: 1 },
    ]);

    expect(result.summary.candidates).toBe(7);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.rejected).toBe(7);
  });

  it("aggregates rejections by reason code for the dashboard", () => {
    const codes = Object.fromEntries(
      result.summary.rejectionsByCode.map((group) => [group.code, group.count]),
    );

    expect(codes).toEqual({
      DRIVER_OFFLINE: 1,
      VEHICLE_TYPE_MISMATCH: 1,
      INSUFFICIENT_CAPACITY: 1,
      PICKUP_ETA_TOO_HIGH: 1,
      ROUTE_DETOUR_TOO_HIGH: 1,
      POOLING_NOT_ALLOWED_BY_EXISTING_RIDER: 1,
      H3_OUTSIDE_SEARCH: 1,
    });
  });

  it("spends one matrix call rather than one call per candidate", () => {
    expect(result.telemetry.matrixCalls).toBe(1);
    expect(result.telemetry.engine).toBe("MOCK");
    // Four drivers survive to the ETA stage in one matrix call.
    expect(result.telemetry.matrixElements).toBe(4);
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
      }
    }
  });
});
