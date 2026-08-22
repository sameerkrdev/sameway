import { runMatching } from "@/matching/engine";
import { resolveStages } from "@/matching/pipeline";
import { STAGE_REGISTRY } from "@/matching/stages";
import type { MatchingRun } from "@/matching/types";
import { createRoutingStack, RoutingCache } from "@/routing";

import type { FindMatchesInput, MatchingService } from "./MatchingService";

let runCounter = 0;

/**
 * Runs the pipeline in the browser and captures the result as a reproducible
 * snapshot.
 */
export class LocalMatchingService implements MatchingService {
  /**
   * Persisted across runs so a driver's unchanged baseline route is not
   * re-billed every time Run Matching is clicked.
   */
  private readonly cache = new RoutingCache({ coordinatePrecision: null });

  async findMatches(input: FindMatchesInput): Promise<MatchingRun> {
    const { scenario, request, settings } = input;
    const startedAt = Date.now();

    const stack = createRoutingStack({
      settings,
      cache: this.cache,
      ...(input.createGoogleEngine ? { createGoogleEngine: input.createGoogleEngine } : {}),
    });

    const result = await runMatching({
      scenario,
      request,
      settings,
      routing: stack.engine,
      stages: resolveStages(STAGE_REGISTRY, settings.stageOrder),
      telemetry: () => stack.telemetry.snapshot(),
    });

    const telemetry = stack.telemetry.snapshot();
    runCounter += 1;

    return {
      id: `run_${String(runCounter).padStart(4, "0")}`,
      createdAt: new Date(startedAt).toISOString(),
      // Deep clones, so editing the scenario afterwards cannot retroactively
      // change what a stored run says happened.
      scenarioSnapshot: deepFreeze(structuredClone(scenario)),
      requestSnapshot: deepFreeze(structuredClone(request)),
      settingsSnapshot: deepFreeze(structuredClone(settings)),
      result,
      routingEngine: telemetry.engine,
      fallbackReason: telemetry.fallbackReason,
      durationMs: result.durationMs,
    };
  }

  /** Drops cached routes, e.g. after switching routing engines. */
  clearCache(): void {
    this.cache.clear();
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }

  return Object.freeze(value);
}

export const localMatchingService = new LocalMatchingService();
