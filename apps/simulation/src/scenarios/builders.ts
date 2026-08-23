import type {
  Driver,
  LatLng,
  MatchingSettings,
  Passenger,
  Ride,
  RideRequest,
  Scenario,
  Stop,
  Vehicle,
} from "@/domain/entities";
import { DEFAULT_PASSENGER_DELAY_BUDGETS, DEFAULT_SETTINGS } from "@/domain/settings";
import { mockLeg } from "@/routing/MockRoutingEngine";

/** Demo geography only. No matching logic may reference these values. */
export const DELHI_PLACES = {
  connaughtPlace: { lat: 28.6315, lng: 77.2167 },
  indiaGate: { lat: 28.6129, lng: 77.2295 },
  karolBagh: { lat: 28.6519, lng: 77.1909 },
  anandVihar: { lat: 28.6469, lng: 77.3159 },
  noida62: { lat: 28.628, lng: 77.3649 },
  noida18: { lat: 28.5708, lng: 77.3261 },
  ghaziabad: { lat: 28.6692, lng: 77.4538 },
  indirapuram: { lat: 28.6425, lng: 77.3717 },
  vaishali: { lat: 28.6503, lng: 77.3395 },
  igiAirport: { lat: 28.5562, lng: 77.1 },
  rajouriGarden: { lat: 28.6469, lng: 77.1207 },
  lajpatNagar: { lat: 28.5677, lng: 77.2433 },
  saket: { lat: 28.5245, lng: 77.2066 },
  gurgaon: { lat: 28.4595, lng: 77.0266 },
  dwarka: { lat: 28.5921, lng: 77.046 },
} as const satisfies Record<string, LatLng>;

export type PlaceName = keyof typeof DELHI_PLACES;

// Declared with `satisfies` rather than an annotation so `FLEET.cab4` is a
// Vehicle instead of `Vehicle | undefined` under noUncheckedIndexedAccess.
export const FLEET = {
  cab4: {
    id: "V_CAB4",
    label: "4-SEATER-CAB",
    totalSeats: 4,
    luggageCapacity: 3,
    poolingEnabled: true,
    wheelchairAccessible: false,
    airConditioned: true,
  },
  cab6: {
    id: "V_CAB6",
    label: "6-SEATER-CAB",
    totalSeats: 6,
    luggageCapacity: 5,
    poolingEnabled: true,
    wheelchairAccessible: true,
    airConditioned: true,
  },
  auto3: {
    id: "V_AUTO3",
    label: "3-SEATER-AUTO",
    totalSeats: 3,
    luggageCapacity: 1,
    poolingEnabled: true,
    wheelchairAccessible: false,
    airConditioned: false,
  },
  eRickshaw: {
    id: "V_ERICK",
    label: "E-RICKSHAW",
    totalSeats: 3,
    luggageCapacity: 1,
    poolingEnabled: false,
    wheelchairAccessible: false,
    airConditioned: false,
  },
} satisfies Record<string, Vehicle>;

export const DEFAULT_FLEET: Vehicle[] = Object.values(FLEET);

export function makeVehicle(overrides: Partial<Vehicle> & Pick<Vehicle, "id" | "label">): Vehicle {
  return {
    totalSeats: 4,
    luggageCapacity: 2,
    poolingEnabled: true,
    wheelchairAccessible: false,
    airConditioned: true,
    ...overrides,
  };
}

export function makeDriver(
  overrides: Partial<Driver> & Pick<Driver, "id" | "location" | "vehicleId">,
): Driver {
  return {
    name: overrides.id,
    status: "ONLINE",
    currentRideId: null,
    history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 12 },
    ...overrides,
  };
}

export function makePassenger(
  overrides: Partial<Passenger> & Pick<Passenger, "id">,
): Passenger {
  return {
    name: overrides.id,
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
    ...DEFAULT_PASSENGER_DELAY_BUDGETS,
    ...overrides,
  };
}

