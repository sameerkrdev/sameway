import { create } from "zustand";

import type { LatLng } from "@/domain/entities";
import { DELHI_PLACES } from "@/scenarios/builders";

/**
 * Map modes are mutually exclusive and each click does exactly one predictable
 * thing. Inspecting the map in NORMAL mode can never mutate the scenario.
 */
export type MapMode =
  | "NORMAL"
  | "ADD_DRIVER_LOCATION"
  | "ADD_PICKUP"
  | "ADD_DROP"
  | "ADD_STOP"
  | "INSPECT_H3";

export const MAP_MODE_LABELS: Record<MapMode, string> = {
  NORMAL: "Normal",
  ADD_DRIVER_LOCATION: "Add driver location",
  ADD_PICKUP: "Add pickup",
  ADD_DROP: "Add drop",
  ADD_STOP: "Add stop",
  INSPECT_H3: "Inspect H3",
};

export const MAP_MODE_HINTS: Record<MapMode, string> = {
  NORMAL: "Click a marker to inspect it. Nothing on the map will change.",
  ADD_DRIVER_LOCATION: "Click anywhere to place the selected driver.",
  ADD_PICKUP: "Click anywhere to set the request pickup.",
  ADD_DROP: "Click anywhere to set the request drop.",
  ADD_STOP: "Click anywhere to append a stop to the ride being edited.",
  INSPECT_H3: "Click anywhere to inspect the H3 cell under the cursor.",
};

/** What a click in a placement mode should update. */
export interface PendingLocationTarget {
  kind: "DRIVER" | "REQUEST_PICKUP" | "REQUEST_DROP" | "RIDE_STOP";
  entityId: string;
  /** For RIDE_STOP: which passenger the appended stop belongs to. */
  passengerId?: string;
  stopType?: "PICKUP" | "DROP";
}

export interface InspectedCell {
  cell: string;
  point: LatLng;
}

interface MapState {
  mode: MapMode;
  center: LatLng;
  zoom: number;
  showH3: boolean;
  showAllRoutes: boolean;
  pendingTarget: PendingLocationTarget | null;
  inspectedCell: InspectedCell | null;
  /** Set by list hovers so the map can highlight without changing selection. */
  hoveredDriverId: string | null;
  /** Requests an imperative camera move; cleared once the map consumes it. */
  focusRequest: { bounds: LatLng[]; nonce: number } | null;

  setMode(mode: MapMode, target?: PendingLocationTarget | null): void;
  resetMode(): void;
  setCenter(center: LatLng): void;
  setZoom(zoom: number): void;
  toggleH3(): void;
  toggleAllRoutes(): void;
  setInspectedCell(cell: InspectedCell | null): void;
  setHoveredDriver(driverId: string | null): void;
  focusOn(points: LatLng[]): void;
  clearFocus(): void;
}

let focusNonce = 0;

export const useMapStore = create<MapState>((set) => ({
  mode: "NORMAL",
  center: DELHI_PLACES.connaughtPlace,
  zoom: 12,
  showH3: false,
  showAllRoutes: false,
  pendingTarget: null,
  inspectedCell: null,
  hoveredDriverId: null,
  focusRequest: null,

  setMode: (mode, target = null) => set({ mode, pendingTarget: target }),

  resetMode: () => set({ mode: "NORMAL", pendingTarget: null }),

  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  toggleH3: () => set((state) => ({ showH3: !state.showH3 })),
  toggleAllRoutes: () => set((state) => ({ showAllRoutes: !state.showAllRoutes })),
  setInspectedCell: (inspectedCell) => set({ inspectedCell }),
  setHoveredDriver: (hoveredDriverId) => set({ hoveredDriverId }),

  focusOn: (points) => {
    if (points.length === 0) {
      return;
    }
    focusNonce += 1;
    set({ focusRequest: { bounds: points, nonce: focusNonce } });
  },

  clearFocus: () => set({ focusRequest: null }),
}));
