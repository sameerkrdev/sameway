# Simulation — 13-Stage Pipeline + Google Route Optimization

**Date:** 2026-08-22
**Scope:** `apps/simulation` only. No other app in the monorepo is modified.
**Source of truth:** `docs/Overview.md`

## Problem

`apps/simulation` implements a nine-stage matching pipeline that predates
`docs/Overview.md`. The Overview specifies thirteen stages (0–12), a different
spatial primitive, a different routing method, and a different scoring formula.
The lab is meant to be the executable, inspectable version of that document, so
the divergence makes it unusable as a reference.

Concretely, the gaps are:

| Overview stage | Today in `apps/simulation` |
| --- | --- |
| 0 Basic eligibility | Present, split across `driverStatusFilter`, `vehicleFilter`, `capacityPreFilter` |
| 1 Operational-state filter | **Missing** |
| 2 H3 route-corridor filter | Indexes the driver's **current GPS cell**, not the ride's remaining-route corridor |
| 3 Pickup → route distance | **Missing** — `pickupEtaFilter` measures driver→pickup instead |
| 4 Direction / destination compatibility | **Missing** (`lib/geo.ts` has `bearingDeg`, unused by any stage) |
| 5 Generate legal stop sequences | Present inside `routeInsertion.ts` |
| 6 Flexible pickup time-window filter | Global threshold only; no per-passenger budget |
| 7 Cheap geometry / detour lower bound | Top-N straight-line prune, not a provable lower bound |
| 8 Actual road routing | `computeRoutes` per insertion candidate; **not `OptimizeTours`** |
| 9 Incremental cost | Partial, entangled with stage 6 |
| 10 Hard constraints | Entangled with stage 6 |
| 11 Scoring | `eta/distance/detour/routeQuality/fairness`, not the 30/30/25/15 fairness formula |
| 12 Commit | **Missing** |

## Decisions

Settled with the project owner before this document was written:

1. **Stage 8 uses Google `OptimizeTours` through a proxy only.** No in-house
   solver fallback is built.
2. **The pipeline is rewritten to the Overview's thirteen stages**, not patched
   additively. `StageId` changes.
3. **H3 indexes the remaining-route corridor**, with idle drivers falling back
   to a single-cell corridor at their location.
4. **Stage 12 commits**: the winning sequence is written back into the scenario,
   so a following request is matched against the post-commit route.
5. **The proxy authenticates with ADC.** With no credentials, a run refuses to
   start rather than degrading per-driver.
6. **Scenario schema bumps to v2 with a migration**, so previously exported v1
   JSON still imports.
7. **The proxy is dev-server only** and documented as such.

## Architecture

```
React UI → Zustand stores → MatchingService → engine.ts → 13 stages
                                                   │
                        ┌──────────────────────────┼───────────────────┐
                        ▼                          ▼                   ▼
                 corridor.ts (H3)          RoutingEngine        OptimizerEngine
                                                   │                   │
                                    GoogleRoutesEngine|Mock    OptimizeToursEngine
                                                                       │
                                                          POST /api/optimize-tours
                                                                       │
                                              Vite middleware (ADC, server-side)
                                                                       │
                                            routeoptimization.googleapis.com
```

`domain`, `lib`, `routing`, `optimization` and `matching` stay free of React and
`google.maps` imports, preserving the "lift into a Node service unchanged"
property. The proxy is the one deliberately Node-only file and lives outside
`src/`.

### New module — `src/optimization/`

Mirrors the existing `src/routing/` structure so the two read the same way.

