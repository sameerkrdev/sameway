import type { MatchingSettings, RideRequest, Scenario } from "@/domain/entities";
import type { MatchingRun } from "@/matching/types";
import type { OptimizerEngine } from "@/optimization/types";
import type { RoutingEngine } from "@/routing/types";

export interface FindMatchesInput {
  scenario: Scenario;
  request: RideRequest;
  settings: MatchingSettings;
  /**
   * Supplies a Google Routes adapter when the browser can build one. Absent or
   * returning null forces an explicit, visible fallback to mock routing.
   */
  createGoogleEngine?: () => RoutingEngine | null;
  /** Injected by tests. Production uses the proxy-backed engine. */
  createOptimizerEngine?: () => OptimizerEngine;
}

/**
 * The seam between the UI and the matching engine.
 *
 * Today `LocalMatchingService` runs the engine in-process. A future
 * `ApiMatchingService` can POST to `/matching/preview` and return the same
 * shape, with no component changes — which is the whole point of routing every
 * call through here rather than importing the engine from a React tree.
 */
export interface MatchingService {
  findMatches(input: FindMatchesInput): Promise<MatchingRun>;
}
