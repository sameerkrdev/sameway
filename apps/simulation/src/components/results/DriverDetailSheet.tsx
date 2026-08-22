import { Metric, StatusBadge } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, Separator } from "@/components/ui/misc";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatKm, formatMinutes, formatPercent, formatScore, shortCell } from "@/lib/format";
import { STAGE_METADATA } from "@/matching/pipeline";
import type { DriverEvaluation, MatchingRun } from "@/matching/types";

import { ScoreContributions } from "./DriverMatchCard";

/**
 * The full audit trail for one driver.
 *
 * Answers, in order: which stages ran, what each decided, which value was
 * measured, what threshold it was measured against, and what the route
 * insertion actually tried.
 */
export function DriverDetailSheet({
  run,
  evaluation,
  open,
  onOpenChange,
}: {
  run: MatchingRun;
  evaluation: DriverEvaluation | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!evaluation) {
    return null;
  }

  const driver = run.scenarioSnapshot.drivers.find((entry) => entry.id === evaluation.driverId);
  const insertion = evaluation.insertion;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {evaluation.driverId}
            <StatusBadge status={evaluation.finalStatus} />
            {evaluation.rank !== undefined ? (
              <Badge variant="outline">Rank #{evaluation.rank}</Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            {driver?.name} · {driver?.status}
            {evaluation.failedAtStageId
              ? ` · stopped at ${STAGE_METADATA[evaluation.failedAtStageId].name}`
              : ""}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="-mr-2 flex-1 pr-2">
          <section>
            <h4 className="text-[11px] font-semibold tracking-wide uppercase">Stage by stage</h4>
            <ol className="mt-1 flex flex-col gap-1.5">
              {evaluation.stageResults.map((stageResult, index) => {
                const meta = run.result.stageResults[index];
                const stageId = meta?.stageId;

                return (
                  <li
                    key={`${stageId ?? index}`}
                    className="rounded-md border border-[var(--border)] p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">
                        {index}. {stageId ? STAGE_METADATA[stageId].name : "Stage"}
                      </span>
                      <StatusBadge status={stageResult.status} />
                    </div>

                    {stageResult.reasons.map((reason) => (
                      <div key={`${reason.code}-${reason.message}`} className="mt-1">
                        <p className="text-[11px]">{reason.message}</p>
                        {reason.value !== undefined || reason.threshold !== undefined ? (
                          <p className="tabular text-[11px] text-[var(--muted-foreground)]">
                            {reason.value !== undefined ? `value ${reason.value}` : ""}
                            {reason.value !== undefined && reason.threshold !== undefined
                              ? " · "
                              : ""}
                            {reason.threshold !== undefined ? `threshold ${reason.threshold}` : ""}
                          </p>
                        ) : null}
                        <Badge variant="outline" className="mt-1 font-mono">
                          {reason.code}
                        </Badge>
                      </div>
                    ))}

                    {stageResult.status === "NOT_EVALUATED" && stageResult.reasons.length === 0 ? (
                      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                        Skipped — this driver had already been rejected.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>

          <Separator className="my-3" />

          <section>
            <h4 className="text-[11px] font-semibold tracking-wide uppercase">Measurements</h4>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              Grid hops, straight-line distance, road distance and travel time are four different
              things and are never substituted for one another.
            </p>
            <div className="mt-1">
              <Metric label="Pickup H3 cell" value={shortCell(evaluation.metrics.pickupCell)} />
              <Metric label="Driver H3 cell" value={shortCell(evaluation.metrics.driverCell)} />
              <Metric
                label="H3 grid distance"
                value={String(evaluation.metrics.h3GridDistance ?? "—")}
                hint="Unitless hop count"
              />
              <Metric
                label="Straight-line"
                value={formatKm(evaluation.metrics.straightLineKm)}
              />
              <Metric label="Road distance" value={formatKm(evaluation.metrics.roadDistanceKm)} />
              <Metric label="Road ETA" value={formatMinutes(evaluation.metrics.roadEtaMin)} />
              <Separator className="my-1" />
              <Metric
                label="Seats total / free"
                value={`${evaluation.metrics.totalSeats ?? "—"} / ${evaluation.metrics.availableSeats ?? "—"}`}
              />
              <Metric label="Peak occupancy" value={String(evaluation.metrics.peakOccupancy ?? "—")} />
              <Separator className="my-1" />
              <Metric
                label="Route before"
                value={formatKm(evaluation.metrics.originalDistanceKm)}
              />
              <Metric label="Route after" value={formatKm(evaluation.metrics.newDistanceKm)} />
              <Metric label="Detour" value={formatPercent(evaluation.metrics.detourPercent)} />
              <Metric
                label="Added duration"
                value={formatMinutes(evaluation.metrics.additionalDurationMin)}
              />
              <Metric
                label="New rider pickup delay"
                value={formatMinutes(evaluation.metrics.newPassengerPickupDelayMin)}
              />
              <Metric
                label="Worst existing rider delay"
                value={formatMinutes(evaluation.metrics.maximumExistingPassengerDelayMin)}
              />
            </div>
          </section>

          {evaluation.scoreBreakdown ? (
            <>
              <Separator className="my-3" />
              <section>
                <h4 className="text-[11px] font-semibold tracking-wide uppercase">
                  Score {formatScore(evaluation.finalScore)}
                </h4>
                <ScoreContributions breakdown={evaluation.scoreBreakdown} />
              </section>
            </>
          ) : null}

          {insertion ? (
            <>
              <Separator className="my-3" />
              <section>
                <h4 className="text-[11px] font-semibold tracking-wide uppercase">
                  Insertion search
                </h4>
                <div className="mt-1">
                  <Metric
                    label="Positions enumerated"
                    value={String(insertion.attemptStats.enumerated)}
                  />
                  <Metric
                    label="Dropped on capacity"
                    value={String(insertion.attemptStats.occupancyPruned)}
                  />
                  <Metric
                    label="Dropped geographically"
                    value={String(insertion.attemptStats.geographicallyPruned)}
                  />
                  <Metric label="Actually routed" value={String(insertion.attemptStats.routed)} />
                  <Metric label="Feasible" value={String(insertion.attemptStats.feasible)} />
                  {insertion.pickupIndex !== undefined ? (
                    <Metric
                      label="Best slot"
                      value={`pickup ${insertion.pickupIndex}, drop ${insertion.dropIndex}`}
                    />
                  ) : null}
                </div>

                {insertion.occupancyBySegment && insertion.occupancyBySegment.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      Occupancy along the proposed route
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {insertion.occupancyBySegment.map((segment) => (
                        <Badge key={segment.stopId} variant="outline" className="font-mono">
                          {segment.stopType === "PICKUP" ? "+" : "−"}
                          {segment.passengerId}: {segment.occupancy}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {insertion.existingPassengerDelays &&
                insertion.existingPassengerDelays.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      Existing rider arrival times
                    </p>
                    {insertion.existingPassengerDelays.map((delay) => (
                      <Metric
                        key={delay.stopId}
                        label={delay.passengerId}
                        value={`${formatMinutes(delay.arrivalBeforeMin)} → ${formatMinutes(delay.arrivalAfterMin)}`}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