| File | Responsibility |
| --- | --- |
| `types.ts` | `OptimizerEngine` interface plus our own request/response types. Google's wire shape never leaks past this module. |
| `OptimizeToursEngine.ts` | `POST /api/optimize-tours`; maps HTTP and solver errors onto typed errors. |
| `ShipmentModelBuilder.ts` | Builds the `ShipmentModel` from a driver, their committed spine, and the new request. |
| `SolutionReader.ts` | Reads a `ShipmentRoute` back into `ProposedStop[]` + `RouteLegResult[]`, and surfaces `skippedShipments[]`. |
| `OptimizerTelemetry.ts` | Calls issued, shipments billed, budget remaining. Feeds the debug console alongside routing telemetry. |
| `OptimizerCache.ts` | Same keying discipline as `RoutingCache`: every parameter that changes the answer is in the key. |

`OptimizerEngine` interface:

```ts
export interface OptimizerEngine {
  readonly kind: "GOOGLE_OPTIMIZE_TOURS";
  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult>;
}
```

`OptimizeToursRequest` carries the vehicle start (driver's current GPS), the
shipment list, the locked spine, and a timeout. `OptimizeToursResult` carries
the ordered visits, per-leg distance and duration, and `skippedShipmentIds`.

### The proxy — `server/optimizerProxy.ts`

A Vite `configureServer` middleware registered from `vite.config.ts`.

- Auth: `GoogleAuth` from `google-auth-library`, scope
  `https://www.googleapis.com/auth/cloud-platform`. Picks up
  `GOOGLE_APPLICATION_CREDENTIALS` or a `gcloud auth application-default login`
  session. No key material is committed or read from `.env`.
- Project id from `GOOGLE_CLOUD_PROJECT`.
- Forwards to
  `POST https://routeoptimization.googleapis.com/v1/projects/{PROJECT}:optimizeTours`.
- On missing credentials or missing project id it responds `503` with a
  structured body. The client turns that into a run-level abort (see below).
- Only reachable during `bun run dev`. `bun run build` produces static files with
  no proxy; the README states this and the app shows the unavailable state.

**Credential handling:** the middleware never returns the access token to the
browser, and never logs it. Request and response bodies are logged only behind a
debug flag, since they contain rider coordinates.

### Stage registry

`StageId` becomes:

```ts
export type StageId =
  | "requestValidation"      // pre-stage, unchanged in spirit
  | "basicEligibility"       // 0
  | "operationalState"       // 1
  | "h3RouteCorridor"        // 2
  | "pickupRouteDistance"    // 3
  | "directionCompatibility" // 4
  | "stopSequenceGeneration" // 5
  | "pickupTimeWindow"       // 6
  | "detourLowerBound"       // 7
  | "roadRouting"            // 8
  | "incrementalCost"        // 9
  | "hardConstraints"        // 10
  | "scoring"                // 11
  | "commit";                // 12
```

Mapping from today's code:

- `driverStatusFilter` + `vehicleFilter` + `capacityPreFilter` merge into
  `basicEligibility`. Their reason codes are kept verbatim so the rejection
  dashboard keeps its resolution — merging stages must not merge reasons.
- `h3CandidateGeneration` becomes `h3RouteCorridor` with new internals.
- `pickupEtaFilter` is replaced by `pickupRouteDistance` (stage 3), which is
  geometric and free. The driver→pickup ETA it used to compute is no longer a
  gate; it is produced by stage 8 as part of the solution and used in scoring.
- `routeFeasibility` splits four ways: enumeration into stage 5, the delay
  window check into stage 6, the lower-bound prune into stage 7, and the routed
  evaluation into stages 8/9/10.
- `poolingRules` folds into `hardConstraints` (10) but keeps its own reason
  codes and its own `POOLING` category.

`routeInsertion.ts` splits into `matching/insertion/enumerate.ts` (free, pure)
and `matching/insertion/evaluate.ts` (consumes solver output). Neither file
issues a routing call any more; stage 8 owns all remote calls.

`STAGE_METADATA` in `pipeline.ts`, `DEFAULT_STAGE_ORDER` in `settings.ts`, and
the funnel UI in `components/debug/StagePipeline.tsx` follow the new list. The
`BRIEF_STAGE_ORDER` A/B alternative is dropped — the Overview order is now the
only order that means anything, and a reorderable list of thirteen stages whose
data dependencies are strict would mostly produce invalid configurations.

### Stage 1 — Operational state

For each ride, classify every committed-but-not-yet-collected passenger and
compute their remaining delay budget:

```
budget = passenger.maxPickupDelayMin - (nowEta - stop.originalEtaMin)
```

This stage does not reject drivers. It annotates the ride with which stops are
flexible and by how much, which is what stages 5 and 6 consume when deciding
which orderings are legal. A driver is only rejected here if *every* committed
stop has a zero budget and the vehicle is full — a genuine dead end.

### Stage 2 — H3 route corridor

New `matching/corridor.ts`. `lib/h3.ts` gains `cellsForPath(points, resolution)`,
keeping the existing ESLint rule that `h3-js` is imported nowhere else.

Build:

1. For each ride, take the **remaining** stops — those at or after the driver's
   current position in the sequence. Historical stops are excluded; a pickup that
   is geometrically on the route but behind the vehicle must not match.
2. Convert consecutive remaining-stop pairs into H3 cells along the segment.
3. Expand each cell with `gridDisk(cell, 1)`.
4. Index `cell → rideId[]`.

Idle drivers (no current ride, no remaining stops) index as a single-cell
corridor at their location, so solo matching keeps working unchanged.

Search: ring-expand from the pickup cell up to `maxH3Ring`, accumulating until
`minimumUsableCandidates` usable drivers are found. "Usable" keeps today's
meaning. `discoveredRing` and `h3GridDistance` remain unitless hop counts and are
never compared against a distance or ETA — the existing four-measure discipline
in the README is unchanged and still enforced by review.

### Stage 3 — Pickup → route distance

Minimum distance from the pickup point to the remaining-route polyline, computed
as point-to-segment over the segment list. Free. Threshold:
`maxPickupToRouteDistanceKm`. Explicitly documented as an approximation, not the
real detour — a pickup 500 m off-route can cost a 1 km round trip, which only
stage 8 knows.

### Stage 4 — Direction / destination compatibility

Three cheap geometric signals, all free:

1. **Bearing difference** between the remaining route's overall bearing and the
   request's pickup→drop bearing, against `maxBearingDifferenceDeg`.
2. **Destination-to-route distance**, same point-to-polyline routine as stage 3,
   against `maxDropToRouteDistanceKm`.
3. **Destination route progress** — the destination's projected position along
   the remaining route must be ahead of the vehicle's current progress. A
   destination behind the vehicle rejects regardless of proximity.

Distinct reason codes per signal, so the dashboard distinguishes "wrong
direction" from "destination too far off corridor" from "destination behind".

### Stage 5 — Legal stop sequences

Today's enumeration, unchanged in arithmetic: the new pickup at every slot `i`,
the new drop at every slot `j >= i`, existing order frozen, giving exactly
`(n+1)(n+2)/2` candidates. Segment-occupancy pruning (seeded with
`computeOnboardSeats`) stays here and stays free. No routing.

### Stage 6 — Flexible pickup time window

Per-passenger, using the new schema fields. For each candidate sequence and each
committed passenger whose stop the new rider is inserted ahead of:

```
delay = projectedEta - stop.originalEtaMin
reject the sequence if delay > passenger.maxPickupDelayMin   (pickup stops)
reject the sequence if delay > passenger.maxDropDelayMin     (drop stops)
```

Projected ETA at this stage is the straight-line estimate; it is a pre-filter
that shrinks the solver's search space. Stage 10 re-checks the same budgets
against the solver's real leg times, and the same budgets are also encoded as
hard `timeWindows` in the `ShipmentModel`. Three places, one source of truth: the
passenger record.

Rejects orderings, never the driver — a driver survives if any ordering does.

### Stage 7 — Detour lower bound

Straight-line added length is an admissible lower bound on road added length. If
the bound already exceeds `maxAdditionalDistanceKm`, reject before stage 8. Pure
cost optimisation; it changes no outcome, only the call count. Distinct from
today's top-N prune, which discarded valid candidates — this discards only
provably-infeasible ones. `maxRoutedInsertionsPerDriver` is retained as a
separate hard cap applied after the bound.

### Stage 8 — Road routing via `OptimizeTours`

One call per surviving driver. Approach B (one call per run, every driver as a
`Vehicle`) was considered and rejected: the solver would make the assignment
decision, which erases per-driver rejection reasons and replaces stage 11 —
destroying the reason the lab exists.

Request shape per driver:

- **Vehicle** — `startWaypoint` at the driver's **current GPS**, not the trip
  origin, so only the remaining route is planned. `loadLimits.seats.maxLoad` from
  the vehicle record.
- **Committed passengers** — one `Shipment` each, `pickups[]` + `deliveries[]`
  giving precedence for free, `penaltyCost: null` so the solver cannot drop them,
  hard `timeWindows.endTime` from their per-passenger delay budget.
- **New passenger** — one `Shipment` with a finite `penaltyCost` and a
  `softEndTime` + `costPerHourAfterSoftEndTime` on the pickup, so infeasibility
  arrives as `skippedShipments[]` rather than a failed request.
- **`injectedSolutionConstraint`** — the committed spine as fixed visits, with
  `RELAX_ALL_AFTER_THRESHOLD` at `thresholdVisitCount = spineLength`.
- **`timeout`** — from settings, defaulting to `400ms`, matching the Overview's
  matching budget.

Outcome per driver:

- A `ShipmentRoute` → ordered visits + per-leg distance and duration, handed to
  stage 9 in exactly the shape `RouteLegResult[]` already has.
- The new passenger in `skippedShipments[]` → a clean `OPTIMIZER_INFEASIBLE`
  rejection with no further processing.
- A leg count that disagrees with the visit count → `ROUTE_LEG_MISMATCH`, the
  existing guard, retained so durations are never misattributed to the wrong
  passenger.

**Baselines** still come from `RoutingEngine`, cached: one route call for the
driver's pre-insertion sequence (needed for the deltas in stage 9) and one shared
call for the new rider's solo pickup→drop time. Keeping these on the Routes API
avoids paying `OptimizeTours` shipment pricing for a measurement with no
optimisation in it.

**Two independent budgets**, both surfaced in the debug console:

- `maxRoutingCallsPerRun` — baselines, as today.
- `maxOptimizerCallsPerRun` — stage 8. Drivers past the cap report
  `NOT_EVALUATED` with `OPTIMIZER_BUDGET_EXCEEDED`, never a rejection.

**Unavailability is a run-level abort.** If the proxy reports missing
credentials, `MatchingService` refuses to start the run and the UI shows a
blocking message with the `gcloud` command to fix it. This is per decision 5 — no
per-driver `NOT_EVALUATED` ambiguity.

### Stage 9 — Incremental cost

Measures only; rejects nothing. Per party, from the solver's leg data against the
baselines:

```
driver:              Δdistance, Δduration
existing passenger:  pickupDelay, dropDelay   (per passenger, and the max)
new passenger:       pickupEta, pickupDelay, rideDetour vs solo time
```

Most of this already exists in `delays.ts` (`buildArrivalTimeline`,
`computeExistingPassengerDelays`, `computeExistingPickupDelays`) and is reused
rather than rewritten; the change is that it now consumes solver legs and lives
in its own stage.

### Stage 10 — Hard constraints

Binary checks against the stage 9 measurements, in a fixed order so the reported
rejection is deterministic:

| Check | Setting |
| --- | --- |
| Driver extra duration | `maxAdditionalDurationMin` |
| Driver extra distance | `maxAdditionalDistanceKm` |
| Detour percent | `maxDetourPercent` |
| Existing passenger delay | per-passenger budget, then `maxExistingPassengerDelayMin` as the ceiling |
| New passenger pickup delay | `maxNewPassengerPickupDelayMin` |
| New passenger ride detour | `maxNewPassengerRideDetourMin` |
| Pooling policy | today's `poolingRules` checks, codes unchanged |

Kept as a belt-and-suspenders layer even though the solver enforced the time
windows itself: the solver was never told about the driver's extra-distance cap,
and an independent re-check is what makes the pipeline trustworthy.

### Stage 11 — Scoring

`ScoringWeights` becomes the Overview's formula:

```ts
export interface ScoringWeights {
  driverImpact: number;            // 0.30
  existingPassengerImpact: number; // 0.30
  newPassengerImpact: number;      // 0.25
  pickupDelay: number;             // 0.15
}
```

Lower is better, matching the Overview. Each component normalises against its own
stage-10 threshold so the total stays on one scale, and `ScoreBreakdown` keeps
its per-component `rawValue` / `normalized` / `weight` / `contribution` shape so
the UI needs no change beyond labels. The experimental `fairness` component and
its zero weight are dropped; driver fairness is not in the Overview's formula and
carrying a permanently-zero component is noise.

**Known limitation, stated in the UI:** `OptimizeTours` returns one sequence per
driver, so stage 11 ranks across *drivers*, not across sequences for one driver.
The Overview's Route 1/2/3 example — where our fairness score overrides Google's
vehicle-cost winner among several sequences — needs the Phase 3 in-house
insertion search. A note in the scoring panel says so, rather than letting the
lab imply a capability it does not have.

### Stage 12 — Commit

`scenarioStore.commitMatch(driverId)`:

1. Winning sequence replaces the ride's `stops` (a new ride is created if the
   driver was idle).
