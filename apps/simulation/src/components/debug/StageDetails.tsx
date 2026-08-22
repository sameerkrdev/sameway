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
