import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { formatMinutes } from "@/lib/format";
import type { MatchingResult } from "@/matching/types";
import { cn } from "@/lib/utils";

/**
 * Rejections grouped by reason code.
 *
 * Grouping on the structured `code` rather than on message text is what makes
 * this reliable, and it is the fastest way to see which threshold is doing the
 * most work in a given scenario.
 */
export function RejectionPanel({
  result,
  onSelectDriver,
}: {
  result: MatchingResult;
  onSelectDriver: (driverId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (result.summary.rejectionsByCode.length === 0) {
    return <EmptyState message="No driver was rejected in this run." />;
  }

  return (
    <div className="flex flex-col gap-1">
      {result.summary.rejectionsByCode.map((group) => {
        const open = expanded === group.code;

        return (
          <div key={group.code} className="rounded-md border border-[var(--border)]">
            <button
              type="button"
              className="flex w-full items-center gap-2 p-2 text-left"
              onClick={() => setExpanded(open ? null : group.code)}
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
                aria-hidden
              />
              <span className="flex-1 text-xs font-medium">{group.label}</span>
              <Badge variant="outline" className="font-mono">
                {group.category}
              </Badge>
              <span className="tabular text-sm font-semibold">{group.count}</span>
            </button>

            {open ? (
              <ul className="border-t border-[var(--border)] p-1">
                {group.driverIds.map((driverId) => {
                  const evaluation = result.evaluations.find(
                    (entry) => entry.driverId === driverId,
                  );
                  const reason = evaluation?.reasons.find((entry) => entry.code === group.code);

                  return (
                    <li key={driverId}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left hover:bg-[var(--accent)]"
                        onClick={() => onSelectDriver(driverId)}
                      >
                        <span className="text-xs font-medium">{driverId}</span>
                        {reason?.value !== undefined || reason?.threshold !== undefined ? (
                          <span className="tabular ml-2 text-[11px] text-[var(--muted-foreground)]">
                            {reason?.value !== undefined ? `${reason.value}` : ""}
                            {reason?.threshold !== undefined ? ` / max ${reason.threshold}` : ""}
                          </span>
                        ) : null}
                        {evaluation?.metrics.roadEtaMin !== undefined &&
                        group.category === "ETA" ? (
                          <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">
                            ({formatMinutes(evaluation.metrics.roadEtaMin)})
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
