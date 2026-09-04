import { create } from "zustand";

import type { MatchingRun } from "@/matching/types";

const MAX_RETAINED_RUNS = 20;

/**
 * A rolling history of run snapshots.
 *
 * Each entry carries a deep-frozen copy of the scenario, request and settings
 * that produced it, so "it rejected D014 last time" is a checkable claim
 * rather than a memory.
 */
interface RunsState {
  runs: MatchingRun[];
  record(run: MatchingRun): void;
  remove(runId: string): void;
  clear(): void;
}

export const useRunsStore = create<RunsState>((set) => ({
  runs: [],

  record: (run) => set((state) => ({ runs: [run, ...state.runs].slice(0, MAX_RETAINED_RUNS) })),

  remove: (runId) => set((state) => ({ runs: state.runs.filter((run) => run.id !== runId) })),

  clear: () => set({ runs: [] }),
}));
