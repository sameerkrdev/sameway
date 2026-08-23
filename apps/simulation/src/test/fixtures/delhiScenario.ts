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
import { offsetBy } from "@/lib/geo";
import { mockLeg } from "@/routing/MockRoutingEngine";

export const CONNAUGHT_PLACE: LatLng = { lat: 28.6315, lng: 77.2167 };
export const NOIDA_SECTOR_62: LatLng = { lat: 28.628, lng: 77.3649 };

// Driver positions the committed rides are stamped against.
const D004_LOCATION: LatLng = offsetBy(CONNAUGHT_PLACE, 0.9, 180);
const D006_LOCATION: LatLng = offsetBy(CONNAUGHT_PLACE, 0.9, 270);
const D007_LOCATION: LatLng = offsetBy(CONNAUGHT_PLACE, 1.0, 315);

const CAB: Vehicle = {
  id: "V_CAB",
  label: "4-SEATER-CAB",
  totalSeats: 4,
  luggageCapacity: 3,
  poolingEnabled: true,
  wheelchairAccessible: false,
  airConditioned: true,
};

const RICKSHAW: Vehicle = {
  id: "V_RICK",
  label: "E-RICKSHAW",
  totalSeats: 3,
  luggageCapacity: 1,
  poolingEnabled: true,
  wheelchairAccessible: false,
  airConditioned: false,
};

function driver(
  id: string,
  distanceKm: number,
  bearing: number,
  overrides: Partial<Driver> = {},
): Driver {
  return {
    id,
    name: id,
    status: "ONLINE",
    location: offsetBy(CONNAUGHT_PLACE, distanceKm, bearing),
    vehicleId: CAB.id,
    currentRideId: null,
    history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 10 },
    ...overrides,
  };
}

function passenger(id: string, overrides: Partial<Passenger> = {}): Passenger {
  return {
    id,
    name: id,
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
    ...DEFAULT_PASSENGER_DELAY_BUDGETS,
    ...overrides,
  };
}

function stop(
  id: string,
  rideId: string,
  passengerId: string,
  type: Stop["type"],
  location: LatLng,
  sequence: number,
): Stop {
  return { id, rideId, passengerId, type, location, sequence, originalEtaMin: 0 };
}

/**
 * Stamps each stop with the ETA it would have been promised when the ride was
 * committed, walking the sequence from the driver through the same leg model
 * the routing engine and the stub solver use.
 *
 * Two things this must get right. `originalEtaMin` cannot be zero for every
 * stop — it is the promise stages 6, 9, 10 and 12 measure delay against, so a
 * stop 14 km out carrying "promised at minute 0" reads as thirty-five minutes
 * late before anything has been inserted. And it must be stamped with the same
 * road factor and speed curve those stages will measure against: a promise
 * made from raw straight-line distance is about a third too optimistic, so
 * every long committed route breaches its own delay budget the moment a solver
 * looks at it.
 */
function stampEtas(driverLocation: LatLng, stops: Stop[]): Stop[] {
  let cumulativeMin = 0;
  let previous = driverLocation;

  return stops.map((entry) => {
    cumulativeMin += mockLeg(previous, entry.location).durationMin;
    previous = entry.location;

    return { ...entry, originalEtaMin: cumulativeMin };
  });
}

/**
 * A hand-built Delhi scenario that deterministically exercises every rejection
 * path plus one clean pass, so the end-to-end test asserts real pipeline
 * behaviour rather than a happy path.
 *
 * Resolution 8 with a five-ring search is used deliberately: at resolution 9
 * the H3 search area is tighter than the six-minute ETA gate, so an ETA
 * rejection could never occur and that branch would go untested.
 */
