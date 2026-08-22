import type { Driver, LatLng, Passenger, Ride } from "@/domain/entities";
import { cellsForPath, getH3CellFor, gridDiskCells, type H3Index } from "@/lib/h3";

import { toProposedStops } from "./stops";
import type { ProposedStop } from "./types";

/**
 * A driver's remaining route, and the H3 cells it plausibly serves.
 *
 * The corridor is built from the *remaining* route, never the whole trip. A
 * pickup sitting on a stretch the vehicle has already driven past is a reject,
 * however close it looks — that is the single most important property of this
 * module and the one `corridor.test.ts` pins hardest.
 */
export interface RideCorridor {
  driverId: string;
  rideId: string | null;
  /** Stops still to be served, in execution order. */
  remainingStops: ProposedStop[];
  /** Driver position followed by every remaining stop. */
  polyline: LatLng[];
  cells: Set<H3Index>;
  /** True when the driver has no committed route to match against. */
  isIdle: boolean;
}

export interface BuildCorridorsInput {
  drivers: readonly Driver[];
  rides: readonly Ride[];
  passengersById: ReadonlyMap<string, Passenger>;
  resolution: number;
  /** `gridDisk` expansion applied to every path cell. The Overview uses 1. */
  ringPadding: number;
}

/**
 * Builds one corridor per driver.
 *
 * An idle driver has no route, so their location is treated as a degenerate
 * single-point corridor. That keeps solo matching working without a second
 * code path, and makes "which drivers could serve this pickup" one lookup
 * rather than two.
 */
export function buildCorridors(input: BuildCorridorsInput): Map<string, RideCorridor> {
  const { drivers, rides, passengersById, resolution, ringPadding } = input;
  const ridesById = new Map(rides.map((ride) => [ride.id, ride]));
  const corridors = new Map<string, RideCorridor>();

  for (const driver of drivers) {
    const ride = driver.currentRideId ? ridesById.get(driver.currentRideId) : undefined;

    // `toProposedStops` already drops dropped/cancelled passengers and the
    // pickups of anyone already aboard, which is exactly "remaining".
    const remainingStops = ride
      ? toProposedStops(
          [...ride.stops].sort((a, b) => a.sequence - b.sequence),
          passengersById,
        )
      : [];

    const polyline = [driver.location, ...remainingStops.map((stop) => stop.location)];
    const cells = new Set<H3Index>();

    for (const cell of cellsForPath(polyline, resolution)) {
      for (const padded of gridDiskCells(cell, ringPadding)) {
        cells.add(padded);
      }
    }

    corridors.set(driver.id, {
      driverId: driver.id,
      rideId: ride?.id ?? null,
      remainingStops,
      polyline,
      cells,
      isIdle: remainingStops.length === 0,
    });
  }

  return corridors;
}

/** Inverts the corridor map into the `cell → driverIds` lookup stage 2 reads. */
export function indexCorridorsByCell(
  corridors: ReadonlyMap<string, RideCorridor>,
): Map<H3Index, string[]> {
  const index = new Map<H3Index, string[]>();

  for (const corridor of corridors.values()) {
    for (const cell of corridor.cells) {
      const existing = index.get(cell);
      if (existing) {
        existing.push(corridor.driverId);
      } else {
        index.set(cell, [corridor.driverId]);
      }
    }
  }

  return index;
}

/** Convenience for the single-point case, used by the idle-driver path. */
export function cellForPoint(point: LatLng, resolution: number): H3Index {
  return getH3CellFor(point, resolution);
}
