import type { MatchingSettings } from "@/domain/entities";

import { InstrumentedOptimizerEngine } from "./InstrumentedOptimizerEngine";
import { OptimizeToursEngine } from "./OptimizeToursEngine";
import { OptimizerCache } from "./OptimizerCache";
import { OptimizerTelemetry } from "./OptimizerTelemetry";
import type { OptimizerEngine } from "./types";

export * from "./types";
export { buildOptimizeToursRequest, shipmentIdFor } from "./ShipmentModelBuilder";
export type { BuildShipmentModelInput, CommittedStopInput } from "./ShipmentModelBuilder";
export { readOptimizeToursResponse, toProposedStopSequence } from "./SolutionReader";
export { OptimizeToursEngine, OPTIMIZER_ENDPOINT } from "./OptimizeToursEngine";
export { OptimizerCache } from "./OptimizerCache";
export { OptimizerTelemetry } from "./OptimizerTelemetry";
export { InstrumentedOptimizerEngine } from "./InstrumentedOptimizerEngine";

export interface OptimizerStack {
  engine: OptimizerEngine;
  telemetry: OptimizerTelemetry;
  cache: OptimizerCache;
}

export type OptimizerSettings = Pick<
  MatchingSettings,
  "maxOptimizerCallsPerRun" | "optimizerTimeoutMs"
>;

export interface CreateOptimizerStackOptions {
  settings: OptimizerSettings;
  /** Injected by tests. Defaults to the HTTP engine talking to the proxy. */
  engine?: OptimizerEngine;
  cache?: OptimizerCache;
}

export function createOptimizerStack(options: CreateOptimizerStackOptions): OptimizerStack {
  const delegate = options.engine ?? new OptimizeToursEngine();
  const cache = options.cache ?? new OptimizerCache();
  const telemetry = new OptimizerTelemetry(delegate.kind, options.settings.maxOptimizerCallsPerRun);

  return {
    engine: new InstrumentedOptimizerEngine(delegate, cache, telemetry),
    telemetry,
    cache,
  };
}
