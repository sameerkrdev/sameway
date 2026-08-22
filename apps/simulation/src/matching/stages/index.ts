import type { StageRegistry } from "../pipeline";

import { capacityPreFilterStage } from "./capacityPreFilter";
import { driverStatusFilterStage } from "./driverStatusFilter";
import { h3CandidateGenerationStage } from "./h3CandidateGeneration";
import { pickupEtaFilterStage } from "./pickupEtaFilter";
import { poolingRulesStage } from "./poolingRules";
import { requestValidationStage } from "./requestValidation";
import { routeFeasibilityStage } from "./routeFeasibility";
import { scoringStage } from "./scoring";
import { vehicleFilterStage } from "./vehicleFilter";

/**
 * Every stage the engine knows about. Which of them run, and in what order, is
 * decided by `MatchingSettings.stageOrder` rather than by this file.
 */
export const STAGE_REGISTRY: StageRegistry = {
  requestValidation: requestValidationStage,
  h3CandidateGeneration: h3CandidateGenerationStage,
  driverStatusFilter: driverStatusFilterStage,
  vehicleFilter: vehicleFilterStage,
  capacityPreFilter: capacityPreFilterStage,
  pickupEtaFilter: pickupEtaFilterStage,
  routeFeasibility: routeFeasibilityStage,
  poolingRules: poolingRulesStage,
  scoring: scoringStage,
};

export { capacityPreFilterStage } from "./capacityPreFilter";
export { driverStatusFilterStage } from "./driverStatusFilter";
export { h3CandidateGenerationStage } from "./h3CandidateGeneration";
export { pickupEtaFilterStage } from "./pickupEtaFilter";
export { poolingRulesStage } from "./poolingRules";
export { requestValidationStage } from "./requestValidation";
export { routeFeasibilityStage } from "./routeFeasibility";
export { scoringStage } from "./scoring";
export { vehicleFilterStage } from "./vehicleFilter";
