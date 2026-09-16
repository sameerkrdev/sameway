@AGENTS.md
@docs

Alway update the @docs content

# Sameway — Engineering Guardrails & Standards

This is the standards document, alongside `docs/MATCHING-STAGES-GUIDE.md` (pipeline
internals, code-accurate), `docs/Overview.md` (system/service design; formerly
referred to as `2026-09-09-platform-architecture-hld.md`), and
`docs/BUILD-SPEC-phase-1.md` (Phase 1 execution: repo audit, task breakdown,
definition of done). Where the HLD and matching guide describe _what the system
is_, and the build spec describes _what to build next_, this document describes
_how we build it and keep it that way_ — for a human contributor and for an AI
agent working in this repo. It's meant to be referenced, not read start-to-end
each time: skim the section headers, jump to the one you need.

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
  testable against the same harness as `apps/simulation`.
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
- **The runtime split is deliberate, not drift.** Bun is the package manager
  for the whole repo and the runtime for packages, vitest and
  `apps/simulation`. `apps/api` and `apps/matching-engine` run on **Node 24**
  via `node --import tsx`, because the maintained Kafka client is a
  librdkafka native addon that fails to load under Bun on Windows
  (`ERR_DLOPEN_FAILED`, then a Bun segfault — measured, see build-spec §8).
  Don't "tidy" those two services back onto Bun, and don't add a second
  lockfile. Every id used as a Kafka partition key or Redis key segment is a
  **UUIDv7 string** (`@default(uuid(7))`, generated client-side — Postgres 17
  has no `uuidv7()`).
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

## 3. Service boundary decision tree

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

## 4. Kafka discipline

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

## 5. Data & concurrency rules

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

## 6. Real-time layer rules

| Data                                         | Transport               | Never                                                                      |
| -------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| GPS ticks, offer accept/retract race         | WebSocket + Redis       | Never Kafka — too high-frequency / too latency-sensitive for a durable log |
| Ride lifecycle transitions, payment outcomes | Kafka                   | Never WebSocket-only — these must survive a restart and be replayable      |
| Cross-instance WS fan-out                    | Socket.IO Redis adapter | Never a second ad-hoc pub/sub system for the same job                      |

If a new real-time need doesn't obviously fit one of these rows, that's a
sign to think it through explicitly rather than defaulting to whichever
transport is already open in the file you're editing.

---

## 7. Testing & simulation discipline

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

## 8. Observability & debuggability requirements

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

## 9. Security & privacy rules

- RS256 keys, Matching Engine has no public entry point (Kafka consumer +
  `/healthz` only), Redis ACLs scope Matching Engine to read-only on
  `h3:*`/`driver:*`, per-service Google API key scoping, Zod validation at
  every boundary — all as designed in the HLD (§5, §9, §16).
- **Never log full JWTs, refresh tokens, or raw Google ID tokens.** Log token
  _metadata_ only (`userId`, `kid`, `deviceId`).
- **PII in Kafka payloads is a deliberate decision, not a default.** Before
  adding a passenger's phone number, precise home address, or similar to any
  event payload, ask whether the consumer actually needs it or just an
  opaque ID it can look up when it does.

---

## 10. Performance & cost budgets — treated as code

Budgets live in `settings.ts`, not folklore. Current numbers, most of them
still first-draft (flagged where true):

Two homes, one rule. Matching-pipeline budgets live in `DEFAULT_SETTINGS`
(`domain/settings.ts`, moving to `packages/config` in Phase 1); platform budgets —
offers, timeouts, retries, pricing — live in `packages/config`. A change to any
number below is a one-line diff in its settings file **plus** an update to this
table in the same PR. A number that exists in only one of the two places is the
bug this rule exists to prevent.

**Matching pipeline** (`DEFAULT_SETTINGS`):

