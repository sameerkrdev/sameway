import type { StageId } from "@/domain/entities";

import type { MatchingStage } from "./types";

export interface StageMetadata {
  id: StageId;
  /** Full name for headings. */
  name: string;
  /** Compact label for the funnel bar. */
  shortLabel: string;
  description: string;
  /** Whether this stage can issue routing calls. Drives the cost annotations. */
  usesRouting: boolean;
}

export const STAGE_METADATA: Record<StageId, StageMetadata> = {
  requestValidation: {
    id: "requestValidation",
    name: "Request Validation",
    shortLabel: "Request",
    description: "Checks the request itself before any driver is considered.",
    usesRouting: false,
  },
  basicEligibility: {
    id: "basicEligibility",
    name: "Basic Eligibility",
    shortLabel: "Eligible",
    description: "Status, vehicle capability and a conservative seat check. Free.",
    usesRouting: false,
  },
  operationalState: {
    id: "operationalState",
    name: "Operational State",
    shortLabel: "State",
    description: "Computes each committed passenger's remaining delay budget.",
    usesRouting: false,
  },
  h3RouteCorridor: {
    id: "h3RouteCorridor",
    name: "H3 Route Corridor",
    shortLabel: "Corridor",
    description: "Matches the pickup against each ride's remaining-route corridor.",
    usesRouting: false,
  },
  pickupRouteDistance: {
    id: "pickupRouteDistance",
    name: "Pickup → Route Distance",
    shortLabel: "Proximity",
    description: "Point-to-polyline distance from the pickup to the remaining route.",
    usesRouting: false,
  },
  directionCompatibility: {
    id: "directionCompatibility",
    name: "Direction Compatibility",
    shortLabel: "Direction",
    description: "Bearing, destination proximity and destination progress along the route.",
    usesRouting: false,
  },
  stopSequenceGeneration: {
    id: "stopSequenceGeneration",
    name: "Stop Sequence Generation",
    shortLabel: "Sequences",
    description: "Enumerates legal insertion positions under precedence and capacity.",
    usesRouting: false,
  },
  pickupTimeWindow: {
    id: "pickupTimeWindow",
    name: "Pickup Time Window",
    shortLabel: "Windows",
    description: "Drops orderings that breach a committed passenger's own delay budget.",
    usesRouting: false,
  },
  detourLowerBound: {
    id: "detourLowerBound",
    name: "Detour Lower Bound",
    shortLabel: "Bound",
    description: "Prunes sequences whose straight-line lower bound already fails.",
    usesRouting: false,
  },
  roadRouting: {
    id: "roadRouting",
    name: "Road Routing",
    shortLabel: "Solve",
    description: "Google OptimizeTours returns the winning sequence and its leg data.",
    usesRouting: true,
  },
  incrementalCost: {
    id: "incrementalCost",
    name: "Incremental Cost",
    shortLabel: "Impact",
    description: "Measures what every party gains or loses. Rejects nothing.",
    usesRouting: false,
  },
  hardConstraints: {
    id: "hardConstraints",
    name: "Hard Constraints",
    shortLabel: "Limits",
    description: "Binary accept/reject against every configured maximum, plus pooling policy.",
    usesRouting: false,
  },
  scoring: {
    id: "scoring",
    name: "Scoring",
    shortLabel: "Score",
    description: "Fairness-weighted ranking across drivers. Lower is better.",
    usesRouting: false,
  },
  commit: {
    id: "commit",
    name: "Commit",
    shortLabel: "Commit",
    description: "Builds the commit plan that makes the winning route the new baseline.",
    usesRouting: false,
  },
};

export type StageRegistry = Record<StageId, MatchingStage>;

/**
 * Resolves an ordered stage list from a registry.
 *
 * Order is still data rather than code, but the thirteen stages have strict
 * data dependencies, so `DEFAULT_STAGE_ORDER` is the only sequence that runs
 * end to end. Anything else is a diagnostic sub-pipeline.
 */
export function resolveStages(registry: StageRegistry, order: readonly StageId[]): MatchingStage[] {
  const seen = new Set<StageId>();
  const stages: MatchingStage[] = [];

  for (const stageId of order) {
    if (seen.has(stageId)) {
      throw new Error(`Stage "${stageId}" appears more than once in stageOrder`);
    }
    seen.add(stageId);
    stages.push(registry[stageId]);
  }

  return stages;
}
