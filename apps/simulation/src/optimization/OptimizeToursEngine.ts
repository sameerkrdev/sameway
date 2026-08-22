import { readOptimizeToursResponse } from "./SolutionReader";
import {
  OptimizerCredentialsMissingError,
  OptimizerUnavailableError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "./types";

export const OPTIMIZER_ENDPOINT = "/api/optimize-tours";

/**
 * Talks to `OptimizeTours` through the dev-server proxy.
 *
 * The browser never holds a credential: the proxy signs the request with
 * Application Default Credentials server-side. That is why this engine is
 * reachable only under `bun run dev` — a built bundle has no proxy behind it.
 */
export class OptimizeToursEngine implements OptimizerEngine {
  readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;

  constructor(private readonly endpoint: string = OPTIMIZER_ENDPOINT) {}

  async optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new OptimizerUnavailableError(
        "Could not reach the optimizer proxy. It only exists under `bun run dev`.",
        error,
      );
    }

    if (response.status === 503) {
      const body = (await safeJson(response)) as { error?: string };
      throw new OptimizerCredentialsMissingError(
        body.error ?? "The optimizer proxy has no usable Google credentials",
      );
    }

    if (!response.ok) {
      const body = (await safeJson(response)) as { error?: string };
      throw new OptimizerUnavailableError(
        body.error ?? `Optimizer proxy returned HTTP ${String(response.status)}`,
      );
    }

    return readOptimizeToursResponse(request, await safeJson(response));
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
