# Sameway Phase 1 — Build Spec (MVP)

**Status:** execution-ready spec. Do not treat this as permission to invent
architecture. Where this file and the source-of-truth docs disagree, either the
disagreement is listed in [§7.2](#72-still-open) as open, or it has been decided
and the owning doc has been corrected — see the
[decision log](#71-decisions-made-do-not-re-litigate). This file does not carry
a decision the owning doc contradicts.

**Audience:** a human or coding agent opening the repo cold, about to implement
Phase 1.

**Source docs (read in this order before writing code):**

1. `CLAUDE.md` — Engineering Guardrails & Standards
2. `docs/Overview.md` — platform HLD
3. `docs/MATCHING-STAGES-GUIDE.md` — pipeline contract, code-accurate
4. `docs/Architectural-Question.md` — settled Q&A (do not re-litigate)
5. `AGENTS.md` — present, empty
6. `reference.md` — external links only (Uber/Rapido system-design videos)
7. `README.md` — still the generic Turborepo starter; not a Sameway runbook

**No application code has been written yet.** Six of the seven original
load-bearing conflicts are now answered and recorded in the
[decision log](#71-decisions-made-do-not-re-litigate) — runtime, Matching
Engine hydration, admin stack, validation package, logger and Socket.IO
adapter. What still gates work is **C6** and the product questions in
[§7.2](#72-still-open).

**Last audited against the repo: 2026-09-17.** Numbers, file counts and line
references in §3 are from that audit; re-check them before trusting one in a
review.

---

## 1. Mission

Phase 1 delivers a working Sameway MVP: a passenger can request a ride, the
Matching Engine runs the existing simulation pipeline (stages 0–13) against
live candidates, Core API broadcasts a ranked shortlist to drivers over
WebSocket, the first valid accept commits through `Ride.version` optimistic
locking, and the trip then proceeds with live location, stop sequence, a
flat (non-surge) fare, and a rating. Auth is Google sign-in plus Sameway's
own RS256 JWT. Admin web can inspect users, drivers, vehicles, and live
rides well enough to answer "why wasn't I matched" from reason codes. Solo
dispatch (idle driver) and basic pooling insertion (mid-trip, delay-budget
model) both ship. Dynamic pricing, proactive re-matching, ML, surge, and
driver-incentive modeling do not.

---

## 2. Binding constraints

Restated from `CLAUDE.md` so this file stands alone. Changing any of these
needs a written rationale, not a patch.

### 2.1 Architectural invariants (`CLAUDE.md` §1)

- **Two-service split stands.** Core API is synchronous and owns Postgres.
  Matching Engine is async, stateless, and Kafka-only. Neither service grows
  a responsibility that belongs to the other.
- **Matching Engine has no database access — permanently.** It is a pure
  function of `(Kafka payload, read-only Redis, Google API responses) →
  result`. No credentials, no read replica, no "just this one query."
- **Kafka carries durable, replayable facts and state transitions.** Raw GPS
  and the sub-15s driver-accept race live in WebSocket + Redis, never Kafka.
- **H3 is a candidate funnel, never the final truth.** Same cell ≠ compatible
  or close. Routing and the road network decide that.
- **Cheap-to-expensive filter ordering is load-bearing.** Nothing calls
  `OptimizeTours` or the Routes API before geometric/eligibility filters have
  already run.
- **Fairness scoring stays in-house.** Buy road-network math. Never outsource
  *whose delay matters more* to a vendor cost model.
- **`matching-core` is one shared package.** `apps/simulation` and
  `apps/matching-engine` import the same implementation. Forking them is a
  regression.
- **Ride commits go through optimistic locking (`Ride.version`) — always.**
  Redis locks are a performance convenience around that, never a substitute.
- **Auth keys are asymmetric (RS256).** Only Core API's auth module mints
  tokens. Any other service may verify via JWKS.
- **Every hard rejection carries a stable reason code plus a
  value/threshold pair.** "It just didn't match" is not an acceptable
  failure mode.

### 2.2 Anti-pattern graveyard (`CLAUDE.md` §13)

Do not reintroduce:

- Matching Engine reading Postgres, including via a read replica.
- Raw GPS ticks published to Kafka.
- Flat parallel driver broadcast with no staggering (whoever taps first
  wins, regardless of score).
- Trusting a routing vendor's default cost model as the final "best route"
  without re-applying our hard constraints and scoring on top.
- Strict pickup-freeze on committed passengers ("no insertion ever before a
  committed pickup") — replaced by the flexible delay-budget model.
- Full permutation generation for stop sequencing at any real scale —
  replaced by spine + insertion.
- A synchronous HTTP call chain for a matching decision.

### 2.3 Other rules that bind Phase 1

- TypeScript strict, no implicit `any`. Zod at every HTTP/Kafka boundary
  (`CLAUDE.md` §2).
- Prisma is the ORM. Raw SQL for PostGIS/H3 lives in one isolated repository
  function with a comment explaining why Prisma couldn't express it
  (`CLAUDE.md` §2).
- Config as code: every threshold in a `settings.ts`-style object
  (`CLAUDE.md` §2, §11). A number inline in business logic is a review
  blocker.
- Pipeline stages return typed results `{ pass, reasonCode?, value?,
  threshold? }`, they do not throw away the "why" (`CLAUDE.md` §2).
- Kafka client is `@confluentinc/kafka-javascript`, wrapped in
  `packages/kafka`. Services import the wrapper, not the raw client
  (`CLAUDE.md` §3.4, §5). It is a NAN/V8 native addon and **runs on Node
  only** — see the split-runtime rule below.
- New topic checklist: HLD §6.3 catalog row + versioned Zod schema in
  `packages/kafka-schemas` + partition key + DLQ with a defined consequence
  (`CLAUDE.md` §5).
- Payloads consumed by Matching Engine are self-contained snapshots. "Just
  fetch the rest from Postgres" is forbidden (`CLAUDE.md` §5). The
  `ride.match.requested` payload stays **lean** (request + passenger delay
  budgets + `baseVersion`); the candidate ride state ME needs on top of that
  comes from a read-only Redis `ride:{rideId}` snapshot — see
  [Appendix E](#appendix-e--redis-ride-snapshot-contract).
- `requestId` / `rideId` on every log line, trace span, and Kafka header
  (`CLAUDE.md` §9). Never log full JWTs, refresh tokens, or raw Google ID
  tokens (`CLAUDE.md` §10).
- Matching Engine public surface is Kafka + `/healthz` only (`CLAUDE.md`
  §10, HLD §16).
- Redis ACLs: Matching Engine is read-only on `h3:*` / `driver:*` / `ride:*`
  (HLD §6.2, §16). `ride:*` is the snapshot key pattern added by Appendix E.
  Extending the read scope is allowed; giving ME a write user is not, and it
  never holds `lock:*` or `offer:*`.
- Mobile UI: Expo UI SDK + NativeWind; consult `docs.expo.dev/llms.txt` and
  `nativewind.dev/llms.txt` at implementation time, not training data
  (`CLAUDE.md` §3.1). Add Expo native modules with `expo install`, not
  `bun add` (`CLAUDE.md` §3.3).
- Schema changes: `prisma migrate dev` / `prisma migrate deploy`, then
  `prisma generate`. Never hand-edit the generated client (`CLAUDE.md` §3.3).
- **Split runtime — this is a rule, not an accident.**
  - **Bun 1.3.13** is the package manager, the workspace/turbo runner, and the
    runtime for `apps/simulation` and every Vitest run. `bun.lock` is the only
    lockfile; there is no Corepack `packageManager` field. Do not assume
    npm/yarn conventions.
  - **Node ≥24** is the runtime for `apps/api` and `apps/matching-engine`,
    because `@confluentinc/kafka-javascript` is a NAN/V8 native addon that
    Confluent's maintainers state does not support Bun (missing bindings,
    `undefined symbol: v8::FunctionTemplate::SetClassName`, segfaults —
    confluent-kafka-javascript#264, oven-sh/bun#24258, #23756). An N-API
    migration exists as an unreleased PR; when it lands this rule can be
    revisited, not before.
  - Consequence: **no service that imports `@repo/kafka` may declare a `bun`
    run script.** `apps/api`'s `dev` script is `bun --watch src/index.ts`
    today and must change; `apps/api` also has no `build` script and needs
    one. How TS executes on Node for these two services is flag **L-Node**.

### 2.4 Settled Q&A — do not re-litigate (`docs/Architectural-Question.md`)

- Request path: `POST /ride-requests` → 202 `SEARCHING` → Kafka → pipeline
  → ranked `ride.match.candidates` → staggered WS offers → Redis claim →
  optimistic-lock commit.
- Fail-fast exits: no candidates within ~20s → `NO_DRIVER_FOUND`; offer
  window ≤15s with no accept → requeue / `NO_DRIVER_FOUND`; stale
  `version` → requeue, not drop.
- GPS: WebSocket + Redis is the hot path; Kafka only on H3 cell change.
- Driver deviation: Core API detects persistent off-polyline distance
  (~150–200m, N consecutive ticks), re-routes with **Routes API** (not
  `OptimizeTours`), diffs the H3 corridor, pushes `ride.route.updated` over
  WS, rate-limits recomputes. Escalation into Stage-11-style constraint
  checking if the new ETA blows a delay budget.
- Auth: Google ID token at login only; Sameway RS256 access + opaque
  rotating refresh thereafter; WS handshake uses the access token.

### 2.5 Explicitly out of scope (Phase 2 / 3)

Do not fold these into Phase 1. Pointers so nobody re-derives them:

| Item | Phase | Canonical home |
| --- | --- | --- |
| H3 resolution benchmarking | 2 | HLD §17 #5, `CLAUDE.md` §14 |
| Offer K / 3s / 15s tuning against real accept rates | 2 | HLD §17 #2, `CLAUDE.md` §14 |
| Commit-conflict rate under load | 2 | HLD §17 #3 |
| Kafka partition count & retention sizing | 2 | HLD §17 #1 |
| JWT key-rotation cadence / KMS runbook | 2 | HLD §17 #9 (mechanism is Phase 1) |
| DLQ alerting thresholds | 2 | HLD §17 #10 |
| Redis corridor write-amplification strategy (beyond a working first draft) | 2 | HLD §17 #6 |
| Method A/B routing threshold | 2 | HLD §17 #7 |
| Dynamic / surge pricing | 2 | HLD §18, `CLAUDE.md` §14 |
| Proactive re-optimization of pending requests when a better driver appears | 3 | HLD §13 / §17 #8, `CLAUDE.md` §14 |
| ML-assisted ETA / demand prediction | 3 | `CLAUDE.md` §14 |
| Driver-incentive modeling, surge caps, regulatory multiplier limits | 3 | HLD §18 "out of scope", `CLAUDE.md` §14 |

Phase 1 **does** ship the first-draft numbers in `settings.ts` (K, timers,
budgets in `CLAUDE.md` §11) as named constants. Tuning them against
production data is Phase 2, not a reason to omit the knobs.

---

## 3. Repo map

### 3.1 HLD name → real folder

The HLD (`docs/Overview.md` §4) was written before the repo existed. After
looking at the folders, **the mapping below is correct**. Do not also create
`apps/driver-app`, `apps/passenger-app`, or `apps/admin-web`.

| HLD name | Real folder | Notes |
| --- | --- | --- |
| Driver app (Expo) | `apps/captain` | Expo SDK 57 template. Product screens not built. |
| Passenger app (Expo) | `apps/user` | Same template as captain, slightly different Expo patch version. |
| Admin web | `apps/web` | Role and stack both settled: Next.js 16.3 App Router. The HLD has been corrected (§7.1 C3). |
| Core API | `apps/api` | Express 5 + a User CRUD scaffold. |
| Matching Engine | `apps/matching-engine` | Directory exists, **empty** (no `package.json`, no `src/`). |
| Simulation lab | `apps/simulation` | Real matching pipeline. Source of `matching-core`. |

`apps/docs` (mentioned in the stock README) does not exist. `AGENTS.md` at
repo root is empty, and `CLAUDE.md` imports it (`@AGENTS.md`) — so that import
currently contributes nothing. The live HLD is `docs/Overview.md`.

### 3.2 Runtime / tooling (verified against the repo)

| Item | Actual |
| --- | --- |
| Package manager | **Bun 1.3.13** (`devEngines`). `bun.lock` present. No `packageManager` field. |
| Service runtime | **Node ≥24** for `apps/api` + `apps/matching-engine` (§2.3 split-runtime rule). Root `engines.node` still says `>=18` and must be raised. Node 24.15.0 verified present on the dev machine. |
| Lab/test runtime | **Bun** for `apps/simulation` (`vite`, `vitest run`). |
| Monorepo | Turborepo (`turbo@^2.10.10`). Workspaces: `apps/*`, `packages/*`. |
| TypeScript | 5.9.2 root; Expo apps pin `typescript ~6.0.3` separately. |
| `turbo.json` tasks | `build`, `lint`, `check-types`, `dev`, `db:generate`, `db:migrate`, `db:deploy`. `globalEnv`: `DATABASE_URL`, `NODE_ENV`, `PORT`. **There is no `test` task, and no root `test` script** — see §6. |
| Lint quirk | `@repo/eslint-config` loads `eslint-plugin-only-warn`, which downgrades every rule to a warning. Paired with each package's `--max-warnings 0` the run still fails, but the mechanism is non-obvious — don't "fix" the plugin without understanding it. |
| Package generator | No `turbo/generators` for new packages. `packages/ui` has `generate:component` only. New packages will be hand-scaffolded unless a generator is added first. |
| README | Generic `create-turbo` text. Not a Sameway runbook. |

### 3.3 Already exists / still to build

#### Apps

| App | Exists | Completeness | Already there | Still to build |
| --- | --- | --- | --- | --- |
| `apps/api` | Yes | Partial scaffold — **4 files, 240 lines total** | Express 5 ESM, cors, morgan, Zod `validate` middleware (30), Prisma/Zod/HTTP error handler (110 — the most complete file in the backend), `GET /health`, User CRUD at `/users` (66), deps on `@repo/db`, `@repo/logger`, `@repo/validator`. Scripts: `bun --watch src/index.ts`. | `src/env.ts` is **imported by `index.ts` and missing on disk** — process cannot start. Recoverable verbatim: `git show 13940b3:apps/api/src/env.ts` (dotenv + envalid; both are still declared deps that nothing imports). No service/repository layer — routes call `prisma.user.*` directly. No auth, Kafka, Redis, Socket.IO, ride state machine, matching-gateway, pricing, payments, ratings, notifications, admin. No HLD §7 `modules/` tree. No `build` script, no tests, no Dockerfile. |
| `apps/matching-engine` | Dir only | **Zero files** | Nothing — no `package.json`, no `src/`, no subdirectories. It is **not a workspace member**, so the root `apps/*` glob picks up nothing. | Entire service: `package.json`, Kafka consumer/producer, Redis read-only corridor **and ride-snapshot** reader, `/healthz`, telemetry, imports of `matching-core` / `routing` / `h3` / `kafka` / `kafka-schemas` / `logger` / `config`. |
| `apps/simulation` | Yes | Real lab — **156 files, 21,038 lines** under `src/` + `server/` | 14-stage pipeline, 66 reason codes, stub optimizer, 34 Vitest files / 231 cases, Vite UI, `h3-js@^4.5.0`, Google Routes JS adapter, OptimizeTours Vite-dev-only proxy (`google-auth-library`, a **devDependency** here). **No Prisma.** | After lift: import `packages/matching-core`, `packages/h3`, `packages/routing` instead of in-app copies. Lab UI stays here. |
| `apps/captain` | Yes | **Untouched Expo template** | Expo Router, SDK ~57.0.14, `@expo/ui ~57.0.11` **installed and imported zero times**, StyleSheet screens. Only two routes: `/` (renders the literal string `Welcome to Expo`) and `/explore`. `scripts/reset-project.js` still present. No state lib, no API client, no map lib, no auth, no `@repo/*` dependency. | NativeWind, product screens (online toggle, GPS, offer accept, stops, earnings), Socket.IO client, API client, Google sign-in. |
| `apps/user` | Yes | **Untouched Expo template** | `diff -r apps/captain/src apps/user/src` is **byte-identical**. Differs only in `app.json` name/slug/scheme and 5 patch-level dep pins (Expo ~57.0.13 vs ~57.0.14). | NativeWind, request flow, SEARCHING, live map, fare, rating, Google sign-in. |
| `apps/web` | Yes | **Untouched `create-turbo` default** | Next.js 16.3 App Router, one route, CSS Modules + `next/font/local`, `@repo/ui` Button demo, page title literally `Create Next App`, Turborepo logo and a Vercel clone link. | Admin auth, CRUD, live ride inspector, funnel/reason-code view. **Next.js stays** — see §7 decision log. |

#### Packages — CLAUDE.md §3.2 taxonomy vs disk

| Package | CLAUDE / HLD | Disk | Status |
| --- | --- | --- | --- |
| `packages/db` | Required | `@repo/db` | Prisma **7.9.1** + `@prisma/adapter-pg` + `prisma.config.ts`. Schema is turbo-starter `User { id Int, email, name? }` only. Migrations: `20260816103250_init` (User+Post), `20260816104923_remove_post`. Image in compose is `postgres:17-alpine`, **not PostGIS**. |
| `packages/kafka` | Required (CLAUDE) | **Missing** | — |
| `packages/kafka-schemas` | Required | **Missing** | — |
| `packages/validator` | Required | `@repo/validator` | Zod 4.4.3, User HTTP DTOs + a `export * from "zod"` re-export so every consumer shares one Zod instance. `phoneSchema` and `paginationSchema` already exist and are used by no route. **`validator` is the canonical name** (`CLAUDE.md` §3.2 said `packages/validation` and has been corrected). |
| `packages/logger` | Required (pino + ID threading) | `@repo/logger` | **winston 3.19**, single console transport, custom `http` level existing only for morgan's stream, no `requestId`/`rideId`, reads `process.env.NODE_ENV` directly. **Swap to pino** — §9's ID-threading contract is the requirement; winston here is create-turbo leftover, not a decision. |
| `packages/auth` | Required | **Missing** | — |
| `packages/h3` | Required | **Missing** | Code to lift: `apps/simulation/src/lib/h3.ts` (sole `h3-js` import; v4 names already in use). |
| `packages/routing` | Required | **Missing** | Interfaces + instrumentation live under `apps/simulation/src/routing/` and `src/optimization/`. Browser Maps SDK adapter **cannot** be reused as-is for the engine. |
| `packages/matching-core` | Required | **Missing** | Pipeline still only in `apps/simulation/src/matching/`. |
| `packages/config` | Required | **Missing** | — |
| `packages/ui` | Required (Expo/NativeWind, only once duplicated) | `@repo/ui` | Turborepo **web** Button/Card/Code, 58 lines. React-**DOM** (`<button>`, `<a>`, `alert`) — **not consumable by the Expo apps as written**. Consumed by `apps/web` only. Do not dump captain/user components here preemptively; see UI-3. |
| `packages/types` | HLD §4 only; **not** in CLAUDE §3.2 | **Missing** | Still open — see §7.2 C6. |
| `packages/eslint-config` | Not in taxonomy (fine) | Present | Keep. |
| `packages/typescript-config` | Not in taxonomy (fine) | Present | Keep. Strict + `noUncheckedIndexedAccess`. |

#### Infra

| Piece | Disk | HLD expectation |
| --- | --- | --- |
| Postgres | `infra/docker-compose.yaml` — `postgres:17-alpine`, DB `sameway`, user/password `postgres` | PostgreSQL **+ PostGIS** |
| Redis | Not in compose. **`infra/redis/` does not exist** — no ACL file, no config | Redis + ACL users (API write, ME read-only `h3:*`/`driver:*`/`ride:*`) |
| Kafka | Not in compose. **`infra/scripts/` does not exist** — no `create-topics` script | Kafka/Redpanda + topics + `{topic}.dlq` |
| Env examples | `packages/db/.env.example`, `apps/simulation/.env.example`. Root/infra example not confirmed readable | Full stack env |

Root scripts already wrap compose: `infra:up` / `infra:down` / `db:migrate` /
`db:studio`. They only bring up Postgres today.

Branding mismatch (not architectural): git repo `shareway`, compose/DB
`sameway`, `packages/db/src/env.ts` example string says `shareway`.

---

## 4. Service-by-service task breakdown

Definition of done is what has to *pass*, not a vibe.

### 4.0 Shared packages (build these before the services that import them)

#### `packages/config`

| # | Task | Definition of done |
| --- | --- | --- |
| CFG-1 | Env loading for API / matching-engine / (optionally) web BFF | Each service imports a typed env object (envalid or equivalent). Missing required vars fail boot with a named error, not a later `undefined`. |
| CFG-2 | Host the **non-pipeline** settings that `CLAUDE.md` §11 lists as budgets once they are not pipeline-owned: offer `K`, `offerStaggerMs` (3s), `offerWindowMs` (15s), `matchResultTimeoutMs` (~20s), GPS tick interval, deviation threshold/N-ticks, `LocationHistory` sample policy | All are named constants with a comment on the trade-off. Changing a number is a one-line diff here **and** an update to the `CLAUDE.md` §11 table in the same PR. Pipeline budgets (`h3Resolution`, optimizer/routing caps, delay budgets, `maxPooledPassengers`) stay next to the pipeline — see MC-2. |

#### `packages/logger`

| # | Task | Definition of done |
| --- | --- | --- |
| LOG-0 | Replace winston with pino. Decide `morgan` + a `logger.http` shim vs `pino-http` and drop morgan | `apps/api/src/index.ts` compiles against the new export surface. The custom `http` level exists today only to feed morgan's stream — if `pino-http` wins, that level goes away with it. Level selection reads the typed env object (CFG-1), not `process.env` directly. |
| LOG-1 | Structured logger with `requestId` / `rideId` child bindings | A log line emitted inside a request context always includes those fields. No raw JWT / refresh / Google ID token ever appears (assert with a unit test on a redacting helper). |
| LOG-2 | Kafka header + HTTP middleware helpers to thread IDs | One helper used by API and matching-engine; IDs round-trip through a Kafka header name documented in `packages/kafka`. |

#### `packages/validator` (HTTP DTOs)

| # | Task | Definition of done |
| --- | --- | --- |
| VAL-1 | Zod schemas for Phase 1 HTTP DTOs: auth, ride-request create/cancel, driver status, vehicle, offer accept (if HTTP fallback exists; primary accept is WS), ratings, admin CRUD | Every `apps/api` route uses `validate()` (already written) against these schemas. No inline `z.object` in route files. |
| VAL-2 | Keep the existing User schemas until auth replaces the turbo User CRUD, then delete or replace them so we do not have two User shapes | `GET /users` either disappears or is admin-only and matches the HLD `User` model. |
| VAL-3 | Consume the already-written `phoneSchema` and `paginationSchema` from `schemas/common.ts` rather than writing new ones | Neither is referenced by any route today. Admin list endpoints (API-16) use `paginationSchema`; `User.phone` uses `phoneSchema`. |
| VAL-4 | Fix `validate()` for Express 5 | The middleware assigns parsed output back to `req.query`, which is a getter-only property in Express 5 — it silently no-ops or throws depending on strictness. Parsed values must go somewhere the handler actually reads. |

#### `packages/kafka-schemas`

| # | Task | Definition of done |
| --- | --- | --- |
| KS-1 | Versioned Zod schemas for Phase 1 topics in HLD §6.3: `ride.match.requested`, `ride.match.candidates`, `ride.lifecycle.events`, `driver.cell.changed`. `payment.events` only if PAY-1 is in scope (open question Q8) | Each schema has a `schemaVersion` field. Invalid payloads fail parse (typed error), never crash the consumer. |
| KS-2 | Catalog comment or sibling table: key, producer, consumer(s), ordering, DLQ topic name, DLQ consequence | Matches HLD §6.3. `ride.match.requested.dlq` consequence is `RideRequest → NO_DRIVER_FOUND` (`CLAUDE.md` §5). |
| KS-3 | **Do not ship** `pricing.surge.updated` in Phase 1 | Schema file absent. It belongs to HLD §18. |
| KS-4 | Versioned Zod schema for the **`ride:{rideId}` Redis snapshot** ([Appendix E](#appendix-e--redis-ride-snapshot-contract)), exported on its own subpath (proposed `@repo/kafka-schemas/snapshots`) | Core API's writer and Matching Engine's reader parse against the *same* schema object. A snapshot written by an older API version fails parse loudly at the reader, not silently as a missing field. Naming nit — the package now holds a Redis contract as well as Kafka ones; rename it later if that grates, but do not create a second contracts package. |

`ride.match.requested` stays **lean**: request + passenger delay budgets +
`baseVersion`, exactly as HLD §6.3 describes. Do not fatten it with candidate
driver/ride state — candidate discovery is Matching Engine's H3 read, and the
ride state behind each candidate is Appendix E's snapshot.

#### `packages/kafka`

| # | Task | Definition of done |
| --- | --- | --- |
| KFK-1 | Wrapper over `@confluentinc/kafka-javascript` **promisified** API (`KafkaJS` export): producer, consumer group, retry/backoff, DLQ publish | Services import `@repo/kafka`, never the raw package. Partition key is an explicit argument, never a silent default. |
| KFK-2 | Header helper for `requestId` / `rideId` / `traceparent` | Round-trip test with a fake broker or contract test: headers in ≡ headers out. |
| KFK-3 | Topic bootstrap for local compose (the missing `infra/scripts/create-topics.ts` — the whole `infra/scripts/` directory has to be created) | `infra:up` creates each Phase 1 topic **and** its `.dlq`. |
| KFK-4 | Node-only guard | A boot test asserts the native binding loads. Any package depending on `@repo/kafka` fails CI if its run scripts invoke `bun` (§2.3 split-runtime rule). |

Current client (verified 2026-09): v1.10.0, librdkafka 2.15.0. New code
should use:

```ts
import { KafkaJS } from "@confluentinc/kafka-javascript";
const { Kafka } = KafkaJS;
```

Config keys are librdkafka-style (`bootstrap.servers`, `group.id`), not the
older KafkaJS `brokers:` shape. Re-read
https://docs.confluent.io/kafka-clients/javascript/current/overview.html
at implementation time.

#### `packages/auth`

| # | Task | Definition of done |
| --- | --- | --- |
| AUTH-1 | RS256 sign (Core API only) + verify + JWKS document | A token minted by sign verifies with the JWKS verifier. A token with a wrong `kid` or expired `exp` fails typed. Private key never leaves the API auth module. |
| AUTH-2 | Access claims: `sub`, `role` (`PASSENGER` \| `DRIVER` \| `ADMIN`), `deviceId`; `kid` in header. TTL 15 min | Unit tests for each claim. |
| AUTH-3 | Refresh: opaque 256-bit, SHA-256 stored, 30-day TTL, rotate on use, reuse detection revokes the family | Presenting the previous refresh after rotation revokes the family; presenting a valid current one returns a new pair. |
| AUTH-4 | Google ID token verify helper (certs, audience, issuer) | Mocked cert path in tests; never hits live Google in CI. |

#### `packages/h3`

| # | Task | Definition of done |
| --- | --- | --- |
| H3-1 | Move `apps/simulation/src/lib/h3.ts` unchanged in behavior | Existing `apps/simulation/src/test/h3.test.ts` still passes after the import path change. Sole `h3-js` import in the monorepo (ESLint `no-restricted-imports` preserved). |
| H3-2 | Keep v4 method names already used: `latLngToCell`, `cellToLatLng`, `cellToBoundary`, `gridDisk`, `gridDiskDistances`, `gridDistance`, `polygonToCells`, `getHexagonEdgeLengthAvg` | Do **not** use v3 names (`geoToH3`, `kRing`). Pinned in simulation as `h3-js@^4.5.0`. |

#### `packages/routing`

| # | Task | Definition of done |
| --- | --- | --- |
| RT-1 | Lift `RoutingEngine` / `OptimizerEngine` interfaces, `InstrumentedRoutingEngine`, `InstrumentedOptimizerEngine`, caches, telemetry, `ShipmentModelBuilder`, `SolutionReader`, `MockRoutingEngine` | Simulation tests that mock at this boundary still pass (`stubOptimizer.ts` pattern). |
| RT-2 | **New** Node/server Google Routes adapter: `POST https://routes.googleapis.com/directions/v2:computeRoutes` with `X-Goog-FieldMask` and a **separate** API key from OptimizeTours (HLD §16) | Lab `GoogleRoutesEngine` talks to the **browser** Maps JS library (`Route.computeRoutes`). That file stays lab-only (or behind a browser factory). Production engine must not import `@vis.gl/react-google-maps` or `google.maps`. |
| RT-3 | **New** server OptimizeTours adapter: `POST https://routeoptimization.googleapis.com/v1/projects/{id}:optimizeTours`, ADC / service account, scope `https://www.googleapis.com/auth/cloud-platform`, IAM `routeoptimization.locations.use` | Lab proxy (`apps/simulation/server/optimizerProxy.ts`) stays Vite-only. Production does not go through Vite. Timeouts honour `optimizerTimeoutMs`. RFC 3339 whole-second timestamps (the proxy already documents Google's `nanos must be unset` constraint — preserve it). |
| RT-4 | Budget counters: `maxOptimizerCallsPerRun`, `maxRoutingCallsPerRun` | Exceeding a budget returns a typed result / reason code (`OPTIMIZER_BUDGET_EXCEEDED` already exists). Tests never call live Google (`CLAUDE.md` §8). Preserve the lab's ordering: cache is checked **before** the budget (a cached answer costs nothing), and the budget throws **before** the network call, never after. |
| RT-5 | `google-auth-library` becomes a real `dependency` of `packages/routing` | It is a `devDependency` of `apps/simulation` today — correct there, since the proxy is Vite-dev-only, but it means a production install would not have it. |
| RT-6 | Credentials via ADC / env only | Production must never resolve a service-account key path out of the repo tree. One is physically on disk today at `apps/simulation/.secret/sameway-ac-e9.json` (gitignored and untracked). The lab proxy's `loadEnv`-relative key resolution is lab-only behaviour and does not get lifted. |
| RT-7 | Preserve the three-way optimizer error taxonomy | `OptimizerCredentialsMissingError` aborts the whole run; `OptimizerBudgetExceededError` and generic call failures become per-driver `NOT_EVALUATED` — budget exhaustion is not an opinion about a driver. Losing this collapses "we couldn't afford to check" into "we checked and said no." |

#### `packages/db`

| # | Task | Definition of done |
| --- | --- | --- |
| DB-1 | Replace compose image with a PostGIS image; `CREATE EXTENSION postgis` in a Prisma migration | `\dx` shows PostGIS. Current `postgres:17-alpine` cannot store HLD §6.1 geo columns. |
| DB-2 | Prisma schema for HLD §6.1: `User` (googleSub, role, phone, timestamps; **UUID or cuid, not turbo `Int` PK**), `Driver`, `Vehicle`, `RideRequest`, `Ride` **with `version Int`**, `RidePassenger`, `RideStop`, `Fare` (flat formula fields; no `surgeMultiplier` in Phase 1), `Rating`, `RefreshToken`, `LocationHistory` | `prisma migrate dev` produces the SQL. `Ride.version` defaults to 0. Geo columns use Prisma's current PostGIS escape hatch — as of Prisma 7.8/7.9, native `Geometry(Point, 4326)` syntax is **not** actually shipping; use `Unsupported("geometry(Point, 4326)")` (or geography) plus `$queryRaw` / `$executeRaw` in one repository module. Re-verify at implementation (flag L-Prisma). |
| DB-3 | Optimistic-lock helper: `UPDATE … WHERE id = $id AND version = $baseVersion` returning row count | A second concurrent update with the same `baseVersion` returns 0 rows. Used by every ride-stop mutation, including admin (`CLAUDE.md` §6). |
| DB-4 | Retire turbo `User.email` uniqueness as the identity key; Google `googleSub` is unique | Old `/users` CRUD either updated or removed so it cannot create users without `googleSub`. |
| DB-5 | **Ride snapshot writer** ([Appendix E](#appendix-e--redis-ride-snapshot-contract)): every `Ride.version` bump republishes `ride:{rideId}` | Write happens in the same handler as the successful optimistic-locked commit, **after** it, never before. The snapshot carries its own `version` field so a reader can detect staleness; a failed snapshot write must not leave an older snapshot readable as current — it is deleted or version-stamped, and the failure is logged with `rideId`. |

Do not hand-write migration SQL Prisma can generate. **Do** hand-edit the
generated migration to insert `CREATE EXTENSION IF NOT EXISTS postgis;`
before the first geo column — Prisma will not emit that itself.

#### `packages/matching-core`

See §4.1. This is the load-bearing extract.

#### `packages/ui`

| # | Task | Definition of done |
| --- | --- | --- |
| UI-1 | Leave the web starter components for `apps/web` until admin needs more | No preemptive NativeWind library. Promote a component here only after it exists in **both** `apps/captain` and `apps/user` (`CLAUDE.md` §3.1). |
| UI-2 | Do not make `apps/web` consume NativeWind or Expo UI | HLD §14 / CLAUDE §3.1: admin is a separate React web app. |
| UI-3 | Decide where a *shared native* component would live, the first time one is genuinely duplicated | `@repo/ui` as it exists is React-DOM (`<button>`, `<a>`, `alert`) and owned by `apps/web` — captain/user cannot import it. When the trigger condition in `CLAUDE.md` §3.1 actually fires, the choice is "make `@repo/ui` platform-split" vs "add a sibling native package." Decide then, with a real duplicated component in hand — not now. |

---

### 4.1 `packages/matching-core` + `apps/simulation` lift

The production engine **imports this package**. It does not reimplement
stages.

**What to move (as-is behavior):**

| Path under `apps/simulation/src/` | Destination |
| --- | --- |
| `matching/**` (engine, pipeline, stages, reasons, types, evaluation, corridor, delayBudget, delays, occupancy, stops, normalize, insertion) | `packages/matching-core` |
| `domain/settings.ts` (`DEFAULT_SETTINGS`, `DEFAULT_STAGE_ORDER`, `DEFAULT_PASSENGER_DELAY_BUDGETS`, waypoint/matrix caps) | `packages/matching-core` (or `packages/config` **only if** matching-core re-exports the same objects — one source) |
| Pipeline-relevant types in `domain/entities.ts` (`Driver`, `Ride`, `RideRequest`, `Stop`, `Vehicle`, `MatchingSettings`, `StageId`, `LatLng`, …) | `matching-core` (or `packages/types` if C6 says so — one place) |
| `lib/geo.ts` (haversine, polyline, bearing; stages depend on it) | `matching-core` (geo is not H3 and not Google) |
| `lib/h3.ts` | `packages/h3` |
| `routing/**` interfaces + mock + instrumented | `packages/routing` |
| `optimization/**` (except Vite-only thoughts) | `packages/routing` (or `routing/optimizeTours`) |
| `test/fixtures/stubOptimizer.ts`, `runEngine.ts`, stage runners + the stage unit tests | Stay executable via `apps/simulation` (re-export) **or** move under `matching-core` and have simulation run them. Either way, `bun run --filter simulation test` must still be the gate (`CLAUDE.md` §8). |

**What stays in the lab:**

`components/**`, `stores/**`, `hooks/**`, `scenarios/**`, `lib/applyRideSketch.ts`,
`rideSketch.ts`, `ridePath.ts`, `services/LocalMatchingService.ts`,
`server/optimizerProxy.ts`, Vite app shell, map SDK wiring,
`googleEngineFactory.ts`.

**Stage count (do not "fix" this during the lift):** the code has **14**
stages in `DEFAULT_STAGE_ORDER` (requestValidation → … → commit). Docs say
"13-stage" and "Stages 0–13". That is the same list: 0 through 13 inclusive.
Keep all 14. Production **does not delete** `commitStage` — in the lab it
already only *builds* `CommitPlan`s and does not mutate the world
(`commit.ts`, `e2e-scenario.test.ts`). Core API is what applies a plan.
HLD §11's change ("publish the ranked survivor list instead of silently
picking #1") is a change to the **Matching Engine host**, not a deletion of
Stage 13.

**Production adapter the lift must introduce (do not silently invent
storage):**

Today Stage 1 (`h3RouteCorridor.ts`) builds corridors from the **entire
in-memory scenario**, then ring-searches that index. Production Stage 1 must
read Redis `h3:{cell}` (HLD §6.2) and only then hydrate discovered
drivers/rides. Idle drivers are a degenerate one-cell corridor
(`corridor.ts`).

**Hydration, resolved.** matching-core gets two **host ports** and talks to
neither Redis nor Kafka itself — that keeps the key layout out of the package:

| Port | Shape | Simulation implements it from | Matching Engine implements it from |
| --- | --- | --- | --- |
| `CorridorIndex` | cells → candidate driver/ride ids | the in-memory Zustand scenario | read-only Redis `h3:{cell}` |
| `RideSnapshotPort` | ride ids → ride snapshots (spine, per-passenger budgets, vehicle capacity, `version`) | the same scenario object | read-only Redis `ride:{rideId}` ([Appendix E](#appendix-e--redis-ride-snapshot-contract)) |

The driver's own position/status keeps coming from `driver:{id}`, unchanged.
Neither port may ever be backed by a Postgres client — that is the graveyard
entry, and it does not become acceptable because it is behind an interface.

`CORRIDOR_RING_PADDING = 1` is one of **eight** inline constants the lift must
deal with, not the only one — full list and the keep/move verdict for each is
[Appendix D](#appendix-d--inline-constant-registry).

Lab `Ride` has **no `version` field**. Production snapshots must carry
`baseVersion`. Add it on the matching-core `Ride` type as part of the lift
(default 0 in the lab so existing tests stay deterministic).

| # | Task | Definition of done |
| --- | --- | --- |
| MC-1 | Package exists; simulation imports it; **zero** duplicated stage files left under `apps/simulation/src/matching/` | `rg "from \"@/matching" apps/simulation` only hits the package or a thin re-export. |
| MC-2 | `DEFAULT_SETTINGS` lives in one module; `CLAUDE.md` §11 table matches it | Same numbers. |
| MC-3 | `bun run --filter simulation test` green **before** `apps/matching-engine` consumes the package | `CLAUDE.md` §8 / §15.5. |
| MC-4 | Host ports: `runMatching` takes a snapshot + `RoutingEngine` + `OptimizerEngine` + `CorridorIndex` + `RideSnapshotPort` | Matching Engine implements the two new ports from read-only Redis; simulation implements them from Zustand/JSON. A grep for `redis` inside `packages/matching-core` returns nothing. |
| MC-6 | Inline-constant registry ([Appendix D](#appendix-d--inline-constant-registry)) | Each of the eight constants is either moved into settings or kept with a comment saying which vendor limit it encodes. A number that is neither is a review blocker (`CLAUDE.md` §2). |
| MC-7 | Fix `STAGE_METADATA.incrementalCost.usesRouting` | It is `false` (`pipeline.ts:92`) while `incrementalCost.ts:175` issues a real `context.routing.getRoute(...)`. The lift must not carry the wrong value forward — it under-reports which stages spend routing budget. |
| MC-5 | Stage 12 scoring still ranks; Stage 13 still emits a `CommitPlan` per survivor | Matching Engine maps survivors → `ride.match.candidates` ranked array (`driverId`, `rideId?`, `stopPlan`, `baseVersion`, `score`, `perPartyImpact`). It does not auto-assign a driver. |

---

### 4.2 `apps/api` (Core API)

Keep the existing Express 5 app. Grow it into HLD §7; do not start a second
API. Fix `src/env.ts` first.

Suggested tree (HLD §7). Do not put Prisma calls in route handlers long-term
— repositories under `db/` / module folders.

```
apps/api/src/
  env.ts                 # missing today; required to boot
  index.ts               # already exists
  middleware/            # validate.ts, error-handler.ts already exist
  modules/
    auth/
    users/
    drivers/
    vehicles/
    rides/
    matching-gateway/    # Kafka matching topics, offer race, commit worker
    pricing/             # flat formula only
    payments/            # only if Q8 says yes
    ratings/
    notifications/
    admin/
  realtime/              # Socket.IO + Redis adapter
  kafka/                 # imports @repo/kafka
  redis/
  db/                    # @repo/db wrapper, isolated raw SQL
```

| # | Task | Definition of done |
| --- | --- | --- |
| API-0 | Restore `env.ts` (recoverable verbatim: `git show 13940b3:apps/api/src/env.ts`), move `dev`/`start` off `bun --watch` onto a Node runner, add the missing `build` script | `turbo run dev --filter api` listens on Node; `/health` returns `{ status: "ok" }`. Runner choice is flag **L-Node**. |
| API-1 | `POST /auth/google` (ID token) → upsert `User` → access+refresh | Verified with a mocked Google token. JWKS at `/.well-known/jwks.json` serves the public key. |
| API-2 | `POST /auth/refresh` rotation + reuse detection | Matches AUTH-3. |
| API-3 | JWT middleware on every non-public route; WS handshake `auth` payload uses the same access token (HLD §5, Architectural-Question §4) | Unauthenticated HTTP is 401. Expired token is 401 with a stable code, not a 500. |
| API-4 | Driver + vehicle CRUD (role-gated) | Driver `status` is `ONLINE` \| `OFFLINE` \| `PAUSED` \| `BUSY` as HLD §6.1. `sharedRidesEnabled` persisted. |
| API-5 | `POST /ride-requests` (JWT, passenger): Stage-0-style validation, `INSERT RideRequest status=SEARCHING`, produce `ride.match.requested`, **202 immediately** | Handler p95 without Kafka round-trip stays in the milliseconds. Client is never blocked on OptimizeTours. Zod at the boundary. Rate limit per user/device (Redis token bucket, HLD §16). |
| API-6 | Match-result timeout (~20s, named setting): mark `NO_DRIVER_FOUND`, WS notify passenger | Covered by a test with a fake clock / injected timeout. |
| API-7 | Consume `ride.match.candidates`; offer broadcaster: t=0 notify candidate #1; t=3s notify #2..K; t≤15s window (HLD §11) | K and timers from `packages/config`. **Not** a flat simultaneous broadcast (anti-pattern). |
| API-8 | Accept path: `SET offer:{requestId}:claimed {driverId} NX PX <ttl>` then commit worker | Losing driver gets WS reject, **no DB write**. Winner goes to API-9. |
| API-9 | Commit worker: Redis lock `lock:ride:{rideId}` or `lock:driver:{driverId}` (idle) **around** a transaction whose correctness is `UPDATE Ride SET …, version=version+1 WHERE version=$baseVersion`. Idle: `currentRideId IS NULL` in the same transaction that creates `Ride` | Stale version → 0 rows → release claim → requeue `ride.match.requested` with bounded retry count (HLD §12). Success → `ride.lifecycle.events` `DriverAssigned`, WS retract to other notified drivers, passenger+driver rooms updated. |
| API-9a | Publish the `ride:{rideId}` snapshot after every successful commit | Per DB-5. A commit that bumps `version` and does not republish the snapshot is a bug: Matching Engine would keep scoring against a spine that no longer exists. |
| API-10 | GPS ingest on `/driver` namespace, ~4s: write `driver:{id}` hash; **only on H3 cell change** diff corridor sets + produce `driver.cell.changed` | A tick that stays in-cell does not produce Kafka. `LocationHistory` written sparsely (cell change or every N seconds), never per tick (HLD §13). A cell change does **not** by itself invalidate the ride snapshot — only a `version` bump does. |
| API-11 | Deviation handler (Architectural-Question §3): N consecutive ticks beyond threshold → Routes API re-route of **remaining stops in the same order**, replace polyline, corridor diff, refresh the ride snapshot's route fields, WS `ride.route.updated`, rate limit | One `OptimizeTours` call here is a spec bug. If new ETAs exceed delay budgets, flag for review — do not silently accept. Thresholds in settings, not inline. |
| API-12 | Trip events: `PassengerPickedUp`, `PassengerDropped`, `RideCompleted`, `RideCancelled` on `ride.lifecycle.events` **and** WS | Cancelling does not leave offers hanging (retract + request status). |
| API-13 | Flat fare: base + distance + time + sharing discount. **No surge Redis read.** Snapshot the numbers onto `Fare` at commit | Formula constants in settings. HLD §18 sharing-discount-from-Stage-10 is v2; Phase 1 may use a simpler published formula **as long as it is documented in settings and is not surge**. If you use Stage 10 `incrementalCost` in Phase 1, that is allowed (the number already exists) but do not add `surgeMultiplier`. |
| API-14 | Ratings after `RideCompleted` | One rating row per direction needed in MVP (passenger→driver at minimum). |
| API-15 | Notifications consumer of `ride.lifecycle.events` | At least in-app WS; push/SMS may be stubbed with a logged no-op if no vendor is chosen (open question Q9). |
| API-16 | Admin HTTP for `apps/web`: users, drivers, vehicles, ride inspector (stops, version, reason codes / funnel from the last match if stored) | Admin role required. Support agent can answer "why wasn't I matched" from stored reason codes without reading source. |
| API-17 | Socket.IO namespaces `/driver`, `/passenger`, `/admin` with Redis adapter so two API processes can fan out | Verified with two Node processes or a documented adapter unit test. Adapter is `@socket.io/redis-adapter` (§7.1 C7) — supply connected pub + sub clients; do not also run the streams adapter. |
| API-18 | DLQ consumer for `ride.match.requested.dlq` → `NO_DRIVER_FOUND` | A poison payload cannot leave a passenger in `SEARCHING` forever. |
| API-19 | Delete or lock down the turbo `GET/POST /users` so it is not an unauthenticated user factory | Either gone or admin-authed and aligned with HLD `User`. |

Matching-gateway is the **only** module that talks matching Kafka topics and
the **only** module that touches `lock:ride:*`, `lock:driver:*`, `offer:*`.

---

### 4.3 `apps/matching-engine`

Empty folder today. This is a **new package/app**, not a clone of Core API.

HLD §8 tree is the target. Public HTTP: `/healthz` only (liveness; may check
Kafka connectivity without exposing internals).

| # | Task | Definition of done |
| --- | --- | --- |
| ME-1 | App boots with **no** `DATABASE_URL`. CI grep / boot test fails if a Prisma client is imported | Invariant. |
| ME-2 | Redis client is the ACL-restricted read user, scoped to `h3:*`, `driver:*`, `ride:*` | `SET` on any of the three fails. `lock:*` and `offer:*` are not readable at all. Patterns are listed explicitly in the ACL file, never granted by wildcard. |
| ME-3 | Consume `ride.match.requested` (key `requestId`), validate with `kafka-schemas`, hydrate via `CorridorIndex` + `RideSnapshotPort`, run `matching-core` | Malformed message → DLQ, not process crash. A snapshot that fails KS-4 parse, or is missing for a ride the corridor index pointed at, drops that **candidate** with a reason code — it does not fail the whole run. |
| ME-4 | Produce `ride.match.candidates` ranked array, key `requestId` | Shape per HLD §6.3 / §11. `NO_MATCH` when the funnel empties, with enough reason-code summary for Core API / admin. |
| ME-5 | Funnel metrics (`attemptStats`-shaped pass/reject counts per stage) | A run emits counts that can distinguish "nobody in range" from "everyone hit delay budget" (HLD §16). |
| ME-6 | Google keys used here are **not** Core API's Routes key (HLD §16) | Separate env vars. |
| ME-7 | `requestId` / `rideId` / `traceparent` on logs and outbound Kafka headers | Same IDs the API published. |
| ME-8 | Horizontal scale story: consumer group on `ride.match.requested` | Two instances do not double-process the same partition. |
| ME-9 | New `SYSTEM` reason code for an unreadable/stale ride snapshot (e.g. `RIDE_SNAPSHOT_UNAVAILABLE`) | Added to `matching-core`'s `reasons.ts` alongside the existing 66, carrying the ride id and the version it expected vs found. Per `CLAUDE.md` §8 it ships with both a fail-path and a pass-path test. Without this, a missing snapshot is indistinguishable from "no drivers nearby" in the funnel. |

Do **not** add an HTTP "match this request" endpoint. That is the
synchronous chain anti-pattern.

---

### 4.4 `apps/captain` (driver)

Expo Router app. Install native deps with `expo install`. Read
`docs.expo.dev/llms.txt` and `apps/captain/AGENTS.md` before UI work.
NativeWind version is flag L-NW (v4 stable vs v5 preview).

Starting point is the **untouched** `create-expo-app` template: two routes
(`/`, `/explore`), `StyleSheet.create` styling, `scripts/reset-project.js`
still in place, and `@expo/ui ~57.0.11` installed but imported zero times.
`apps/captain/CLAUDE.md` is a one-line `@AGENTS.md` import; `AGENTS.md` is the
stock Expo agent guide and says nothing Sameway-specific — it does not mention
NativeWind, the API, or the domain. Treat CAP-* as greenfield.

| # | Task | Definition of done |
| --- | --- | --- |
| CAP-1 | NativeWind wired (metro + CSS) per current NativeWind docs; `@expo/ui` actually used for primitives that fit (buttons, toggles, lists) | Template StyleSheet home screen replaced. `expo-doctor` clean for added modules. |
| CAP-2 | Google sign-in → `POST /auth/google` → store refresh securely, access in memory | Matches HLD §5. No access token in AsyncStorage if the HLD's "client memory only" is taken literally — confirm Q10. |
| CAP-3 | Online / offline / pause toggle → Core API + local UX | Offline driver is not in `h3:*` sets. |
| CAP-4 | GPS tick ~4s over Socket.IO `/driver` while ONLINE | Background/foreground behavior documented; do not invent a second GPS transport. |
| CAP-5 | Offer UI: ranked prompt with visible countdown, accept / decline | Accept goes WS (HLD §9). Decline is local+server so the stagger can proceed. Retract removes the card immediately. |
| CAP-6 | Assigned stop list after commit; map of remaining spine | Turn-by-turn via Maps SDK is in HLD §14; if Maps navigation SDK is too heavy for MVP, in-app stop list + external maps link must be an explicit Q11 answer, not a silent downgrade. |
| CAP-7 | Mid-trip insertion UX honouring Q4 (auto-accept vs prompt) | Until Q4 is answered, do not hard-code a policy. |
| CAP-8 | Earnings view for completed trips (flat fare share) | Reads Core API, not a client-side invention. |

Pin captain and user to the **same** Expo patch. Today they drift on five pins:
`expo` 57.0.14 / 57.0.13, `expo-constants` 57.0.12 / 57.0.11, `expo-router`
57.0.14 / 57.0.13, `expo-splash-screen` 57.0.7 / 57.0.6, `@types/react` 19.2.4 /
19.2.2. Their `src/` trees are otherwise **byte-identical** — whatever diverges
from here should diverge because the products differ, not because two installs
happened on different days.

---

### 4.5 `apps/user` (passenger)

Same stack rules as captain.

| # | Task | Definition of done |
| --- | --- | --- |
| USR-1 | NativeWind + Expo UI as CAP-1 | Same. |
| USR-2 | Google sign-in as CAP-2 | Same auth package contract. |
| USR-3 | Request flow: pickup, drop, seats, pooling flag, delay-budget defaults shown | `POST /ride-requests` then 202 → SEARCHING UI. No spinner that implies a synchronous match. |
| USR-4 | SEARCHING → MATCHED / NO_DRIVER_FOUND via WS | No polling loop as the primary path. |
| USR-5 | Live map: driver, polyline, ETA; other pooled stops "as appropriate" | Do not leak another passenger's PII (phone, exact home) over WS (CLAUDE §10). |
| USR-6 | Flat fare quote at request time + finalized fare after commit | Quote is not surge. |
| USR-7 | Cancel while SEARCHING / before pickup (policy in settings) | Kafka lifecycle `RideCancelled`; offers retracted. |
| USR-8 | Rating prompt after drop | Hits API-14. |
| USR-9 | In-app chat/call (HLD §14) | **Open question Q12.** Do not build a chat stack unless answered yes. |

---

### 4.6 `apps/web` (admin)

| # | Task | Definition of done |
| --- | --- | --- |
| WEB-1 | Admin login (Google + `role=ADMIN`, or an invite path — Q13) | Unauthenticated users cannot see ops data. |
| WEB-2 | Driver / passenger / vehicle lists and basic edits | Uses API-16. |
| WEB-3 | Live ride inspector: spine, versions, last match reason codes / funnel | This is the production cousin of the simulation RejectionPanel. |
| WEB-4 | Optional H3 heatmap reading `h3:{cell}` via API, not direct Redis from the browser | Nice-to-have inside Phase 1; do not block MVP if Q14 defers it. |

Do not consume NativeWind. **Stack is settled: Next.js 16.3 App Router stays**
(see §7's decision log) — the HLD's "React Vite" line is the doc that was
wrong, and it has been corrected. Starting point is the unmodified
`create-turbo` page: one route, CSS Modules, `next/font/local`, and a single
`@repo/ui` Button demo.

---

### 4.7 `infra/`

| # | Task | Definition of done |
| --- | --- | --- |
| INF-1 | Compose: PostGIS Postgres, Redis (with ACL file), Kafka-compatible broker (Redpanda is acceptable locally if topics/API are Kafka-compatible — Q15) | `bun run infra:up` yields healthy Postgres, Redis, Kafka. |
| INF-2 | Redis ACL users: `core-api` (write on documented key patterns) and `matching-engine` (read `h3:*`, `driver:*`, `ride:*`) | A ME-shaped client cannot `SET`, and cannot read `lock:*` / `offer:*` at all. |
| INF-3 | Topic + DLQ creation script | Idempotent. |
| INF-4 | `infra/.env.example` listing every required var without secrets | API, ME, simulation, db, broker, Redis, Google project/keys. |
| INF-5 | Create `infra/redis/` and `infra/scripts/` | Neither directory exists. INF-2's ACL file and INF-3's topic script have nowhere to live until they do. |
| INF-6 | Settle the `sameway` / `shareway` name split before it reaches a second environment | Git repo is `shareway`; compose container, DB name and `packages/db/.env` all say `sameway`. Cosmetic today, a migration once there is data anyone cares about. |

---

## 5. Build order

Do not start later layers before earlier ones have a passing definition of
done. The runtime, hydration, admin-stack, validation-package, logger and
Socket.IO-adapter conflicts are **answered** (§7 decision log); what still
gates work is C6 and the product questions.

```
0. turbo `test` task + root test script   (§6 — the gate has to exist first)
1. infra: PostGIS + Redis (ACL) + Kafka   (INF-*)
2. packages/config + logger (pino) + validator + db schema  (DB-*)
3. packages/auth
4. packages/h3  (lift lib/h3.ts; simulation tests still pass)
5. packages/routing  (interfaces + stubs first; live Google adapters behind env)
6. packages/matching-core lift  (MC-*); simulation test suite green
7. packages/kafka-schemas (incl. KS-4 snapshot) + packages/kafka
8. apps/api: env/boot on Node → auth → ride-request produce → redis GPS/corridor
9. ride-snapshot writer  (DB-5, API-9a) — ME has nothing real to read without it
10. apps/matching-engine host  (ME-*) consuming matching-core
11. apps/api matching-gateway: consume candidates, offers, commit  (API-7..9)
12. Socket.IO rooms + passenger/driver push  (API-17, 10–12)
13. Flat fare + ratings + admin HTTP
14. apps/captain + apps/user  (after NativeWind decision L-NW)
15. apps/web admin  (Next.js)
```

Hard dependency edges:

- `packages/db` and whatever owns Ride/Driver types **before** API ride
  modules.
- `matching-core` extract **before** `apps/matching-engine` imports it.
- `kafka-schemas` **before** either service produces a topic.
- Simulation tests green **before** production ME is considered done.
- Offer broadcast **after** candidates schema exists; commit **after**
  `Ride.version` exists.
- Ride-snapshot **schema** (KS-4) and **writer** (DB-5 / API-9a) before ME-3
  consumes anything real — without them the engine has an H3 index pointing at
  rides it cannot describe.
- Mobile GPS/offers **after** WS auth + `/driver` namespace exist.

---

## 6. Testing requirements per service

Canonical rules: `CLAUDE.md` §8 (testing), not §7 (that section is
real-time transport). Also §2 last bullet and §15.5.

**The gate does not exist yet.** `turbo.json` has no `test` task and the root
`package.json` has no `test` script. `bun run --filter simulation test` works
only because `apps/simulation` defines `test` itself. Since `CLAUDE.md` §8 makes
the simulation suite the merge gate for `matching-core`, adding the turbo task is
step 0 of §5, not cleanup.

### 6.1 `matching-core` / `apps/simulation` (gate for the whole MVP)

Existing harness to preserve — **34 test files, 231 cases, 43 `describe`
blocks**, `environment: "node"`, `include: src/test/**/*.test.ts`, fully offline
and deterministic (no network, no Google credentials). Note there are **no React
component tests** — the vitest config is node-only by design, so every UI/store
line in the lab is untested apart from `commitStore.test.ts` and
`applyRideSketch.test.ts`. That is acceptable for a lab; it is not a model for
production apps.

- Fixtures: `src/test/fixtures/stubOptimizer.ts`, `stubRouting.ts`,
  `runEngine.ts`, `runStages.ts`, `stageContext.ts`, `delhiScenario.ts`
- Tests already covering every stage plus insertion, occupancy, delays,
  corridor, shipment model, solution reader, optimizer stack, e2e Delhi
  scenario, schema migration, rng

Rules:

- **No test may call live Google.** Mock at `OptimizerEngine` /
  `RoutingEngine` (`CLAUDE.md` §8).
- A new hard-constraint reason code needs **two** tests: fail-path and
  pass-path at the exact boundary (e.g. delay = budget exactly).
- After the lift, `bun run --filter simulation test` is red-or-you-don't-
  merge for matching-core.
- Stage 13 remains "plan only"; e2e must still assert the scenario is not
  mutated inside `runMatching`.

### 6.2 `packages/auth`

- Sign/verify/JWKS, expiry, wrong kid
- Refresh rotation + reuse → family revoke
- Google verify with mocked certs

### 6.3 `packages/kafka` / `kafka-schemas`

- Schema reject of malformed payloads
- Header threading
- DLQ publish on parse failure (can be a fake producer)
- **Snapshot round-trip (KS-4):** the writer's output parses against the schema
  the reader uses; a snapshot whose `version` trails the row it describes is
  detectable as stale rather than silently accepted

### 6.4 `packages/db` / API commit path

- Optimistic lock: two commits, same `baseVersion`, exactly one succeeds
- Idle-driver create: two concurrent first-assigns, one `currentRideId`
- Redis claim NX: two accepts, one DB hit
- Stale plan requeue bounded

### 6.5 `apps/api`

- `POST /ride-requests` returns 202 without waiting for ME
- Timeout → `NO_DRIVER_FOUND`
- Unauthenticated ride-request → 401
- Rate-limit tripwire
- Deviation debounce (fake clock): one Routes call not N
- GPS in-cell tick produces **zero** Kafka messages

### 6.6 `apps/matching-engine`

- Boot fails closed without DB import
- Redis ACL cannot write, and cannot read `lock:*` / `offer:*` at all
  (integration against compose Redis)
- Golden snapshot: a recorded Kafka payload + seeded `ride:*` / `h3:*` / `driver:*`
  keys + stub optimizer → known `ride.match.candidates` JSON (this is the
  production twin of `runEngine.ts`)
- A corridor hit whose `ride:{rideId}` snapshot is missing drops that candidate
  with ME-9's reason code and leaves the rest of the run intact

### 6.7 Mobile / web

- No requirement for device farms in Phase 1
- Typecheck + lint (`expo lint`, `check-types`) must pass
- Auth token handling unit-tested where logic is non-trivial
- Admin pages: unauthenticated route guard

### 6.8 What "done" is not

A demo that matches in the simulation UI only. Phase 1 is done when a
passenger app request can be accepted by a captain app against local
compose (PostGIS + Redis + Kafka + stub or live Google behind env) and the
ride commits with `version = 1`.

---

## 7. Open questions & decision log

### 7.1 Decisions made (do not re-litigate)

Six of this spec's seven original load-bearing conflicts are answered. Each
resolution is now carried by the doc that owns the concern — the table below is
a pointer, not a second source of truth (`CLAUDE.md` §12).

| Was | Decision | Rationale | Now owned by |
| --- | --- | --- | --- |
| **C1** Bun vs `@confluentinc/kafka-javascript` | `apps/api` + `apps/matching-engine` run on **Node ≥24**. Bun stays package manager, workspace runner, and simulation/test runtime. | The Confluent client is a NAN/V8 native addon its maintainers state does not support Bun (missing bindings, `undefined symbol: v8::FunctionTemplate::SetClassName`, segfaults — confluent-kafka-javascript#264, oven-sh/bun#24258, #23756). Swapping the client instead would be a `CLAUDE.md` §1/§3.4 change needing its own written rationale; moving two services to Node is cheaper and reverts cleanly when the N-API migration ships. | §2.3 here; `CLAUDE.md` §3.2, §3.4 |
| **C2** Matching Engine hydration | Core API publishes a **read-only `ride:{rideId}` snapshot to Redis**; ME reads it through a `RideSnapshotPort`. `ride.match.requested` stays lean. | Keeps ME a pure function of `(payload, read-only Redis, Google) → result`; keeps the Kafka payload from carrying state Core API would have had to discover first (which would have moved H3 discovery into the API — a different architecture); keeps Postgres out of ME, which is the graveyard entry. Cost is write amplification on commit, tracked as an HLD §17 sizing item. | [Appendix E](#appendix-e--redis-ride-snapshot-contract); HLD §6.2, §8, §17 |
| **C3** Admin app stack | **Next.js 16.3 stays.** | The HLD's "React (Vite)" line was written before the repo existed. Replacing a working App Router scaffold to match a sentence is churn with no product value. Admin still does not consume NativeWind or Expo UI. | HLD §3, §4, §14 |
| **C4** `validation` vs `validator` | Package is **`packages/validator`** (`@repo/validator`). | It exists, `apps/api` imports it, and it owns the single shared Zod instance. `CLAUDE.md` §3.2 is the doc that was wrong. | `CLAUDE.md` §3.2 |
| **C5** Logger | **pino replaces winston.** | Unlike C3/C4, the repo is not the better answer here: §9's `requestId`/`rideId` threading is a hard requirement, and the winston setup is untouched create-turbo leftover with no ID plumbing at all. | LOG-0/1/2 here; `CLAUDE.md` §3.2 |
| **C7** Socket.IO adapter | **`@socket.io/redis-adapter`.** | The documented default; pub/sub-based, needs a connected pub + sub client pair. Do not also run `@socket.io/redis-streams-adapter`. | HLD §9; flag L-SIO |

### 7.2 Still open

**C6 is the only load-bearing conflict left.** Everything after it is a product
decision — do not invent a default in code.

#### C6 — `packages/types`

- HLD §4 lists it. CLAUDE §3.2 does not.
- Domain types today live in `apps/simulation/src/domain/entities.ts`.
- Decide whether matching-core owns them, or a separate `packages/types`,
  and whether API DTOs stay exclusively in the validator package.

### Product / scope questions (do not invent a default in code)

| ID | Question | Why it blocks |
| --- | --- | --- |
| Q4 | Auto-accept mid-trip insertions under a detour delta vs prompt every insertion? HLD §11 / §17 #4 | Captain UX and whether API-8 always waits on WS accept. |
| Q8 | Is payment *capture* (processor, `payment.events`, Payment worker) in Phase 1, or only a computed `Fare` row? | HLD §6.3 lists `payment.events`; Phase 1 text only promises flat pricing. |
| Q9 | Push/SMS vendor in Phase 1, or WS-only notifications? | API-15. |
| Q10 | Access token storage on Expo: memory only (HLD §5) vs secure store? | CAP-2 / USR-2. Memory-only dies on Android process kill. |
| Q11 | In-app turn-by-turn Maps Navigation SDK vs stop list + external maps? | CAP-6. |
| Q12 | In-app chat/call in Phase 1? HLD §14 lists it | USR-9. |
| Q13 | How does the first `ADMIN` user get that role? | WEB-1. |
| Q14 | Is the admin H3 heatmap Phase 1 or Phase 2? | WEB-4. |
| Q15 | Local broker: Apache Kafka, Redpanda, or Confluent Platform? | INF-1. Constrained by the C1 decision — whatever is picked must speak the protocol `@confluentinc/kafka-javascript` expects. |
| Q16 | Offer requeue vs `NO_DRIVER_FOUND` after the 15s window: HLD §11 says requeue wider search; Architectural-Question §1 says requeue/`NO_DRIVER_FOUND`. Bound? How many times? | API-6/API-9. |
| Q17 | Store matching funnel/reason codes on `RideRequest` for admin, or only in logs/metrics? | API-16 / WEB-3. CLAUDE §9 wants explainability; the HLD table does not add a column. |

### Doc / repo nits (not architecture, still fix in the same program of work)

- User-facing prompt text sometimes numbers the anti-pattern graveyard as
  §12 and the roadmap as §13; **live `CLAUDE.md` has graveyard as §13 and
  roadmap as §14**. This spec uses the live file.
- `apps/api/src/index.ts` imports `./env` but `env.ts` is missing (API-0).
- Expo patch drift between captain and user (§4.4).
- README is still `create-turbo`.
- DB name `sameway` vs repo `shareway` (INF-6).
- Lab `Ride` has no `version`; HLD commit path requires it (§4.1).
- Eight inline constants want a keep/move verdict ([Appendix D](#appendix-d--inline-constant-registry)).
- `STAGE_METADATA.incrementalCost.usesRouting` is stale (MC-7); the stage
  headers in `matching/stages/*.ts` still carry pre-reorder stage numbers.
- No `test` task in `turbo.json`, no root `test` script (§6).
- `validate()` assigns to `req.query`, which Express 5 exposes getter-only
  (VAL-4).
- Root `package.json` `engines.node` says `>=18`; the split-runtime rule needs
  `>=24`.
- A service-account key sits at `apps/simulation/.secret/sameway-ac-e9.json`
  — gitignored and untracked, but on disk (RT-6).

---

## 8. Library-currency flags

Checked during this spec pass (2026-09-17). Re-check at implementation;
do not treat training data as current.

| ID | Library / API | Status | What we verified | Before implementing |
| --- | --- | --- | --- | --- |
| L-h3 | `h3-js` | **Verified against repo pin** | Simulation pins `^4.5.0`. Code already uses v4 names (`latLngToCell`, `gridDisk`, `gridDiskDistances`, …). v3 names are wrong. | Keep the pin; do not "upgrade" to a different major without tests. |
| L-kafka | `@confluentinc/kafka-javascript` | **Verified current docs; unblocked — Node-only** | Latest npm 1.10.0 / librdkafka 2.15.0. Promisified API via `.KafkaJS`. Config is `bootstrap.servers`. | Re-read the Confluent JS client overview. Runtime is settled (Node, §2.3); re-verify the API shape, which has moved more than once. |
| L-Node | Node 24 TypeScript execution | **Needs a human pick** | Node 24.15.0 present on the dev machine. Three viable routes for `apps/api` / `apps/matching-engine`: `tsx` watch, Node's native type stripping (`--experimental-strip-types`, which rejects TS-only syntax like enums and parameter properties), or a plain `tsc` build with `node dist/`. Each has a different dev/prod story. | Pick one the day API-0 is written and apply it to **both** services. Check whether any lifted `matching-core` code uses syntax native stripping refuses before choosing that route. |
| L-expo | Expo SDK 57 + `@expo/ui` | **Verified llms.txt + SDK UI page** | `docs.expo.dev/llms.txt` (fetched). `@expo/ui` is Jetpack Compose / SwiftUI **Host** components, plus a smaller Universal set — not a general RN design system. Captain/user already depend on `@expo/ui ~57.0.11` unused. Use `expo install`. CNG: do not hand-edit `ios/`/`android/`. | Re-fetch `https://docs.expo.dev/llms.txt` and `https://docs.expo.dev/versions/v57.0.0/sdk/ui.md` when writing screens. |
| L-NW | NativeWind | **Needs a human version pick** | `nativewind.dev/llms.txt` currently presents **v4.2.7 stable on Tailwind v3**. v5 is preview (Tailwind v4.1+, `react-native-css`, Metro `withNativewind`). Neither captain nor user has NativeWind installed. Simulation web uses Tailwind **v4.3.3** (unrelated to RN). | Re-fetch `https://nativewind.dev/llms.txt`. Confirm Expo 57 compatibility for the chosen major. Use `expo install`. |
| L-Prisma | Prisma 7.9.1 PostGIS | **Verified current limitation** | Repo already on Prisma 7 + driver adapter (`PrismaPg`). Official docs: no first-class PostGIS; use `Unsupported("geometry…")` + `$queryRaw`. GitHub prisma#29566: `Geometry(Point, 4326)` native syntax is **not** merged as of 7.8. | Re-read Prisma 7 raw-SQL / Unsupported docs the day you write DB-2. Put `CREATE EXTENSION postgis` in the migration by hand. |
| L-SIO | Socket.IO Redis adapter | **Verified current setup; flavour settled** | `@socket.io/redis-adapter` v7+: you supply connected pub+sub `redis` clients. Streams adapter is a separate package and is **not** used. Sticky sessions still required for polling. | Copy from current Socket.IO docs, not from memory of `socket.io-redis`. |
| L-G-RO | Google Route Optimization `optimizeTours` | **Verified current REST/auth** | `POST https://routeoptimization.googleapis.com/v1/projects/{id}:optimizeTours`. OAuth ADC, scope `cloud-platform`, IAM `routeoptimization.locations.use` / role `roles/routeoptimization.editor`. Sync `optimizeTours` is the blocking method the lab already models. Google recommends gRPC in production for perf — **whether Phase 1 uses REST (like the lab proxy) or gRPC is not decided in the HLD.** | Re-read "Make your first Route Optimization request." Preserve whole-second timestamps. Separate quota/key from Core API. |
| L-G-Routes | Google Routes API `computeRoutes` | **Verified current REST** | `POST https://routes.googleapis.com/directions/v2:computeRoutes`. API key via `X-Goog-Api-Key` **and/or** OAuth. **Field mask required** (`X-Goog-FieldMask`). Max 25 intermediate waypoints (already `MAX_INTERMEDIATE_WAYPOINTS` in lab). Billing SKUs Essentials/Pro/Enterprise depend on requested features — field mask is a cost control. Lab browser adapter uses Maps JS `Route.computeRoutes` because Directions/Distance Matrix went legacy 2025-03-01. Production server adapter should be REST, not Maps JS. | Re-read Routes usage/billing so the field mask does not accidentally bill Enterprise. |
| L-G-Auth-login | Google OAuth ID tokens | **Needs verification at impl** | HLD §5: Expo native sign-in → ID token → `POST /auth/google`. Token verify against Google certs. | Use current Google Identity / Expo AuthSession docs; pin client IDs per platform. |
| L-Express | Express 5.2.x | **Verified as repo pin** | `apps/api` already on Express 5. Stay. | Don't "downgrade to 4" from habit. |
| L-Zod | Zod 4.4.x | **Verified as repo pin** | `@repo/validator` already re-exports Zod 4. | Don't mix Zod 3. |
| L-Pino | pino | **Required; needs verification at implementation** | Not in the repo today — `packages/logger` is winston. | Current pino + pino-http + ALS/`AsyncLocalStorage` recipes on the day of LOG-0/LOG-1. |
| L-Redis-ACL | Redis ACL | **Needs verification** | HLD wants a second user, read-only key patterns. Compose has no Redis yet. | Redis 7+ ACL file syntax (`user … on ~h3:* ~driver:* +get +…`) against the image you pin. |
| L-Expo-maps / location / secure-store / google-sign-in | various Expo modules | **Needs verification** | Not installed. | `expo install` each; SDK 57 compatibility matrix; development build (not Expo Go) once native modules exceed Go's bundle. |
| L-Confluent-SR | Schema Registry | **Needs verification** | CLAUDE §3.3 says use the client's / SR tooling to validate schemas. HLD stores contracts as Zod in-repo, not necessarily Confluent SR. | Human: Zod-in-repo vs SR. Don't stand up SR "because Kafka." |

---

## Appendix A — matching-core file inventory (lift list)

From `apps/simulation/src/matching/` (all 28 files):

`engine.ts`, `pipeline.ts`, `reasons.ts`, `types.ts`, `evaluation.ts`,
`corridor.ts`, `delayBudget.ts`, `delays.ts`, `occupancy.ts`, `stops.ts`,
`normalize.ts`, `insertion/enumerate.ts`, `insertion/index.ts`,
`stages/index.ts`, `stages/requestValidation.ts`,
`stages/h3RouteCorridor.ts`, `stages/basicEligibility.ts`,
`stages/operationalState.ts`, `stages/pickupRouteDistance.ts`,
`stages/directionCompatibility.ts`, `stages/stopSequenceGeneration.ts`,
`stages/pickupTimeWindow.ts`, `stages/detourLowerBound.ts`,
`stages/roadRouting.ts`, `stages/incrementalCost.ts`,
`stages/hardConstraints.ts`, `stages/scoring.ts`, `stages/commit.ts`.

Default order (`domain/settings.ts`):

`requestValidation → h3RouteCorridor → basicEligibility → operationalState →
pickupRouteDistance → directionCompatibility → stopSequenceGeneration →
pickupTimeWindow → detourLowerBound → roadRouting → incrementalCost →
hardConstraints → scoring → commit`

Cheap filters before `roadRouting`. Do not reorder in production to "try
Google first."

**Two stale markers in this code — do not lift them forward:**

1. `STAGE_METADATA` (`matching/pipeline.ts:92`) marks `incrementalCost` with
   `usesRouting: false`, but `stages/incrementalCost.ts:175` calls
   `context.routing.getRoute(solvedWaypoints)`. Only `roadRouting` is flagged,
   so anything reading this metadata under-reports routing spend (MC-7).
2. The `Stage N` comments in each stage file (`0, 0, 1, 3, 4, 5, 6, 7, 8, 9,
   10, 11, 12`) date from before corridor discovery was promoted to slot 2 and
   no longer line up with `DEFAULT_STAGE_ORDER` positions. The order above is
   authoritative; the file headers are not.

## Appendix B — Phase 1 Kafka topics (from HLD §6.3, minus v2)

| Topic | Key | Producer | Consumer | Ordering | DLQ consequence |
| --- | --- | --- | --- | --- | --- |
| `ride.match.requested` | `requestId` | Core API | Matching Engine | one request per key | `NO_DRIVER_FOUND` |
| `ride.match.candidates` | `requestId` | Matching Engine | Core API offer broadcaster | **critical** per request | surface failure; do not hang SEARCHING |
| `ride.lifecycle.events` | `rideId` | Core API | notifications, (payments), admin/analytics | **critical** per ride | retry / alert; never WS-only |
| `driver.cell.changed` | `h3Cell` | Core API | Matching Engine (index awareness), analytics | not critical | drop/retry per policy (Phase 2 numbers) |
| `payment.events` | `rideId` | Payment worker | notifications, ledger | per ride | **only if Q8 = yes** |

Not in Phase 1: `pricing.surge.updated`.

## Appendix C — first-draft settings (ship as code, do not "tune" in Phase 1)

From simulation `DEFAULT_SETTINGS` + HLD §11 / CLAUDE §11:

| Name | First-draft value |
| --- | --- |
| `h3Resolution` | 9 |
| `maxH3Ring` | 3 |
| `minimumUsableCandidates` | 10 |
| `maxPickupToRouteDistanceKm` | 1.5 |
| `maxBearingDifferenceDeg` | 75 |
| `estimatedSpeedKmh` | 24 |
| `maxExistingPassengerDelayPercent` | 50 |
| `shortTripSoloEtaMaxMin` | 5 |
| `shortTripDelayPercent` | 250 |
| `maxNewPassengerPickupDelayMin` | 8 |
| `maxNewPassengerRideDetourMin` | 12 |
| `maxPooledPassengers` | 4 |
| `maxRoutedInsertionsPerDriver` | 6 |
| `maxRoutingCallsPerRun` | 150 |
| `maxOptimizerCallsPerRun` | 40 |
| `optimizerTimeoutMs` | 10_000 |
| `cacheCoordinatePrecision` | `null` |
| `routingMode` | `"AUTO"` |
| `weights.driverImpact` | 30 |
| `weights.existingPassengerImpact` | 30 |
| `weights.newPassengerImpact` | 25 |
| `weights.pickupDelay` | 15 |
| `DEFAULT_PASSENGER_DELAY_BUDGETS.maxPickupDelayMin` | 8 (derived) |
| `DEFAULT_PASSENGER_DELAY_BUDGETS.maxDropDelayPercent` | 50 (derived) |
| Offer K | **not fixed in code today — must be named in config before API-7** |
| Offer stagger / window | 3s / 15s |
| Match result timeout | ~20s |
| Access token TTL | 15 min |
| Refresh TTL | 30 days |
| GPS tick | ~4s |
| Deviation threshold | ~150–200m, N consecutive ticks (name N) |

A PR that changes any of these updates `CLAUDE.md` §11 (and this appendix)
in the same change.

## Appendix D — inline-constant registry

`CLAUDE.md` §2 makes a number inline in business logic a review blocker. Eight
exist today. The lift (MC-6) gives each one a verdict; two of them are vendor
limits and legitimately stay as named constants **with a comment saying which
API limit they encode**, the other six are tuning knobs and belong in settings.

| Constant | Value | Where | Verdict |
| --- | --- | --- | --- |
| `MAX_INTERMEDIATE_WAYPOINTS` | 25 | `domain/settings.ts:84` | **Keep** — Google Routes API hard cap. Comment it as such. |
| `MAX_MATRIX_ELEMENTS` | 625 | `domain/settings.ts:87` | **Keep** — RouteMatrix hard cap. Same. |
| `CORRIDOR_RING_PADDING` | 1 | `matching/stages/h3RouteCorridor.ts:19` | **Move to settings** — it widens corridor recall, which is precisely an H3-tuning knob (HLD §17 #5). |
| `NEW_PASSENGER_PENALTY_COST` | 1000 | `optimization/ShipmentModelBuilder.ts:15` | **Move to settings** — it decides how hard the solver tries to serve the new rider vs. protect the existing spine. That is product policy. |
| `GOOGLE_TRAVEL_SLACK` | 2 | `optimization/ShipmentModelBuilder.ts:23` | **Move to settings** — slack traded against infeasible solves. |
| Soft-window `costPerHourAfterSoftEndTime` default | 50 | `server/optimizerProxy.ts:136` | **Move to settings** — prices lateness against `maxWaitMinutes`; the per-shipment override already exists. |
| Optimizer timeout clamp | `[1, 1800]` s | `server/optimizerProxy.ts:92` | **Keep** — Protobuf `Duration` bound OptimizeTours enforces. Comment it. |
| Horizon padding / floor | `+30` min over the latest deadline, floor `120` min | `server/optimizerProxy.ts:224–235` | **Move to settings** — too small and Google marks a feasible spine out-of-horizon; too large and the model is looser than it needs to be. Two numbers, not one. |

Anything moved into settings gets a row in `CLAUDE.md` §11 and in Appendix C in
the same change.

## Appendix E — Redis ride snapshot contract

This is the C2 resolution. Core API writes it; Matching Engine reads it and
nothing else. It exists so that Stage 1's H3 corridor hit can be turned into a
scoreable candidate without ME ever touching Postgres.

**Key:** `ride:{rideId}` — one JSON document (or hash; pick once, in KS-4).
**Writer:** Core API, after every successful optimistic-locked commit (DB-5,
API-9a) and after a deviation re-route that replaces the polyline (API-11).
**Readers:** Core API; Matching Engine, **read-only**, via `RideSnapshotPort`.
**Schema:** versioned Zod in `packages/kafka-schemas` (KS-4); both sides parse
against the same object.

**Fields** — derived from what the pipeline actually reads, not from what the
`Ride` table happens to hold:

| Field | Used by |
| --- | --- |
| `schemaVersion`, `writtenAt` | KS-4 parse; staleness detection |
| `rideId`, `version` | the `baseVersion` each candidate carries into the commit (HLD §12) |
| `driverId`, `status` | Stage 2 basic eligibility |
| `vehicle`: `type`, `totalSeats`, `luggageCapacity`, `wheelchairAccessible` | Stage 2 checks 2.3–2.7 |
| `sharedRidesEnabled` | Stage 11 pooling policy (check 11.4) |
| `remainingStops[]`: `id`, `passengerId`, `type`, `sequence`, `status`, `location`, `seats`, `originalEtaMin` | Stages 3, 4, 6, 7, 11 — this is the committed spine |
| `passengers[]`: `passengerId`, `seatsRequired`, `maxPickupDelayMin`, `maxDropDelayPercent`, `allowsPooling`, `onboard` | Stage 3 delay budgets; Stage 11 checks 11.1, 11.6, 11.7 |
| `routePolyline`, `routeUpdatedAt` | Stage 4 point-to-polyline, Stage 5 bearing |

No passenger PII beyond opaque ids — no names, phone numbers or home addresses
(`CLAUDE.md` §10). Matching decisions do not need them; the driver app gets
contact details from Core API after commit.

**Staleness.** The snapshot's `version` is the contract. It is expected to lag —
HLD §8 says so, and §12's optimistic lock is what actually resolves it at commit
time, not the snapshot's freshness. What must not happen is a snapshot that
silently describes an *older* spine than its `version` claims; hence the
write-after-commit ordering and the version stamp. A failed snapshot write
deletes the key rather than leaving a stale one readable (DB-5).

**Missing snapshot** is a normal condition, not an error: an idle driver has no
ride. A corridor hit pointing at a `rideId` with no snapshot drops that
candidate under ME-9's reason code.

**ACL.** `ride:*` joins `h3:*` and `driver:*` on Matching Engine's read-only
user (INF-2). It cannot be written by ME, and `lock:*` / `offer:*` stay
unreadable.

**Cost.** This is write amplification on the commit path, proportional to
commits rather than GPS ticks — the same reasoning that keeps raw GPS off Kafka
applies in reverse here: snapshots change on state transitions, which are rare.
Sizing it belongs with HLD §17 #6 (corridor write amplification), not here.

---

*Generated from a repo audit + the source docs listed in the header. If the
code and this file drift, fix this file or the code in the same PR —
`CLAUDE.md` living-document rule.*
