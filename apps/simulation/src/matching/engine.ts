import type {
  Driver,
  MatchingSettings,
  RideRequest,
  Scenario,
  StageId,
  Stop,
  Vehicle,
} from "@/domain/entities";
import type { RoutingEngine, RoutingTelemetrySnapshot } from "@/routing/types";

import { EvaluationLedger } from "./evaluation";
import { REASONS, reason, type MatchReason, type ReasonCode } from "./reasons";
import type {
  DriverEvaluation,
  DriverMetrics,
  DriverStageResult,
  MatchingContext,
  MatchingResult,
  MatchingStage,
  MatchingSummary,
  RejectionGroup,
  RouteInsertionResult,
  ScoreBreakdown,
  StageResult,
} from "./types";

export interface RunMatchingOptions {
  scenario: Scenario;
  request: RideRequest;
  settings: MatchingSettings;
  routing: RoutingEngine;
  stages: MatchingStage[];
  telemetry: () => RoutingTelemetrySnapshot;
  /** Injectable clock so tests can assert on timings deterministically. */
  now?: () => number;
}

/**
 * Runs the pipeline over an immutable scenario and returns an explainable
 * result. The scenario is read but never written; repeated runs on the same
 * input must produce the same output.
 */
export async function runMatching(options: RunMatchingOptions): Promise<MatchingResult> {
  const { scenario, request, settings, routing, stages } = options;
  const now = options.now ?? (() => performance.now());
  const runStarted = now();

  const allDriverIds = scenario.drivers.map((driver) => driver.id);
  const ledger = new EvaluationLedger(allDriverIds);
  const lookups = buildLookups(scenario);

  let liveDriverIds: string[] = [...allDriverIds];
  let requestRejection: MatchReason | undefined;
  const stageResults: StageResult[] = [];

  for (const stage of stages) {
    if (requestRejection) {
      stageResults.push(skippedStage(stage, allDriverIds, ledger));
      continue;
    }

    const inputCount = liveDriverIds.length;
    const stageStarted = now();
    const context = createContext({
      scenario,
      request,
      settings,
      routing,
      liveDriverIds,
      ledger,
      lookups,
    });

    const outcome = await stage.execute(context);
    const durationMs = now() - stageStarted;

    if (outcome.requestRejection) {
      requestRejection = outcome.requestRejection;
    }

    const verdictByDriver = new Map(
      outcome.verdicts.map((verdict) => [verdict.driverId, verdict] as const),
    );

    // Stage 1 discovers the candidate set rather than filtering it, so drivers
    // it did not surface are failed here rather than passing by default.
    const candidateSet = outcome.candidateDriverIds
      ? new Set(outcome.candidateDriverIds)
      : undefined;

    const driverResults: DriverStageResult[] = [];
    const survivors: string[] = [];

    for (const driverId of allDriverIds) {
      const isLive = ledger.isAlive(driverId) && !requestRejection;

      if (!isLive) {
        // P12: a driver that already failed is NOT_EVALUATED from here on, not
        // failed again at every downstream stage.
        const skipped = notEvaluated(driverId);
        driverResults.push(skipped);
        ledger.appendStageResult(driverId, skipped, stage.id);
        continue;
      }

      const verdict = verdictByDriver.get(driverId);
      let result: DriverStageResult;

      if (verdict) {
        result = {
          driverId,
          status: verdict.status,
          reasons: verdict.reasons,
          ...(verdict.metrics ? { metrics: verdict.metrics } : {}),
        };
      } else if (candidateSet && !candidateSet.has(driverId)) {
        result = {
          driverId,
          status: "FAILED",
          reasons: [
            reason("H3_OUTSIDE_SEARCH", "Driver outside the maximum H3 search area", {
              threshold: settings.maxH3Ring,
            }),
          ],
        };
      } else {
        result = { driverId, status: "PASSED", reasons: [] };
      }

      driverResults.push(result);
      ledger.appendStageResult(driverId, result, stage.id);

      if (result.status === "PASSED") {
        survivors.push(driverId);
      }
    }

    liveDriverIds = survivors;

    stageResults.push({
      stageId: stage.id,
      stageName: stage.name,
      inputCount,
      outputCount: requestRejection ? 0 : survivors.length,
      rejectedCount: requestRejection ? inputCount : inputCount - survivors.length,
      durationMs,
      driverResults,
      ...(outcome.notes ? { notes: outcome.notes } : {}),
    });
  }

  const evaluations = ledger.finalize(Boolean(requestRejection));
  const ranked = rankEvaluations(evaluations);
  const candidates = countCandidates(stageResults);

  return {
    requestId: request.id,
    ...(requestRejection ? { requestRejection } : {}),
    stageResults,
    evaluations,
    ranked,
    summary: buildSummary(evaluations, ranked, allDriverIds.length, candidates),
    telemetry: options.telemetry(),
    durationMs: now() - runStarted,
  };
}

interface ScenarioLookups {
  driversById: Map<string, Driver>;
  vehiclesById: Map<string, Vehicle>;
  ridesById: Map<string, { stops: Stop[]; passengerIds: string[] }>;
}

