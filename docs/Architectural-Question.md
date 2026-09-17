Settled Q&A against `docs/Overview.md`. Do not re-litigate these in a Phase 1
implementation pass. Execution tasks and remaining conflicts (including ones
this file does not resolve) live in `docs/BUILD-SPEC-phase-1.md`.

File updated with §18 (dynamic pricing, v2/planned — item 6 below). Now the walkthroughs:

## 1. New ride request — full execution path

```
Passenger app → POST /ride-requests (JWT)
   ↓
Core API: validate, INSERT RideRequest(status=SEARCHING), produce → ride.match.requested
   ↓ (respond 202 immediately — client shows "Searching…", does not block)
Kafka
   ↓
Matching Engine: Stages 0–13 (H3 corridor → eligibility → operational state →
   pickup/route distance → direction → sequence generation → pickup time window →
   detour lower bound → OptimizeTours road routing → incremental cost →
   hard constraints → scoring) → produce → ride.match.candidates (ranked list)
   ↓
Kafka
   ↓
Core API offer broadcaster: staggered WS notify (candidate #1 at t=0, #2–K at t=3s)
   ↓
Driver taps accept → Redis claim (NX) resolves the race → commit worker:
   optimistic-locked Postgres UPDATE (version check) → produce → ride.lifecycle.events
   ↓
WS push → passenger + driver; retract offer to every other notified driver
   ↓
Trip proceeds → PassengerPickedUp/Dropped events → RideCompleted → fare finalized → rating
```

Three explicit failure/fallback exits, all designed to fail fast rather than hang: no `ride.match.candidates` within ~20s → `NO_DRIVER_FOUND`; offer window (≤15s) elapses with no accept → requeue/`NO_DRIVER_FOUND`; commit conflict (stale `version`) → requeue to the Matching Engine, not silently dropped.

## 2. Live driver tracking — who does what

| Component                              | Job                                                                                                                                                                       | Explicitly not its job                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **WebSocket**                          | Transport for GPS ticks (driver→server, ~every 4s) and for pushing that location down to the passenger's live map                                                         | Not durable, not used for business events                                           |
| **Redis**                              | Source of truth for "where is this driver _right now_" — `driver:{id}` hash (lat/lng/h3Cell/status), plus `h3:{cell}` sets (the corridor index the Matching Engine reads) | Not history — it's overwritten, not appended                                        |
| **H3**                                 | Turns raw coordinates into a discrete cell id so "is this driver near this route" becomes a cheap set lookup instead of geometry math against every active ride           | Not the final distance/ETA truth — that's Google's job                              |
| **Kafka**                              | Carries only _meaningful changes_ — `driver.cell.changed` (fires only when the cell actually changes, not per tick) — and durable business events                         | Never carries raw GPS ticks — see the rationale in §13, same principle applies here |
| **Google Maps (Routes/OptimizeTours)** | Only invoked at match time and on route deviation (item 3) — computes the polyline/ETA the passenger's map draws                                                          | Not called on every tick — that would be enormous, pointless cost                   |

The one-line version: WebSocket+Redis is the hot, ephemeral, high-frequency path; Kafka is for state _transitions_; Google is called only when the route itself needs recomputing, not to answer "where is the car."

## 3. Driver deviates from the recommended route

This wasn't fully speced yet — here's the design:

**Detection.** Core API compares each incoming GPS tick's perpendicular distance to the ride's _currently active_ polyline (the one Google returned at the last routing call). Deviation is flagged when that distance exceeds a threshold (proposal: ~150–200m) for a few consecutive ticks — not on one noisy point, to avoid GPS jitter false-triggering a recompute.

**On confirmed deviation:**

