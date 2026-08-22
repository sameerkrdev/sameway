import type { Driver, LatLng, Passenger, Ride, Scenario, Stop, Vehicle } from "@/domain/entities";
import { offsetBy } from "@/lib/geo";
import { createRng, type Rng } from "@/lib/rng";

import { DEFAULT_FLEET, DELHI_PLACES, makeRequest, makeScenario } from "./builders";

export interface VehicleShare {
  vehicleId: string;
  weight: number;
}

export interface GeneratorParams {
  seed: number;
  driverCount: number;
  passengerCount: number;
  rideCount: number;
  center: LatLng;
  areaRadiusKm: number;
  onlinePercent: number;
  poolingPercent: number;
  vehicleDistribution: VehicleShare[];
  vehicles?: Vehicle[];
}

export const DEFAULT_GENERATOR_PARAMS: GeneratorParams = {
  seed: 12345,
  driverCount: 60,
  passengerCount: 40,
  rideCount: 18,
  center: DELHI_PLACES.connaughtPlace,
  areaRadiusKm: 6,
  onlinePercent: 80,
  poolingPercent: 70,
  vehicleDistribution: [
    { vehicleId: "V_CAB4", weight: 40 },
    { vehicleId: "V_AUTO3", weight: 30 },
    { vehicleId: "V_ERICK", weight: 20 },
    { vehicleId: "V_CAB6", weight: 10 },
  ],
};

/**
 * Builds a scenario from a seed.
 *
 * Everything random here comes from the seeded generator and ids come from
 * counters, never `Math.random()`. Re-running with the same seed reproduces
 * the scenario byte for byte, which is what makes a stress-test failure
 * something you can actually debug.
 */
export function generateScenario(overrides: Partial<GeneratorParams> = {}): Scenario {
  const params: GeneratorParams = { ...DEFAULT_GENERATOR_PARAMS, ...overrides };
  const rng = createRng(params.seed);
  const vehicles = params.vehicles ?? DEFAULT_FLEET;
  const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
  const distribution = params.vehicleDistribution.filter((share) =>
    vehicleIds.has(share.vehicleId),
  );

  const fallback = vehicles[0];
  if (!fallback) {
    throw new Error("generateScenario requires at least one vehicle");
  }

  const drivers: Driver[] = [];
  for (let index = 0; index < params.driverCount; index += 1) {
    const id = `D${String(index + 1).padStart(3, "0")}`;
    drivers.push({
      id,
      name: `Driver ${index + 1}`,
      status: rng.next() * 100 < params.onlinePercent ? "ONLINE" : pickOfflineStatus(rng),
      location: scatter(rng, params.center, params.areaRadiusKm),
      vehicleId:
        distribution.length > 0
          ? rng.weightedPick(
              distribution.map((share) => ({ value: share.vehicleId, weight: share.weight })),
            )
          : fallback.id,
      currentRideId: null,
      history: {
        ridesCompletedToday: rng.int(0, 12),
        lastAssignmentAt: null,
        idleMinutes: rng.int(0, 90),
      },
    });
  }

  const passengers: Passenger[] = [];
  for (let index = 0; index < params.passengerCount; index += 1) {
    passengers.push({
      id: `P${String(index + 1).padStart(3, "0")}`,
      name: `Passenger ${index + 1}`,
      seatsRequired: rng.weightedPick([
        { value: 1, weight: 70 },
        { value: 2, weight: 25 },
        { value: 3, weight: 5 },
      ]),
      state: "WAITING",
      specialRequirements: [],
      allowsPooling: rng.next() * 100 < params.poolingPercent,
    });
  }

  const { rides, updatedDrivers, updatedPassengers } = assignRides({
    rng,
    params,
    drivers,
    passengers,
    vehicles,
  });

  const requestPassenger: Passenger = {
    id: "P_REQUEST",
    name: "New Rider",
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
  };

  return makeScenario({
    id: `sc_seed_${params.seed}`,
    name: `Generated scenario (seed ${params.seed})`,
    seed: params.seed,
    drivers: updatedDrivers,
    vehicles,
    passengers: [...updatedPassengers, requestPassenger],
    rides,
    requests: [
      makeRequest({
        id: "R_GEN",
        passengerId: requestPassenger.id,
        pickup: params.center,
        drop: DELHI_PLACES.noida62,
      }),
    ],
  });
}

