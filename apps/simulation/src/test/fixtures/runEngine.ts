import type { MatchingSettings, RideRequest, Scenario } from "@/domain/entities";
import { runMatching } from "@/matching/engine";
import { resolveStages } from "@/matching/pipeline";
import { STAGE_REGISTRY } from "@/matching/stages";
import type { MatchingResult } from "@/matching/types";
import { createOptimizerStack } from "@/optimization";
import { createRoutingStack } from "@/routing";

import { StubOptimizerEngine } from "./stubOptimizer";

/** Runs the real pipeline against the mock routing engine. */
export async function runFixture(
  scenario: Scenario,
  request: RideRequest,
  settingsOverride?: Partial<MatchingSettings>,
): Promise<MatchingResult> {
  const settings: MatchingSettings = { ...scenario.settings, ...settingsOverride };
  const stack = createRoutingStack({ settings });
  const optimizerStack = createOptimizerStack({ settings, engine: new StubOptimizerEngine() });

  return runMatching({
    scenario,
    request,
    settings,
    routing: stack.engine,
    stages: resolveStages(STAGE_REGISTRY, settings.stageOrder),
    telemetry: () => stack.telemetry.snapshot(),
    optimizer: optimizerStack.engine,
    optimizerTelemetry: () => optimizerStack.telemetry.snapshot(),
  });
}

export function evaluationFor(result: MatchingResult, driverId: string) {
  const evaluation = result.evaluations.find((entry) => entry.driverId === driverId);
  if (!evaluation) {
    throw new Error(`No evaluation recorded for ${driverId}`);
  }
  return evaluation;
}

export function stageStatus(
  result: MatchingResult,
  driverId: string,
  stageId: string,
): string | undefined {
  const stage = result.stageResults.find((entry) => entry.stageId === stageId);
  return stage?.driverResults.find((entry) => entry.driverId === driverId)?.status;
}

export function failureCodes(result: MatchingResult, driverId: string): string[] {
  return evaluationFor(result, driverId).reasons.map((entry) => entry.code);
}
