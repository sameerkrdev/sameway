import { resolve, isAbsolute } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { GoogleAuth } from "google-auth-library";
import { loadEnv, type Plugin } from "vite";

const ENDPOINT_PATH = "/api/optimize-tours";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export interface ProxyShipment {
  id: string;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  seats: number;
  pickupDeadlineMin?: number;
  dropDeadlineMin?: number;
  penaltyCost: number | null;
  softPickupDeadlineMin?: number;
  softDeadlineCostPerHour?: number;
}

export interface ProxyLockedVisit {
  shipmentId: string;
  type: "PICKUP" | "DROP";
  /**
   * Minutes from `now` for this visit's injected `startTime`. Google requires
   * non-decreasing times on an injected route (`vehicleStartTime` ≤ visit
   * start times). When omitted, the proxy staggers visits by index.
   */
  startMin?: number;
}

export interface ProxyRequest {
  vehicleStart: { lat: number; lng: number };
  seatCapacity: number;
  shipments: ProxyShipment[];
  lockedVisits: ProxyLockedVisit[];
  timeoutMs: number;
}

function resolveCredentialsPath(envDir: string, credentialsPath: string): string {
  return isAbsolute(credentialsPath) ? credentialsPath : resolve(envDir, credentialsPath);
}

/**
 * Vite only exposes VITE_* vars to client code; server middleware must load
 * .env files itself via loadEnv (same merge order as the rest of the app).
 */
function loadOptimizerEnv(mode: string, envDir: string): {
  project: string | undefined;
  credentialsPath: string | undefined;
} {
  const env = loadEnv(mode, envDir, "");
  const project = env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  const credentialsPath =
    env.GOOGLE_APPLICATION_CREDENTIALS ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credentialsPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = resolveCredentialsPath(envDir, credentialsPath);
  }

  return { project, credentialsPath };
}

/**
 * Thrown when the request body itself is malformed — a bad value from our own
 * client, not an upstream failure. Kept distinct from upstream errors so a 400
 * (our fault) is never confused with a 502 (Google's call failed).
 */
class ProxyBadRequestError extends Error {}

/**
 * RFC 3339 whole-second timestamps only. OptimizeTours rejects fractional
 * seconds (`nanos must be unset`), and `Date.toISOString()` always emits ms.
 */