function pickOfflineStatus(rng: Rng): Driver["status"] {
  return rng.weightedPick([
    { value: "OFFLINE" as const, weight: 50 },
    { value: "BUSY" as const, weight: 30 },
    { value: "PAUSED" as const, weight: 20 },
  ]);
}

function scatter(rng: Rng, center: LatLng, radiusKm: number): LatLng {
  // Square-rooting the radius keeps points uniform over the disc instead of
  // clustering them around the centre.
  const distance = Math.sqrt(rng.next()) * radiusKm;
  return offsetBy(center, distance, rng.float(0, 360));
}

function assignRides(args: {
  rng: Rng;
  params: GeneratorParams;
  drivers: Driver[];
  passengers: Passenger[];
  vehicles: Vehicle[];
}): { rides: Ride[]; updatedDrivers: Driver[]; updatedPassengers: Passenger[] } {
  const { rng, params, drivers, passengers, vehicles } = args;
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  const rides: Ride[] = [];
  const driverById = new Map(drivers.map((driver) => [driver.id, { ...driver }]));
  const passengerById = new Map(passengers.map((passenger) => [passenger.id, { ...passenger }]));

  const onlineDrivers = drivers.filter((driver) => driver.status === "ONLINE");
  const shuffledDrivers = rng.shuffle(onlineDrivers);
  const availablePassengers = rng.shuffle(passengers);

  let passengerCursor = 0;

  for (let index = 0; index < Math.min(params.rideCount, shuffledDrivers.length); index += 1) {
    const driver = shuffledDrivers[index];
    if (!driver) {
      continue;
    }

    const vehicle = vehiclesById.get(driver.vehicleId);
    if (!vehicle) {
      continue;
    }

    const rideId = `R${String(index + 1).padStart(3, "0")}`;
    const riderCount = rng.int(1, Math.max(1, Math.min(3, vehicle.totalSeats - 1)));
    const stops: Stop[] = [];
    const passengerIds: string[] = [];
    let seatsUsed = 0;

    for (let rider = 0; rider < riderCount; rider += 1) {
      const candidate = availablePassengers[passengerCursor];
      passengerCursor += 1;

      if (!candidate) {
        break;
      }

      const stored = passengerById.get(candidate.id);
      if (!stored || seatsUsed + stored.seatsRequired > vehicle.totalSeats) {
        continue;
      }

      seatsUsed += stored.seatsRequired;
      passengerIds.push(stored.id);

      // Roughly a third of riders are already aboard, so their pickup is
      // history and only the drop remains.
      const alreadyAboard = rng.next() < 0.34;
      stored.state = alreadyAboard ? "IN_RIDE" : "WAITING";
      passengerById.set(stored.id, stored);

      if (!alreadyAboard) {
        stops.push({
          id: `${rideId}_P${rider}`,
          rideId,
          passengerId: stored.id,
          type: "PICKUP",
          location: scatter(rng, driver.location, params.areaRadiusKm / 2),
          sequence: 0,
        });
      }

      stops.push({
        id: `${rideId}_D${rider}`,
        rideId,
        passengerId: stored.id,
        type: "DROP",
        location: scatter(rng, params.center, params.areaRadiusKm),
        sequence: 0,
      });
    }

    if (passengerIds.length === 0) {
      continue;
    }

    // Pickups before drops, then renumber so `sequence` always matches order.
    stops.sort((a, b) => (a.type === b.type ? 0 : a.type === "PICKUP" ? -1 : 1));
    stops.forEach((stop, stopIndex) => {
      stop.sequence = stopIndex;
    });

    rides.push({ id: rideId, driverId: driver.id, passengerIds, stops });

    const stored = driverById.get(driver.id);
    if (stored) {
      driverById.set(driver.id, { ...stored, currentRideId: rideId });
    }
  }

  return {
    rides,
    updatedDrivers: [...driverById.values()],
    updatedPassengers: [...passengerById.values()],
  };
}
