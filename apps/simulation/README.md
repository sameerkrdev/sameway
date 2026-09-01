# Ride Matching Lab

A frontend-only laboratory for testing ride-pooling driver matching. It is not a
booking UI — it is a place to build realistic scenarios, run a matching pipeline
over them, and see exactly why every driver passed or failed.

The matching engine is pure TypeScript with no React and no Google Maps imports,
so it can be lifted into a backend service unchanged.

**Stage-by-stage filters (deep dive):** see
[`docs/MATCHING-STAGES-GUIDE.md`](../../docs/MATCHING-STAGES-GUIDE.md) for every
check, condition, default limit, and plain-language examples across all 14
pipeline stages.

## Installation

From the repository root:

```bash
bun install
bun run dev --filter=simulation
```

The app serves on <http://localhost:3100>.

Useful scripts, run from `apps/simulation`:

```bash
bun run dev           # dev server
bun run test          # vitest suite
bun run check-types   # tsc --noEmit
bun run lint          # eslint
bun run build         # typecheck + production build
```

## Google Maps API setup

Everything works without a key: the map shows a notice, and the routing engine
falls back to `MockRoutingEngine` with a persistent banner saying the distances
are simulated.

For real maps and real road data, create `apps/simulation/.env.local`:

```
VITE_GOOGLE_MAPS_API_KEY=your-key
VITE_GOOGLE_MAPS_MAP_ID=your-map-id
```

Enable these APIs on the Cloud project:

- **Maps JavaScript API**
- **Routes API**
- **Places API (New)**
- **Geocoding API**

Leave the legacy **Directions API**, **Distance Matrix API** and **Places API**
disabled. Google moved those to Legacy status on 2025-03-01 and they are not
available in Cloud projects created after that date. This app deliberately uses
their replacements: `google.maps.routes.Route.computeRoutes`,
`google.maps.routes.RouteMatrix.computeRouteMatrix`, and
`AutocompleteSuggestion.fetchAutocompleteSuggestions`.

A Map ID is required because driver and stop markers use `AdvancedMarker`, which
only renders on cloud-styled maps.

## Route Optimization setup

Stage 8 sends each candidate driver to Google's `OptimizeTours`. That API is
server-side only — it needs OAuth2 credentials and does not support browser
CORS — so the dev server proxies it at `POST /api/optimize-tours`.

Create a service account on a Cloud project with the **Route Optimization API**
enabled, download a JSON key, and add both values to `apps/simulation/.env.local`:

```
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=C:/path/to/service-account-key.json
```

Store the key file outside the repo or in a gitignored path. Never commit it.
Use an absolute path on Windows; a path relative to `apps/simulation` also works
when you start dev from that directory.

No key material is ever committed or sent to the browser: the proxy signs each
request server-side and forwards only the solution.

**This works under `bun run dev` only.** `bun run build` produces static files
with no server behind them, so a built bundle cannot reach the optimizer and
the app shows the unavailable banner. That is deliberate — this is a lab tool,
not something anyone deploys.

Without credentials, **Run matching** refuses to start rather than reporting
per-driver failures. A run with no solver has no opinion about any driver, and
saying otherwise would be a lie.

The test suite never needs any of this: `src/test/fixtures/stubOptimizer.ts`
stands in for the solver and honours the same contract, so `bun run test` is
offline and deterministic.

## H3 setup

H3 needs no configuration; `h3-js` is a dependency. Resolution, ring limit and
the minimum candidate count are editable at runtime in **Simulation settings**.

`src/lib/h3.ts` is the only module allowed to import `h3-js`, enforced by an
ESLint `no-restricted-imports` rule. H3 answers spatial questions only. A ring
index and a grid distance are unitless hop counts; they are never used as a
distance or an ETA. The four proximity measures stay distinct throughout:

| Measure           | Meaning                       | Used for              |
| ----------------- | ----------------------------- | --------------------- |
| `h3GridDistance`  | Hop count between cells       | Search bounds only    |
| `straightLineKm`  | Haversine                     | Cheap pruning         |
| `roadDistanceKm`  | Follows roads                 | Thresholds, scoring   |
| `roadEtaMin`      | Travel time                   | Thresholds, scoring   |

## Creating a scenario

The left sidebar builds the world:

1. **Scenario** — load one of twelve presets, generate a seeded random scenario,
   or import a previously exported JSON file.
2. **Drivers** — add drivers, set status and vehicle, and click **Place** to
   drop them on the map. Markers are also draggable in normal mode.
3. **Vehicles** — seat count, luggage, pooling, accessibility. Vehicle types are
   scenario data, so adding one needs no code change.
