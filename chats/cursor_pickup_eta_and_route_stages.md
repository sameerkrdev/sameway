# Pickup ETA and route stages
_Exported on 8/22/2026 at 19:08:46 GMT+5:30 from Cursor (3.16.17)_

---

**User**

@c:\Users\sameerkrdev\.cursor\projects\d-Coding-projects-shareway\agent-transcripts\bf21b083-8123-47b9-a5c1-7bac4fcb4142\bf21b083-8123-47b9-a5c1-7bac4fcb4142.jsonl 1. how the pickup eta and route stage is working
2. explain each filter and stage

---

**Cursor**

I'll read the pipeline and stage implementations to explain how they work.

Now let me read the remaining stages and the insertion engine.

Now the remaining stages and the settings defaults.

Read the whole pipeline. Here's how it works.

## The short version

The pipeline is nine ordered stages, run by `runMatching` in `engine.ts`. Every driver in the scenario enters stage 0; each stage returns a verdict per surviving driver (`PASSED`, `FAILED`, or `NOT_EVALUATED`), and only the passers move on. A driver that fails somewhere is marked `NOT_EVALUATED` at every later stage rather than failing repeatedly, so each driver has exactly one attributable failure point.

The two stages you asked about are the only ones that spend money on routing calls, and they're ordered deliberately: the cheap ETA gate runs *before* the expensive insertion enumeration.

## Stage 5 — Pickup ETA

