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
  h3CandidateGeneration: {
    id: "h3CandidateGeneration",
    name: "H3 Candidate Generation",
    shortLabel: "H3",
    description:
      "Expands H3 rings around the pickup cell until enough usable candidates are found.",
    usesRouting: false,
  },
  driverStatusFilter: {
    id: "driverStatusFilter",
    name: "Driver Status",
    shortLabel: "Status",
    description: "Keeps only ONLINE drivers.",
    usesRouting: false,
  },
  vehicleFilter: {
    id: "vehicleFilter",
    name: "Vehicle Compatibility",
    shortLabel: "Vehicle",
    description: "Matches vehicle capability against the request's preferences.",
    usesRouting: false,
  },
  capacityPreFilter: {
    id: "capacityPreFilter",
    name: "Capacity Pre-filter",
    shortLabel: "Capacity",
    description:
      "Cheap conservative seat check. Not authoritative — segment occupancy decides later.",
    usesRouting: false,
  },
  pickupEtaFilter: {
    id: "pickupEtaFilter",
    name: "Pickup ETA",
    shortLabel: "ETA",
    description: "One route-matrix call gives road distance and ETA for every surviving driver.",
    usesRouting: true,
  },
  routeFeasibility: {
    id: "routeFeasibility",
    name: "Route Feasibility",
    shortLabel: "Route",
    description:
      "Authoritative insertion test: ordering, segment occupancy, detour and passenger delay.",
    usesRouting: true,
  },
  poolingRules: {
    id: "poolingRules",
    name: "Pooling Rules",
    shortLabel: "Pooling",
    description: "Business policy only — whether an otherwise feasible pool is permitted.",
    usesRouting: false,
  },
  scoring: {
    id: "scoring",
    name: "Scoring",
    shortLabel: "Score",
    description: "Normalises each metric to 0-100 and applies the configured weights.",
    usesRouting: false,
  },
};

export type StageRegistry = Record<StageId, MatchingStage>;

/**
 * Resolves an ordered stage list from a registry.
 *
 * Order is data rather than code so the brief's original sequence (route
 * feasibility before ETA) stays selectable for cost comparisons.
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
