import { ANY_VEHICLE, type Driver, type Passenger } from "@/domain/entities";
import { haversineKm } from "@/lib/geo";
import { getCellsByRing, getH3CellFor, getH3Distance, type H3Index } from "@/lib/h3";

import { buildCorridors, indexCorridorsByCell } from "../corridor";
import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

interface RingNote {
  ring: number;
  cells: number;
  discovered: number;
  usable: number;
  cumulativeDiscovered: number;
  cumulativeUsable: number;
}

/** `gridDisk` padding applied to each corridor cell. The Overview uses one ring. */
const CORRIDOR_RING_PADDING = 1;

/**
 * Stage 2. Does the pickup fall near this ride's *remaining route*?
 *
 * This is the single biggest correction the project made across its
 * iterations. Driver-to-pickup distance is a bad proxy the moment a vehicle
 * has a route: a driver 8 km away can be an excellent match if their corridor
 * runs straight past the pickup, and a driver 200 m away is useless if that
 * 200 m is behind them. The corridor is therefore built from remaining stops
 * only, which is what makes the behind-the-vehicle case reject.
 */
export const h3RouteCorridorStage: MatchingStage = {
  id: "h3RouteCorridor",
  name: "H3 Route Corridor",
  description: "Matches the pickup against each ride's remaining-route corridor.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { scenario, request, settings } = context;
    const resolution = settings.h3Resolution;

    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const corridors = buildCorridors({
      drivers: scenario.drivers,
      rides: scenario.rides,
      passengersById,
      resolution,
      ringPadding: CORRIDOR_RING_PADDING,
    });

    for (const [driverId, corridor] of corridors) {
      context.setCorridor(driverId, corridor);
    }

    const cellIndex = indexCorridorsByCell(corridors);
    const pickupCell = getH3CellFor(request.pickup, resolution);
    const rings = getCellsByRing(pickupCell, settings.maxH3Ring);

    const discovered = new Set<string>();
    const verdicts: DriverVerdict[] = [];
    const ringNotes: RingNote[] = [];

    let cumulativeDiscovered = 0;
    let cumulativeUsable = 0;
    let stoppedAtRing = 0;

    for (let ring = 0; ring < rings.length; ring += 1) {
      const cells = rings[ring] ?? [];
      let ringDiscovered = 0;
      let ringUsable = 0;

      for (const cell of cells) {
        for (const driverId of cellIndex.get(cell) ?? []) {
          // Dedup by driver so each is attributed to the lowest ring that
          // reached them, and never counted twice.
          if (discovered.has(driverId)) {
            continue;
          }

          const driver = context.getDriver(driverId);
          if (!driver) {
            continue;
          }

          discovered.add(driverId);
          ringDiscovered += 1;

          if (isUsableCandidate(driver, context)) {
            ringUsable += 1;
          }

          verdicts.push({
            driverId,
            status: "PASSED",
            reasons: [
              reason(
                "CORRIDOR_MATCH",
                `Pickup falls on this ride's corridor at ring ${String(ring)}`,
                { value: ring, threshold: settings.maxH3Ring },
              ),
            ],
          });

          context.recordMetrics(driverId, {
            driverCell: getH3CellFor(driver.location, resolution),
            pickupCell,
            // Ring index is the grid distance by construction. Both are hop
            // counts. Neither is ever compared against a kilometre or a minute.
            h3GridDistance: ring,
            discoveredRing: ring,
            straightLineKm: haversineKm(driver.location, request.pickup),
          });
        }
      }

      cumulativeDiscovered += ringDiscovered;
      cumulativeUsable += ringUsable;
      stoppedAtRing = ring;

      ringNotes.push({
        ring,
        cells: cells.length,
        discovered: ringDiscovered,
        usable: ringUsable,
        cumulativeDiscovered,
        cumulativeUsable,
      });

      if (cumulativeUsable >= settings.minimumUsableCandidates) {
        break;
      }
    }

    // Everything the ring search never reached is rejected here, by name.
    // The engine has a generic `candidateDriverIds` fallback that would do
    // this, but it can only say "outside the H3 search area" — a statement
    // about the search, not about this ride. The accurate finding is that the
    // pickup is off this ride's corridor, so the stage owns its own rejection
    // and reports the hop count that made it one.
    for (const driverId of context.liveDriverIds) {
      if (discovered.has(driverId)) {
        continue;
      }

      const driver = context.getDriver(driverId);
      if (!driver) {
        continue;
      }

      const driverCell = getH3CellFor(driver.location, resolution);
      const gridDistance = hopsBetween(pickupCell, driverCell, settings.maxH3Ring);

      context.recordMetrics(driverId, {
        driverCell,
        pickupCell,
        h3GridDistance: gridDistance,
        straightLineKm: haversineKm(driver.location, request.pickup),
      });

      verdicts.push({
        driverId,
        status: "FAILED",
        reasons: [
          reason("CORRIDOR_NO_MATCH", "Pickup does not fall on this ride's remaining corridor", {
            value: gridDistance,
            threshold: settings.maxH3Ring,
          }),
        ],
      });
    }

    return Promise.resolve({
      verdicts,
      candidateDriverIds: [...discovered],
      notes: {
        pickupCell,
        h3Resolution: resolution,
        maxH3Ring: settings.maxH3Ring,
        minimumUsableCandidates: settings.minimumUsableCandidates,
        stoppedAtRing,
        searchExhausted: cumulativeUsable < settings.minimumUsableCandidates,
        rings: ringNotes,
      },
    });
  },
};

/**
 * Grid hops between two cells, as a value safe to report.
 *
 * `gridDistance` is exact but refuses to answer for cells far enough apart to
 * span an icosahedron face boundary. When it does, the only honest thing left
 * to say is "further than we searched", so this returns a lower bound of
 * `maxRing + 1` rather than inventing a precise-looking number. Either way the
 * result is a unitless hop count and is only ever compared against another
 * hop count.
 */
function hopsBetween(pickupCell: H3Index, driverCell: H3Index, maxRing: number): number {
  try {
    return getH3Distance(pickupCell, driverCell);
  } catch {
    return maxRing + 1;
  }
}

/**
 * The counting heuristic that decides when ring expansion may stop.
 *
 * Drivers failing these predicates are still returned as candidates, so a
 * later stage can reject them with a precise, attributable reason rather than
 * them vanishing silently here.
 */
function isUsableCandidate(driver: Driver, context: MatchingContext): boolean {
  if (driver.status !== "ONLINE") {
    return false;
  }

  const vehicle = context.getVehicleForDriver(driver.id);
  if (!vehicle) {
    return false;
  }

  if (
    context.request.vehiclePreference !== ANY_VEHICLE &&
    vehicle.label !== context.request.vehiclePreference
  ) {
    return false;
  }

  return vehicle.totalSeats >= context.request.seatsRequired;
}
