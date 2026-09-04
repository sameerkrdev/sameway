import { create } from "zustand";

import type {
  Driver,
  Passenger,
  Ride,
  RideRequest,
  Scenario,
  Stop,
  Vehicle,
} from "@/domain/entities";
import { createId } from "@/lib/ids";
import type { CommitPlan } from "@/matching/types";
import { createBlankScenario } from "@/scenarios/builders";

/**
 * Owns the world being simulated: who exists, where they are, what they are
 * committed to. This is the only store the matching engine ever reads from,
 * and it does so through a snapshot rather than a subscription.
 */
interface ScenarioState {
  scenario: Scenario;
  /** The scenario as it was before the most recent commit, for undo. */
  lastCommittedScenario: Scenario | null;

  setScenario(scenario: Scenario): void;
  renameScenario(name: string): void;
  resetScenario(): void;

  commitMatch(plan: CommitPlan): void;
  undoCommit(): void;

  upsertDriver(driver: Driver): void;
  removeDriver(driverId: string): void;
  setDriverLocation(driverId: string, location: Driver["location"], address?: string): void;

  upsertVehicle(vehicle: Vehicle): void;
  removeVehicle(vehicleId: string): void;

  upsertPassenger(passenger: Passenger): void;
  removePassenger(passengerId: string): void;

  upsertRide(ride: Ride): void;
  removeRide(rideId: string): void;
  setRideStops(rideId: string, stops: Stop[]): void;

  upsertRequest(request: RideRequest): void;
  removeRequest(requestId: string): void;
  activeRequest(): RideRequest | undefined;
}

function loadDefaultScenario(): Scenario {
  return createBlankScenario();
}

/** Renumbers stops so `sequence` always agrees with array order. */
function resequence(stops: Stop[]): Stop[] {
  return stops.map((stop, index) => ({ ...stop, sequence: index }));
}

function replaceById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [...items, next];
  }
  const copy = [...items];
  copy[index] = next;
  return copy;
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  scenario: loadDefaultScenario(),
  lastCommittedScenario: null,

  setScenario: (scenario) => set({ scenario }),

  renameScenario: (name) => set((state) => ({ scenario: { ...state.scenario, name } })),

  resetScenario: () => set({ scenario: loadDefaultScenario() }),

  /**
   * Applies a winning match to the live scenario.
   *
   * This is the only place a match ever changes the world. Keeping it out of
   * the engine is what lets a run be replayed, snapshotted and compared — and
   * what makes "run matching" safe to click repeatedly.
   */
  commitMatch: (plan) => {
    set((state) => {
      const previous = structuredClone(state.scenario);
      const scenario = structuredClone(state.scenario);

      const driver = scenario.drivers.find((candidate) => candidate.id === plan.driverId);
      if (!driver) {
        return state;
      }

      const rideId = plan.rideId ?? createId("ride");
      let ride = scenario.rides.find((candidate) => candidate.id === rideId);

      if (!ride) {
        ride = { id: rideId, driverId: driver.id, passengerIds: [], stops: [] };
        scenario.rides.push(ride);
        driver.currentRideId = rideId;
      }

      if (!ride.passengerIds.includes(plan.passengerId)) {
        ride.passengerIds.push(plan.passengerId);
      }

      ride.stops = plan.stops.map((stop, index) => ({
        id: stop.id,
        rideId,
        passengerId: stop.passengerId,
        type: stop.type,
        location: stop.location,
        sequence: index,
        // The solved arrival becomes the promise the next insertion protects.
        originalEtaMin: stop.originalEtaMin,
      }));

      scenario.requests = scenario.requests.filter((candidate) => candidate.id !== plan.requestId);

      return { ...state, scenario, lastCommittedScenario: previous };
    });
  },

  /** Restores the scenario as it was before the most recent commit. */
  undoCommit: () => {
    set((state) =>
      state.lastCommittedScenario
        ? { ...state, scenario: state.lastCommittedScenario, lastCommittedScenario: null }
        : state,
    );
  },

  upsertDriver: (driver) =>
    set((state) => ({
      scenario: { ...state.scenario, drivers: replaceById(state.scenario.drivers, driver) },
    })),

  removeDriver: (driverId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        drivers: state.scenario.drivers.filter((driver) => driver.id !== driverId),
        // A ride without its driver would dangle, so it goes too.
        rides: state.scenario.rides.filter((ride) => ride.driverId !== driverId),
      },
    })),

  setDriverLocation: (driverId, location, address) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        drivers: state.scenario.drivers.map((driver) =>
          driver.id === driverId
            ? { ...driver, location, ...(address ? { address } : {}) }
            : driver,
        ),
      },
    })),

  upsertVehicle: (vehicle) =>
    set((state) => ({
      scenario: { ...state.scenario, vehicles: replaceById(state.scenario.vehicles, vehicle) },
    })),

  removeVehicle: (vehicleId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        vehicles: state.scenario.vehicles.filter((vehicle) => vehicle.id !== vehicleId),
      },
    })),

  upsertPassenger: (passenger) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        passengers: replaceById(state.scenario.passengers, passenger),
      },
    })),

  removePassenger: (passengerId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        passengers: state.scenario.passengers.filter(
          (passenger) => passenger.id !== passengerId,
        ),
        rides: state.scenario.rides.map((ride) => ({
          ...ride,
          passengerIds: ride.passengerIds.filter((id) => id !== passengerId),
          stops: resequence(ride.stops.filter((stop) => stop.passengerId !== passengerId)),
        })),
      },
    })),

  upsertRide: (ride) =>
    set((state) => {
      const rides = replaceById(state.scenario.rides, {
        ...ride,
        stops: resequence(ride.stops),
      });

      return {
        scenario: {
          ...state.scenario,
          rides,
          drivers: state.scenario.drivers.map((driver) =>
            driver.id === ride.driverId ? { ...driver, currentRideId: ride.id } : driver,
          ),
        },
      };
    }),

  removeRide: (rideId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        rides: state.scenario.rides.filter((ride) => ride.id !== rideId),
        drivers: state.scenario.drivers.map((driver) =>
          driver.currentRideId === rideId ? { ...driver, currentRideId: null } : driver,
        ),
      },
    })),

  setRideStops: (rideId, stops) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        rides: state.scenario.rides.map((ride) =>
          ride.id === rideId
            ? {
                ...ride,
                stops: resequence(stops),
                passengerIds: [...new Set(stops.map((stop) => stop.passengerId))],
              }
            : ride,
        ),
      },
    })),

  upsertRequest: (request) =>
    set((state) => ({
      scenario: { ...state.scenario, requests: replaceById(state.scenario.requests, request) },
    })),

  removeRequest: (requestId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        requests: state.scenario.requests.filter((request) => request.id !== requestId),
      },
    })),

  activeRequest: () => get().scenario.requests[0],
}));

export function newDriverId(scenario: Scenario): string {
  const used = new Set(scenario.drivers.map((driver) => driver.id));
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `D${String(index).padStart(3, "0")}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return createId("D");
}

export function newPassengerId(scenario: Scenario): string {
  const used = new Set(scenario.passengers.map((passenger) => passenger.id));
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `P${String(index).padStart(3, "0")}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return createId("P");
}