| Budget                          | Current value | Validated against real data?           |
| ------------------------------- | ------------- | -------------------------------------- |
| `h3Resolution`                  | 9             | No — benchmarking still open (HLD §17) |
| `maxOptimizerCallsPerRun`       | 40            | No                                     |
| `maxRoutingCallsPerRun`         | 150           | No                                     |
| `optimizerTimeoutMs`            | 10,000        | No                                     |
| `maxNewPassengerPickupDelayMin` | 8 min         | No                                     |
| `maxPooledPassengers`           | 4             | No                                     |

**Platform** (`packages/config`, set as first drafts 2026-09-16 — build-spec §2.4):

| Budget                       | Current value              | Validated against real data?                 |
| ---------------------------- | -------------------------- | -------------------------------------------- |
| `offerShortlistK`            | 5                          | No — HLD §11/§17; likeliest of these to be wrong |
| `offerFallbackNotifyMs`      | 3,000                      | No — HLD §11/§17                             |
| `offerWindowMs`              | 15,000                     | No — HLD §11/§17                             |
| `matchResultTimeoutMs`       | 20,000                     | No — HLD §10 proposal                        |
| `dlqMaxRetries` / backoff    | 3 / 1s, 5s, 15s            | No — HLD §17 item 10                         |
| `routeDeviationMeters`       | 175                        | No — Architectural-Question item 3           |
| `routeDeviationTicks`        | 3                          | No                                           |
| `locationHistoryIntervalMs`  | 30,000                     | No                                           |
| `rideCommitLockMs`           | 5,000                      | No — advisory only; `Ride.version` is correctness |
| Fare coefficients            | 30 base + 9/km + 1.5/min, 20% pooling discount | No — placeholder for a pricing decision |

Kafka partition counts are **not** in this table: local dev uses 3 (keyed topics) and
1 (DLQs) so per-key ordering bugs surface, but production sizing is a scaling-capacity
decision that needs real request/sec numbers (HLD §17 item 1).

---

## 11. Documentation discipline

- **Four docs, four jobs.** Pipeline internals/behavior →
  `docs/MATCHING-STAGES-GUIDE.md`. System/service design → `docs/Overview.md`.
  Rules, standards, roadmap → this doc. Phase 1 execution (what exists, what to
  build, definition of done) → `docs/BUILD-SPEC-phase-1.md`. A change to one of
  these concerns updates the doc that owns it — don't let an architectural
  decision live only in chat history or a PR description.
- **Open decisions have exactly one canonical home** (currently HLD §17, with
  blocking repo-vs-doc conflicts listed in the build spec §7.1). Don't let the
  same open question get re-answered differently across documents.

---

## 12. Anti-pattern graveyard — rejected, do not reintroduce

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

## 13. Roadmap (consolidated across all three docs)

**Phase 1 — MVP**
Solo dispatch + basic pooling insertion, flat (non-surge) pricing, Google
OAuth + own JWT auth, core admin CRUD, the full 14-stage matching pipeline
(stages 0–13) running in production via the shared `matching-core` package,
driver broadcast/offer flow with first-draft K/timer values.

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

## 14. Pre-change checklist for an AI agent working in this repo

Run through this before writing code, not after:

1. Which of the four docs does this change touch? Update it in the same
   change, not "later." Pipeline → matching guide; topology/topics/auth →
   `docs/Overview.md`; invariants/roadmap → this file; Phase 1 tasks/DoD →
   `docs/BUILD-SPEC-phase-1.md`.
2. Does this cross a service boundary (§3)? If yes, does it violate §1's
   invariants — especially "Matching Engine gets no DB access" and "GPS never
   touches Kafka"?
3. Is every new threshold a named constant in `settings.ts`, or did a number
   just get typed inline?
4. Does every new hard-reject path have a reason code and a value/threshold
   pair, and does it appear in the funnel metrics?
5. Does a `matching-core` change have a scenario test in `apps/simulation`
   passing _before_ it's wired into the production Matching Engine?
6. Is this idea already in the anti-pattern graveyard (§12) under a different
   name? If so, the burden is on the new argument, not on re-litigating the
   old one from scratch.
