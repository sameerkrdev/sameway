import type { StageId } from "@/domain/entities";

import type { MatchReason } from "./reasons";
import type {
  CommitPlan,
  DriverEvaluation,
  DriverMetrics,
  DriverStageResult,
  RouteInsertionResult,
  ScoreBreakdown,
} from "./types";

interface MutableEvaluation {
  driverId: string;
  stageResults: DriverStageResult[];
  metrics: DriverMetrics;
  reasons: MatchReason[];
  insertion?: RouteInsertionResult;
  scoreBreakdown?: ScoreBreakdown;
  commitPlan?: CommitPlan;
  finalScore?: number;
  failedAtStageId?: StageId;
  alive: boolean;
}

/**
 * Driver-indexed accumulator for a single run.
 *
 * The pipeline naturally produces stage-indexed data, which answers "what
 * happened at stage 4". The UI equally needs "what happened to D032", and
 * deriving that on every render is wasteful, so both views are maintained.
 */
export class EvaluationLedger {
  private readonly records = new Map<string, MutableEvaluation>();

  constructor(driverIds: readonly string[]) {
    for (const driverId of driverIds) {
      this.records.set(driverId, {
        driverId,
        stageResults: [],
        metrics: {},
        reasons: [],
        alive: true,
      });
    }
  }

  private require(driverId: string): MutableEvaluation {
    const record = this.records.get(driverId);
    if (!record) {
      throw new Error(`Unknown driver "${driverId}" in evaluation ledger`);
    }
    return record;
  }

  has(driverId: string): boolean {
    return this.records.has(driverId);
  }

  getMetrics(driverId: string): DriverMetrics {
    return this.require(driverId).metrics;
  }

  recordMetrics(driverId: string, metrics: DriverMetrics): void {
    const record = this.require(driverId);
    record.metrics = { ...record.metrics, ...metrics };
  }

  recordInsertion(driverId: string, insertion: RouteInsertionResult): void {
    this.require(driverId).insertion = insertion;
  }

  recordCommitPlan(driverId: string, plan: CommitPlan): void {
    this.require(driverId).commitPlan = plan;
  }

  recordScore(driverId: string, breakdown: ScoreBreakdown): void {
    const record = this.require(driverId);
    record.scoreBreakdown = breakdown;
    record.finalScore = breakdown.finalScore;
  }

  appendStageResult(driverId: string, result: DriverStageResult, stageId: StageId): void {
    const record = this.require(driverId);
    record.stageResults.push(result);

    // A NOT_EVALUATED entry with no reasons is the runner back-filling a driver
    // that already died upstream, which must not overwrite where it died. A
    // NOT_EVALUATED entry *with* reasons means a stage genuinely could not
    // judge this driver, which does end its run.
    const eliminated = result.status === "FAILED" || result.reasons.length > 0;

    if (result.status !== "PASSED" && eliminated) {
      record.alive = false;
      record.failedAtStageId ??= stageId;
      record.reasons.push(...result.reasons);
    }
  }

  isAlive(driverId: string): boolean {
    return this.require(driverId).alive;
  }

  /**
   * @param forceFailed Set when the request itself was rejected. No driver was
   * ever evaluated, so none of them may be reported as a match.
   */
  finalize(forceFailed = false): DriverEvaluation[] {
    const evaluations: DriverEvaluation[] = [];

    for (const record of this.records.values()) {
      evaluations.push({
        driverId: record.driverId,
        stageResults: record.stageResults,
        metrics: record.metrics,
        reasons: record.reasons,
        ...(record.insertion ? { insertion: record.insertion } : {}),
        ...(record.scoreBreakdown ? { scoreBreakdown: record.scoreBreakdown } : {}),
        ...(record.commitPlan ? { commitPlan: record.commitPlan } : {}),
        ...(record.finalScore !== undefined ? { finalScore: record.finalScore } : {}),
        finalStatus: record.alive && !forceFailed ? "PASSED" : "FAILED",
        ...(record.failedAtStageId ? { failedAtStageId: record.failedAtStageId } : {}),
      });
    }

    return evaluations;
  }
}
