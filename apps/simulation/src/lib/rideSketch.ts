import type {
  DriverStatus,
  LatLng,
  Passenger,
  Ride,
  Scenario,
  Stop,
  StopType,
  Vehicle,
} from "@/domain/entities";
import { createId } from "@/lib/ids";
import { mockLeg } from "@/routing/MockRoutingEngine";
import {
  DEFAULT_FLEET,
  FLEET,
  makeDriver,
  makePassenger,
  makeRequest,
  makeRide,
  makeVehicle,
} from "@/scenarios/builders";
import { newDriverId, newPassengerId } from "@/stores/scenarioStore";

export interface SketchStop {
  id: string;
  passengerId: string;
  type: StopType;
  location: LatLng;
}

/** One in-progress ride in a multi-ride sketch session. */
export interface RideSketchDraft {
  slotId: string;
  label: string;
  driverId: string | null;
  /** True when Apply should create a new driver rather than update an existing one. */
  isNewDriver: boolean;
  driverName: string;
  driverStatus: DriverStatus;
  /** Scenario vehicle id or fleet template id (e.g. V_CAB4). */
  vehicleId: string;
  /**
   * When false, only the driver + location are committed (idle / available).
   * When true, covered/remaining path and stops are included.
   */
  hasActiveRide: boolean;
  rideId: string | null;
  vehicleLocation: LatLng | null;
  /** Already-driven trail (committed to `ride.coveredPath` on Apply). */
  coveredPath: LatLng[];
  /** Remaining visual path — not committed; RouteLayer rebuilds from stops. */
  pathWaypoints: LatLng[];
  stops: SketchStop[];
}

/** Shared new-request endpoints for the matching experiment after Apply. */
export interface RideSketchRequestDraft {
  requestPickup: LatLng | null;
  requestDrop: LatLng | null;
  requestPassengerId: string | null;
}

export interface RideSketchCommit {
  vehicleId: string;
  vehicleToCreate: Vehicle | null;
  driver: ReturnType<typeof makeDriver>;
  passengers: Passenger[];
  ride: Ride | null;
}

export interface MultiRideSketchCommit {
  rides: RideSketchCommit[];
  sharedPassengers: Passenger[];
  request: ReturnType<typeof makeRequest> | null;
}

export function createSlotId(): string {
  return createId("slot");
}

export function defaultSketchVehicleId(scenario?: Scenario): string {
  return scenario?.vehicles[0]?.id ?? FLEET.cab4.id;
}

/** Vehicles the toolkit can pick: scenario fleet first, then built-in templates. */
export function sketchVehicleOptions(scenario: Scenario): Vehicle[] {
  const seen = new Set(scenario.vehicles.map((vehicle) => vehicle.id));
  const extras = DEFAULT_FLEET.filter((vehicle) => !seen.has(vehicle.id));
  return [...scenario.vehicles, ...extras];
}

export function emptyRideSketchDraft(label = "Ride 1", scenario?: Scenario): RideSketchDraft {
  return {
    slotId: createSlotId(),
    label,
    driverId: null,
    isNewDriver: true,
    driverName: "",
    driverStatus: "ONLINE",
    vehicleId: defaultSketchVehicleId(scenario),
    hasActiveRide: false,
    rideId: null,
    vehicleLocation: null,
    coveredPath: [],
    pathWaypoints: [],
    stops: [],
  };
}

export function emptyRequestDraft(): RideSketchRequestDraft {
  return {
    requestPickup: null,
    requestDrop: null,
    requestPassengerId: null,
  };
}

/** Seeds a draft from an existing driver (and their current ride, if any). */
export function loadDraftFromScenario(scenario: Scenario, driverId: string): RideSketchDraft {
  const driver = scenario.drivers.find((entry) => entry.id === driverId);
  if (!driver) {
    return emptyRideSketchDraft(`Missing ${driverId}`, scenario);
  }

  const ride = scenario.rides.find((entry) => entry.driverId === driverId) ?? null;
  const stops: SketchStop[] = ride
    ? [...ride.stops]
        .sort((a, b) => a.sequence - b.sequence)
        .map((stop) => ({
          id: stop.id,
          passengerId: stop.passengerId,
          type: stop.type,
          location: stop.location,
        }))
    : [];

  const coveredPath = ride?.coveredPath ? [...ride.coveredPath] : [];
  const pathWaypoints =
    stops.length > 0 ? [driver.location, ...stops.map((stop) => stop.location)] : [driver.location];

  return {
    slotId: createSlotId(),
    label: driver.id,
    driverId: driver.id,
    isNewDriver: false,
    driverName: driver.name,
    driverStatus: driver.status,
    vehicleId: driver.vehicleId,
    hasActiveRide: ride !== null,
    rideId: ride?.id ?? null,
    vehicleLocation: driver.location,
    coveredPath,
    pathWaypoints,
    stops,
  };
}

