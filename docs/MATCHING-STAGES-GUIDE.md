# Matching Stages Guide (Deep Dive)

A plain-language walkthrough of **every stage, check, filter, and condition** in the Ride Matching Lab pipeline.

This guide matches the code in `apps/simulation/src/matching/stages/` and the default settings in `apps/simulation/src/domain/settings.ts`.

---

## Table of contents

1. [Big picture](#1-big-picture)
2. [Words we use](#2-words-we-use)
3. [Constants and hard filters](#3-constants-and-hard-filters)
4. [Default limits cheat sheet](#4-default-limits-cheat-sheet)
5. [How a run works](#5-how-a-run-works)
6. [Stage 0 — Request validation](#stage-0--request-validation)
7. [Stage 1 — H3 route corridor (Layer 1)](#stage-1--h3-route-corridor-layer-1)
8. [Stage 2 — Basic eligibility](#stage-2--basic-eligibility)
9. [Stage 3 — Operational state](#stage-3--operational-state)
10. [Stage 4 — Pickup → route distance](#stage-4--pickup--route-distance)
11. [Stage 5 — Direction compatibility](#stage-5--direction-compatibility)
12. [Stages 6–9 — Enumeration vs Google](#stages-69--enumeration-vs-google)
13. [Stage 6 — Stop sequence generation](#stage-6--stop-sequence-generation)
14. [Stage 7 — Pickup time window](#stage-7--pickup-time-window)
15. [Stage 8 — Detour lower bound](#stage-8--detour-lower-bound)
16. [Stage 9 — Road routing (optimizer)](#stage-9--road-routing-optimizer)
17. [Stage 10 — Incremental cost](#stage-10--incremental-cost)
18. [Stage 11 — Hard constraints](#stage-11--hard-constraints)
19. [Stage 12 — Scoring](#stage-12--scoring)
20. [Stage 13 — Commit](#stage-13--commit)
21. [Full story examples](#21-full-story-examples)
22. [“Why did I fail?” cheat sheet](#22-why-did-i-fail-cheat-sheet)
23. [Known lab limits](#23-known-lab-limits)

---

## 1. Big picture

When you click **Run matching**, the lab tries to answer:

> For **this one new request**, which drivers can take this passenger, and who is the best choice?

It answers that with a **funnel**: Layer 1 → filters → routing:

```
All drivers in scenario
  → H3 corridor discovery (Layer 1 — only corridor hits continue)
  → status / vehicle / seat checks
  → operational delay budgets
  → map geometry / direction checks
  → legal stop orders
  → rough time-budget checks
  → Google road routing
  → measure real cost
  → hard accept/reject
  → fairness score ranking
  → commit plan for the winner
```

Corridor discovery runs first. Expensive Google calls run later. Drivers whose ride
never appeared in the corridor search are **not evaluated** — the same as Redis never
returning their ride id.

---

## 2. Words we use

| Word | Easy meaning |
|------|----------------|
| **Request** | New passenger wanting a ride: pickup + drop + seats |
| **Driver** | A vehicle operator in the scenario |
| **Idle driver** | Online, no active ride, no remaining stops |
| **Mid-trip driver** | Already carrying / serving passengers |
| **Corridor / route line** | Line: **car now → remaining stops** |
| **Remaining stops** | Stops still left to do (onboard pickups are removed) |
| **Committed passenger** | Someone already promised a pickup or drop time |
| **Delay budget** | How many minutes late we are still allowed |
| **Pass** | Driver continues to next stage |
| **Fail** | Driver rejected; UI shows a reason code |
| **Prepare** | Computes values and stores them on the context for later stages; usually passes everyone |
| **Measure only** | Numbers recorded; reject happens later |
| **Pooling** | Sharing a vehicle with other passengers |
| **Spine** | Existing stops kept in their relative order |
| **Insertion** | Slotting new pickup/drop into gaps in that spine |
| **Shortlist** | Top-N cheapest enumerated orderings kept after Stage 8 (default N = 6) |
| **firstSolution hint** | Cheapest shortlisted ordering passed to Google as a starting suggestion — not a hard lock |

### How the route line is built

```
Polyline = [driver.location] + remaining stops in sequence
```

If two passengers are already onboard:

```
Remaining: Drop A, Drop B
Line:      Car (V) → Drop A → Drop B
```

Their old pickups are **gone** from the line. Only future work remains.

### What stages actually do

Most stages fall into one of four roles:

| Role | What happens | Example |
|------|----------------|---------|
| **Filter** | Binary pass/fail; failure stops the pipeline | Pickup too far from route |
| **Prepare** | Computes and stores data for downstream stages; rarely rejects | Operational state builds delay budgets |
| **Measure only** | Records impact numbers; never rejects | Incremental cost |
| **Rank** | Scores survivors; never rejects | Scoring |

A stage can filter *and* record metrics in the same pass (direction compatibility
does both). **Prepare** stages are easy to misread in the funnel because they
often show green for every driver — see [§ 3 Constants and hard filters](#3-constants-and-hard-filters) for the full picture.

---

## 3. Constants and hard filters

Most tunable limits live in `apps/simulation/src/domain/settings.ts` as
`DEFAULT_SETTINGS` and can be changed at runtime in **Simulation settings**.
They fall into a few groups:

| Group | Settings | Used for |
|-------|----------|----------|
| **Spatial search** | `h3Resolution`, `maxH3Ring`, `minimumUsableCandidates` | How wide Layer 1 corridor discovery casts its net (stage 1) |
| **Geometry pruning** | `maxPickupToRouteDistanceKm`, `maxBearingDifferenceDeg`, `estimatedSpeedKmh` | Cheap straight-line gates before any solver call (stages 4–5, 7) |
| **Delay and detour budgets** | `maxNewPassengerPickupDelayMin`, `maxNewPassengerRideDetourMin`, `maxExistingPassengerDelayPercent`, `shortTripDelayPercent` | How much harm each party may absorb (stages 3, 7, 11) |
| **Pooling policy** | `maxPooledPassengers` | Maximum shared passengers (stage 11) |
| **Cost control** | `maxOptimizerCallsPerRun`, `maxRoutingCallsPerRun`, `maxRoutedInsertionsPerDriver`, `optimizerTimeoutMs` | Shortlist size in stage 8; one OptimizeTours call per driver in stage 9 (`maxOptimizerCallsPerRun`); Routes API calls for solo/baseline/map polylines (`maxRoutingCallsPerRun`) |
| **Scoring weights** | `weights.*` | Biases the final ranking without rejecting anyone (stage 12) |

Passengers can carry their own pickup/drop delay tolerances (`maxPickupDelayMin` in
minutes, `maxDropDelayPercent` as a percent of solo trip ETA); when unset, they
inherit `DEFAULT_PASSENGER_DELAY_BUDGETS`, which mirrors the scenario defaults. A handful of values are fixed code constants
rather than settings — notably `MAX_INTERMEDIATE_WAYPOINTS` (25, Google's Routes
API limit, enforced in Stage 6) and `MAX_MATRIX_ELEMENTS` (625, RouteMatrix limit
in the routing adapter). The matching pipeline itself uses `getRoute`, not RouteMatrix.

### Hard filters

**Hard filters** are the stages whose main job is a binary pass/fail decision. A
driver that fails one never reaches scoring and never gets a second rejection
reason. Early filters shrink the candidate set cheaply: request validation, H3
corridor discovery, basic eligibility (status, vehicle, conservative seats),
pickup-to-route distance, direction compatibility, stop-sequence generation
(capacity and precedence), and pickup time windows all reject drivers or
orderings that are obviously incompatible before OptimizeTours runs (stage 9).
**Detour lower bound** (stage 8) only ranks and shortlists — it never fails a
driver. After routing, **incremental cost** (stage 10) deliberately does
*not* filter — it only records what everyone gains or loses so the UI can show a
full impact profile even for rejected drivers. **Hard constraints** (stage 11) is
the authoritative accept/reject gate: it re-checks every configured maximum and
pooling rule against the measured road-network deltas, independently of what the
solver was told. Efficiency for one party never excuses breaching another's
limit. **Scoring** (stage 12) then ranks the survivors; lower is better, but it
rejects nobody.

### Prepare stages (not every stage is a filter)

Some stages **prepare data for later use** — they run real work, store results on
the matching context, and usually pass every driver through. **Operational state**
(stage 3) is the clearest example: it prices each committed stop as a delay budget
and writes those budgets via `setDelayBudgets` for pickup time windows (stage 7)
and hard constraints (stage 11) to consume later. It only rejects when every
remaining promise is already at zero slack (`OPERATIONAL_NO_FLEXIBILITY`). The
same pattern appears elsewhere: corridor discovery builds the route polyline,
direction compatibility records bearing and extension metrics that detour pruning
and hard limits read back, and stop-sequence generation writes the candidate
orderings that routing solves.

Stages communicate through typed context channels (`getCorridor` / `setCorridor`,
`getDelayBudgets` / `setDelayBudgets`, `getSequences` / `setSequences`,
`getSolution` / `setSolution`, `recordMetrics`) — never through another stage's
UI notes — so a prepare stage can look like a no-op in the funnel bar even while
it is doing essential bookkeeping.

Every hard rejection carries a stable reason code plus a `value` / `threshold`
pair (see `apps/simulation/src/matching/reasons.ts`), which is what lets the
results panel render "Detour 14.2 min / max 12 min" without per-code UI branches.
The stage-by-stage checks, defaults, and fail codes follow in the sections below.

---

## 4. Default limits cheat sheet

From `DEFAULT_SETTINGS` (you can change these in scenario settings):

| Setting | Default | Stage | Description |
|---------|---------|-------|-------------|
| `h3Resolution` | 9 | 1 (corridor) | Hex cell size for spatial indexing. Higher = smaller cells, finer search, more cells per route. Resolution 9 is roughly neighbourhood scale (~174 m edge). |
| `maxH3Ring` | 3 | 1 (corridor) | How many H3 rings outward from the pickup cell to search when corridor discovery has not yet found enough rides. Each ring is one hop to a neighbouring cell. |
| `minimumUsableCandidates` | 10 | 1 (corridor) | Stop expanding the H3 search once at least this many **online, eligible** rides have been discovered. Prevents over-fetching in dense areas while ensuring sparse areas widen the net. |
| `maxPickupToRouteDistanceKm` | **1.5 km** | 4 | Maximum perpendicular distance from the new pickup to a ride's remaining-route polyline. Catches pickups that H3 flagged as "nearby" but are actually too far off the road the vehicle will follow. |
| `maxBearingDifferenceDeg` | **75°** | 5 | Maximum angle between the ride's heading and the new request's pickup→drop direction. Filters obviously wrong-way or perpendicular trips before routing. Deliberately loose — roads are not straight lines. |
| `estimatedSpeedKmh` | **24 km/h** | 7 | Assumed average speed for **straight-line ETA estimates only** in the pickup time-window pre-filter. Real road times come from the solver in stage 9; this just prunes hopeless orderings cheaply. |
| `maxRoutedInsertionsPerDriver` | **6** | 8 | Maximum enumerated orderings **kept on the context** after Stage 8 (sorted by straight-line added km). Only **#1** is used in Stage 9 as a `firstSolution` **warm-start hint** for OptimizeTours (one call per driver). #2–#6 are not separate API calls and are not retried on failure today. See [Why the firstSolution hint?](#why-the-firstsolution-hint). |
| `maxExistingPassengerDelayPercent` | **50%** | 3, 11 | Global backstop for how late an **existing** passenger's drop may arrive, expressed as a percent of their **solo trip ETA**. Combined with each passenger's own `maxDropDelayPercent` using the **stricter** (smaller) allowance. |
| `shortTripSoloEtaMaxMin` | **5 min** | 3, 11 | Solo trips at or below this ETA use `shortTripDelayPercent` instead of the configured percent. |
| `shortTripDelayPercent` | **250%** | 3, 11 | Drop-delay tolerance for short solo trips (default **250%** of solo ETA). |
| `maxNewPassengerPickupDelayMin` | **8 min** | 11, 12 | Maximum time the **new** passenger waits at pickup compared to arriving immediately (solo trip ETA to pickup). Measures wait cost of sharing, not total trip length. |
| `maxNewPassengerRideDetourMin` | **12 min** | 11, 12 | Maximum extra time the **new** passenger's own journey takes when pooled versus riding solo (pooled ride duration minus solo ride duration). Protects the new rider from an unacceptably stretched trip. |
| `maxPooledPassengers` | **4** | 11 | Maximum number of passengers allowed in one shared vehicle at once, counting the new request. Solo rides (no existing passengers) are not subject to this cap. |
| `maxOptimizerCallsPerRun` | 40 | 9 | Hard cap on `OptimizeTours` API calls per matching run. Drivers beyond the budget are marked **not evaluated**, not rejected — budget exhaustion is not an opinion about a driver. |
| `maxRoutingCallsPerRun` | 150 | 9, 10 | Cap on **Routes API** calls (`getRoute` / matrix) via `InstrumentedRoutingEngine`: the new rider's solo trip, each driver's baseline remaining route, and Stage 10 map polylines. Separate from the optimizer cap. Cache hits do not consume it. |
| `optimizerTimeoutMs` | 10_000 | 9 | Per-call timeout passed to the Route Optimization API. A timed-out solve fails that driver's routing attempt for this run. |
| `weights.driverImpact` | 30 | 12 | Share of the fairness score from extra driver duration (0 for idle). Weights are rescaled to sum to 1. |
| `weights.existingPassengerImpact` | 30 | 12 | Share from the worst **drop** delay vs the baseline route. |
| `weights.newPassengerImpact` | 25 | 12 | Share from the new rider's ride-detour minutes. |
| `weights.pickupDelay` | 15 | 12 | Share from the new rider's pickup wait. |

Per passenger (on the passenger record):

| Field | Default source | Description |
|-------|----------------|-------------|
| `maxPickupDelayMin` | `DEFAULT_PASSENGER_DELAY_BUDGETS` (8 min) | Fixed **minutes** of lateness allowed at pickup (not percent-based). Stage 3 prices each committed pickup stop with this value; stages 7 and 11 enforce it. Onboard passengers' pickups are skipped — they already happened. |
| `maxDropDelayPercent` | `DEFAULT_PASSENGER_DELAY_BUDGETS` (50%) | Drop delay tolerance as a **percent of solo trip ETA**. Stage 3 converts this to `budgetMin`; stages 7 and 11 enforce it. Short solo trips (≤ 5 min) use **250%** instead. |
| `seatsRequired` | Set per passenger | Number of seats this passenger occupies. Checked in request validation (stage 0) and again during segment-capacity walks in stop-sequence generation (stage 6). |
| `allowsPooling` | `true` in most presets | Whether this passenger agrees to share a vehicle with strangers. Stage 11 rejects a pool if any **existing** rider on the candidate ride has this set to `false`. The new request has its own separate `poolingAllowed` flag. |
| `maxWaitMinutes` (on the **request**) | Typically 6 in builders / sketch | Must be ≥ 0 (stage 0). Passed to OptimizeTours as a **soft** new-pickup deadline (`softPickupDeadlineMin`), not as Stage 11's hard wait cap. Hard pickup wait uses `maxNewPassengerPickupDelayMin` (8 min). |

### Drop delay budget math

Drop delays scale with solo trip ETA (`delayBudget.ts`):

```
soloEtaMin = drop.originalEtaMin − pickup.originalEtaMin   (waiting passenger)
           = drop.originalEtaMin                          (already onboard)

percent  = shortTripDelayPercent (250%)  when soloEtaMin ≤ shortTripSoloEtaMaxMin (5 min)
         = min(passenger.maxDropDelayPercent, maxExistingPassengerDelayPercent) otherwise

budgetMin = soloEtaMin × percent / 100
latestAllowedDrop = originalEtaMin + budgetMin
```

**Example A — 20 min solo, 50%:** `budgetMin = 10 min`

**Example B — 4 min solo (short trip):** `percent = 250%` → `budgetMin = 10 min`

**Example C — passenger 30% vs global 50% on 16 min solo:** effective `30%` → `budgetMin = 4.8 min`

Pickup delays remain fixed minutes (`maxPickupDelayMin`).

---

## 5. How a run works

Stage order (fixed):

1. `requestValidation`
2. `h3RouteCorridor` — **Layer 1** corridor discovery first
3. `basicEligibility`
4. `operationalState`
5. `pickupRouteDistance`
6. `directionCompatibility`
7. `stopSequenceGeneration`
8. `pickupTimeWindow`
9. `detourLowerBound`
10. `roadRouting`
11. `incrementalCost`
12. `hardConstraints`
13. `scoring`
14. `commit`

Only drivers still “live” enter each next stage. Drivers outside the Layer 1 corridor
search are marked **not evaluated** for the rest of the run. Stage 0 is special: if the
**request** fails, the whole run stops.

**Insertion → routing (Stages 6–9)** in one pass:

```
Stage 6  enumerate every legal pickup/drop slot (frozen committed spine)
Stage 7  drop orderings that break committed delay promises (straight-line ETA)
Stage 8  sort by straight-line added km; keep top maxRoutedInsertionsPerDriver (6)
Stage 9  one OptimizeTours call per driver; cheapest kept sequence = firstSolution hint only
```

Google may return a different feasible order than the hint. Sequences #2–#6 are not routed separately. Full explanation: [Stages 6–9 — Enumeration vs Google](#stages-69--enumeration-vs-google).

---

# Stage 0 — Request validation

**File:** `requestValidation.ts`  
**Question:** Is this request valid **before** we look at any driver?

If this stage fails, **no driver is evaluated**. The run aborts.

---

## Check 0.1 — Pickup exists

| Condition | Fail code |
|-----------|-----------|
| `pickup.lat` and `pickup.lng` are finite numbers | `REQUEST_PICKUP_MISSING` |

**Pass example:** Pickup = `(28.61, 77.23)`  
**Fail example:** Pickup missing / `NaN`

---

## Check 0.2 — Drop exists

| Condition | Fail code |
|-----------|-----------|
| `drop.lat` and `drop.lng` are finite numbers | `REQUEST_DROP_MISSING` |

---

## Check 0.3 — Pickup ≠ drop

| Condition | Fail code |
|-----------|-----------|
| Pickup and drop are the same location | `REQUEST_PICKUP_EQUALS_DROP` |

**Fail example:** Both points at India Gate.

---

## Check 0.4 — Seats required

| Condition | Fail code |
|-----------|-----------|
| `seatsRequired` is a whole number ≥ 1 | `REQUEST_SEATS_INVALID` |

**Fail examples:** `0`, `-1`, `1.5`

---

## Check 0.5 — Passenger exists

| Condition | Fail code |
|-----------|-----------|
| `request.passengerId` is in the scenario passenger list | `REQUEST_PASSENGER_UNKNOWN` |

---

## Check 0.6 — Passenger not already on a ride

| Condition | Fail code |
|-----------|-----------|
| Passenger is not already listed on any active ride | `REQUEST_PASSENGER_ALREADY_ON_RIDE` |

**Why:** One person cannot be booked twice. Create a new passenger for a second request.

---

## Check 0.7 — Vehicle preference known

| Condition | Fail code |
|-----------|-----------|
| If preference is not `ANY`, some vehicle label must match | `REQUEST_VEHICLE_PREFERENCE_UNKNOWN` |

**Pass:** Preference `ANY`, or `4-SEATER-CAB` exists in fleet.  
**Fail:** Preference `HELICOPTER` but fleet has no such label.

---

## Check 0.8 — Max wait not negative

| Condition | Fail code |
|-----------|-----------|
| `maxWaitMinutes ≥ 0` | `REQUEST_THRESHOLD_INVALID` |

This field is **not** the Stage 11 hard pickup-wait cap. Stage 9 sends it to OptimizeTours as a **soft** new-pickup deadline (`softDeadlineCostPerHour: 50`). Stage 11 still uses `maxNewPassengerPickupDelayMin`.

---

### Stage 0 summary table

| # | Check | Pass | Fail code |
|---|--------|------|-----------|
| 1 | Pickup coords | Valid | `REQUEST_PICKUP_MISSING` |
| 2 | Drop coords | Valid | `REQUEST_DROP_MISSING` |
| 3 | Pickup ≠ drop | Different | `REQUEST_PICKUP_EQUALS_DROP` |
| 4 | Seats | Integer ≥ 1 | `REQUEST_SEATS_INVALID` |
| 5 | Passenger known | Found | `REQUEST_PASSENGER_UNKNOWN` |
| 6 | Not already riding | Free | `REQUEST_PASSENGER_ALREADY_ON_RIDE` |
| 7 | Vehicle preference | Known / ANY | `REQUEST_VEHICLE_PREFERENCE_UNKNOWN` |
| 8 | Max wait | ≥ 0 | `REQUEST_THRESHOLD_INVALID` |

---

# Stage 1 — H3 route corridor (Layer 1)

**File:** `h3RouteCorridor.ts`  
**Question:** Does the **new pickup** fall near this driver’s **remaining route**?

This runs **first** after request validation — the same role as Redis
`h3_cell → [ride_ids]`. This is **not** “is the driver near the passenger?”  
It is “does the **route** pass near the passenger?”

---

## How the corridor is built

1. Build polyline: `[car] + remaining stops`
2. Convert path to H3 hex cells at `h3Resolution` (default 9)
3. Expand each cell by **1 ring** (padding)
4. Index: `cell → list of driver ids`

Idle drivers: corridor is just their location cell.

---

## How search works

1. Put new pickup in an H3 cell
2. Search rings around that cell: ring 0, then 1, then 2… up to `maxH3Ring` (3)
3. Any driver whose corridor touches a searched cell is **discovered**
4. Stop expanding early if `minimumUsableCandidates` (10) usable drivers found (see Check 1.1)

Drivers never discovered are **not evaluated** further — the engine stops their run at corridor.

---

## Check 1.1 — Corridor match

| Result | Code | Meaning |
|--------|------|---------|
| Pass | `CORRIDOR_MATCH` | Pickup touches this ride’s corridor cells |
| Not evaluated | (empty reasons) | Ride id never returned by Layer 1 lookup — engine marks `NOT_EVALUATED`, no fail code |

`H3_OUTSIDE_SEARCH` exists in `reasons.ts` but the corridor stage does **not** emit it: undiscovered drivers get empty `NOT_EVALUATED` verdicts so they never look “rejected.”

“Usable” for the early-stop count is only: **ONLINE**, vehicle exists, type matches (or `ANY`), and `vehicle.totalSeats >= request.seatsRequired`. It does **not** use peak committed seats, wheelchair, or luggage — a full car can still count toward the 10. Those drivers are still returned as candidates so Stage 2 can reject them with a precise code.

**Pass example**

```
Driver remaining route: Ghaziabad → Knowledge Park → Delta
Pickup: Alpha 1 (on that road corridor)
Driver is currently far away → still PASS
```

**Not evaluated example**

```
Driver remaining route: only south Delhi
Pickup: Rohini (north) → never discovered → NOT_EVALUATED
```

**Behind-the-vehicle example**

```
Driver already past Anand Vihar, heading to Noida
Pickup is behind them on old road → corridor is remaining path only → not discovered
```

---

# Stage 2 — Basic eligibility

**File:** `basicEligibility.ts`  
**Question:** Can this driver/vehicle even be considered? (No map math.)

Runs on **corridor survivors only**. Checks run **in order**. First failure wins.

---

## Check 2.1 — Driver exists

| Fail code | Meaning |
|-----------|---------|
| `DRIVER_NOT_FOUND` | Driver id missing from scenario |

---

## Check 2.2 — Status must be ONLINE

| Status | Result | Fail code |
|--------|--------|-----------|
| `ONLINE` | Pass | — |
| `OFFLINE` | Fail | `DRIVER_OFFLINE` |
| `PAUSED` | Fail | `DRIVER_PAUSED` |
| `BUSY` | Fail | `DRIVER_BUSY` |

**Important for pooling tests:** Mid-trip drivers who should accept pools must stay **`ONLINE`**, not `BUSY`.  
`BUSY` is a hard reject in this lab.

**Examples**

- D01 `ONLINE` → continues  
- D02 `OFFLINE` → rejected  
- D03 mid-trip but marked `BUSY` → rejected (even if seats exist)

---

## Check 2.3 — Vehicle exists

| Fail code | Meaning |
|-----------|---------|
| `VEHICLE_NOT_FOUND` | Driver’s `vehicleId` points nowhere |

---

## Check 2.4 — Vehicle type preference

| Condition | Fail code |
|-----------|-----------|
| Request wants a specific type, vehicle label differs | `VEHICLE_TYPE_MISMATCH` |

**Pass:** Request `ANY`, or request `3-SEATER-AUTO` and vehicle is that.  
**Fail:** Request `6-SEATER`, vehicle is `4-SEATER-CAB`.

---

## Check 2.5 — Wheelchair access

| Condition | Fail code |
|-----------|-----------|
| Request needs wheelchair, vehicle does not have it | `VEHICLE_ACCESSIBILITY_MISMATCH` |

---

## Check 2.6 — Luggage capacity

| Condition | Fail code |
|-----------|-----------|
| `request.luggageCount > vehicle.luggageCapacity` | `VEHICLE_LUGGAGE_EXCEEDED` |

**Example:** 3 bags, vehicle hold = 1 → fail.

---

## Check 2.7 — Conservative seat check

Compute:

1. Seats already onboard (passengers in `PICKED_UP` / `IN_RIDE`)
2. Peak seats used by remaining stop sequence
3. `availableSeats = totalSeats − peakCommitted`

| Condition | Fail code |
|-----------|-----------|
| `availableSeats < request.seatsRequired` | `INSUFFICIENT_CAPACITY` |

**This is conservative.** It asks: “Is the car **ever** too full?”  
Exact “fits in this insert position?” is Stage 6.

**Examples**

| Vehicle seats | Peak committed | New seats | Result |
|---------------|----------------|-----------|--------|
| 4 | 2 | 1 | Pass |
| 4 | 3 | 2 | Fail |
| 6 | 4 | 2 | Pass |

---

### Stage 2 summary table

| Order | Check | Fail code |
|-------|--------|-----------|
| 1 | Driver exists | `DRIVER_NOT_FOUND` |
| 2 | ONLINE | `DRIVER_OFFLINE` / `PAUSED` / `BUSY` |
| 3 | Vehicle exists | `VEHICLE_NOT_FOUND` |
| 4 | Type match | `VEHICLE_TYPE_MISMATCH` |
| 5 | Wheelchair | `VEHICLE_ACCESSIBILITY_MISMATCH` |
| 6 | Luggage | `VEHICLE_LUGGAGE_EXCEEDED` |
| 7 | Seats available (rough) | `INSUFFICIENT_CAPACITY` |

---

# Stage 3 — Operational state

**File:** `operationalState.ts`  
**Question:** For existing passengers, how much lateness is still allowed?

Mostly **builds data** for later stages. Rarely rejects.

---

## What it computes (per remaining stop)

For each stop still on the ride:

| Stop type | When included | Budget used |
|-----------|---------------|-------------|
| PICKUP | Passenger still waiting | `maxPickupDelayMin` (fixed minutes) |
| DROP | Always (until dropped) | `maxDropDelayPercent` → `budgetMin` via solo ETA % |
| PICKUP of onboard rider | **Skipped** | Already happened |

Each budget entry:

```
stopId
passengerId
type (PICKUP or DROP)
originalEtaMin   ← promised time (minutes from when ride was committed)
soloEtaMin       ← solo trip ETA this percent is measured against (drops only)
budgetPercent    ← percent applied (250% on short trips)
budgetMin        ← allowed lateness in minutes
```

**Meaning of a promise**

```
Latest allowed arrival ≈ originalEtaMin + budgetMin
```

**Example — waiting passenger, pickup at 4 min, drop at 20 min, 50% drop tolerance**

```
soloEtaMin = 20 − 4 = 16 min
budgetMin  = 16 × 50% = 8 min
Drop may arrive as late as 20 + 8 = 28 min
```

**Example — short solo trip, pickup at 2 min, drop at 6 min**

```
soloEtaMin = 4 min  → short-trip rule applies
budgetMin  = 4 × 250% = 10 min
```

---

## Check 3.1 — Any flexibility left?

| Condition | Result | Fail code |
|-----------|--------|-----------|
| Idle (no remaining budgets) | Pass | — |
| At least one budget > 0 | Pass | — |
| Every remaining budget ≤ 0 | **Fail** | `OPERATIONAL_NO_FLEXIBILITY` |

**Fail example:** Both remaining drops already tolerate **0** extra minutes — inserting anyone would break a promise.

**Pass example:** Drop A allows +8 min (50% of 16 min solo), Drop B allows +10 min (250% of 4 min short solo).

---

# Stage 4 — Pickup → route distance

**File:** `pickupRouteDistance.ts`  
**Question:** How many km is the pickup from the **route line** (real geometry)?

H3 is approximate. This stage measures actual distance.

---

## Check 4.1 — Point-to-polyline distance

```
distanceKm = shortest distance from pickup to any segment of the route line
```

| Condition | Default | Fail code |
|-----------|---------|-----------|
| `distanceKm ≤ maxPickupToRouteDistanceKm` | **1.5 km** | `PICKUP_TOO_FAR_FROM_ROUTE` |

**Pass:** Pickup 0.4 km from line.  
**Fail:** Pickup 2.0 km from line.

**Idle driver:** Line is a single point (car). Distance = car → pickup.

### Important limit

This is **not** driving detour.  
Pickup 0.5 km off the line might mean ~1 km of real driving (out and back). Stage 9 measures real roads later.

---

# Stage 5 — Direction compatibility

**File:** `directionCompatibility.ts`  
**Question:** Does the **whole new trip** fit this driver’s remaining trip?

**Idle drivers: auto-pass** (`DIRECTION_COMPATIBLE`).

Mid-trip drivers get **2 checks in order**. First fail wins.

---

## Shared setup for mid-trip

```
Route line:     V → remaining stops…
Route bearing:  angle from first point → last point
Request bearing: angle from new pickup → new drop
```

With 2 onboard passengers:

```
Line: V → Drop A → Drop B
Route bearing = bearing(V → Drop B)   ← overall remaining trip, not each passenger’s trip
```

---

## Check 5.1 — Bearing difference (same general heading?)

```
polyline       = [V] + remaining stops in sequence     (V = driver current location)
routeBearing   = bearing(V → last remaining stop)      (start-to-end chord only)
requestBearing = bearing(new pickup → new drop)
difference     = smallest angle between routeBearing and requestBearing   (0–180°)
```

| Condition | Default | Fail code |
|-----------|---------|-----------|
| `difference ≤ maxBearingDifferenceDeg` | **75°** | `BEARING_INCOMPATIBLE` |

### Where the angle starts and ends

| Uses | Does **not** use |
|------|------------------|
| Driver **current location** (`V`) as the start of the route line | GPS heading / which way the car is physically pointing |
| **Last remaining stop** as the end of the route line | Bearing from next stop → drop |
| One straight **chord** V → last stop (`polylineBearingDeg`) | Sum of segment-by-segment turn angles |
| New request pickup → drop for `requestBearing` | Per-passenger headings when multiple people are onboard |

The corridor polyline is built in `corridor.ts` as `[driver.location, …remainingStops]`.  
Check 5.1 reads only the **first and last** point of that list — every intermediate stop (pickups and drops in between) is ignored for bearing. Middle stops still matter for check 5.2 (progress along the line).

### Multi-stop route examples

**Case A — remaining route `V → P2 → D2 → D1`** (e.g. passenger 1 already onboard):

```
Polyline:  V —— P2 —— D2 —— D1
                 ↑    ↑    ↑
            (ignored for bearing)

routeBearing = bearing(V → D1)     ← only V and D1
```

**Case B — remaining route `V → P1 → P2 → D1 → D2`** (all stops still ahead):

```
Polyline:  V —— P1 —— P2 —— D1 —— D2
                 ↑    ↑    ↑    ↑
            (ignored for bearing)

routeBearing = bearing(V → D2)     ← only V and D2
```

The two cases can yield **different** route bearings because the **last stop** differs (D1 vs D2), even when the paths look similar on a map. A route that curves (e.g. east to P2, then north to D1) is still collapsed to one straight V → last-stop line — deliberately loose, because roads are not straight lines.

### Examples

**Pass — both going south**

```
Route:   CP → Khan Market     bearing ≈ 165°
Request: India Gate → AIIMS   bearing ≈ 155°
Difference ≈ 10°  → PASS
```

**Fail — opposite directions**

```
Route:   going south ≈ 165°
Request: going north ≈ 340°
Difference ≈ 165°  → FAIL (BEARING_INCOMPATIBLE)
```

**With 2 onboard**

The app does **not** compare against passenger A’s heading and passenger B’s heading separately.  
It only uses **one** remaining-route compass: **V → last remaining stop**, not V → next stop.

---

## Check 5.2 — Drop ahead of pickup along our path?

**Question:** Along **our** remaining line, does the new rider go **forward** or **backward**?

1. Project **new pickup** onto the line → `pickupProgressKm` (km from car along line)
2. Project **new drop** onto the line → `dropProgressKm`
3. Compare

| Condition | Fail code |
|-----------|-----------|
| `dropProgressKm < pickupProgressKm` | `DESTINATION_BEHIND_VEHICLE` |

Off-corridor drops are **not** rejected here. If the detour is acceptable for everyone, stages 7–11 enforce that through delay and duration budgets.

### Examples

**Pass — forward trip**

```
Line km:  0      2         5         6
          V      ↑pickup   ↑drop     B

5 ≥ 2 → PASS
```

**Fail — U-turn trip**

```
Line km:  0.5    2                  6
          ↑drop  ↑pickup            B

0.5 < 2 → FAIL (wants to go back relative to our path)
```

**Pass — drop after last stop**

```
Pickup projects at 4 km
Drop projects at end / beyond (≈ 6+ km)

drop ≥ pickup → PASS check 5.2
```

---

### Stage 5 summary

| Order | Check | Default | Fail code |
|-------|--------|---------|-----------|
| — | Idle driver | auto-pass | — |
| 1 | Bearing difference | ≤ 75° | `BEARING_INCOMPATIBLE` |
| 2 | Drop progress ≥ pickup progress | — | `DESTINATION_BEHIND_VEHICLE` |

---

# Stages 6–9 — Enumeration vs Google

Google **OptimizeTours** chooses the final stop sequence on real roads — but only within constraints, and only after cheap local stages have already narrowed the problem. **Why enumerate locally if the solver picks the order?**

```
LOCAL (Stages 6–8, free math)              GOOGLE (Stage 9, one paid call per driver)
─────────────────────────────              ─────────────────────────────────────────
• Generate every legal insertion slot      • Real road distance and duration
• Reject if NO ordering fits capacity      • Final optimized visit sequence
• Reject orderings that break promises     • Respect time windows + seat limits
• Rank survivors by straight-line cost     • May interleave new rider anywhere legal
• Keep top N (default 6) on context        • Uses cheapest (#1) as firstSolution hint only
```

**What Google receives**

| Input | Effect |
|-------|--------|
| Shipments (pickup + drop per passenger) | Pickup-before-drop for each rider is automatic |
| `committedPrecedence` | Committed stops keep their **relative order**; new rider may slot into gaps |
| Hard time windows | From delay budgets priced in Stage 3 |
| Seat capacity | Vehicle load limits |
| New rider shipment | Skippable with penalty if truly infeasible |
| `firstSolutionVisits` | **Hint only** — from the cheapest shortlisted ordering (`sequences[0]`) |

**What local enumeration adds that Google alone does not cheaply answer**

1. **“Does any legal insertion exist?”** — If every ordering overflows seats (Stage 6) or breaks every committed promise (Stage 7), fail the driver **without** an API call.
2. **Per-ordering promise checks** — Delay to committed passenger A depends on *where* you insert the new stops. Stage 7 tests each ordering with straight-line ETA; the driver passes if **any one** ordering survives.
3. **Pruning observability** — Stage 8 trims a large candidate set (e.g. 15 → 6) for metrics and to pick the best hint; see [Check 8.1](#check-81--shortlist-and-what-happens-next).

4. **Warm-start for Google** — The cheapest shortlisted ordering becomes a `firstSolution` hint so OptimizeTours starts from a sensible insertion instead of searching cold. See [Why the firstSolution hint?](#why-the-firstsolution-hint) and [Would six calls with six different hints help?](#would-six-calls-with-six-different-hints-improve-matching).

**Invalid orderings are never generated.** Pickup always before drop for the new rider; committed spine order is frozen. Sequences like `P1 → D1 → P2` (drop before pickup) or visiting the same pickup twice do not appear in enumeration or in Google's shipment model.

---

# Stage 6 — Stop sequence generation

**File:** `stopSequenceGeneration.ts` + `insertion/enumerate.ts`  
**Question:** Where can we legally insert the new pickup and drop?

---

## How candidates are built

Existing remaining stops are a **frozen spine** (relative order kept).

New pickup is tried in every gap; new drop is tried in every gap **at or after** pickup.

If there are `n` existing remaining stops, candidate count is:

```
(n + 1)(n + 2) / 2
```

**Example with 2 remaining drops (A, B):** `n = 2` → **6** candidates:

| # | Order |
|---|--------|
| 1 | NewP → NewD → A → B |
| 2 | NewP → A → NewD → B |
| 3 | NewP → A → B → NewD |
| 4 | A → NewP → NewD → B |
| 5 | A → NewP → B → NewD |
| 6 | A → B → NewP → NewD |

Pickup always before drop for the new rider. Existing A before B always.

---

## Check 6.1 — Waypoint limit

Google Routes allows at most **25 intermediate waypoints**.

| Condition | Fail code |
|-----------|-----------|
| `existingStops.length + 1 > 25` | `WAYPOINT_LIMIT_EXCEEDED` |

---

## Check 6.2 — Capacity on every segment

Walk each candidate order:

```
start occupancy = seats already onboard
PICKUP → add seats
DROP   → remove seats
never allow occupancy > vehicle.totalSeats
```

| Condition | Fail code |
|-----------|-----------|
| **No** candidate stays under capacity the whole way | `SEGMENT_CAPACITY_EXCEEDED` |

**Pass example:** 4-seater, 2 onboard, new rider 1 seat → several orders work.  
**Fail example:** 4-seater, 4 seats already onboard for every segment → impossible.

---

### Stage 6 outputs

If at least one order survives:

- Store **all** capacity-feasible orders on the context (`setSequences`) for Stages 7–8
- Pass with `SEQUENCE_GENERATED`
- Record `enumeratedSequences` and `capacityFeasibleSequences` metrics

This stage does **not** call Google. It answers whether slotting the new pickup and drop into the frozen spine is physically possible on every segment.

---

# Stage 7 — Pickup time window

**File:** `pickupTimeWindow.ts`  
**Question:** Would this ordering break a **promised** arrival for someone already on the ride?

Uses **rough** ETAs (straight-line km ÷ `estimatedSpeedKmh` = 24).  
Real road times are checked again in Stage 11.

---

## How one ordering is tested

Start at car location. For each stop in order:

```
cumulativeKm += haversine(previous, stop)
projectedEtaMin = (cumulativeKm / 24) * 60
delayMin = projectedEtaMin − originalEtaMin

if delayMin > budgetMin → this ordering fails
```

| Stop type | Fail code |
|-----------|-----------|
| Committed PICKUP too late | `COMMITTED_PICKUP_DELAY_TOO_HIGH` |
| Committed DROP too late | `COMMITTED_DROP_DELAY_TOO_HIGH` |

---

## Driver-level rule

| Condition | Result |
|-----------|--------|
| Idle / no budgets | Auto-pass |
| At least one ordering survives | Pass — driver continues even if most orderings fail |
| Every ordering breaches a budget | Fail |

The driver is rejected only when **no** ordering keeps every committed promise. Google gets hard windows too, but Stage 7 avoids a paid call when the answer is already “impossible for every slot.”

**Pass example**

```
Insert new pickup early.
Existing drop A still within +8 min budget → that ordering survives
```

**Fail example**

```
Every insertion pushes Drop B more than +12 min past promise → driver fails
```

**Why test each ordering?** The same driver can be fine with `A → NewP → NewD → B` but fail with `NewP → NewD → A → B` because the second pushes A's pickup too late. Google could discover this, but only after routing.

---

# Stage 8 — Detour lower bound

**File:** `detourLowerBound.ts`  
**Question:** Which insertion orderings should we send to the solver first?

```
baselineKm = length of current corridor line
candidateKm = length of [car → candidate stop order]
addedKm = candidateKm − baselineKm
```

Candidates are sorted by `addedKm` (cheapest first). This stage **does not reject** — it only ranks and shortlists. Passenger delay and ride-detour budgets in stage 11 decide whether a match is acceptable.

---

## Check 8.1 — Shortlist and what happens next

Keep at most `maxRoutedInsertionsPerDriver` (**6**) cheapest surviving candidates (by `addedKm`, ascending). The rest are dropped from the context list.

**Example:** 4 remaining stops → Stage 6 generates 15 orderings → Stage 7 leaves 12 → Stage 8 keeps the 6 cheapest by straight-line added length.

| Sequence rank | After Stage 8 | Used in Stage 9? |
|---------------|---------------|------------------|
| #1 (cheapest) | Kept | **Yes** — converted to `firstSolutionVisits` hint |
| #2 – #6 | Kept on context | **No** — not sent to Google separately |
| #7+ | Discarded | — |

Record metrics: `boundFeasibleSequences`, `shortlistedSequences`, `lowerBoundAdditionalKm` (from the cheapest).

**Important:** This is **not** six OptimizeTours calls. Stage 9 makes **one** call per driver and passes only `sequences[0]` as `injectedFirstSolutionRoutes`. Google may still return a different feasible order than the hint. Sequences #2–#6 remain for debugging and for `attemptStats.geographicallyPruned` in Stage 10; there is no fallback loop that retries hint #2 if hint #1 fails.

---

# Stage 9 — Road routing (optimizer)

**File:** `roadRouting.ts`  
**Question:** What does Google OptimizeTours say for real roads / times?

**One OptimizeTours call per live driver** — not one call per shortlisted sequence.

Also computes (via Routes API, not the solver):

- **Solo** new-rider trip: pickup → drop (for later ride-detour math)
- **Baseline** existing trip: car → remaining stops

---

## What is sent to the solver

Built in `ShipmentModelBuilder.ts`, sent via `optimizerProxy.ts`:

| Piece | Role |
|-------|------|
| **Vehicle** | Starts at driver **current location**; seat capacity |
| **Committed shipments** | Mandatory (`penaltyCost: null`); hard pickup/drop deadlines from Stage 3 budgets. Pickup deadline = `max(originalEtaMin, mock travel floor) + maxPickupDelayMin`. Drop deadline = `max(originalEtaMin, mock travel floor) + budgetMin`. Mock floors are multiplied by `GOOGLE_TRAVEL_SLACK` (2) so real Google travel times do not immediately invalidate the injected spine. |
| **New rider shipment** | Skippable with finite penalty (`NEW_PASSENGER_PENALTY_COST` = 1000) — infeasibility becomes `skippedShipments[]`. Soft pickup deadline = `request.maxWaitMinutes`. |
| **`committedPrecedence`** | Consecutive committed stops → Google `precedenceRules`; relative order locked, gaps open for interleaving |
| **`firstSolutionVisits`** | From `getSequences(driverId)[0]` — optional starting route; **not** a hard lock |
| **`lockedVisits`** | Legacy append-only lock; empty in current pooling path |

**What Google decides:** Final visit order on real roads, respecting precedence, windows, and capacity. It may place the new pickup/drop in a different gap than the hint if that is cheaper and still feasible.

**What Google does not receive:** The other shortlisted sequences (#2–#6). If the solve skips the new rider, the pipeline does not automatically retry with the next hint.

---

## Why the `firstSolution` hint?

OptimizeTours is a **heuristic solver**, not an exhaustive “try every ordering” search. With several shipments, hard time windows, seat limits, and precedence rules, the search space is large. A poor or empty starting point can cause:

- **Slow solves** — hitting `optimizerTimeoutMs` before a good route is found
- **False infeasibility** — new rider appears in `skippedShipments` even when *some* legal insertion exists on real roads
- **Suboptimal first feasible route** — the solver never explored a better region early

The hint (`firstSolutionVisits` → `injectedFirstSolutionRoutes` in `optimizerProxy.ts`) is a **warm start**:

```
“Here is a visit order that looked cheap on straight-line math
 and passed local capacity + promise checks — start from here.”
```

| Hint | Hard lock |
|------|-----------|
| Suggested starting sequence for the solver | Committed relative order still enforced by `precedenceRules` |
| Built from `sequences[0]` (cheapest after Stage 8) | Google may return a **different** feasible order if it is better on roads |
| Improves speed and feasibility | Does not force that exact stop order |

Stages 6–7 already proved **at least one** ordering is legally possible and promise-safe; Stage 8 picks the **cheapest straight-line** one to seed Stage 9. The hint bridges cheap geometry and expensive road routing — it does not replace Google’s optimization.

---

## Would six calls with six different hints improve matching?

**Not done today.** The lab makes **one** OptimizeTours call per driver with **one** hint. The shortlist of six exists to choose that hint and for metrics — not to run the solver six times.

### When multiple hints *could* help

| Situation | Why a second hint might succeed where the first fails |
|-----------|--------------------------------------------------------|
| Hint #1 is straight-line cheap but **bad on real roads** (river, one-way, median) | Hint #2 uses a different insertion slot that routes better |
| First solve returns **`OPTIMIZER_INFEASIBLE`** (new rider skipped) | Another slot may still be feasible once Google fetches real travel times |
| Solver **timeout** with a weak starting route | A different warm start may converge faster |

**Example:** Cheapest by crow-flight might be `NewP → NewD → A → B`, but roads make that terrible. `A → NewP → NewD → B` might be slightly longer in straight-line but much better on roads — hint #1 misleads; hint #2 might succeed.

### When extra calls would not help much

| Situation | Why |
|-----------|-----|
| Truly infeasible (capacity, windows, precedence) | Every hint hits the same constraints → all fail |
| Google already finds the best feasible order from one good hint | Extra calls duplicate the same problem |
| Shortlisted hints are all similar insertions | Little diversity in starting points |

Each retry would send the **same** shipments, windows, capacity, and precedence — only the **starting route** changes. You are not solving six different problems; you are solving **one** problem six times with six starting points.

### Tradeoff (why the lab uses one call)

| One call + one hint (current) | Six calls + six hints (hypothetical) |
|------------------------------|--------------------------------------|
| Lower API cost and latency | ~6× OptimizeTours cost per driver |
| Stays within `maxOptimizerCallsPerRun` longer | Burns optimizer budget faster |
| May miss a feasible slot if hint #1 misleads on roads | Higher chance to find *some* feasible insertion |
| Appropriate for a cost-controlled lab | Better match rate when geometry ≠ roads |

A plausible future enhancement: on `OPTIMIZER_INFEASIBLE`, retry with `sequences[1]`, then `[2]`, … up to `maxRoutedInsertionsPerDriver`. That would actually consume the shortlist; **the current code does not implement this retry loop.**

---

## Possible outcomes

| Result | Code | Status | Meaning |
|--------|------|--------|---------|
| Pass | `OPTIMIZER_SOLVED` | PASSED | Got a stop sequence + road legs |
| Fail | `OPTIMIZER_INFEASIBLE` | FAILED | New rider skipped — cannot fit |
| Fail | `OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED` | FAILED | Committed rider was dropped (model/error) |
| Not evaluated | `OPTIMIZER_CALL_FAILED` | NOT_EVALUATED | API / auth-other-than-missing-credentials / validation error. Missing Google credentials **throw** and abort the run. |
| Not evaluated | `OPTIMIZER_BUDGET_EXCEEDED` | NOT_EVALUATED | Too many optimizer calls this run |
| Fail | `ROUTE_LEG_MISMATCH` | FAILED | Bad response shape (`legs.length !== visits.length`) |

**Pass example:** Solver returns V → A → NewP → NewD → B with road legs.  
**Fail example:** New rider appears in `skippedShipments` → `OPTIMIZER_INFEASIBLE`.

---

# Stage 10 — Incremental cost

**File:** `incrementalCost.ts`  
**Question:** Who gains/loses how much?

**Rejects nobody.** Only measures. Stage 11 judges.

---

## Metrics computed

| Metric | Formula / meaning |
|--------|-------------------|
| `originalDistanceKm` | Baseline road km (without new rider) |
| `newDistanceKm` | Solved road km (with new rider) |
| `additionalDistanceKm` | `new − original` |
| `detourPercent` | `(additional / original) × 100` if mid-trip, else 0 |
| `additionalDurationMin` | Extra minutes of driving |
| `newPassengerPickupDelayMin` | Minutes until new pickup (= wait from now). Same as pickup ETA; there is no earlier promise. |
| `newPassengerRideDetourMin` | `(dropEta − pickupEta) − soloDuration` (floored at 0) |
| `maximumExistingPassengerDelayMin` | Worst **drop** delay vs the **baseline** remaining route (solved arrival − baseline arrival). Pickup delays are recorded on the insertion object for the UI but are **not** included in this maximum. |

### Insertion attempt stats (debug UI)

Stage 10 also records how many orderings were considered vs pruned (`DriverDetailSheet`):

| Stat | Meaning |
|------|---------|
| `enumerated` | Total legal orderings from Stage 6 |
| `occupancyPruned` | Stage 6: `enumeratedSequences − capacityFeasibleSequences` |
| `geographicallyPruned` | `capacityFeasibleSequences − shortlistedSequences` — includes **both** Stage 7 time-window drops and Stage 8 shortlist discards (the metric never subtracts Stage 7 on its own) |
| `routed` | Always **1** — one OptimizeTours call per driver |
| `feasible` | **1** if the solver served the new rider |

So a line like “6 shortlisted, 1 routed” is expected — the six are not six Google runs.

### Examples

**Detour % (display / metrics)**

```
Baseline = 5.0 km
New      = 10.6 km
Additional = 5.6 km
Detour % = 112%
```

Note: current hard reject stage uses **promised delay minutes** (vs Stage 3 `originalEtaMin + budgetMin`) plus new-rider wait/ride-detour minutes and pooling flags. It does **not** reject on `detourPercent`, extra km, corridor extension km, or extra duration. Those numbers are display/metrics only. Codes like `ROUTE_DETOUR_TOO_HIGH` / `ADDITIONAL_DISTANCE_TOO_HIGH` / `CORRIDOR_EXTENSION_TOO_LONG` / `ADDITIONAL_DURATION_TOO_HIGH` exist in `reasons.ts` but are **not emitted** by Stage 11.

**New rider ride detour**

```
Solo India Gate → AIIMS = 12 min
Pooled ride time = 19 min
Ride detour = 7 min
```

---

# Stage 11 — Hard constraints

**File:** `hardConstraints.ts`  
**Question:** Is this match acceptable for **everyone**?

Binary pass/fail. Fixed check order.

---

## Part A — Mid-trip delay (only if driver has remaining stops)

### Check 11.1 — Existing passenger delay budgets

For each committed stop (pickup in minutes, drop from stage 3 `budgetMin`):

```
delay = solvedArrival − originalEtaMin     (the promise, not the Stage 10 baseline delta)
if delay > budgetMin → FAIL
```

| Fail code | Meaning |
|-----------|---------|
| `EXISTING_PASSENGER_DELAY_TOO_HIGH` | Someone already on the ride is too late |

The effective drop `budgetMin` already includes both the passenger's `maxDropDelayPercent` and the global `maxExistingPassengerDelayPercent` (whichever is stricter), plus the short-trip 250% rule when applicable.

---

## Part B — New rider limits (all drivers)

### Check 11.2 — New pickup wait

| Condition | Default | Fail code |
|-----------|---------|-----------|
| Wait > `maxNewPassengerPickupDelayMin` | **8 min** | `NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH` |

---

### Check 11.3 — New rider’s own trip stretched too much

| Condition | Default | Fail code |
|-----------|---------|-----------|
| Ride detour > `maxNewPassengerRideDetourMin` | **12 min** | `NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH` |

---

## Part C — Pooling policy (only if driver already has passengers)

Skipped for pure solo / idle matches.

### Check 11.4 — Vehicle allows pooling

| Fail code |
|-----------|
| `POOLING_NOT_SUPPORTED` |

### Check 11.5 — Request allows pooling

| Fail code |
|-----------|
| `POOLING_NOT_ALLOWED_BY_REQUEST` |

### Check 11.6 — Every existing rider allows pooling

| Fail code |
|-----------|
| `POOLING_NOT_ALLOWED_BY_EXISTING_RIDER` |

### Check 11.7 — Max pooled passengers

| Condition | Default | Fail code |
|-----------|---------|-----------|
| `existingCount + 1 > maxPooledPassengers` | **4** | `MAX_POOLED_PASSENGERS_EXCEEDED` |

---

### Stage 11 summary table

| Order | Applies when | Check | Default | Fail code |
|-------|--------------|--------|---------|-----------|
| 1 | Mid-trip | Per-stop delay budget (drop = % of solo ETA) | personal + global | `EXISTING_PASSENGER_DELAY_TOO_HIGH` |
| 2 | Always | New pickup wait | 8 min | `NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH` |
| 3 | Always | New ride detour | 12 min | `NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH` |
| 4 | Has riders | Vehicle pooling on | — | `POOLING_NOT_SUPPORTED` |
| 5 | Has riders | Request pooling on | — | `POOLING_NOT_ALLOWED_BY_REQUEST` |
| 6 | Has riders | Existing riders allow share | — | `POOLING_NOT_ALLOWED_BY_EXISTING_RIDER` |
| 7 | Has riders | Pool size | ≤ 4 | `MAX_POOLED_PASSENGERS_EXCEEDED` |

---

# Stage 12 — Scoring

**File:** `scoring.ts`  
**Question:** Among drivers who passed hard limits, who is fairest?

**Does not reject.** Lower score = better.

| Component | Default weight | Raw value | Normalized against |
|-----------|----------------|-----------|--------------------|
| Driver impact | 30 | Extra duration minutes (forced **0** if idle) | `maxNewPassengerRideDetourMin` |
| Existing rider impact | 30 | Worst **drop** delay vs **baseline** (`maximumExistingPassengerDelayMin`) | **Largest** drop `budgetMin` from Stage 3 (`maximumExistingPassengerDelayBudgetMin`), not the tightest |
| New rider impact | 25 | New ride detour minutes | `maxNewPassengerRideDetourMin` |
| Pickup wait | 15 | New pickup wait | `maxNewPassengerPickupDelayMin` |

Weights are rescaled to sum to 1 (`normalizeWeights`). Each component is `clamp((raw / threshold) × 100, 0, 100)` then multiplied by its share.

```
finalScore = sum(normalized × weightShare)
```

**Example**

```
Driver A score 22.1
Driver B score 41.8
→ A ranks better
```

---

# Stage 13 — Commit

**File:** `commit.ts`  
**Question:** Build the plan that becomes the new baseline if we accept this driver.

Creates for each surviving solution:

- New ordered stops
- Fresh `originalEtaMin` from solver arrival times

**Does not mutate the scenario by itself.** The UI/store applies the plan.

Pass reason: `COMMIT_READY`.

---

# 21. Full story examples

## Example A — Happy pool (2 onboard + 1 new, same corridor)

```
V → Drop A → Drop B   (south)
New pickup near A, new drop a bit after B on same road
```

| Stage | Result |
|-------|--------|
| 0 | Request valid |
| 1 | Corridor match |
| 2 | ONLINE / vehicle / seats OK |
| 3 | Delay budgets for A and B |
| 4 | Pickup close to remaining-route line |
| 5 | South bearing; drop progress ≥ pickup progress (extension km is recorded, not a reject) |
| 6 | e.g. 6 legal orders with 2 remaining drops `(n+1)(n+2)/2` |
| 7 | e.g. 4 survive promise checks; 2 fail because NewP before A delays A too much |
| 8 | Keep 4 (under cap 6); cheapest by straight-line added km becomes hint #1 |
| 9 | **One** Google call; hint from #1; solver may return e.g. `V → A → NewP → NewD → B` |
| 10 | `attemptStats`: enumerated 6, occupancyPruned 0, geographicallyPruned 2 (`6 − 4`), **routed 1** |
| 11 | Pass if promised delays, new wait, new ride detour, and pooling flags are OK |
| 12–13 | Rank + commit plan |

---

## Example B — Pickup good, drop off corridor

```
Pickup on line ✅
Drop 15 km west (same general direction)
```

| Stage | Result |
|-------|--------|
| 1, 4 | Pickup may pass corridor + distance |
| **5.1** | May pass if bearing within 75° |
| **5.2** | Passes if drop projects at/after pickup along the remaining line |
| 7–11 | May **fail** if delay or ride-detour budgets are exceeded |

May reach Google if direction passes.

---

## Example C — Same direction but too long

```
Drop 20 km further south on same road
```

| Stage | Result |
|-------|--------|
| 5 | Direction often **passes** (off-corridor drop is not rejected here) |
| 8 | **Shortlists** only — does not reject on distance |
| 11 | May **fail** if passenger delay or ride-detour budgets are exceeded |

Direction = “compatible path.”  
Hard limits = “is the harm to each rider still within their budget?”

---

## Example D — Idle driver solo trip

```
D01 ONLINE, no ride
Request: India Gate → AIIMS
```

| Stage | Result |
|-------|--------|
| 1 | Pass if pickup is near the idle-car cell (corridor is a single point) |
| 2 | Vehicle / seats / status |
| 3 | No committed budgets |
| 4 | Distance = car → pickup |
| 5 | Auto-pass direction |
| 6 | Only order: NewP → NewD |
| 8 | Idle: not treated as a detour for scoring later |
| 9–11 | Solo feasibility + wait / ride-detour caps (pooling checks skipped — no existing riders) |
| 12 | Driver impact scored as 0 extra |

---

## Example E — BUSY mid-trip driver

```
Driver has ride but status = BUSY
```

Fails **Stage 2** (`DRIVER_BUSY`) after being discovered in the corridor.  
For pooling tests, keep mid-trip drivers **ONLINE**.

---

## Example F — Capacity trap

```
4-seater, 3 seats already onboard, new rider needs 2 seats
```

May fail **Stage 2** conservative check (`INSUFFICIENT_CAPACITY`), or **Stage 6** segment capacity if the peak only collides for some insert slots.

---

## Example G — Many insertions, one Google call

Driver with **4 remaining stops** → Stage 6 generates **15** orderings.

```
Stage 6   15 legal orders (capacity OK on every segment)
Stage 7   12 survive (3 orderings push a committed drop past its budget)
Stage 8   keep 6 cheapest by straight-line added km; discard 6 more
Stage 9   1 OptimizeTours call; only sequences[0] → firstSolution hint
          Google returns final road sequence (may differ from hint)
Stage 10  geographicallyPruned = capacityFeasible − shortlisted = 15 − 6 = 9
          (the 3 Stage-7 failures are inside that 9); routed = 1
```

Raising `maxRoutedInsertionsPerDriver` keeps more candidates on the context for metrics and a potentially better **first** hint — it does **not** multiply OptimizeTours calls unless a hint-retry loop is added (see [Would six calls with six different hints improve matching?](#would-six-calls-with-six-different-hints-improve-matching)).

---

# 22. “Why did I fail?” cheat sheet

| What you see | Likely stage | What to check |
|--------------|--------------|---------------|
| Request invalid | 0 | Pickup/drop/passenger/seats/`maxWaitMinutes` |
| Never judged / empty corridor | 1 | Pickup vs remaining route; driver was not discovered |
| Offline / paused / busy | 2 | Driver status (`BUSY` ≠ mid-trip) |
| Wrong vehicle / luggage / wheelchair | 2 | Vehicle vs request |
| Not enough seats | 2 or 6 | Conservative peak vs segment walk |
| No flexibility | 3 | Every remaining delay budget ≤ 0 |
| Pickup too far from route | 4 | Distance to line > 1.5 km |
| Wrong direction | 5.1 | Bearing > 75° |
| Destination behind | 5.2 | Drop progress < pickup progress |
| No legal sequence / capacity | 6 | `SEGMENT_CAPACITY_EXCEEDED` or `WAYPOINT_LIMIT_EXCEEDED` |
| Committed delay too high | 7 | Promises vs rough ETAs |
| Shortlist (not separate routes) | 8 → 9 | Up to 6 kept; only #1 is solver hint; `routed` is always 1 |
| Optimizer infeasible / skipped rider | 9 | `OPTIMIZER_INFEASIBLE` |
| Optimizer call/budget | 9 | `OPTIMIZER_CALL_FAILED` / `OPTIMIZER_BUDGET_EXCEEDED` are **not evaluated** |
| Passenger delay / ride detour / waits | 11 | Hard caps vs promises and settings |
| Pooling forbidden | 11 | Vehicle / request / existing rider / max pooled |

---

# 23. Known lab limits

1. **Direction ≠ cost.** A trip can pass Stage 5 and still fail Stage 11 on passenger delay or ride-detour budgets. Stage 5 does not reject off-corridor drops.
2. **Enumeration ≠ final route.** Stages 6–8 explore insertion slots with straight-line math; Stage 9 returns the road-network sequence. Google may differ from the `firstSolution` hint and from every enumerated ordering.
3. **`maxRoutedInsertionsPerDriver` shortlists, it does not multiply API calls.** Only `sequences[0]` becomes the solver hint; sequences #2–#6 are not routed separately and there is no retry with the next hint on failure. See [Would six calls with six different hints improve matching?](#would-six-calls-with-six-different-hints-improve-matching) for when multi-hint retries could help and why the lab does not do them today.
4. **`detourPercent` / extra km / extra duration / corridor extension are measured, not hard-rejected.** Stage 11 uses promised delay minutes, new pickup wait, new ride detour, and pooling policy only.
5. **`BUSY` blocks pooling** — use `ONLINE` for mid-trip poolable drivers.
6. **Optimizer proxy is dev-only** (`bun run dev`). Built static apps cannot call Stage 9.
7. **Scoring ranks drivers**, not multiple sequences per driver (one solver answer per driver). Existing-rider scoring uses drop delay vs the **baseline route**, while Stage 11 uses delay vs the **promise** (`originalEtaMin`).
8. **No hint retry loop.** If OptimizeTours skips the new rider with hint #1, hints #2–#6 are not tried automatically — a possible future improvement at higher API cost.
9. **`maxRoutingCallsPerRun` is not mapped to a stage verdict today.** `InstrumentedRoutingEngine` throws `RoutingBudgetExceededError`; Stage 9 only special-cases optimizer budget/credentials. Stage 10 swallows polyline `getRoute` failures and falls back to waypoints.
10. **Reason codes in `reasons.ts` that current stages do not emit** include `H3_CANDIDATE_FOUND`, `H3_OUTSIDE_SEARCH`, `CORRIDOR_NO_MATCH`, `NO_LEGAL_SEQUENCE`, `DETOUR_LOWER_BOUND_EXCEEDED`, `ROUTE_DETOUR_TOO_HIGH`, `ADDITIONAL_DISTANCE_TOO_HIGH`, `CORRIDOR_EXTENSION_TOO_LONG`, `ADDITIONAL_DURATION_TOO_HIGH`, `ROUTE_NO_FEASIBLE_INSERTION`, `ROUTING_BUDGET_EXCEEDED`, `ROUTING_FAILED`. Treat them as reserved labels, not live funnel outcomes.

---

## Where to look in code

| Topic | Path |
|-------|------|
| Stage registry / order | `apps/simulation/src/matching/stages/index.ts`, `apps/simulation/src/domain/settings.ts` (`DEFAULT_STAGE_ORDER`) |
| Engine / not-evaluated | `apps/simulation/src/matching/engine.ts` |
| Delay budget math | `apps/simulation/src/matching/delayBudget.ts` |
| Defaults | `apps/simulation/src/domain/settings.ts` |
| Reason codes | `apps/simulation/src/matching/reasons.ts` |
| Corridor building | `apps/simulation/src/matching/corridor.ts` |
| Insertion enumeration | `apps/simulation/src/matching/insertion/enumerate.ts` |
| Detour shortlist (Stage 8) | `apps/simulation/src/matching/stages/detourLowerBound.ts` |
| Optimizer model + hint | `apps/simulation/src/optimization/ShipmentModelBuilder.ts` |
| Road routing (Stage 9) | `apps/simulation/src/matching/stages/roadRouting.ts` |
| OptimizeTours proxy | `apps/simulation/server/optimizerProxy.ts` |
| Occupancy walk | `apps/simulation/src/matching/occupancy.ts` |
| Geo helpers (bearing, projection) | `apps/simulation/src/lib/geo.ts` |
| High-level design | `docs/Overview.md` |

---

*Generated for the Shareway Ride Matching Lab. When settings or stage logic change, update this guide to match `apps/simulation/src/matching/stages/`.*