2. New passenger is added to the scenario and to `ride.passengerIds`.
3. The request is marked consumed.
4. Every remaining stop's `originalEtaMin` is re-stamped from the winning
   solution — the committed route becomes the new baseline, which is what makes
   the next request's deltas correct.

A `MatchingRun` snapshot is stored before mutation, so commit is undoable from
the runs panel. Firing request C, committing, then firing D demonstrates the
rolling-horizon property directly.

Concurrency — the Overview's open problem of atomic seat reservation — is out of
scope here. The lab is single-threaded and commits one request at a time; a note
in the README records that this is a simulation artefact, not a solved problem.

## Data model — schema v2

`Passenger` gains:

```ts
maxPickupDelayMin: number;
maxDropDelayMin: number;
```

`Stop` gains:

```ts
/** The ETA promised to this passenger, and the baseline stages 6/9/10 protect. */
originalEtaMin: number;
```

`Scenario.schemaVersion` becomes `2`. `scenarios/serialize.ts` gains a migrator:
a v1 document loads, then per-passenger budgets are filled from
`settings.maxExistingPassengerDelayMin` / `maxNewPassengerPickupDelayMin`, and
`originalEtaMin` is filled by routing the imported sequence once. The zod schema
in `domain/schemas.ts` validates v2 and accepts v1 only through the migrator.

