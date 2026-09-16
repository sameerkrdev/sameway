# Sameway — Phase 1 (MVP) Build Spec

**Status:** execution-ready spec. Not an implementation pass.
**Audience:** a coding agent or human about to build Phase 1 against this repo.
**Do not treat this file as authorization to resolve open questions.** Anything in §7 is a human decision. Anything in §7.1 is a load-bearing conflict: stop and get an answer before writing the affected code.

Related docs (do not duplicate their jobs):

| Job | Canonical file |
| --- | --- |
| How we build / invariants / anti-patterns / phases | `CLAUDE.md` |
| System/service design (HLD) | `docs/Overview.md` |
| Pipeline internals, code-accurate | `docs/MATCHING-STAGES-GUIDE.md` |
| Prior Q&A, treated as settled unless it conflicts with the repo | `docs/Architectural-Question.md` |
| This file — Phase 1 execution | `docs/BUILD-SPEC-phase-1.md` |

---

## 1. Mission

Phase 1 delivers a working Sameway MVP: a passenger can request a ride, the Matching Engine scores compatible idle and mid-trip drivers through the existing 14-stage pipeline (stages 0–13), Core API broadcasts a ranked shortlist to drivers over WebSocket with a staggered timer, the first successful accept commits through `Ride.version` optimistic locking, and both apps plus a thin admin web can complete that loop under **flat (non-surge) pricing** and **Google OAuth + RS256 JWT**. The matching math is not rewritten — it is lifted from `apps/simulation` into `packages/matching-core` and imported by both the lab and a new `apps/matching-engine`. This spec is the build order and definition of done for that work. It is not a license to invent architecture, pick numbers that `docs/Overview.md` §17 left open, or start Phase 2/3 items (dynamic pricing, proactive re-matching, ML).

---

## 2. Binding constraints

Restated from `CLAUDE.md` §1 and §12 so a builder does not have to reconstruct them. Changing any of these needs a written rationale, not a patch.

### 2.1 Architectural invariants

- **Two-service split stands.** Core API is synchronous and owns Postgres. Matching Engine is async, stateless, and Kafka-only. Neither service quietly grows a responsibility that belongs to the other.
- **Matching Engine has no database access — permanently.** It is a pure function of `(Kafka payload, read-only Redis, Google API responses) → result`. No Prisma client, no `DATABASE_URL`, no read replica.
- **Kafka carries durable, replayable facts and state transitions.** Raw GPS ticks and the sub-15s driver-accept race live in WebSocket + Redis, never Kafka.
- **H3 is a candidate funnel, never the final truth.** "Same H3 cell" is not "compatible" or "close." Routing and the road network decide that.
- **Cheap-to-expensive filter ordering is load-bearing.** Nothing calls `OptimizeTours` or the Routes API before the cheap geometric/eligibility filters have run. Do not reorder `DEFAULT_STAGE_ORDER` to "make production simpler."
- **Fairness scoring stays in-house.** Buy road-network math (routing, ETAs, feasible sequences). Never outsource *whose delay matters more* to Google's default cost model.
- **`matching-core` is one shared package.** `apps/simulation` and `apps/matching-engine` import the same implementation. A second copy of the pipeline is a regression.
- **Ride commits go through optimistic locking (`Ride.version`) — always.** Redis locks (`lock:ride:*`, `lock:driver:*`, `offer:{requestId}:claimed`) are a performance convenience around that, never a substitute.
- **Auth keys are asymmetric (RS256).** Only Core API's auth module may mint tokens. Any other service may verify via JWKS. Matching Engine does not mint.
- **Every hard rejection carries a stable reason code plus a value/threshold pair.** "It just didn't match" is not an acceptable failure mode.

### 2.2 Anti-patterns — do not reintroduce

- Matching Engine reading Postgres, including via a read replica.
- Raw GPS ticks published to Kafka.
- Flat parallel driver broadcast with no staggering (whoever taps first wins, regardless of score).
- Trusting a routing vendor's default cost model as the final "best route" without re-applying our hard constraints and scoring on top.
- Strict pickup-freeze on committed passengers ("no insertion ever before a committed pickup") — the delay-budget model replaced this.
- Full permutation generation for stop sequencing at any real scale — spine + insertion replaced this.
- A synchronous HTTP call chain for a matching decision (Core API waiting on Matching Engine over HTTP). Kafka exists specifically so `POST /ride-requests` can return `202` with `SEARCHING`.

### 2.3 Coding rules that apply to every Phase-1 task

- TypeScript strict, no implicit `any`. HTTP and Kafka boundaries validate with **Zod 4** immediately (`@repo/validator` already re-exports Zod 4.4.3).
- Prisma is the ORM. Raw SQL is an escape hatch for PostGIS/H3 queries Prisma cannot express, isolated in one repository function with a comment explaining why Prisma couldn't do it.
- Every tunable threshold lives in a `settings.ts`-style object. A number typed inline in business logic is a review blocker. Existing violation to fix on extraction: `CORRIDOR_RING_PADDING = 1` in `apps/simulation/src/matching/stages/h3RouteCorridor.ts`.
- Pipeline stages return typed result values (`{ pass, reasonCode?, value?, threshold? }` / the existing `DriverVerdict` contract), not thrown generic `Error`s that lose the why.
- Naming: Kafka topics `dot.case`; reason codes `UPPER_SNAKE_CASE`; Redis keys colon-namespaced (`driver:{id}`, `lock:ride:{rideId}`); files named for the module, not the ticket.
- `requestId` / `rideId` on every log line, trace span, and Kafka message header.
- Never log full JWTs, refresh tokens, or raw Google ID tokens.
- PII in Kafka payloads is a deliberate decision, not a default.
- Package manager for this repo is **Bun** (`bun.lock`, root `devEngines.packageManager` = bun `1.3.13`). Scripts already use `bun --watch` / `bun src/index.ts`. Do not introduce npm/yarn lockfiles or `npx`-only instructions. Expo native modules still install via `bunx expo install` (see `apps/captain/AGENTS.md`). See §7.1 for the HLD-vs-repo runtime conflict.

### 2.4 First-draft budgets — copy, do not invent

These already exist in `apps/simulation/src/domain/settings.ts` and `CLAUDE.md` §10. Phase 1 ships them as named constants. They are **not** validated against production data (`docs/Overview.md` §17). Changing a number is a one-line settings diff plus an update to the `CLAUDE.md` §10 table.

| Name | Current value | Notes |
| --- | --- | --- |
| `h3Resolution` | 9 | Open for Phase 2 benchmarking |
| `maxH3Ring` | 3 | |
| `minimumUsableCandidates` | 10 | |
| `maxPickupToRouteDistanceKm` | 1.5 | |
| `maxBearingDifferenceDeg` | 75 | |
| `estimatedSpeedKmh` | 24 | Straight-line ETA pre-filter only |
| `maxNewPassengerPickupDelayMin` | 8 | Also `DEFAULT_PASSENGER_DELAY_BUDGETS.maxPickupDelayMin` |
| `maxNewPassengerRideDetourMin` | 12 | |
| `maxExistingPassengerDelayPercent` | 50 | Also default `maxDropDelayPercent` |
| `maxPooledPassengers` | 4 | |
| `maxRoutedInsertionsPerDriver` | 6 | Shortlist size; **one** OptimizeTours call per driver |
| `maxOptimizerCallsPerRun` | 40 | |
| `maxRoutingCallsPerRun` | 150 | |
| `optimizerTimeoutMs` | 10_000 | |
| Scoring weights | driver 30 / existing 30 / new 25 / pickup 15 | Lower-is-better harm |
| Offer timers | 3s then #2..K; 15s window | First draft, HLD §11 |
| Match-result timeout | 20s proposal | HLD §10; not in `DEFAULT_SETTINGS` yet |
| Offer shortlist size `K` | **not specified** | Blocks offer-broadcaster implementation — see §7 |

