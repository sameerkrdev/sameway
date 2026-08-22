import { useCallback } from "react";

import { localMatchingService } from "@/services/LocalMatchingService";
import { createGoogleRoutesEngine } from "@/routing/googleEngineFactory";
import { useMatchingStore } from "@/stores/matchingStore";
import { useRunsStore } from "@/stores/runsStore";
import { useScenarioStore } from "@/stores/scenarioStore";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Bridges the stores to the matching service.
 *
 * Stores never import one another; this hook is where the scenario, the
 * settings and the result stores meet.
 */
export function useRunMatching(): { run: () => Promise<void>; isRunning: boolean } {
  const isRunning = useMatchingStore((state) => state.isRunning);

  const run = useCallback(async () => {
    const { scenario } = useScenarioStore.getState();
    const { settings } = useSettingsStore.getState();
    const request = scenario.requests[0];

    const matchingStore = useMatchingStore.getState();

    if (!request) {
      matchingStore.failRun("Add a ride request before running the matcher.");
      return;
    }

    matchingStore.startRun();

    try {
      const matchingRun = await localMatchingService.findMatches({
        scenario,
        request,
        settings,
        createGoogleEngine: createGoogleRoutesEngine,
      });

      useMatchingStore.getState().completeRun(matchingRun);
      useRunsStore.getState().record(matchingRun);
    } catch (error) {
      useMatchingStore
        .getState()
        .failRun(error instanceof Error ? error.message : "Matching failed unexpectedly");
    }
  }, []);

  return { run, isRunning };
}
