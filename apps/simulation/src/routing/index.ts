import type { MatchingSettings } from "@/domain/entities";

import { InstrumentedRoutingEngine } from "./InstrumentedRoutingEngine";
import { MockRoutingEngine } from "./MockRoutingEngine";
import { RoutingCache } from "./RoutingCache";
import { RoutingTelemetry } from "./RoutingTelemetry";
import type { RoutingEngine } from "./types";

export * from "./types";
export { GoogleRoutesEngine } from "./GoogleRoutesEngine";
export {
  createGoogleRoutesEngine,
  hasApiKey,
  preloadRoutesLibrary,
  routesLibraryStatus,
} from "./googleEngineFactory";
export { InstrumentedRoutingEngine } from "./InstrumentedRoutingEngine";
export { MockRoutingEngine, DEFAULT_MOCK_OPTIONS } from "./MockRoutingEngine";
export { RoutingCache } from "./RoutingCache";
export { RoutingTelemetry } from "./RoutingTelemetry";

export interface RoutingStack {
  engine: RoutingEngine;
  telemetry: RoutingTelemetry;
  cache: RoutingCache;
}

export type RoutingSettings = Pick<
  MatchingSettings,
  "routingMode" | "maxRoutingCallsPerRun" | "cacheCoordinatePrecision"
>;

export interface CreateRoutingStackOptions {
  settings: RoutingSettings;
  /**
   * Supplied by the browser layer in Phase 8. Returns `null` when the Routes
   * library or API key is unavailable, which triggers an explicit fallback
   * rather than a crash.
   */
  createGoogleEngine?: () => RoutingEngine | null;
  /** Pass a long-lived cache to reuse baseline routes across runs. */
  cache?: RoutingCache;
}

/**
 * Chooses the routing engine for a run and wires caching, budget and
 * telemetry around it.
 *
 * Fallback is never silent: when Google is requested but unusable, the
 * telemetry snapshot carries a `fallbackReason` that the UI renders as a
 * persistent banner. Mixing engines mid-run is not possible by construction —
 * the choice is made once, here.
 */
export function createRoutingStack(options: CreateRoutingStackOptions): RoutingStack {
  const { settings, createGoogleEngine } = options;
  const cache =
    options.cache ??
    new RoutingCache({ coordinatePrecision: settings.cacheCoordinatePrecision });

  let delegate: RoutingEngine = new MockRoutingEngine();
  let fallbackReason: string | null = null;

  if (settings.routingMode === "MOCK") {
    fallbackReason = null;
  } else {
    const google = safeCreateGoogleEngine(createGoogleEngine);

    if (google.engine) {
      delegate = google.engine;
    } else {
      fallbackReason =
        google.reason ?? "Google Routes engine was not provided by the host application";
    }
  }

  const telemetry = new RoutingTelemetry(delegate.kind, settings.maxRoutingCallsPerRun);

  if (fallbackReason) {
    telemetry.setFallbackReason(fallbackReason);
  }

  return {
    engine: new InstrumentedRoutingEngine(delegate, cache, telemetry),
    telemetry,
    cache,
  };
}

function safeCreateGoogleEngine(factory?: () => RoutingEngine | null): {
  engine: RoutingEngine | null;
  reason?: string;
} {
  if (!factory) {
    return { engine: null };
  }

  try {
    const engine = factory();
    if (!engine) {
      return {
        engine: null,
        reason: "Google Maps Routes library or API key unavailable",
      };
    }
    return { engine };
  } catch (error) {
    return {
      engine: null,
      reason: error instanceof Error ? error.message : "Google Routes engine failed to initialise",
    };
  }
}
