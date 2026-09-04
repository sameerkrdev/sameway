import type { LatLng, Ride, Scenario } from "@/domain/entities";

/** Driver location + remaining stops in sequence — waypoints for routing / map. */
export function rideToWaypoints(scenario: Scenario, ride: Ride): LatLng[] {
  const driver = scenario.drivers.find((entry) => entry.id === ride.driverId);
  const stops = [...ride.stops].sort((a, b) => a.sequence - b.sequence);
  const path = stops.map((stop) => stop.location);
  return driver ? [driver.location, ...path] : path;
}