function isoAt(baseMs: number, offsetMin: number): string {
  const wholeSecondMs = Math.floor((baseMs + offsetMin * 60000) / 1000) * 1000;
  return new Date(wholeSecondMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Protobuf Duration as whole seconds in [1, 1800]. OptimizeTours rejects
 * sub-second values (`"0.4s"` from the old 400ms default → `invalid duration`).
 */
function durationFromMs(timeoutMs: number): string {
  const seconds = Math.min(1800, Math.max(1, Math.ceil(timeoutMs / 1000)));
  return `${String(seconds)}s`;
}

/**
 * Translates our request into Google's `ShipmentModel`.
 *
 * Time windows are absolute timestamps on the wire but relative minutes in our
 * model, so everything is anchored to a single `now` captured once per request
 * — anchoring per-shipment would let clock drift between two shipments produce
 * a model that is subtly infeasible for no reason we could ever debug.
 */
export function toShipmentModel(
  request: ProxyRequest,
  nowMs: number,
): Record<string, unknown> {
  const shipments = request.shipments.map((shipment) => {
    const pickupVisit: Record<string, unknown> = {
      arrivalWaypoint: { location: { latLng: { latitude: shipment.pickup.lat, longitude: shipment.pickup.lng } } },
    };

    const pickupWindow: Record<string, unknown> = {};
    if (shipment.pickupDeadlineMin !== undefined) {
      pickupWindow.endTime = isoAt(nowMs, shipment.pickupDeadlineMin);
    }
    if (shipment.softPickupDeadlineMin !== undefined) {
      pickupWindow.softEndTime = isoAt(nowMs, shipment.softPickupDeadlineMin);
      pickupWindow.costPerHourAfterSoftEndTime = shipment.softDeadlineCostPerHour ?? 50;
    }
    if (Object.keys(pickupWindow).length > 0) {
      pickupVisit.timeWindows = [pickupWindow];
    }

    const deliveryVisit: Record<string, unknown> = {
      arrivalWaypoint: { location: { latLng: { latitude: shipment.drop.lat, longitude: shipment.drop.lng } } },
    };

    if (shipment.dropDeadlineMin !== undefined) {
      deliveryVisit.timeWindows = [{ endTime: isoAt(nowMs, shipment.dropDeadlineMin) }];
    }

    const model: Record<string, unknown> = {
      pickups: [pickupVisit],
      deliveries: [deliveryVisit],
      loadDemands: { seats: { amount: String(shipment.seats) } },
    };

    // A null penalty means mandatory. Omitting the field entirely is how the
    // API expresses that; sending `null` would be rejected.
    if (shipment.penaltyCost !== null) {
      model.penaltyCost = shipment.penaltyCost;
    }

    return model;
  });

  const shipmentIndexById = new Map(request.shipments.map((shipment, index) => [shipment.id, index]));

  function resolveShipmentIndex(shipmentId: string): number {
    const index = shipmentIndexById.get(shipmentId);
    if (index === undefined) {
      throw new ProxyBadRequestError(
        `lockedVisits references shipmentId "${shipmentId}", which is not present in shipments.`,
      );
    }
    return index;
  }

  const globalStartTime = isoAt(nowMs, 0);
  // Horizon must clear the latest hard window we emit; otherwise Google can
  // mark a feasible spine as out-of-horizon after travel times land.
  let latestDeadlineMin = 120;
  for (const shipment of request.shipments) {
    for (const value of [
      shipment.pickupDeadlineMin,
      shipment.dropDeadlineMin,
      shipment.softPickupDeadlineMin,
    ]) {
      if (value !== undefined) {
        latestDeadlineMin = Math.max(latestDeadlineMin, value + 30);
      }
    }
  }
  const globalEndTime = isoAt(nowMs, latestDeadlineMin);

  const model: Record<string, unknown> = {
    globalStartTime,
    globalEndTime,
    vehicles: [
      {
        startWaypoint: {
          location: {
            latLng: { latitude: request.vehicleStart.lat, longitude: request.vehicleStart.lng },
          },
        },
        loadLimits: { seats: { maxLoad: String(request.seatCapacity) } },
      },
    ],
    shipments,
  };

  const payload: Record<string, unknown> = { timeout: durationFromMs(request.timeoutMs), model };

  if (request.lockedVisits.length > 0) {
    // Injected routes must satisfy the same validity rules as
    // injectedFirstSolutionRoutes: non-decreasing times from vehicleStartTime
    // through every visit startTime to vehicleEndTime. Omitting
    // vehicleStartTime is rejected outright ("missing vehicle_start_time").
    //
    // Visit startTimes are seeded from originalEtaMin when provided; otherwise
    // we stagger by index so equal-zero sketch ETAs still form a valid chain.
    // Actual travel times are free because we relax visit times from the
    // vehicle start (see constraintRelaxations below).
    let lastStartMin = 0;
    const visits = request.lockedVisits.map((visit, index) => {
      const raw = visit.startMin ?? index;
      const startMin = Math.max(raw, lastStartMin);
      lastStartMin = startMin;
      return {
        shipmentIndex: resolveShipmentIndex(visit.shipmentId),
        isPickup: visit.type === "PICKUP",
        startTime: isoAt(nowMs, startMin),
      };
    });

    const spineLength = request.lockedVisits.length;

    payload.injectedSolutionConstraint = {
      routes: [
        {
          vehicleIndex: 0,
          vehicleStartTime: globalStartTime,
          // End is relaxed (RELAX_VISIT_TIMES / RELAX_ALL at vehicle end) but
          // must still be ≥ the last injected visit for the validity check.
          vehicleEndTime: isoAt(nowMs, Math.max(lastStartMin, latestDeadlineMin)),
          visits,
        },
      ],
      constraintRelaxations: [
        {
          vehicleIndices: [0],
          relaxations: [
            // Free all injected start times so zero/rough ETAs cannot make the
            // locked spine travel-infeasible while its sequence stays fixed.
            {
              level: "RELAX_VISIT_TIMES_AFTER_THRESHOLD",
              thresholdVisitCount: 0,
            },
            // Allow new visits only after the locked spine. threshold = N+1
            // targets the vehicle end (docs: route.visits_size()+1), not the
            // last locked visit — using N accidentally RELAX_ALL'd that visit.
            {
              level: "RELAX_ALL_AFTER_THRESHOLD",
              thresholdVisitCount: spineLength + 1,
            },
          ],
        },
      ],
    };
  }

  return payload;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Prefer Google's validation message over the generic Gaxios wrapper text so
 * the UI shows e.g. "missing vehicle_start_time" instead of only HTTP 400.
 */
function formatUpstreamError(error: unknown): string {
  if (error && typeof error === "object") {
    const withResponse = error as {
      response?: { data?: unknown };
      message?: string;
    };
    const data = withResponse.response?.data;
    if (data && typeof data === "object") {
      const googleError = data as {
        error?: { message?: string; status?: string };
        message?: string;
      };
      const nested = googleError.error?.message ?? googleError.message;
      if (typeof nested === "string" && nested.length > 0) {
        return nested;
      }
    }
    if (typeof withResponse.message === "string" && withResponse.message.length > 0) {
      return withResponse.message;
    }
  }

  return error instanceof Error ? error.message : "optimizeTours call failed";
}

/**
 * Registers the optimizer proxy on the Vite dev server.
 *
 * This exists only under `bun run dev`. A production build has no server, so
 * the app there shows the optimizer-unavailable state rather than half-working
 * — which is correct: this is a lab tool, not something anyone deploys.
 */
export function optimizerProxyPlugin(): Plugin {
  return {
    name: "sameway-optimizer-proxy",
    configureServer(server) {
      const envDir = typeof server.config.envDir === "string" ? server.config.envDir : process.cwd();
      const optimizerEnv = loadOptimizerEnv(server.config.mode, envDir);

      server.middlewares.use(ENDPOINT_PATH, (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        void (async () => {
          const project = optimizerEnv.project;

          if (!project) {
            send(res, 503, {
              error:
                "GOOGLE_CLOUD_PROJECT is not set. Add it to apps/simulation/.env.local and restart the dev server.",
            });
            return;
          }

          if (!optimizerEnv.credentialsPath) {
            send(res, 503, {
              error:
                "GOOGLE_APPLICATION_CREDENTIALS is not set. Add a service account JSON key path to apps/simulation/.env.local and restart the dev server.",
            });
            return;
          }

          let client;
          try {
            const auth = new GoogleAuth({ scopes: [SCOPE] });
            client = await auth.getClient();
          } catch (error) {
            send(res, 503, {
              error: `No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS in apps/simulation/.env.local to a service account JSON key path. (${
                error instanceof Error ? error.message : "unknown error"
              })`,
            });
            return;
          }

          let parsed: ProxyRequest;
          try {
            parsed = JSON.parse(await readBody(req)) as ProxyRequest;
          } catch {
            send(res, 400, { error: "Request body is not valid JSON." });
            return;
          }

          let payload: Record<string, unknown>;
          try {
            payload = toShipmentModel(parsed, Date.now());
          } catch (error) {
            if (error instanceof ProxyBadRequestError) {
              send(res, 400, { error: error.message });
            } else {
              const message = error instanceof Error ? error.message : "Malformed optimize-tours request.";
              send(res, 400, { error: message });
            }
            return;
          }

          try {
            const response = await client.request({
              url: `https://routeoptimization.googleapis.com/v1/projects/${project}:optimizeTours`,
              method: "POST",
              data: payload,
            });

            send(res, 200, response.data);
          } catch (error) {
            send(res, 502, { error: formatUpstreamError(error) });
          }
        })();
      });
    },
  };
}
