import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { directionCompatibilityStage } from "@/matching/stages/directionCompatibility";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { incrementalCostStage } from "@/matching/stages/incrementalCost";
import { operationalStateStage } from "@/matching/stages/operationalState";
import { pickupRouteDistanceStage } from "@/matching/stages/pickupRouteDistance";
import { pickupTimeWindowStage } from "@/matching/stages/pickupTimeWindow";
import { roadRoutingStage } from "@/matching/stages/roadRouting";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";

import { makeContext, type MakeContextInput } from "./stageContext";
import { StubOptimizerEngine } from "./stubOptimizer";

/**
 * Runs stages 1 through 9 against a fixture context and hands back the
 * context, so a test for stage 10 or later can assert on real data rather than
 * hand-built metrics.
 *
 * Verdicts are deliberately ignored: this drives the stages directly rather
 * than through the engine, so a driver stays live even if an intermediate
 * stage would have rejected them. That is what lets a stage-10 test set up an
 * input that stage 6 would also have complained about, and still assert on
 * stage 10's own reason code.
 */
export async function runToIncrementalCost(input: MakeContextInput) {
  const context = makeContext({ optimizer: new StubOptimizerEngine(), ...input });

  for (const stage of [
    h3RouteCorridorStage,
    operationalStateStage,
    pickupRouteDistanceStage,
    directionCompatibilityStage,
    stopSequenceGenerationStage,
    pickupTimeWindowStage,
    detourLowerBoundStage,
    roadRoutingStage,
    incrementalCostStage,
  ]) {
    await stage.execute(context);
  }

  return context;
}
