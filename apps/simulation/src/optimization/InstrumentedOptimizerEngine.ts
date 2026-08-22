import type { OptimizerCache } from "./OptimizerCache";
import type { OptimizerTelemetry } from "./OptimizerTelemetry";
import {
  OptimizerBudgetExceededError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "./types";

/**
 * Wraps an optimizer with cache, budget and telemetry.
 *
 * The budget is checked after the cache, never before: a cached answer costs
 * nothing, and refusing to serve it because the budget is spent would make
 * repeat runs of the same scenario progressively less useful.
 */
export class InstrumentedOptimizerEngine implements OptimizerEngine {
  readonly kind: OptimizerEngine["kind"];

  constructor(
    private readonly delegate: OptimizerEngine,
    private readonly cache: OptimizerCache,
    private readonly telemetry: OptimizerTelemetry,
  ) {
    this.kind = delegate.kind;
  }

  async optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    const cached = this.cache.get(request);

    if (cached) {
      this.telemetry.recordCacheHit();
      return cached;
    }

    this.telemetry.recordCacheMiss();

    if (this.telemetry.budgetRemaining <= 0) {
      throw new OptimizerBudgetExceededError(this.telemetry.snapshot().budgetLimit);
    }

    this.telemetry.recordCall(request.shipments.length);
    const result = await this.delegate.optimize(request);
    this.cache.set(request, result);

    return result;
  }
}
