import { ChevronRight, Cloud } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMs } from "@/lib/format";
import { STAGE_METADATA } from "@/matching/pipeline";
import type { MatchingResult } from "@/matching/types";
import { cn } from "@/lib/utils";

/**
 * The funnel, and the control for stage replay.
 *
 * Selecting a stage filters the map to the drivers still alive at that point.
 * It reads stored stage results, so scrubbing never re-runs the engine or
 * spends another routing call.
 */
export function StagePipeline({
  result,
  replayStageIndex,
  onSelectStage,
}: {
  result: MatchingResult;
  replayStageIndex: number | null;
  onSelectStage: (index: number | null) => void;
}) {
  return (
    // Fourteen segments do not fit a single row at any sensible width, so the
    // funnel wraps rather than hiding half of itself behind a scrollbar.
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="xs"
        variant={replayStageIndex === null ? "default" : "ghost"}
        onClick={() => onSelectStage(null)}
      >
        Final
      </Button>

      {result.stageResults.map((stage, index) => {
        const meta = STAGE_METADATA[stage.stageId];
        const active = replayStageIndex === index;

        return (
          <div key={stage.stageId} className="flex items-center gap-1">
            <ChevronRight className="size-3 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
            <button
              type="button"
              onClick={() => onSelectStage(active ? null : index)}
              title={meta.description}
              className={cn(
                "min-w-0 flex-1 basis-28 rounded-md border px-2 py-1 text-left transition-colors",
                active
                  ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]"
                  : "border-[var(--border)] hover:bg-[var(--accent)]",
              )}
            >
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold">{meta.shortLabel}</span>
                {meta.usesRouting ? (
                  <Cloud
                    className="size-3 text-[var(--warn)]"
                    aria-label="Makes routing calls"
                  />
                ) : null}
              </div>
              <div className="tabular text-[11px] text-[var(--muted-foreground)]">
                {stage.inputCount} → {stage.outputCount}
              </div>
              <div className="tabular text-[10px] text-[var(--muted-foreground)]">
                {stage.rejectedCount > 0 ? `−${stage.rejectedCount}` : "—"} ·{" "}
                {formatMs(stage.durationMs)}
              </div>
            </button>
          </div>
        );
      })}

      {replayStageIndex !== null ? (
        <Badge variant="warn" className="ml-2 shrink-0">
          Replaying stage {replayStageIndex}
        </Badge>
      ) : null}
    </div>
  );
}
