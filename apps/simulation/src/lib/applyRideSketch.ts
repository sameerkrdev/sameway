import {
  buildMultiRideSketchCommit,
  type RideSketchDraft,
  type RideSketchRequestDraft,
} from "@/lib/rideSketch";
import type { Passenger, Scenario } from "@/domain/entities";
import { useMatchingStore } from "@/stores/matchingStore";
import { useMapStore } from "@/stores/mapStore";
import { useRideSketchStore } from "@/stores/rideSketchStore";
import { useScenarioStore } from "@/stores/scenarioStore";

export type ApplyRideSketchResult =
  | { status: "skipped" }
  | { status: "applied"; firstDriverId: string | null; requestId: string | null }
  | { status: "error"; error: string };

/** True when the sketch session has something worth committing. */
export function sketchHasUnsavedWork(input: {
  slots: RideSketchDraft[];
  requestPickup: RideSketchRequestDraft["requestPickup"];
  requestDrop: RideSketchRequestDraft["requestDrop"];
  requestPassengerId: RideSketchRequestDraft["requestPassengerId"];
  pendingPassengers: Passenger[];
}): boolean {
  if (input.pendingPassengers.length > 0) {
    return true;
  }
  if (input.requestPickup || input.requestDrop || input.requestPassengerId) {
    return true;
  }
  return input.slots.some(
    (slot) =>
      slot.vehicleLocation !== null ||
      slot.stops.length > 0 ||
      slot.coveredPath.length > 0 ||
      slot.pathWaypoints.length > 1 ||
      (slot.isNewDriver === false && slot.driverId !== null),
  );
}

function slotsReadyToCommit(slots: RideSketchDraft[]): RideSketchDraft[] {
  return slots.filter((slot) => slot.vehicleLocation !== null);
}

/**
 * Commits the current ride-sketch draft into the scenario store.
 *
 * Used by the toolkit Apply button and by Run matching (auto-apply).
 * Empty / untouched sketches are skipped so preset scenes still match.
 */
export function applyCurrentRideSketch(options?: {
  discardAfter?: boolean;
  exitSketchMode?: boolean;
}): ApplyRideSketchResult {
  const sketch = useRideSketchStore.getState();
  const scenarioStore = useScenarioStore.getState();
  const scenario = scenarioStore.scenario;

  if (
    !sketchHasUnsavedWork({
      slots: sketch.slots,
      requestPickup: sketch.requestPickup,
      requestDrop: sketch.requestDrop,
      requestPassengerId: sketch.requestPassengerId,
      pendingPassengers: sketch.pendingPassengers,
    })
  ) {
    return { status: "skipped" };
  }

  const readySlots = slotsReadyToCommit(sketch.slots);
  if (readySlots.length === 0) {
    return {
      status: "error",
      error:
        "Ride sketch has unfinished drivers. Place each driver’s vehicle on the map, or Discard the sketch.",
    };
  }

  const commit = buildMultiRideSketchCommit(
    readySlots,
    {
      requestPickup: sketch.requestPickup,
      requestDrop: sketch.requestDrop,
      requestPassengerId: sketch.requestPassengerId,
    },
    sketch.pendingPassengers,
    scenario,
  );

  if ("error" in commit) {
    return { status: "error", error: commit.error };
  }

  const createdVehicleIds = new Set<string>();
  for (const rideCommit of commit.rides) {
    if (rideCommit.vehicleToCreate && !createdVehicleIds.has(rideCommit.vehicleToCreate.id)) {
      scenarioStore.upsertVehicle(rideCommit.vehicleToCreate);
      createdVehicleIds.add(rideCommit.vehicleToCreate.id);
    }
    scenarioStore.upsertDriver(rideCommit.driver);
    if (rideCommit.ride) {
      scenarioStore.upsertRide(rideCommit.ride);
    }
  }
  for (const passenger of commit.sharedPassengers) {
    scenarioStore.upsertPassenger(passenger);
  }
  if (commit.request) {
    scenarioStore.upsertRequest(commit.request);
  }

  const firstDriverId = commit.rides[0]?.driver.id ?? null;
  if (firstDriverId) {
    useMatchingStore.getState().selectDriver(firstDriverId);
  }

  if (options?.discardAfter !== false) {
    useRideSketchStore.getState().discard(useScenarioStore.getState().scenario);
  }
  if (options?.exitSketchMode) {
    useMapStore.getState().resetMode();
  }

  return {
    status: "applied",
    firstDriverId,
    requestId: commit.request?.id ?? null,
  };
}

/** Snapshot helper for tests — apply a built commit onto a scenario clone. */
export function mergeCommitIntoScenario(
  scenario: Scenario,
  commit: Exclude<ReturnType<typeof buildMultiRideSketchCommit>, { error: string }>,
): Scenario {
  let next = structuredClone(scenario);

  for (const rideCommit of commit.rides) {
    if (rideCommit.vehicleToCreate) {
      const exists = next.vehicles.some((vehicle) => vehicle.id === rideCommit.vehicleToCreate!.id);
      if (!exists) {
        next.vehicles = [...next.vehicles, rideCommit.vehicleToCreate];
      }
    }
    const driverIndex = next.drivers.findIndex((driver) => driver.id === rideCommit.driver.id);
    if (driverIndex === -1) {
      next.drivers = [...next.drivers, rideCommit.driver];
    } else {
      next.drivers = next.drivers.map((driver) =>
        driver.id === rideCommit.driver.id ? rideCommit.driver : driver,
      );
    }
    if (rideCommit.ride) {
      const rideIndex = next.rides.findIndex((ride) => ride.id === rideCommit.ride!.id);
      if (rideIndex === -1) {
        next.rides = [...next.rides, rideCommit.ride];
      } else {
        next.rides = next.rides.map((ride) =>
          ride.id === rideCommit.ride!.id ? rideCommit.ride! : ride,
        );
      }
    }
  }

  for (const passenger of commit.sharedPassengers) {
    const index = next.passengers.findIndex((entry) => entry.id === passenger.id);
    if (index === -1) {
      next.passengers = [...next.passengers, passenger];
    } else {
      next.passengers = next.passengers.map((entry) =>
        entry.id === passenger.id ? passenger : entry,
      );
    }
  }

  if (commit.request) {
    const index = next.requests.findIndex((entry) => entry.id === commit.request!.id);
    if (index === -1) {
      next.requests = [...next.requests, commit.request];
    } else {
      next.requests = next.requests.map((entry) =>
        entry.id === commit.request!.id ? commit.request! : entry,
      );
    }
  }

  return next;
}
