# Ride Matching Lab

A frontend-only laboratory for testing ride-pooling driver matching. It is not a
booking UI — it is a place to build realistic scenarios, run a matching pipeline
over them, and see exactly why every driver passed or failed.

The matching engine is pure TypeScript with no React and no Google Maps imports,
so it can be lifted into a backend service unchanged.

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

1. **Scenario** — load one of eleven presets, generate a seeded random scenario,
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

```
Request validation
  → H3 candidate generation
  → Driver status
  → Vehicle compatibility
  → Capacity pre-filter
  → Pickup ETA          (one route-matrix call)
  → Route feasibility   (full routes, authoritative)
  → Pooling rules       (business policy)
  → Scoring
```

Stage order is data, not code. The default runs the cheap ETA matrix before
route insertion because one matrix call typically halves the candidate set for a
fraction of the cost. The brief's original order — route feasibility first — is
selectable in the settings panel for cost comparisons.

A few decisions worth knowing:

- **Existing stops are frozen.** Insertion chooses two slots for the new rider
  and never reorders committed stops. The question is "can this ride be
  inserted", not "what is the globally optimal route". Candidate count is
  therefore exactly `(n+1)(n+2)/2`.
- **Capacity is per segment.** Occupancy rises and falls along the route and the
  walk is seeded with passengers already aboard, whose pickups are no longer in
  the route. `totalSeats − passengerCount` is only used as a cheap pre-filter.
- **Existing passenger delay is measured.** Derived from per-leg durations,
  before versus after. This is the constraint aggregate detour cannot see: a
  route can be 8% longer overall while making one rider fifteen minutes late.
- **Feasibility and policy are separate.** Stage 6 asks whether a pool is
  physically possible; stage 7 asks whether it is allowed.
- **Failure stops the pipeline.** Later stages report `NOT_EVALUATED`, never a
  second rejection.

## Algorithm architecture

```
React UI → Zustand stores → MatchingService → engine.ts → stages
                                                  ↓
                                        routeInsertion → RoutingEngine
                                                            ↓
                                              GoogleRoutesEngine | MockRoutingEngine
```

```
src/
  domain/      entities, settings defaults, zod schemas
  lib/         h3, geo, rng, ids, format
  routing/     RoutingEngine interface, cache, telemetry, both engines
  matching/    engine, pipeline, stages, routeInsertion, occupancy, delays, scoring
  services/    MatchingService seam + LocalMatchingService
  stores/      scenario, settings, matching, map, runs
  scenarios/   builders, presets, seeded generator, serialization
  components/  layout, map, scenario, results, debug, ui
  test/        deterministic vitest suite
```

`domain`, `lib`, `routing` and `matching` contain no React and no `google.maps`
imports, and are what would move to a Node service.

### Cost control

Routing is the only expensive part, and it is bounded rather than hoped about:

- Stages 0–4 make no calls at all.
- Stage 5 is one matrix call for every surviving driver.
- Stage 6 prunes insertion candidates on capacity and straight-line distance
  before routing, then routes at most `maxRoutedInsertionsPerDriver` per driver.
- `maxRoutingCallsPerRun` caps the whole run. Drivers past the cap are reported
  `NOT_EVALUATED` with `ROUTING_BUDGET_EXCEEDED` rather than silently failed.
- Results are cached on a key covering every parameter that changes the answer,
  not just the coordinates.

The debug console shows calls, matrix elements, cache hits and misses, remaining
budget, and per-stage timings.

## How to add a new filter or stage

1. Add a reason code to `src/matching/reasons.ts` with its category and label.
   The rejection dashboard picks it up automatically.
2. Create `src/matching/stages/yourStage.ts` implementing `MatchingStage`.
   Return a `DriverVerdict` per driver in `context.liveDriverIds`; the runner
   handles `NOT_EVALUATED` propagation, so never mark a dead driver yourself.
3. Add the stage id to `StageId` in `src/domain/entities.ts`, register it in
   `src/matching/stages/index.ts`, and describe it in `STAGE_METADATA` in
   `src/matching/pipeline.ts`.
4. Add it to `DEFAULT_STAGE_ORDER` in `src/domain/settings.ts`.
5. Cover it in `src/test/`.

Attach both `value` and `threshold` to every rejection reason. That pairing is
what lets the UI render "Detour 24.1% / max 15%" for any code without a
per-code branch.

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
| No Driver Available    | Empty result path                                           |
| Mixed Vehicle Fleet    | Vehicle preference filtering                                |
| Large Pooling Scenario | 500 drivers, 200 rides, routing budget                      |

## Testing

```bash
bun run test
```

The suite is deterministic: it runs against `MockRoutingEngine`, which has no
randomness, and seeded generation. It covers H3 ring attribution and dedup,
segment occupancy including the already-aboard case, insertion ordering and
frozen-order preservation, detour and delay arithmetic, `NOT_EVALUATED`
propagation, routing budget exhaustion, scenario immutability, and one
end-to-end Delhi scenario asserting a pass plus capacity, vehicle, offline, ETA,
detour, pooling and H3 rejections by reason code.

## Known limits

- Mock road distance is haversine × 1.35 with a length-dependent speed curve.
  Fine for algorithm logic, not for tuning real thresholds — hence the banner.
- The Routes API accepts at most 25 intermediate waypoints; longer routes are
  rejected with `WAYPOINT_LIMIT_EXCEEDED`.
- Simulation playback and A/B configuration comparison are not built yet. The
  `MatchingRun` snapshot and the passenger state machine are the hooks for both.