1. Core API calls the **Routes API** (not `OptimizeTours`) with the driver's current position → same remaining stop sequence. This is a plain re-route, not a re-optimization — the stop _order_ didn't change, only the road geometry did.
2. New polyline replaces the old one in Redis/Postgres (`Ride.routeSnapshot`).
3. **Corridor re-indexing:** recompute H3 cells along the _new_ polyline (same sample-and-expand-by-one-ring method used to build the corridor originally), diff against the old cell set, remove the ride from cells it no longer touches, add it to new ones. This has to happen synchronously in the same handler — it's what the next `ride.match.requested` Stage 1 lookup depends on.
4. Push `ride.route.updated` via WebSocket so the passenger's map redraws the polyline and ETA.
5. **Debounce this.** Re-routing on every deviation tick would burn `maxRoutingCallsPerRun` budget on GPS noise — require deviation to persist across N ticks and rate-limit to one re-route per ride per short window.

**Escalation path, not the common case:** if the new route pushes an existing passenger's ETA past their delay budget (§17 already has the general concurrency machinery for this), that's no longer "just redraw the map" — it needs to re-enter the constraint-checking logic (Stage 11-style), potentially flagging the ride for review rather than silently accepting a route that now breaks a promise.

## 4. Auth, as currently designed (§5)

Google Sign-In at login only → Core API verifies the ID token → issues its own **access token** (JWT, RS256, 15 min) + **refresh token** (opaque, 30 days, hashed server-side, rotated on every use with reuse detection). The private signing key lives only in Core API; the **public** key is exposed via JWKS so any service — including Matching Engine, if it ever needed to — can verify a token without ever being trusted to issue one. WebSocket auth reuses the same access token at handshake. Matching Engine currently needs none of this in the common path since it only talks to Core API through Kafka, never a direct authenticated call.

## 5. Where to cut latency and cost

| Lever                      | Concrete move                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching latency           | Cache Google Routes leg costs for stable sub-segments (keyed by origin cell/dest cell/time-bucket, short TTL) — avoids re-paying for a leg that hasn't actually changed                                                                                                                                                                                  |
| Matching latency           | Keep `minimumUsableCandidates` aggressive — the fewer candidates that reach Stage 9, the less serial `OptimizeTours` time per request                                                                                                                                                                                                                    |
| Cost                       | Consider a self-hosted router (OSRM/Valhalla) for the _cheap filtering_ stages (7–8) — use it only as a lower-bound estimate to prune, reserve paid Google calls for the final shortlist that actually reaches Stage 9. Trade-off: self-hosted loses live traffic accuracy, which is exactly why it's only for pruning, never for the committed decision |
| Cost                       | Debounce route re-routing (item 3) and cell-change publishing — both already designed to fire only on meaningful change, not every tick                                                                                                                                                                                                                  |
| Kafka throughput           | Compress messages (snappy/lz4), size `ride.match.requested` partitions to real expected request/sec, not a guess (flagged in §17)                                                                                                                                                                                                                        |
| DB                         | Read replica for admin/analytics reads so they never compete with the commit-path transaction (§12); connection pooling (PgBouncer) given many short-lived API requests                                                                                                                                                                                  |
| Scaling                    | Autoscale Matching Engine off **Kafka consumer lag**, not CPU — lag is the actual signal that matching is falling behind demand                                                                                                                                                                                                                          |
| Data-driven, not guesswork | The per-stage funnel metrics already designed in §16 (`attemptStats`) tell you _where_ the funnel is wasting paid calls — e.g., a high `geographicallyPruned` count means stages 6–8 should be pruning harder before anything reaches Stage 9. Use that before hand-tuning thresholds blind                                                              |

## 7. Kafka's actual footprint in the system

| Topic                             | Carries                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `ride.match.requested`            | Request snapshot → Matching Engine                                 |
| `ride.match.candidates`           | Ranked match results → Core API                                    |
| `ride.lifecycle.events`           | Durable ride-state transitions → Notifications/Payments/Analytics  |
| `driver.cell.changed`             | Meaningful location state changes only → Matching Engine/Analytics |
| `payment.events`                  | Payment outcomes → Notifications/Analytics/Ledger                  |
| `pricing.surge.updated` (v2, §18) | Surge multiplier changes → fare estimates, admin heatmap           |

The governing rule everywhere: **Kafka carries durable, replayable facts and state transitions — never a high-frequency ephemeral stream.** Raw GPS and the sub-15s driver-accept race both deliberately stay on WebSocket+Redis instead, for the same reason in both cases.
