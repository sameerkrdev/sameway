# This file will contains the info about the whole platform like it will be the overview content for platform so after each changes edit this file

# Sameway — Platform Overview

## The Core Idea

**Sameway** is a dynamic shared-ride / carpooling platform. Instead of matching 1 passenger → 1 vehicle and leaving seats empty, it dynamically inserts multiple passengers with _compatible routes_ into the same vehicle in real time. Lower fares for riders, higher earnings for drivers, better utilization for the platform. The product philosophy is deliberately not "Uber but cheaper" — it's a marketplace that makes explicit trade-offs about whose delay gets protected and whose gets flexed, in order to make pooling economics work.

Reference: - @docs/MATCHING-STAGES-GUIDE.md
Phase 1 execution spec: - @docs/BUILD-SPEC-phase-1.md

Two deployable backend services, one durable event log between them, one auth story
for every client. This document is the system-level design that sits above the
`apps/simulation` matching pipeline (see `MATCHING-STAGES-GUIDE.md` — this HLD treats
that pipeline as a black box with a known input/output contract and known cost
budgets, and designs the surrounding platform around it). Phase 1 build order,
repo audit, and definition of done live in `docs/BUILD-SPEC-phase-1.md` — do not
re-derive them here.

---

## Table of contents

1. [Scope](#1-scope)
2. [Service topology — why two services, why async](#2-service-topology--why-two-services-why-async)
3. [Tech stack decisions](#3-tech-stack-decisions)
4. [Monorepo layout](#4-monorepo-layout)
5. [Auth architecture](#5-auth-architecture)
6. [Data architecture](#6-data-architecture)
7. [Core API — responsibilities & modules](#7-core-api--responsibilities--modules)
8. [Matching Engine — responsibilities & modules](#8-matching-engine--responsibilities--modules)
9. [Real-time layer](#9-real-time-layer)
10. [End-to-end flow: request → match → commit → trip](#10-end-to-end-flow-request--match--commit--trip)
11. [Driver broadcast & offer flow](#11-driver-broadcast--offer-flow)
12. [Concurrency & atomic commit](#12-concurrency--atomic-commit)
13. [Driver location pipeline](#13-driver-location-pipeline)
14. [Client apps](#14-client-apps)
15. [Deployment topology](#15-deployment-topology)
16. [Observability & security](#16-observability--security)
17. [Open decisions carried forward](#17-open-decisions-carried-forward)
18. [v2 (Planned): Dynamic Pricing Module](#18-v2-planned-dynamic-pricing-module)

Phase 1 implementation tasks, the real folder map (`apps/captain` / `apps/user` /
`apps/web` / `apps/api`), and open conflicts between this HLD and the repo as it
exists today: [`docs/BUILD-SPEC-phase-1.md`](./BUILD-SPEC-phase-1.md).

---

## 1. Scope

This is the system-level HLD: service boundaries, data ownership, the event
contract between services, auth, and deployment. It does **not** re-derive the
matching pipeline itself (stages, filters, scoring) — that's locked in
`MATCHING-STAGES-GUIDE.md` and treated here as a component with a defined
interface and defined cost/latency budgets. Pricing/surge internals, detailed DB
migrations, and the Method A/B routing threshold are separate specs.

---

## 2. Service topology — why two services, why async

**Two backend services. One event log between them.**

```
┌─────────────────┐         ┌──────────────┐         ┌───────────────────┐
│                  │  Kafka  │              │  Kafka  │                   │
│    Core API      │────────▶│  Kafka       │────────▶│  Matching Engine  │
│  (Express/TS)    │◀────────│  Cluster     │◀────────│  (Express/TS)     │
│                  │         │              │         │                   │
└────────┬─────────┘         └──────────────┘         └─────────┬─────────┘
         │                                                       │
         ▼                                                       ▼
   Postgres/PostGIS                                    Google Route
   Redis (hot state)                                   Optimization API
   Socket.IO gateway                                   Redis (read-only:
                                                          H3 corridor sets)
```

**Why this split, concretely:**

The matching pipeline's own settings prove synchronous HTTP can't work for a
pooled request:

| Guide constant            | Value     | Implication                                                   |
| ------------------------- | --------- | ------------------------------------------------------------- |
| `optimizerTimeoutMs`      | 10,000 ms | A single `OptimizeTours` call can legitimately take up to 10s |
| `maxOptimizerCallsPerRun` | 40        | Worst case, one matching run makes up to 40 of those calls    |
| `maxRoutingCallsPerRun`   | 150       | Plus up to 150 `Routes API` calls in the same run             |

Even with H3 corridor discovery cutting candidates to single digits before any
paid call happens, a run can take multiple seconds. A passenger's `POST
/ride-requests` cannot block on that — the client needs a `SEARCHING` state
immediately and a push notification when the match resolves. Kafka is what lets
Core API return in milliseconds while the Matching Engine works independently,
and it gives you a durable, replayable log of every match decision for free
(useful for the "why did I fail" debugging story you already designed into the
pipeline's reason codes).

**Why not just Redis Streams or direct HTTP with a callback?**

- **Direct sync HTTP call, Core API → Matching Engine:** rejected — reintroduces
  the 10s blocking problem one hop later; Core API's own request threads would
  back up under load.
- **Redis Streams instead of Kafka:** viable at small scale, but weaker
  consumer-group rebalancing, weaker replay/retention guarantees, and you'd
  still want Kafka later for ride lifecycle events (payments, notifications,
  analytics) — better to have one event backbone than two.
- **Kafka for _everything_, including raw GPS:** rejected for the hot path — see
  [§13](#13-driver-location-pipeline). Kafka carries state-_change_ events and
  business events, not every 4-second location ping.

**What the Matching Engine is, architecturally:** a stateless, horizontally
scalable compute service. It has **no direct Postgres access**. It consumes a
self-contained ride/driver snapshot from the Kafka message, reads the H3
corridor index from Redis (read-only), calls Google's APIs, and publishes a
result. This is a deliberate boundary, not an oversight — see
[§8](#8-matching-engine--responsibilities--modules) for the rationale.

---

## 3. Tech stack decisions

| Layer               | Choice                                                  | Why                                                                                                                            | Rejected / alternative                                                                                                                              |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime             | Node.js + Express + TypeScript                          | Same language across `apps/simulation`, Core API, Matching Engine — one hiring/tooling story                                   | Fastify (faster, but Express is the known quantity here)                                                                                            |
| ORM                 | **Prisma**                                              | Already locked for `apps/simulation` (Schema v2 + Zod migrator); one ORM story monorepo-wide                                   | Drizzle — better raw-SQL/PostGIS ergonomics; revisit only if Prisma's raw-query escape hatches become a real bottleneck on PostGIS-heavy queries    |
| Primary DB          | PostgreSQL + PostGIS                                    | Durable source of truth; PostGIS for persistent geo analytics                                                                  | —                                                                                                                                                   |
| Event backbone      | **Kafka**                                               | Durable, replayable, per-key-ordered log; the only sane bridge between a sub-second API and a multi-second matching call chain | Redis Streams (fine at small scale, weaker durability/replay); SQS/PubSub (workable, but weaker per-key ordering + no natural consumer-group story) |
| Real-time state     | Redis                                                   | Driver location, H3 corridor sets, commit locks, Socket.IO adapter                                                             | —                                                                                                                                                   |
| Real-time transport | Socket.IO                                               | Rooms, reconnection, transport fallback, Redis adapter for multi-instance fan-out                                              | Raw `ws` — leaner, but you rebuild rooms/reconnect/adapter yourself for no real gain here                                                           |
| Auth                | Google OAuth (sign-in) + own JWT (RS256) access/refresh | Own tokens decouple you from Google's session lifetime; RS256 means any service verifies without holding a signing secret      | Cookie sessions — bad fit for two native apps + a web admin panel                                                                                   |
| Monorepo            | TurboRepo                                               | Already established                                                                                                            | —                                                                                                                                                   |
| Mobile              | Expo — driver app, passenger app                        | Already established                                                                                                            | —                                                                                                                                                   |
| Admin               | React web app (own workspace, not Expo)                 | Ops tooling, not a mobile surface                                                                                              | —                                                                                                                                                   |

---

## 4. Monorepo layout

```
apps/
  api/                  # Core API — Express, sync, owns Postgres + Redis writes
  matching-engine/      # Async worker — consumes/produces Kafka, no DB access
  simulation/           # existing lab (unchanged, Phase 3 work continues there)
  driver-app/           # Expo
  passenger-app/        # Expo
  admin-web/            # React (Vite)

packages/
  db/                   # Prisma schema + generated client (shared by api only)
  types/                # Shared TS types (Ride, Passenger, MatchRequest, etc.)
  kafka-schemas/        # Event payload contracts (zod schemas, versioned)
  auth/                 # JWT sign/verify, JWKS client — used by api + matching-engine
  h3/                   # h3-js wrappers (shared by api + matching-engine)
  routing/              # Google Routes/OptimizeTours client wrappers
  matching-core/        # The stage pipeline itself, lifted from apps/simulation
                         #   so matching-engine and the simulation lab share
                         #   one implementation, not two that drift apart
  config/
  ui/
```

The single most important refactor implied here: **`matching-core` becomes a
shared package.** Right now the 13-stage pipeline lives inside
`apps/simulation`. The production Matching Engine should run the _same_ code,
not a reimplementation — otherwise the simulation lab stops being a reliable
predictor of production behavior. `apps/simulation` and `apps/matching-engine`
both import `matching-core` and differ only in what feeds it (mock scenario
data vs. real Kafka events) and what it calls (stub optimizer vs. live Google
APIs).

---

## 5. Auth architecture

**Login:** Google OAuth is the _only_ identity provider at signup — Expo apps
use Google's native sign-in to get an ID token, then `POST /auth/google` with
it. Core API verifies the ID token against Google's public certs, upserts a
`User` row, and issues Sameway's own token pair. Nothing downstream ever
depends on a live Google session again.

**Token pair:**

| Token         | Format                       | TTL     | Storage                                          | Purpose                   |
| ------------- | ---------------------------- | ------- | ------------------------------------------------ | ------------------------- |
| Access token  | JWT, RS256                   | 15 min  | Client memory only                               | Sent on every API/WS call |
| Refresh token | Opaque 256-bit random string | 30 days | Hashed (SHA-256) in Postgres, hot cache in Redis | Exchanged for a new pair  |

**Access token claims:** `sub` (userId), `role` (`PASSENGER` \| `DRIVER` \|
`ADMIN`), `deviceId`, `kid` (key id, in the JWT header).

**Why RS256 (asymmetric) instead of a shared HS256 secret:** the private
signing key lives only inside Core API's auth module (KMS-backed in prod). The
**public** key is published at `/.well-known/jwks.json`. Any service — Matching
Engine, Admin web's BFF, a future service — verifies a token locally with zero
network call and zero access to anything that could mint a token. This matters
specifically because of the two-service split: it means Matching Engine could
verify a token if it ever needed to (e.g., an ops/debug endpoint) without ever
being trusted to issue one.

**Refresh rotation + reuse detection:** every refresh call issues a new refresh
token and invalidates the one just used. If an already-invalidated refresh
token is presented again, that's a signal of a stolen token — revoke the
**entire token family** (all tokens descended from that login) and force
re-authentication. This is the standard mitigation for refresh-token theft and
costs nothing extra to implement once rotation exists.

**Key rotation:** publish the new public key alongside the still-valid old one
(both live in the JWKS response) for an overlap window equal to the access
token TTL, then retire the old key. Never rotate by immediately invalidating —
that logs out everyone with a live access token mid-flight.

**WebSocket auth:** access token sent in the Socket.IO handshake `auth`
payload, verified once at connect time with the public key. On expiry the
client refreshes over HTTP and reconnects — no separate WS-specific token
scheme.

**Service-to-service:** the common path needs none — Matching Engine only ever
talks to Core API through Kafka, never through an authenticated HTTP call. If
an internal HTTP path is ever added, it uses the same JWT machinery with
`role: internal-service`, not a second auth system.

---

## 6. Data architecture

### 6.1 Postgres (owned entirely by Core API)

Core tables, field lists kept to what's structurally relevant here — full DDL
is its own spec:

| Table              | Key fields                                                                                      | Notes                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `User`             | id, googleSub, role, phone, createdAt                                                           | One row per human, `role` distinguishes passenger/driver/admin at the account level      |
| `Driver`           | id, userId, status, vehicleId, sharedRidesEnabled                                               | `status` mirrors the Matching Engine's `ONLINE/OFFLINE/PAUSED/BUSY`                      |
| `Vehicle`          | id, driverId, type, totalSeats, luggageCapacity, wheelchairAccessible                           |                                                                                          |
| `RideRequest`      | id, passengerId, pickup (PostGIS point), drop, seatsRequired, status, maxWaitMinutes, createdAt | `status: REQUESTED \| SEARCHING \| MATCHED \| NO_DRIVER_FOUND \| EXPIRED \| CANCELLED`   |
| `Ride`             | id, driverId, vehicleId, status, **version** (int, optimistic lock), createdAt                  | `version` is load-bearing — see [§12](#12-concurrency--atomic-commit)                    |
| `RidePassenger`    | id, rideId, passengerId, seatsRequired, maxPickupDelayMin, maxDropDelayPercent, allowsPooling   | Per-passenger delay budgets, mirrors the guide's `DEFAULT_PASSENGER_DELAY_BUDGETS` shape |
| `RideStop`         | id, rideId, passengerId, type (`PICKUP`\|`DROP`), sequence, status, originalEtaMin              | The committed spine; this is what the Matching Engine's snapshot is built from           |
| `Fare` / `Payment` | ride/passenger-scoped                                                                           | Pricing spec is separate                                                                 |
| `Rating`           | rideId, raterId, ratedId, score                                                                 |                                                                                          |
| `RefreshToken`     | tokenHash, userId, deviceId, familyId, revokedAt, expiresAt                                     | See §5                                                                                   |
| `LocationHistory`  | driverId, point (PostGIS), recordedAt                                                           | Async-persisted, not written on every GPS tick — see §13                                 |

### 6.2 Redis (shared hot state — Core API writes, Matching Engine reads a subset)

| Key pattern                   | Type                  | Owner (writer)                     | Reader                    | Purpose                                                              |
| ----------------------------- | --------------------- | ---------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `driver:{driverId}`           | Hash                  | Core API                           | Core API, Matching Engine | `lat, lng, h3Cell, status, vehicleId, currentRideId, lastSeenAt`     |
| `h3:{cell}`                   | Set                   | Core API                           | Matching Engine           | Driver/ride ids whose corridor touches this cell — the Stage 1 index |
| `lock:ride:{rideId}`          | String, `NX PX 5000`  | Core API commit worker             | —                         | Serializes concurrent commit attempts, §12                           |
| `lock:driver:{driverId}`      | String, `NX PX 5000`  | Core API commit worker             | —                         | Same, for first-passenger idle-driver commits                        |
| `offer:{requestId}:claimed`   | String, `NX PX <ttl>` | Core API offer broadcaster         | —                         | Resolves the driver accept race before any DB write — see §11        |
| `socket:user:{userId}`        | Set                   | Core API (Socket.IO Redis adapter) | Core API                  | Cross-instance WS fan-out                                            |
| `ratelimit:{userId}:{bucket}` | String, TTL           | Core API                           | Core API                  | Token-bucket rate limiting                                           |

Matching Engine has **read-only** Redis credentials scoped to the `h3:*` and
`driver:*` key patterns — it cannot take locks or write driver state. This is
enforced with a separate Redis ACL user, not just convention.

### 6.3 Kafka topics

| Topic                   | Key         | Producer        | Consumer(s)                        | Payload (summary)                                                                                                                                                                                                      | Ordering need                                    |
| ----------------------- | ----------- | --------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `ride.match.requested`  | `requestId` | Core API        | Matching Engine                    | Full self-contained snapshot: request + candidate-relevant driver/ride state is **not** included here — candidates come from Matching Engine's own H3 read; payload is request + passenger delay budgets + baseVersion | Not critical — one request per key               |
| `ride.match.candidates` | `requestId` | Matching Engine | Core API (offer broadcaster, §11)  | `status: MATCHED\|NO_MATCH`, **ranked array** of candidates (`driverId, rideId?, stopPlan, baseVersion, score, perPartyImpact`) — not a single winner                                                                  | **Critical** — must process in order per request |
| `ride.lifecycle.events` | `rideId`    | Core API        | Notifications, Payments, Analytics | `RideRequested, DriverAssigned, PassengerPickedUp, PassengerDropped, RideCompleted, RideCancelled`                                                                                                                     | **Critical** per ride                            |
| `driver.cell.changed`   | `h3Cell`    | Core API        | Matching Engine, Analytics         | Emitted only when a driver's H3 cell actually changes (not on every GPS tick)                                                                                                                                          | Not critical                                     |
| `payment.events`        | `rideId`    | Payment worker  | Notifications, Analytics, Ledger   | `PaymentCompleted, PaymentFailed`                                                                                                                                                                                      | Per-ride                                         |

The driver-facing accept/decline race that follows `ride.match.candidates` is
**not** a Kafka concern — it's short-lived (≤15s), single-region coordination
handled entirely in Redis + WebSocket. See [§11](#11-driver-broadcast--offer-flow)
for why that split is deliberate, same reasoning as raw GPS staying off Kafka.

Partition counts and retention are sizing work, not architecture — flagged in
[§17](#17-open-decisions-carried-forward). Every consumer group gets a DLQ
topic (`{topic}.dlq`) after N retries with exponential backoff; a message that
lands in `ride.match.requested.dlq` should cause Core API to fail that
`RideRequest` to `NO_DRIVER_FOUND` rather than leave the passenger waiting
forever.

---

## 7. Core API — responsibilities & modules

Everything that is **not** the matching decision itself lives here: auth,
CRUD, the ride state machine, pricing, payments, ratings, notifications, admin
APIs, and the real-time gateway.

```
apps/api/src/
  modules/
    auth/            # Google verify, JWT issue/refresh/rotate, JWKS endpoint
    users/
    drivers/
    vehicles/
    rides/           # RideRequest + Ride state machines
    matching-gateway/# produces ride.match.requested, consumes ride.match.candidates,
                      # owns the offer broadcaster (§11) and the atomic-commit worker (§12)
    pricing/
    payments/
    ratings/
    notifications/   # push/SMS fan-out, consumes ride.lifecycle.events
    admin/           # ops endpoints for admin-web
  realtime/           # Socket.IO gateway, room management, Redis adapter
  kafka/              # producer/consumer wrappers (schemas from packages/kafka-schemas)
  redis/
  db/                 # Prisma client wrapper
```

`matching-gateway` is the seam — it's the only module that talks to Kafka on
the matching topics, the only place that touches `lock:ride:*` /
`lock:driver:*` / `offer:*`, and the only module that owns the driver
accept/decline race described in §11. Everything else in Core API is a fairly
conventional CRUD/API layer.

---

## 8. Matching Engine — responsibilities & modules

Consumes `ride.match.requested`, runs the pipeline from
`MATCHING-STAGES-GUIDE.md` against the embedded snapshot, produces
`ride.match.candidates` — the full ranked list of survivors past hard
constraints, not just the top-scored winner (see [§11](#11-driver-broadcast--offer-flow)
for what Core API does with that list). That's the entire external contract.

```
apps/matching-engine/src/
  consumers/
    rideMatchRequested.consumer.ts
  producers/
    rideMatchCandidates.producer.ts
  corridor/
    h3CorridorReader.ts        # read-only Redis client, scoped ACL
  config/
    settings.ts                 # DEFAULT_SETTINGS, budgets (maxOptimizerCallsPerRun,
                                 # maxRoutingCallsPerRun, optimizerTimeoutMs)
  telemetry/
    funnelMetrics.ts             # per-stage pass/fail counts, mirrors attemptStats

  # imported, not owned:
  # packages/matching-core       — the 13-stage pipeline itself (shared with apps/simulation)
  # packages/routing             — OptimizeTours / Routes API clients
  # packages/h3                  — h3-js wrappers
```

**Why no direct Postgres access — the actual reasoning, not just the rule:**

1. **Testability parity with the simulation lab.** `apps/simulation` already
   proved the value of a deterministic `stubOptimizer.ts` and snapshot-based
   test scenarios. A Matching Engine with no DB access is a pure function of
   `(Kafka payload, Redis corridor read, Google API responses) → result` —
   exactly the same shape the simulation lab already tests against. A Matching
   Engine that reads Postgres directly would need its own, different test
   harness.
2. **Independent scaling without a shared bottleneck.** The whole point of
   splitting this out is to scale it independently under matching load. Giving
   it a direct Postgres connection pool re-couples its scaling ceiling to the
   primary database's connection limit.
3. **Service boundary integrity.** If Matching Engine can read Ride/Passenger
   tables directly, the "snapshot in the event payload" contract silently
   erodes over time — someone adds "just one more field" via a DB query
   instead of extending the schema, and the two services end up implicitly
   coupled to the same schema migrations.

**Rejected alternative:** Matching Engine reads a Postgres **read replica**
directly. This was seriously considered — it avoids ever needing to keep the
Kafka snapshot schema in sync with what the pipeline actually needs. Rejected
because it means every new field the pipeline wants requires touching Core
API's schema _and_ a service that shouldn't otherwise need database
credentials, and because replica lag becomes a second source of staleness on
top of the event-payload staleness §11 already has to handle — better to
handle one staleness problem (optimistic locking) than two.

**Staleness is expected and handled, not avoided.** The snapshot in
`ride.match.requested` reflects ride state at publish time. By the time
`ride.match.candidates` comes back — and by the time a driver actually taps
accept on one of those candidates, which can be a further 15s out — the real
`Ride.version` for any given candidate may have moved (a different passenger
got committed to that same ride first). That's fine — every candidate in the
ranked list carries its own `baseVersion`, and §12's optimistic-lock commit is
what actually resolves it at accept time, not at broadcast time.

---

## 9. Real-time layer

Socket.IO, namespaced by role, backed by the Redis adapter so any Core API
instance can push to a client connected to any other instance.

```
/driver     — room per driverId (assigned stops, ride status)
/passenger  — room per rideId (driver location, ETA, status)
/admin      — room per active-ride cohort, for the ops dashboard
```

**What goes over WebSocket vs. HTTP:**

| Channel                                                   | Transport | Why                                                                                       |
| --------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| Driver GPS ticks (driver → server)                        | WebSocket | High frequency, low payload, no response needed                                           |
| Ride offer broadcast + accept + retract (server ↔ driver) | WebSocket | Sub-15s race, needs push to multiple drivers and an immediate retract to losers — see §11 |
| `SEARCHING` → `MATCHED` push (server → passenger)         | WebSocket | This is _the_ reason Kafka async works for the client — no polling                        |
| Driver location → passenger (server → passenger)          | WebSocket | Live map                                                                                  |
| Ride request creation, cancellation, ratings              | HTTP      | Request/response semantics, need a definite success/failure                               |

---

## 10. End-to-end flow: request → match → commit → trip

```
Passenger App
    │ POST /ride-requests  (JWT)
    ▼
Core API
    │ validate (Stage-0-style checks happen here too, cheaply)
    │ INSERT RideRequest (status = SEARCHING)
    │ produce → ride.match.requested
    │   { requestId, pickup, drop, seatsRequired,
    │     passengerDelayBudgets, maxWaitMinutes, baseVersion }
    │ respond 202 immediately — client shows "Searching…"
    ▼
Kafka: ride.match.requested
    ▼
Matching Engine (consumer group, N instances)
    │ Stages 0–13 from MATCHING-STAGES-GUIDE.md:
    │   H3 corridor (Redis read) → eligibility → operational state →
    │   pickup/route distance → direction → sequence generation →
    │   pickup time window → detour lower bound →
    │   OptimizeTours (≤10s, budget-capped) → incremental cost →
    │   hard constraints → scoring → commit-plan
    │ produce → ride.match.candidates
    │   { requestId, status: MATCHED|NO_MATCH,
    │     candidates: [{ driverId, rideId?, stopPlan, baseVersion,
    │                     score, perPartyImpact }, …ranked] }
    ▼
Kafka: ride.match.candidates
    ▼
Core API — matching-gateway offer broadcaster (full detail in §11)
    │ t=0s   WS notify candidate #1 only
    │ t=3s   no accept → also notify #2..K
    │ driver taps accept → Redis claim (NX) → winner proceeds below,
    │        losers get an instant reject, no DB hit
    ▼
Core API — matching-gateway commit worker
    │ SET lock:ride:{rideId} NX PX 5000     (or lock:driver:* for a fresh idle driver)
    │ UPDATE ride SET stops=…, version=version+1
    │   WHERE id=$rideId AND version=$baseVersion
    │ ── 0 rows updated → stale plan, requeue request (§12) ──
    │ ── success → commit stops, release lock ──
    │ produce → ride.lifecycle.events { DriverAssigned }
    │ WS: retract offer to every other notified driver
    │ push via Socket.IO → passenger room + driver room
    ▼
Trip proceeds: PassengerPickedUp / PassengerDropped events →
ride.lifecycle.events → Notifications, Payments, Analytics →
RideCompleted → Fare finalized → Rating prompts
```

If no `ride.match.candidates` arrives within a configured timeout (proposal:
20s, comfortably above `optimizerTimeoutMs`), or if the full offer window
(≤15s per §11) elapses with no driver accepting, Core API marks the
`RideRequest` `NO_DRIVER_FOUND` and notifies the client — it does not wait
indefinitely on a Kafka message or an unanswered offer.

---

## 11. Driver broadcast & offer flow

Solo ride-hailing (Uber, Rapido) broadcasts a new request to nearby drivers
and lets whoever accepts first take it. Sameway needs the same shape of
flow for the driver-facing UX, but the fairness-scoring work underneath it
means it can't be a straight copy — worth being explicit about why.

**This costs nothing extra to compute.** Every driver that survives Stage 11's
hard constraints already has a real, road-routed stop plan (from
`OptimizeTours`, Stage 9) and a score (Stage 12). That's true whether Stage 13
auto-commits the top-ranked winner or not. So "broadcast the list of
compatible drivers/rides" isn't new matching work — it's a change to what the
last stage _does_ with results it already has: publish the ranked survivor
list instead of silently picking #1. No extra `OptimizeTours` calls, no extra
routing budget burned.

**Why not flat parallel broadcast, exactly like solo dispatch:** in solo
ride-hailing every driver in the broadcast list is offering an interchangeable
trip — same pickup, same drop, the only real difference is who's closer. Here,
each candidate is a _structurally different match_ — a different insertion
point, a different detour imposed on that driver's own existing passengers, a
different fairness score. Flat first-tap-wins means whoever's phone was in
hand can override the weighted scoring that's the actual product
differentiator: driver D1 accepting might cost an existing passenger +2 min;
D3 accepting — just as "feasible," just lower-ranked — might cost +9 min.
That's not a reason to skip broadcasting; it's a reason to broadcast top-K
with a staggered start, not a dead-heat free-for-all.

### Kafka contract

`ride.match.candidates` carries the full ranked array, not a single winner —
see the updated [§6.3](#63-kafka-topics) and [§8](#8-matching-engine--responsibilities--modules).
Same producer (Matching Engine) / consumer (Core API) as before; only the
payload shape changed.

### Choreography — Redis + WebSocket, not Kafka

This is ephemeral, sub-20-second, single-region coordination — the same
reasoning that keeps raw GPS off Kafka (see [§13](#13-driver-location-pipeline)).
Kafka carries the durable "here are the candidates" fact; the live
accept/retract race is Redis + the existing `/driver` WS room from §9.

```
t=0s     notify candidate #1 only              (preserves score priority)
t=3s     no accept yet → also notify #2..K      (parallel fallback kicks in fast)
t≤15s    first accept wins, race resolved atomically (below)
timeout  none accepted → requeue to ride.match.requested, wider search
```

`K` (shortlist size) and the `3s` / `15s` timers are config, not fixed values —
flagged in [§17](#17-open-decisions-carried-forward) as needing real tuning
against acceptance-rate data.

### Race resolution — reuses the §12 commit design, doesn't replace it

1. Driver taps accept → Redis atomic claim: `SET offer:{requestId}:claimed
{driverId} NX PX <ttl>`. Whoever loses this gets an instant reject — no DB
   hit, no thundering herd on Postgres.
2. The claim winner proceeds through the _same_ optimistic-lock commit as
   §12: `UPDATE ride SET stops=…, version=version+1 WHERE id=$rideId AND
version=$baseVersion`. If the ride moved underneath in the meantime (a
   different request got committed to it first), the claim is released, that
   driver gets "no longer available," and the _original passenger request_ is
   requeued to the Matching Engine — the same stale-plan-retry path §12
   already defines.
3. On success: `ride.offer.retracted` pushed via WebSocket to every other
   notified driver for that `requestId`, immediately.

This means the accept flow doesn't need new atomicity machinery of its own —
the Redis claim just resolves the sub-second driver-tap race cheaply, and the
`version` check still does the actual correctness work it was already doing.

### Product policy, not an architecture decision

Does _every_ insertion into an already-active pooled ride get a driver
accept/decline prompt, or only a driver's first pickup on a fresh ride?
Prompting mid-trip for every new pooled passenger is real phone-while-driving
friction. A reasonable default: auto-accept insertions under a small detour
delta for drivers who are already `sharedRidesEnabled` and `ONLINE`, and only
prompt when it's a first assignment or the insertion crosses a threshold. The
offer machinery above works under either policy — this is a config knob to
decide later, not something that changes the design above.

---

## 12. Concurrency & atomic commit

This is the piece flagged as unresolved in earlier design passes, resolved
here as a first draft (needs load testing before it's final). §11's driver
accept is what _triggers_ this — the Redis claim in §11 resolves who gets to
attempt the commit; what follows is what makes that commit safe:

**Optimistic locking on `Ride.version`:**

- Every `Ride` row carries an integer `version`.
- The snapshot Matching Engine computes against includes `baseVersion` = the
  `version` it read.
- Its output plan carries that same `baseVersion` forward.
- The commit worker's `UPDATE` is conditioned on `version = $baseVersion`. If
  another commit landed first, `version` has already moved, the `UPDATE`
  matches zero rows, and the commit worker knows its plan is stale.

**Redis lock as a second layer, not a replacement:** the optimistic-lock
`UPDATE` alone is sufficient for correctness, but a short `SETNX` lock around
the whole commit transaction prevents two commit workers from doing redundant
work (routing/notification side-effects) for the same ride simultaneously —
belt-and-suspenders, not the source of truth.

**On a stale plan:** don't just drop the request. Republish it to
`ride.match.requested` with a note that it's a retry (bounded retry count) so
Matching Engine re-evaluates against current state — the seat that was taken
might still leave room for a different insertion, or a different driver
entirely.

**For a brand-new idle-driver match** (no existing `Ride` row yet), the lock
key is `lock:driver:{driverId}` instead, and the "optimistic" check is a
simple `driver.currentRideId IS NULL` guard inside the same transaction that
creates the `Ride` row.

---

## 13. Driver location pipeline

```
Driver App
    │ GPS tick, every ~4s
    ▼  (WebSocket, not Kafka — see rationale below)
Core API realtime gateway
    │ update Redis: driver:{id} hash (lat, lng, lastSeenAt)
    │
    │ compute new H3 cell
    │ if cell unchanged → stop here, nothing else happens
    │ if cell changed:
    │     diff old corridor cells vs new, update h3:{cell} sets
    │     produce → driver.cell.changed   (Kafka)
    ▼
Matching Engine / Analytics consume driver.cell.changed
    (corridor index refresh, demand/supply heatmap input — not a trigger
     for proactively re-matching other passengers' pending requests; that's
     a Phase 2 feature, see §17)
```

**Why raw GPS never touches Kafka:** at meaningful driver-fleet scale this is
a very high-volume, very low-value-per-message stream, and nothing downstream
needs _every_ tick — only cell transitions matter for matching, and only
periodic samples matter for `LocationHistory`. Routing every GPS tick through
Kafka would mean provisioning partition/consumer capacity for a firehose where
99% of messages are "nothing changed." WebSocket → Redis directly is the right
tool for a hot, ephemeral, high-frequency stream; Kafka is for the moments
that actually mean something happened.

`LocationHistory` in Postgres is written asynchronously and sparsely (e.g., on
cell change or every N seconds), never on every tick — same principle as
above, applied to the durable store instead of the event log.

---

## 14. Client apps

**Driver app (Expo):** online/offline toggle, live GPS broadcast, ride-offer
accept/decline prompts (§11) with a visible countdown before the offer moves
to the next driver, assigned stop sequence with turn-by-turn (Maps SDK),
earnings view.

**Passenger app (Expo):** ride request flow, live `SEARCHING` state, live map
with driver + other pooled stops (as appropriate to show), fare, in-app
chat/call, rating.

**Admin web (React, own workspace):** driver/passenger management, live ride
inspector — effectively a production-facing version of the simulation lab's
funnel view, since Stage 13's per-party impact metrics and reason codes are
already exactly the data a support agent needs to answer "why wasn't I
matched" or "why did my fare change" — H3 demand heatmap (reads the same
`h3:{cell}` structure Redis already maintains), refunds/dispute tooling.

---

## 15. Deployment topology

```
                     ┌── LB ──┐
                     ▼        ▼
              Core API #1   Core API #2  … (stateless, N replicas)
                     │        │
          ┌──────────┼────────┼──────────┐
          ▼          ▼        ▼          ▼
     Postgres    Postgres   Redis      Kafka
     (primary)   (replica,  (cluster)  (cluster —
                  admin      │          managed: MSK /
                  reads)     │          Confluent / Redpanda)
                             │               │
                             │               ▼
                             │      Matching Engine #1..M
                             │      (Kafka consumer group,
                             │       scales with partition count)
                             └───────────────┘  (read-only ACL)
                                     │
                                     ▼
                          Google Route Optimization /
                          Routes API (separate API key/
                          quota from any Core API usage)
```

Core API is stateless and scales behind a load balancer; WebSocket
stickiness/fan-out is handled by the Socket.IO Redis adapter, not by session
affinity. Matching Engine scales by Kafka partition count on
`ride.match.requested` — one consumer instance per partition is the natural
ceiling, so partition count for that topic is a direct scaling-capacity
decision, not just a throughput one.

---

## 16. Observability & security

**Observability:**

- Structured logs (pino) with `requestId`/`rideId` threaded through every log
  line on both services.
- Trace context (`traceparent`) propagated through Kafka message headers so a
  single request can be traced Core API → Kafka → Matching Engine → Kafka →
  Core API in one view.
- Per-stage funnel metrics from Matching Engine, same shape as the
  simulation lab's `attemptStats` (`enumerated`, `occupancyPruned`,
  `geographicallyPruned`, `routed`, `feasible`) — this is what lets you tell
  "nobody matched because nobody's in range" apart from "nobody matched
  because everyone hit their delay budget" in production, not just in the lab.
- Alerts on: Kafka consumer lag on `ride.match.requested`, DLQ depth > 0,
  `maxOptimizerCallsPerRun` / `maxRoutingCallsPerRun` budget exhaustion rate,
  commit-conflict rate (optimistic-lock retries) from §12, and offer-timeout
  rate (requests where no driver in the §11 broadcast accepted before the
  window closed) — that last one is a direct proxy for K/timer tuning being
  wrong, not just a driver-availability signal.

**Security:**

- JWT verification on every Core API and WS entry point; Matching Engine has
  no public entry point at all (Kafka consumer only, plus a `/healthz`).
  Redis ACLs scope Matching Engine to read-only on `h3:*`/`driver:*`.
- Google Maps Platform API keys are scoped per-service with separate usage
  caps, so a runaway Matching Engine bug can't exhaust Core API's routing
  quota or vice versa.
- Input validation via Zod at every service boundary (HTTP bodies, Kafka
  payloads via `packages/kafka-schemas`) — a malformed Kafka message should
  fail fast into the DLQ, not crash a consumer.
- Rate limiting (Redis token bucket) on ride-request creation per user/device
  to bound matching load from a single abusive client.

---

## 17. Open decisions carried forward

Still open, in rough priority order for what blocks LLD:

1. **Kafka partition count & retention per topic** — direct scaling-capacity
   decision for Matching Engine (§15); needs sizing against expected
   request/sec, not a guess.
2. **Offer broadcast shortlist size (K) and timers (3s / 15s)** — first-draft
   numbers in §11, not derived from anything yet. Needs tuning against actual
   driver acceptance-rate data: too small a K or too tight a timer window
   means good matches expire unaccepted; too generous and passengers wait
   longer than the matching computation itself took.
3. **Commit-conflict rate under load** — the optimistic-locking design in §12
   is a first draft; needs load testing to know how often stale-plan retries
   actually happen at realistic concurrent-request volumes, now compounded by
   the offer window in §11 giving _more_ time for a candidate's `baseVersion`
   to go stale before accept.
4. **Auto-accept-under-threshold policy for mid-trip insertions** — flagged as
   a product decision in §11, not an architecture one; needs an actual
   detour-delta threshold picked before driver-app UX can be finalized.
5. **H3 resolution benchmarking** — unchanged from prior work, still gates
   Stage 1/4 precision-recall tuning.
6. **Redis corridor diff/write-amplification strategy** — still open; now also
   the thing `driver.cell.changed` publishing frequency depends on.
7. **Method A/B routing threshold** — unchanged.
8. **Re-optimization throttling / proactive re-matching of pending requests**
   — explicitly deferred to Phase 2 in §13; needs its own design before it's
   built, not bolted onto `driver.cell.changed` as an afterthought.
9. **JWT signing key rotation cadence and KMS integration specifics** — the
   mechanism is designed in §5; the operational cadence isn't decided.
10. **DLQ alerting thresholds and retry/backoff policy per topic** — mechanism
    exists, specific numbers don't yet.
11. **Scoring weight calibration, pricing/surge modeling** — unchanged from
    prior work. The dynamic-pricing _sketch_ (§18) is planned/v2, not committed
    for v1 — the demand/supply → multiplier function specifically is a
    pricing-policy decision, not an architecture one, and is left unresolved
    on purpose.

---

## 18. v2 (Planned): Dynamic Pricing Module

**Status: planned, not committed for v1.** Fare calculation exists as a stub
in Core API (`modules/pricing/`, §7) for v1 — a straightforward
base + distance + time + sharing-discount formula. This section sketches how
_dynamic/surge_ pricing would plug into what's already built, without
inventing new infrastructure to do it.

### Why this needs almost no new infrastructure

Surge pricing needs one thing: a live demand/supply ratio per geographic area.
That already exists as a side effect of the matching architecture —
`h3:{cell}` sets already track drivers whose corridor touches a cell (§6.2),
and `RideRequest` creation already flows through `ride.lifecycle.events`
(§6.3). A pricing service doesn't need new spatial infrastructure, just a new
consumer reading events that already exist for a different reason.

### Design

```
ride.lifecycle.events (RideRequested)  ──┐
driver.cell.changed / online status   ───┼──▶ Pricing Service (new, small, stateless)
                                          │      every ~30–60s, per active H3 cell:
                                          │        demand = recent RideRequest count in cell
                                          │        supply = online driver count in cell
                                          │        multiplier = f(demand/supply)
                                          │      ▼
                                          │  Redis: surge:{h3Cell} = { multiplier, updatedAt }
                                          │      │
                                          └──────┴──▶ produce → pricing.surge.updated (h3Cell, multiplier)
```

Recomputing on a fixed interval rather than per-event is deliberate —
recomputing on every `RideRequested` would make fares visibly flicker for two
passengers requesting from the same pickup point seconds apart. A short,
steady interval keeps it responsive without that churn — the same instinct
behind not rewriting a driver's H3 cell on every GPS tick (§13): recompute on
a meaningful signal, not on every input.

### Where it plugs into the existing request flow

- **`POST /ride-requests`:** Core API reads `surge:{pickupCell}` from Redis to
  show a fare _estimate_ before matching even runs — one extra Redis read
  alongside what §10 already does at request time, no new call path.
- **Final fare uses real data, not the estimate.** Once `ride.match.candidates`
  (§11) returns a winning plan and the driver accepts, the final fare is
  computed from the actual route/time the solver returned. The surge
  multiplier applied is snapshotted at commit time onto the `Fare` row so it
  can't silently drift between quote and charge.
- **Sharing discount ties directly to Stage 10's output, not a naive equal
  split.** The pipeline already computes each pooled passenger's marginal
  insertion cost (`incrementalCost`, Stage 10 in the guide) — the
  Δdistance/Δtime specifically attributable to _that_ passenger's insertion.
  Per-passenger pricing should key off that number, not "total fare ÷
  passenger count" — same principle as the driver-earns-more / passengers-pay-
  less economics the product has always intended, now with an exact,
  already-computed number to price from instead of an approximation.

### New/changed data

| Table/field             | Change                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Fare`                  | + `surgeMultiplier`, + `marginalCostBasis` (the Stage-10 numbers the sharing discount was computed from) — both stored, not just the final number, so a disputed fare is auditable from the admin ride inspector (§14) |
| `PricingSnapshot` (new) | Per-ride audit record: demand, supply, multiplier, and per-passenger marginal cost at the moment the fare was finalized                                                                                                |

### New topic

| Topic                   | Key      | Producer        | Consumer                                       | Payload                             |
| ----------------------- | -------- | --------------- | ---------------------------------------------- | ----------------------------------- |
| `pricing.surge.updated` | `h3Cell` | Pricing Service | Core API (fare estimates), Admin web (heatmap) | `{ h3Cell, multiplier, updatedAt }` |

### Explicitly out of scope for this sketch

Surge _caps_ (regulatory/product limits on multiplier), driver-incentive
modeling, and the exact demand/supply → multiplier function are
pricing-policy decisions, not architecture — same treatment as scoring
weights in §17: config to be tuned against real data, not derived here.