export function buildDelhiScenario(): Scenario {
  const passengers: Passenger[] = [
    passenger("P_NEW"),
    // D004's vehicle is already full: two riders, two seats each, both aboard.
    passenger("P_FULL_A", { seatsRequired: 2, state: "IN_RIDE" }),
    passenger("P_FULL_B", { seatsRequired: 2, state: "IN_RIDE" }),
    // D006 is committed to a trip heading the opposite way.
    passenger("P_WEST"),
    // D007's existing rider refuses to share.
    passenger("P_SOLO", { allowsPooling: false }),
  ];

  const fullRide: Ride = {
    id: "R_FULL",
    driverId: "D004",
    passengerIds: ["P_FULL_A", "P_FULL_B"],
    stops: stampEtas(D004_LOCATION, [
      stop("S_FULL_A_DROP", "R_FULL", "P_FULL_A", "DROP", offsetBy(CONNAUGHT_PLACE, 3, 60), 0),
      stop("S_FULL_B_DROP", "R_FULL", "P_FULL_B", "DROP", offsetBy(CONNAUGHT_PLACE, 5, 60), 1),
    ]),
  };

  const westRide: Ride = {
    id: "R_WEST",
    driverId: "D006",
    passengerIds: ["P_WEST"],
    stops: stampEtas(D006_LOCATION, [
      stop("S_WEST_PICKUP", "R_WEST", "P_WEST", "PICKUP", offsetBy(CONNAUGHT_PLACE, 1.5, 270), 0),
      stop("S_WEST_DROP", "R_WEST", "P_WEST", "DROP", offsetBy(CONNAUGHT_PLACE, 3, 270), 1),
    ]),
  };

  const soloRide: Ride = {
    id: "R_SOLO",
    driverId: "D007",
    passengerIds: ["P_SOLO"],
    stops: stampEtas(D007_LOCATION, [
      stop("S_SOLO_PICKUP", "R_SOLO", "P_SOLO", "PICKUP", offsetBy(CONNAUGHT_PLACE, 0.4, 90), 0),
      stop("S_SOLO_DROP", "R_SOLO", "P_SOLO", "DROP", offsetBy(CONNAUGHT_PLACE, 14, 90), 1),
    ]),
  };

  const drivers: Driver[] = [
    driver("D001", 0.8, 45),
    driver("D002", 0.6, 90, { status: "OFFLINE" }),
    driver("D003", 0.7, 135, { vehicleId: RICKSHAW.id }),
    driver("D004", 0.9, 180, { currentRideId: fullRide.id }),
    driver("D005", 2.5, 225),
    driver("D006", 0.9, 270, { currentRideId: westRide.id }),
    driver("D007", 1.0, 315, { currentRideId: soloRide.id }),
    driver("D008", 10, 0),
  ];

  const request: RideRequest = {
    id: "R100",
    passengerId: "P_NEW",
    seatsRequired: 1,
    pickup: CONNAUGHT_PLACE,
    drop: NOIDA_SECTOR_62,
    pickupAddress: "Connaught Place",
    dropAddress: "Noida Sector 62",
    intermediateStops: [],
    poolingAllowed: true,
    vehiclePreference: CAB.label,
    requiresWheelchairAccess: false,
    luggageCount: 0,
    maxWaitMinutes: 6,
    maxDetourPercent: 15,
    maxWalkingDistanceM: 300,
    priority: 0,
  };

  const settings: MatchingSettings = {
    ...DEFAULT_SETTINGS,
    h3Resolution: 8,
    maxH3Ring: 5,
    routingMode: "MOCK",
    weights: { ...DEFAULT_SETTINGS.weights },
    stageOrder: [...DEFAULT_SETTINGS.stageOrder],
  };

  return {
    schemaVersion: 2,
    id: "SC_DELHI",
    name: "Delhi NCR Morning Pool",
    drivers,
    vehicles: [CAB, RICKSHAW],
    passengers,
    rides: [fullRide, westRide, soloRide],
    requests: [request],
    settings,
  };
}

export function delhiRequest(scenario: Scenario): RideRequest {
  const request = scenario.requests[0];
  if (!request) {
    throw new Error("Delhi fixture is missing its request");
  }
  return request;
}
