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
  | "ETA"
  | "ROUTE"
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

  // Pickup ETA ---------------------------------------------------------------
  PICKUP_ETA_OK: { category: "ETA", label: "Pickup ETA acceptable", outcome: "PASS" },
  PICKUP_ETA_TOO_HIGH: { category: "ETA", label: "Pickup ETA too high", outcome: "FAIL" },
  PICKUP_DISTANCE_TOO_HIGH: { category: "ETA", label: "Pickup too far", outcome: "FAIL" },
  PICKUP_UNREACHABLE: { category: "ETA", label: "Pickup unreachable", outcome: "FAIL" },

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
