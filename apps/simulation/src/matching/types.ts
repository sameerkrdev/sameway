import type {
  Driver,
  LatLng,
  MatchingSettings,
  RideRequest,
  Scenario,
  StageId,
  Stop,
  Vehicle,
} from "@/domain/entities";
import type { RoutingEngine, RoutingTelemetrySnapshot } from "@/routing/types";

import type { RideCorridor } from "./corridor";
import type { MatchReason, ReasonCategory, ReasonCode } from "./reasons";

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

  // Operational state
  flexibleStopCount?: number;
  tightestDelayBudgetMin?: number;

  // Sequence generation
  enumeratedSequences?: number;
  capacityFeasibleSequences?: number;

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

  // Pooling
  existingPassengerCount?: number;
  pooledPassengerCount?: number;
}

export interface ScoreComponent {
  key: "eta" | "distance" | "detour" | "routeQuality" | "fairness";
  label: string;
  /** The underlying measurement, in its own natural unit. */
  rawValue: number | undefined;
  /** 0-100 after normalising against the component's configured threshold. */
  normalized: number;
  /** Share of the total weight, 0-1. */
  weight: number;
  /** `normalized * weight`; these sum to `finalScore`. */
  contribution: number;
  experimental?: boolean;
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

export interface RouteInsertionCandidate {
  pickupIndex: number;
  dropIndex: number;
  stops: ProposedStop[];
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
  finalScore?: number;
  finalStatus: "PASSED" | "FAILED";
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
  candidates: number;
  passed: number;
  rejected: number;
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

  /** Merges into the driver's accumulated metrics. */
  recordMetrics(driverId: string, metrics: DriverMetrics): void;
  recordInsertion(driverId: string, insertion: RouteInsertionResult): void;
  recordScore(driverId: string, breakdown: ScoreBreakdown): void;
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
   * A discovery stage only (stage 2, `h3RouteCorridor`): the candidate set.
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
