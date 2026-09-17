import { create } from "zustand";

import type { StageId } from "@/domain/entities";
import type { DriverEvaluation, MatchingRun, StageResult } from "@/matching/types";

/**
 * Results of the most recent run.
 *
 * Stage replay reads from `stageResults` and never re-runs the engine —
 * scrubbing the funnel is a lookup, not a recomputation.
 */
interface MatchingState {
  currentRun: MatchingRun | null;
  isRunning: boolean;
  error: string | null;

  /** Which stage the funnel is scrubbed to; null means "final result". */
  replayStageIndex: number | null;
  selectedDriverId: string | null;
  inspectedStageId: StageId | null;

  startRun(): void;
  completeRun(run: MatchingRun): void;
  failRun(message: string): void;
  clear(): void;

  setReplayStageIndex(index: number | null): void;
  selectDriver(driverId: string | null): void;
  inspectStage(stageId: StageId | null): void;
}

export const useMatchingStore = create<MatchingState>((set) => ({
  currentRun: null,
  isRunning: false,
  error: null,
  replayStageIndex: null,
  selectedDriverId: null,
  inspectedStageId: null,

  startRun: () => set({ isRunning: true, error: null }),

  completeRun: (run) =>
    set({
      currentRun: run,
      isRunning: false,
      error: null,
      // A new run invalidates any scrub position from the previous one.
      replayStageIndex: null,
      selectedDriverId: run.result.ranked[0]?.driverId ?? null,
      inspectedStageId: null,
    }),

  failRun: (message) => set({ isRunning: false, error: message }),

  clear: () =>
    set({
      currentRun: null,
      isRunning: false,
      error: null,
      replayStageIndex: null,
      selectedDriverId: null,
      inspectedStageId: null,
    }),

  setReplayStageIndex: (index) => set({ replayStageIndex: index }),
  selectDriver: (driverId) => set({ selectedDriverId: driverId }),
  inspectStage: (stageId) => set({ inspectedStageId: stageId }),
}));

/**
 * Driver ids still alive at the scrubbed stage.
 *
 * Derived purely from stored results, which is what lets the map thin out as
 * the user steps through the funnel without paying for another run.
 */
export function driversSurvivingStage(
  stageResults: readonly StageResult[],
  stageIndex: number | null,
): Set<string> | null {
  if (stageIndex === null) {
    return null;
  }

  const stage = stageResults[stageIndex];
  if (!stage) {
    return null;
  }

  return new Set(
    stage.driverResults
      .filter((result) => result.status === "PASSED")
      .map((result) => result.driverId),
  );
}

export function evaluationById(
  evaluations: readonly DriverEvaluation[],
  driverId: string | null,
): DriverEvaluation | undefined {
  if (!driverId) {
    return undefined;
  }
  return evaluations.find((evaluation) => evaluation.driverId === driverId);
}
