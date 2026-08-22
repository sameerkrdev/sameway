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

  constructor(
    private readonly endpoint: string = OPTIMIZER_ENDPOINT,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    let response: Response;

    try {
      response = await this.fetchImpl(this.endpoint, {
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

    let body: unknown;

    try {
      body = await response.json();
    } catch (error) {
      throw new OptimizerUnavailableError(
        "Optimizer proxy returned a 2xx response with an unparseable body.",
        error,
      );
    }

    return readOptimizeToursResponse(request, body);
  }
}

/**
 * Only for the error-body branches (503 / !response.ok), where a missing or
 * unparseable body is not itself the problem — the status code already told
 * us what went wrong, and this merely tries to enrich the message with an
 * `.error` string if one happens to be present. Never use this on the success
 * path: there, a parse failure IS the problem and must not be swallowed into
 * a fake "nothing to schedule" result.
 */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