function buildLookups(scenario: Scenario): ScenarioLookups {
  return {
    driversById: new Map(scenario.drivers.map((driver) => [driver.id, driver])),
    vehiclesById: new Map(scenario.vehicles.map((vehicle) => [vehicle.id, vehicle])),
    ridesById: new Map(
      scenario.rides.map((ride) => [
        ride.id,
        {
          // Sorting here means no stage has to remember to do it.
          stops: [...ride.stops].sort((a, b) => a.sequence - b.sequence),
          passengerIds: ride.passengerIds,
        },
      ]),
    ),
  };
}

function createContext(input: {
  scenario: Scenario;
  request: RideRequest;
  settings: MatchingSettings;
  routing: RoutingEngine;
  liveDriverIds: readonly string[];
  ledger: EvaluationLedger;
  lookups: ScenarioLookups;
}): MatchingContext {
  const { scenario, request, settings, routing, liveDriverIds, ledger, lookups } = input;

  return {
    scenario,
    request,
    settings,
    routing,
    liveDriverIds,
    getDriver: (driverId: string): Driver | undefined => lookups.driversById.get(driverId),
    getVehicleForDriver: (driverId: string): Vehicle | undefined => {
      const driver = lookups.driversById.get(driverId);
      return driver ? lookups.vehiclesById.get(driver.vehicleId) : undefined;
    },
    getRideForDriver: (driverId: string) => {
      const driver = lookups.driversById.get(driverId);
      return driver?.currentRideId ? lookups.ridesById.get(driver.currentRideId) : undefined;
    },
    getMetrics: (driverId: string): DriverMetrics => ledger.getMetrics(driverId),
    recordMetrics: (driverId: string, metrics: DriverMetrics): void =>
      ledger.recordMetrics(driverId, metrics),
    recordInsertion: (driverId: string, insertion: RouteInsertionResult): void =>
      ledger.recordInsertion(driverId, insertion),
    recordScore: (driverId: string, breakdown: ScoreBreakdown): void =>
      ledger.recordScore(driverId, breakdown),
  };
}

function notEvaluated(driverId: string): DriverStageResult {
  return { driverId, status: "NOT_EVALUATED", reasons: [] };
}

function skippedStage(
  stage: MatchingStage,
  allDriverIds: readonly string[],
  ledger: EvaluationLedger,
): StageResult {
  const driverResults = allDriverIds.map((driverId) => {
    const result = notEvaluated(driverId);
    ledger.appendStageResult(driverId, result, stage.id);
    return result;
  });

  return {
    stageId: stage.id,
    stageName: stage.name,
    inputCount: 0,
    outputCount: 0,
    rejectedCount: 0,
    durationMs: 0,
    driverResults,
  };
}

/**
 * The candidate count is the output of H3 generation, not the driver pool —
 * "24 candidates, 5 passed" only means something if candidates excludes
 * drivers that were never in the search area.
 */
function countCandidates(stageResults: readonly StageResult[]): number {
  const generation = stageResults.find((stage) => stage.stageId === "h3CandidateGeneration");
  return generation ? generation.outputCount : 0;
}

function rankEvaluations(evaluations: readonly DriverEvaluation[]): DriverEvaluation[] {
  const passed = evaluations.filter((evaluation) => evaluation.finalStatus === "PASSED");

  passed.sort((a, b) => {
    const scoreDelta = (b.finalScore ?? 0) - (a.finalScore ?? 0);
    // Ties break on driver id so repeated runs produce a stable ordering.
    return scoreDelta !== 0 ? scoreDelta : a.driverId.localeCompare(b.driverId);
  });

  passed.forEach((evaluation, index) => {
    evaluation.rank = index + 1;
  });

  return passed;
}

function buildSummary(
  evaluations: readonly DriverEvaluation[],
  ranked: readonly DriverEvaluation[],
  totalDrivers: number,
  candidates: number,
): MatchingSummary {
  const groups = new Map<ReasonCode, RejectionGroup>();

  for (const evaluation of evaluations) {
    if (evaluation.finalStatus !== "FAILED") {
      continue;
    }

    // A driver fails at exactly one stage but that stage may attach several
    // reasons; count each code at most once per driver.
    const seen = new Set<ReasonCode>();

    for (const matchReason of evaluation.reasons) {
      if (seen.has(matchReason.code)) {
        continue;
      }
      seen.add(matchReason.code);

      const existing = groups.get(matchReason.code);
      if (existing) {
        existing.count += 1;
        existing.driverIds.push(evaluation.driverId);
      } else {
        groups.set(matchReason.code, {
          code: matchReason.code,
          category: matchReason.category,
          label: REASONS[matchReason.code].label,
          count: 1,
          driverIds: [evaluation.driverId],
        });
      }
    }
  }

  const best = ranked[0];

  return {
    totalDrivers,
    candidates,
    passed: ranked.length,
    rejected: evaluations.filter((evaluation) => evaluation.finalStatus === "FAILED").length,
    ...(best ? { bestDriverId: best.driverId } : {}),
    ...(best?.finalScore !== undefined ? { bestScore: best.finalScore } : {}),
    rejectionsByCode: [...groups.values()].sort((a, b) => b.count - a.count),
  };
}

export function stageResultFor(
  result: MatchingResult,
  stageId: StageId,
): StageResult | undefined {
  return result.stageResults.find((stage) => stage.stageId === stageId);
}
