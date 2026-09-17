import { create } from "zustand";

import type { DriverStatus, LatLng, Passenger, Scenario, StopType } from "@/domain/entities";
import {
  createSketchPassenger,
  createSketchStopId,
  emptyRequestDraft,
  emptyRideSketchDraft,
  loadDraftFromScenario,
  type RideSketchDraft,
  type RideSketchRequestDraft,
  type SketchStop,
} from "@/lib/rideSketch";

export type SketchTool =
  | "PLACE_VEHICLE"
  | "DRAW_COVERED"
  | "DRAW_PATH"
  | "PLACE_STOP"
  | "PLACE_REQUEST_PICKUP"
  | "PLACE_REQUEST_DROP";

interface RideSketchState extends RideSketchRequestDraft {
  slots: RideSketchDraft[];
  activeIndex: number;
  pendingPassengers: Passenger[];
  tool: SketchTool;
  selectedPassengerId: string | null;
  selectedStopType: StopType;

  activeDraft(): RideSketchDraft | null;
  addRideSlot(scenario?: Scenario): void;
  removeRideSlot(slotId: string): void;
  setActiveSlot(index: number): void;
  beginNewDriver(scenario?: Scenario): void;
  selectExistingDriver(scenario: Scenario, driverId: string): void;
  loadFromRide(scenario: Scenario, driverId: string): void;
  patchActiveDraft(patch: Partial<RideSketchDraft>): void;
  setDriverConfig(patch: {
    driverName?: string;
    driverStatus?: DriverStatus;
    vehicleId?: string;
    hasActiveRide?: boolean;
  }): void;
  setTool(tool: SketchTool): void;
  setSelectedPassenger(passengerId: string | null): void;
  setSelectedStopType(type: StopType): void;
  addPassenger(scenario: Scenario): Passenger;
  handleMapClick(point: LatLng): void;
  removeStop(stopId: string): void;
  undoCoveredWaypoint(): void;
  undoPathWaypoint(): void;
  clearCovered(): void;
  clearPath(): void;
  clearRequest(): void;
  setRequestPassenger(passengerId: string | null): void;
  discard(scenario?: Scenario): void;
  discardActive(scenario?: Scenario): void;
}

function patchActive(
  state: RideSketchState,
  patch: Partial<RideSketchDraft>,
): Partial<RideSketchState> {
  const slots = state.slots.map((slot, index) =>
    index === state.activeIndex ? { ...slot, ...patch } : slot,
  );
  return { slots };
}

