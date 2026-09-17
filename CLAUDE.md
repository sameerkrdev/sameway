@AGENTS.md
@docs

Alway update the @docs content

# Sameway — Engineering Guardrails & Standards

This is the third document, alongside `docs/MATCHING-STAGES-GUIDE.md` (pipeline
internals, code-accurate) and `docs/Overview.md` (the platform HLD —
system/service design). Where those two describe _what the system is_, this
one describes _how we build it and keep it that way_ — for a human
contributor and for an AI agent (Claude Code or otherwise) working in this
repo. It's meant to be referenced, not read start-to-end each time: skim the
section headers, jump to the one you need.

**Living document.** When a rule here stops matching reality, fix the rule or
fix the code — don't let them silently drift apart.

---

## 1. Non-negotiable architectural invariants

These are the decisions that took real iteration to reach (see the matching
engine's own design history) and shouldn't be casually reversed. Changing any
of these needs a written rationale and a trade-off comparison, not a quick
patch:

- **Two-service split stands.** Core API is synchronous and owns Postgres.
  Matching Engine is async, stateless, and Kafka-only. Neither service
  quietly grows a responsibility that belongs to the other.
- **Matching Engine has no database access — permanently, not "for now."**
  It is a pure function of `(Kafka payload, read-only Redis, Google API
responses) → result`. This is what keeps it independently scalable and
  testable against the same harness as `apps/simulation`. "Read-only Redis"
  covers `h3:*`, `driver:*` **and** the `ride:{rideId}` snapshot Core API
  publishes on commit — that last one is how a corridor hit becomes a
  scoreable candidate without a database, and it is inside the invariant, not
  an exception to it. Reaching Postgres through any port, adapter or replica
  is still the graveyard entry.
- **Kafka carries durable, replayable facts and state transitions — never a
  hot ephemeral stream.** Raw GPS and the sub-15s driver-accept race live in
  WebSocket + Redis, not Kafka, on purpose.
- **H3 is a candidate funnel, never the final truth.** Nothing downstream may
  treat "same H3 cell" as "compatible" or "close" — that's what routing and
  the road network are for.
- **The cheap-to-expensive filter ordering is load-bearing.** Nothing calls
  `OptimizeTours` or the Routes API before the cheap geometric/eligibility
  filters have already run. This is the entire reason the system can afford
  Google's per-call cost at scale.
- **Fairness scoring stays in-house.** Buy the road-network math (routing,
  ETAs, feasible sequences). Never outsource _whose delay matters more_ to a
  vendor's default cost model — that's the product, not a commodity.
- **`matching-core` is one shared package,** imported by both
  `apps/simulation` and `apps/matching-engine`. They must never fork into two
  implementations that quietly drift apart — the simulation lab is only
  useful as a predictor of production if it's running the same code.
- **Ride commits go through optimistic locking (`Ride.version`) — always.**
  Redis locks are a performance convenience around that, never a substitute
  for it.
- **Auth keys are asymmetric (RS256).** Matching Engine (or any future
  service) can verify a token; only Core API's auth module can ever mint one.
- **Every hard rejection carries a stable reason code plus a value/threshold
  pair.** "It just didn't match" is never an acceptable failure mode, for a
  support agent or a debugging AI.

---

## 2. Coding standards

- **TypeScript strict mode everywhere, no implicit `any`.** If a boundary
  needs to accept loosely-typed input (an HTTP body, a Kafka payload), it
  gets validated against a **Zod schema** immediately at that boundary, and
  everything past that point is fully typed.
- **Prisma is the ORM.** Raw SQL is an escape hatch for PostGIS/H3 queries
  Prisma can't express cleanly — and when used, it lives in one isolated
  repository function with a comment explaining why Prisma couldn't do it,
  never inline in business logic.
- **Config as code, not magic numbers.** Every tunable threshold (a delay
  budget, a call budget, a bearing tolerance, a shortlist size) lives in a
  `settings.ts`-style object with a documented default and a comment on what
  it trades off — the same discipline `DEFAULT_SETTINGS` already
  demonstrates. A number appearing inline in business logic instead of in
  settings is a review blocker.
- **Prefer typed result values over throwing for pipeline-shaped code.** A
  stage/filter should return something like `{ pass: boolean, reasonCode?,
value?, threshold? }`, mirroring the existing stage contract — not throw a
  generic `Error` that loses the "why."
- **Naming conventions:**
  - Kafka topics: `dot.case` (`ride.match.candidates`)
  - Reason/error codes: `UPPER_SNAKE_CASE`
  - Redis keys: colon-namespaced (`entity:id:field`, e.g. `driver:{id}`,
    `lock:ride:{rideId}`)
  - Files: match the module they belong to, not the ticket that created them
- **Module boundaries are real.** A module reaching into another module's
  Redis keys, Postgres tables, or internal types directly — instead of going
  through its exported interface — is a boundary violation regardless of how
  small the change looks.
- **Every new pipeline stage or scoring change ships with a deterministic
  scenario test** in the shared test harness (stub optimizer, not a live
  Google call) before it's allowed anywhere near the production Matching
  Engine.

---

## 3. Approved libraries, shared packages & official tooling

These are locked decisions, not placeholders for an agent to fill in later —
treat them the same way as §1's invariants.

### 3.1 Mobile UI stack (`apps/captain`, `apps/user`)

- Use **Expo's own UI SDK** (docs.expo.dev/versions/latest/sdk/ui/) for
  native-feeling primitives over reinventing them.
- Style with **NativeWind** (Tailwind for React Native) — one styling
  language across the codebase's UI, not a second bespoke one for mobile.
- Before writing any Expo- or NativeWind-specific code, consult the
  agent-readable doc dumps directly — **docs.expo.dev/llms.txt** and
  **nativewind.dev/llms.txt** — rather than relying on training data. These
  track current SDK versions; training data doesn't.
- `packages/ui` holds only components genuinely shared between
  `apps/captain` and `apps/user` (e.g. a shared button/card/map-marker
  style) — not a dumping ground for every component. A component used by
  exactly one app stays in that app; promote to `packages/ui` once it's
  actually duplicated, not preemptively.
- `apps/web` (admin) is a separate React web app (HLD §14) — it does not
  consume NativeWind or the Expo UI SDK. Whether it shares primitives with
  the mobile apps is a case-by-case call, not an assumed default.

### 3.2 Shared package taxonomy — what must be a Turborepo package

Anything used by 2+ apps/services, or anything that enforces a cross-cutting
invariant this doc already requires (one logging shape, one validation
approach, one Kafka client config), lives in `packages/`, never duplicated
per-app. This expands the HLD's package list (§4 there) with the specific
cross-cutting concerns this doc's own rules require:

| Package                  | Owns                                                                                                 | Why it can't be per-app                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/db`            | Prisma client + schema                                                                               | One schema, one client, one migration history — §6's mutation rules only hold if there's one path to the database |
| `packages/kafka`         | Producer/consumer setup, retry/backoff, DLQ helper, wrapping `@confluentinc/kafka-javascript` (§3.4) | Every service's Kafka discipline (§5) has to be identical, not reimplemented per service                          |
| `packages/kafka-schemas` | Versioned Zod schemas for every topic payload                                                        | A schema mismatch between producer and consumer is exactly the bug class a shared package exists to prevent       |
| `packages/validator`     | Zod schemas for HTTP DTOs (distinct from Kafka payloads above), plus the single shared Zod instance   | Same reasoning — one validation source, not one per route file                                                    |
| `packages/logger`        | Structured logger (pino-based), `requestId`/`rideId` threading built in                              | §9's "no exceptions" logging rule is only enforceable from one shared implementation                              |
| `packages/auth`          | JWT sign/verify, JWKS client                                                                         | Only Core API signs; every other verifier must use the exact same verification logic                              |
| `packages/h3`            | h3-js wrappers                                                                                       | One h3-js version, one set of corridor-building helpers, used identically by Core API and Matching Engine         |
| `packages/routing`       | Google Routes/OptimizeTours clients                                                                  | One client, one budget-tracking implementation (§11)                                                              |
| `packages/matching-core` | The 13-stage pipeline itself                                                                         | Already mandated in §1 — `apps/simulation` and `apps/matching-engine` import the same implementation              |
| `packages/config`        | Env/settings loading, the `settings.ts`-style budget objects (§11)                                   | One source of config truth per environment                                                                        |
| `packages/ui`            | Shared Expo/NativeWind components (§3.1)                                                             | Only once actually duplicated — see above                                                                         |

If a new cross-cutting concern shows up that isn't in this table, the
default question is "does this need to be identical across 2+ services" — if
yes, it's a package _before_ it's app code, not refactored into one after.

### 3.3 Use the library's own CLI — don't hand-roll what it already generates

Where a library ships a first-class generator or installer, use it. Don't
hand-write what it can produce correctly, and don't reach for the generic
package manager where the library has its own:

- **Schema/migration changes:** `prisma migrate dev` (local) /
  `prisma migrate deploy` (CI/CD), then `prisma generate` — never hand-edit
  the generated client, never hand-write a migration Prisma could generate.
- **Adding a dependency to an Expo app:** `expo install <package>`, not
  `bun add <package>` directly — `expo install` resolves the version
  compatible with the installed SDK; a raw package-manager install can
  silently pull an incompatible native module version and break the app at
  runtime, not at install time.
- **Scaffolding a new Turborepo package:** `turbo gen`, if/when a generator
  is set up for this repo, rather than copy-pasting an existing package's
  folder by hand.
- **Kafka topic/schema changes:** whatever `@confluentinc/kafka-javascript`
  or the schema registry tooling provides for validating a schema before
  it's published — don't validate a schema by eyeballing it.

The rule this generalizes from: if the tool that owns a file format also
owns a command that produces it correctly, that command is the only way that
file gets produced in this repo.

### 3.4 Kafka client: `@confluentinc/kafka-javascript`

This is the concrete client behind §5 (Kafka discipline) and
`packages/kafka` above — not a placeholder to decide later. Before wiring up
a producer or consumer, check its current API against the library's own
docs. This is a comparatively young official Confluent client, more likely
than an older, more stable library to have moved since any given training
cutoff.

**It is a NAN/V8 native addon and runs on Node only** — see §3.5. That is the
reason for the split runtime, not a preference.

### 3.5 Split runtime: Bun for the workspace, Node for the services

- **Bun 1.3.13** is the package manager, the Turborepo runner, and the runtime
  for `apps/simulation` and every Vitest run. `bun.lock` is the only lockfile.
- **Node ≥24** is the runtime for `apps/api` and `apps/matching-engine`,
  because the Kafka client in §3.4 does not support Bun (missing native
  bindings, `undefined symbol: v8::FunctionTemplate::SetClassName`, segfaults).
  An N-API migration is an unreleased PR upstream; when it ships this rule can
  be revisited, not before.
- **No service that imports `@repo/kafka` may declare a `bun` run script.**
- This is a change to how the repo is *run*, not to §3.4's client lock. Picking
  a different Kafka client to stay on Bun everywhere would be a §1/§3.4 change
  and needs its own written rationale.

---

## 4. Service boundary decision tree

Before writing code, answer these in order:

1. **Does it need Postgres?** → Core API. Full stop — Matching Engine does
   not get database credentials under any circumstance (§1).
2. **Is it a matching/scoring/routing decision?** → `matching-core`, invoked
   by Matching Engine, tested via `apps/simulation`'s harness.
3. **Is it ephemeral, single-region, sub-minute state?** (GPS position, an
   offer claim, a socket presence set) → Redis + WebSocket.
4. **Is it a durable fact something else needs to react to, possibly after a
   restart or from a different service?** → Kafka.
5. **Does it call a new external paid API?** → It needs a budget constant in
   `settings.ts` _before_ it ships, not retrofitted after a cost surprise.

---

## 5. Kafka discipline

- **The client is `@confluentinc/kafka-javascript`, wrapped in
  `packages/kafka` (§3.2/§3.4)** — services import the wrapper, not the raw
  client directly.
- **New-topic checklist**, all required before merge: add it to the topic
  catalog table (HLD §6.3) with key, producer, consumer(s), a versioned Zod
  schema in `packages/kafka-schemas`, and its ordering requirement.
- **Every topic gets a DLQ, and every DLQ has a defined consequence.** A
  message landing in `ride.match.requested.dlq` has one job: make sure the
  affected `RideRequest` doesn't silently hang — it transitions to
  `NO_DRIVER_FOUND`, it doesn't just disappear.
- **Payloads are self-contained snapshots** wherever the consumer must not
  need direct DB access (Matching Engine, specifically). "Just fetch the rest
  from Postgres" is not an allowed shortcut past this rule — extend the
  schema instead.
- **Partition key must match the real ordering requirement.** Get this wrong
  once (e.g., key by something other than `rideId` for ride-lifecycle events)
  and it's a topic migration to fix, not a config change — decide it
  deliberately, not by default.

---

## 6. Data & concurrency rules

- **All ride-stop mutations after creation go through the optimistic-lock
  pattern.** No code path is allowed to `UPDATE` a ride's stops without
  checking `version` first — not an admin tool, not a "quick fix" script.
- **Redis locks are advisory/performance-only around a transaction** — never
  the sole correctness mechanism for a commit.
- **Delay/budget-style values default from one documented settings source**
  (mirroring `DEFAULT_PASSENGER_DELAY_BUDGETS`), never hardcoded per call
  site — a passenger's pickup tolerance should be defined in exactly one
  place in the codebase.

---

## 7. Real-time layer rules

| Data                                         | Transport               | Never                                                                      |
| -------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| GPS ticks, offer accept/retract race         | WebSocket + Redis       | Never Kafka — too high-frequency / too latency-sensitive for a durable log |
| Ride lifecycle transitions, payment outcomes | Kafka                   | Never WebSocket-only — these must survive a restart and be replayable      |
| Cross-instance WS fan-out                    | Socket.IO Redis adapter | Never a second ad-hoc pub/sub system for the same job                      |

If a new real-time need doesn't obviously fit one of these rows, that's a
sign to think it through explicitly rather than defaulting to whichever
transport is already open in the file you're editing.

---

## 8. Testing & simulation discipline

- **`matching-core` changes run through `apps/simulation`'s scenario suite
  before touching the production Matching Engine.** A change that "makes
  sense" without a passing scenario test isn't done — it's a hypothesis.
- **Never let a test depend on a live Google API call.** Mock at the
  `OptimizeTours`/Routes client boundary (the same `stubOptimizer` pattern
  already in use), not deeper inside the pipeline.
- **A new hard-constraint reason code needs two tests, not one:** a fail-path
  test and a pass-path test at the exact boundary value (e.g., delay = budget
  exactly, not just comfortably under or comfortably over).

---

## 9. Observability & debuggability requirements

- **`requestId`/`rideId` threaded through every log line, trace span, and
  Kafka message header, with no exceptions.** A production incident where you
  can't reconstruct one request's path across both services is a gap in this
  rule, not bad luck.
- **Any new filtering stage ships with funnel metrics** (`attemptStats`-style
  pass/reject counts). If you can't say how many candidates a new filter
  passed versus rejected, it isn't instrumented enough to ship.
- **Every reject is explainable from a reason code plus its value/threshold.**
  This is what lets a support agent — human or AI — answer "why wasn't I
  matched" without reading source code.

---

## 10. Security & privacy rules

- RS256 keys, Matching Engine has no public entry point (Kafka consumer +
  `/healthz` only), Redis ACLs scope Matching Engine to read-only on
  `h3:*`/`driver:*`/`ride:*`, per-service Google API key scoping, Zod
  validation at every boundary — all as designed in the HLD (§5, §9, §16).
  `lock:*` and `offer:*` are not readable by Matching Engine at all.
- **Never log full JWTs, refresh tokens, or raw Google ID tokens.** Log token
  _metadata_ only (`userId`, `kid`, `deviceId`).
- **PII in Kafka payloads — and in the `ride:{rideId}` Redis snapshot — is a
  deliberate decision, not a default.** Before adding a passenger's phone
  number, precise home address, or similar to any event payload or snapshot,
  ask whether the consumer actually needs it or just an opaque ID it can look
  up when it does. Matching decisions need ids, locations and budgets; they do
  not need names or contact details.

---

## 11. Performance & cost budgets — treated as code

Budgets live in `settings.ts`, not folklore. Current numbers, most of them
still first-draft (flagged where true):

**Pipeline budgets** — `apps/simulation/src/domain/settings.ts` today,
`packages/matching-core` after the lift. This is the complete
`DEFAULT_SETTINGS`, not a selection:

| Budget                             | Current value          | Validated against real data?           |
| ---------------------------------- | ---------------------- | -------------------------------------- |
| `h3Resolution`                     | 9                      | No — benchmarking still open (HLD §17) |
| `maxH3Ring`                        | 3                      | No                                     |
| `minimumUsableCandidates`          | 10                     | No                                     |
| `maxPickupToRouteDistanceKm`       | 1.5 km                 | No                                     |
| `maxBearingDifferenceDeg`          | 75°                    | No                                     |
| `estimatedSpeedKmh`                | 24 km/h                | No                                     |
| `maxExistingPassengerDelayPercent` | 50%                    | No                                     |
| `shortTripSoloEtaMaxMin`           | 5 min                  | No                                     |
| `shortTripDelayPercent`            | 250%                   | No                                     |
| `maxNewPassengerPickupDelayMin`    | 8 min                  | No                                     |
| `maxNewPassengerRideDetourMin`     | 12 min                 | No                                     |
| `maxPooledPassengers`              | 4                      | No                                     |
| `maxRoutedInsertionsPerDriver`     | 6                      | No                                     |
| `maxRoutingCallsPerRun`            | 150                    | No                                     |
| `maxOptimizerCallsPerRun`          | 40                     | No                                     |
| `optimizerTimeoutMs`               | 10,000                 | No                                     |
| `cacheCoordinatePrecision`         | `null` (off)           | No                                     |
| `routingMode`                      | `"AUTO"`               | n/a — mode, not a budget               |
| `weights.driverImpact`             | 30                     | No — calibration open (HLD §17 #11)    |
| `weights.existingPassengerImpact`  | 30                     | No                                     |
| `weights.newPassengerImpact`       | 25                     | No                                     |
| `weights.pickupDelay`              | 15                     | No                                     |

**Non-pipeline budgets** — `packages/config`:

| Budget                             | Current value          | Validated against real data?           |
| ---------------------------------- | ---------------------- | -------------------------------------- |
| Offer broadcast shortlist size (K) | first draft, not fixed | No — HLD §11/§17                       |
| Offer broadcast timers (3s / 15s)  | first draft, not fixed | No — HLD §11/§17                       |
| Match-result timeout               | ~20s                   | No                                     |
| Access token TTL / refresh TTL     | 15 min / 30 days       | n/a                                    |
| GPS tick interval                  | ~4s                    | No                                     |
| Route-deviation threshold / N ticks| ~150–200 m, N TBD      | No                                     |

**Vendor limits** — named constants, not settings, each commented with the API
limit it encodes: `MAX_INTERMEDIATE_WAYPOINTS` (25, Routes API),
`MAX_MATRIX_ELEMENTS` (625, RouteMatrix), optimizer timeout clamp
(`[1, 1800]` s, Protobuf `Duration`).

Six further numbers are still inline in business logic rather than here —
`CORRIDOR_RING_PADDING`, `NEW_PASSENGER_PENALTY_COST`, `GOOGLE_TRAVEL_SLACK`,
the soft-window lateness cost, and the two solver-horizon numbers. They are
registered in `docs/BUILD-SPEC-phase-1.md` Appendix D and move here on the
`matching-core` lift.

A change to any of these is a one-line diff in `settings.ts` plus an update
to this table in the same PR — never a number that only exists in one place
and not the other.

---

## 12. Documentation discipline

- **Three docs, three jobs.** Pipeline internals/behavior → `MATCHING-STAGES-
GUIDE.md`. System/service design → the platform HLD. Rules, standards,
  roadmap → this doc. A change to one of these concerns updates the doc that
  owns it — don't let an architectural decision live only in chat history or
  a PR description.
- **Open decisions have exactly one canonical home** (currently HLD §17).
  Don't let the same open question get re-answered differently across three
  documents.

---

## 13. Anti-pattern graveyard — rejected, do not reintroduce

Each of these was considered and explicitly rejected. Reintroducing one
without a new, better argument than the original rejection is a regression,
not a fresh idea:

- Matching Engine reading Postgres directly, including via a read replica.
- Raw GPS ticks published to Kafka.
- Flat parallel driver broadcast with no staggering (whoever taps first wins,
  regardless of score).
- Trusting a routing vendor's default cost model as the final "best route"
  without re-applying our own hard constraints and scoring on top.
- Strict pickup-freeze on committed passengers ("no insertion ever before a
  committed pickup") — replaced by the flexible delay-budget model.
- Full permutation generation for stop sequencing at any real scale —
  replaced by spine + insertion.
- A synchronous HTTP call chain for a matching decision — this is precisely
  why the Kafka split exists; don't reintroduce it "just for one endpoint."

---

## 14. Roadmap (consolidated across all three docs)

**Phase 1 — MVP**
Solo dispatch + basic pooling insertion, flat (non-surge) pricing, Google
OAuth + own JWT auth, core admin CRUD, the full 13-stage matching pipeline as
specced, driver broadcast/offer flow with first-draft K/timer values.

**Phase 2 — tune with real data**
H3 resolution benchmarking, offer broadcast K/timer tuning, commit-conflict
rate under real load, DLQ/alerting thresholds, JWT key rotation cadence,
Kafka partition/retention sizing, dynamic pricing (§18 of the HLD).

**Phase 3 — deferred on purpose, not forgotten**
Proactive re-optimization of already-pending requests when a better driver
appears, ML-assisted ETA/demand prediction (explicitly _after_ a reliable
deterministic system exists, never a Phase-1 shortcut), driver-incentive
modeling, surge caps and regulatory constraints on multiplier.

---

## 15. Pre-change checklist for an AI agent working in this repo

Run through this before writing code, not after:

1. Which of the three docs does this change touch? Update it in the same
   change, not "later."
2. Does this cross a service boundary (§4)? If yes, does it violate §1's
   invariants — especially "Matching Engine gets no DB access" and "GPS never
   touches Kafka"?
3. Is every new threshold a named constant in `settings.ts`, or did a number
   just get typed inline?
4. Does every new hard-reject path have a reason code and a value/threshold
   pair, and does it appear in the funnel metrics?
5. Does a `matching-core` change have a scenario test in `apps/simulation`
   passing _before_ it's wired into the production Matching Engine?
6. Is this idea already in the anti-pattern graveyard (§13) under a different
   name? If so, the burden is on the new argument, not on re-litigating the
   old one from scratch.
7. If this touches Expo/NativeWind UI or the Kafka client, did you check the
   current docs (§3.1's `llms.txt` links / §3.4) rather than trusting
   training data on a fast-moving library?