The whole stage is a single route-matrix call. It builds an array of origins (one per surviving driver's current location) against one destination (the request pickup), then asks the routing engine for the full matrix in one request:

```30:44:apps/simulation/src/matching/stages/pickupEtaFilter.ts
    const origins: LatLng[] = [];
    const originDriverIds: string[] = [];

    for (const driverId of driverIds) {
      const driver = context.getDriver(driverId);
      if (driver) {
        origins.push(driver.location);
        originDriverIds.push(driverId);
      }
    }

    let elements: MatrixElement[];

    try {
      elements = await computeMatrixInChunks(context, origins, request.pickup);
```

Because Google's RouteMatrix carries up to 625 origin×destination elements per call and there's only one destination, twenty-four candidates cost exactly one billed request. `computeMatrixInChunks` only kicks in past 625 drivers, and when it does it re-bases `originIndex` so results still map back to the right driver.

Results are keyed back to drivers by `originIndex`, and each driver gets three possible outcomes:

- No element, or `reachable: false` → fails with `PICKUP_UNREACHABLE` (no drivable road route exists).
- `durationMin > maxPickupEtaMin` (default 6) → fails with `PICKUP_ETA_TOO_HIGH`.
- `distanceKm > maxPickupRoadDistanceKm` (default 8) → fails with `PICKUP_DISTANCE_TOO_HIGH`.

The order matters: ETA is checked before distance, so a driver who is both too far and too slow is reported as an ETA failure. Both measurements are also written into the driver's metrics ledger via `recordMetrics`, because the next stage and the scoring stage both consume them.

One subtlety worth knowing: these are the *first* road-based numbers in the pipeline. Everything before this point is grid hops and straight-line kilometres, and the `DriverMetrics` doc comment is explicit that only `roadDistanceKm` and `roadEtaMin` may be compared against user-facing thresholds. If the routing budget runs out here, every driver comes back `NOT_EVALUATED` with `ROUTING_BUDGET_EXCEEDED` — deliberately not a rejection, since the pipeline never formed an opinion.

## Stage 6 — Route Feasibility

This is the authoritative test, and it's per-driver rather than bulk. The question is narrow on purpose: *can this rider be inserted into the driver's already-committed route*, not *what is the globally optimal route for everyone*. Existing stops are promises made to real passengers, so their relative order is frozen; only the two new stops move.

Before the driver loop, one shared cached call gets the direct pickup→drop duration, which becomes the reference for measuring the new rider's own detour. Then for each driver, `findBestInsertion` does the following.

**Enumerate.** Place the new pickup at every slot `i` and the new drop at every slot `j >= i`. Since both are spliced into an otherwise untouched copy, existing order and pickup-before-drop hold by construction — there is nothing to validate and nothing to discard. Exactly `(n+1)(n+2)/2` candidates for `n` existing stops.

**Waypoint gate.** Every candidate has the same waypoint count, so if `existingStops.length + 1` exceeds the provider's 25-intermediate-waypoint limit, the whole driver is rejected at route level with `WAYPOINT_LIMIT_EXCEEDED`.

**Occupancy prune (free).** Walk each candidate's stop sequence, adding seats at pickups and subtracting at drops, seeded with `onboardSeats` — the seats of passengers already physically in the car who have no pickup stop left in the route. Without that seed a walk starting at zero would under-count every segment and wrongly pass a full vehicle. Any candidate that ever exceeds `totalSeats` is dropped. This is why capacity here is *not* `totalSeats - passengerCount`: occupancy rises and falls along the route, so whether the rider fits depends on *where* their pickup and drop land.

**Geographic prune (free).** If more candidates survive than `maxRoutedInsertionsPerDriver` (default 6), score each by straight-line added length over the baseline and keep the cheapest few. This is what bounds billed route calls per driver regardless of how many stops the driver already has.

**Route and evaluate.** One baseline route call for the driver's existing sequence, then one route call per shortlisted candidate. From the per-leg durations, `buildArrivalTimeline` produces a cumulative arrival time per stop. If the provider returns a leg count that doesn't match the stop count — coincident stops can cause this — the timeline returns `null` and the driver fails with `ROUTE_LEG_MISMATCH` rather than mis-attributing durations to the wrong passenger.

Each candidate then gets five measurements, checked against thresholds in a fixed order so the reported rejection is deterministic:

| Check | Setting | Default | Reason code |
|---|---|---|---|
| Detour % (added km ÷ baseline km) | `maxDetourPercent` | 15 | `ROUTE_DETOUR_TOO_HIGH` |
| Added distance | `maxAdditionalDistanceKm` | 5 km | `ADDITIONAL_DISTANCE_TOO_HIGH` |
| Added duration | `maxAdditionalDurationMin` | 12 min | `ADDITIONAL_DURATION_TOO_HIGH` |
| New rider's extra wait vs. a dedicated pickup | `maxNewPassengerPickupDelayMin` | 6 min | `NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH` |
| Worst existing passenger's added arrival delay | `maxExistingPassengerDelayMin` | 8 min | `EXISTING_PASSENGER_DELAY_TOO_HIGH` |

The first three and the last only apply when the driver actually has a committed route — with no existing stops there is nothing to detour from, the driver is dedicated to this rider, and pooling constraints simply don't apply (detour is reported as 0).

That last row is the reason this stage exists at all rather than trusting aggregate detour. As the comment in `delays.ts` puts it, a route can be only 8% longer overall while pushing one rider fifteen minutes late — so `computeExistingPassengerDelays` diffs each existing passenger's *drop* arrival before and after insertion and takes the maximum. Pickup-side delays are computed too but not thresholded by default.

Among the candidates that pass everything, the winner is the one with the lowest detour percentage. If nothing passes, the least-bad attempt is still returned with `feasible: false`, so the map can draw what was tried and the UI can name exactly which threshold broke.

## The other seven stages

**Stage 0, Request Validation.** Judges the request alone, before any driver is considered — finite pickup and drop coordinates, pickup ≠ drop, whole positive `seatsRequired`, a passenger that exists in the scenario, a vehicle preference some vehicle actually satisfies, and non-negative wait/detour thresholds. A failure aborts the entire run, because it would be misleading to report forty rejected drivers for a request that was never answerable.

**Stage 1, H3 Candidate Generation.** Expands H3 rings outward from the pickup cell (resolution 9, up to `maxH3Ring` 3) and stops once it has accumulated `minimumUsableCandidates` (10) *usable* drivers. "Usable" is the key word: the counter only increments for drivers who are online, have a known vehicle, match the vehicle preference, and have enough total seats. Ten offline drivers in ring 0 must not end the search while a usable driver waits in ring 1. Drivers failing those predicates are still returned as candidates so the later stages can reject them with a precise reason instead of them silently vanishing here. This stage discovers rather than filters, so `engine.ts` fails any live driver absent from the returned candidate set with `H3_OUTSIDE_SEARCH`. The ring index it records is a unitless hop count — never compared against a distance or ETA threshold anywhere.

**Stage 2, Driver Status.** Only `ONLINE` continues; `OFFLINE`, `PAUSED`, and `BUSY` each get their own distinct reason code so the rejection dashboard can tell "no supply" from "supply that opted out".

**Stage 3, Vehicle Compatibility.** Physical capability only: vehicle type against the request's preference, wheelchair accessibility, and luggage against capacity. Pooling capability is deliberately excluded and deferred to stage 7, so "this vehicle physically cannot serve you" and "policy forbids this pool" stay separately countable.

**Stage 4, Capacity Pre-filter.** A cheap, conservative seat check: does the vehicle *ever* have room, using the peak occupancy of its committed route? It's explicitly not authoritative — a driver who peaks at capacity midway may still carry the rider on an earlier or later stretch, which stage 6's segment walk decides. This stage exists purely to reject hopeless cases before anything is routed.

**Stage 7, Pooling Rules.** Business policy, costing nothing. Everything reaching here is already known to be technically feasible; the only question is whether it's *permitted*. A solo ride short-circuits to pass, since a vehicle with pooling switched off is still perfectly able to carry one passenger. When sharing is genuinely involved, it checks vehicle pooling enabled, the new request's willingness to pool, whether any *existing* rider declined to share, and the total against `maxPooledPassengers` (4).

**Stage 8, Scoring.** Rejects nothing. Five components — pickup ETA, pickup distance, detour, existing-rider impact, and driver fairness — are each normalised to 0–100 against their own configured threshold, then weighted with weights rescaled to sum to 1. That keeps the final score on the same 0–100 scale as its parts and makes each contribution a real displayable number rather than an artefact of unit choice. Defaults are 30/20/30/20/0; fairness is a placeholder flagged `experimental` with weight zero, so it stays out of results entirely. Ties in the final ranking break on driver id so repeated runs are stable.

## Two things about ordering and cost

The stage sequence is data, not code (`settings.stageOrder`). `DEFAULT_STAGE_ORDER` puts pickup ETA at position 5 and route feasibility at 6; `BRIEF_STAGE_ORDER` keeps the original brief's reversed pairing selectable so you can measure the cost difference. The default is the single largest saving in the pipeline — a driver forty minutes away should never trigger insertion enumeration.

Total routing calls for a run are roughly `1` (ETA matrix) `+ 1` (direct pickup→drop) `+ D × (1 + up to 6)` where `D` is the drivers surviving to stage 6, all capped by `maxRoutingCallsPerRun` (150). When that cap trips mid-stage, `routeFeasibility` latches `budgetExhausted` and hands every remaining driver `NOT_EVALUATED` — because, as the code comment says, calling it "route infeasible" there would be a lie.