export const useRideSketchStore = create<RideSketchState>((set, get) => ({
  slots: [emptyRideSketchDraft("Driver 1")],
  activeIndex: 0,
  pendingPassengers: [],
  ...emptyRequestDraft(),
  tool: "PLACE_VEHICLE",
  selectedPassengerId: null,
  selectedStopType: "PICKUP",

  activeDraft: () => {
    const state = get();
    return state.slots[state.activeIndex] ?? null;
  },

  addRideSlot: (scenario) =>
    set((state) => {
      const label = `Driver ${state.slots.length + 1}`;
      const slots = [...state.slots, emptyRideSketchDraft(label, scenario)];
      return {
        slots,
        activeIndex: slots.length - 1,
        tool: "PLACE_VEHICLE",
        selectedPassengerId: null,
        selectedStopType: "PICKUP",
      };
    }),

  removeRideSlot: (slotId) =>
    set((state) => {
      if (state.slots.length <= 1) {
        return {
          slots: [emptyRideSketchDraft("Driver 1")],
          activeIndex: 0,
          tool: "PLACE_VEHICLE",
        };
      }
      const slots = state.slots.filter((slot) => slot.slotId !== slotId);
      const activeIndex = Math.min(state.activeIndex, slots.length - 1);
      return { slots, activeIndex };
    }),

  setActiveSlot: (index) =>
    set((state) => ({
      activeIndex: Math.max(0, Math.min(index, state.slots.length - 1)),
      tool: "PLACE_VEHICLE",
      selectedPassengerId: null,
    })),

  beginNewDriver: (scenario) =>
    set((state) => ({
      ...patchActive(state, {
        ...emptyRideSketchDraft(state.slots[state.activeIndex]?.label ?? "Driver", scenario),
        slotId: state.slots[state.activeIndex]?.slotId ?? createSketchStopId(),
        isNewDriver: true,
        label: state.slots[state.activeIndex]?.label ?? "Driver",
      }),
      tool: "PLACE_VEHICLE",
      selectedPassengerId: null,
      selectedStopType: "PICKUP",
    })),

  selectExistingDriver: (scenario, driverId) =>
    set((state) => {
      const loaded = loadDraftFromScenario(scenario, driverId);
      const current = state.slots[state.activeIndex];
      return {
        ...patchActive(state, {
          ...loaded,
          slotId: current?.slotId ?? loaded.slotId,
          label: loaded.label,
        }),
        tool: "PLACE_VEHICLE",
        selectedPassengerId: null,
        selectedStopType: "PICKUP",
      };
    }),

  loadFromRide: (scenario, driverId) =>
    set((state) => {
      const loaded = loadDraftFromScenario(scenario, driverId);
      const current = state.slots[state.activeIndex];
      return {
        ...patchActive(state, {
          ...loaded,
          slotId: current?.slotId ?? loaded.slotId,
          hasActiveRide: true,
        }),
        tool: "DRAW_PATH",
        selectedPassengerId: null,
        selectedStopType: "PICKUP",
      };
    }),

  patchActiveDraft: (patch) => set((state) => patchActive(state, patch)),

  setDriverConfig: (patch) =>
    set((state) => {
      const active = state.slots[state.activeIndex];
      if (!active) {
        return state;
      }
      // Status is independent of "has active ride": mid-trip poolable drivers
      // stay ONLINE; BUSY means unavailable for matching entirely.
      return {
        ...patchActive(state, patch),
        tool: "PLACE_VEHICLE",
        ...(patch.hasActiveRide === false ? { selectedPassengerId: null } : {}),
      };
    }),

  setTool: (tool) => set({ tool }),

  setSelectedPassenger: (selectedPassengerId) => set({ selectedPassengerId }),

  setSelectedStopType: (selectedStopType) => set({ selectedStopType }),

  addPassenger: (scenario) => {
    const passenger = createSketchPassenger(scenario, get().pendingPassengers);
    set((state) => ({
      pendingPassengers: [...state.pendingPassengers, passenger],
      selectedPassengerId: passenger.id,
      tool: "PLACE_STOP",
    }));
    return passenger;
  },

  handleMapClick: (point) => {
    const state = get();
    const active = state.slots[state.activeIndex];
    if (!active) {
      return;
    }

    if (
      !active.hasActiveRide &&
      (state.tool === "DRAW_COVERED" || state.tool === "DRAW_PATH" || state.tool === "PLACE_STOP")
    ) {
      return;
    }

    switch (state.tool) {
      case "PLACE_VEHICLE":
        set({
          ...patchActive(state, {
            vehicleLocation: point,
            pathWaypoints:
              active.pathWaypoints.length === 0
                ? [point]
                : [point, ...active.pathWaypoints.slice(1)],
          }),
        });
        break;
      case "DRAW_COVERED":
        set({
          ...patchActive(state, {
            coveredPath: [...active.coveredPath, point],
          }),
        });
        break;
      case "DRAW_PATH":
        set({
          ...patchActive(state, {
            pathWaypoints: [...active.pathWaypoints, point],
            vehicleLocation: active.vehicleLocation ?? point,
          }),
        });
        break;
      case "PLACE_STOP": {
        if (!state.selectedPassengerId) {
          return;
        }
        const stop: SketchStop = {
          id: createSketchStopId(),
          passengerId: state.selectedPassengerId,
          type: state.selectedStopType,
          location: point,
        };
        set({ ...patchActive(state, { stops: [...active.stops, stop] }) });
        break;
      }
      case "PLACE_REQUEST_PICKUP":
        set({ requestPickup: point });
        break;
      case "PLACE_REQUEST_DROP":
        set({ requestDrop: point });
        break;
      default:
        break;
    }
  },

  removeStop: (stopId) =>
    set((state) => {
      const active = state.slots[state.activeIndex];
      if (!active) {
        return state;
      }
      return patchActive(state, {
        stops: active.stops.filter((stop) => stop.id !== stopId),
      });
    }),

  undoCoveredWaypoint: () =>
    set((state) => {
      const active = state.slots[state.activeIndex];
      if (!active) {
        return state;
      }
      return patchActive(state, { coveredPath: active.coveredPath.slice(0, -1) });
    }),

  undoPathWaypoint: () =>
    set((state) => {
      const active = state.slots[state.activeIndex];
      if (!active) {
        return state;
      }
      return patchActive(state, { pathWaypoints: active.pathWaypoints.slice(0, -1) });
    }),

  clearCovered: () => set((state) => patchActive(state, { coveredPath: [] })),

  clearPath: () =>
    set((state) => {
      const active = state.slots[state.activeIndex];
      if (!active) {
        return state;
      }
      return patchActive(state, {
        pathWaypoints: active.vehicleLocation ? [active.vehicleLocation] : [],
      });
    }),

  clearRequest: () => set({ ...emptyRequestDraft() }),

  setRequestPassenger: (requestPassengerId) => set({ requestPassengerId }),

  discard: (scenario) =>
    set({
      slots: [emptyRideSketchDraft("Driver 1", scenario)],
      activeIndex: 0,
      pendingPassengers: [],
      ...emptyRequestDraft(),
      tool: "PLACE_VEHICLE",
      selectedPassengerId: null,
      selectedStopType: "PICKUP",
    }),

  discardActive: (scenario) =>
    set((state) => ({
      ...patchActive(state, {
        ...emptyRideSketchDraft(state.slots[state.activeIndex]?.label ?? "Driver", scenario),
        slotId: state.slots[state.activeIndex]?.slotId ?? createSketchStopId(),
        label: state.slots[state.activeIndex]?.label ?? "Driver",
        isNewDriver: true,
      }),
      tool: "PLACE_VEHICLE",
      selectedPassengerId: null,
    })),
}));
