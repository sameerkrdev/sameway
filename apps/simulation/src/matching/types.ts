import type {
  Driver,
  LatLng,
  MatchingSettings,
  RideRequest,
  Scenario,
  ScoringWeights,
  StageId,
  Stop,
  Vehicle,
} from "@/domain/entities";
import type { OptimizerEngine, OptimizerTelemetrySnapshot } from "@/optimization/types";
import type { RouteLegResult, RoutingEngine, RoutingTelemetrySnapshot } from "@/routing/types";

import type { RideCorridor } from "./corridor";
import type { MatchReason, ReasonCategory, ReasonCode } from "./reasons";
import type { StopDelayBudget } from "./stages/operationalState";

export type EvaluationStatus = "PASSED" | "FAILED" | "NOT_EVALUATED";

/**
 * All numeric findings about a driver, accumulated across stages.
 *
 * The four proximity measures are deliberately distinct and never
 * interchangeable: `h3GridDistance` is a unitless hop count, `straightLineKm`
 * is as-the-crow-flies, `roadDistanceKm` follows roads, and `roadEtaMin` is
 * time. Only the last two may be compared against user-facing thresholds.
 */
export interface DriverMetrics {
  // Spatial
  driverCell?: string;
  pickupCell?: string;
  h3GridDistance?: number;
  discoveredRing?: number;
  straightLineKm?: number;
  pickupToRouteKm?: number;

  // Pickup proximity (road)
  roadDistanceKm?: number;
  roadEtaMin?: number;

  // Direction compatibility
  bearingDifferenceDeg?: number;
  dropToRouteKm?: number;
  dropProgressKm?: number;
  pickupProgressKm?: number;
  /** Forward extension past the last committed stop (same-direction pooling). */
  corridorExtensionKm?: number;

  // Operational state
  flexibleStopCount?: number;
  tightestDelayBudgetMin?: number;

  // Sequence generation
  enumeratedSequences?: number;
  capacityFeasibleSequences?: number;
  timeWindowFeasibleSequences?: number;
  lowerBoundAdditionalKm?: number;
  boundFeasibleSequences?: number;
  shortlistedSequences?: number;

  // Capacity
  totalSeats?: number;
  committedSeats?: number;
  availableSeats?: number;
  peakOccupancy?: number;

  // Route feasibility
  originalDistanceKm?: number;
  newDistanceKm?: number;
  additionalDistanceKm?: number;
  detourPercent?: number;
  originalDurationMin?: number;
  newDurationMin?: number;
  additionalDurationMin?: number;
  newPassengerPickupEtaMin?: number;
  newPassengerPickupDelayMin?: number;
  newPassengerRideDetourMin?: number;
  maximumExistingPassengerDelayMin?: number;
  /** Tightest drop delay budget that applied to the measured worst delay. */
  maximumExistingPassengerDelayBudgetMin?: number;

  // Pooling
  existingPassengerCount?: number;
  pooledPassengerCount?: number;
}

export interface ScoreComponent {
  key: keyof ScoringWeights;
  label: string;
  /** The underlying measurement, in its own natural unit. */
  rawValue: number | undefined;
  /** 0-100 after normalising against the component's configured threshold. */
  normalized: number;
  /** Share of the total weight, 0-1. */
  weight: number;
  /** `normalized * weight`; these sum to `finalScore`. */
  contribution: number;
}

export interface ScoreBreakdown {
  components: ScoreComponent[];
  finalScore: number;
}

export interface SegmentOccupancy {
  /** Index of the stop after which this occupancy applies. */
  stopIndex: number;
  stopId: string;
  stopType: "PICKUP" | "DROP";
  passengerId: string;
  occupancy: number;
}

export interface PassengerDelay {
  passengerId: string;
  stopId: string;
  arrivalBeforeMin: number;
  arrivalAfterMin: number;
  delayMin: number;
}

export interface InsertionAttemptStats {
  enumerated: number;
  waypointLimitPruned: number;
  occupancyPruned: number;
  geographicallyPruned: number;
  routed: number;
  cacheHits: number;
  feasible: number;
}

/**
 * A proposed stop sequence. `stops` are the real existing stops plus two
 * synthetic ones for the new rider, in execution order.
 */