Do **not** add a hint-retry loop around OptimizeTours in Phase 1. The lab explicitly does not retry hints #2–#6 (`MATCHING-STAGES-GUIDE.md` §23.3 / §23.8). "Fixing" that during extraction is a product/cost change, not a lift.

---

## 3. Repo map

### 3.1 HLD name → real folder

The HLD (`docs/Overview.md` §4) was written before this repo's folders existed. After inspecting the tree, the mapping is:

| HLD name | Real folder | Mapping OK? |
| --- | --- | --- |
| Core API | `apps/api` | Yes |
| Matching Engine | `apps/matching-engine` | Folder **does not exist**. Must be created. |
| Simulation lab | `apps/simulation` | Yes — this is the source of `matching-core` |
| Driver app (Expo) | `apps/captain` | Yes. Package name `"captain"`, scheme `captain`, Expo SDK 57. |
| Passenger app (Expo) | `apps/user` | Yes. Package name `"user"`, Expo SDK 57 (patch-skewed vs captain: `~57.0.13` vs `~57.0.14`). |
| Admin web | `apps/web` | Folder yes; **stack disagrees with HLD.** HLD §4/§14 says "React (Vite)". Repo is **Next.js 16.3.0** App Router (Turborepo starter). Do not scaffold a second Vite admin app. See §7.1. |

`CLAUDE.md` still refers to the HLD as `2026-09-09-platform-architecture-hld.md`. The file on disk is `docs/Overview.md`. Same document, renamed.

The prompt that generated this spec assumed `apps/api/src/routes/index.ts`. That file does not exist. The only route module is `apps/api/src/routes/users.ts`.

### 3.2 Already exists / still to build

#### Apps

| App | Already exists | Still to build for Phase 1 |
| --- | --- | --- |
| `apps/api` | Express 5.2.1 on Bun; CORS; JSON; morgan→`@repo/logger`; `/health`; Zod `validate` middleware; Prisma-backed stub CRUD at `/users`; error handler for Zod / Prisma / http-errors. **Broken as checked in:** `src/index.ts` imports `./env`, and **`src/env.ts` is missing.** No `modules/`, no Kafka, no Redis, no Socket.IO, no auth, no ride state machine. | Entire HLD §7 module tree. See §4.1. |
| `apps/matching-engine` | **Nothing.** | Greenfield worker: Kafka consumer/producer, read-only Redis corridor reader, `/healthz`, imports `matching-core`. See §4.2. |
| `apps/simulation` | Complete matching lab: 14 stages, stub optimizer, vitest harness (~40 test files), Vite UI, optimizer proxy. Pipeline is the production source of truth. | Extract `matching-core` / `h3` / `routing` and **rewire this app to import them**. Do not freeze a fork. Lab UI stays. |
| `apps/captain` | Expo Router 57 starter (Welcome to Expo). No Google Sign-In, GPS, offers, or ride UI. | Driver MVP screens + WS client. See §4.3. |
| `apps/user` | Same Expo starter as captain (near-duplicate). | Passenger MVP. See §4.4. |
| `apps/web` | Next.js 16 Turborepo hello page using `@repo/ui` Button stub. | Admin CRUD + live ride inspector. See §4.5. |

#### Packages — HLD §4 vs disk

| HLD package | Disk | State |
| --- | --- | --- |
| `packages/db` | Exists as `@repo/db` | Prisma **7.9.1** + `@prisma/adapter-pg` + `pg`. Schema is a stub `User { id Int, email, name? }`. Two migrations (`init` created User+Post; second dropped Post). **No PostGIS, no ride tables, no `version`.** |
| `packages/types` | **Missing** | Create, or decide it is unnecessary because matching-core domain + Prisma generate types. See §7. |
| `packages/kafka-schemas` | **Missing** | Create. Versioned Zod schemas per topic. |
| `packages/auth` | **Missing** | Create. Sign (API only) / verify / JWKS. |
| `packages/h3` | **Missing** | Lift from `apps/simulation/src/lib/h3.ts` (already the only `h3-js` import, ESLint-enforced). |
| `packages/routing` | **Missing** | Lift **interfaces** from simulation. **Rewrite** Google adapters — see §4.8. |
| `packages/matching-core` | **Missing** | Lift stages/engine from simulation. See §4.9. |
| `packages/config` | **Missing** | Shared env/settings surface. Do not duplicate `DEFAULT_SETTINGS` in three places. |
| `packages/ui` | Exists as `@repo/ui` | Turborepo stub (`Button` alerts "Hello from your {app} app"). Not an admin design system. |

Packages on disk that the HLD does not name — **keep and use**, do not replace:

| Package | Role |
| --- | --- |
| `@repo/validator` | Zod 4 re-export + `user` / `common` schemas. `idSchema` is **`z.coerce.number().int().positive()`** — this assumes Int PKs, which fights the simulation's string ids and likely fights UUID ride ids. See §7.1. |
| `@repo/logger` | **winston** 3.19. HLD §16 specifies **pino**. See §7.1. |
| `@repo/eslint-config` | Shared ESLint. Keep. |
| `@repo/typescript-config` | Shared tsconfig (`strict`, `ES2022`). Keep. |

#### Infra

| Path | Already exists | Gap |
| --- | --- | --- |
| `infra/docker-compose.yaml` | `postgres:17-alpine` as `sameway-db`, user/password/db `postgres/postgres/sameway`, named volume, healthcheck. Root scripts: `infra:up` / `infra:down`. | **No PostGIS** (plain `postgres:17-alpine` does not ship PostGIS). **No Redis. No Kafka/Redpanda.** HLD §6 and §15 require all three. |
| Deployment | None (no k8s/terraform). | Phase 1 local compose is in scope. Managed MSK/prod topology (HLD §15) is not a Phase 1 coding task. |

#### Tooling reality

- Root `package.json` workspaces: `apps/*`, `packages/*`. Turbo `2.10.10`. TypeScript `5.9.2`.
- `engines.node: ">=18"` is present, but **every runnable backend script is Bun**.
- There is **no** `packageManager` field in the npm Corepack sense; Bun is declared under `devEngines.packageManager`.
- Root `README.md` is still the **Turborepo starter README** (`npx create-turbo`, a `docs` app that does not exist). It does not describe Sameway. `apps/simulation/README.md` is the only accurate runbook, and it already uses `bun`.
- `AGENTS.md` at repo root is empty. `reference.md` is a list of Uber/Rapido/system-design links, not a build contract.
- `apps/api` has no tests. `apps/simulation` has the only test suite.

### 3.3 What matching-core should lift (inventory, not a rewrite)

Lift these from `apps/simulation` (they contain no React and, except as noted, no `google.maps`):

**Move into `packages/matching-core` (pipeline):**