4. **Passengers** — seats required, ride state, and whether they will share.
5. **Existing rides** — attach passengers to a driver and build the stop
   sequence with the route editor.
6. **New ride request** — pickup, drop, seats, wait and detour limits.

Click **Run matching**.

### Map modes

The map has one explicit mode at a time, shown in a banner while active. In
normal mode, clicking only inspects — it can never modify the scenario by
accident.

`Normal · Add driver location · Add pickup · Add drop · Add stop · Inspect H3`

### Reproducibility

Random generation is seeded, so the same seed always rebuilds the same scenario.
Export writes versioned JSON validated by zod on import, and every **Run
matching** click stores a `MatchingRun` snapshot containing deep-frozen copies of
the scenario, request and settings alongside the result.

## The matching pipeline

Fourteen stages, in the order `docs/Overview.md` numbers them. The number in
brackets is the Overview's; `requestValidation` is a pre-stage that judges the
request alone, before any driver is considered, so it has none.

```
requestValidation        (—)  the request itself: coordinates, seats, sanity
  → h3RouteCorridor       (2)  Layer 1: H3 corridor discovery (Redis-shaped)
  → basicEligibility      (0)  status, vehicle capability, conservative seats
  → operationalState      (1)  price each committed promise as a delay budget
  → pickupRouteDistance   (3)  exact point-to-polyline distance to that route
  → directionCompatibility(4)  bearing, destination proximity, destination ahead
  → stopSequenceGeneration(5)  legal insertion positions under precedence+capacity
  → pickupTimeWindow      (6)  drop orderings that break a committed promise
  → detourLowerBound      (7)  prune what straight-line arithmetic already rules out
  → roadRouting           (8)  Google OptimizeTours — the only expensive stage
  → incrementalCost       (9)  measure every party's gain and loss. Rejects nobody
  → hardConstraints      (10)  binary accept/reject, plus pooling policy
  → scoring              (11)  fairness-weighted ranking. Lower is better
  → commit               (12)  build the plan that becomes the new baseline
```

Corridor discovery runs first — only rides whose remaining route intersects the
pickup H3 search enter the funnel. Drivers outside that search are **not evaluated**
(like a Redis `h3_cell → ride_ids` lookup that never returned them).

Stage order is still data, but it is no longer freely reorderable: these
fourteen have strict data dependencies — stage 9 cannot measure what stage 8 has
not routed — so `DEFAULT_STAGE_ORDER` is the only sequence that runs end to end.
Anything else is a diagnostic sub-pipeline.

A few decisions worth knowing:

- **The corridor is built from remaining stops only.** A pickup sitting on a
  stretch the vehicle has already driven past is a reject however close it
  looks. This is the single most important property in the whole pipeline, and
  the `Corridor Behind Vehicle` preset exists to keep it honest.
- **The committed spine is locked, not merely ordered.** Stage 5 chooses two
  slots for the new rider and never reorders committed stops, so the candidate
  count is exactly `(n+1)(n+2)/2`. The solver is sent the same constraint. See
  *Known limits* — the current form of that lock is stronger than intended.
- **Commitments are priced, not frozen.** Stage 2 (`operationalState`) gives every
  committed stop a delay budget from its own passenger's tolerance. Stage 7
  (`pickupTimeWindow`) rejects *orderings* that break one, never the driver: a driver
  survives as long as any ordering does.
