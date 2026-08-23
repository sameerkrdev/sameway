import type { LatLng } from "@/domain/entities";
import type { RouteLegResult } from "@/routing/types";

export type OptimizerEngineKind = "GOOGLE_OPTIMIZE_TOURS";

/**
 * One passenger, as the solver sees them.
 *
 * Pickup-before-drop precedence is implicit in this shape — a shipment is
 * collected then delivered — so no separate ordering constraint is ever sent.
 */
export interface OptimizerShipment {
  /** Stable id we can map back to a passenger. */
  id: string;
  passengerId: string;
  pickup: LatLng;
  drop: LatLng;
  seats: number;
  /**
   * Latest acceptable arrival at the pickup, in minutes from now. Undefined
   * means unconstrained.
   */
  pickupDeadlineMin?: number;
  /** Latest acceptable arrival at the drop, in minutes from now. */
  dropDeadlineMin?: number;
  /**
   * `null` makes the shipment mandatory — the solver may not drop it. A finite
   * number lets the solver skip it and report it in `skippedShipmentIds`,
   * which is how an infeasible insertion arrives as data rather than an error.
   */
  penaltyCost: number | null;
  /**
   * Soft pickup deadline. Exceeding it costs `softDeadlineCostPerHour` rather
   * than making the model infeasible — used for the new rider so a tight
   * window degrades gracefully instead of failing the whole request.
   */
  softPickupDeadlineMin?: number;
  softDeadlineCostPerHour?: number;
}

/** One visit in the solver's answer. */
export interface OptimizerVisit {
  shipmentId: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  location: LatLng;
  /** Minutes from the vehicle's start time. */
  arrivalMin: number;
}

export interface OptimizeToursRequest {
  /** Used for cache keying and debug traces; not sent to the provider. */
  driverId: string;
  vehicleStart: LatLng;
  seatCapacity: number;
  shipments: OptimizerShipment[];
  /**
   * Visits, in order, that the solver must keep frozen at the head of the
   * route. Everything after `lockedVisits.length` is free to reorder.
   */
  lockedVisits: { shipmentId: string; type: "PICKUP" | "DROP" }[];
  timeoutMs: number;
}

export interface OptimizeToursResult {
  visits: OptimizerVisit[];
  /** One leg per visit: `vehicleStart → visit[0]`, `visit[0] → visit[1]`, … */
  legs: RouteLegResult[];
  totalDistanceKm: number;
  totalDurationMin: number;
  skippedShipmentIds: string[];
}

export interface OptimizerEngine {
  readonly kind: OptimizerEngineKind;
  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult>;
}

export interface OptimizerTelemetrySnapshot {
  engine: OptimizerEngineKind;
  calls: number;
  shipmentsBilled: number;
  cacheHits: number;
  cacheMisses: number;
  budgetLimit: number;
  budgetUsed: number;
  budgetRemaining: number;
  unavailableReason: string | null;
}

/**
 * Thrown when the proxy has no usable credentials (missing project id or key).
 *
 * This is deliberately distinct from every other failure: it aborts the whole
 * run rather than producing per-driver verdicts, because a run with no solver
 * has no opinion about any driver and saying otherwise would be a lie.
 */
export class OptimizerCredentialsMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptimizerCredentialsMissingError";
  }
}

export class OptimizerUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OptimizerUnavailableError";
  }
}

export class OptimizerBudgetExceededError extends Error {
  constructor(readonly limit: number) {
    super(`Optimizer budget of ${limit} calls exhausted for this run`);
    this.name = "OptimizerBudgetExceededError";
  }
}