export interface ProposedStop {
  id: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  location: LatLng;
  seats: number;
  isNew: boolean;
}

/**
 * A committed match, ready to be applied to the scenario.
 *
 * Built by stage 12 but never applied by it: `runMatching` stays pure so a run
 * can be replayed, snapshotted and compared. `scenarioStore.commitMatch` is the
 * only thing that changes the world.
 */
export interface CommitPlan {
  driverId: string;
  rideId: string | null;
  passengerId: string;
  requestId: string;
  /** The winning sequence, with re-stamped ETAs. */
  stops: {
    id: string;
    passengerId: string;
    type: "PICKUP" | "DROP";
    location: LatLng;
    originalEtaMin: number;
  }[];
}

export interface RouteInsertionCandidate {
  pickupIndex: number;
  dropIndex: number;
  stops: ProposedStop[];
}

/**
 * What stage 8 hands to stages 9 through 12.
 *
 * Carries both the solved route and the baseline it must be measured against,
 * so stage 9 can compute every party's delta without re-deriving anything or
 * issuing a call of its own.
 */
export interface SolvedRoute {
  stops: ProposedStop[];
  legs: RouteLegResult[];
  arrivalByStopId: Map<string, number>;
  totalDistanceKm: number;
  totalDurationMin: number;
  baselineDistanceKm: number;
  baselineDurationMin: number;
  baselineArrivalByStopId: Map<string, number>;
  /** Road polyline for the pre-insertion route, when the routing engine returned one. */
  baselinePath?: LatLng[];
  soloDurationMin: number;
}

export interface RouteInsertionResult {
  feasible: boolean;

  insertedRoute?: ProposedStop[];
  pickupIndex?: number;
  dropIndex?: number;

  originalDistanceKm?: number;
  newDistanceKm?: number;
  additionalDistanceKm?: number;
  detourPercentage?: number;

  originalDurationMin?: number;
  newDurationMin?: number;
  additionalDurationMin?: number;

  newPassengerPickupEtaMin?: number;
  newPassengerPickupDelayMin?: number;
  newPassengerRideDetourMin?: number;

  existingPassengerDelays?: PassengerDelay[];
  maximumExistingPassengerDelayMin?: number;
  /** Tightest drop delay budget that applied to the measured worst delay. */
  maximumExistingPassengerDelayBudgetMin?: number;

  occupancyBySegment?: SegmentOccupancy[];

  /** Route geometry for the winning (or least-bad) candidate. */
  path?: LatLng[];
  originalPath?: LatLng[];

  /**
   * Populated even when `feasible` is false, so the map can show what was
   * attempted and where it went wrong.
   */
  bestAttempt?: RouteInsertionCandidate;

  attemptStats: InsertionAttemptStats;
  rejectionReason?: MatchReason;
}

export interface DriverStageResult {
  driverId: string;
  status: EvaluationStatus;
  reasons: MatchReason[];
  metrics?: Record<string, number | string | boolean>;
}

export interface StageResult {
  stageId: StageId;
  stageName: string;
  inputCount: number;
  outputCount: number;
  rejectedCount: number;
  durationMs: number;
  driverResults: DriverStageResult[];
  /** Stage-specific diagnostics, e.g. per-ring discovery counts. */
  notes?: Record<string, unknown>;
}

export interface DriverEvaluation {
  driverId: string;
  stageResults: DriverStageResult[];
  metrics: DriverMetrics;
  reasons: MatchReason[];
  insertion?: RouteInsertionResult;
  scoreBreakdown?: ScoreBreakdown;
  commitPlan?: CommitPlan;
  finalScore?: number;
  finalStatus: EvaluationStatus;
  failedAtStageId?: StageId;
  rank?: number;
}

export interface RejectionGroup {
  code: ReasonCode;
  category: ReasonCategory;
  label: string;
  count: number;
  driverIds: string[];
}

export interface MatchingSummary {
  totalDrivers: number;
  /** Drivers whose corridor matched the pickup (Layer 1 output). */
  candidates: number;
  passed: number;
  rejected: number;
  /** Drivers outside the Layer 1 corridor search. */
  notEvaluated: number;
  bestDriverId?: string;
  bestScore?: number;
  rejectionsByCode: RejectionGroup[];
}

