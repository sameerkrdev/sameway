import { Crosshair, Info } from "lucide-react";

import { Metric, StatusGlyph } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import type { Driver, Scenario } from "@/domain/entities";
import { formatKm, formatMinutes, formatPercent, formatScore } from "@/lib/format";
import type { DriverEvaluation, ScoreBreakdown } from "@/matching/types";
import { cn } from "@/lib/utils";

export function DriverMatchCard({
  evaluation,
  driver,
  scenario,
  selected,
  onSelect,
  onShowOnMap,
  onOpenDetails,
}: {
  evaluation: DriverEvaluation;
  driver: Driver | undefined;
  scenario: Scenario;
  selected: boolean;
  onSelect: () => void;
  onShowOnMap: () => void;
  onOpenDetails: () => void;
}) {
  const vehicle = scenario.vehicles.find((entry) => entry.id === driver?.vehicleId);
  const { metrics } = evaluation;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-md border p-2 text-left transition-colors",
        selected
          ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_10%,transparent)]"
          : "border-[var(--border)] hover:bg-[var(--accent)]",
      )}
    >
      <div className="flex items-center gap-2">
        {evaluation.rank !== undefined ? (
          <Badge variant="outline">#{evaluation.rank}</Badge>
        ) : (
          <StatusGlyph status={evaluation.finalStatus} />
        )}
        <span className="text-sm font-semibold">{evaluation.driverId}</span>
        <span className="truncate text-xs text-[var(--muted-foreground)]">{driver?.name}</span>
        <span className="tabular ml-auto text-sm font-semibold">
          {formatScore(evaluation.finalScore)}
        </span>
      </div>

      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
        {vehicle ? `${vehicle.label} · ${vehicle.totalSeats} seats` : "Unknown vehicle"}
      </p>

      <div className="mt-1.5">
        <Metric label="Pickup ETA" value={formatMinutes(metrics.roadEtaMin)} />
        <Metric label="Road distance" value={formatKm(metrics.roadDistanceKm)} />
        <Metric label="Free seats" value={String(metrics.availableSeats ?? "—")} />
        <Metric label="Detour" value={formatPercent(metrics.detourPercent)} />
        <Metric
          label="Worst rider delay"
          value={formatMinutes(metrics.maximumExistingPassengerDelayMin)}
        />
        <Metric
          label="H3 ring"
          value={String(metrics.discoveredRing ?? "—")}
          hint="Grid hops from the pickup cell — not a distance"
        />
      </div>

      {evaluation.scoreBreakdown ? (
        <ScoreContributions breakdown={evaluation.scoreBreakdown} />
      ) : null}

      <div className="mt-2 flex gap-1.5">
        <Button
          size="xs"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetails();
          }}
        >
          <Info /> Details
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            onShowOnMap();
          }}
        >
          <Crosshair /> Show on map
        </Button>
      </div>
    </button>
  );
}

/**
 * Per-component contributions.
 *
 * Because each component is normalised to 0-100 and the weights sum to one,
 * these bars really do add up to the final score — the breakdown is arithmetic
 * rather than decoration.
 */
export function ScoreContributions({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {breakdown.components
        .filter((component) => component.weight > 0)
        .map((component) => (
          <div key={component.key}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--muted-foreground)]">
                {component.label}
                {component.experimental ? " (experimental)" : ""}
              </span>
              <span className="tabular">
                {component.normalized.toFixed(0)} × {(component.weight * 100).toFixed(0)}% ={" "}
                {component.contribution.toFixed(1)}
              </span>
            </div>
            <Progress value={component.contribution} />
          </div>
        ))}
    </div>
  );
}
