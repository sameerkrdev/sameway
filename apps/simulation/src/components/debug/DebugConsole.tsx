import { TriangleAlert } from "lucide-react";

import { Metric } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/misc";
import { formatMs } from "@/lib/format";
import { STAGE_METADATA } from "@/matching/pipeline";
import type { MatchingRun } from "@/matching/types";

/**
 * What the run actually cost.
 *
 * Calls and matrix elements are counted separately because they are billed
 * separately, and the remaining budget is shown so it is obvious when the cap
 * — rather than the algorithm — ended the search.
 */
export function DebugConsole({ run }: { run: MatchingRun }) {
  const { telemetry, optimizerTelemetry } = run.result;

  const h3Notes = run.result.stageResults.find(
    (stage) => stage.stageId === "h3RouteCorridor",
  )?.notes;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <section>
        <h4 className="text-[11px] font-semibold tracking-wide uppercase">Routing</h4>
        <div className="mt-1">
          <Metric label="Engine" value={telemetry.engine} />
          <Metric label="Route calls" value={String(telemetry.routeCalls)} />
          <Metric label="Matrix calls" value={String(telemetry.matrixCalls)} />
          <Metric label="Matrix elements" value={String(telemetry.matrixElements)} />
          <Metric label="Cache hits" value={String(telemetry.cacheHits)} />
          <Metric label="Cache misses" value={String(telemetry.cacheMisses)} />
          <Metric
            label="Budget"
            value={`${telemetry.budgetUsed} / ${telemetry.budgetLimit}`}
          />
        </div>
        {telemetry.fallbackReason ? (
          <p className="mt-1 flex items-start gap-1 text-[11px] text-[var(--warn)]">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {telemetry.fallbackReason}
          </p>
        ) : null}
      </section>

      <section>
        <h4 className="text-[11px] font-semibold tracking-wide uppercase">Optimizer</h4>
        <div className="mt-1">
          <Metric label="Engine" value={optimizerTelemetry.engine} />
          <Metric label="Solver calls" value={String(optimizerTelemetry.calls)} />
          <Metric
            label="Shipments billed"
            value={String(optimizerTelemetry.shipmentsBilled)}
            hint="OptimizeTours prices per shipment, so this is the number that costs money"
          />
          <Metric label="Cache hits" value={String(optimizerTelemetry.cacheHits)} />
          <Metric label="Cache misses" value={String(optimizerTelemetry.cacheMisses)} />
          <Metric
            label="Budget"
            value={`${optimizerTelemetry.budgetUsed} / ${optimizerTelemetry.budgetLimit}`}
          />
        </div>
        {optimizerTelemetry.unavailableReason ? (
          <p className="mt-1 flex items-start gap-1 text-[11px] text-[var(--warn)]">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {optimizerTelemetry.unavailableReason}
          </p>
        ) : null}
      </section>

      <section>
        <h4 className="text-[11px] font-semibold tracking-wide uppercase">Stage timings</h4>
        <div className="mt-1">
          {run.result.stageResults.map((stage) => (
            <Metric
              key={stage.stageId}
              label={STAGE_METADATA[stage.stageId].name}
              value={formatMs(stage.durationMs)}
            />
          ))}
          <Separator className="my-1" />
          <Metric label="Total" value={formatMs(run.result.durationMs)} />
        </div>
      </section>

      <section>
        <h4 className="text-[11px] font-semibold tracking-wide uppercase">Search</h4>
        <div className="mt-1">
          <Metric label="H3 resolution" value={String(run.settingsSnapshot.h3Resolution)} />
          <Metric label="Stopped at ring" value={String(h3Notes?.stoppedAtRing ?? "—")} />
          <Metric
            label="Search exhausted"
            value={h3Notes?.searchExhausted ? "yes" : "no"}
            hint="True when the ring limit was reached before enough usable candidates were found"
          />
          <Separator className="my-1" />
          <Metric label="Candidates" value={String(run.result.summary.candidates)} />
          <Metric label="Matched" value={String(run.result.summary.passed)} />
          <Metric label="Rejected" value={String(run.result.summary.rejected)} />
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="outline">run {run.id}</Badge>
          <Badge variant="outline">{new Date(run.createdAt).toLocaleTimeString()}</Badge>
        </div>
      </section>
    </div>
  );
}
