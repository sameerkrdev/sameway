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
5. [Stage 0 — Request validation](#stage-0--request-validation)
6. [Stage 1 — H3 route corridor (Layer 1)](#stage-1--h3-route-corridor-layer-1)
7. [Stage 2 — Basic eligibility](#stage-2--basic-eligibility)
8. [Stage 3 — Operational state](#stage-3--operational-state)
9. [Stage 4 — Pickup → route distance](#stage-4--pickup--route-distance)
10. [Stage 5 — Direction compatibility](#stage-5--direction-compatibility)
11. [Stage 6 — Stop sequence generation](#stage-6--stop-sequence-generation)
12. [Stage 7 — Pickup time window](#stage-7--pickup-time-window)
13. [Stage 8 — Detour lower bound](#stage-8--detour-lower-bound)
14. [Stage 9 — Road routing (optimizer)](#stage-9--road-routing-optimizer)
15. [Stage 10 — Incremental cost](#stage-10--incremental-cost)
16. [Stage 11 — Hard constraints](#stage-11--hard-constraints)
17. [Stage 12 — Scoring](#stage-12--scoring)
18. [Stage 13 — Commit](#stage-13--commit)
19. [Full story examples](#20-full-story-examples)
20. [“Why did I fail?” cheat sheet](#21-why-did-i-fail-cheat-sheet)
21. [Known lab limits](#22-known-lab-limits)

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
| **Geometry pruning** | `maxPickupToRouteDistanceKm`, `maxDropToRouteDistanceKm`, `maxBearingDifferenceDeg`, `estimatedSpeedKmh` | Cheap straight-line gates before any solver call (stages 4–5, 7) |
| **Delay and detour budgets** | `maxNewPassengerPickupDelayMin`, `maxNewPassengerRideDetourMin`, `maxExistingPassengerDelayMin`, `maxAdditionalDurationMin`, `maxCorridorExtensionKm` | How much harm each party may absorb (stages 8, 11) |
| **Pooling policy** | `maxPooledPassengers` | Maximum shared passengers (stage 11) |
| **Cost control** | `maxOptimizerCallsPerRun`, `maxRoutingCallsPerRun`, `maxRoutedInsertionsPerDriver`, `optimizerTimeoutMs` | Stops a run from spending unbounded API quota (stages 8–9) |
| **Scoring weights** | `weights.*` | Biases the final ranking without rejecting anyone (stage 12) |

Passengers can carry their own pickup/drop delay tolerances (`maxPickupDelayMin`,
`maxDropDelayMin`); when unset, they inherit `DEFAULT_PASSENGER_DELAY_BUDGETS`,
which mirrors the scenario defaults. A handful of values are fixed code constants
rather than settings — notably `MAX_INTERMEDIATE_WAYPOINTS` (25, Google's Routes
API limit) and `MAX_MATRIX_ELEMENTS` (625, RouteMatrix limit).

### Hard filters

**Hard filters** are the stages whose main job is a binary pass/fail decision. A
driver that fails one never reaches scoring and never gets a second rejection
reason. Early filters shrink the candidate set cheaply: request validation, H3
corridor discovery, basic eligibility (status, vehicle, conservative seats),
pickup-to-route distance, direction compatibility, stop-sequence generation
(capacity and precedence), pickup time windows, and the detour lower bound all
reject drivers or orderings that are obviously incompatible before OptimizeTours
runs (stage 9). After routing, **incremental cost** (stage 10) deliberately does
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
| `maxDropToRouteDistanceKm` | **3 km** | 5 | Maximum distance from the new passenger's **drop** to the ride's route line. Rejects requests whose destination would drag the vehicle far off the existing corridor. |
| `maxBearingDifferenceDeg` | **75°** | 5 | Maximum angle between the ride's heading and the new request's pickup→drop direction. Filters obviously wrong-way or perpendicular trips before routing. Deliberately loose — roads are not straight lines. |
| `estimatedSpeedKmh` | **24 km/h** | 7 | Assumed average speed for **straight-line ETA estimates only** in the pickup time-window pre-filter. Real road times come from the solver in stage 9; this just prunes hopeless orderings cheaply. |
| `maxCorridorExtensionKm` | **15 km** | 8, 11 | For same-direction pooling: maximum extra road distance the route may extend **past the last committed stop** to reach the new drop. Checked as a straight-line lower bound in stage 8 and again on real road distance in stage 11. |
| `maxRoutedInsertionsPerDriver` | **6** | 8 | Maximum stop-sequence orderings sent to OptimizeTours per driver. Stage 8 keeps the cheapest candidates by straight-line added length and discards the rest to control solver cost. |
| `maxAdditionalDurationMin` | **12 min** | 11, 12 | For mid-trip matches: maximum extra **total travel time** the insertion adds to the driver's route compared to the baseline. Hard reject in stage 11; also used to normalise the driver-impact term in stage 12 scoring. |
| `maxExistingPassengerDelayMin` | **12 min** | 11, 12 | Global backstop for how late any **existing** passenger may arrive compared to their promised ETA. Per-passenger budgets on the passenger record are checked first; this ceiling catches scenarios where none were set explicitly. |
| `maxNewPassengerPickupDelayMin` | **10 min** | 11, 12 | Maximum time the **new** passenger waits at pickup compared to arriving immediately (solo trip ETA to pickup). Measures wait cost of sharing, not total trip length. |
| `maxNewPassengerRideDetourMin` | **12 min** | 11, 12 | Maximum extra time the **new** passenger's own journey takes when pooled versus riding solo (pooled ride duration minus solo ride duration). Protects the new rider from an unacceptably stretched trip. |
| `maxPooledPassengers` | **4** | 11 | Maximum number of passengers allowed in one shared vehicle at once, counting the new request. Solo rides (no existing passengers) are not subject to this cap. |
| `maxOptimizerCallsPerRun` | 40 | 9 | Hard cap on `OptimizeTours` API calls per matching run. Drivers beyond the budget are marked **not evaluated**, not rejected — budget exhaustion is not an opinion about a driver. |
| `optimizerTimeoutMs` | 10_000 | 9 | Per-call timeout passed to the Route Optimization API. A timed-out solve fails that driver's routing attempt for this run. |

Per passenger (on the passenger record):

| Field | Default source | Description |
|-------|----------------|-------------|
| `maxPickupDelayMin` | `DEFAULT_PASSENGER_DELAY_BUDGETS` (10 min) | How many minutes **later than promised** this passenger's pickup may still arrive. Stage 3 prices each committed pickup stop with this value; stages 7 and 11 enforce it. Onboard passengers' pickups are skipped — they already happened. |
| `maxDropDelayMin` | `DEFAULT_PASSENGER_DELAY_BUDGETS` (12 min) | How many minutes **later than promised** this passenger's drop may arrive. Same lifecycle as pickup delay: priced in stage 3, pre-filtered in stage 7, verified on real road times in stage 11. |
| `seatsRequired` | Set per passenger | Number of seats this passenger occupies. Checked in request validation (stage 0) and again during segment-capacity walks in stop-sequence generation (stage 6). |
| `allowsPooling` | `true` in most presets | Whether this passenger agrees to share a vehicle with strangers. Stage 11 rejects a pool if any **existing** rider on the candidate ride has this set to `false`. The new request has its own separate `poolingAllowed` flag. |

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
4. Stop expanding early if `minimumUsableCandidates` (10) usable drivers found

“Usable” for the early-stop count means roughly: ONLINE + matching vehicle type + enough seats.  
Drivers never discovered are **not evaluated** further — the engine stops their run at corridor.

---

## Check 1.1 — Corridor match

| Result | Code | Meaning |
|--------|------|---------|
| Pass | `CORRIDOR_MATCH` | Pickup touches this ride’s corridor cells |
| Not evaluated | — | Ride id never returned by Layer 1 lookup |

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
| PICKUP | Passenger still waiting | `maxPickupDelayMin` |
| DROP | Always (until dropped) | `maxDropDelayMin` |
| PICKUP of onboard rider | **Skipped** | Already happened |

Each budget entry:

```
stopId
passengerId
type (PICKUP or DROP)
originalEtaMin   ← promised time (minutes from when ride was committed)
budgetMin        ← how late is still OK
```

**Meaning of a promise**

```
Latest allowed arrival ≈ originalEtaMin + budgetMin
```

---

## Check 3.1 — Any flexibility left?

| Condition | Result | Fail code |
|-----------|--------|-----------|
| Idle (no remaining budgets) | Pass | — |
| At least one budget > 0 | Pass | — |
| Every remaining budget ≤ 0 | **Fail** | `OPERATIONAL_NO_FLEXIBILITY` |

**Fail example:** Both remaining drops already tolerate **0** extra minutes — inserting anyone would break a promise.

**Pass example:** Drop A allows +8 min, Drop B allows +12 min.

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

Mid-trip drivers get **3 checks in order**. First fail wins.

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
difference = smallest angle between routeBearing and requestBearing   (0–180°)
```

| Condition | Default | Fail code |
|-----------|---------|-----------|
| `difference ≤ maxBearingDifferenceDeg` | **75°** | `BEARING_INCOMPATIBLE` |

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
It only uses **one** remaining-route compass: start of line → end of line.

---

## Check 5.2 — Drop near corridor?

**Question:** Is the new drop still related to our path, or far off to the side?

The code classifies the drop with `classifyDropRelativeToRoute`:

| Case | What is measured | Limit |
|------|------------------|-------|
| Drop beside the line | Perpendicular distance to line | ≤ **3 km** |
| Drop **past last stop**, same direction (“forward extension”) | **Sideways** offset from last segment | ≤ **3 km** |

| Fail code | Meaning |
|-----------|---------|
| `DESTINATION_OFF_CORRIDOR` | Drop too far off the corridor |

### Examples

**Fail — 15 km west**

```
V → A → B (south)
Drop 15 km west of the line

Sideways distance huge → FAIL
```

**Pass — 15 km south on same road**

```
V → A → B ─────────────→ Drop (further south)

This is a forward extension.
Sideways ≈ 0 → PASS check 5.2
(Later stages may still reject if extension is too long)
```

**Fail — 15 km south but parallel road far left**

```
V → A → B
              Drop (south but 5 km east of road)

Lateral offset > 3 km → FAIL
```

### Why look at drop at all?

Pickup-only matching is dangerous for pooling:

```
Pickup on the line ✅
Drop far west ❌
```

Pickup looks great; the whole trip still pulls the car off its corridor. Check 5.2 catches that early.

---

## Check 5.3 — Drop ahead of pickup along our path?

**Question:** Along **our** remaining line, does the new rider go **forward** or **backward**?

1. Project **new pickup** onto the line → `pickupProgressKm` (km from car along line)
2. Project **new drop** onto the line → `dropProgressKm`
3. Compare

| Condition | Fail code |
|-----------|-----------|
| `dropProgressKm < pickupProgressKm` | `DESTINATION_BEHIND_VEHICLE` |

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

drop ≥ pickup → PASS check 5.3
```

### Check 5.2 vs 5.3 (difference)

| | Check 5.2 | Check 5.3 |
|---|-----------|-----------|
| Asks | How far **off the side** is the drop? | Is drop **before/after** pickup on our path? |
| Catches | Wrong corridor / sideways destination | Backward / return trip |

---

### Stage 5 summary

| Order | Check | Default | Fail code |
|-------|--------|---------|-----------|
| — | Idle driver | auto-pass | — |
| 1 | Bearing difference | ≤ 75° | `BEARING_INCOMPATIBLE` |
| 2 | Drop off-corridor distance | ≤ 3 km | `DESTINATION_OFF_CORRIDOR` |
| 3 | Drop progress ≥ pickup progress | — | `DESTINATION_BEHIND_VEHICLE` |

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

- Store those orders for next stages
- Pass with `SEQUENCE_GENERATED`

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
| At least one ordering survives | Pass |
| Every ordering breaches a budget | Fail |

**Pass example**

```
Insert new pickup early.
Existing drop A still within +8 min budget → that ordering survives
```

**Fail example**

```
Every insertion pushes Drop B more than +12 min past promise → driver fails
```

---

# Stage 8 — Detour lower bound

**File:** `detourLowerBound.ts`  
**Question:** Using only straight-line math, is this obviously too expensive?

```
baselineKm = length of current corridor line
candidateKm = length of [car → candidate stop order]
addedKm = candidateKm − baselineKm
```

Candidates are sorted by `addedKm` (cheapest first).

---

## Check 8.1 — Corridor extension cap (only some pools)

If Stage 5 marked this as a **forward corridor extension** (drop continues past last stop, same direction):

| Condition | Default | Fail code |
|-----------|---------|-----------|
| Best `addedKm > maxCorridorExtensionKm` | **15 km** | `DETOUR_LOWER_BOUND_EXCEEDED` |

**Idle drivers:** not treated as detours here.

**Normal (non-extension) pooling:** does **not** hard-fail on km here — only shortlists.

---

## Check 8.2 — Shortlist for Google

Keep at most `maxRoutedInsertionsPerDriver` (**6**) cheapest surviving candidates.

This reduces Stage 9 cost.

---

# Stage 9 — Road routing (optimizer)

**File:** `roadRouting.ts`  
**Question:** What does Google OptimizeTours say for real roads / times?

One optimizer call **per live driver**.

Also computes:

- **Solo** new-rider trip: pickup → drop (for later ride-detour math)
- **Baseline** existing trip: car → remaining stops via Routes API

---

## What is sent to the solver

- Shipments for committed passengers (mandatory)
- Shipment for new rider (skippable with penalty)
- Precedence / injection so committed relative order is preserved
- Time windows from delay budgets

---

## Possible outcomes

| Result | Code | Meaning |
|--------|------|---------|
| Pass | `OPTIMIZER_SOLVED` | Got a stop sequence + road legs |
| Fail | `OPTIMIZER_INFEASIBLE` | New rider skipped — cannot fit |
| Fail | `OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED` | Committed rider was dropped (model/error) |
| Fail | `OPTIMIZER_CALL_FAILED` | API / auth / validation error |
| Not evaluated | `OPTIMIZER_BUDGET_EXCEEDED` | Too many optimizer calls this run |
| Fail | `ROUTE_LEG_MISMATCH` | Bad response shape |

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
| `newPassengerPickupDelayMin` | Minutes until new pickup (= wait from now) |
| `newPassengerRideDetourMin` | `(dropEta − pickupEta) − soloDuration` (floored at 0) |
| `maximumExistingPassengerDelayMin` | Worst delay vs each committed promise |

### Examples

**Detour % (display / metrics)**

```
Baseline = 5.0 km
New      = 10.6 km
Additional = 5.6 km
Detour % = 112%
```

Note: current hard reject stage uses **km/minutes/delays**, not a fixed 15% detour cap.

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

## Part A — Mid-trip cost / delay (only if driver has remaining stops)

### Check 11.1 — Corridor extension too long (road)

If this was a same-direction extension pool:

| Condition | Default | Fail code |
|-----------|---------|-----------|
| `additionalDistanceKm > maxCorridorExtensionKm` | **15 km** | `CORRIDOR_EXTENSION_TOO_LONG` |

---

### Check 11.2 — Extra duration too high

| Condition | Default | Fail code |
|-----------|---------|-----------|
| `additionalDurationMin > maxAdditionalDurationMin` | **12 min** | `ADDITIONAL_DURATION_TOO_HIGH` |

---

### Check 11.3 — Existing passenger personal budgets

For each committed stop:

```
delay = solvedArrival − originalEtaMin
if delay > that passenger’s budgetMin → FAIL
```

| Fail code | Meaning |
|-----------|---------|
| `EXISTING_PASSENGER_DELAY_TOO_HIGH` | Someone already on the ride is too late |

---

### Check 11.4 — Global existing-delay ceiling

| Condition | Default | Fail code |
|-----------|---------|-----------|
| Worst existing delay > `maxExistingPassengerDelayMin` | **12 min** | `EXISTING_PASSENGER_DELAY_TOO_HIGH` |

---

## Part B — New rider limits (all drivers)

### Check 11.5 — New pickup wait

| Condition | Default | Fail code |
|-----------|---------|-----------|
| Wait > `maxNewPassengerPickupDelayMin` | **10 min** | `NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH` |

---

### Check 11.6 — New rider’s own trip stretched too much

| Condition | Default | Fail code |
|-----------|---------|-----------|
| Ride detour > `maxNewPassengerRideDetourMin` | **12 min** | `NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH` |

---

## Part C — Pooling policy (only if driver already has passengers)

Skipped for pure solo / idle matches.

### Check 11.7 — Vehicle allows pooling

| Fail code |
|-----------|
| `POOLING_NOT_SUPPORTED` |

### Check 11.8 — Request allows pooling

| Fail code |
|-----------|
| `POOLING_NOT_ALLOWED_BY_REQUEST` |

### Check 11.9 — Every existing rider allows pooling

| Fail code |
|-----------|
| `POOLING_NOT_ALLOWED_BY_EXISTING_RIDER` |

### Check 11.10 — Max pooled passengers

| Condition | Default | Fail code |
|-----------|---------|-----------|
| `existingCount + 1 > maxPooledPassengers` | **4** | `MAX_POOLED_PASSENGERS_EXCEEDED` |

---

### Stage 11 summary table

| Order | Applies when | Check | Default | Fail code |
|-------|--------------|--------|---------|-----------|
| 1 | Mid-trip + extension | Extra road km | 15 km | `CORRIDOR_EXTENSION_TOO_LONG` |
| 2 | Mid-trip | Extra duration | 12 min | `ADDITIONAL_DURATION_TOO_HIGH` |
| 3 | Mid-trip | Per-passenger delay budget | personal | `EXISTING_PASSENGER_DELAY_TOO_HIGH` |
| 4 | Mid-trip | Global existing delay | 12 min | `EXISTING_PASSENGER_DELAY_TOO_HIGH` |
| 5 | Always | New pickup wait | 10 min | `NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH` |
| 6 | Always | New ride detour | 12 min | `NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH` |
| 7 | Has riders | Vehicle pooling on | — | `POOLING_NOT_SUPPORTED` |
| 8 | Has riders | Request pooling on | — | `POOLING_NOT_ALLOWED_BY_REQUEST` |
| 9 | Has riders | Existing riders allow share | — | `POOLING_NOT_ALLOWED_BY_EXISTING_RIDER` |
| 10 | Has riders | Pool size | ≤ 4 | `MAX_POOLED_PASSENGERS_EXCEEDED` |

---

# Stage 12 — Scoring

**File:** `scoring.ts`  
**Question:** Among drivers who passed hard limits, who is fairest?

**Does not reject.** Lower score = better.

| Component | Default weight | Raw value | Normalized against |
|-----------|----------------|-----------|--------------------|
| Driver impact | 30% | Extra duration (0 if idle) | `maxAdditionalDurationMin` |
| Existing rider impact | 30% | Worst existing delay | `maxExistingPassengerDelayMin` |
| New rider impact | 25% | New ride detour minutes | `maxNewPassengerRideDetourMin` |
| Pickup wait | 15% | New pickup wait | `maxNewPassengerPickupDelayMin` |

```
finalScore = sum(normalized × weight)
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

# 20. Full story examples

## Example A — Happy pool (2 onboard + 1 new, same corridor)

```
V → Drop A → Drop B   (south)
New pickup near A, new drop a bit after B on same road
```

| Stage | Result |
|-------|--------|
| 0–1 | Pass |
| 2 | Budgets for A,B |
| 3–4 | Pickup on corridor |
| 5 | South bearing ✅, drop extension ✅, drop after pickup ✅ |
| 6 | Several legal orders |
| 7 | At least one order keeps promises |
| 8 | Extension ≤ 15 km straight-line |
| 9 | Optimizer solves |
| 10 | Measures costs |
| 11 | Pass if duration/delays within caps |
| 12–13 | Rank + commit plan |

---

## Example B — Pickup good, drop wrong way

```
Pickup on line ✅
Drop 15 km west ❌
```

| Stage | Result |
|-------|--------|
| 3–4 | May pass |
| **5.1 / 5.2** | Fail bearing and/or off-corridor |

Never reaches Google.

---

## Example C — Same direction but too long

```
Drop 20 km further south on same road
```

| Stage | Result |
|-------|--------|
| 5 | Direction often **passes** (extension) |
| 8 or 11 | May **fail** extension km / duration |

Direction = “compatible path.”  
Hard limits = “is the extra cost acceptable?”

---

## Example D — Idle driver solo trip

```
D01 ONLINE, no ride
Request: India Gate → AIIMS
```

| Stage | Result |
|-------|--------|
| 1 | Pass if vehicle/seats OK |
| 3–4 | Distance from car |
| 5 | Auto-pass direction |
| 6 | Only order: NewP → NewD |
| 8 | Not treated as detour |
| 9–11 | Solo feasibility + wait/ride-detour caps |
| 12 | Driver impact scored as 0 extra |

---

## Example E — BUSY mid-trip driver

```
Driver has ride but status = BUSY
```

Fails Stage 1 (`DRIVER_BUSY`) immediately.  
For pooling tests, keep mid-trip drivers **ONLINE**.

---

## Example F — Capacity trap

```
4-seater, 3 seats already onboard, new rider needs 2 seats
```

May fail Stage 1 conservative check, or Stage 6 segment capacity if peak collides.

---

# 21. “Why did I fail?” cheat sheet

| What you see | Likely stage | What to check |
|--------------|--------------|---------------|
| Request invalid | 0 | Pickup/drop/passenger/seats |
| Offline / paused / busy | 1 | Driver status |
| Wrong vehicle / luggage / wheelchair | 1 | Vehicle vs request |
| Not enough seats | 1 or 6 | Capacity |
| No flexibility | 2 | Delay budgets all zero |
| Outside corridor | 3 | Pickup vs remaining route |
| Pickup too far from route | 4 | Distance to line > 1.5 km |
| Wrong direction | 5.1 | Bearing > 75° |
| Destination off corridor | 5.2 | Drop sideways > 3 km |
| Destination behind | 5.3 | Drop progress < pickup progress |
| No legal sequence / capacity | 6 | Insert orders / seats |
| Committed delay too high | 7 | Promises vs rough ETAs |
| Extension lower bound | 8 | Straight-line added km > 15 |
| Optimizer failed / infeasible | 9 | Google / model / budgets |
| Extra duration / extension / waits | 11 | Hard caps |
| Pooling forbidden | 11 | Policy flags |

---

# 22. Known lab limits

1. **Direction ≠ cost.** A trip can pass Stage 5 and still fail Stage 8/11 on length or time.
2. **Stage 6 finds many insert positions; Stage 9 may choose a different feasible road plan.** Trust Stage 9–11 for final cost.
3. **`detourPercent` is measured** in Stage 10 for display/metrics; **hard reject** currently uses extension km, duration, and delay budgets (not a fixed 15% detour setting).
4. **`BUSY` blocks pooling** — use `ONLINE` for mid-trip poolable drivers.
5. **Optimizer proxy is dev-only** (`bun run dev`). Built static apps cannot call Stage 9.
6. **Scoring ranks drivers**, not multiple sequences per driver (one solver answer per driver).

---

## Where to look in code

| Topic | Path |
|-------|------|
| Stage registry / order | `apps/simulation/src/matching/stages/index.ts` |
| Defaults | `apps/simulation/src/domain/settings.ts` |
| Reason codes | `apps/simulation/src/matching/reasons.ts` |
| Corridor building | `apps/simulation/src/matching/corridor.ts` |
| Insertion enumeration | `apps/simulation/src/matching/insertion/enumerate.ts` |
| Occupancy walk | `apps/simulation/src/matching/occupancy.ts` |
| Geo helpers (bearing, projection) | `apps/simulation/src/lib/geo.ts` |
| High-level design | `docs/Overview.md` |

---

*Generated for the Shareway Ride Matching Lab. When settings or stage logic change, update this guide to match `apps/simulation/src/matching/stages/`.*
