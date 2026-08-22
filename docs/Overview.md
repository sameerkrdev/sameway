# Sameway — Platform Overview

## The Core Idea

**Sameway** is a dynamic shared-ride / carpooling platform. Instead of matching 1 passenger → 1 vehicle and leaving seats empty, it dynamically inserts multiple passengers with _compatible routes_ into the same vehicle in real time. Lower fares for riders, higher earnings for drivers, better utilization for the platform. The product philosophy is deliberately not "Uber but cheaper" — it's a marketplace that makes explicit trade-offs about whose delay gets protected and whose gets flexed, in order to make pooling economics work.

## Tech Stack

| Layer           | Choice                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| Frontend        | Expo / React Native                                                         |
| Monorepo        | TurboRepo                                                                   |
| Backend         | Node.js / TypeScript                                                        |
| ORM             | Prisma                                                                      |
| Primary DB      | PostgreSQL                                                                  |
| Geospatial DB   | PostGIS                                                                     |
| Real-time state | Redis                                                                       |
| Real-time comms | WebSockets / Socket.IO                                                      |
| Spatial index   | **H3** (over Geohash, Google S2)                                            |
| Routing         | **Dual-method** — in-house insertion search + Google Route Optimization API |

## The Three-Layer Mental Model

```
Layer 1 — CANDIDATE GENERATION (cheap, approximate)
   H3 + Redis → "which rides could plausibly work?"

Layer 2 — INSERTION & ROUTING (expensive, exact)
   Stop-sequence generation + routing engine → "what would actually happen?"

Layer 3 — DECISION (cheap, deterministic)
   Hard constraints + scoring → "which one do we commit to?"
```

H3 never decides a match — it only shrinks the search space. Routing gives ground truth. Scoring makes the final call. This separation is the single most load-bearing architectural decision in the whole design.

## Why H3

Evaluated Geohash, Google S2, H3 — H3 won:

