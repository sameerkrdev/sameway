import type { StageRegistry } from "../pipeline";

import { basicEligibilityStage } from "./basicEligibility";
import { commitStage } from "./commit";
import { detourLowerBoundStage } from "./detourLowerBound";
import { directionCompatibilityStage } from "./directionCompatibility";
import { h3RouteCorridorStage } from "./h3RouteCorridor";
import { hardConstraintsStage } from "./hardConstraints";
import { incrementalCostStage } from "./incrementalCost";
import { operationalStateStage } from "./operationalState";
import { pickupRouteDistanceStage } from "./pickupRouteDistance";
import { pickupTimeWindowStage } from "./pickupTimeWindow";
import { requestValidationStage } from "./requestValidation";
import { roadRoutingStage } from "./roadRouting";
import { scoringStage } from "./scoring";
import { stopSequenceGenerationStage } from "./stopSequenceGeneration";

/**
 * Every stage the engine knows about, in `docs/Overview.md`'s numbering.
 * Which of them run, and in what order, is `MatchingSettings.stageOrder`.
 */
export const STAGE_REGISTRY: StageRegistry = {
  requestValidation: requestValidationStage,
  basicEligibility: basicEligibilityStage,
  operationalState: operationalStateStage,
  h3RouteCorridor: h3RouteCorridorStage,
  pickupRouteDistance: pickupRouteDistanceStage,
  directionCompatibility: directionCompatibilityStage,
  stopSequenceGeneration: stopSequenceGenerationStage,
  pickupTimeWindow: pickupTimeWindowStage,
  detourLowerBound: detourLowerBoundStage,
  roadRouting: roadRoutingStage,
  incrementalCost: incrementalCostStage,
  hardConstraints: hardConstraintsStage,
  scoring: scoringStage,
  commit: commitStage,
};

export { basicEligibilityStage } from "./basicEligibility";
export { commitStage } from "./commit";
export { detourLowerBoundStage } from "./detourLowerBound";
export { directionCompatibilityStage } from "./directionCompatibility";
export { h3RouteCorridorStage } from "./h3RouteCorridor";
export { hardConstraintsStage } from "./hardConstraints";
export { incrementalCostStage } from "./incrementalCost";
export { operationalStateStage } from "./operationalState";
export { pickupRouteDistanceStage } from "./pickupRouteDistance";
export { pickupTimeWindowStage } from "./pickupTimeWindow";
export { requestValidationStage } from "./requestValidation";
export { roadRoutingStage } from "./roadRouting";
export { scoringStage } from "./scoring";
export { stopSequenceGenerationStage } from "./stopSequenceGeneration";
