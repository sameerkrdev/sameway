import { CircleSlash, Minus, TriangleAlert, X, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { EvaluationStatus } from "@/matching/types";

/**
 * Pass/fail/skipped is always conveyed by an icon and a word, not by colour
 * alone, so the funnel stays readable without colour vision.
 */
export function StatusBadge({ status }: { status: EvaluationStatus }) {
  if (status === "PASSED") {
    return (
      <Badge variant="pass">
        <Check className="size-3" />
        Passed
      </Badge>
    );
  }

  if (status === "FAILED") {
    return (
      <Badge variant="fail">
        <X className="size-3" />
        Failed
      </Badge>
    );
  }

  return (
    <Badge variant="skip">
      <Minus className="size-3" />
      Not evaluated
    </Badge>
  );
}

export function StatusGlyph({ status }: { status: EvaluationStatus }) {
  if (status === "PASSED") {
    return <Check className="size-3.5 text-[var(--pass)]" aria-label="Passed" />;
  }
  if (status === "FAILED") {
    return <X className="size-3.5 text-[var(--fail)]" aria-label="Failed" />;
  }
  return <Minus className="size-3.5 text-[var(--skip)]" aria-label="Not evaluated" />;
}

export function WarningGlyph() {
  return <TriangleAlert className="size-3.5 text-[var(--warn)]" aria-hidden />;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <CircleSlash className="size-5 text-[var(--muted-foreground)]" aria-hidden />
      <p className="text-xs text-[var(--muted-foreground)]">{message}</p>
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <span className="tabular text-xs font-medium" title={hint}>
        {value}
      </span>
    </div>
  );
}
