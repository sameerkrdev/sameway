/**
 * Structured rejection reasons.
 *
 * Every reason carries a stable `code`, a `category` for grouping, and where
 * applicable both the computed `value` and the `threshold` it was measured
 * against. That pairing is what lets the UI render "Detour 24.1% / max 15%"
 * for any code without a per-code branch, and lets the rejection dashboard
 * aggregate without string matching.
 */

export type ReasonCategory =
  | "VALIDATION"
  | "SPATIAL"
  | "STATUS"
  | "VEHICLE"
  | "CAPACITY"
  | "OPERATIONAL"
  | "CORRIDOR"
  | "DIRECTION"
  | "ROUTE"
  | "OPTIMIZER"
  | "POOLING"
  | "SYSTEM";

export interface MatchReason {
  code: ReasonCode;
  category: ReasonCategory;
  message: string;
  value?: number | string;
  threshold?: number | string;
  metadata?: Record<string, unknown>;
}

export interface ReasonDefinition {
  category: ReasonCategory;
  /** Short human label used in the rejection dashboard. */
  label: string;
  outcome: "PASS" | "FAIL";
}

export const REASONS = {
  // Validation ---------------------------------------------------------------
  REQUEST_VALID: { category: "VALIDATION", label: "Request valid", outcome: "PASS" },
  REQUEST_PICKUP_MISSING: { category: "VALIDATION", label: "Pickup missing", outcome: "FAIL" },
  REQUEST_DROP_MISSING: { category: "VALIDATION", label: "Drop missing", outcome: "FAIL" },
  REQUEST_PICKUP_EQUALS_DROP: {
    category: "VALIDATION",
    label: "Pickup equals drop",
    outcome: "FAIL",
  },
  REQUEST_SEATS_INVALID: { category: "VALIDATION", label: "Invalid seat count", outcome: "FAIL" },
  REQUEST_VEHICLE_PREFERENCE_UNKNOWN: {
    category: "VALIDATION",
    label: "Unknown vehicle preference",
    outcome: "FAIL",
  },
  REQUEST_THRESHOLD_INVALID: {
    category: "VALIDATION",
    label: "Invalid threshold",
    outcome: "FAIL",
  },
  REQUEST_PASSENGER_UNKNOWN: { category: "VALIDATION", label: "Unknown passenger", outcome: "FAIL" },

  // Spatial ------------------------------------------------------------------
  H3_CANDIDATE_FOUND: { category: "SPATIAL", label: "Found in H3 search", outcome: "PASS" },
  H3_OUTSIDE_SEARCH: { category: "SPATIAL", label: "Outside H3 search area", outcome: "FAIL" },

  // Status -------------------------------------------------------------------
  DRIVER_ONLINE: { category: "STATUS", label: "Driver online", outcome: "PASS" },
  DRIVER_OFFLINE: { category: "STATUS", label: "Driver offline", outcome: "FAIL" },
  DRIVER_PAUSED: { category: "STATUS", label: "Driver paused", outcome: "FAIL" },
  DRIVER_BUSY: { category: "STATUS", label: "Driver busy", outcome: "FAIL" },

  // Vehicle ------------------------------------------------------------------
  VEHICLE_COMPATIBLE: { category: "VEHICLE", label: "Vehicle compatible", outcome: "PASS" },
  VEHICLE_NOT_FOUND: { category: "VEHICLE", label: "Vehicle record missing", outcome: "FAIL" },
  VEHICLE_TYPE_MISMATCH: { category: "VEHICLE", label: "Vehicle type mismatch", outcome: "FAIL" },
  VEHICLE_ACCESSIBILITY_MISMATCH: {
    category: "VEHICLE",
    label: "Not wheelchair accessible",
    outcome: "FAIL",
  },
  VEHICLE_LUGGAGE_EXCEEDED: { category: "VEHICLE", label: "Luggage exceeds hold", outcome: "FAIL" },

  // Capacity -----------------------------------------------------------------
  CAPACITY_AVAILABLE: { category: "CAPACITY", label: "Seats available", outcome: "PASS" },
  INSUFFICIENT_CAPACITY: { category: "CAPACITY", label: "Insufficient seats", outcome: "FAIL" },

  // Operational state (stage 1) --------------------------------------------
  OPERATIONAL_FLEXIBLE: {
    category: "OPERATIONAL",
    label: "Committed stops still flexible",
    outcome: "PASS",
  },
  OPERATIONAL_NO_FLEXIBILITY: {
    category: "OPERATIONAL",
    label: "No flexibility in committed route",
    outcome: "FAIL",
  },

  // Corridor (stage 2) ------------------------------------------------------
  CORRIDOR_MATCH: { category: "CORRIDOR", label: "Pickup on route corridor", outcome: "PASS" },
  CORRIDOR_NO_MATCH: {
    category: "CORRIDOR",
    label: "Pickup outside route corridor",
    outcome: "FAIL",
  },

  // Corridor proximity (stage 3) -------------------------------------------
  PICKUP_ON_ROUTE: { category: "SPATIAL", label: "Pickup close to route", outcome: "PASS" },
  PICKUP_TOO_FAR_FROM_ROUTE: {
    category: "SPATIAL",
    label: "Pickup too far from route",
    outcome: "FAIL",
  },

  // Direction (stage 4) -----------------------------------------------------
  DIRECTION_COMPATIBLE: { category: "DIRECTION", label: "Direction compatible", outcome: "PASS" },
  BEARING_INCOMPATIBLE: { category: "DIRECTION", label: "Wrong direction", outcome: "FAIL" },
  DESTINATION_OFF_CORRIDOR: {
    category: "DIRECTION",
    label: "Destination off corridor",
    outcome: "FAIL",
  },
  DESTINATION_BEHIND_VEHICLE: {
    category: "DIRECTION",
    label: "Destination behind vehicle",
    outcome: "FAIL",
  },

  // Sequence generation (stage 5) ------------------------------------------
  SEQUENCE_GENERATED: { category: "ROUTE", label: "Legal sequences found", outcome: "PASS" },
  NO_LEGAL_SEQUENCE: { category: "ROUTE", label: "No legal stop sequence", outcome: "FAIL" },

  // Time windows (stage 6) --------------------------------------------------
  TIME_WINDOW_OK: { category: "ROUTE", label: "Delay budgets respected", outcome: "PASS" },
  COMMITTED_PICKUP_DELAY_TOO_HIGH: {
    category: "ROUTE",
    label: "Committed pickup delayed too far",
    outcome: "FAIL",
  },
  COMMITTED_DROP_DELAY_TOO_HIGH: {
    category: "ROUTE",
    label: "Committed drop delayed too far",
    outcome: "FAIL",
  },

  // Lower bound (stage 7) ---------------------------------------------------
  LOWER_BOUND_OK: { category: "ROUTE", label: "Within detour lower bound", outcome: "PASS" },
  DETOUR_LOWER_BOUND_EXCEEDED: {
    category: "ROUTE",
    label: "Provably too long a detour",
    outcome: "FAIL",
  },

  // Optimizer (stage 8) -----------------------------------------------------
  OPTIMIZER_SOLVED: { category: "OPTIMIZER", label: "Sequence solved", outcome: "PASS" },
  OPTIMIZER_INFEASIBLE: {
    category: "OPTIMIZER",
    label: "Solver could not serve the request",
    outcome: "FAIL",
  },
  OPTIMIZER_CALL_FAILED: { category: "OPTIMIZER", label: "Optimizer call failed", outcome: "FAIL" },
  OPTIMIZER_BUDGET_EXCEEDED: {
    category: "OPTIMIZER",
    label: "Optimizer budget exhausted",
    outcome: "FAIL",
  },
  OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED: {
    category: "SYSTEM",
    label: "Solver dropped a committed passenger",
    outcome: "FAIL",
  },

  // Incremental cost (stage 9) ---------------------------------------------
  COST_MEASURED: { category: "ROUTE", label: "Impact measured", outcome: "PASS" },

  // Commit (stage 12) -------------------------------------------------------
  COMMIT_READY: { category: "ROUTE", label: "Ready to commit", outcome: "PASS" },

  // Route feasibility --------------------------------------------------------
  ROUTE_FEASIBLE: { category: "ROUTE", label: "Route feasible", outcome: "PASS" },
  ROUTE_ORDERING_INVALID: { category: "ROUTE", label: "Invalid stop ordering", outcome: "FAIL" },
  SEGMENT_CAPACITY_EXCEEDED: {
    category: "ROUTE",
    label: "Segment capacity exceeded",
    outcome: "FAIL",
  },
  ROUTE_DETOUR_TOO_HIGH: { category: "ROUTE", label: "Detour too high", outcome: "FAIL" },
  ADDITIONAL_DISTANCE_TOO_HIGH: {
    category: "ROUTE",
    label: "Added distance too high",
    outcome: "FAIL",
  },
  CORRIDOR_EXTENSION_TOO_LONG: {
    category: "ROUTE",
    label: "Corridor extension too long",
    outcome: "FAIL",
  },
  ADDITIONAL_DURATION_TOO_HIGH: {
    category: "ROUTE",
    label: "Added duration too high",
    outcome: "FAIL",
  },
  EXISTING_PASSENGER_DELAY_TOO_HIGH: {
    category: "ROUTE",
    label: "Existing passenger delayed",
    outcome: "FAIL",
  },
  NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH: {
    category: "ROUTE",
    label: "New rider's journey stretched too far",
    outcome: "FAIL",
  },
  NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH: {
    category: "ROUTE",
    label: "New pickup delayed",
    outcome: "FAIL",
  },
  WAYPOINT_LIMIT_EXCEEDED: { category: "ROUTE", label: "Too many waypoints", outcome: "FAIL" },
  ROUTE_NO_FEASIBLE_INSERTION: {
    category: "ROUTE",
    label: "No feasible insertion",
    outcome: "FAIL",
  },

  // Pooling business rules ---------------------------------------------------
  POOLING_COMPATIBLE: { category: "POOLING", label: "Pooling allowed", outcome: "PASS" },
  POOLING_NOT_SUPPORTED: { category: "POOLING", label: "Vehicle pooling disabled", outcome: "FAIL" },
  POOLING_NOT_ALLOWED_BY_REQUEST: {
    category: "POOLING",
    label: "Request refuses pooling",
    outcome: "FAIL",
  },
  POOLING_NOT_ALLOWED_BY_EXISTING_RIDER: {
    category: "POOLING",
    label: "Existing rider refuses pooling",
    outcome: "FAIL",
  },
  MAX_POOLED_PASSENGERS_EXCEEDED: {
    category: "POOLING",
    label: "Too many pooled passengers",
    outcome: "FAIL",
  },

  // System -------------------------------------------------------------------
  DRIVER_NOT_FOUND: {
    category: "SYSTEM",
    label: "Driver record missing",
    outcome: "FAIL",
  },
  ROUTING_BUDGET_EXCEEDED: {
    category: "SYSTEM",
    label: "Routing budget exhausted",
    outcome: "FAIL",
  },
  ROUTING_FAILED: { category: "SYSTEM", label: "Routing call failed", outcome: "FAIL" },
  ROUTE_LEG_MISMATCH: { category: "SYSTEM", label: "Route leg count mismatch", outcome: "FAIL" },
} as const satisfies Record<string, ReasonDefinition>;

export type ReasonCode = keyof typeof REASONS;

export interface ReasonOptions {
  value?: number | string;
  threshold?: number | string;
  metadata?: Record<string, unknown>;
}

export function reason(code: ReasonCode, message: string, options: ReasonOptions = {}): MatchReason {
  return {
    code,
    category: REASONS[code].category,
    message,
    ...(options.value !== undefined ? { value: options.value } : {}),
    ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
  };
}

export function reasonLabel(code: ReasonCode): string {
  return REASONS[code].label;
}

export function reasonCategory(code: ReasonCode): ReasonCategory {
  return REASONS[code].category;
}

export function isFailureReason(code: ReasonCode): boolean {
  return REASONS[code].outcome === "FAIL";
}