export interface MatchingResult {
  requestId: string;
  /** Set when stage 0 rejected the request outright; no driver is evaluated. */
  requestRejection?: MatchReason;
  stageResults: StageResult[];
  evaluations: DriverEvaluation[];
  /** Survivors, ordered by descending score. */
  ranked: DriverEvaluation[];
  summary: MatchingSummary;
  telemetry: RoutingTelemetrySnapshot;
  optimizerTelemetry: OptimizerTelemetrySnapshot;
  durationMs: number;
}

/** A reproducible record of one Run Matching click. */
export interface MatchingRun {
  id: string;
  createdAt: string;
  scenarioSnapshot: Scenario;
  requestSnapshot: RideRequest;
  settingsSnapshot: MatchingSettings;
  result: MatchingResult;
  routingEngine: "GOOGLE" | "MOCK";
  fallbackReason: string | null;
  optimizerUnavailableReason: string | null;
  durationMs: number;
}

/**
 * Read-only view a stage receives. Stages never mutate the scenario; they
 * return verdicts and the runner applies them.
 */
export interface MatchingContext {
  readonly scenario: Scenario;
  readonly request: RideRequest;
  readonly settings: MatchingSettings;
  readonly routing: RoutingEngine;
  readonly optimizer: OptimizerEngine;

  /** Driver ids still alive entering the current stage. */
  readonly liveDriverIds: readonly string[];

  getDriver(driverId: string): Driver | undefined;
  getVehicleForDriver(driverId: string): Vehicle | undefined;
  getRideForDriver(driverId: string): { stops: Stop[]; passengerIds: string[] } | undefined;
  getMetrics(driverId: string): DriverMetrics;

  /**
   * The driver's remaining-route corridor, built once at stage 2 and read by
   * stages 3, 4, 5 and 7. Undefined before stage 2 has run.
   */
  getCorridor(driverId: string): RideCorridor | undefined;

  /** Stage 2 only. Publishes the corridors every later stage reads. */
  setCorridor(driverId: string, corridor: RideCorridor): void;

  /** Candidate orderings published by stage 5 and narrowed by stages 6 and 7. */
  getSequences(driverId: string): RouteInsertionCandidate[];
  setSequences(driverId: string, candidates: RouteInsertionCandidate[]): void;

  /** The solved route published by stage 8 and read by stages 9 through 12. */
  getSolution(driverId: string): SolvedRoute | undefined;
  setSolution(driverId: string, solution: SolvedRoute): void;

  /** Per-stop delay budgets published by stage 1 and enforced by stages 6 and 10. */
  getDelayBudgets(driverId: string): StopDelayBudget[];
  setDelayBudgets(driverId: string, budgets: StopDelayBudget[]): void;

  /** Merges into the driver's accumulated metrics. */
  recordMetrics(driverId: string, metrics: DriverMetrics): void;
  recordInsertion(driverId: string, insertion: RouteInsertionResult): void;
  recordScore(driverId: string, breakdown: ScoreBreakdown): void;
  recordCommitPlan(driverId: string, plan: CommitPlan): void;
}

export interface DriverVerdict {
  driverId: string;
  /**
   * NOT_EVALUATED is for drivers a stage could not judge — the routing budget
   * running out, for example. It is not an algorithmic rejection and must stay
   * visually distinct from one.
   */
  status: EvaluationStatus;
  reasons: MatchReason[];
  metrics?: Record<string, number | string | boolean>;
}

export interface StageOutcome {
  /**
   * Verdicts for drivers this stage judged. Live drivers with no verdict are
   * treated as passed.
   */
  verdicts: DriverVerdict[];
  notes?: Record<string, unknown>;
  /** `requestValidation` only: aborts the whole run. */
  requestRejection?: MatchReason;
  /**
   * A discovery stage only (`h3RouteCorridor`): ride ids surfaced by Layer 1
   * corridor lookup. Undiscovered drivers are NOT_EVALUATED by the engine.
   * Live drivers absent from this list are failed with the stage's rejection
   * reason. Unused while stage 2 is a placeholder; Task 11 populates it.
   */
  candidateDriverIds?: string[];
}

export interface MatchingStage {
  id: StageId;
  name: string;
  description: string;
  execute(context: MatchingContext): Promise<StageOutcome>;
}
