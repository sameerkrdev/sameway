import {
  RoutingBudgetExceededError,
  type RoutingEngineKind,
  type RoutingTelemetrySnapshot,
} from "./types";

/**
 * Counts what a run actually cost.
 *
 * Calls and matrix *elements* are tracked separately because they are billed
 * separately: one matrix call covering 24 drivers is one call and 24 elements.
 */
export class RoutingTelemetry {
  private routeCalls = 0;
  private matrixCalls = 0;
  private matrixElements = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private fallbackReason: string | null = null;
  private engine: RoutingEngineKind;

  constructor(
    engine: RoutingEngineKind,
    private readonly budgetLimit: number,
  ) {
    this.engine = engine;
  }

  get budgetUsed(): number {
    return this.routeCalls + this.matrixCalls;
  }

  get budgetRemaining(): number {
    return Math.max(0, this.budgetLimit - this.budgetUsed);
  }

  setEngine(engine: RoutingEngineKind): void {
    this.engine = engine;
  }

  setFallbackReason(message: string): void {
    this.fallbackReason = message;
  }

  recordCacheHit(): void {
    this.cacheHits += 1;
  }

  /**
   * Reserves one billed call. Throws rather than letting a scenario silently
   * issue hundreds of requests; the engine converts this into a
   * ROUTING_BUDGET_EXCEEDED verdict.
   */
  consumeRouteCall(): void {
    this.assertBudget();
    this.cacheMisses += 1;
    this.routeCalls += 1;
  }

  consumeMatrixCall(elementCount: number): void {
    this.assertBudget();
    this.cacheMisses += 1;
    this.matrixCalls += 1;
    this.matrixElements += elementCount;
  }

  hasBudget(): boolean {
    return this.budgetUsed < this.budgetLimit;
  }

  private assertBudget(): void {
    if (!this.hasBudget()) {
      throw new RoutingBudgetExceededError(this.budgetLimit);
    }
  }

  snapshot(): RoutingTelemetrySnapshot {
    return {
      engine: this.engine,
      routeCalls: this.routeCalls,
      matrixCalls: this.matrixCalls,
      matrixElements: this.matrixElements,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      budgetLimit: this.budgetLimit,
      budgetUsed: this.budgetUsed,
      budgetRemaining: this.budgetRemaining,
      fallbackReason: this.fallbackReason,
    };
  }
}