`MatchingSettings` gains `maxPickupToRouteDistanceKm`, `maxDropToRouteDistanceKm`,
`maxBearingDifferenceDeg`, `maxNewPassengerRideDetourMin`,
`maxOptimizerCallsPerRun`, `optimizerTimeoutMs`. It loses `maxPickupEtaMin`,
`maxPickupRoadDistanceKm` (stage 3 replaces that gate) and the `fairness` weight.
`SettingsPanel.tsx` follows.

All eleven presets in `scenarios/presets/` are updated to v2. Three change
meaning under corridor indexing and are re-tuned deliberately: **Sparse Driver
Area**, **Dense Driver Area**, and **Busy Delhi**, whose expectations were
written against location-cell indexing. A twelfth preset, **Corridor Behind
Vehicle**, is added: a pickup sitting on the historical route but behind the
vehicle, which must reject at stage 2. That is the Overview's Example 11 and the
single most important regression to hold.

## Error handling

| Failure | Handling |
| --- | --- |
| No ADC credentials / no project id | Proxy `503`; run refuses to start; UI shows the `gcloud` fix |
| Proxy unreachable (built bundle) | Same run-level abort, message names the dev-server requirement |
| `OptimizeTours` non-2xx | `OptimizerUnavailableError`; that driver is `NOT_EVALUATED` with `OPTIMIZER_CALL_FAILED` |
| New passenger in `skippedShipments[]` | Driver rejected, `OPTIMIZER_INFEASIBLE` |
| Committed passenger in `skippedShipments[]` | Treated as a bug, not a rejection — the shipment was mandatory. Surfaces under the `SYSTEM` category |
| Leg / visit count mismatch | `ROUTE_LEG_MISMATCH`, existing guard |
| Optimizer budget exhausted | `NOT_EVALUATED` + `OPTIMIZER_BUDGET_EXCEEDED` |
| Solver timeout | Whatever the solver returns within `timeout` is used; a hard timeout is `OPTIMIZER_CALL_FAILED` |