- `src/matching/engine.ts`, `pipeline.ts`, `types.ts`, `reasons.ts`, `evaluation.ts`, `corridor.ts`, `occupancy.ts`, `delays.ts`, `delayBudget.ts`, `stops.ts`, `normalize.ts`
- `src/matching/stages/*` (all 14 stages in `STAGE_REGISTRY`)
- `src/matching/insertion/*`
- `src/domain/entities.ts`, `settings.ts` (settings may later re-export from `packages/config` — one source of truth, see §7)
- Scenario Zod in `src/domain/schemas.ts` can stay in the lab if it is serialization-only; domain types go with matching-core.

**Move into `packages/h3`:**

- `src/lib/h3.ts` (imports `latLngToCell`, `cellToLatLng`, `cellToBoundary`, `getHexagonEdgeLengthAvg`, `gridDisk`, `gridDiskDistances`, `gridDistance`, `polygonToCells` from `h3-js@^4.5.0`). Keep the ESLint `no-restricted-imports` rule: only this package may import `h3-js`.

**Move into `packages/routing` (interfaces + lab adapters):**

- `src/routing/types.ts`, `MockRoutingEngine.ts`, `InstrumentedRoutingEngine.ts`, `RoutingCache.ts`, `RoutingTelemetry.ts`, `src/routing/index.ts`
- `src/optimization/types.ts`, `InstrumentedOptimizerEngine.ts`, `OptimizerCache.ts`, `OptimizerTelemetry.ts`, `ShipmentModelBuilder.ts`, `SolutionReader.ts`, `src/optimization/index.ts`
- Test double: `src/test/fixtures/stubOptimizer.ts` travels with the package or the simulation harness — one copy.

**Do not lift as-is — these are lab/browser-shaped:**

| File | Why it cannot be production |
| --- | --- |
| `src/routing/GoogleRoutesEngine.ts` | Calls `google.maps.routes.Route.computeRoutes` / `RouteMatrix` in the **browser Maps JS SDK**. Matching Engine is a server. Production needs the REST Routes API (`POST https://routes.googleapis.com/directions/v2:computeRoutes`). Keep the `RoutingEngine` interface; write a new server adapter. |
| `src/routing/googleEngineFactory.ts` | `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` + `google.maps.importLibrary`. Lab-only. |
| `src/optimization/OptimizeToursEngine.ts` | `POST /api/optimize-tours` through the Vite proxy. Production calls `routeoptimization.googleapis.com` with ADC. Keep `OptimizerEngine`; write a new server adapter. |
| `server/optimizerProxy.ts` | Vite middleware. Lab-only. Matching Engine does not go through this proxy. |
| `src/lib/rideSketch.ts`, `applyRideSketch.ts`, map/UI stores, components | Lab UX. |

**Stage 13 (`commit.ts`) lift rule:** the lab stage **builds a `CommitPlan` for every surviving driver** and does not mutate the scenario. Production Matching Engine must keep that purity: emit ranked candidates with `stopPlan` + `baseVersion`. The **Postgres apply** lives in Core API's commit worker (`docs/Overview.md` §12), not in `matching-core`. Do not make Stage 13 write to Redis or Postgres.

**H3 stage production port:** `h3RouteCorridor.ts` today builds corridors from the **entire in-memory `scenario`**. Production cannot scan every driver. The stage (or a new `CorridorIndex` port behind it) must accept "rides/drivers already discovered for this pickup ring" from Redis. That port is required; its data contents collide with §7.1 Conflict A.

**Stay in `apps/simulation`:** React UI, Zustand stores, scenario presets/generator, map, Vite, optimizer proxy, `LocalMatchingService` (becomes a thin wrapper over `matching-core`). After extraction, `bun run test` in simulation must still pass against the shared package.

---

## 4. Service-by-service task breakdown

Definition of done is binary. "Implement auth" is not a task; the bullets below are.

### 4.1 `apps/api` — Core API

Scaffold is real but thin. Extend it; do not start a second Express app.