/**
 * Onboard passengers have a remaining DROP but no remaining PICKUP.
 * Waiting passengers still have a PICKUP ahead.
 */
export function inferPassengerState(
  passengerId: string,
  stops: SketchStop[],
): "WAITING" | "IN_RIDE" {
  const hasPickup = stops.some((stop) => stop.passengerId === passengerId && stop.type === "PICKUP");
  const hasDrop = stops.some((stop) => stop.passengerId === passengerId && stop.type === "DROP");
  if (hasDrop && !hasPickup) {
    return "IN_RIDE";
  }
  return "WAITING";
}

export function validateRideSketchDraft(draft: RideSketchDraft): string | null {
  if (!draft.driverId && !draft.isNewDriver) {
    return `${draft.label}: pick a driver, or start a new one.`;
  }
  if (!draft.vehicleId) {
    return `${draft.label}: choose a vehicle type.`;
  }
  if (!draft.vehicleLocation) {
    return `${draft.label}: place the vehicle on the map.`;
  }
  if (draft.hasActiveRide && draft.stops.length === 0 && draft.coveredPath.length === 0) {
    return `${draft.label}: add remaining stops (or covered path), or turn off “Has active ride”.`;
  }
  return null;
}

export function validateRequestDraft(request: RideSketchRequestDraft): string | null {
  if (request.requestPickup && !request.requestDrop) {
    return "Request pickup is set — place the drop too, or clear pickup.";
  }
  if (request.requestDrop && !request.requestPickup) {
    return "Request drop is set — place the pickup too, or clear drop.";
  }
  if ((request.requestPickup || request.requestDrop) && !request.requestPassengerId) {
    return "Pick a passenger for the new ride request.";
  }
  return null;
}

export function validateMultiRideSketch(
  drafts: RideSketchDraft[],
  request: RideSketchRequestDraft,
  scenario?: Scenario,
): string | null {
  if (drafts.length === 0) {
    return "Add at least one driver/ride to the sketch.";
  }
  for (const draft of drafts) {
    const error = validateRideSketchDraft(draft);
    if (error) {
      return error;
    }
  }
  const requestError = validateRequestDraft(request);
  if (requestError) {
    return requestError;
  }
  if (request.requestPassengerId && scenario) {
    const passengerId = request.requestPassengerId;
    const onScenarioRide = scenario.rides.some((ride) => ride.passengerIds.includes(passengerId));
    const onSketchRide = drafts.some((draft) =>
      draft.stops.some((stop) => stop.passengerId === passengerId),
    );
    if (onScenarioRide || onSketchRide) {
      return "Request passenger is already on a ride — create a new passenger (+).";
    }
  }
  return null;
}

function resolveVehicle(
  draft: RideSketchDraft,
  scenario: Scenario,
): { vehicleId: string; vehicleToCreate: Vehicle | null } {
  const existing = scenario.vehicles.find((vehicle) => vehicle.id === draft.vehicleId);
  if (existing) {
    return { vehicleId: existing.id, vehicleToCreate: null };
  }

  const template =
    DEFAULT_FLEET.find((vehicle) => vehicle.id === draft.vehicleId) ??
    Object.values(FLEET).find((vehicle) => vehicle.id === draft.vehicleId);

  if (template) {
    return { vehicleId: template.id, vehicleToCreate: { ...template } };
  }

  return {
    vehicleId: draft.vehicleId,
    vehicleToCreate: makeVehicle({ id: draft.vehicleId, label: draft.vehicleId }),
  };
}

/**
 * Turns one draft into scenario entities. Covered path is stored on the ride;
 * remaining path waypoints are visual-only.
 */
