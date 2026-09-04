import type { OptimizerEngineKind, OptimizerTelemetrySnapshot } from "./types";

/**
 * Counts what a run actually spent at stage 8.
 *
 * Kept separate from `RoutingTelemetry` because the two have separate budgets
 * and separate pricing models: routing bills per call, the optimizer bills per
 * shipment. Merging them would hide which one is the expensive half.
 */
export class OptimizerTelemetry {
  private callCount = 0;
  private shipmentCount = 0;
  private hits = 0;
  private misses = 0;
  private unavailableReason: string | null = null;

  constructor(
    private readonly engine: OptimizerEngineKind,
    private readonly budgetLimit: number,
  ) {}

  recordCall(shipments: number): void {
    this.callCount += 1;
    this.shipmentCount += shipments;
  }

  recordCacheHit(): void {
    this.hits += 1;
  }

  recordCacheMiss(): void {
    this.misses += 1;
  }

  setUnavailableReason(reason: string | null): void {
    this.unavailableReason = reason;
  }

  get budgetRemaining(): number {
    return Math.max(0, this.budgetLimit - this.callCount);
  }

  snapshot(): OptimizerTelemetrySnapshot {
    return {
      engine: this.engine,
      calls: this.callCount,
      shipmentsBilled: this.shipmentCount,
      cacheHits: this.hits,
      cacheMisses: this.misses,
      budgetLimit: this.budgetLimit,
      budgetUsed: this.callCount,
      budgetRemaining: this.budgetRemaining,
      unavailableReason: this.unavailableReason,
    };
  }
}
