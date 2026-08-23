import type React from "react";

import { StatusGlyph } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/misc";
import { STAGE_METADATA } from "@/matching/pipeline";
import type { StageResult } from "@/matching/types";

/** Per-driver detail for one stage, used to inspect a step in the funnel. */
export function StageDetails({
  stage,
  onSelectDriver,
}: {
  stage: StageResult;
  onSelectDriver: (driverId: string) => void;
}) {
  const meta = STAGE_METADATA[stage.stageId];
  const judged = stage.driverResults.filter((result) => result.status !== "NOT_EVALUATED");
  const rejected = judged.filter((result) => result.status === "FAILED");

  return (
    <div className="flex h-full flex-col gap-2">
      <div>
        <h4 className="text-xs font-semibold">{meta.name}</h4>
        <p className="text-[11px] text-[var(--muted-foreground)]">{meta.description}</p>
        <div className="mt-1 flex gap-1">
          <Badge variant="outline">in {stage.inputCount}</Badge>
          <Badge variant="pass">passed {stage.outputCount}</Badge>
          <Badge variant="fail">rejected {stage.rejectedCount}</Badge>
        </div>
      </div>

      <StageNotes stage={stage} />

      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 pr-2">
          {(rejected.length > 0 ? rejected : judged).map((result) => (
            <li key={result.driverId}>
              <button
                type="button"
                className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left hover:bg-[var(--accent)]"
                onClick={() => onSelectDriver(result.driverId)}
              >
                <span className="mt-0.5">
                  <StatusGlyph status={result.status} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-medium">{result.driverId}</span>
                  {result.reasons.map((reason) => (
                    <span
                      key={reason.code}
                      className="block text-[11px] text-[var(--muted-foreground)]"
                    >
                      {reason.message}
                      {reason.value !== undefined && reason.threshold !== undefined ? (
                        <span className="tabular">
                          {" "}
                          ({reason.value} / max {reason.threshold})
                        </span>
                      ) : null}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

interface StopBudgetNote {
  stopId: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  originalEtaMin: number;
  budgetMin: number;
}

interface PlanNote {
  stops: { id: string; passengerId: string; type: "PICKUP" | "DROP"; originalEtaMin: number }[];
}

/**
 * The two note shapes worth rendering as data rather than as a blob.
 *
 * Stage 1's budgets and stage 12's re-stamped plan are the two places where
 * "what did the pipeline decide" is a table of numbers per stop. Everything
 * else a stage records is already visible in its per-driver reasons.
 */
function StageNotes({ stage }: { stage: StageResult }) {
  const budgets = stage.notes?.budgetsByDriver as Record<string, StopBudgetNote[]> | undefined;
  const plans = stage.notes?.plansByDriver as Record<string, PlanNote> | undefined;

  if (budgets) {
    const rows = Object.entries(budgets).filter(([, entries]) => entries.length > 0);

    if (rows.length === 0) {
      return null;
    }

    return (
      <NoteBlock title="Delay budgets">
        {rows.map(([driverId, entries]) => (
          <div key={driverId}>
            <span className="text-[11px] font-medium">{driverId}</span>
            {entries.map((entry) => (
              <div key={entry.stopId} className="tabular text-[10px] text-[var(--muted-foreground)]">
                {entry.passengerId} {entry.type.toLowerCase()} — promised{" "}
                {entry.originalEtaMin.toFixed(1)} min, tolerates +{entry.budgetMin} min
              </div>
            ))}
          </div>
        ))}
      </NoteBlock>
    );
  }

  if (plans) {
    const rows = Object.entries(plans);

    if (rows.length === 0) {
      return null;
    }

    return (
      <NoteBlock title="Committed sequence (re-stamped ETAs)">
        {rows.map(([driverId, plan]) => (
          <div key={driverId}>
            <span className="text-[11px] font-medium">{driverId}</span>
            {plan.stops.map((stop, index) => (
              <div key={stop.id} className="tabular text-[10px] text-[var(--muted-foreground)]">
                {index + 1}. {stop.passengerId} {stop.type.toLowerCase()} —{" "}
                {stop.originalEtaMin.toFixed(1)} min
              </div>
            ))}
          </div>
        ))}
      </NoteBlock>
    );
  }

  return null;
}

function NoteBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--border)] px-2 py-1.5">
      <div className="text-[11px] font-semibold">{title}</div>
      <div className="mt-1 flex flex-col gap-1">{children}</div>
    </div>
  );
}