- **Enumeration vs Google (Stages 6–9).** Stages 6–8 explore where the new pickup
  and drop can slot into the frozen committed spine using free math (capacity,
  promises, straight-line cost). Stage 9 (`roadRouting`) makes **one** OptimizeTours
  call per driver; only the cheapest shortlisted ordering becomes a `firstSolution`
  warm-start hint (helps the heuristic solver, not a hard lock). Hints #2–#6 are
  not retried on failure today. See
  [`MATCHING-STAGES-GUIDE.md` § Stages 6–9](../../docs/MATCHING-STAGES-GUIDE.md#stages-69--enumeration-vs-google)
  and [Why the firstSolution hint?](../../docs/MATCHING-STAGES-GUIDE.md#why-the-firstsolution-hint).
- **Capacity is per segment.** Occupancy rises and falls along the route and the
  walk is seeded with passengers already aboard, whose pickups are no longer in
  the route. `totalSeats − passengerCount` is only a cheap pre-filter, which is
  why a vehicle that is full right now can still take a rider after its next
  drop.
- **Measuring and judging are separate stages.** Stage 9 only measures; stage 10
  only decides. Keeping them apart is what lets the UI show a driver's full
  impact profile even when that driver was rejected.
- **Stage 10 re-checks what the solver already enforced.** The solver was never
  told about the driver's extra-distance cap or our pooling policy, and an
  independent re-check is what makes the answer trustworthy rather than merely
  plausible.
- **Failure stops the pipeline.** Later stages report `NOT_EVALUATED`, never a
  second rejection, so each driver has exactly one attributable failure point.

## Constants and hard filters

Tunable limits, hard-filter stages, prepare stages, and reason-code conventions
are documented in
[`docs/MATCHING-STAGES-GUIDE.md` § Constants and hard filters](../../docs/MATCHING-STAGES-GUIDE.md#3-constants-and-hard-filters).
The stage-by-stage checks and fail codes are in the sections that follow there.

## Algorithm architecture

```
React UI → Zustand stores → MatchingService → engine.ts → 14 stages
                                                  │
                    ┌─────────────────────────────┼──────────────────┐
                    ▼                             ▼                  ▼
             corridor.ts (H3)             RoutingEngine       OptimizerEngine
                                                  │                  │
                                   GoogleRoutesEngine|Mock   OptimizeToursEngine
                                                                     │
                                                        POST /api/optimize-tours
                                                                     │
                                            Vite middleware (ADC, server-side)
                                                                     │
                                          routeoptimization.googleapis.com
```

```
src/
  domain/       entities, settings defaults, zod schemas + v1 migration
  lib/          h3, geo, rng, ids, format
  routing/      RoutingEngine interface, cache, telemetry, both engines
  optimization/ OptimizerEngine, shipment model, solution reader, cache, telemetry
  matching/     engine, pipeline, 14 stages, corridor, insertion, occupancy, delays
  services/     MatchingService seam + LocalMatchingService
  stores/       scenario, settings, matching, map, runs
  scenarios/    builders, presets, seeded generator, serialization
  components/   layout, map, scenario, results, debug, ui
  test/         deterministic vitest suite
server/         optimizerProxy.ts — the one deliberately Node-only file
```

`domain`, `lib`, `routing`, `optimization` and `matching` contain no React and
no `google.maps` imports, and are what would move to a Node service unchanged.

### Cost control

Two remote services, billed differently, so they have separate budgets:

- Stages through `pickupTimeWindow` and `detourLowerBound` make **no** remote calls.
  They enumerate legal stop orderings, filter by capacity and committed promises,
  then `detourLowerBound` shortlists at most `maxRoutedInsertionsPerDriver`
  (default **6**) by straight-line added km. Only the **cheapest** kept ordering
  is passed to Google as a `firstSolution` hint; the other shortlisted sequences
  are for metrics and debugging, not separate API calls.
- `roadRouting` makes **one** `OptimizeTours` call per surviving driver, capped by
  `maxOptimizerCallsPerRun`. `OptimizeTours` prices per *shipment*, so the debug
  console reports shipments billed alongside call count.
- Baselines — the driver's pre-insertion route and the new rider's solo trip —
  stay on the Routes API, capped by `maxRoutingCallsPerRun`. There is nothing to
  optimise about an already-decided route, so paying solver pricing for a pure
  measurement would be waste.
- Drivers past either cap are reported `NOT_EVALUATED`, never silently failed.
  Budget exhaustion is not an opinion about a driver.
- Both layers cache on a key covering every parameter that changes the answer,
  not just the coordinates.

The debug console shows both budgets, cache hits and misses, per-stage timings,
and insertion `attemptStats` (enumerated vs geographically pruned vs **routed: 1**).
## How to add a new filter or stage

1. Add a reason code to `src/matching/reasons.ts` with its category and label.
   The rejection dashboard picks it up automatically.
2. Create `src/matching/stages/yourStage.ts` implementing `MatchingStage`.
   Return a `DriverVerdict` per driver in `context.liveDriverIds`; the runner
   handles `NOT_EVALUATED` propagation, so never mark a dead driver yourself.
3. Add the stage id to `StageId` in `src/domain/entities.ts`, register it in
   `src/matching/stages/index.ts`, and describe it in `STAGE_METADATA` in
   `src/matching/pipeline.ts`.
4. Add it to `DEFAULT_STAGE_ORDER` in `src/domain/settings.ts`, in a position
   its data dependencies allow. The order is data, but it is not a free choice:
   a stage that reads `getSolution` must sit after `roadRouting`, one that reads
   `getSequences` after `stopSequenceGeneration`, and so on.
5. Cover it in `src/test/`. `src/test/fixtures/runStages.ts` runs stages 1–9
   against a fixture context, so a test for a late stage asserts on real
   pipeline data rather than hand-built metrics.

Attach both `value` and `threshold` to every rejection reason. That pairing is
what lets the UI render "Detour 24.1% / max 15%" for any code without a
per-code branch.

Stages pass data to each other through the context, never through another
stage's `notes` — `getCorridor`/`setCorridor`, `getSequences`/`setSequences`,
`getDelayBudgets`/`setDelayBudgets`, `getSolution`/`setSolution` all follow one
pattern. `notes` is for the UI.

## How to add a new vehicle type

Vehicle capability is data. Add one in the **Vehicles** panel at runtime, or add
it to `FLEET` in `src/scenarios/builders.ts` for presets. No engine change is
needed — `vehicleFilter` reads capability from the record.

## Scenario presets

Each preset targets one specific behaviour:

| Preset                 | Exercises                                                  |
| ---------------------- | ---------------------------------------------------------- |
| Simple Single Ride     | Happy path, idle drivers                                    |
| Busy Delhi             | Dense supply, ring 0 satisfies the candidate threshold      |
| Airport Pooling        | Long shared corridor, low detour                            |
| Multiple Passengers    | Deep insertion enumeration on a six-seater                  |
| Vehicle Capacity Test  | Pre-filter and segment occupancy disagree                   |
| Route Detour Test      | Perpendicular request forcing a detour rejection            |
| Sparse Driver Area     | Ring expansion runs to the limit                            |
| Dense Driver Area      | Search stops at ring 0                                      |
| Corridor Behind Vehicle| Pickup on the road already driven — the corridor regression |
| No Driver Available    | Empty result path                                           |
| Mixed Vehicle Fleet    | Vehicle preference filtering                                |
| Large Pooling Scenario | 500 drivers, 200 rides, routing budget                      |

## Testing

```bash
bun run test
```

The suite is deterministic and offline. It runs against `MockRoutingEngine` and
`StubOptimizerEngine`, neither of which has any randomness, plus seeded
generation. No test reaches the network, so none of the Google setup above is
needed to run it.

It covers every stage's own behaviour, plus the properties that span them: H3
ring attribution and dedup, the corridor built from remaining stops only,
segment occupancy including the already-aboard case, insertion ordering and
frozen-order preservation, the admissibility of stage 7's lower bound, detour
and delay arithmetic, `NOT_EVALUATED` propagation and one attributable failure
point per driver, budget exhaustion on both remote services, scenario
immutability, the commit store's apply and undo, that every preset still does
what its name claims, and one end-to-end Delhi scenario asserting a pass plus
capacity, vehicle, offline, corridor, proximity, direction and detour
rejections by reason code.

## Known limits

- Mock road distance is haversine × 1.35 with a length-dependent speed curve.
  Fine for algorithm logic, not for tuning real thresholds — hence the banner.
- The Routes API accepts at most 25 intermediate waypoints; longer routes are
  rejected with `WAYPOINT_LIMIT_EXCEEDED`.
- Simulation playback and A/B configuration comparison are not built yet. The
  `MatchingRun` snapshot and the passenger state machine are the hooks for both.
- **Stage 11 ranks drivers, not sequences.** `OptimizeTours` returns one
  sequence per driver, so the Overview's Route 1/2/3 example — our fairness
  score overriding the solver's vehicle-cost winner among several candidate
  sequences — is not something this lab can show. That needs the Phase 3
  in-house insertion search. The scoring panel says so too.
- **Committed stop order is preserved, not append-locked.** `committedPrecedence`
  becomes Google `precedenceRules`, so relative order among promised stops stays
  fixed while the new rider may be inserted in any gap when delay budgets allow.
  The cheapest sequence after `detourLowerBound` shortlisting is sent as
  `injectedFirstSolutionRoutes` — a warm-start hint for the heuristic solver, not
  a hard lock. Sequences #2–#6 on the shortlist are not retried if the first hint
  fails (`OPTIMIZER_INFEASIBLE`). Multi-hint retries could improve match rate at
  ~N× API cost; see the guide §
  [Would six calls with six different hints improve matching?](../../docs/MATCHING-STAGES-GUIDE.md#would-six-calls-with-six-different-hints-improve-matching).
  The legacy `lockedVisits` append-only path remains for tests only.
- **The optimizer proxy is dev-server only.** `bun run build` produces static
  files with no server behind them, so a built bundle cannot reach `roadRouting`.
  Deliberate: this is a lab tool, not something anyone deploys.
- **Commit concurrency is unsolved.** The lab commits one request at a time, so
  the Overview's atomic-seat-reservation problem never arises here. That is a
  simulation artefact, not a solved problem.