- Hexagonal cells → six equidistant neighbors → uniform `gridDisk`/k-ring expansion (Geohash's rectangular cells cause boundary-mismatch problems)
- `h3-js` has mature TypeScript bindings fitting the stack (S2 more powerful, but heavier ops burden + weaker JS ecosystem)
- Hierarchical resolution — different levels for city-wide demand analytics vs. driver discovery vs. precise pickup matching

**Still open:** exact resolution per use case, unbenchmarked (Redis set proliferation vs. candidate over-fetching) — Phase 3 work.

## Key Insight: Match Against the Route, Not the Driver's Location

Don't ask "is this driver near the new passenger?" Ask "does this **ride's remaining route** pass near the pickup?" A driver 8km away can be an excellent match if their route corridor passes right by the pickup. H3 indexing is therefore keyed off route segments (`h3_cell → [ride_ids]` built from the remaining-route corridor), not driver GPS position.

## The Matching Pipeline

```
0.  Basic eligibility        — capacity, online status, service area (free)
1.  Operational-state filter — is a pickup already committed?
2.  H3 route-corridor filter — cheap geographic funnel
3.  Pickup → route distance  — geometric proximity
4.  Direction/destination compatibility — bearing, route position
5.  Generate legal stop sequences — precedence + capacity constrained
6.  Flexible pickup time-window filter — protect committed pickups
7.  Cheap geometry/detour lower-bound filter — prune before routing
8.  Actual road routing      — Method A or Method B (see below)
9.  Incremental cost         — Δtime/Δdistance per driver & passenger
10. Hard constraints         — binary accept/reject
11. Scoring                  — our weighted formula, argmin(score)
12. Commit                   — update ActiveRide, becomes new baseline
```

Key refinements baked into this pipeline:

- **Flexible, not strict, commitment**: a passenger being picked up isn't frozen — insertion before them is allowed if delay stays within their `max_pickup_delay`. Rejects the _ordering_, not the driver.
- **Rolling-horizon optimizer**: the route is a living object; each event re-optimizes only the remaining route, not the whole trip.

## Routing Layer — Current Implementation

### Stage 8: Google Route Optimization API (`OptimizeTours`)

For the current implementation, all routing at Stage 8 goes through Google's `OptimizeTours` API, regardless of spine size. This is the pragmatic starting point — a single well-understood integration that handles all cases correctly before we optimize for cost and latency.

**How we use it:** Each match attempt sends a `ShipmentModel` to `POST https://routeoptimization.googleapis.com/v1/projects/{PROJECT}:optimizeTours` with:

- **Each passenger = one `Shipment`** with a `pickups[]` entry (pickup location + time window) and a `deliveries[]` entry (drop location). Pickup-before-drop precedence is implicit in the shipment structure — no separate constraint needed.
- **The vehicle = one `Vehicle`**, with `startLocation` set to the driver's _current GPS position_, not the original trip origin — so the solver only plans the remaining route.
- **Capacity** enforced via `loadDemands` on shipments and `loadLimits` on the vehicle, checked at every point along the route.
- **Time windows** on each `VisitRequest` encode our `max_pickup_delay` constraints. Committed passengers get hard `endTime` windows (`original_ETA + max_delay`); the new passenger can optionally get a soft window (`softEndTime` + `costPerHourAfterSoftEndTime`) to avoid brittle infeasibility.
- **`injectedSolutionConstraint`** to freeze the already-committed stop sequence as a locked spine — tells the solver "the first N visits are fixed, only find where to insert the new stops." This cuts solve time significantly by shrinking the search space.
- **`timeout`** set to stay within the ~100–500ms matching budget.

**What comes back:**

- A `ShipmentRoute` with leg-level distances and times for the winning sequence → feeds directly into Stage 9.
- `skippedShipments[]` when insertion is infeasible under the given constraints — a clean signal that requires no further processing.

**The fixed rule that doesn't change:** Stages 9–11 (incremental cost, hard constraints, weighted scoring) always run in-house on top of what Google returns. Google's internal objective minimises vehicle-side cost; our objective is a fairness-weighted formula across driver + all passengers. These are different functions. We buy the road-network math; we keep the fairness policy.

```
All spine sizes (current) → Google OptimizeTours
                                    │
                          Stages 9–11 (always ours)
```

**Why Google's result alone isn't enough:** Google will hand back its vehicle-cost-optimal winner. In the Stage 11 scoring example:

```
Route 1: Driver +7/+3.0km  A +4  B +3  C +5   → fairness score 4.9
Route 2: Driver +5/+2.0km  A +1  B +5  C +4   → fairness score 3.6  ← our winner
Route 3: Driver +4/+1.5km  A +2  B +2  C +8   → fairness score 3.8  ← Google's winner
```

Route 3 is cheapest for the vehicle but hurts passenger C badly. Google surfaces it; our Stage 11 overrides it. This is why Stages 9–11 are non-negotiable regardless of the routing method used.

---

## Routing Layer — Future Optimization (Phase 3+)

The current single-method approach is correct and correct is more important than optimal at this stage. However, the Google API has a real cost and latency profile that will matter at scale:

- Every match attempt = one `OptimizeTours` call, billed per shipment.
- With many candidate rides per new passenger request, this multiplies quickly.
- A single API round-trip adds 100–800ms of network latency before Stages 9–11 even run.

**The key insight that changes the math:** For a spine of size 1 (one existing passenger, inserting a 2nd — the dominant real-world case), the number of possible insertion positions is just 3: `[C_P, C_D, A_D]`, `[C_P, A_D, C_D]`, `[A_D, C_P, C_D]`. The new edges introduced are at most 4. An in-house insertion search could enumerate all 3 valid sequences and call a routing API for only the new edges — reusing the already-computed `driver → A_pickup` and `A_pickup → A_drop` legs from cache. But — critically — this reuses cached leg data from prior routing calls, not new API calls. If those legs are already in Redis, the marginal cost of Method A at spine=1 can be near-zero for the reused edges.

**The planned hybrid routing strategy:**

```
Spine = 1 (dominant case, ~80–90% of matches)
  → In-house insertion search
  → Only new edges need routing calls (2–4 calls, or fewer with cache hits)
  → All valid insertion candidates passed to Stage 11 (full fairness scoring)
  → Best fairness outcome, lowest API cost

Spine ≥ 2 (higher occupancy tail)
  → Google OptimizeTours with injectedSolutionConstraint
  → One API call covers all legs including new ones
  → Stage 11 re-scores on top of Google's result
  → Clean infeasibility signal via skippedShipments[]
```

**Why spine=1 is the right threshold for the switch (not spine=2 or spine=3):**

The original design proposed switching at spine≥3. This was revised for two reasons. First, Method A also needs routing calls for new edges — it's not free — so the cost advantage over Google only exists if cached leg data is available. Second, Method A's real unique advantage isn't cost: it's that it returns _all valid insertion candidates_ to Stage 11, not just Google's one vehicle-cost-optimal winner. That advantage is most meaningful when fairness-weighted scoring across candidates can materially change the outcome — which is most impactful at spine=1 where the match is genuinely new territory. At spine≥2, the candidates are more constrained by the existing spine, and Google's single result (with our Stage 11 override) is adequate.

**The leg caching layer (prerequisite for the hybrid):**

```
Redis key: leg:{h3_origin}:{h3_dest}:{time_of_day_bucket}
Value:     { distance_km, duration_min, computed_at }
TTL:       5–10 min (traffic-sensitive)
```

When 10 candidate rides are being evaluated for a new passenger and many share overlapping route segments, cached legs mean those segments don't each pay a routing API call. This is the lever that makes in-house insertion genuinely cheaper at spine=1, and it benefits Method B too (cached legs can validate or sanity-check Google's returned leg times).