New reason categories: `OPERATIONAL` (stage 1), `CORRIDOR` (stage 2), `DIRECTION`
(stage 4), `OPTIMIZER` (stage 8). Existing categories keep their codes.

## Testing

The suite stays fully offline and deterministic. `test/fixtures/stubOptimizer.ts`
is added, mirroring `stubRouting.ts`: it accepts an `OptimizeToursRequest`,
applies the locked spine, picks the lowest straight-line-cost legal ordering, and
returns leg data from the same haversine model `MockRoutingEngine` uses. No
network, no randomness.

New tests:

- Corridor built from remaining stops only; a pickup on the historical route
  behind the vehicle rejects at stage 2.
- Idle-driver single-cell corridor fallback still matches.
- `cellsForPath` cell coverage and dedup.
- Point-to-polyline distance for stages 3 and 4.
- Bearing, destination-distance and destination-progress rejections, each with
  its own code.
- Per-passenger time windows: the same insertion passes for a tolerant passenger
  and rejects for a strict one.
- Lower bound never prunes a candidate that stage 10 would have accepted.
- `ShipmentModelBuilder` output: mandatory vs skippable `penaltyCost`, spine
  freezing, time windows derived from passenger budgets.
- `SolutionReader` on a `skippedShipments[]` response.
- Optimizer budget exhaustion produces `NOT_EVALUATED`, not a rejection.
- Scoring: the Overview's weights reproduce its worked example.
- Commit then re-match: request D is evaluated against the post-C route, and
  `originalEtaMin` was re-stamped.
- Scenario immutability during a run is preserved (existing test, must still pass
  now that commit exists as a separate explicit action).
- v1 → v2 import migration.

Existing tests for occupancy, insertion ordering, delay arithmetic,
`NOT_EVALUATED` propagation and H3 dedup are kept, moved where their stage moved.

## Documentation

`apps/simulation/README.md` is rewritten for the thirteen stages, the corridor
primitive, the optimizer setup (`gcloud auth application-default login`,
`GOOGLE_CLOUD_PROJECT`, enabling the Route Optimization API), the dev-only proxy
limitation, the two budgets, and the stage-11 single-sequence limitation. The
"How to add a new filter or stage" section is updated for the new registry.

`.env.example` gains `GOOGLE_CLOUD_PROJECT`. No key material.

## Out of scope

- Any app other than `apps/simulation`.
- The Phase 3 in-house insertion search and the spine-based hybrid. The
  `OptimizerEngine` interface is the seam it would drop into.
- The Redis leg cache. `OptimizerCache` is in-memory, per session.
- Atomic seat reservation / commit concurrency.
- Scoring weight calibration against real outcomes.
