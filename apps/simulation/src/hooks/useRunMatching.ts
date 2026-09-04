import { useCallback } from "react";

import { applyCurrentRideSketch } from "@/lib/applyRideSketch";
import { localMatchingService } from "@/services/LocalMatchingService";
import { createGoogleRoutesEngine } from "@/routing/googleEngineFactory";
import { useMatchingStore } from "@/stores/matchingStore";
import { useRunsStore } from "@/stores/runsStore";
import { useScenarioStore } from "@/stores/scenarioStore";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Bridges the stores to the matching service.
 *
 * If a Ride sketch session has unsaved drivers / rides / request, it is
 * applied into the scenario first so Run matching always sees the sketched
 * world — not a stale blank or preset scene.
 */
export function useRunMatching(): { run: () => Promise<void>; isRunning: boolean } {
  const isRunning = useMatchingStore((state) => state.isRunning);

  const run = useCallback(async () => {
    const matchingStore = useMatchingStore.getState();

    const applyResult = applyCurrentRideSketch({ discardAfter: true, exitSketchMode: true });
    if (applyResult.status === "error") {
      matchingStore.failRun(applyResult.error);
      return;
    }

    const { scenario } = useScenarioStore.getState();
    const { settings } = useSettingsStore.getState();
    const request = scenario.requests[0];

    if (!request) {
      matchingStore.failRun(
        applyResult.status === "applied"
          ? "Sketch applied, but there is no ride request. Set Req pick, Req drop, and a request passenger in Ride sketch, then run again."
          : "Add a ride request (Ride sketch → Req pick/drop) before running the matcher.",
      );
      return;
    }

    if (scenario.drivers.length === 0) {
      matchingStore.failRun(
        "No drivers in the scene. Create drivers in Ride sketch (place vehicle), then run again.",
      );
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
