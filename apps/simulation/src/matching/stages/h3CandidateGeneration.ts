import { ANY_VEHICLE, type Driver } from "@/domain/entities";
import { haversineKm } from "@/lib/geo";
import { getCellsByRing, getH3CellFor, indexByCell } from "@/lib/h3";

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

/**
 * Stage 1. Discovers candidates by expanding H3 rings around the pickup cell.
 *
 * H3 is used here for spatial lookup only. The ring index and grid distance it
 * produces are unitless hop counts recorded for explainability; they are never
 * compared against a distance or ETA threshold anywhere in the pipeline.
 */
export const h3CandidateGenerationStage: MatchingStage = {
  id: "h3CandidateGeneration",
  name: "H3 Candidate Generation",
  description: "Expands rings around the pickup cell until enough usable candidates are found.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { scenario, request, settings } = context;
    const resolution = settings.h3Resolution;

    const pickupCell = getH3CellFor(request.pickup, resolution);
    const driversByCell = indexByCell(scenario.drivers, (driver) => driver.location, resolution);
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
        const drivers = driversByCell.get(cell);
        if (!drivers) {
          continue;
        }

        for (const driver of drivers) {
          // Dedup by driver id so a driver is attributed to the lowest ring
          // that reached them, and never counted twice.
          if (discovered.has(driver.id)) {
            continue;
          }
          discovered.add(driver.id);
          ringDiscovered += 1;

          if (isUsableCandidate(driver, context)) {
            ringUsable += 1;
          }

          verdicts.push({
            driverId: driver.id,
            status: "PASSED",
            reasons: [
              reason("H3_CANDIDATE_FOUND", `Driver found in H3 ring ${ring}`, {
                value: ring,
                threshold: settings.maxH3Ring,
              }),
            ],
          });

          context.recordMetrics(driver.id, {
            driverCell: cell,
            pickupCell,
            // Ring index is the grid distance by construction; both are hop
            // counts, never kilometres.
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

      // The threshold counts drivers that could plausibly serve the request,
      // not raw discoveries. Ten offline drivers in ring 0 must not end the
      // search while a usable driver waits in ring 1.
      if (cumulativeUsable >= settings.minimumUsableCandidates) {
        break;
      }
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
 * The cheap in-loop filters that decide whether ring expansion should stop.
 *
 * These are intentionally the same predicates stages 2-4 apply, but applied
 * here only as a counting heuristic. Drivers failing them are still returned
 * as candidates so that the later stages can reject them with a precise,
 * attributable reason instead of them silently vanishing at stage 1.
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
