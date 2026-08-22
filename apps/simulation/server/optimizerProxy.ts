import type { IncomingMessage, ServerResponse } from "node:http";

import { GoogleAuth } from "google-auth-library";
import type { Plugin } from "vite";

const ENDPOINT_PATH = "/api/optimize-tours";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

interface ProxyShipment {
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

interface ProxyRequest {
  vehicleStart: { lat: number; lng: number };
  seatCapacity: number;
  shipments: ProxyShipment[];
  lockedVisits: { shipmentId: string; type: "PICKUP" | "DROP" }[];
  timeoutMs: number;
}

const auth = new GoogleAuth({ scopes: [SCOPE] });

function isoAt(baseMs: number, offsetMin: number): string {
  return new Date(baseMs + offsetMin * 60000).toISOString();
}

/**
 * Translates our request into Google's `ShipmentModel`.
 *
 * Time windows are absolute timestamps on the wire but relative minutes in our
 * model, so everything is anchored to a single `now` captured once per request
 * — anchoring per-shipment would let clock drift between two shipments produce
 * a model that is subtly infeasible for no reason we could ever debug.
 */
function toShipmentModel(request: ProxyRequest, nowMs: number): Record<string, unknown> {
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

  const model: Record<string, unknown> = {
    globalStartTime: isoAt(nowMs, 0),
    globalEndTime: isoAt(nowMs, 120),
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

  const payload: Record<string, unknown> = { timeout: `${String(request.timeoutMs / 1000)}s`, model };

  if (request.lockedVisits.length > 0) {
    payload.injectedSolutionConstraint = {
      routes: [
        {
          vehicleIndex: 0,
          visits: request.lockedVisits.map((visit) => ({
            shipmentIndex: shipmentIndexById.get(visit.shipmentId) ?? 0,
            isPickup: visit.type === "PICKUP",
          })),
        },
      ],
      constraintRelaxations: [
        {
          vehicleIndices: [0],
          relaxations: [
            {
              level: "RELAX_ALL_AFTER_THRESHOLD",
              thresholdVisitCount: request.lockedVisits.length,
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
      server.middlewares.use(ENDPOINT_PATH, (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        void (async () => {
          const project = process.env.GOOGLE_CLOUD_PROJECT;

          if (!project) {
            send(res, 503, {
              error:
                "GOOGLE_CLOUD_PROJECT is not set. Add it to apps/simulation/.env.local and restart the dev server.",
            });
            return;
          }

          let client;
          try {
            client = await auth.getClient();
          } catch (error) {
            send(res, 503, {
              error: `No Application Default Credentials found. Run \`gcloud auth application-default login\`. (${
                error instanceof Error ? error.message : "unknown error"
              })`,
            });
            return;
          }

          try {
            const parsed = JSON.parse(await readBody(req)) as ProxyRequest;
            const payload = toShipmentModel(parsed, Date.now());

            const response = await client.request({
              url: `https://routeoptimization.googleapis.com/v1/projects/${project}:optimizeTours`,
              method: "POST",
              data: payload,
            });

            send(res, 200, response.data);
          } catch (error) {
            const message = error instanceof Error ? error.message : "optimizeTours call failed";
            send(res, 502, { error: message });
          }
        })();
      });
    },
  };
}
