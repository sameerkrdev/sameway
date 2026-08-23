import { TriangleAlert } from "lucide-react";

import { useMatchingStore } from "@/stores/matchingStore";

/**
 * Mock routing is never silent.
 *
 * Synthetic distances are perfectly good for exercising algorithm logic and
 * useless for tuning real thresholds. Substituting them without saying so
 * would let someone draw conclusions from fabricated numbers.
 */
export function RoutingBanner() {
  const run = useMatchingStore((state) => state.currentRun);
  const error = useMatchingStore((state) => state.error);

  // Credentials come first: a run that could not reach the solver produced no
  // opinion about any driver, which is a more severe thing to be unaware of
  // than synthetic distances.
  if (error && /credential|application default|gcloud/i.test(error)) {
    return (
      <div className="flex items-start gap-2 border-b border-[var(--fail)] bg-[color-mix(in_oklab,var(--fail)_14%,transparent)] px-3 py-1.5">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--fail)]" aria-hidden />
        <p className="text-[11px]">
          <span className="font-semibold">Route Optimization is unavailable.</span> Run{" "}
          <code>gcloud auth application-default login</code> and set{" "}
          <code>GOOGLE_CLOUD_PROJECT</code> in <code>apps/simulation/.env.local</code>, then restart{" "}
          <code>bun run dev</code>. The optimizer proxy only exists in the dev server — a built
          bundle cannot reach it.
        </p>
      </div>
    );
  }

  if (!run || run.routingEngine !== "MOCK") {
    return null;
  }

  return (
    <div className="flex items-center gap-2 border-b border-[var(--warn)] bg-[color-mix(in_oklab,var(--warn)_14%,transparent)] px-3 py-1.5">
      <TriangleAlert className="size-3.5 shrink-0 text-[var(--warn)]" aria-hidden />
      <p className="text-[11px]">
        <span className="font-semibold">Routing engine: MOCK</span> — distances and ETAs are
        simulated, not real road data.
        {run.fallbackReason ? (
          <span className="text-[var(--muted-foreground)]"> {run.fallbackReason}.</span>
        ) : null}
      </p>
    </div>
  );
}