export function makeStop(
  overrides: Partial<Stop> & Pick<Stop, "id" | "rideId" | "passengerId" | "type" | "location">,
): Stop {
  return { sequence: 0, originalEtaMin: 0, ...overrides };
}

/** Builds a ride and renumbers its stops so `sequence` always matches order. */
export function makeRide(
  id: string,
  driverId: string,
  stops: Omit<Stop, "rideId" | "sequence">[],
): Ride {
  const orderedStops: Stop[] = stops.map((stop, index) => ({
    ...stop,
    rideId: id,
    sequence: index,
  }));

  return {
    id,
    driverId,
    passengerIds: [...new Set(orderedStops.map((stop) => stop.passengerId))],
    stops: orderedStops,
  };
}

export function makeRequest(
  overrides: Partial<RideRequest> & Pick<RideRequest, "id" | "passengerId" | "pickup" | "drop">,
): RideRequest {
  return {
    seatsRequired: 1,
    intermediateStops: [],
    poolingAllowed: true,
    vehiclePreference: "ANY",
    requiresWheelchairAccess: false,
    luggageCount: 0,
    maxWaitMinutes: 6,
    maxDetourPercent: 15,
    maxWalkingDistanceM: 300,
    priority: 0,
    ...overrides,
  };
}

export interface ScenarioInput {
  id: string;
  name: string;
  seed?: number;
  drivers: Driver[];
  vehicles?: Vehicle[];
  passengers: Passenger[];
  rides?: Ride[];
  requests: RideRequest[];
  settings?: Partial<MatchingSettings>;
}

/**
 * Stamps every ride's stops with the ETA it would have been promised when the
 * ride was committed, walking from its driver through the same leg model the
 * routing engine uses.
 *
 * Builders default `originalEtaMin` to 0, which is fine as a field default and
 * wrong as a promise: it is the value stages 6, 9, 10 and 12 measure delay
 * against, so a stop 14 km out claiming "promised at minute 0" reads as thirty
 * minutes late before anything has been inserted, and the ride breaches its own
 * delay budget the moment a solver looks at it. Doing this in `makeScenario`
 * rather than in each preset means a new preset cannot forget it.
 */
function stampRideEtas(drivers: readonly Driver[], rides: readonly Ride[]): Ride[] {
  const driversById = new Map(drivers.map((driver) => [driver.id, driver]));

  return rides.map((ride) => {
    const driver = driversById.get(ride.driverId);

    if (!driver) {
      return ride;
    }

    let cumulativeMin = 0;
    let previous = driver.location;

    return {
      ...ride,
      stops: ride.stops.map((stop) => {
        cumulativeMin += mockLeg(previous, stop.location).durationMin;
        previous = stop.location;
        return { ...stop, originalEtaMin: cumulativeMin };
      }),
    };
  });
}

export function makeScenario(input: ScenarioInput): Scenario {
  return {
    schemaVersion: 2,
    id: input.id,
    name: input.name,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    drivers: input.drivers,
    vehicles: input.vehicles ?? DEFAULT_FLEET,
    passengers: input.passengers,
    rides: stampRideEtas(input.drivers, input.rides ?? []),
    requests: input.requests,
    settings: {
      ...DEFAULT_SETTINGS,
      ...input.settings,
      weights: { ...DEFAULT_SETTINGS.weights, ...input.settings?.weights },
      stageOrder: [...(input.settings?.stageOrder ?? DEFAULT_SETTINGS.stageOrder)],
    },
  };
}

/** Links a driver to a ride from both sides so lookups never dangle. */
export function attachRide(drivers: Driver[], rides: Ride[]): Driver[] {
  const rideByDriver = new Map(rides.map((ride) => [ride.driverId, ride.id]));

  return drivers.map((driver) => {
    const rideId = rideByDriver.get(driver.id);
    return rideId ? { ...driver, currentRideId: rideId } : driver;
  });
}
