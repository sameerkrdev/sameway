import { create } from "zustand";

import type { MatchingSettings, ScoringWeights, StageId } from "@/domain/entities";
import { BRIEF_STAGE_ORDER, DEFAULT_SETTINGS, DEFAULT_STAGE_ORDER } from "@/domain/settings";

/**
 * Every tunable in one place. Nothing here is hard-coded in the engine, and
 * every value is captured in the run snapshot so a result can always be traced
 * back to the configuration that produced it.
 */
interface SettingsState {
  settings: MatchingSettings;

  set<K extends keyof MatchingSettings>(key: K, value: MatchingSettings[K]): void;
  setWeight(key: keyof ScoringWeights, value: number): void;
  setStageOrder(order: StageId[]): void;
  useDefaultOrder(): void;
  useBriefOrder(): void;
  replaceAll(settings: MatchingSettings): void;
  reset(): void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights } },

  set: (key, value) => set((state) => ({ settings: { ...state.settings, [key]: value } })),

  setWeight: (key, value) =>
    set((state) => ({
      settings: { ...state.settings, weights: { ...state.settings.weights, [key]: value } },
    })),

  setStageOrder: (order) => set((state) => ({ settings: { ...state.settings, stageOrder: order } })),

  useDefaultOrder: () =>
    set((state) => ({ settings: { ...state.settings, stageOrder: [...DEFAULT_STAGE_ORDER] } })),

  useBriefOrder: () =>
    set((state) => ({ settings: { ...state.settings, stageOrder: [...BRIEF_STAGE_ORDER] } })),

  replaceAll: (settings) => set({ settings }),

  reset: () => set({ settings: { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights } } }),
}));
