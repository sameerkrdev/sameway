import { beforeEach, describe, expect, it } from "vitest";

import { applyCurrentRideSketch, sketchHasUnsavedWork } from "@/lib/applyRideSketch";
import { createBlankScenario, FLEET } from "@/scenarios/builders";
import { useRideSketchStore } from "@/stores/rideSketchStore";
import { useScenarioStore } from "@/stores/scenarioStore";

describe("applyCurrentRideSketch", () => {
  beforeEach(() => {
    useScenarioStore.getState().setScenario(createBlankScenario());
    useRideSketchStore.getState().discard(createBlankScenario());
  });

  it("skips when the sketch is untouched", () => {
    expect(applyCurrentRideSketch()).toEqual({ status: "skipped" });
    expect(useScenarioStore.getState().scenario.drivers).toHaveLength(0);
  });

  it("applies sketched drivers and request into the blank scene", () => {
    const store = useRideSketchStore.getState();
    store.beginNewDriver(useScenarioStore.getState().scenario);
    store.setDriverConfig({
      driverStatus: "ONLINE",
      vehicleId: FLEET.cab4.id,
      hasActiveRide: false,
    });
    store.handleMapClick({ lat: 28.61, lng: 77.2 });

    const passenger = store.addPassenger(useScenarioStore.getState().scenario);
    store.setRequestPassenger(passenger.id);
    store.setTool("PLACE_REQUEST_PICKUP");
    store.handleMapClick({ lat: 28.62, lng: 77.21 });
    store.setTool("PLACE_REQUEST_DROP");
    store.handleMapClick({ lat: 28.63, lng: 77.22 });

    expect(
      sketchHasUnsavedWork({
        slots: useRideSketchStore.getState().slots,
        requestPickup: useRideSketchStore.getState().requestPickup,
        requestDrop: useRideSketchStore.getState().requestDrop,
        requestPassengerId: useRideSketchStore.getState().requestPassengerId,
        pendingPassengers: useRideSketchStore.getState().pendingPassengers,
      }),
    ).toBe(true);

    const result = applyCurrentRideSketch({ discardAfter: true });
    expect(result.status).toBe("applied");

    const scenario = useScenarioStore.getState().scenario;
    expect(scenario.drivers).toHaveLength(1);
    expect(scenario.drivers[0]?.status).toBe("ONLINE");
    expect(scenario.requests).toHaveLength(1);
    expect(scenario.requests[0]?.passengerId).toBe(passenger.id);
    expect(scenario.vehicles.some((vehicle) => vehicle.id === FLEET.cab4.id)).toBe(true);
  });
});