**When to build this:** After v1 launch, once real traffic data shows the distribution of spine sizes at match time and the actual Google API spend per day. The hybrid routing layer should be built as a drop-in replacement for Stage 8 — the interface contract (leg-level distances/times → Stage 9) stays identical regardless of which method produced the data.

---

## Known Open Problems

- H3 resolution selection (Phase 3 benchmarking)
- Google API cost modeling at real volume — per-shipment pricing × candidates-per-request × matches-per-day
- Real-world latency benchmarking of `OptimizeTours` against the ~100–500ms matching budget under load
- Redis corridor-maintenance write amplification as routes change frequently
- Leg caching design (key schema, TTL policy, cache invalidation on traffic changes) — prerequisite for future hybrid routing
- Concurrency at commit time — atomic seat reservation still unsolved, matching pipeline doesn't yet interface with it
- Scoring weights (30/30/25/15) hand-picked, not calibrated against real outcomes
- Re-optimization throttling/debouncing to avoid route "thrashing"
- Pricing formula, surge model, driver incentives — still conceptual
- Vendor dependency risk on Google for a product-differentiating layer (precedent: Google's prior "Cloud Fleet Routing" was discontinued and replaced under Google's own timeline, not the adopter's) — the hybrid routing path is also the long-term vendor-risk mitigation

# Sameway Matching Pipeline — Stage-by-Stage Deep Dive

## Stage 0 — Basic Eligibility

**What it checks:** The cheapest possible filters — pure boolean/lookup checks with zero geospatial or routing cost.

```
vehicle.status == ACTIVE
driver.status == ONLINE
ride.status == ACCEPTING_PASSENGERS
availableSeats >= requestedSeats
vehicleType compatible
sharedRideEnabled == true
```

**Why it exists:** No point computing H3 cells or route corridors for a vehicle that's mathematically incapable of taking the passenger. This stage exists purely to reject cheaply before anything geographic happens.

**Example:** A 3-seat auto already carrying 2 passengers gets a request for 2 more seats. `available = 1`, `requested = 2` → reject instantly. No H3 lookup, no routing call, nothing.

**On failure:** Hard reject, no further processing. This single stage typically eliminates a large fraction of candidates for free — it's the highest ROI filter in the whole pipeline because it costs almost nothing and prunes aggressively.

---

## Stage 1 — Operational-State Filter

**What it checks:** Not "is this driver available" but "what is this **ride** currently doing" — is there a passenger already mid-pickup, and if so, is that pickup still flexible?

**Why it exists:** A driver isn't a single static resource — it's a live ride state. The same auto can have one passenger onboard (A) and another already promised a pickup (B, `EN_ROUTE_TO_PICKUP`). Treating the driver as "available/unavailable" loses this nuance entirely.

**How it works:** For every already-promised-but-not-yet-picked-up passenger, this stage doesn't freeze them outright. It computes a delay budget:

```
B original pickup ETA = 4 min
B max acceptable pickup ETA = 8 min
```

Any candidate stop sequence that inserts the new passenger _before_ B's pickup is allowed to proceed to later stages **only if** it keeps B's new ETA within that window. This isn't a single pass/fail here — it tags which sequences are even legal to generate in Stage 5, and gets re-checked precisely in Stage 6.

**Example:** Driver D1, A onboard, B waiting (originally promised pickup in 4 min). New request C arrives. The system doesn't say "D1 is busy, skip it." It says "D1 is a candidate, but any sequence placing C's pickup before B's must keep B's delay ≤ B's max."

**On failure:** Doesn't reject the _driver_ — only disqualifies specific orderings later. This is the "flexible mode" decision: strict freezing would silently throw away perfectly good matches.

---

## Stage 2 — H3 Route-Corridor Filter

**What it checks:** Does the new passenger's pickup fall near the **ride's remaining route**, not near the driver's current GPS point.

**Why it exists:** This is the single biggest correction made across the project's iterations. Driver-to-pickup distance is a bad proxy the moment a vehicle has an existing route — a driver can be 8km away in raw distance but have a route that passes directly by the new pickup.

**How it works:**

1. Take the ride's _remaining_ route (not the historical/completed part).
2. Convert route segments into H3 cells.
3. Expand each cell by one ring (`gridDisk(cell, 1)`) to build a "corridor" — this compensates for the pickup being slightly off the literal road polyline.
4. Convert the new pickup coordinate to its own H3 cell.
5. Check for intersection between the pickup cell and the corridor cell set.

```
remaining route:  H1 → H2 → H3 → H4 → H5
corridor:         {H1,H2,H3} {H2,H3,H4} {H3,H4,H5} ...
new pickup → H3-cell = H3   → intersects corridor → candidate
```

In Redis, this is implemented as `h3_cell → [ride_ids]`, populated from route segments (not driver position), so the lookup is a small number of set reads.

**Example:** Driver is currently in Ghaziabad. Existing passenger A's route goes Ghaziabad → Knowledge Park → Delta 1. New passenger B's pickup is at Alpha 1, geographically 8-9 km from the driver's _current_ location — but Alpha 1 sits directly on the route corridor between Knowledge Park and Delta 1. A naive driver-distance filter would wrongly reject this; the corridor filter correctly accepts it.

**On failure:** Reject — cheaply, before any distance math or routing cost is spent. This funnels potentially thousands of active rides down to a few hundred candidates via near-O(1) Redis lookups.

**Important caveat baked in from the start:** must index the _remaining_ route only. If a driver has already passed a point, that historical proximity should never make a ride look compatible (this was explicitly called out as a failure mode — Example 11 in the case studies: pickup was directly on the historical route but _behind_ the vehicle, so it was correctly rejected).

---

## Stage 3 — Pickup → Route Distance

**What it checks:** A more precise geometric distance than the coarse H3 cell match — the actual minimum distance from the pickup point to the route polyline.

**Why it exists:** H3 corridor intersection is approximate (cell-level granularity). This stage tightens the filter with real point-to-line geometry before anything expensive happens.

**How it works:**

```
distance_to_route = min distance(
    pickup_point,
    every segment of remaining route
)
```

**Example:** Pickup is 350m from the nearest point on the route → passes. Another candidate ride has a pickup 3.8km from its route → rejected.

**Critical caveat:** This is still just a **cheap approximation**, not the real driver detour. A pickup 500m from the route might actually require the vehicle to travel 500m off-route and 500m back — a 1km detour, not a 500m one. That real cost only gets computed in Stage 8/9. This stage exists purely to prune obviously-too-far candidates before paying for routing.

**On failure:** Reject before routing.

---

## Stage 4 — Direction / Destination Compatibility

**What it checks:** Even if the pickup is geometrically close to the route, does the passenger's _overall trip_ actually travel in a compatible direction — or does the pickup just happen to be near the route while the destination pulls the vehicle somewhere completely different?

**Why it exists:** Pickup proximity alone is insufficient. A pickup can be perfectly positioned on the corridor while the destination requires a large detour off it — this stage catches that case before wasting a routing call.

**How it works — three cheap sub-signals:**

1. **Bearing difference** — compare the existing route's direction against the new passenger's pickup→destination direction.

```
Existing: KP2 → Delta 1, bearing = 82°
New:      Alpha1 → Delta2, bearing = 77°
difference = 5° → good
```

```
Existing: bearing = 80°
New:      Alpha1 → Pari Chowk, bearing = 250°
difference = 170° → very likely incompatible
```

1. **Destination-to-route distance** — is the destination itself near the route corridor, or far off it?
2. **Destination's position along route progress** — is the destination _ahead_ of the vehicle's current progress, or _behind_ it? A destination behind the current position is a strong reject signal even if it's geometrically close to the historical route.

**Example:** Pickup at Alpha 1 is 400m from the route (passes Stage 3) but destination is Pari Chowk — off in a different direction. Direction/destination filter catches this and rejects it _before_ the expensive insertion-and-routing stages, even though the pickup alone looked promising.

**On failure:** Reject or heavily penalize. Still a cheap, geometric signal — not the final word (roads aren't straight lines, so a moderate bearing difference doesn't always mean reject — it just lowers priority or triggers rejection if severe).

---

## Stage 5 — Generate Legal Stop Sequences

**What it checks/produces:** Given a ride's existing committed stops plus the new passenger's pickup and drop, what are the _valid_ orderings to consider?

**Why it exists:** This is where the actual insertion decision starts. Naively, if there are `k` existing stops plus the new passenger's 2 stops, you could generate `(k+2)!` permutations — but the vast majority are illegal or nonsensical.

**Constraints applied:**

- **Precedence:** every passenger's pickup must occur before their drop (`pickup_i < drop_i`).
- **Capacity-at-every-point:** occupancy can never exceed vehicle capacity at any point along the candidate sequence, not just at the end.
- **Committed-stop-position pruning:** stops already locked in from Stage 1 don't get reshuffled relative to each other.

**The key efficiency fix (spine + insertion, not full permutation):** Earlier iterations of this design generated all precedence-valid permutations of _every_ remaining stop, including reshuffling already-locked stops relative to each other — for a 5-stop remainder that's 30 sequences. The corrected approach treats already-computed/already-promised stops as a **locked spine** and only searches for where to insert the _new_ passenger's pickup and drop into the gaps:

```
locked spine: [B_P, A_D, B_D]
gaps:         [gap0] B_P [gap1] A_D [gap2] B_D [gap3]
```

Number of valid `(pickup, drop)` insertion position pairs = `(k+1)(k+2)/2` where `k` = spine length. For `k=3` that's 10 candidates instead of 30 — and it scales polynomially (`O(k²)`) instead of factorially as more passengers board.
This enumeration is also what gets passed to Google's `OptimizeTours` as the constraint space — the `injectedSolutionConstraint` encodes the locked spine, so Google only searches insertion positions for the new stops, not re-permutations of the whole route.

**On failure:** Sequences violating precedence or capacity are never generated in the first place — this is enumeration with built-in pruning, not generate-then-filter.

---

## Stage 6 — Flexible Pickup Time-Window Filter

**What it checks:** For each candidate sequence, does inserting the new passenger _before_ an already-committed pickup push that passenger's delay past their allowed maximum?

**Why it exists:** This operationalizes Stage 1's flexible-commitment policy at the sequence level. It rejects specific _orderings_, not the ride as a whole.

**How it works:**

```
B_new_pickup_delay = B_new_pickup_ETA - B_original_pickup_ETA

IF B_new_pickup_delay <= B_max_pickup_delay:
    sequence allowed to proceed
ELSE:
    reject this specific sequence
```

**Example:**

- Without C: B's pickup ETA = 4 min.
- Sequence puts C's pickup before B's: B's new ETA = 7 min → delay = 3 min. If `B_max_pickup_delay = 5 min`, 3 ≤ 5 → **pass**.
- A different sequence pushes B's ETA to 11 min → delay = 7 min → 7 > 5 → **reject this specific ordering**, but other orderings (e.g., B picked up first) remain valid candidates.

This same time-window logic also protects already-onboard passengers against excessive _drop_ delay, not just waiting passengers against pickup delay.
This same time-window logic also protects already-onboard passengers against excessive _drop_ delay, not just waiting passengers against pickup delay. In the current implementation, these constraints are also encoded as hard `timeWindows` on the Google `OptimizeTours` request — so the solver itself won't produce sequences that violate them. Stage 6 acts as the pre-filter that prunes sequences before they're even sent to Google, reducing the solver's search space and thus its latency.

**On failure:** That specific sequence is dropped from consideration — the ride itself stays in the running via other sequences.

---

## Stage 7 — Cheap Geometry / Detour Lower-Bound Filter

**What it checks:** Before calling the (expensive) routing engine, is this candidate sequence _provably_ too expensive using only straight-line geometry?

**Why it exists:** Road distance can never be shorter than straight-line distance — so straight-line distance is a valid **lower bound**. If even the optimistic lower bound already violates a hard limit, there's no reason to spend a routing API call finding that out the expensive way. This is the same principle as an admissible heuristic in A* search.

**How it works:**

```
minimum possible additional distance (straight-line) = 4.5 km
MAX_DRIVER_EXTRA_DISTANCE = 3 km

4.5 > 3 → reject immediately, no routing call
```

**On failure:** Prune before Stage 8. This is a pure cost-optimization stage — it changes nothing about correctness, only about how many routing calls get made.
Every candidate pruned here is one fewer shipment in the `OptimizeTours` request (or one fewer API call in the future hybrid).

---

## Stage 8 — Actual Road Routing

**What it checks:** What does the real road network say the sequence actually costs — leg by leg?

**Why it exists:** Everything before this point has been approximation. Geometric proximity can be misleading (a river, a highway, one-way streets can turn a "300m as the crow flies" pickup into a 2.5km road detour). This is where ground truth enters the pipeline.

**How it works:** Only the small number of survivors from Stage 7 reach here. The routing engine returns **leg-level** data, not just a trip total, because individual passenger ETAs depend on when each leg completes:

```
Current → B_P:  1.4 km / 4 min
B_P → C_P:      1.0 km / 3 min
C_P → A_D:      3.5 km / 8 min
A_D → B_D:      2.5 km / 5 min
B_D → C_D:      3.0 km / 6 min
```

**Two methods available at this stage** (per Sameway's dual-method design):

- **Method A — in-house insertion search:** Since only new edges around the inserted stops actually changed, only _those_ edges need fresh routing calls — the rest of the spine's leg costs are reused from prior routing passes. Cheapest, fastest, best for small spines (1–2 existing passengers).
- **Method B — Google `OptimizeTours`:** Sends the full shipment set (existing committed stops + new pickup/drop) with time windows and capacity as constraints; the solver searches internally and returns one feasible sequence with real leg times, or an infeasibility signal. Better for larger spines (3+ passengers) where in-house search combinatorics start to strain.

Regardless of method, the output feeding Stage 9 is the same shape: real leg-level distances/times for the chosen sequence.

#### Current Implementation — Google `OptimizeTours`

The `OptimizeTours` request sent at this stage has already been shaped by Stages 5–7:

json

```json
{
  "timeout": "400ms",
  "model": {
    "globalStartTime": "<now>",
    "globalEndTime": "<now + 2hr>",
    "vehicles": [
      {
        "startWaypoint": { "location": { "latLng": "<driver_current_position>" } },
        "loadLimits": { "seats": { "maxLoad": 3 } }
      }
    ],
    "shipments": [
      {
        "pickups": [{ "arrivalWaypoint": "<A_pickup>", "duration": "30s" }],
        "deliveries": [
          {
            "arrivalWaypoint": "<A_drop>",
            "timeWindows": [{ "endTime": "<A_original_drop + max_delay>" }]
          }
        ],
        "loadDemands": { "seats": { "amount": 1 } },
        "penaltyCost": null
      },
      {
        "pickups": [
          {
            "arrivalWaypoint": "<C_pickup>",
            "timeWindows": [{ "softEndTime": "<now + 8min>", "costPerHourAfterSoftEndTime": 50 }]
          }
        ],
        "deliveries": [{ "arrivalWaypoint": "<C_drop>" }],
        "loadDemands": { "seats": { "amount": 1 } },
        "penaltyCost": 100
      }
    ]
  },
  "injectedSolutionConstraint": {
    "routes": [{ "visits": ["<locked_spine_visits>"] }],
    "constraintRelaxations": [
      {
        "relaxations": [
          { "level": "RELAX_ALL_AFTER_THRESHOLD", "thresholdVisitCount": "<spine_length>" }
        ]
      }
    ]
  }
}
```

Key points in the request structure:

- Existing committed passengers have `penaltyCost: null` (mandatory — solver cannot skip them).
- The new passenger has a finite `penaltyCost` — appears in `skippedShipments[]` if infeasible rather than making the whole request fail.
- `injectedSolutionConstraint` freezes the locked spine; `RELAX_ALL_AFTER_THRESHOLD` tells the solver it can only insert new stops after the frozen visits.
- The `timeout` is set to fit within the matching budget.

**What comes back:** Leg-level data for the winning sequence:

```
Current → A_P:  1.4 km / 4 min
A_P → C_P:      1.0 km / 3 min
C_P → A_D:      3.5 km / 8 min
A_D → C_D:      3.0 km / 6 min
```

This feeds directly into Stage 9 as-is.

**Infeasibility:** If the new passenger can't be inserted under the given constraints, they appear in `skippedShipments[]`. The ride is not rejected — it simply has no valid insertion for this passenger.

### Future Implementation — Hybrid Routing (Phase 3+)

When real traffic data confirms the economics, Stage 8 will switch to a hybrid:

```
Spine = 1  →  In-house insertion search
               Enumerate 3 insertion positions
               Routing calls only for new edges (2–4 calls, cache-first)
               All valid sequences → Stage 11 (full fairness scoring across candidates)

Spine ≥ 2  →  Google OptimizeTours (as current)
               Stage 11 re-scores on the single returned result
```

The interface contract between Stage 8 and Stage 9 stays identical regardless of which path ran — leg-level distances and times for the chosen sequence. The switch is purely internal to Stage 8.

**Why spine=1 specifically for in-house:** At spine=1, there are only 3 possible insertion positions. Enumerating all of them and passing all valid ones to Stage 11 gives a materially better fairness outcome than accepting Google's single vehicle-cost-optimal result. At spine≥2, the constraint space is tighter, Google's result is more likely to align with our winner anyway, and the API call bundles all legs in one round-trip more efficiently than multiple in-house routing calls would.

**On failure:** If routing itself reports infeasibility (Method B) or the returned cost is clearly bad, that sequence is dropped.

---

## Stage 9 — Incremental Cost Calculation

**What it checks:** How much does _everyone_ — driver, every existing passenger, the new passenger — actually gain or lose compared to their baseline, using the real leg data from Stage 8.

**Why it exists:** This is the heart of fairness accounting. A route can look efficient in total distance while badly hurting one specific passenger — this stage exposes that per-person.

**How it works:** For each party, compare pre-insertion baseline against post-insertion outcome:

```
Driver:  Δdistance = new_route_distance - original_route_distance
         Δtime     = new_route_time - original_route_time

Existing passenger A:  ΔA_time = new_A_drop_ETA - original_A_drop_ETA

Waiting passenger B:   pickup_delay = new_B_pickup_ETA - original_B_pickup_ETA
                       drop_delay   = new_B_drop_ETA - original_B_drop_ETA

New passenger C:       extra_time = shared_route_time - C_solo_route_time
```

**Example output:**

```
Driver: +5 min / +2 km
A:      +4 min
B:      +2 min pickup delay / +3 min total delay
C:      +4 min
```

**On failure:** Nothing rejected here yet — this stage only _measures_. Stage 10 does the accept/reject.

---

## Stage 10 — Hard Constraints

**What it checks:** Given the measured deltas from Stage 9, does _every_ affected party stay within product-defined maximums?

**Why it exists:** A route is only acceptable if **everyone** affected — not just the driver, not just the new passenger — remains within their limits. This is a deliberate product principle: efficiency for one party never justifies excessive harm to another.

**How it works:** Simple binary check against configured thresholds:

```
MAX_DRIVER_EXTRA_TIME = 10 min
MAX_DRIVER_EXTRA_DISTANCE = 3 km
MAX_EXISTING_PASSENGER_EXTRA_TIME = 10 min
MAX_B_PICKUP_DELAY = 5 min
MAX_NEW_PASSENGER_EXTRA_TIME = 10 min
```

**Example — pass:**

```
Driver +5min ✅  Driver +2km ✅  A +4min ✅  B pickup +2min ✅  B total +3min ✅  C +4min ✅
→ VALID
```

**Example — fail even though most metrics look good:**

```
Driver +7min ✅  A +12min ❌  B +3min ✅  C +4min ✅
→ REJECT (A alone breaches the limit — the rest being fine doesn't matter)
```

Even when Method B (Google) is used and time windows were already enforced inside the solver, this stage is kept as a belt-and-suspenders check — the API optimizes shipment time windows, but not necessarily the driver's own extra-distance cap, so it's re-verified independently here.

**On failure:** Hard reject — this candidate sequence never reaches scoring.

---

## Stage 11 — Scoring

**What it checks:** Among all sequences that survived Stage 10 (i.e., are all individually _valid_), which one is _best_?

**Why it exists:** Validity isn't the same as optimality. Multiple sequences can pass every hard constraint while differing substantially in how fairly they distribute the cost.

**How it works:** A weighted formula combining everyone's impact:

```
score = 0.30 × driver_impact
      + 0.30 × existing_passenger_impact
      + 0.25 × new_passenger_impact
      + 0.15 × pickup_delay
```

Lower score = better. Example across three valid candidates:

```
Route 1: Driver +7/+3.0km  A +4  B +3  C +5   → score 4.9
Route 2: Driver +5/+2.0km  A +1  B +5  C +4   → score 3.6  ← winner
Route 3: Driver +4/+1.5km  A +2  B +2  C +8   → score 3.8
```

Note Route 3 has the _cheapest driver cost_ but loses under this scoring because C suffers heavily — this is exactly why scoring stays in-house rather than trusting a vendor solver's default vehicle-cost objective. If Method B were asked to pick the sequence itself, it would likely surface Route 3 (cheapest for the vehicle), which is why Stage 11 always re-scores on top of whichever method produced the candidates, rather than accepting the routing engine's own choice as final.

**On failure:** N/A — this stage doesn't reject, it ranks. `argmin(score)` wins.

---

## Stage 12 — Commit

**What it checks/does:** Nothing further to evaluate — this stage finalizes the winning sequence as the new live state.

**Why it exists:** The chosen route needs to become the **new baseline** for everything downstream — future insertions, future ETA promises to passengers, future scoring comparisons.

**How it works:**

```
ActiveRide.remainingStops = winning_sequence
```

If passenger D requests a ride 30 seconds later, the pipeline doesn't restart from the pre-C route — it starts from the just-committed post-C route and tries inserting D into _that_. This is the "rolling-horizon optimizer" principle: the route is a living object that only ever gets re-optimized going forward, never recomputed from scratch.

**Known open gap at this stage:** concurrency. If two new passenger requests are being matched against the same ride simultaneously, both could compute a valid insertion and attempt to commit before either has reserved the seat — atomic seat reservation is flagged as unsolved and needs to sit _in front of_ this stage, not after it, before this goes into an HLD.

---

## The Cost Gradient, End to End

| Stage | Question                             | Relative Cost                            |
| ----- | ------------------------------------ | ---------------------------------------- |
| 0     | Is this even possible?               | Free                                     |
| 1     | Is a pickup already committed?       | Free                                     |
| 2     | Geographically relevant?             | Very cheap (Redis)                       |
| 3     | Actually close enough?               | Cheap (geometry)                         |
| 4     | Same general direction?              | Cheap (geometry)                         |
| 5     | Where could insertion happen?        | Cheap–medium (combinatorial, but pruned) |
| 6     | Still okay for committed passengers? | Cheap                                    |
| 7     | Provably too expensive?              | Cheap (geometric lower bound)            |
| 8     | What does the road actually say?     | **Expensive**                            |
| 9     | Who gains/loses how much?            | Medium                                   |
| 10    | Is it acceptable at all?             | Cheap                                    |
| 11    | Which acceptable one is best?        | Cheap                                    |
| 12    | Make it real                         | Cheap                                    |

The entire design exists to keep the **expensive** stage (8) reached by as few candidates as possible — every earlier stage's only job is to eliminate obviously-bad candidates using progressively more precise but still-cheap approximations, so routing calls are spent only where they're likely to matter.

## Future Plans

- **Phase 3 — H3 resolution benchmarking:** Determine optimal H3 resolution per use case (city-wide analytics vs. driver discovery vs. precise pickup matching). Measure Redis set proliferation vs. candidate over-fetching tradeoff at each resolution.
- **Phase 3 — Leg caching layer:** Design and implement Redis-based leg cache (`leg:{h3_origin}:{h3_dest}:{time_bucket}`) as the prerequisite for hybrid routing. Benchmark cache hit rates under real traffic patterns.
- **Phase 3 — Hybrid routing (Stage 8):** Implement in-house insertion search for spine=1, switch to Google for spine≥2. Validate against real volume data showing distribution of spine sizes and Google API spend.
- **Phase 3 — Google API cost audit:** Model per-shipment pricing × candidates-per-request × matches-per-day once real traffic data is available.
- **Scoring weight calibration:** Replace hand-picked weights (30/30/25/15) with data-driven calibration against real outcome data (rider satisfaction, driver earnings, match acceptance rates).
- **Concurrency at commit:** Design and implement atomic seat reservation before Stage 12. This is a prerequisite for the HLD — the pipeline as currently specced has a race condition at high load.
- **Re-optimization throttling:** Design debouncing/throttling logic to prevent route thrashing when multiple requests arrive in rapid succession for the same ride.
- **Pricing and incentives:** Fare formula, surge model, and driver incentive structure — currently conceptual, needs product and economics design.