| ID | Task | Definition of done |
| --- | --- | --- |
| API-0 | Repair the broken entrypoint | `src/env.ts` exists (envalid, same pattern as `packages/db/src/env.ts`), `bun run check-types --filter=api` passes, `bun run dev --filter=api` listens and `/health` (or the chosen health path) returns 200. |
| API-1 | Auth module (`modules/auth/`) | `POST /auth/google` verifies a Google ID token, upserts `User`, issues RS256 access JWT (15 min, claims `sub`, `role` ∈ `PASSENGER\|DRIVER\|ADMIN`, `deviceId`, header `kid`) + opaque refresh (30d, SHA-256 in Postgres, hot cache in Redis). `POST /auth/refresh` rotates and implements reuse detection (replay of a used refresh revokes the **family**). `GET /.well-known/jwks.json` serves the public key(s). Private key never leaves this module. Tests: valid token verifies; expired rejected; reuse of rotated refresh revokes family; JWKS contains `kid`. No ID token or refresh plaintext in logs. |
| API-2 | Auth middleware | Every non-public HTTP route and the Socket.IO handshake require a valid access token. Unauthenticated → 401. Wrong `role` → 403. Public: health, JWKS, `POST /auth/google`, `POST /auth/refresh`. |
| API-3 | Users / drivers / vehicles modules | Authenticated CRUD matching HLD §6.1 fields (`googleSub`, `role`, `Driver.status` ∈ `ONLINE\|OFFLINE\|PAUSED\|BUSY`, `sharedRidesEnabled`, vehicle capabilities). `/users` email-stub either replaced or clearly test-only and not the product User. |
| API-4 | Ride request API | `POST /ride-requests` (JWT, passenger): Zod-validate (Stage-0-style cheap checks allowed here too), `INSERT RideRequest(status=SEARCHING)`, produce `ride.match.requested` with `requestId` key, respond **202** with the request id. Client is never blocked on matching. Rate-limited per user/device via `ratelimit:{userId}:{bucket}`. Cancel endpoint transitions to `CANCELLED` and does not leave a hanging SEARCHING row. |
| API-5 | Matching gateway — consume candidates | Consumer on `ride.match.candidates` (key `requestId`, ordered). Payload Zod-validated via `packages/kafka-schemas`. Malformed → DLQ, not a crashed consumer. If no candidates message within the configured timeout → `RideRequest` → `NO_DRIVER_FOUND` + WS notify. Message in `ride.match.requested.dlq` also fails the request to `NO_DRIVER_FOUND` (never silent hang). |
| API-6 | Offer broadcaster (HLD §11) | On `MATCHED`: WS notify candidate **#1 only** at t=0; if no accept, notify **#2..K** at t=3s; window ≤15s. **Not** a flat parallel blast. `K` is a named constant; its numeric value is an open question (§7) — do not invent it. Accept path: `SET offer:{requestId}:claimed {driverId} NX PX <ttl>`; loser gets instant WS reject, **no DB write**. Winner goes to API-7. Timeout with no accept → bounded requeue to `ride.match.requested` or `NO_DRIVER_FOUND` (HLD §10). Retract via WS to every other notified driver on success. |
| API-7 | Atomic commit worker (HLD §12) | After Redis claim: `SET lock:ride:{rideId} NX PX 5000` (or `lock:driver:{driverId}` for a new idle-driver ride). `UPDATE ride SET …, version=version+1 WHERE id=$rideId AND version=$baseVersion`. 0 rows → release claim, tell that driver "no longer available", **requeue** the original request (bounded retry), do not drop. Success: persist stops with restamped `originalEtaMin` from the plan, produce `ride.lifecycle.events` `DriverAssigned`, WS passenger + driver. Idle-driver create path uses `driver.currentRideId IS NULL` in the same transaction. **No code path updates stops without the version check** — including admin. |
| API-8 | Realtime gateway | Socket.IO on Core API, Redis adapter for multi-instance fan-out (not a second pub/sub system). Namespaces `/driver`, `/passenger`, `/admin` as HLD §9. Handshake auth = access token. GPS ticks (~4s) update `driver:{id}` hash only; **no Kafka per tick**. On H3 cell change: diff `h3:{cell}` sets, produce `driver.cell.changed`. Passenger room receives driver location + `SEARCHING`→`MATCHED` + route polyline. |
| API-9 | Location persistence | `LocationHistory` written asynchronously and sparsely (cell change and/or every N seconds — N is an open question). Never on every tick. |
| API-10 | Route-deviation re-route | Per `docs/Architectural-Question.md` item 3: persistent perpendicular deviation from the active polyline → Core API calls **Routes API** (not OptimizeTours) with current position + remaining stop sequence; replace `Ride.routeSnapshot`; reindex H3 corridor **in the same handler**; WS `ride.route.updated`. Debounced / consecutive-tick gated. Threshold metres is first-draft and open (§7). If the new route would blow a committed delay budget, do not silently accept — flag for review using Stage-11-style checks. |
| API-11 | Ride lifecycle HTTP + events | Pickup / drop / complete / cancel mutate `RideStop` / `RidePassenger` / `Ride` under the version lock, produce `ride.lifecycle.events` (`PassengerPickedUp`, `PassengerDropped`, `RideCompleted`, `RideCancelled`). WS updates both parties. |
| API-12 | Flat pricing stub | `modules/pricing/` computes fare from a documented base + distance + time + sharing-discount formula (**coefficients are an open question**). No surge. No `pricing.surge.updated`. Estimate may be returned at request time; final fare snapshotted onto `Fare` at commit. |
| API-13 | Payments / ratings / notifications (Phase-1 slice) | Schema for `Fare` / `Payment` / `Rating` exists. `POST` rating after `RideCompleted`. Notifications in Phase 1 = **WebSocket + in-app state**. SMS/push provider and card capture are open questions — do not silently add Stripe/FCM. `payment.events` topic only if a real payment worker exists; otherwise leave the topic catalog row unused rather than publishing fake completions. |
| API-14 | Admin API | Role `ADMIN` endpoints for users, drivers, vehicles, ride inspector (status, stops, last match reason codes / per-party impact from the stored plan), request replay metadata. Read-heavy; HLD mentions a replica for admin — Phase 1 may read primary, but **must not** take commit-path locks on inspector reads. |
| API-15 | Kafka / Redis clients | Producer/consumer wrappers using `packages/kafka-schemas`. Redis: Core API is the **only writer** of `driver:*`, `h3:*`, `lock:*`, `offer:*`, `ratelimit:*`. Matching Engine credentials are a **separate Redis ACL user**, read-only on `h3:*` and `driver:*` (and whatever extra keys Conflict A requires — not invented here). |
| API-16 | Observability | Structured logs with `requestId`/`rideId`. `traceparent` on Kafka headers. Alerts (at least logged metrics): consumer lag, DLQ depth, optimizer/routing budget exhaustion (from ME, consumed as metrics), commit-conflict rate, offer-timeout rate. |

### 4.2 `apps/matching-engine`

Greenfield. HLD §8 folder sketch is the layout to follow.

| ID | Task | Definition of done |
| --- | --- | --- |
| ME-0 | App scaffold | `apps/matching-engine` in the workspace, Bun + TypeScript strict, `package.json` scripts `dev`/`start`/`lint`/`check-types`. **No `@repo/db` dependency.** No `DATABASE_URL`. |
| ME-1 | HTTP surface | `/healthz` only (plus nothing else public). No ride CRUD. No token minting. |
| ME-2 | Consume `ride.match.requested` | Consumer group, payload Zod-validated, `requestId`/`rideId` in logs and headers. Poison message → `{topic}.dlq` after N retries with exponential backoff (N/backoff numbers are open — see §7; mechanism must exist). |
| ME-3 | Run `matching-core` | Same `DEFAULT_STAGE_ORDER` as the lab. Same `stubOptimizer` tests already passing in simulation before this wiring. Live path: production `OptimizerEngine` + `RoutingEngine` from `packages/routing`. |
| ME-4 | Redis corridor reader | Read-only client. Stage 1 discovery uses `h3:{cell}` / `driver:{id}` (and any additional keys a human chooses in Conflict A). ACL cannot `SET` locks or driver state. A test with a fake Redis proves a miss → `NOT_EVALUATED`, not `FAILED`. |
| ME-5 | Produce `ride.match.candidates` | Keyed by `requestId`. Payload: `status: MATCHED\|NO_MATCH`, **ranked array** (not a single winner) of `{ driverId, rideId?, stopPlan, baseVersion, score, perPartyImpact }`. Empty survivors → `NO_MATCH`, not a dropped message. |
| ME-6 | Funnel metrics | Per-stage pass/reject counts in the `attemptStats` shape (`enumerated`, `occupancyPruned`, `geographicallyPruned`, `routed`, `feasible`, plus stage-level counts). Budget exhaustion (`OPTIMIZER_BUDGET_EXCEEDED` / routing budget) is `NOT_EVALUATED`, never a silent fail. |
| ME-7 | Google credentials | Separate API key / quota from Core API (HLD §16). ADC / service account for OptimizeTours (`@googlemaps/routeoptimization` or equivalent REST). Routes REST uses its own key. Verify against current Google docs at implement time (see §8). |

Matching Engine **does not** apply commits, talk to drivers, or call Core API over HTTP.

### 4.3 `apps/captain` — driver app

Expo SDK 57, Expo Router, `src/app/` routes. Follow `apps/captain/AGENTS.md`: fetch Expo v57 docs before using APIs; `bunx expo install` for native modules; no hand-edited `ios/`/`android/`.