export function buildRideSketchCommit(
  draft: RideSketchDraft,
  scenario: Scenario,
  pendingPassengers: Passenger[],
  usedDriverIds: Set<string>,
): RideSketchCommit | { error: string } {
  const error = validateRideSketchDraft(draft);
  if (error) {
    return { error };
  }

  const vehicleLocation = draft.vehicleLocation!;
  const { vehicleId, vehicleToCreate } = resolveVehicle(draft, scenario);

  let driverId: string;
  if (draft.isNewDriver) {
    driverId = draft.driverId ?? newDriverId(scenario);
    while (usedDriverIds.has(driverId) || scenario.drivers.some((entry) => entry.id === driverId)) {
      driverId = createId("D");
    }
  } else {
    driverId = draft.driverId!;
  }

  const existingDriver = scenario.drivers.find((entry) => entry.id === driverId);
  const status = draft.driverStatus;
  const name =
    draft.driverName.trim() ||
    existingDriver?.name ||
    (draft.isNewDriver ? `Driver ${driverId}` : driverId);

  if (!draft.hasActiveRide) {
    const driver = makeDriver({
      id: driverId,
      name,
      status,
      location: vehicleLocation,
      vehicleId,
      currentRideId: null,
      history: existingDriver?.history ?? {
        ridesCompletedToday: 0,
        lastAssignmentAt: null,
        idleMinutes: 0,
      },
    });

    return {
      vehicleId,
      vehicleToCreate,
      driver,
      passengers: [],
      ride: null,
    };
  }

  const driver = makeDriver({
    id: driverId,
    name,
    status,
    location: vehicleLocation,
    vehicleId,
    currentRideId: existingDriver?.currentRideId ?? draft.rideId,
    history: existingDriver?.history ?? {
      ridesCompletedToday: 0,
      lastAssignmentAt: null,
      idleMinutes: 0,
    },
  });

  const ridePassengerIds = [...new Set(draft.stops.map((stop) => stop.passengerId))];
  const passengers = pendingPassengers
    .filter((passenger) => ridePassengerIds.includes(passenger.id))
    .map((passenger) =>
      makePassenger({
        ...passenger,
        state: inferPassengerState(passenger.id, draft.stops),
      }),
    );

  const rideId = draft.rideId ?? createId("ride");
  let cumulativeMin = 0;
  let previous = vehicleLocation;
  const stops: Omit<Stop, "rideId" | "sequence">[] = draft.stops.map((stop, index) => {
    cumulativeMin += mockLeg(previous, stop.location).durationMin;
    previous = stop.location;
    return {
      id: stop.id || `${rideId}_S${index + 1}`,
      passengerId: stop.passengerId,
      type: stop.type,
      location: stop.location,
      // Promised ETA from the vehicle's current position — same contract as
      // makeScenario. Zero ETAs make Google hard windows infeasible the moment
      // real road times are fetched.
      originalEtaMin: cumulativeMin,
    };
  });

  const covered =
    draft.coveredPath.length > 0
      ? (() => {
          const path = [...draft.coveredPath];
          const last = path[path.length - 1];
          if (!last || last.lat !== vehicleLocation.lat || last.lng !== vehicleLocation.lng) {
            path.push(vehicleLocation);
          }
          return path;
        })()
      : undefined;

  const ride = makeRide(rideId, driverId, stops, covered);

  return {
    vehicleId,
    vehicleToCreate,
    driver: { ...driver, currentRideId: ride.stops.length > 0 ? ride.id : null },
    passengers,
    ride: ride.stops.length > 0 || (ride.coveredPath?.length ?? 0) > 0 ? ride : null,
  };
}

export function buildMultiRideSketchCommit(
  drafts: RideSketchDraft[],
  request: RideSketchRequestDraft,
  pendingPassengers: Passenger[],
  scenario: Scenario,
): MultiRideSketchCommit | { error: string } {
  const error = validateMultiRideSketch(drafts, request, scenario);
  if (error) {
    return { error };
  }

  const usedDriverIds = new Set<string>();
  const rides: RideSketchCommit[] = [];
  const passengerById = new Map<string, Passenger>();

  for (const draft of drafts) {
    const commit = buildRideSketchCommit(draft, scenario, pendingPassengers, usedDriverIds);
    if ("error" in commit) {
      return commit;
    }
    usedDriverIds.add(commit.driver.id);
    rides.push(commit);
    for (const passenger of commit.passengers) {
      passengerById.set(passenger.id, passenger);
    }

    for (const stop of draft.stops) {
      if (passengerById.has(stop.passengerId)) {
        continue;
      }
      const existing = scenario.passengers.find((entry) => entry.id === stop.passengerId);
      if (existing) {
        passengerById.set(stop.passengerId, {
          ...existing,
          state: inferPassengerState(stop.passengerId, draft.stops),
        });
      }
    }
  }

  let requestEntity: ReturnType<typeof makeRequest> | null = null;
  if (request.requestPickup && request.requestDrop && request.requestPassengerId) {
    const existing = scenario.requests[0];
    const pending = pendingPassengers.find((entry) => entry.id === request.requestPassengerId);
    if (pending && !passengerById.has(pending.id)) {
      passengerById.set(pending.id, makePassenger({ ...pending, state: "WAITING" }));
    }
    requestEntity = makeRequest({
      id: existing?.id ?? createId("req"),
      passengerId: request.requestPassengerId,
      pickup: request.requestPickup,
      drop: request.requestDrop,
      seatsRequired: existing?.seatsRequired ?? 1,
      poolingAllowed: existing?.poolingAllowed ?? true,
      maxWaitMinutes: existing?.maxWaitMinutes ?? 6,
    });
  }

  return {
    rides,
    sharedPassengers: [...passengerById.values()],
    request: requestEntity,
  };
}

export function createSketchPassenger(scenario: Scenario, pending: Passenger[]): Passenger {
  const used = new Set([
    ...scenario.passengers.map((passenger) => passenger.id),
    ...pending.map((passenger) => passenger.id),
  ]);
  let id = newPassengerId(scenario);
  if (used.has(id)) {
    id = createId("P");
  }
  return makePassenger({ id, name: id, state: "WAITING" });
}

export function createSketchStopId(): string {
  return createId("skstop");
}

export { makeVehicle };
