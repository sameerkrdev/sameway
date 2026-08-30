import { describe, expect, it } from "vitest";

import { resolveStages } from "@/matching/pipeline";
import { STAGE_REGISTRY } from "@/matching/stages";

import { buildDelhiScenario, delhiRequest } from "./fixtures/delhiScenario";
import { evaluationFor, runFixture, stageStatus } from "./fixtures/runEngine";

describe("pipeline runner", () => {
  it("marks stages after a failure NOT_EVALUATED rather than failing them again", async () => {
    const scenario = buildDelhiScenario();
    const result = await runFixture(scenario, delhiRequest(scenario));

    // D004's vehicle is full — corridor discovers it first, then eligibility rejects.
    const evaluation = evaluationFor(result, "D004");
    expect(evaluation.failedAtStageId).toBe("basicEligibility");
    expect(stageStatus(result, "D004", "h3RouteCorridor")).toBe("PASSED");
    expect(stageStatus(result, "D004", "basicEligibility")).toBe("FAILED");

    for (const stageId of [
      "operationalState",
      "pickupRouteDistance",
      "directionCompatibility",
      "stopSequenceGeneration",
      "pickupTimeWindow",
      "detourLowerBound",
      "roadRouting",
      "incrementalCost",
      "hardConstraints",
      "scoring",
      "commit",
    ]) {
      expect(stageStatus(result, "D004", stageId)).toBe("NOT_EVALUATED");
    }

    // The single capacity reason is the whole story; downstream stages must not
    // have piled on additional rejections.
    expect(evaluation.reasons.map((reason) => reason.code)).toEqual(["INSUFFICIENT_CAPACITY"]);
  });

  it("records one stage result per stage for every driver", async () => {
    const scenario = buildDelhiScenario();
    const result = await runFixture(scenario, delhiRequest(scenario));

    for (const evaluation of result.evaluations) {
      expect(evaluation.stageResults).toHaveLength(scenario.settings.stageOrder.length);
    }
  });

  it("does not mutate the scenario it was given", async () => {
    const scenario = buildDelhiScenario();
    const before = structuredClone(scenario);

    await runFixture(scenario, delhiRequest(scenario));

    expect(scenario).toEqual(before);
  });

  it("is reproducible across identical runs", async () => {
    const scenario = buildDelhiScenario();
    const first = await runFixture(scenario, delhiRequest(scenario));
    const second = await runFixture(scenario, delhiRequest(scenario));

    expect(second.ranked.map((entry) => entry.driverId)).toEqual(
      first.ranked.map((entry) => entry.driverId),
    );
    expect(second.summary.rejectionsByCode).toEqual(first.summary.rejectionsByCode);
  });

  it("aborts the whole run when the request itself is invalid", async () => {
    const scenario = buildDelhiScenario();
    const request = { ...delhiRequest(scenario), seatsRequired: 0 };

    const result = await runFixture(scenario, request);

    expect(result.requestRejection?.code).toBe("REQUEST_SEATS_INVALID");
    expect(result.ranked).toHaveLength(0);

    for (const evaluation of result.evaluations) {
      expect(evaluation.stageResults.every((stage) => stage.status === "NOT_EVALUATED")).toBe(true);
    }
  });

  it("rejects a stage order that repeats a stage", () => {
    expect(() => resolveStages(STAGE_REGISTRY, ["basicEligibility", "basicEligibility"])).toThrow(
      /more than once/,
    );
  });

  it("runs all fourteen stages in the default order", async () => {
    const scenario = buildDelhiScenario();
    const result = await runFixture(scenario, delhiRequest(scenario));

    expect(result.stageResults.map((stage) => stage.stageId)).toEqual([
      "requestValidation",
      "h3RouteCorridor",
      "basicEligibility",
      "operationalState",
      "pickupRouteDistance",
      "directionCompatibility",
      "stopSequenceGeneration",
      "pickupTimeWindow",
      "detourLowerBound",
      "roadRouting",
      "incrementalCost",
      "hardConstraints",
      "scoring",
      "commit",
    ]);
  });
});