| ID | Task | Definition of done |
| --- | --- | --- |
| CAP-1 | Google Sign-In | Native Google sign-in yields an ID token; `POST /auth/google` with `role` intent DRIVER; store **refresh** securely, **access token in memory only**. Verify against current Expo 57 Google guidance at implement time (`@react-native-google-signin/google-signin` / `react-native-nitro-google-signin` are the current Expo-doc'd paths; `expo-auth-session` Google helpers are deprecated). Development build required once native modules land — document that. |
| CAP-2 | Online/offline/paused | Toggle writes driver status through HTTP; ONLINE starts GPS ticks over the `/driver` namespace. |
| CAP-3 | GPS broadcast | ~4s ticks over WebSocket, not HTTP polling, not Kafka. App survives brief disconnect and resumes. |
| CAP-4 | Offer UX | Incoming offer shows stop summary + countdown aligned with the 15s window. Accept/decline over WS. Retract removes the prompt immediately. Staggered arrival (#1 at 0s, others at 3s) is a server property — the app must tolerate being second. |
| CAP-5 | Active ride | Assigned stop sequence, pickup/drop actions, live status. Turn-by-turn via Maps SDK is in HLD §14; if Maps native setup blocks MVP, a stop-list + external-maps-link is acceptable **only if called out as a gap**, not silently dropped. |
| CAP-6 | Earnings view | Shows completed-ride fares from API (flat pricing). Empty state when none. |

Mid-trip auto-accept-under-threshold (`docs/Overview.md` §11 product policy) is **not decided**. Until a human picks it, the app must support an explicit accept prompt for every offer the server sends. Do not implement auto-accept locally.

### 4.4 `apps/user` — passenger app

Same Expo constraints as captain.

| ID | Task | Definition of done |
| --- | --- | --- |
| USR-1 | Google Sign-In | Same token pair flow, `role=PASSENGER`. |
| USR-2 | Request a ride | Pickup + drop (Places/autocomplete — lab already uses Places API New; reuse that Google product, not legacy Places). Seats, pooling opt-in, wait tolerance defaulting from `DEFAULT_PASSENGER_DELAY_BUDGETS`. Submit → 202 → UI shows **Searching…** without polling if WS is connected (poll only as reconnect fallback). |
| USR-3 | Match outcome | `MATCHED` push: driver + ETA + fare estimate. `NO_DRIVER_FOUND` / cancel: explicit states, not an infinite spinner. |
| USR-4 | Live map | Driver location + route polyline from WS. Other pooled stops "as appropriate" (HLD §14) — do not leak other passengers' PII (names/phones) in Phase 1 unless a human says otherwise. |
| USR-5 | Trip + rating | Onboard states follow `WAITING\|PICKED_UP\|IN_RIDE\|DROPPED`. After complete, rating prompt → `Rating` row. |
| USR-6 | Out of scope on this app | In-app chat/call (listed in HLD §14, **not** in `CLAUDE.md` §13 Phase 1). Deep-link payments beyond displaying a fare. |

### 4.5 `apps/web` — admin

Build inside the existing Next.js 16 app. Do not create `apps/admin-web`.

| ID | Task | Definition of done |
| --- | --- | --- |
| WEB-1 | Admin auth | Google OAuth or username via the same `POST /auth/google` with `role=ADMIN` (how a user becomes ADMIN is an open question — do not hardcode a backdoor without a documented bootstrap). |
| WEB-2 | Entity CRUD | Drivers, passengers, vehicles via Core API admin module. |
| WEB-3 | Live ride inspector | For a ride/request: status, stops, last reason codes and per-party impact — production-facing version of the lab funnel. This is how support answers "why wasn't I matched." |
| WEB-4 | Optional in Phase 1, not blocking MVP loop | H3 demand heatmap. Refunds/dispute tooling. Do not block matching on these. |

### 4.6 `packages/db`

| ID | Task | Definition of done |
| --- | --- | --- |
| DB-1 | Compose image can run PostGIS | `infra/docker-compose.yaml` uses a PostGIS image (plain `postgres:17-alpine` cannot). Initial migration `CREATE EXTENSION IF NOT EXISTS postgis;`. |
| DB-2 | Schema matches HLD §6.1 | `User`, `Driver`, `Vehicle`, `RideRequest`, `Ride` (**`version` integer, required**), `RidePassenger` (delay budgets), `RideStop`, `Fare`/`Payment`, `Rating`, `RefreshToken`, `LocationHistory`. Geo columns via Prisma `Unsupported("geometry(Point,4326)")` plus isolated raw SQL — **not** `Geometry(...)` native syntax; that Prisma feature is not in 7.9.1 (see §8). |
| DB-3 | IDs | One scheme, used by Prisma, Kafka keys, and `@repo/validator`. Today validator assumes `Int` and simulation uses `string`. **Human must pick** (§7.1). After the pick: migrate, update `idSchema`, update this spec's assumption. |
| DB-4 | Optimistic lock is expressible | A repository function that performs the version-conditioned `UPDATE` and returns whether a row moved. No other module inlines that SQL. |

`packages/db` is imported **only by Core API** (HLD §4). Matching Engine never depends on it.

### 4.7 `packages/kafka-schemas`

| ID | Task | Definition of done |
| --- | --- | --- |
| KS-1 | One Zod schema per Phase-1 topic, versioned | Topics: `ride.match.requested`, `ride.match.candidates`, `ride.lifecycle.events`, `driver.cell.changed`. `payment.events` only if API-13 actually produces it. **Not** `pricing.surge.updated` (Phase 2 / HLD §18). |
| KS-2 | Each topic has `{topic}.dlq` | Catalog row (update `docs/Overview.md` §6.3 in the same change) with key, producer, consumer(s), ordering requirement. |
| KS-3 | `ride.match.requested` is enough for ME to run | **Blocked on Conflict A.** Schema fields are not guessed here. After the human decides hydration, the schema is the snapshot of that decision. |
| KS-4 | Partition keys | `requestId` on match topics; `rideId` on lifecycle (and payment if present); `h3Cell` on `driver.cell.changed`. Do not key lifecycle by `requestId`. |

### 4.8 `packages/auth`, `packages/h3`, `packages/routing`, `packages/config`, `packages/types`, `packages/validator`, `packages/logger`, `packages/ui`

| ID | Task | Definition of done |
| --- | --- | --- |
| AUTH-1 | `packages/auth` | `signAccessToken` (private key, API-only), `verifyAccessToken` (public / JWKS), `hashRefreshToken`, JWKS JSON builder. Matching Engine may depend on **verify only**. Tests cover `kid` rotation overlap (old + new both in JWKS). Library: `jose` (verified current; works on Bun). |
| H3-1 | `packages/h3` | Lift `lib/h3.ts`. Same function names. Simulation ESLint restriction updated to the package. `h3-js` v4 names only (`latLngToCell`, not v3 `geoToH3`). |
| RT-1 | `packages/routing` interfaces | `RoutingEngine`, `OptimizerEngine` identical in contract to the lab (including `kind`, telemetry snapshots, budget errors). |
| RT-2 | Server Google adapters | New files, not a copy of `GoogleRoutesEngine` / `OptimizeToursEngine`. REST Routes + `@googlemaps/routeoptimization` (or REST `optimizeTours`) with ADC. Auth pattern verified at implement time (§8). Separate credentials from Core API. |
| RT-3 | Lab adapters remain | Mock + stub optimizer still used by tests. No test hits a live Google API (`CLAUDE.md` §7). |
| CFG-1 | `packages/config` | Named constants for offer timers, match timeout, Redis TTLs, rate limits, plus re-export or ownership of `DEFAULT_SETTINGS`. One place for `maxNewPassengerPickupDelayMin`. |
| TYP-1 | `packages/types` | Only if a human wants a package that is not `matching-core` domain + Prisma. Otherwise skip and document the skip in `docs/Overview.md` §4. |
| VAL-1 | `@repo/validator` | Ride/request/auth/admin schemas. ID schema matches DB-3. Keep Zod 4. |
| LOG-1 | `@repo/logger` | Continue logging. **Do not silently replace winston with pino** — Conflict C. Whichever stays must support JSON + `requestId`/`rideId` fields. |
| UI-1 | `@repo/ui` | Optional for admin. Do not block backend on replacing the stub Button. |

### 4.9 `packages/matching-core` + `apps/simulation` rewire

| ID | Task | Definition of done |
| --- | --- | --- |
| MC-1 | Package exists, simulation imports it | `apps/simulation` has **no remaining copy** of `engine.ts` / stages. `bun run test` in simulation passes. |
| MC-2 | Stage contract unchanged | `STAGE_REGISTRY` + `DEFAULT_STAGE_ORDER` unchanged. Corridor still runs before paid calls. |
| MC-3 | Corridor index port | In-memory implementation for the lab (current behavior). Redis implementation used only by Matching Engine. Lab tests do not need Redis. |
| MC-4 | Commit stage still pure | Builds plans; writes nothing. `e2e-scenario.test.ts` property "scenario is never written during a run" still holds. |
| MC-5 | Reason codes | Live codes stay emitted; reserved-but-unused codes in `reasons.ts` stay reserved (`MATCHING-STAGES-GUIDE.md` §23.10). Do not "clean them up" in Phase 1. |
| MC-6 | New reason codes | Any new hard-reject code ships with **two** tests: fail-path and pass-path at the exact boundary (`CLAUDE.md` §7). Funnel metrics include the new code. |

### 4.10 Infra (local Phase 1)

| ID | Task | Definition of done |
| --- | --- | --- |
| INF-1 | Compose | Postgres+PostGIS, Redis, Kafka-compatible broker (Redpanda is named in HLD §15 as an acceptable managed stand-in; local image choice is open but **something** must listen). `bun run infra:up` brings all three to healthy. |
| INF-2 | Redis ACL | Two users in dev compose if possible: `core` (readwrite on needed keys) and `matching` (read-only `h3:*` `driver:*`). If ACL in compose is too heavy for local, document the prod requirement and still use separate passwords; do not give Matching Engine a writeable Redis URL "for convenience." |
| INF-3 | Topics | All Phase-1 topics + DLQs created by a documented script or broker config. |

---

## 5. Build order

Do not start a layer before its dependencies exist. **Do not start API-6, ME-3 live path, or Kafka schema freeze until §7.1 Conflict A is answered.**

```
0. Human answers §7.1 (especially A, B, C, D) and the blocking product numbers (K, fare coefficients, match timeout).
1. INF-1, DB-1  →  PostGIS/Redis/broker actually run
2. DB-2, DB-3, DB-4, VAL-1  →  schema + Zod ids agree
3. CFG-1, H3-1, RT-1  →  settings + spatial + routing interfaces
4. MC-1 … MC-5  →  extract matching-core; simulation tests green
5. RT-2 (can overlap with 4; must exist before ME live Google path)
6. AUTH-1, KS-1 … KS-4  →  tokens + events
7. API-0 … API-3  →  Core API boots authenticated CRUD
8. API-8, API-9, API-15  →  Redis + WS + GPS/H3 index writes
9. ME-0 … ME-6  →  worker consumes request, produces candidates (stub Google in tests)
10. API-4, API-5, API-6, API-7, API-11  →  request → match → offer → commit loop
11. API-10, API-12, API-13, API-14, API-16
12. CAP-*, USR-*  →  clients on the loop
13. WEB-*  →  admin inspector
14. Docs: Overview §6.3 topic catalog, CLAUDE.md §10 table if any budget changed, this spec's repo-map "still to build" columns
```

`packages/matching-core` **before** `apps/matching-engine`. Simulation rewire **before** claiming the engine is shared. Clients **after** the WS/HTTP contracts exist (mocking the API in the app without a running Core API is allowed for UI iteration, but definition of done is against the real API).

---

## 6. Testing requirements

Per `CLAUDE.md` §7. No test in this repository may call a live Google API. Mock at the `OptimizerEngine` / `RoutingEngine` boundary (`StubOptimizerEngine` / `MockRoutingEngine`), not inside a stage.

### 6.1 `packages/matching-core` / `apps/simulation` (gate for every pipeline change)

Must stay green after extraction:

- Existing vitest suite (`apps/simulation`: `bun run test`). This is the canonical harness.
- Scenario immutability (`e2e-scenario.test.ts` — run does not write the scenario).
- One attributable failure per driver (`NOT_EVALUATED` after first fail).
- Corridor built from **remaining** stops only (Corridor Behind Vehicle preset / `corridor.test.ts`).
- Boundary tests for delay = budget exactly, not only comfortably under/over (`hardConstraints`, `pickupTimeWindow`, `delayBudget`).
- Optimizer budget exhaustion → `NOT_EVALUATED`.
- Stub optimizer honours precedence, capacity, skippable shipments.

Any new Stage-11 reason code: fail-path + exact-boundary pass-path.

**Do not** consider Matching Engine "done" if simulation tests were skipped or if a second pipeline was written inside `apps/matching-engine`.

### 6.2 `apps/api`

| Area | Must pass before merge |
| --- | --- |
| Auth | ID token → JWT; refresh rotation; reuse detection revokes family; JWKS `kid`; middleware 401/403 |
| Ride request | 202 + row `SEARCHING` + Kafka produce; validation errors 400 with Zod path; rate limit |
| Commit | Concurrent two accepts: one claim winner; version mismatch → 0-row → requeue; idle-driver `currentRideId IS NULL` guard; **stops never update without version** |
| Offer | #1 notified first; #2 not notified before 3s; retract reaches losers; loser accept after claim is rejected without DB write |
| GPS | Tick updates Redis hash; same-cell tick does **not** produce Kafka; cell change updates `h3:{cell}` and produces `driver.cell.changed` |
| DLQ | `ride.match.requested.dlq` handler sets `NO_DRIVER_FOUND` |

### 6.3 `apps/matching-engine`

| Area | Must pass |
| --- | --- |
| Contract | Fixture Kafka payload + fake Redis + stub optimizer → `ride.match.candidates` ranked list; `NO_MATCH` on empty survivors |
| Isolation | Test suite builds with no Prisma / no `DATABASE_URL` |
| Zod | Malformed payload → DLQ path, consumer stays up |
| Metrics | Funnel counts present on a successful run |

### 6.4 Clients

- Captain: sign-in, ONLINE + a mocked offer accept/retract, GPS permission denied is an explicit error.
- User: request → Searching → matched/no-driver fixtures.
- Web: admin-only routes unusable with a PASSENGER token.

If browser tools are unavailable in a later implementation pass, say so; do not claim client done from a screenshot of the Expo starter.

---

## 7. Open questions

Do not resolve these in code. A human answers; then this file and the owning doc (`Overview.md` §17 or `CLAUDE.md`) update in the same change.

### 7.1 Load-bearing conflicts (docs vs docs, or docs vs repo)

These are not naming mismatches. Building past them picks a side silently — which this spec forbids.

**Conflict A — Matching Engine cannot hydrate candidates from the written contracts (BLOCKING).**

- `docs/Overview.md` §6.3: `ride.match.requested` is the new request + passenger delay budgets + `baseVersion`. **Candidate driver/ride state is not in the message**; candidates come from Matching Engine's H3 Redis read.
- `docs/Overview.md` §6.2 Redis: `driver:{id}` is `lat,lng,h3Cell,status,vehicleId,currentRideId,lastSeenAt`. `h3:{cell}` is a set of ids. That is **not** a `matching-core` `Scenario` (stops, `originalEtaMin`, per-passenger delay budgets, vehicle capabilities, occupancy).
- `CLAUDE.md` §4: payloads for Matching Engine must be **self-contained snapshots**; "just fetch the rest from Postgres" is forbidden.
- `CLAUDE.md` §1: Matching Engine has **no database**.
- Lab Stage 1 builds corridors from the full in-memory scenario, then ring-searches. Production Stage 1 is supposed to look like a Redis lookup, but the pipeline after Stage 1 still needs ride snapshots.

Until a human chooses one of (at least) these, ME-3/ME-4/KS-3 cannot be implemented honestly:

1. Core API writes **full ride/driver/vehicle/passenger snapshots** into Redis (extra keys, still ME-read-only); Kafka stays request-only.
2. After H3 discovery inside Core API, Core API **embeds candidate snapshots** in `ride.match.requested` (moves H3 lookup toward Core API — tension with HLD §8).
3. Some other hydration path that still does not give Matching Engine Postgres.

Do not invent a fourth hybrid in the matching-engine code.

**Conflict B — Primary key types.**

- `@repo/validator` and Prisma `User.id` are `Int` autoincrement.
- Simulation domain ids are strings (`drv_…`, `ride_…`).
- Kafka keys and Redis keys want stable string ids.
- HLD §6.1 says `id` without a type.

Pick `Int` or UUID/cuid/string globally (or a documented split). Then migrate Prisma, validator, and this spec.

**Conflict C — Logger.**

- HLD §16: **pino**.
- Repo: `@repo/logger` is **winston** 3.19, already used by `apps/api`.

**Conflict D — Runtime.**

- HLD §3: **Node.js + Express**.
- Repo: **Bun** 1.3.13 (`bun.lock`, `bun --watch`, simulation README, captain/user AGENTS.md).
- This interacts with Kafka client choice (§8): `@confluentinc/kafka-javascript` is a **librdkafka native addon**; KafkaJS 2.2.4 is pure JS but unmaintained since 2023. Bun + native addons is not a settled fact in this repo.

**Conflict E — Admin web stack.**

- HLD: React + Vite, folder `admin-web`.
- Repo: Next.js 16 at `apps/web`.

This spec maps admin → `apps/web` and does not authorize a second app. Confirm.

**Conflict F — Prisma "already locked for simulation."**

- HLD §3: Prisma is "already locked for `apps/simulation` (Schema v2 + Zod migrator)."
- Reality: simulation has **no Prisma**. Zod migrator is for **scenario JSON**, not Postgres. Prisma lives only in `@repo/db` for the API stub.

**Conflict G — Proactive re-matching phase.**

- HLD §13 / §17.8: deferred to **Phase 2**.
- `CLAUDE.md` §13: **Phase 3**.

Out of Phase 1 either way. Still, the roadmap docs disagree — fix the docs, don't build it.

**Conflict H — Health path and Matching Engine "Express."**

- API today: `GET /health`.
- HLD Matching Engine: `/healthz`, drawn as Express/TS in the topology diagram, but "no public entry point (Kafka + `/healthz`)."

**Conflict I — Stage numbering across docs.**

- `MATCHING-STAGES-GUIDE.md`: Stage 0 request, Stage 1 H3, Stage 2 eligibility, … Stage 13 commit.
- `apps/simulation/README.md` still annotates Overview numbers that do not match the guide (`h3RouteCorridor (2)`, `basicEligibility (0)`, …).
- HLD §10 prose order matches the **execution** order (`DEFAULT_STAGE_ORDER`), not the old Overview numbers.
- `entities.ts` comments still say "the Overview's numbering."

Do not invent a 15th numbering scheme. When docs are edited, align comments to `DEFAULT_STAGE_ORDER` + the guide.

**Conflict J — Compose Postgres vs PostGIS.**

- HLD: PostgreSQL + PostGIS.
- `infra/docker-compose.yaml`: `postgres:17-alpine` **without** PostGIS.

### 7.2 Product / sizing questions already listed in HLD §17 (still open)

Do not fill these in with guesses. Phase 1 uses first-draft values **only where a number already exists** (table in §2.4).

1. Kafka partition count and retention per topic.
2. **Offer shortlist size `K`** — no number exists. **Blocks API-6.** Timers 3s/15s exist as first draft.
3. Commit-conflict rate under load (design is first draft; still implement the design).
4. Auto-accept-under-threshold for mid-trip insertions (detour-delta). Blocks captain UX finalization, not the prompt machinery.
5. H3 resolution benchmarking — keep 9.
6. Redis corridor diff / write-amplification strategy.
7. Method A/B routing threshold — keep current lab behavior; do not add a new threshold.
8. Re-optimization / proactive re-match — out of Phase 1 (see Conflict G).
9. JWT rotation cadence and KMS — mechanism in HLD §5; cadence open. Phase 1 can use a file/env private key, not KMS, if documented as non-prod.
10. DLQ retry count, backoff, alert thresholds — mechanism required; numbers open.
11. Scoring weight calibration — keep lab weights.
12. Driver-deviation distance (Architectural-Question item 3 proposes ~150–200m) and consecutive-tick count N.
13. `LocationHistory` sparse interval.
14. Fare formula coefficients (base, per-km, per-min, sharing discount).
15. How the first ADMIN user is created.
16. Whether Phase 1 includes a payment service provider or only `Fare` rows.
17. SMS/push provider vs WS-only notifications.
18. Whether idle drivers are indexed only in their current `h3:{cell}` or a disk of cells (lab idle corridor is the remaining-route polyline, which for idle is effectively "here").
19. Whether `packages/types` is created or skipped.
20. Whether `@repo/logger` stays winston.
21. Match-result timeout: HLD proposes 20s; not in `DEFAULT_SETTINGS`.
22. Expo Google library choice under SDK 57 (verify at implement time; Expo's own guide currently points at native Google Sign-In libraries, not AuthSession).
23. In-app chat/call — specified in HLD §14, not in Phase 1 roadmap. Treat as out of scope unless a human pulls it in.

---

## 8. Library-currency flags

Checked against live docs on 2026-09-16 where a lookup was possible. "Verified-current" means the **names and auth pattern** below still match published docs; implementers must still read the linked docs the day they code, especially Google pricing.

| Library / API | Pinned in repo? | Status | Notes for implementers |
| --- | --- | --- | --- |
| **h3-js** | `h3-js@^4.5.0` in `apps/simulation` | **Verified-current** | v4 names: `latLngToCell`, `cellToLatLng`, `cellToBoundary`, `gridDisk`, `gridDiskDistances`, `gridDistance`, `polygonToCells`, `getHexagonEdgeLengthAvg`. Do **not** use v3 `geoToH3` / `kRing`. v4.5.0 released 2026-07-01. Lift the existing wrapper; do not re-wrap from memory. |
| **Prisma** | `prisma` / `@prisma/client` / `@prisma/adapter-pg` **7.9.1** | **Verified-current (with caveat)** | Client is constructed with `PrismaPg` adapter (`packages/db/src/client.ts`) — keep this, it is Prisma 7's model. Native `Geometry(Point, 4326)` is **not** in 7.9.1 (unmerged PR `#29365`; GitHub issues report schema validation failure). Use `Unsupported("geometry(Point, 4326)")` + `$queryRaw` / `$executeRaw` in one repository module. Cast/select via `ST_AsText` / `ST_X`/`ST_Y`. Enable PostGIS in a migration, watch `search_path`. |
| **Zod** | `zod@^4.4.3` in `@repo/validator` and simulation | **Verified as pinned** | Use this instance via `@repo/validator`. Do not add Zod 3. |
| **Express** | `express@^5.2.1` in `apps/api` | **Pinned; verify Socket.IO attach at implement time** | Express 5 is already the API. Matching Engine may use a tiny HTTP server for `/healthz`; it does not need the full API stack. |
| **Socket.IO Redis adapter** | Not installed | **Verified-current pattern** | Official v4 docs: `socket.io` + `@socket.io/redis-adapter` + `createAdapter(pubClient, subClient)` with `redis` `createClient` (both connected) **or** ioredis. Adapter 7.x targets Socket.IO ≥4.3.1. Alternative `@socket.io/redis-streams-adapter` exists; HLD names the Redis adapter, not the streams adapter — do not switch silently. Confirm `redis` vs `ioredis` when adding the dependency. |
| **Google Route Optimization (`OptimizeTours`)** | Lab: custom Vite proxy + `google-auth-library` | **Verified-current** | Still `POST https://routeoptimization.googleapis.com/v1/projects/{id}:optimizeTours`. Auth: OAuth2 ADC / service account, scope `https://www.googleapis.com/auth/cloud-platform`, IAM `routeoptimization.locations.use` (role `roles/routeoptimization.editor`). **Not an API key.** Node client package: `@googlemaps/routeoptimization` (`RouteOptimizationClient.optimizeTours`). Lab already maps `precedenceRules` + `injectedFirstSolutionRoutes` in `optimizerProxy.ts` — preserve that contract in the server adapter. Sync `optimizeTours` is the right method for `optimizerTimeoutMs=10s`; `optimizeToursLongRunning` is for multi-minute jobs — do not switch. **Verify pricing SKU** at implement time: list currently distinguishes `RouteOptimization - SingleVehicleRouting` vs `FleetRouting`; lab sends **one vehicle per call**. |
| **Google Routes API** | Lab: Maps JS `Route.computeRoutes` | **Verified-current (server ≠ lab)** | REST: `POST https://routes.googleapis.com/directions/v2:computeRoutes`, field mask required, max **25** intermediate waypoints (already `MAX_INTERMEDIATE_WAYPOINTS`). Pricing is SKU-tiered (Essentials / Pro / Enterprise); traffic-aware and 11–25 waypoints bump SKU. Production Matching Engine must **not** use the browser Maps JS library. Core API live map and Expo maps are a separate Maps SDK key. Per-service keys as HLD §16. |
| **Google ID token verify** | Not installed | **Needs verification at implement time** | HLD: verify against Google's public certs. Common pattern: `google-auth-library` `OAuth2Client.verifyIdToken` **or** `jose.createRemoteJWKSet(https://www.googleapis.com/oauth2/v3/certs)`. Pick one, document it in `packages/auth`. |
| **jose (JWT RS256 / JWKS)** | Not installed | **Verified-current** | `SignJWT` / `jwtVerify` / `createLocalJWKSet` / `exportJWK`. Explicitly supports Bun. Prefer this over unmaintained `jsonwebtoken`+`jwks-rsa` unless a human says otherwise. |
| **Kafka client** | Not installed | **Needs a human pick + re-verify** | KafkaJS 2.2.4 last release 2023-02, unmaintained. `@confluentinc/kafka-javascript` is the currently maintained client (librdkafka, KafkaJS-compatible promisified API) but is a **native addon** — Bun compatibility is unproven in this repo. Do not add both. Consumer-group + header + DLQ must be expressible. |
| **Redis client** | Not installed | **Needs verification at implement time** | `redis` (node-redis) vs `ioredis`; Socket.IO adapter examples support both. ACL users as HLD §6.2. |
| **Expo 57 Google Sign-In** | Expo `~57.0.13/14` in apps | **Needs verification at implement time** | Expo v57 AuthSession Google helpers are **deprecated**. Current Expo guide: `react-native-nitro-google-signin` or `@react-native-google-signin/google-signin`, development builds, SHA-1. Fetch `https://docs.expo.dev/versions/v57.0.0/` and `https://docs.expo.dev/guides/google-authentication` the day you implement. |
| **Winston vs Pino** | winston 3.19 pinned | See Conflict C | HLD pino is **not** what the repo has. |
| **Next.js** | `next@16.3.0` in `apps/web` | Pinned | Admin builds here, not Vite. |
| **Bun** | 1.3.13 declared | Repo source of truth | See Conflict D. |
| **PostGIS Docker** | Not used | **Verified-current images** | `postgis/postgis:17-3.6` (or `17-3.6-alpine`). Volume path for 17.x remains `/var/lib/postgresql/data`. |

---

## 9. Explicitly out of scope (Phase 2 / 3)

Do not implement in this pass. Pointers so nobody re-derives them:

| Item | Where it already lives |
| --- | --- |
| Dynamic / surge pricing, `pricing.surge.updated`, `surge:{h3Cell}` | `docs/Overview.md` §18; `CLAUDE.md` §13 Phase 2 |
| H3 resolution benchmarking, K/timer tuning from real acceptance data, commit-conflict load study, DLQ threshold tuning, JWT cadence, Kafka partition sizing | `docs/Overview.md` §17; `CLAUDE.md` §13 Phase 2 |
| Proactive re-optimization of pending requests when a better driver appears | HLD §13/§17.8 (says Phase 2) vs `CLAUDE.md` §13 (says Phase 3) — **out of Phase 1 either way** |
| ML ETA / demand prediction | `CLAUDE.md` §13 Phase 3 |
| Driver-incentive modeling, surge caps / regulatory multiplier limits | HLD §18 "out of scope for this sketch"; Phase 3 |
| In-house multi-sequence search so scoring can rank Route 1/2/3 for one driver | Simulation README known limits; scoring.ts comment; Phase 3 |
| Hint-retry loop on OptimizeTours (hints #2–#6) | `MATCHING-STAGES-GUIDE.md` §23 — cost trade-off, not MVP |
| Self-hosted OSRM/Valhalla for cheap pruning | Architectural-Question item 5 — cost lever, not Phase 1 requirement |
| Replacing spine+insertion with full permutations | Anti-pattern graveyard |
| A second matching implementation inside Matching Engine | Invariant: one `matching-core` |

Phase 1 **does** include: solo dispatch, basic pooling insertion (the lab pipeline as specced), flat fare formula (coefficients TBD), Google OAuth + own JWT, core admin CRUD + ride inspector, 14-stage pipeline in production via shared package, staggered driver offers with first-draft timers (and a human-picked `K`).

---

## 10. Pre-implementation checklist (for the agent who executes this spec)

From `CLAUDE.md` §14, specialized to this spec:

1. Update the owning doc in the same change (`Overview.md` for topics/modules, `MATCHING-STAGES-GUIDE.md` only if a stage actually changes, `CLAUDE.md` §10 if a budget number changes, this file if a task's done-definition changes).
2. Matching Engine still has no DB. GPS still never hits Kafka.
3. New thresholds go in settings, including offer `K` once a human picks it.
4. New hard-rejects: reason code + value/threshold + funnel metric + two tests.
5. `matching-core` tests green in simulation **before** Matching Engine consumes a change.
6. If the idea is in §2.2, stop.

If Conflict A is still unanswered, the only safe workstreams are: INF/DB schema (except snapshot-shaped Kafka JSON), auth, extractor-to-simulation-rewire with the **in-memory** corridor port, and client shells against mocked APIs.
