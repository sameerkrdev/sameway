import type { LatLng } from "@/domain/entities";
import { MAX_MATRIX_ELEMENTS } from "@/domain/settings";
import { RoutingBudgetExceededError, type MatrixElement } from "@/routing/types";

import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 5. Bulk road distance and ETA from every surviving driver to the pickup.
 *
 * This is one route-matrix call rather than one route call per driver: the
 * matrix carries up to 625 elements, so twenty-four candidates cost a single
 * request. Running it before route feasibility is the single largest cost
 * saving in the pipeline — a driver forty minutes away should never trigger
 * insertion enumeration.
 */
export const pickupEtaFilterStage: MatchingStage = {
  id: "pickupEtaFilter",
  name: "Pickup ETA",
  description: "One route-matrix call gives road distance and ETA for every surviving driver.",

  async execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, settings } = context;
    const driverIds = [...context.liveDriverIds];

    if (driverIds.length === 0) {
      return { verdicts: [] };
    }

    const origins: LatLng[] = [];
    const originDriverIds: string[] = [];

    for (const driverId of driverIds) {
      const driver = context.getDriver(driverId);
      if (driver) {
        origins.push(driver.location);
        originDriverIds.push(driverId);
      }
    }

    let elements: MatrixElement[];

    try {
      elements = await computeMatrixInChunks(context, origins, request.pickup);
    } catch (error) {
      if (error instanceof RoutingBudgetExceededError) {
        return {
          verdicts: driverIds.map((driverId) => ({
            driverId,
            status: "NOT_EVALUATED" as const,
            reasons: [
              reason(
                "ROUTING_BUDGET_EXCEEDED",
                "Routing call budget exhausted before pickup ETA could be computed",
                { threshold: settings.maxRoutingCallsPerRun },
              ),
            ],
          })),
          notes: { budgetExhausted: true },
        };
      }
      throw error;
    }

    const byOriginIndex = new Map(elements.map((element) => [element.originIndex, element]));
    const verdicts: DriverVerdict[] = [];

    for (let index = 0; index < originDriverIds.length; index += 1) {
      const driverId = originDriverIds[index];
      if (!driverId) {
        continue;
      }

      const element = byOriginIndex.get(index);

      if (!element || !element.reachable) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason("PICKUP_UNREACHABLE", "No drivable route from the driver to the pickup"),
          ],
        });
        continue;
      }

      const roadDistanceKm = element.distanceKm;
      const roadEtaMin = element.durationMin;

      context.recordMetrics(driverId, { roadDistanceKm, roadEtaMin });

      const metrics = {
        roadDistanceKm: round(roadDistanceKm, 3),
        roadEtaMin: round(roadEtaMin, 2),
      };

      if (roadEtaMin > settings.maxPickupEtaMin) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason("PICKUP_ETA_TOO_HIGH", "Driver ETA exceeds the maximum passenger wait time", {
              value: round(roadEtaMin, 2),
              threshold: settings.maxPickupEtaMin,
            }),
          ],
          metrics,
        });
        continue;
      }

      if (roadDistanceKm > settings.maxPickupRoadDistanceKm) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason("PICKUP_DISTANCE_TOO_HIGH", "Driver is further from the pickup than allowed", {
              value: round(roadDistanceKm, 2),
              threshold: settings.maxPickupRoadDistanceKm,
            }),
          ],
          metrics,
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("PICKUP_ETA_OK", "Driver can reach the pickup in time", {
            value: round(roadEtaMin, 2),
            threshold: settings.maxPickupEtaMin,
          }),
        ],
        metrics,
      });
    }

    return {
      verdicts,
      notes: {
        matrixOrigins: origins.length,
        matrixDestinations: 1,
        matrixElements: origins.length,
      },
    };
  },
};

/**
 * Splits oversized matrices. With one destination the element count equals the
 * origin count, so this only engages beyond 625 candidate drivers.
 */
async function computeMatrixInChunks(
  context: MatchingContext,
  origins: readonly LatLng[],
  destination: LatLng,
): Promise<MatrixElement[]> {
  const all: MatrixElement[] = [];

  for (let start = 0; start < origins.length; start += MAX_MATRIX_ELEMENTS) {
    const chunk = origins.slice(start, start + MAX_MATRIX_ELEMENTS);
    const result = await context.routing.getMatrix(chunk, [destination]);

    for (const element of result.elements) {
      all.push({ ...element, originIndex: element.originIndex + start });
    }
  }

  return all;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
