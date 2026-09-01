import type { MatchingSettings, StopType } from "@/domain/entities";

export interface SoloEtaStop {
  passengerId: string;
  type: StopType;
  originalEtaMin: number;
}

/**
 * Solo trip duration for the leg this delay budget protects.
 *
 * - DROP: pickup → drop when both exist; otherwise the remaining leg ETA from
 *   when the promise was made (onboard passengers).
 * - PICKUP: pickup → drop when the drop is still ahead on the route.
 */
export function soloEtaMinForStop(
  stop: SoloEtaStop,
  rideStops: readonly SoloEtaStop[],
): number {
  if (stop.type === "DROP") {
    const pickup = rideStops.find(
      (candidate) => candidate.passengerId === stop.passengerId && candidate.type === "PICKUP",
    );
    if (pickup) {
      return Math.max(0, stop.originalEtaMin - pickup.originalEtaMin);
    }
    return Math.max(0, stop.originalEtaMin);
  }

  const drop = rideStops.find(
    (candidate) => candidate.passengerId === stop.passengerId && candidate.type === "DROP",
  );
  if (drop) {
    return Math.max(0, drop.originalEtaMin - stop.originalEtaMin);
  }

  return Math.max(0, stop.originalEtaMin);
}

/** Short solo trips use a more generous default tolerance. */
export function resolveDelayPercent(
  soloEtaMin: number,
  configuredPercent: number,
  settings: Pick<MatchingSettings, "shortTripSoloEtaMaxMin" | "shortTripDelayPercent">,
): number {
  if (soloEtaMin <= settings.shortTripSoloEtaMaxMin) {
    return settings.shortTripDelayPercent;
  }
  return configuredPercent;
}

export function delayBudgetMinFromPercent(
  soloEtaMin: number,
  configuredPercent: number,
  settings: Pick<MatchingSettings, "shortTripSoloEtaMaxMin" | "shortTripDelayPercent">,
): number {
  const percent = resolveDelayPercent(soloEtaMin, configuredPercent, settings);
  return soloEtaMin * (percent / 100);
}
