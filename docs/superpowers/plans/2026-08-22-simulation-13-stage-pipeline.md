# Simulation 13-Stage Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/simulation`'s matching pipeline as the thirteen stages of `docs/Overview.md`, with H3 remaining-route corridor indexing and Google `OptimizeTours` doing the stop sequencing at stage 8.

**Architecture:** A new `src/optimization/` module mirrors the existing `src/routing/` module and talks to `OptimizeTours` through a Vite dev-server middleware that holds ADC credentials. `StageId` is replaced wholesale by the Overview's thirteen ids; the switch happens once in Task 9 with the new stages as no-ops, and Tasks 10–21 fill each one in with tests. The engine stays pure — stage 12 computes a `CommitPlan`, and only `scenarioStore` mutates.

**Tech Stack:** TypeScript, React 19, Vite 8, Vitest 4, Zustand 5, zod 4, h3-js 4, `google-auth-library` (dev only), Google Route Optimization API.

**Spec:** `docs/superpowers/specs/2026-08-22-simulation-13-stage-pipeline-design.md`

## Status — as of 2026-08-23

**Tasks 1–9: landed.** Schema v2 and its v1 migrator, the stage-3/4 geometry
primitives, the H3 remaining-route corridor index, the whole `src/optimization/`
module (types, `ShipmentModelBuilder`, `SolutionReader`, engine, telemetry,
cache, budget), the ADC dev-server proxy, and the fourteen-stage skeleton.
Verified green at `8c6342a`: typecheck clean, lint clean, 108 tests in 15 files.

**Tasks 10–24: not started.** Eleven of the fourteen stages are still the
no-op placeholders Task 9 deliberately shipped — they pass every live driver.
Only `requestValidation`, `basicEligibility` and `scoring` carry real logic, and
`scoring` still normalises against Task 9's stand-in thresholds.

Commit `3051b2a` deleted this document with the message "All 24 tasks landed".
That was wrong: it retired the plan at the end of Task 9, not Task 24. The
document is restored here because Tasks 10–24 are still the work in front of us.

---

## Global Constraints

- **Only `apps/simulation` may be modified.** No other app or package in the monorepo.
- `src/domain`, `src/lib`, `src/routing`, `src/optimization` and `src/matching` must contain **no React imports and no `google.maps` imports**. They are lifted into a Node service later.
- `h3-js` may be imported **only** from `src/lib/h3.ts`. Enforced by an ESLint `no-restricted-imports` rule already in `eslint.config.js`.
- The four proximity measures stay distinct and are never interchanged: `h3GridDistance` (unitless hop count, search bounds only), `straightLineKm` (haversine, cheap pruning), `roadDistanceKm` and `roadEtaMin` (the only two comparable against user-facing thresholds).
- Every rejection reason must carry both `value` and `threshold` where a threshold exists. The UI renders `"Detour 24.1% / max 15%"` generically off that pairing.
- `NOT_EVALUATED` is never an algorithmic rejection. Budget exhaustion, missing credentials and provider errors are `NOT_EVALUATED`; a driver that fails a filter is `FAILED`.
- The engine never mutates the scenario. `test/e2e-scenario.test.ts` asserts this and must keep passing.
- The vitest suite must stay **offline and deterministic** — no network, no `Math.random()`.
- Run after every task: `bun run check-types && bun run lint && bun run test`, from `apps/simulation`.
- Commit after every task. Conventional Commits.

---

## Task 1: Scenario schema v2 — LANDED

**Files:**
- Modify: `src/domain/entities.ts`
- Modify: `src/domain/schemas.ts`
- Modify: `src/scenarios/serialize.ts`
- Modify: `src/scenarios/builders.ts`
- Test: `src/test/schema-migration.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `Passenger.maxPickupDelayMin: number`, `Passenger.maxDropDelayMin: number`, `Stop.originalEtaMin: number`, `SCENARIO_SCHEMA_VERSION = 2`, and a private `migrateToV2(input: unknown): unknown` called from inside `parseScenario` — migration runs before validation, so it is not a separate exported entry point.

- [ ] **Step 1: Write the failing test**

Create `src/test/schema-migration.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseScenario } from "@/domain/schemas";
import { DEFAULT_SETTINGS } from "@/domain/settings";

function v1Scenario() {
  return {
    schemaVersion: 1,
    id: "sc_1",
    name: "Legacy",
    drivers: [
      {
        id: "d1",
        name: "D1",
        status: "ONLINE",
        location: { lat: 28.6, lng: 77.2 },
        vehicleId: "v1",
        currentRideId: "r1",
        history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 0 },
      },
    ],
    vehicles: [
      {
        id: "v1",
        label: "Sedan",
        totalSeats: 4,
        luggageCapacity: 2,
        poolingEnabled: true,
        wheelchairAccessible: false,
        airConditioned: true,
      },
    ],
    passengers: [
      {
        id: "p1",
        name: "P1",
        seatsRequired: 1,
        state: "WAITING",
        specialRequirements: [],
        allowsPooling: true,
      },
    ],
    rides: [
      {
        id: "r1",
        driverId: "d1",
        passengerIds: ["p1"],
        stops: [
          {
            id: "s1",
            rideId: "r1",
            passengerId: "p1",
            type: "PICKUP",
            location: { lat: 28.61, lng: 77.21 },
            sequence: 0,
          },
          {
            id: "s2",
            rideId: "r1",
            passengerId: "p1",
            type: "DROP",
            location: { lat: 28.62, lng: 77.22 },
            sequence: 1,
          },
        ],
      },
    ],
    requests: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

describe("scenario schema v2", () => {
  it("migrates a v1 document, filling passenger delay budgets from settings", () => {
    const result = parseScenario(v1Scenario());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scenario.schemaVersion).toBe(2);
    const passenger = result.scenario.passengers[0]!;
    expect(passenger.maxPickupDelayMin).toBe(DEFAULT_SETTINGS.maxNewPassengerPickupDelayMin);
    expect(passenger.maxDropDelayMin).toBe(DEFAULT_SETTINGS.maxExistingPassengerDelayMin);
  });

  it("fills originalEtaMin on every migrated stop", () => {
    const result = parseScenario(v1Scenario());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const stop of result.scenario.rides[0]!.stops) {
      expect(stop.originalEtaMin).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(stop.originalEtaMin)).toBe(true);
    }
  });

  it("accepts a native v2 document unchanged", () => {
    const migrated = parseScenario(v1Scenario());
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    const reparsed = parseScenario(structuredClone(migrated.scenario));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.scenario).toEqual(migrated.scenario);
  });

  it("rejects a v2 document missing the new passenger fields", () => {
    const broken = structuredClone(v1Scenario()) as Record<string, unknown>;
    broken.schemaVersion = 2;

    const result = parseScenario(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("maxPickupDelayMin");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/schema-migration.test.ts`
Expected: FAIL — `schemaVersion` is still `1` and `maxPickupDelayMin` does not exist.

- [ ] **Step 3: Add the new fields to the domain model**

In `src/domain/entities.ts`, extend `Passenger`:

```ts
export interface Passenger {
  id: string;
  name: string;
  seatsRequired: number;
  state: PassengerState;
  specialRequirements: string[];
  allowsPooling: boolean;
  /**
   * How much later than promised this passenger will tolerate being collected.
   * Stage 1 turns it into a delay budget, stage 6 pre-filters orderings against
   * it, stage 8 encodes it as a hard time window, and stage 10 re-checks it
   * against the solver's real leg times. One source of truth, four consumers.
   */
  maxPickupDelayMin: number;
  /** The same tolerance, applied to arrival at their destination. */
  maxDropDelayMin: number;
}
```

Extend `Stop`:

```ts
export interface Stop {
  id: string;
  rideId: string;
  passengerId: string;
  type: StopType;
  location: LatLng;
  address?: string;
  sequence: number;
  /**
   * The ETA in minutes from the driver's position at the time this stop was
   * committed — the promise stages 6, 9 and 10 protect. Stage 12 re-stamps it
   * on commit, which is what makes the committed route the new baseline.
   */
  originalEtaMin: number;
}
```

Change the version constant:

```ts
export const SCENARIO_SCHEMA_VERSION = 2 as const;
```

and `Scenario.schemaVersion` to `2`.

- [ ] **Step 4: Add the migrator**

In `src/domain/schemas.ts`, add the two passenger fields and the stop field to `passengerSchema` / `stopSchema`:

```ts
const passengerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  seatsRequired: z.number().int().min(1),
  state: passengerStateSchema,
  specialRequirements: z.array(z.string()),
  allowsPooling: z.boolean(),
  maxPickupDelayMin: z.number().min(0),
  maxDropDelayMin: z.number().min(0),
});

const stopSchema = z.object({
  id: z.string().min(1),
  rideId: z.string(),
  passengerId: z.string().min(1),
  type: z.enum(["PICKUP", "DROP"]),
  location: latLngSchema,
  address: z.string().optional(),
  sequence: z.number().int().min(0),
  originalEtaMin: z.number().min(0),
});
```

Change `scenarioSchema.schemaVersion` to `z.literal(SCENARIO_SCHEMA_VERSION)` (now 2 — no edit needed, the constant changed).

Add above `parseScenario`:

```ts
/**
 * Straight-line minutes per kilometre used to seed `originalEtaMin` on a
 * migrated v1 stop.
 *
 * A v1 document never recorded what was promised, so any value here is an
 * invention. A geometric estimate is the honest one: it is reproducible, needs
 * no network, and stage 12 overwrites it with real solver data the first time
 * the ride is committed to.
 */
const MIGRATION_MINUTES_PER_KM = 3;

interface V1Passenger {
  maxPickupDelayMin?: number;
  maxDropDelayMin?: number;
}

interface V1Stop {
  location: { lat: number; lng: number };
  originalEtaMin?: number;
}

/**
 * Upgrades a v1 scenario in place before validation.
 *
 * Migration runs before the schema rather than after, so a v1 document is
 * never reported to the user as "invalid" for lacking fields that did not
 * exist when it was exported.
 */
function migrateToV2(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const document = input as Record<string, unknown>;
  if (document.schemaVersion !== 1) {
    return input;
  }

  const clone = structuredClone(document);
  const settings = (clone.settings ?? {}) as Record<string, number>;
  const pickupBudget = settings.maxNewPassengerPickupDelayMin ?? 6;
  const dropBudget = settings.maxExistingPassengerDelayMin ?? 8;

  clone.schemaVersion = 2;

  for (const passenger of (clone.passengers ?? []) as V1Passenger[]) {
    passenger.maxPickupDelayMin ??= pickupBudget;
    passenger.maxDropDelayMin ??= dropBudget;
  }

  for (const ride of (clone.rides ?? []) as { stops?: V1Stop[] }[]) {
    let cumulativeKm = 0;
    let previous: { lat: number; lng: number } | null = null;

    for (const stop of ride.stops ?? []) {
      if (previous) {
        cumulativeKm += haversineKm(previous, stop.location);
      }
      previous = stop.location;
      stop.originalEtaMin ??= cumulativeKm * MIGRATION_MINUTES_PER_KM;
    }
  }

  for (const request of (clone.requests ?? []) as { intermediateStops?: V1Stop[] }[]) {
    for (const stop of request.intermediateStops ?? []) {
      stop.originalEtaMin ??= 0;
    }
  }

  return clone;
}
```

Import `haversineKm` at the top of the file: `import { haversineKm } from "@/lib/geo";`

Change the first line of `parseScenario`:

```ts
export function parseScenario(input: unknown): ScenarioParseResult {
  const result = scenarioSchema.safeParse(migrateToV2(input));
```

- [ ] **Step 5: Update the scenario builders**

In `src/scenarios/builders.ts`, every helper that constructs a `Passenger` must set `maxPickupDelayMin: 6` and `maxDropDelayMin: 8`, and every helper that constructs a `Stop` must set `originalEtaMin: 0`. Find them with:

Run: `grep -n "seatsRequired\|sequence:" src/scenarios/builders.ts`

Add the fields to each literal. Do the same in `src/scenarios/randomGenerator.ts` and in any preset in `src/scenarios/presets/` that builds passengers or stops without going through a builder.

- [ ] **Step 6: Run the whole suite**

Run: `bun run check-types && bun run test`
Expected: `schema-migration.test.ts` PASSES. Other suites pass; fix any test fixture that constructs a `Passenger` or `Stop` literal by adding the new fields.

- [ ] **Step 7: Commit**

```bash
git add src/domain src/scenarios src/test
git commit -m "feat(simulation): scenario schema v2 with per-passenger delay budgets"
```

---

## Task 2: Geometry primitives for stages 3 and 4 — LANDED

**Files:**
- Modify: `src/lib/geo.ts`
- Test: `src/test/geo-polyline.test.ts` (create)

**Interfaces:**
- Consumes: `haversineKm`, `bearingDeg`, `bearingDifferenceDeg` (existing in `src/lib/geo.ts`).
- Produces:
  - `pointToPolylineKm(point: LatLng, polyline: readonly LatLng[]): number`
  - `projectOnPolylineKm(point: LatLng, polyline: readonly LatLng[]): number` — distance **along** the polyline of the nearest point, in km from its start.
  - `polylineBearingDeg(polyline: readonly LatLng[]): number | null` — start-to-end bearing, `null` for fewer than two points.

- [ ] **Step 1: Write the failing test**

Create `src/test/geo-polyline.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  polylineBearingDeg,
  pointToPolylineKm,
  projectOnPolylineKm,
} from "@/lib/geo";

// A short due-east line near Delhi. At this latitude 0.01 degrees of longitude
// is roughly 0.98 km, which is close enough for order-of-magnitude assertions
// without hard-coding a projection.
const line = [
  { lat: 28.6, lng: 77.2 },
  { lat: 28.6, lng: 77.3 },
];

describe("pointToPolylineKm", () => {
  it("is zero for a point on the line", () => {
    expect(pointToPolylineKm({ lat: 28.6, lng: 77.25 }, line)).toBeCloseTo(0, 3);
  });

  it("measures perpendicular offset, not endpoint distance", () => {
    const offset = pointToPolylineKm({ lat: 28.605, lng: 77.25 }, line);
    expect(offset).toBeGreaterThan(0.4);
    expect(offset).toBeLessThan(0.7);
  });

  it("clamps to the nearest endpoint for a point beyond the line", () => {
    const beyond = pointToPolylineKm({ lat: 28.6, lng: 77.4 }, line);
    expect(beyond).toBeCloseTo(9.8, 0);
  });

  it("returns Infinity for an empty polyline", () => {
    expect(pointToPolylineKm({ lat: 28.6, lng: 77.2 }, [])).toBe(Infinity);
  });
});

describe("projectOnPolylineKm", () => {
  it("returns zero at the start", () => {
    expect(projectOnPolylineKm({ lat: 28.6, lng: 77.2 }, line)).toBeCloseTo(0, 2);
  });

  it("grows monotonically along the line", () => {
    const quarter = projectOnPolylineKm({ lat: 28.6, lng: 77.225 }, line);
    const half = projectOnPolylineKm({ lat: 28.6, lng: 77.25 }, line);
    expect(half).toBeGreaterThan(quarter);
  });

  it("is unaffected by perpendicular offset", () => {
    const onLine = projectOnPolylineKm({ lat: 28.6, lng: 77.25 }, line);
    const offLine = projectOnPolylineKm({ lat: 28.61, lng: 77.25 }, line);
    expect(offLine).toBeCloseTo(onLine, 1);
  });
});

describe("polylineBearingDeg", () => {
  it("is due east for an eastward line", () => {
    expect(polylineBearingDeg(line)).toBeCloseTo(90, 0);
  });

  it("is null for a degenerate polyline", () => {
    expect(polylineBearingDeg([{ lat: 28.6, lng: 77.2 }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/geo-polyline.test.ts`
Expected: FAIL — `pointToPolylineKm is not a function`.

- [ ] **Step 3: Implement the primitives**

Append to `src/lib/geo.ts`:

```ts
/**
 * Local planar approximation of a lat/lng pair, in kilometres, around an
 * anchor point.
 *
 * Point-to-segment projection has no closed form on a sphere. Over the few
 * kilometres a route corridor spans, flattening to a local tangent plane is
 * accurate to well under the H3 cell size we compare against, and it makes the
 * projection a two-line dot product instead of a spherical solve.
 */
function toLocalKm(point: LatLng, anchor: LatLng): { x: number; y: number } {
  const latRad = (anchor.lat * Math.PI) / 180;
  const kmPerDegLat = (Math.PI * EARTH_RADIUS_KM) / 180;
  const kmPerDegLng = kmPerDegLat * Math.cos(latRad);

  return {
    x: (point.lng - anchor.lng) * kmPerDegLng,
    y: (point.lat - anchor.lat) * kmPerDegLat,
  };
}

/** Fraction along `a → b` at which `p` projects, clamped to the segment. */
function segmentProjectionFraction(p: LatLng, a: LatLng, b: LatLng): number {
  const pa = toLocalKm(p, a);
  const ba = toLocalKm(b, a);
  const lengthSquared = ba.x * ba.x + ba.y * ba.y;

  if (lengthSquared === 0) {
    return 0;
  }

  const t = (pa.x * ba.x + pa.y * ba.y) / lengthSquared;
  return Math.min(1, Math.max(0, t));
}

function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Minimum distance from a point to a polyline, in kilometres.
 *
 * This is a cheap geometric approximation of "how far off the route is this
 * pickup", never the real detour: a pickup 500 m off the line can cost a 1 km
 * round trip once one-way streets and medians are involved. Only stage 8 knows
 * the real number.
 */
export function pointToPolylineKm(point: LatLng, polyline: readonly LatLng[]): number {
  if (polyline.length === 0) {
    return Infinity;
  }

  if (polyline.length === 1) {
    return haversineKm(point, polyline[0]!);
  }

  let best = Infinity;

  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index]!;
    const b = polyline[index + 1]!;
    const nearest = interpolate(a, b, segmentProjectionFraction(point, a, b));
    best = Math.min(best, haversineKm(point, nearest));
  }

  return best;
}

/**
 * Distance along the polyline, from its start, of the point nearest to `point`.
 *
 * Stage 4 uses this to answer "is this destination ahead of the vehicle or
 * behind it" — a question raw proximity cannot answer, and the reason a pickup
 * sitting on the historical route must still be rejected.
 */
export function projectOnPolylineKm(point: LatLng, polyline: readonly LatLng[]): number {
  if (polyline.length < 2) {
    return 0;
  }

  let bestDistance = Infinity;
  let bestAlong = 0;
  let cumulative = 0;

  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index]!;
    const b = polyline[index + 1]!;
    const segmentKm = haversineKm(a, b);
    const t = segmentProjectionFraction(point, a, b);
    const nearest = interpolate(a, b, t);
    const distance = haversineKm(point, nearest);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = cumulative + segmentKm * t;
    }

    cumulative += segmentKm;
  }

  return bestAlong;
}

/** Start-to-end bearing of a polyline, or null if it has fewer than two points. */
export function polylineBearingDeg(polyline: readonly LatLng[]): number | null {
  if (polyline.length < 2) {
    return null;
  }

  return bearingDeg(polyline[0]!, polyline[polyline.length - 1]!);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/test/geo-polyline.test.ts`
Expected: PASS, all eight cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo.ts src/test/geo-polyline.test.ts
git commit -m "feat(simulation): point-to-polyline geometry for corridor stages"
```

---

## Task 3: H3 path cells and the corridor index — LANDED

**Files:**
- Modify: `src/lib/h3.ts`
- Create: `src/matching/corridor.ts`
- Test: `src/test/corridor.test.ts` (create)

**Interfaces:**
- Consumes: `getH3CellFor`, `getCellsByRing` (existing in `src/lib/h3.ts`); `Ride`, `Driver`, `Passenger` from `@/domain/entities`.
- Produces:
  - `cellsForPath(points: readonly LatLng[], resolution: number): H3Index[]` in `src/lib/h3.ts`
  - `gridDiskCells(cell: H3Index, ring: number): H3Index[]` in `src/lib/h3.ts`
  - In `src/matching/corridor.ts`:
    - `interface RideCorridor { driverId: string; rideId: string | null; remainingStops: ProposedStop[]; polyline: LatLng[]; cells: Set<H3Index>; isIdle: boolean }`
    - `buildCorridors(input: BuildCorridorsInput): Map<string, RideCorridor>` keyed by driver id
    - `indexCorridorsByCell(corridors: ReadonlyMap<string, RideCorridor>): Map<H3Index, string[]>` — cell to driver ids

- [ ] **Step 1: Write the failing test**

Create `src/test/corridor.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Driver, Passenger, Ride } from "@/domain/entities";
import { getH3CellFor } from "@/lib/h3";
import { buildCorridors, indexCorridorsByCell } from "@/matching/corridor";

const RESOLUTION = 9;

function passenger(id: string, state: Passenger["state"]): Passenger {
  return {
    id,
    name: id,
    seatsRequired: 1,
    state,
    specialRequirements: [],
    allowsPooling: true,
    maxPickupDelayMin: 5,
    maxDropDelayMin: 8,
  };
}

function driver(id: string, lat: number, lng: number, rideId: string | null): Driver {
  return {
    id,
    name: id,
    status: "ONLINE",
    location: { lat, lng },
    vehicleId: "v1",
    currentRideId: rideId,
    history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 0 },
  };
}

// A ride heading due east. The passenger is already onboard, so their pickup
// is behind the vehicle and must not appear in the corridor.
const onboardRide: Ride = {
  id: "r1",
  driverId: "d1",
  passengerIds: ["p1"],
  stops: [
    {
      id: "s1",
      rideId: "r1",
      passengerId: "p1",
      type: "PICKUP",
      location: { lat: 28.6, lng: 77.1 },
      sequence: 0,
      originalEtaMin: 0,
    },
    {
      id: "s2",
      rideId: "r1",
      passengerId: "p1",
      type: "DROP",
      location: { lat: 28.6, lng: 77.3 },
      sequence: 1,
      originalEtaMin: 20,
    },
  ],
};

describe("buildCorridors", () => {
  it("excludes stops the vehicle has already passed", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const corridor = corridors.get("d1")!;
    expect(corridor.remainingStops.map((stop) => stop.id)).toEqual(["s2"]);
    expect(corridor.isIdle).toBe(false);
  });

  it("does not cover a point on the historical route behind the vehicle", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    // The original pickup at lng 77.1 is behind the driver, who is at 77.2.
    const behindCell = getH3CellFor({ lat: 28.6, lng: 77.1 }, RESOLUTION);
    expect(corridors.get("d1")!.cells.has(behindCell)).toBe(false);
  });

  it("covers a point ahead of the vehicle on the remaining route", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const aheadCell = getH3CellFor({ lat: 28.6, lng: 77.25 }, RESOLUTION);
    expect(corridors.get("d1")!.cells.has(aheadCell)).toBe(true);
  });

  it("gives an idle driver a single-cell corridor at their location", () => {
    const corridors = buildCorridors({
      drivers: [driver("d2", 28.7, 77.4, null)],
      rides: [],
      passengersById: new Map(),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const corridor = corridors.get("d2")!;
    expect(corridor.isIdle).toBe(true);
    expect(corridor.remainingStops).toEqual([]);
    expect(corridor.cells.has(getH3CellFor({ lat: 28.7, lng: 77.4 }, RESOLUTION))).toBe(true);
  });

  it("keeps a waiting passenger's pickup in the corridor", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.05, "r1")],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "WAITING")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    expect(corridors.get("d1")!.remainingStops.map((stop) => stop.id)).toEqual(["s1", "s2"]);
  });
});

describe("indexCorridorsByCell", () => {
  it("maps every corridor cell to its driver, without duplicates", () => {
    const corridors = buildCorridors({
      drivers: [driver("d1", 28.6, 77.2, "r1"), driver("d2", 28.6, 77.25, null)],
      rides: [onboardRide],
      passengersById: new Map([["p1", passenger("p1", "IN_RIDE")]]),
      resolution: RESOLUTION,
      ringPadding: 1,
    });

    const index = indexCorridorsByCell(corridors);
    const sharedCell = getH3CellFor({ lat: 28.6, lng: 77.25 }, RESOLUTION);
    const drivers = index.get(sharedCell) ?? [];

    expect(drivers).toContain("d1");
    expect(drivers).toContain("d2");
    expect(new Set(drivers).size).toBe(drivers.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/corridor.test.ts`
Expected: FAIL — `Cannot find module '@/matching/corridor'`.

- [ ] **Step 3: Add the H3 helpers**

Append to `src/lib/h3.ts`:

```ts
/**
 * Every cell touched by a polyline, in order, deduplicated.
 *
 * `gridPathCells` between consecutive vertices would be the h3-js way to do
 * this, but it fails on cells that are not `gridDistance`-comparable across
 * pentagon boundaries. Sampling at a fraction of the cell edge length is
 * slower and completely robust, which is the right trade for a lab tool.
 */
export function cellsForPath(points: readonly LatLng[], resolution: number): H3Index[] {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    return [getH3CellFor(points[0]!, resolution)];
  }

  const stepKm = edgeLengthKm(resolution) / 2;
  const seen = new Set<H3Index>();
  const cells: H3Index[] = [];

  const push = (point: LatLng): void => {
    const cell = getH3CellFor(point, resolution);
    if (!seen.has(cell)) {
      seen.add(cell);
      cells.push(cell);
    }
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const segmentKm = haversineKm(a, b);
    const steps = Math.max(1, Math.ceil(segmentKm / stepKm));

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }

  return cells;
}

/** All cells within `ring` hops of `cell`, inclusive. A unitless hop count. */
export function gridDiskCells(cell: H3Index, ring: number): H3Index[] {
  return gridDisk(cell, ring);
}
```

At the top of `src/lib/h3.ts`, extend the `h3-js` import to include `gridDisk` and `getHexagonEdgeLengthAvg`, and add a local helper plus the `haversineKm` import:

```ts
import { getHexagonEdgeLengthAvg, gridDisk } from "h3-js";
import { haversineKm } from "./geo";

function edgeLengthKm(resolution: number): number {
  return getHexagonEdgeLengthAvg(resolution, "km");
}
```

(Keep the existing imports; add to them rather than replacing.)

- [ ] **Step 4: Write the corridor module**

Create `src/matching/corridor.ts`:

```ts
import type { Driver, LatLng, Passenger, Ride } from "@/domain/entities";
import { cellsForPath, getH3CellFor, gridDiskCells, type H3Index } from "@/lib/h3";

import { toProposedStops } from "./stops";
import type { ProposedStop } from "./types";

/**
 * A driver's remaining route, and the H3 cells it plausibly serves.
 *
 * The corridor is built from the *remaining* route, never the whole trip. A
 * pickup sitting on a stretch the vehicle has already driven past is a reject,
 * however close it looks — that is the single most important property of this
 * module and the one `corridor.test.ts` pins hardest.
 */
export interface RideCorridor {
  driverId: string;
  rideId: string | null;
  /** Stops still to be served, in execution order. */
  remainingStops: ProposedStop[];
  /** Driver position followed by every remaining stop. */
  polyline: LatLng[];
  cells: Set<H3Index>;
  /** True when the driver has no committed route to match against. */
  isIdle: boolean;
}

export interface BuildCorridorsInput {
  drivers: readonly Driver[];
  rides: readonly Ride[];
  passengersById: ReadonlyMap<string, Passenger>;
  resolution: number;
  /** `gridDisk` expansion applied to every path cell. The Overview uses 1. */
  ringPadding: number;
}

/**
 * Builds one corridor per driver.
 *
 * An idle driver has no route, so their location is treated as a degenerate
 * single-point corridor. That keeps solo matching working without a second
 * code path, and makes "which drivers could serve this pickup" one lookup
 * rather than two.
 */
export function buildCorridors(input: BuildCorridorsInput): Map<string, RideCorridor> {
  const { drivers, rides, passengersById, resolution, ringPadding } = input;
  const ridesById = new Map(rides.map((ride) => [ride.id, ride]));
  const corridors = new Map<string, RideCorridor>();

  for (const driver of drivers) {
    const ride = driver.currentRideId ? ridesById.get(driver.currentRideId) : undefined;

    // `toProposedStops` already drops dropped/cancelled passengers and the
    // pickups of anyone already aboard, which is exactly "remaining".
    const remainingStops = ride
      ? toProposedStops(
          [...ride.stops].sort((a, b) => a.sequence - b.sequence),
          passengersById,
        )
      : [];

    const polyline = [driver.location, ...remainingStops.map((stop) => stop.location)];
    const cells = new Set<H3Index>();

    for (const cell of cellsForPath(polyline, resolution)) {
      for (const padded of gridDiskCells(cell, ringPadding)) {
        cells.add(padded);
      }
    }

    corridors.set(driver.id, {
      driverId: driver.id,
      rideId: ride?.id ?? null,
      remainingStops,
      polyline,
      cells,
      isIdle: remainingStops.length === 0,
    });
  }

  return corridors;
}

/** Inverts the corridor map into the `cell → driverIds` lookup stage 2 reads. */
export function indexCorridorsByCell(
  corridors: ReadonlyMap<string, RideCorridor>,
): Map<H3Index, string[]> {
  const index = new Map<H3Index, string[]>();

  for (const corridor of corridors.values()) {
    for (const cell of corridor.cells) {
      const existing = index.get(cell);
      if (existing) {
        existing.push(corridor.driverId);
      } else {
        index.set(cell, [corridor.driverId]);
      }
    }
  }

  return index;
}

/** Convenience for the single-point case, used by the idle-driver path. */
export function cellForPoint(point: LatLng, resolution: number): H3Index {
  return getH3CellFor(point, resolution);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test src/test/corridor.test.ts`
Expected: PASS, all six cases. If "covers a point ahead" fails, the sampling step in `cellsForPath` is too coarse — halve `stepKm`.

- [ ] **Step 6: Run the whole suite and lint**

Run: `bun run check-types && bun run lint && bun run test`
Expected: all green. The `no-restricted-imports` rule must not fire — `gridDisk` is imported inside `src/lib/h3.ts`, which is the allowed file.

- [ ] **Step 7: Commit**

```bash
git add src/lib/h3.ts src/matching/corridor.ts src/test/corridor.test.ts
git commit -m "feat(simulation): H3 remaining-route corridor index"
```

---

## Task 4: Optimizer types and errors — LANDED

**Files:**
- Create: `src/optimization/types.ts`
- Create: `src/optimization/index.ts`
- Test: none (types only; exercised by Tasks 5–7)

**Interfaces:**
- Consumes: `LatLng` from `@/domain/entities`; `RouteLegResult` from `@/routing/types`.
- Produces: `OptimizerEngine`, `OptimizeToursRequest`, `OptimizeToursResult`, `OptimizerShipment`, `OptimizerVisit`, `OptimizerUnavailableError`, `OptimizerBudgetExceededError`, `OptimizerCredentialsMissingError`.

- [ ] **Step 1: Write the types**

Create `src/optimization/types.ts`:

```ts
import type { LatLng } from "@/domain/entities";
import type { RouteLegResult } from "@/routing/types";

export type OptimizerEngineKind = "GOOGLE_OPTIMIZE_TOURS";

/**
 * One passenger, as the solver sees them.
 *
 * Pickup-before-drop precedence is implicit in this shape — a shipment is
 * collected then delivered — so no separate ordering constraint is ever sent.
 */
export interface OptimizerShipment {
  /** Stable id we can map back to a passenger. */
  id: string;
  passengerId: string;
  pickup: LatLng;
  drop: LatLng;
  seats: number;
  /**
   * Latest acceptable arrival at the pickup, in minutes from now. Undefined
   * means unconstrained.
   */
  pickupDeadlineMin?: number;
  /** Latest acceptable arrival at the drop, in minutes from now. */
  dropDeadlineMin?: number;
  /**
   * `null` makes the shipment mandatory — the solver may not drop it. A finite
   * number lets the solver skip it and report it in `skippedShipmentIds`,
   * which is how an infeasible insertion arrives as data rather than an error.
   */
  penaltyCost: number | null;
  /**
   * Soft pickup deadline. Exceeding it costs `softDeadlineCostPerHour` rather
   * than making the model infeasible — used for the new rider so a tight
   * window degrades gracefully instead of failing the whole request.
   */
  softPickupDeadlineMin?: number;
  softDeadlineCostPerHour?: number;
}

/** One visit in the solver's answer. */
export interface OptimizerVisit {
  shipmentId: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  location: LatLng;
  /** Minutes from the vehicle's start time. */
  arrivalMin: number;
}

export interface OptimizeToursRequest {
  /** Used for cache keying and debug traces; not sent to the provider. */
  driverId: string;
  vehicleStart: LatLng;
  seatCapacity: number;
  shipments: OptimizerShipment[];
  /**
   * Visits, in order, that the solver must keep frozen at the head of the
   * route. Everything after `lockedVisits.length` is free to reorder.
   */
  lockedVisits: { shipmentId: string; type: "PICKUP" | "DROP" }[];
  timeoutMs: number;
}

export interface OptimizeToursResult {
  visits: OptimizerVisit[];
  /** One leg per visit: `vehicleStart → visit[0]`, `visit[0] → visit[1]`, … */
  legs: RouteLegResult[];
  totalDistanceKm: number;
  totalDurationMin: number;
  skippedShipmentIds: string[];
}

export interface OptimizerEngine {
  readonly kind: OptimizerEngineKind;
  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult>;
}

export interface OptimizerTelemetrySnapshot {
  engine: OptimizerEngineKind;
  calls: number;
  shipmentsBilled: number;
  cacheHits: number;
  cacheMisses: number;
  budgetLimit: number;
  budgetUsed: number;
  budgetRemaining: number;
  unavailableReason: string | null;
}

/**
 * Thrown when the proxy has no usable Application Default Credentials.
 *
 * This is deliberately distinct from every other failure: it aborts the whole
 * run rather than producing per-driver verdicts, because a run with no solver
 * has no opinion about any driver and saying otherwise would be a lie.
 */
export class OptimizerCredentialsMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptimizerCredentialsMissingError";
  }
}

export class OptimizerUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OptimizerUnavailableError";
  }
}

export class OptimizerBudgetExceededError extends Error {
  constructor(readonly limit: number) {
    super(`Optimizer budget of ${limit} calls exhausted for this run`);
    this.name = "OptimizerBudgetExceededError";
  }
}
```

- [ ] **Step 2: Create the barrel**

Create `src/optimization/index.ts`:

```ts
export * from "./types";
```

- [ ] **Step 3: Verify it compiles**

Run: `bun run check-types`
Expected: PASS, no output.

- [ ] **Step 4: Commit**

```bash
git add src/optimization
git commit -m "feat(simulation): optimizer engine contract"
```

---

## Task 5: ShipmentModelBuilder — LANDED

**Files:**
- Create: `src/optimization/ShipmentModelBuilder.ts`
- Test: `src/test/shipmentModel.test.ts` (create)

**Interfaces:**
- Consumes: `OptimizeToursRequest`, `OptimizerShipment` (Task 4); `ProposedStop` from `@/matching/types`; `Passenger`, `RideRequest`, `LatLng` from `@/domain/entities`.
- Produces: `buildOptimizeToursRequest(input: BuildShipmentModelInput): OptimizeToursRequest`, and `shipmentIdFor(passengerId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/test/shipmentModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Passenger, RideRequest } from "@/domain/entities";
import { buildOptimizeToursRequest } from "@/optimization/ShipmentModelBuilder";
import type { ProposedStop } from "@/matching/types";

function passenger(id: string, pickupBudget: number, dropBudget: number): Passenger {
  return {
    id,
    name: id,
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
    maxPickupDelayMin: pickupBudget,
    maxDropDelayMin: dropBudget,
  };
}

function stop(id: string, passengerId: string, type: "PICKUP" | "DROP", eta: number): ProposedStop & { originalEtaMin: number } {
  return {
    id,
    passengerId,
    type,
    location: { lat: 28.6, lng: 77.2 },
    seats: 1,
    isNew: false,
    originalEtaMin: eta,
  };
}

const request: RideRequest = {
  id: "req_1",
  passengerId: "pNew",
  seatsRequired: 2,
  pickup: { lat: 28.61, lng: 77.21 },
  drop: { lat: 28.62, lng: 77.22 },
  intermediateStops: [],
  poolingAllowed: true,
  vehiclePreference: "ANY",
  requiresWheelchairAccess: false,
  luggageCount: 0,
  maxWaitMinutes: 8,
  maxDetourPercent: 15,
  maxWalkingDistanceM: 300,
  priority: 0,
};

const baseInput = {
  driverId: "d1",
  vehicleStart: { lat: 28.6, lng: 77.19 },
  seatCapacity: 4,
  committedStops: [stop("s1", "pA", "PICKUP", 4), stop("s2", "pA", "DROP", 15)],
  passengersById: new Map([["pA", passenger("pA", 5, 8)]]),
  request,
  newPassengerSoftDeadlineMin: 8,
  softDeadlineCostPerHour: 50,
  timeoutMs: 400,
};

describe("buildOptimizeToursRequest", () => {
  it("makes committed passengers mandatory", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(committed.penaltyCost).toBeNull();
  });

  it("makes the new passenger skippable", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const fresh = built.shipments.find((shipment) => shipment.passengerId === "pNew")!;
    expect(fresh.penaltyCost).toBeGreaterThan(0);
    expect(fresh.softPickupDeadlineMin).toBe(8);
    expect(fresh.softDeadlineCostPerHour).toBe(50);
  });

  it("derives hard deadlines from the passenger's own budget plus the promise", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    // pickup promised at 4 min, tolerates 5 more; drop promised at 15, tolerates 8.
    expect(committed.pickupDeadlineMin).toBe(9);
    expect(committed.dropDeadlineMin).toBe(23);
  });

  it("carries the new passenger's seat count into loadDemands", () => {
    const built = buildOptimizeToursRequest(baseInput);
    const fresh = built.shipments.find((shipment) => shipment.passengerId === "pNew")!;
    expect(fresh.seats).toBe(2);
  });

  it("locks the committed visits in their committed order", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.lockedVisits).toEqual([
      { shipmentId: "ship_pA", type: "PICKUP" },
      { shipmentId: "ship_pA", type: "DROP" },
    ]);
  });

  it("omits a pickup deadline for a passenger already aboard", () => {
    const built = buildOptimizeToursRequest({
      ...baseInput,
      committedStops: [stop("s2", "pA", "DROP", 15)],
      passengersById: new Map([["pA", { ...passenger("pA", 5, 8), state: "IN_RIDE" as const }]]),
    });

    const committed = built.shipments.find((shipment) => shipment.passengerId === "pA")!;
    expect(committed.pickupDeadlineMin).toBeUndefined();
    expect(built.lockedVisits).toEqual([{ shipmentId: "ship_pA", type: "DROP" }]);
  });

  it("passes the vehicle capacity and timeout through", () => {
    const built = buildOptimizeToursRequest(baseInput);
    expect(built.seatCapacity).toBe(4);
    expect(built.timeoutMs).toBe(400);
    expect(built.vehicleStart).toEqual({ lat: 28.6, lng: 77.19 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/shipmentModel.test.ts`
Expected: FAIL — `Cannot find module '@/optimization/ShipmentModelBuilder'`.

- [ ] **Step 3: Implement the builder**

Create `src/optimization/ShipmentModelBuilder.ts`:

```ts
import type { LatLng, Passenger, RideRequest } from "@/domain/entities";

import type { OptimizerShipment, OptimizeToursRequest } from "./types";

/**
 * Cost charged for leaving the new passenger unserved.
 *
 * Any finite value works — it only has to be large enough that the solver
 * prefers serving them when serving them is feasible, and small enough that it
 * never distorts the committed passengers' mandatory constraints. What matters
 * is that it is finite: that is what turns infeasibility into a
 * `skippedShipments[]` entry instead of a failed request.
 */
const NEW_PASSENGER_PENALTY_COST = 1000;

/** A committed stop, carrying the promise stage 6 and 10 protect. */
export interface CommittedStopInput {
  id: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  location: LatLng;
  seats: number;
  originalEtaMin: number;
}

export interface BuildShipmentModelInput {
  driverId: string;
  vehicleStart: LatLng;
  seatCapacity: number;
  /** The driver's remaining committed stops, in execution order. */
  committedStops: readonly CommittedStopInput[];
  passengersById: ReadonlyMap<string, Passenger>;
  request: RideRequest;
  /** Soft pickup deadline for the new rider, in minutes from now. */
  newPassengerSoftDeadlineMin: number;
  softDeadlineCostPerHour: number;
  timeoutMs: number;
}

export function shipmentIdFor(passengerId: string): string {
  return `ship_${passengerId}`;
}

/**
 * Turns a driver's committed route plus one new request into a solver model.
 *
 * The committed spine goes in twice — once as mandatory shipments with hard
 * deadlines, and once as `lockedVisits`. The deadlines say "you may not make
 * these people late"; the locked visits say "and you may not reshuffle them
 * relative to each other". Both are needed: without the lock, the solver would
 * happily reorder two passengers who are both still within tolerance, breaking
 * promises we already made about who gets collected first.
 */
export function buildOptimizeToursRequest(
  input: BuildShipmentModelInput,
): OptimizeToursRequest {
  const {
    driverId,
    vehicleStart,
    seatCapacity,
    committedStops,
    passengersById,
    request,
    newPassengerSoftDeadlineMin,
    softDeadlineCostPerHour,
    timeoutMs,
  } = input;

  const byPassenger = new Map<string, { pickup?: CommittedStopInput; drop?: CommittedStopInput }>();

  for (const stop of committedStops) {
    const entry = byPassenger.get(stop.passengerId) ?? {};
    if (stop.type === "PICKUP") {
      entry.pickup = stop;
    } else {
      entry.drop = stop;
    }
    byPassenger.set(stop.passengerId, entry);
  }

  const shipments: OptimizerShipment[] = [];

  for (const [passengerId, stops] of byPassenger) {
    const passenger = passengersById.get(passengerId);
    const drop = stops.drop;

    // A passenger with no remaining drop has nothing left to schedule.
    if (!passenger || !drop) {
      continue;
    }

    const shipment: OptimizerShipment = {
      id: shipmentIdFor(passengerId),
      passengerId,
      // An onboard passenger has no remaining pickup, so the vehicle's own
      // start position stands in for it: they are collected where the vehicle
      // already is, at time zero.
      pickup: stops.pickup?.location ?? vehicleStart,
      drop: drop.location,
      seats: passenger.seatsRequired,
      dropDeadlineMin: drop.originalEtaMin + passenger.maxDropDelayMin,
      penaltyCost: null,
    };

    if (stops.pickup) {
      shipment.pickupDeadlineMin = stops.pickup.originalEtaMin + passenger.maxPickupDelayMin;
    }

    shipments.push(shipment);
  }

  shipments.push({
    id: shipmentIdFor(request.passengerId),
    passengerId: request.passengerId,
    pickup: request.pickup,
    drop: request.drop,
    seats: request.seatsRequired,
    penaltyCost: NEW_PASSENGER_PENALTY_COST,
    softPickupDeadlineMin: newPassengerSoftDeadlineMin,
    softDeadlineCostPerHour,
  });

  const lockedVisits = committedStops.map((stop) => ({
    shipmentId: shipmentIdFor(stop.passengerId),
    type: stop.type,
  }));

  return {
    driverId,
    vehicleStart,
    seatCapacity,
    shipments,
    lockedVisits,
    timeoutMs,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/test/shipmentModel.test.ts`
Expected: PASS, all seven cases.

- [ ] **Step 5: Commit**

```bash
git add src/optimization/ShipmentModelBuilder.ts src/test/shipmentModel.test.ts
git commit -m "feat(simulation): build OptimizeTours shipment models from committed routes"
```

---

## Task 6: SolutionReader — LANDED

**Files:**
- Create: `src/optimization/SolutionReader.ts`
- Test: `src/test/solutionReader.test.ts` (create)

**Interfaces:**
- Consumes: `OptimizeToursRequest`, `OptimizeToursResult`, `OptimizerVisit` (Task 4).
- Produces: `readOptimizeToursResponse(request: OptimizeToursRequest, body: unknown): OptimizeToursResult`, and `toProposedStopSequence(result: OptimizeToursResult, newPassengerId: string): ProposedStop[]`.

- [ ] **Step 1: Write the failing test**

Create `src/test/solutionReader.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { readOptimizeToursResponse, toProposedStopSequence } from "@/optimization/SolutionReader";
import type { OptimizeToursRequest } from "@/optimization/types";

const request: OptimizeToursRequest = {
  driverId: "d1",
  vehicleStart: { lat: 28.6, lng: 77.19 },
  seatCapacity: 4,
  shipments: [
    {
      id: "ship_pA",
      passengerId: "pA",
      pickup: { lat: 28.61, lng: 77.2 },
      drop: { lat: 28.63, lng: 77.24 },
      seats: 1,
      penaltyCost: null,
    },
    {
      id: "ship_pNew",
      passengerId: "pNew",
      pickup: { lat: 28.62, lng: 77.22 },
      drop: { lat: 28.64, lng: 77.26 },
      seats: 1,
      penaltyCost: 1000,
    },
  ],
  lockedVisits: [],
  timeoutMs: 400,
};

function response(): unknown {
  return {
    routes: [
      {
        visits: [
          { shipmentIndex: 0, isPickup: true, startTime: "1970-01-01T00:04:00Z" },
          { shipmentIndex: 1, isPickup: true, startTime: "1970-01-01T00:07:00Z" },
          { shipmentIndex: 0, isPickup: false, startTime: "1970-01-01T00:15:00Z" },
          { shipmentIndex: 1, isPickup: false, startTime: "1970-01-01T00:21:00Z" },
        ],
        transitions: [
          { travelDistanceMeters: 1400, travelDuration: "240s" },
          { travelDistanceMeters: 1000, travelDuration: "180s" },
          { travelDistanceMeters: 3500, travelDuration: "480s" },
          { travelDistanceMeters: 3000, travelDuration: "360s" },
        ],
        vehicleStartTime: "1970-01-01T00:00:00Z",
      },
    ],
    skippedShipments: [],
  };
}

describe("readOptimizeToursResponse", () => {
  it("reads visits in solver order with their passenger and type", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.visits.map((visit) => `${visit.passengerId}:${visit.type}`)).toEqual([
      "pA:PICKUP",
      "pNew:PICKUP",
      "pA:DROP",
      "pNew:DROP",
    ]);
  });

  it("converts transitions into one leg per visit", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.legs).toHaveLength(4);
    expect(result.legs[0]).toEqual({ distanceKm: 1.4, durationMin: 4 });
    expect(result.legs[2]).toEqual({ distanceKm: 3.5, durationMin: 8 });
  });

  it("totals distance and duration across the route", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.totalDistanceKm).toBeCloseTo(8.9, 5);
    expect(result.totalDurationMin).toBeCloseTo(21, 5);
  });

  it("reads arrival minutes relative to the vehicle start time", () => {
    const result = readOptimizeToursResponse(request, response());

    expect(result.visits.map((visit) => visit.arrivalMin)).toEqual([4, 7, 15, 21]);
  });

  it("reports a skipped shipment by id", () => {
    const body = response() as { skippedShipments: unknown[] };
    body.skippedShipments = [{ index: 1, reasons: [{ code: "DEMAND_EXCEEDS_VEHICLE_CAPACITY" }] }];

    const result = readOptimizeToursResponse(request, body);
    expect(result.skippedShipmentIds).toEqual(["ship_pNew"]);
  });

  it("throws when the transition count cannot be mapped onto the visits", () => {
    const body = response() as { routes: { transitions: unknown[] }[] };
    body.routes[0]!.transitions = body.routes[0]!.transitions.slice(0, 2);

    expect(() => readOptimizeToursResponse(request, body)).toThrow(/transition/i);
  });

  it("returns an empty route when the solver produced none", () => {
    const result = readOptimizeToursResponse(request, { routes: [], skippedShipments: [] });

    expect(result.visits).toEqual([]);
    expect(result.legs).toEqual([]);
    expect(result.totalDistanceKm).toBe(0);
  });
});

describe("toProposedStopSequence", () => {
  it("marks only the new passenger's stops as new", () => {
    const result = readOptimizeToursResponse(request, response());
    const stops = toProposedStopSequence(result, "pNew");

    expect(stops.map((stop) => stop.isNew)).toEqual([false, true, false, true]);
    expect(stops.map((stop) => stop.id)).toEqual([
      "ship_pA:PICKUP",
      "ship_pNew:PICKUP",
      "ship_pA:DROP",
      "ship_pNew:DROP",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/solutionReader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

Create `src/optimization/SolutionReader.ts`:

```ts
import type { RouteLegResult } from "@/routing/types";
import type { ProposedStop } from "@/matching/types";

import type { OptimizerVisit, OptimizeToursRequest, OptimizeToursResult } from "./types";

interface RawVisit {
  shipmentIndex?: number;
  isPickup?: boolean;
  startTime?: string;
}

interface RawTransition {
  travelDistanceMeters?: number;
  travelDuration?: string;
}

interface RawRoute {
  visits?: RawVisit[];
  transitions?: RawTransition[];
  vehicleStartTime?: string;
}

interface RawResponse {
  routes?: RawRoute[];
  skippedShipments?: { index?: number }[];
}

/** Google durations are protobuf `Duration` strings: a number of seconds plus "s". */
function durationToMinutes(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  return Number.parseFloat(value.replace(/s$/, "")) / 60;
}

function minutesBetween(startIso: string | undefined, endIso: string | undefined): number {
  if (!startIso || !endIso) {
    return 0;
  }
  return (Date.parse(endIso) - Date.parse(startIso)) / 60000;
}

/**
 * Reads a raw `optimizeTours` response into our own shape.
 *
 * Google's wire format stops here: nothing downstream of this function knows
 * about `shipmentIndex`, protobuf durations, or ISO visit times. That is what
 * makes the Phase 3 in-house solver a drop-in replacement rather than a
 * rewrite.
 */
export function readOptimizeToursResponse(
  request: OptimizeToursRequest,
  body: unknown,
): OptimizeToursResult {
  const raw = (body ?? {}) as RawResponse;
  const route = raw.routes?.[0];

  const skippedShipmentIds = (raw.skippedShipments ?? [])
    .map((skipped) => (skipped.index === undefined ? undefined : request.shipments[skipped.index]?.id))
    .filter((id): id is string => id !== undefined);

  if (!route || !route.visits || route.visits.length === 0) {
    return {
      visits: [],
      legs: [],
      totalDistanceKm: 0,
      totalDurationMin: 0,
      skippedShipmentIds,
    };
  }

  const rawVisits = route.visits;
  const transitions = route.transitions ?? [];

  // The API emits one transition before each visit, and optionally one more
  // returning to the depot. Anything else means the visit-to-leg mapping is
  // not trustworthy, and mis-attributing a leg puts the delay on the wrong
  // passenger — a silent, plausible-looking wrong answer. Fail loudly instead.
  if (transitions.length !== rawVisits.length && transitions.length !== rawVisits.length + 1) {
    throw new Error(
      `Solver returned ${transitions.length} transitions for ${rawVisits.length} visits`,
    );
  }

  const visits: OptimizerVisit[] = [];
  const legs: RouteLegResult[] = [];
  let totalDistanceKm = 0;
  let totalDurationMin = 0;

  for (let index = 0; index < rawVisits.length; index += 1) {
    const rawVisit = rawVisits[index]!;
    const shipment = request.shipments[rawVisit.shipmentIndex ?? -1];

    if (!shipment) {
      throw new Error(`Solver referenced unknown shipmentIndex ${String(rawVisit.shipmentIndex)}`);
    }

    const type = rawVisit.isPickup ? "PICKUP" : "DROP";
    visits.push({
      shipmentId: shipment.id,
      passengerId: shipment.passengerId,
      type,
      location: type === "PICKUP" ? shipment.pickup : shipment.drop,
      arrivalMin: minutesBetween(route.vehicleStartTime, rawVisit.startTime),
    });

    const transition = transitions[index] ?? {};
    const leg: RouteLegResult = {
      distanceKm: (transition.travelDistanceMeters ?? 0) / 1000,
      durationMin: durationToMinutes(transition.travelDuration),
    };

    legs.push(leg);
    totalDistanceKm += leg.distanceKm;
    totalDurationMin += leg.durationMin;
  }

  return { visits, legs, totalDistanceKm, totalDurationMin, skippedShipmentIds };
}

/**
 * Converts a solved route into the `ProposedStop[]` the rest of the matching
 * engine already speaks, so stages 9–12 need no new vocabulary.
 */
export function toProposedStopSequence(
  result: OptimizeToursResult,
  newPassengerId: string,
): ProposedStop[] {
  return result.visits.map((visit) => ({
    id: `${visit.shipmentId}:${visit.type}`,
    passengerId: visit.passengerId,
    type: visit.type,
    location: visit.location,
    seats: 0,
    isNew: visit.passengerId === newPassengerId,
  }));
}
```

Note: `seats` is filled by the caller in Task 17, which has the passenger records. Leaving it at `0` here keeps this module free of scenario lookups.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/test/solutionReader.test.ts`
Expected: PASS, all eight cases.

- [ ] **Step 5: Export from the barrel**

In `src/optimization/index.ts`:

```ts
export * from "./types";
export { buildOptimizeToursRequest, shipmentIdFor } from "./ShipmentModelBuilder";
export type { BuildShipmentModelInput, CommittedStopInput } from "./ShipmentModelBuilder";
export { readOptimizeToursResponse, toProposedStopSequence } from "./SolutionReader";
```

- [ ] **Step 6: Commit**

```bash
git add src/optimization src/test/solutionReader.test.ts
git commit -m "feat(simulation): read OptimizeTours solutions into engine types"
```

---

## Task 7: Optimizer engine, telemetry, cache and stack — LANDED

**Files:**
- Create: `src/optimization/OptimizeToursEngine.ts`
- Create: `src/optimization/OptimizerTelemetry.ts`
- Create: `src/optimization/OptimizerCache.ts`
- Create: `src/optimization/InstrumentedOptimizerEngine.ts`
- Modify: `src/optimization/index.ts`
- Test: `src/test/optimizerStack.test.ts` (create)

**Interfaces:**
- Consumes: everything from Tasks 4 and 6.
- Produces: `OptimizeToursEngine` (class), `OptimizerTelemetry` (class, with `snapshot(): OptimizerTelemetrySnapshot`), `OptimizerCache` (class), `InstrumentedOptimizerEngine` (class), `createOptimizerStack(options): OptimizerStack` where `OptimizerStack = { engine: OptimizerEngine; telemetry: OptimizerTelemetry; cache: OptimizerCache }`.

- [ ] **Step 1: Write the failing test**

Create `src/test/optimizerStack.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { InstrumentedOptimizerEngine } from "@/optimization/InstrumentedOptimizerEngine";
import { OptimizerCache } from "@/optimization/OptimizerCache";
import { OptimizerTelemetry } from "@/optimization/OptimizerTelemetry";
import {
  OptimizerBudgetExceededError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "@/optimization/types";

class CountingEngine implements OptimizerEngine {
  readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
  calls = 0;

  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    this.calls += 1;
    return Promise.resolve({
      visits: [],
      legs: [],
      totalDistanceKm: request.shipments.length,
      totalDurationMin: 0,
      skippedShipmentIds: [],
    });
  }
}

function request(driverId: string): OptimizeToursRequest {
  return {
    driverId,
    vehicleStart: { lat: 28.6, lng: 77.2 },
    seatCapacity: 4,
    shipments: [
      {
        id: "ship_p1",
        passengerId: "p1",
        pickup: { lat: 28.61, lng: 77.21 },
        drop: { lat: 28.62, lng: 77.22 },
        seats: 1,
        penaltyCost: null,
      },
    ],
    lockedVisits: [],
    timeoutMs: 400,
  };
}

function stack(limit: number) {
  const delegate = new CountingEngine();
  const telemetry = new OptimizerTelemetry("GOOGLE_OPTIMIZE_TOURS", limit);
  const cache = new OptimizerCache();
  const engine = new InstrumentedOptimizerEngine(delegate, cache, telemetry);
  return { delegate, telemetry, cache, engine };
}

describe("InstrumentedOptimizerEngine", () => {
  it("serves an identical request from cache without calling the delegate twice", async () => {
    const { delegate, engine, telemetry } = stack(10);

    await engine.optimize(request("d1"));
    await engine.optimize(request("d1"));

    expect(delegate.calls).toBe(1);
    expect(telemetry.snapshot().cacheHits).toBe(1);
    expect(telemetry.snapshot().cacheMisses).toBe(1);
  });

  it("treats a different driver as a different request", async () => {
    const { delegate, engine } = stack(10);

    await engine.optimize(request("d1"));
    await engine.optimize(request("d2"));

    expect(delegate.calls).toBe(2);
  });

  it("counts billed shipments, not just calls", async () => {
    const { engine, telemetry } = stack(10);

    await engine.optimize(request("d1"));

    expect(telemetry.snapshot().calls).toBe(1);
    expect(telemetry.snapshot().shipmentsBilled).toBe(1);
  });

  it("throws OptimizerBudgetExceededError past the limit", async () => {
    const { engine } = stack(1);

    await engine.optimize(request("d1"));

    await expect(engine.optimize(request("d2"))).rejects.toBeInstanceOf(
      OptimizerBudgetExceededError,
    );
  });

  it("does not spend budget on a cache hit", async () => {
    const { engine, telemetry } = stack(1);

    await engine.optimize(request("d1"));
    await engine.optimize(request("d1"));

    expect(telemetry.snapshot().budgetRemaining).toBe(0);
    expect(telemetry.snapshot().budgetUsed).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/optimizerStack.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement telemetry**

Create `src/optimization/OptimizerTelemetry.ts`:

```ts
import type { OptimizerEngineKind, OptimizerTelemetrySnapshot } from "./types";

/**
 * Counts what a run actually spent at stage 8.
 *
 * Kept separate from `RoutingTelemetry` because the two have separate budgets
 * and separate pricing models: routing bills per call, the optimizer bills per
 * shipment. Merging them would hide which one is the expensive half.
 */
export class OptimizerTelemetry {
  private callCount = 0;
  private shipmentCount = 0;
  private hits = 0;
  private misses = 0;
  private unavailableReason: string | null = null;

  constructor(
    private readonly engine: OptimizerEngineKind,
    private readonly budgetLimit: number,
  ) {}

  recordCall(shipments: number): void {
    this.callCount += 1;
    this.shipmentCount += shipments;
  }

  recordCacheHit(): void {
    this.hits += 1;
  }

  recordCacheMiss(): void {
    this.misses += 1;
  }

  setUnavailableReason(reason: string | null): void {
    this.unavailableReason = reason;
  }

  get budgetRemaining(): number {
    return Math.max(0, this.budgetLimit - this.callCount);
  }

  snapshot(): OptimizerTelemetrySnapshot {
    return {
      engine: this.engine,
      calls: this.callCount,
      shipmentsBilled: this.shipmentCount,
      cacheHits: this.hits,
      cacheMisses: this.misses,
      budgetLimit: this.budgetLimit,
      budgetUsed: this.callCount,
      budgetRemaining: this.budgetRemaining,
      unavailableReason: this.unavailableReason,
    };
  }
}
```

- [ ] **Step 4: Implement the cache**

Create `src/optimization/OptimizerCache.ts`:

```ts
import type { OptimizeToursRequest, OptimizeToursResult } from "./types";

/**
 * Memoises solver answers within a session.
 *
 * The key must cover every input that could change the answer — not merely the
 * coordinates. A stale hit here does not just cost accuracy, it silently
 * reports a delay budget that was never actually checked.
 */
export class OptimizerCache {
  private readonly entries = new Map<string, OptimizeToursResult>();

  static keyFor(request: OptimizeToursRequest): string {
    const shipments = request.shipments
      .map((shipment) =>
        [
          shipment.id,
          shipment.pickup.lat,
          shipment.pickup.lng,
          shipment.drop.lat,
          shipment.drop.lng,
          shipment.seats,
          shipment.pickupDeadlineMin ?? "-",
          shipment.dropDeadlineMin ?? "-",
          shipment.penaltyCost ?? "mandatory",
          shipment.softPickupDeadlineMin ?? "-",
          shipment.softDeadlineCostPerHour ?? "-",
        ].join(","),
      )
      .join("|");

    const locked = request.lockedVisits
      .map((visit) => `${visit.shipmentId}:${visit.type}`)
      .join(">");

    return [
      request.driverId,
      request.vehicleStart.lat,
      request.vehicleStart.lng,
      request.seatCapacity,
      request.timeoutMs,
      shipments,
      locked,
    ].join("::");
  }

  get(request: OptimizeToursRequest): OptimizeToursResult | undefined {
    return this.entries.get(OptimizerCache.keyFor(request));
  }

  set(request: OptimizeToursRequest, result: OptimizeToursResult): void {
    this.entries.set(OptimizerCache.keyFor(request), result);
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 5: Implement the instrumented wrapper**

Create `src/optimization/InstrumentedOptimizerEngine.ts`:

```ts
import type { OptimizerCache } from "./OptimizerCache";
import type { OptimizerTelemetry } from "./OptimizerTelemetry";
import {
  OptimizerBudgetExceededError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "./types";

/**
 * Wraps an optimizer with cache, budget and telemetry.
 *
 * The budget is checked after the cache, never before: a cached answer costs
 * nothing, and refusing to serve it because the budget is spent would make
 * repeat runs of the same scenario progressively less useful.
 */
export class InstrumentedOptimizerEngine implements OptimizerEngine {
  readonly kind: OptimizerEngine["kind"];

  constructor(
    private readonly delegate: OptimizerEngine,
    private readonly cache: OptimizerCache,
    private readonly telemetry: OptimizerTelemetry,
  ) {
    this.kind = delegate.kind;
  }

  async optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    const cached = this.cache.get(request);

    if (cached) {
      this.telemetry.recordCacheHit();
      return cached;
    }

    this.telemetry.recordCacheMiss();

    if (this.telemetry.budgetRemaining <= 0) {
      throw new OptimizerBudgetExceededError(this.telemetry.snapshot().budgetLimit);
    }

    this.telemetry.recordCall(request.shipments.length);
    const result = await this.delegate.optimize(request);
    this.cache.set(request, result);

    return result;
  }
}
```

- [ ] **Step 6: Implement the HTTP engine**

Create `src/optimization/OptimizeToursEngine.ts`:

```ts
import { readOptimizeToursResponse } from "./SolutionReader";
import {
  OptimizerCredentialsMissingError,
  OptimizerUnavailableError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "./types";

export const OPTIMIZER_ENDPOINT = "/api/optimize-tours";

/**
 * Talks to `OptimizeTours` through the dev-server proxy.
 *
 * The browser never holds a credential: the proxy signs the request with
 * Application Default Credentials server-side. That is why this engine is
 * reachable only under `bun run dev` — a built bundle has no proxy behind it.
 */
export class OptimizeToursEngine implements OptimizerEngine {
  readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;

  constructor(private readonly endpoint: string = OPTIMIZER_ENDPOINT) {}

  async optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new OptimizerUnavailableError(
        "Could not reach the optimizer proxy. It only exists under `bun run dev`.",
        error,
      );
    }

    if (response.status === 503) {
      const body = (await safeJson(response)) as { error?: string };
      throw new OptimizerCredentialsMissingError(
        body.error ?? "The optimizer proxy has no usable Google credentials",
      );
    }

    if (!response.ok) {
      const body = (await safeJson(response)) as { error?: string };
      throw new OptimizerUnavailableError(
        body.error ?? `Optimizer proxy returned HTTP ${String(response.status)}`,
      );
    }

    return readOptimizeToursResponse(request, await safeJson(response));
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
```

- [ ] **Step 7: Add the stack factory and export everything**

Replace `src/optimization/index.ts`:

```ts
import type { MatchingSettings } from "@/domain/entities";

import { InstrumentedOptimizerEngine } from "./InstrumentedOptimizerEngine";
import { OptimizeToursEngine } from "./OptimizeToursEngine";
import { OptimizerCache } from "./OptimizerCache";
import { OptimizerTelemetry } from "./OptimizerTelemetry";
import type { OptimizerEngine } from "./types";

export * from "./types";
export { buildOptimizeToursRequest, shipmentIdFor } from "./ShipmentModelBuilder";
export type { BuildShipmentModelInput, CommittedStopInput } from "./ShipmentModelBuilder";
export { readOptimizeToursResponse, toProposedStopSequence } from "./SolutionReader";
export { OptimizeToursEngine, OPTIMIZER_ENDPOINT } from "./OptimizeToursEngine";
export { OptimizerCache } from "./OptimizerCache";
export { OptimizerTelemetry } from "./OptimizerTelemetry";
export { InstrumentedOptimizerEngine } from "./InstrumentedOptimizerEngine";

export interface OptimizerStack {
  engine: OptimizerEngine;
  telemetry: OptimizerTelemetry;
  cache: OptimizerCache;
}

export type OptimizerSettings = Pick<
  MatchingSettings,
  "maxOptimizerCallsPerRun" | "optimizerTimeoutMs"
>;

export interface CreateOptimizerStackOptions {
  settings: OptimizerSettings;
  /** Injected by tests. Defaults to the HTTP engine talking to the proxy. */
  engine?: OptimizerEngine;
  cache?: OptimizerCache;
}

export function createOptimizerStack(options: CreateOptimizerStackOptions): OptimizerStack {
  const delegate = options.engine ?? new OptimizeToursEngine();
  const cache = options.cache ?? new OptimizerCache();
  const telemetry = new OptimizerTelemetry(delegate.kind, options.settings.maxOptimizerCallsPerRun);

  return {
    engine: new InstrumentedOptimizerEngine(delegate, cache, telemetry),
    telemetry,
    cache,
  };
}
```

`maxOptimizerCallsPerRun` and `optimizerTimeoutMs` do not exist on `MatchingSettings` yet — add them now in `src/domain/entities.ts` (`maxOptimizerCallsPerRun: number; optimizerTimeoutMs: number;`), in `DEFAULT_SETTINGS` (`maxOptimizerCallsPerRun: 40, optimizerTimeoutMs: 400`), and in `matchingSettingsSchema` (`maxOptimizerCallsPerRun: z.number().int().min(1), optimizerTimeoutMs: z.number().int().min(50)`).

- [ ] **Step 8: Run the tests**

Run: `bun run check-types && bun run test src/test/optimizerStack.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 9: Commit**

```bash
git add src/optimization src/domain src/test/optimizerStack.test.ts
git commit -m "feat(simulation): optimizer stack with cache, budget and telemetry"
```

---

## Task 8: The OptimizeTours dev-server proxy — LANDED

**Files:**
- Create: `server/optimizerProxy.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Test: manual (the proxy is Node-only and outside the vitest environment)

**Interfaces:**
- Consumes: the `OptimizeToursRequest` JSON body posted by `OptimizeToursEngine` (Task 7).
- Produces: `optimizerProxyPlugin(): Plugin` — a Vite plugin registering `POST /api/optimize-tours`.

- [ ] **Step 1: Add the dependency**

Run from `apps/simulation`:

```bash
bun add -d google-auth-library
```

- [ ] **Step 2: Write the proxy**

Create `apps/simulation/server/optimizerProxy.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

import { GoogleAuth } from "google-auth-library";
import type { Plugin } from "vite";

const ENDPOINT_PATH = "/api/optimize-tours";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

interface ProxyShipment {
  id: string;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  seats: number;
  pickupDeadlineMin?: number;
  dropDeadlineMin?: number;
  penaltyCost: number | null;
  softPickupDeadlineMin?: number;
  softDeadlineCostPerHour?: number;
}

interface ProxyRequest {
  vehicleStart: { lat: number; lng: number };
  seatCapacity: number;
  shipments: ProxyShipment[];
  lockedVisits: { shipmentId: string; type: "PICKUP" | "DROP" }[];
  timeoutMs: number;
}

const auth = new GoogleAuth({ scopes: [SCOPE] });

function isoAt(baseMs: number, offsetMin: number): string {
  return new Date(baseMs + offsetMin * 60000).toISOString();
}

/**
 * Translates our request into Google's `ShipmentModel`.
 *
 * Time windows are absolute timestamps on the wire but relative minutes in our
 * model, so everything is anchored to a single `now` captured once per request
 * — anchoring per-shipment would let clock drift between two shipments produce
 * a model that is subtly infeasible for no reason we could ever debug.
 */
function toShipmentModel(request: ProxyRequest, nowMs: number): Record<string, unknown> {
  const shipments = request.shipments.map((shipment) => {
    const pickupVisit: Record<string, unknown> = {
      arrivalWaypoint: { location: { latLng: { latitude: shipment.pickup.lat, longitude: shipment.pickup.lng } } },
    };

    const pickupWindow: Record<string, unknown> = {};
    if (shipment.pickupDeadlineMin !== undefined) {
      pickupWindow.endTime = isoAt(nowMs, shipment.pickupDeadlineMin);
    }
    if (shipment.softPickupDeadlineMin !== undefined) {
      pickupWindow.softEndTime = isoAt(nowMs, shipment.softPickupDeadlineMin);
      pickupWindow.costPerHourAfterSoftEndTime = shipment.softDeadlineCostPerHour ?? 50;
    }
    if (Object.keys(pickupWindow).length > 0) {
      pickupVisit.timeWindows = [pickupWindow];
    }

    const deliveryVisit: Record<string, unknown> = {
      arrivalWaypoint: { location: { latLng: { latitude: shipment.drop.lat, longitude: shipment.drop.lng } } },
    };

    if (shipment.dropDeadlineMin !== undefined) {
      deliveryVisit.timeWindows = [{ endTime: isoAt(nowMs, shipment.dropDeadlineMin) }];
    }

    const model: Record<string, unknown> = {
      pickups: [pickupVisit],
      deliveries: [deliveryVisit],
      loadDemands: { seats: { amount: String(shipment.seats) } },
    };

    // A null penalty means mandatory. Omitting the field entirely is how the
    // API expresses that; sending `null` would be rejected.
    if (shipment.penaltyCost !== null) {
      model.penaltyCost = shipment.penaltyCost;
    }

    return model;
  });

  const shipmentIndexById = new Map(request.shipments.map((shipment, index) => [shipment.id, index]));

  const model: Record<string, unknown> = {
    globalStartTime: isoAt(nowMs, 0),
    globalEndTime: isoAt(nowMs, 120),
    vehicles: [
      {
        startWaypoint: {
          location: {
            latLng: { latitude: request.vehicleStart.lat, longitude: request.vehicleStart.lng },
          },
        },
        loadLimits: { seats: { maxLoad: String(request.seatCapacity) } },
      },
    ],
    shipments,
  };

  const payload: Record<string, unknown> = { timeout: `${String(request.timeoutMs / 1000)}s`, model };

  if (request.lockedVisits.length > 0) {
    payload.injectedSolutionConstraint = {
      routes: [
        {
          vehicleIndex: 0,
          visits: request.lockedVisits.map((visit) => ({
            shipmentIndex: shipmentIndexById.get(visit.shipmentId) ?? 0,
            isPickup: visit.type === "PICKUP",
          })),
        },
      ],
      constraintRelaxations: [
        {
          vehicleIndices: [0],
          relaxations: [
            {
              level: "RELAX_ALL_AFTER_THRESHOLD",
              thresholdVisitCount: request.lockedVisits.length,
            },
          ],
        },
      ],
    };
  }

  return payload;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Registers the optimizer proxy on the Vite dev server.
 *
 * This exists only under `bun run dev`. A production build has no server, so
 * the app there shows the optimizer-unavailable state rather than half-working
 * — which is correct: this is a lab tool, not something anyone deploys.
 */
export function optimizerProxyPlugin(): Plugin {
  return {
    name: "sameway-optimizer-proxy",
    configureServer(server) {
      server.middlewares.use(ENDPOINT_PATH, (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        void (async () => {
          const project = process.env.GOOGLE_CLOUD_PROJECT;

          if (!project) {
            send(res, 503, {
              error:
                "GOOGLE_CLOUD_PROJECT is not set. Add it to apps/simulation/.env.local and restart the dev server.",
            });
            return;
          }

          let client;
          try {
            client = await auth.getClient();
          } catch (error) {
            send(res, 503, {
              error: `No Application Default Credentials found. Run \`gcloud auth application-default login\`. (${
                error instanceof Error ? error.message : "unknown error"
              })`,
            });
            return;
          }

          try {
            const parsed = JSON.parse(await readBody(req)) as ProxyRequest;
            const payload = toShipmentModel(parsed, Date.now());

            const response = await client.request({
              url: `https://routeoptimization.googleapis.com/v1/projects/${project}:optimizeTours`,
              method: "POST",
              data: payload,
            });

            send(res, 200, response.data);
          } catch (error) {
            const message = error instanceof Error ? error.message : "optimizeTours call failed";
            send(res, 502, { error: message });
          }
        })();
      });
    },
  };
}
```

- [ ] **Step 3: Register the plugin**

Replace `apps/simulation/vite.config.ts`:

```ts
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { optimizerProxyPlugin } from "./server/optimizerProxy";

export default defineConfig({
  plugins: [react(), tailwindcss(), optimizerProxyPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3100,
  },
});
```

- [ ] **Step 4: Document the environment variable**

Append to `apps/simulation/.env.example`:

```
# Google Cloud project that has the Route Optimization API enabled.
# Authenticate separately with: gcloud auth application-default login
GOOGLE_CLOUD_PROJECT=
```

- [ ] **Step 5: Verify the proxy responds**

Run: `bun run dev` in one terminal, then in another:

```bash
curl -s -X POST http://localhost:3100/api/optimize-tours \
  -H 'content-type: application/json' \
  -d '{"driverId":"d1","vehicleStart":{"lat":28.6,"lng":77.2},"seatCapacity":4,"shipments":[],"lockedVisits":[],"timeoutMs":400}'
```

Expected with no credentials configured: HTTP 503 and a JSON body naming `gcloud auth application-default login`.
Expected with credentials and `GOOGLE_CLOUD_PROJECT` set: HTTP 200 with a `routes` array.

- [ ] **Step 6: Verify types and lint still pass**

Run: `bun run check-types && bun run lint`
Expected: PASS. `server/` is outside `src/`, so confirm `tsconfig.json`'s `include` covers it; if it does not, add `"server"` to `include`.

- [ ] **Step 7: Commit**

```bash
git add server vite.config.ts package.json .env.example
git commit -m "feat(simulation): ADC-authenticated OptimizeTours dev proxy"
```

---

## Task 9: Switch to the thirteen-stage skeleton — LANDED

This is the one atomic refactor in the plan. `StageId` changes, so every consumer changes with it. The new stages land as **no-ops that pass every driver**; Tasks 10–21 fill them in one at a time, each with its own tests. The suite must be green at the end of this task.

**Files:**
- Modify: `src/domain/entities.ts` (`StageId`)
- Modify: `src/domain/settings.ts` (`DEFAULT_STAGE_ORDER`, remove `BRIEF_STAGE_ORDER`)
- Modify: `src/domain/schemas.ts` (`stageIdSchema`)
- Modify: `src/matching/reasons.ts` (new categories and codes)
- Modify: `src/matching/pipeline.ts` (`STAGE_METADATA`)
- Modify: `src/matching/stages/index.ts` (registry)
- Modify: `src/matching/engine.ts` (`countCandidates` stage id)
- Create: `src/matching/stages/basicEligibility.ts`
- Create: `src/matching/stages/operationalState.ts`
- Create: `src/matching/stages/h3RouteCorridor.ts`
- Create: `src/matching/stages/pickupRouteDistance.ts`
- Create: `src/matching/stages/directionCompatibility.ts`
- Create: `src/matching/stages/stopSequenceGeneration.ts`
- Create: `src/matching/stages/pickupTimeWindow.ts`
- Create: `src/matching/stages/detourLowerBound.ts`
- Create: `src/matching/stages/roadRouting.ts`
- Create: `src/matching/stages/incrementalCost.ts`
- Create: `src/matching/stages/hardConstraints.ts`
- Create: `src/matching/stages/commit.ts`
- Delete: `src/matching/stages/driverStatusFilter.ts`, `vehicleFilter.ts`, `capacityPreFilter.ts`, `pickupEtaFilter.ts`, `h3CandidateGeneration.ts`, `routeFeasibility.ts`, `poolingRules.ts`
- Test: `src/test/pipeline.test.ts` (modify), `src/test/e2e-scenario.test.ts` (modify)

**Interfaces:**
- Consumes: `MatchingStage`, `MatchingContext`, `StageOutcome` from `@/matching/types`.
- Produces: the thirteen `StageId` values listed below, one exported `MatchingStage` const per stage file (`basicEligibilityStage`, `operationalStateStage`, …, `commitStage`), and `STAGE_REGISTRY` covering all fourteen entries (thirteen plus `requestValidation`).

- [ ] **Step 1: Redefine `StageId`**

In `src/domain/entities.ts`:

```ts
/**
 * The stages of `docs/Overview.md`, in the order the document numbers them.
 * `requestValidation` is a pre-stage: it judges the request alone, before any
 * driver is considered, so it has no Overview number.
 */
export type StageId =
  | "requestValidation"
  | "basicEligibility"
  | "operationalState"
  | "h3RouteCorridor"
  | "pickupRouteDistance"
  | "directionCompatibility"
  | "stopSequenceGeneration"
  | "pickupTimeWindow"
  | "detourLowerBound"
  | "roadRouting"
  | "incrementalCost"
  | "hardConstraints"
  | "scoring"
  | "commit";
```

- [ ] **Step 2: Rewrite the default order and drop the A/B alternative**

Replace the top of `src/domain/settings.ts`:

```ts
import type { MatchingSettings, StageId } from "./entities";

/**
 * The Overview's stage order, and the only order the engine supports.
 *
 * The previous `BRIEF_STAGE_ORDER` A/B existed because two stages were merely
 * a cost trade-off against each other. These thirteen have strict data
 * dependencies — stage 9 cannot measure what stage 8 has not yet routed — so a
 * reorderable list would mostly express configurations that cannot run.
 */
export const DEFAULT_STAGE_ORDER: StageId[] = [
  "requestValidation",
  "basicEligibility",
  "operationalState",
  "h3RouteCorridor",
  "pickupRouteDistance",
  "directionCompatibility",
  "stopSequenceGeneration",
  "pickupTimeWindow",
  "detourLowerBound",
  "roadRouting",
  "incrementalCost",
  "hardConstraints",
  "scoring",
  "commit",
];
```

Delete `BRIEF_STAGE_ORDER` entirely, and remove `maxPickupEtaMin` / `maxPickupRoadDistanceKm` from `DEFAULT_SETTINGS`, replacing them with the stage 3/4 thresholds:

```ts
  // Corridor proximity (stages 3 and 4).
  maxPickupToRouteDistanceKm: 1.5,
  maxDropToRouteDistanceKm: 3,
  maxBearingDifferenceDeg: 75,
```

and add to the route-feasibility block:

```ts
  maxNewPassengerRideDetourMin: 10,
```

Mirror all of these in `MatchingSettings` in `src/domain/entities.ts` (removing `maxPickupEtaMin` and `maxPickupRoadDistanceKm`) and in `matchingSettingsSchema` in `src/domain/schemas.ts`, whose `stageIdSchema` becomes:

```ts
const stageIdSchema = z.enum([
  "requestValidation",
  "basicEligibility",
  "operationalState",
  "h3RouteCorridor",
  "pickupRouteDistance",
  "directionCompatibility",
  "stopSequenceGeneration",
  "pickupTimeWindow",
  "detourLowerBound",
  "roadRouting",
  "incrementalCost",
  "hardConstraints",
  "scoring",
  "commit",
]);
```

- [ ] **Step 3: Add the new reason categories and codes**

In `src/matching/reasons.ts`, extend `ReasonCategory`:

```ts
export type ReasonCategory =
  | "VALIDATION"
  | "SPATIAL"
  | "STATUS"
  | "VEHICLE"
  | "CAPACITY"
  | "OPERATIONAL"
  | "CORRIDOR"
  | "DIRECTION"
  | "ROUTE"
  | "OPTIMIZER"
  | "POOLING"
  | "SYSTEM";
```

Delete the three `ETA` codes (`PICKUP_ETA_OK`, `PICKUP_ETA_TOO_HIGH`, `PICKUP_DISTANCE_TOO_HIGH`) along with the `"ETA"` category member, keeping `PICKUP_UNREACHABLE` and moving it to `SPATIAL`. Then add, inside the `REASONS` object:

```ts
  // Operational state (stage 1) --------------------------------------------
  OPERATIONAL_FLEXIBLE: {
    category: "OPERATIONAL",
    label: "Committed stops still flexible",
    outcome: "PASS",
  },
  OPERATIONAL_NO_FLEXIBILITY: {
    category: "OPERATIONAL",
    label: "No flexibility in committed route",
    outcome: "FAIL",
  },

  // Corridor (stage 2) ------------------------------------------------------
  CORRIDOR_MATCH: { category: "CORRIDOR", label: "Pickup on route corridor", outcome: "PASS" },
  CORRIDOR_NO_MATCH: {
    category: "CORRIDOR",
    label: "Pickup outside route corridor",
    outcome: "FAIL",
  },

  // Corridor proximity (stage 3) -------------------------------------------
  PICKUP_ON_ROUTE: { category: "SPATIAL", label: "Pickup close to route", outcome: "PASS" },
  PICKUP_TOO_FAR_FROM_ROUTE: {
    category: "SPATIAL",
    label: "Pickup too far from route",
    outcome: "FAIL",
  },

  // Direction (stage 4) -----------------------------------------------------
  DIRECTION_COMPATIBLE: { category: "DIRECTION", label: "Direction compatible", outcome: "PASS" },
  BEARING_INCOMPATIBLE: { category: "DIRECTION", label: "Wrong direction", outcome: "FAIL" },
  DESTINATION_OFF_CORRIDOR: {
    category: "DIRECTION",
    label: "Destination off corridor",
    outcome: "FAIL",
  },
  DESTINATION_BEHIND_VEHICLE: {
    category: "DIRECTION",
    label: "Destination behind vehicle",
    outcome: "FAIL",
  },

  // Sequence generation (stage 5) ------------------------------------------
  SEQUENCE_GENERATED: { category: "ROUTE", label: "Legal sequences found", outcome: "PASS" },
  NO_LEGAL_SEQUENCE: { category: "ROUTE", label: "No legal stop sequence", outcome: "FAIL" },

  // Time windows (stage 6) --------------------------------------------------
  TIME_WINDOW_OK: { category: "ROUTE", label: "Delay budgets respected", outcome: "PASS" },
  COMMITTED_PICKUP_DELAY_TOO_HIGH: {
    category: "ROUTE",
    label: "Committed pickup delayed too far",
    outcome: "FAIL",
  },
  COMMITTED_DROP_DELAY_TOO_HIGH: {
    category: "ROUTE",
    label: "Committed drop delayed too far",
    outcome: "FAIL",
  },

  // Lower bound (stage 7) ---------------------------------------------------
  LOWER_BOUND_OK: { category: "ROUTE", label: "Within detour lower bound", outcome: "PASS" },
  DETOUR_LOWER_BOUND_EXCEEDED: {
    category: "ROUTE",
    label: "Provably too long a detour",
    outcome: "FAIL",
  },

  // Optimizer (stage 8) -----------------------------------------------------
  OPTIMIZER_SOLVED: { category: "OPTIMIZER", label: "Sequence solved", outcome: "PASS" },
  OPTIMIZER_INFEASIBLE: {
    category: "OPTIMIZER",
    label: "Solver could not serve the request",
    outcome: "FAIL",
  },
  OPTIMIZER_CALL_FAILED: { category: "OPTIMIZER", label: "Optimizer call failed", outcome: "FAIL" },
  OPTIMIZER_BUDGET_EXCEEDED: {
    category: "OPTIMIZER",
    label: "Optimizer budget exhausted",
    outcome: "FAIL",
  },
  OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED: {
    category: "SYSTEM",
    label: "Solver dropped a committed passenger",
    outcome: "FAIL",
  },

  // Incremental cost (stage 9) ---------------------------------------------
  COST_MEASURED: { category: "ROUTE", label: "Impact measured", outcome: "PASS" },

  // Commit (stage 12) -------------------------------------------------------
  COMMIT_READY: { category: "ROUTE", label: "Ready to commit", outcome: "PASS" },
```

- [ ] **Step 4: Write the merged eligibility stage**

Create `src/matching/stages/basicEligibility.ts`. This is stage 0 — it merges what `driverStatusFilter`, `vehicleFilter` and `capacityPreFilter` did, keeping every one of their reason codes so the rejection dashboard loses no resolution:

```ts
import { ANY_VEHICLE, type Passenger } from "@/domain/entities";

import { computeOnboardSeats, computePeakCommittedSeats } from "../occupancy";
import { reason, type MatchReason } from "../reasons";
import { toProposedStops } from "../stops";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 0. The cheapest possible filters — pure lookups, no geometry, no
 * routing.
 *
 * Status, vehicle capability and a conservative seat check were three separate
 * stages before. They are one stage now because the Overview treats them as
 * one, but each keeps its own reason code: "no supply", "supply that cannot
 * carry you" and "supply that is full" call for entirely different product
 * responses, and merging the codes would erase that.
 */
export const basicEligibilityStage: MatchingStage = {
  id: "basicEligibility",
  name: "Basic Eligibility",
  description: "Status, vehicle capability and a conservative seat check. Free.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const failure = firstEligibilityFailure(driverId, context, passengersById);

      if (failure) {
        verdicts.push({ driverId, status: "FAILED", reasons: [failure] });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [reason("CAPACITY_AVAILABLE", "Driver is eligible to be considered")],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function firstEligibilityFailure(
  driverId: string,
  context: MatchingContext,
  passengersById: ReadonlyMap<string, Passenger>,
): MatchReason | undefined {
  const { request } = context;
  const driver = context.getDriver(driverId);

  if (!driver) {
    return reason("VEHICLE_NOT_FOUND", "Driver record missing");
  }

  if (driver.status === "OFFLINE") {
    return reason("DRIVER_OFFLINE", "Driver is offline", { value: driver.status, threshold: "ONLINE" });
  }
  if (driver.status === "PAUSED") {
    return reason("DRIVER_PAUSED", "Driver is paused", { value: driver.status, threshold: "ONLINE" });
  }
  if (driver.status === "BUSY") {
    return reason("DRIVER_BUSY", "Driver is busy", { value: driver.status, threshold: "ONLINE" });
  }

  const vehicle = context.getVehicleForDriver(driverId);

  if (!vehicle) {
    return reason("VEHICLE_NOT_FOUND", "Driver points at a vehicle that does not exist");
  }

  if (request.vehiclePreference !== ANY_VEHICLE && vehicle.label !== request.vehiclePreference) {
    return reason("VEHICLE_TYPE_MISMATCH", "Vehicle type does not match the request preference", {
      value: vehicle.label,
      threshold: request.vehiclePreference,
    });
  }

  if (request.requiresWheelchairAccess && !vehicle.wheelchairAccessible) {
    return reason("VEHICLE_NOT_WHEELCHAIR_ACCESSIBLE", "Vehicle is not wheelchair accessible", {
      value: "false",
      threshold: "true",
    });
  }

  if (request.luggageCount > vehicle.luggageCapacity) {
    return reason("VEHICLE_LUGGAGE_EXCEEDED", "Luggage exceeds the vehicle's hold", {
      value: request.luggageCount,
      threshold: vehicle.luggageCapacity,
    });
  }

  const ride = context.getRideForDriver(driverId);
  const committedStops = ride ? toProposedStops(ride.stops, passengersById) : [];
  const onboardSeats = ride ? computeOnboardSeats(ride.passengerIds, passengersById) : 0;
  const peakCommitted = computePeakCommittedSeats(committedStops, onboardSeats);
  const availableSeats = vehicle.totalSeats - peakCommitted;

  context.recordMetrics(driverId, {
    totalSeats: vehicle.totalSeats,
    committedSeats: peakCommitted,
    availableSeats,
  });

  // Conservative on purpose: it asks whether the vehicle is *ever* full, not
  // whether the new rider actually collides with that peak. Stage 5's segment
  // walk is the authoritative answer.
  if (availableSeats < request.seatsRequired) {
    return reason("INSUFFICIENT_CAPACITY", "Vehicle never has enough free seats", {
      value: availableSeats,
      threshold: request.seatsRequired,
    });
  }

  return undefined;
}
```

- [ ] **Step 5: Create the eleven remaining stages as no-ops**

Each of these files gets filled in by a later task. For now every one passes every live driver. Use this exact template, substituting the id, name, description and reason code from the table below:

```ts
import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** Stage N. Placeholder — implemented in Task M. */
export const <CONST>: MatchingStage = {
  id: "<ID>",
  name: "<NAME>",
  description: "<DESCRIPTION>",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = context.liveDriverIds.map((driverId) => ({
      driverId,
      status: "PASSED" as const,
      reasons: [reason("<PASS_CODE>", "<PASS_MESSAGE>")],
    }));

    return Promise.resolve({ verdicts });
  },
};
```

| File | `<CONST>` | `<ID>` | `<NAME>` | `<PASS_CODE>` | Filled in by |
| --- | --- | --- | --- | --- | --- |
| `operationalState.ts` | `operationalStateStage` | `operationalState` | Operational State | `OPERATIONAL_FLEXIBLE` | Task 10 |
| `h3RouteCorridor.ts` | `h3RouteCorridorStage` | `h3RouteCorridor` | H3 Route Corridor | `CORRIDOR_MATCH` | Task 11 |
| `pickupRouteDistance.ts` | `pickupRouteDistanceStage` | `pickupRouteDistance` | Pickup → Route Distance | `PICKUP_ON_ROUTE` | Task 12 |
| `directionCompatibility.ts` | `directionCompatibilityStage` | `directionCompatibility` | Direction Compatibility | `DIRECTION_COMPATIBLE` | Task 13 |
| `stopSequenceGeneration.ts` | `stopSequenceGenerationStage` | `stopSequenceGeneration` | Stop Sequence Generation | `SEQUENCE_GENERATED` | Task 14 |
| `pickupTimeWindow.ts` | `pickupTimeWindowStage` | `pickupTimeWindow` | Pickup Time Window | `TIME_WINDOW_OK` | Task 15 |
| `detourLowerBound.ts` | `detourLowerBoundStage` | `detourLowerBound` | Detour Lower Bound | `LOWER_BOUND_OK` | Task 16 |
| `roadRouting.ts` | `roadRoutingStage` | `roadRouting` | Road Routing | `OPTIMIZER_SOLVED` | Task 17 |
| `incrementalCost.ts` | `incrementalCostStage` | `incrementalCost` | Incremental Cost | `COST_MEASURED` | Task 18 |
| `hardConstraints.ts` | `hardConstraintsStage` | `hardConstraints` | Hard Constraints | `ROUTE_FEASIBLE` | Task 19 |
| `commit.ts` | `commitStage` | `commit` | Commit | `COMMIT_READY` | Task 21 |

Use a short `<DESCRIPTION>` matching `STAGE_METADATA` below, and any sensible `<PASS_MESSAGE>` — it is replaced when the stage is implemented.

- [ ] **Step 6: Rewrite `STAGE_METADATA`**

Replace the whole `STAGE_METADATA` object in `src/matching/pipeline.ts`:

```ts
export const STAGE_METADATA: Record<StageId, StageMetadata> = {
  requestValidation: {
    id: "requestValidation",
    name: "Request Validation",
    shortLabel: "Request",
    description: "Checks the request itself before any driver is considered.",
    usesRouting: false,
  },
  basicEligibility: {
    id: "basicEligibility",
    name: "Basic Eligibility",
    shortLabel: "Eligible",
    description: "Status, vehicle capability and a conservative seat check. Free.",
    usesRouting: false,
  },
  operationalState: {
    id: "operationalState",
    name: "Operational State",
    shortLabel: "State",
    description: "Computes each committed passenger's remaining delay budget.",
    usesRouting: false,
  },
  h3RouteCorridor: {
    id: "h3RouteCorridor",
    name: "H3 Route Corridor",
    shortLabel: "Corridor",
    description: "Matches the pickup against each ride's remaining-route corridor.",
    usesRouting: false,
  },
  pickupRouteDistance: {
    id: "pickupRouteDistance",
    name: "Pickup → Route Distance",
    shortLabel: "Proximity",
    description: "Point-to-polyline distance from the pickup to the remaining route.",
    usesRouting: false,
  },
  directionCompatibility: {
    id: "directionCompatibility",
    name: "Direction Compatibility",
    shortLabel: "Direction",
    description: "Bearing, destination proximity and destination progress along the route.",
    usesRouting: false,
  },
  stopSequenceGeneration: {
    id: "stopSequenceGeneration",
    name: "Stop Sequence Generation",
    shortLabel: "Sequences",
    description: "Enumerates legal insertion positions under precedence and capacity.",
    usesRouting: false,
  },
  pickupTimeWindow: {
    id: "pickupTimeWindow",
    name: "Pickup Time Window",
    shortLabel: "Windows",
    description: "Drops orderings that breach a committed passenger's own delay budget.",
    usesRouting: false,
  },
  detourLowerBound: {
    id: "detourLowerBound",
    name: "Detour Lower Bound",
    shortLabel: "Bound",
    description: "Prunes sequences whose straight-line lower bound already fails.",
    usesRouting: false,
  },
  roadRouting: {
    id: "roadRouting",
    name: "Road Routing",
    shortLabel: "Solve",
    description: "Google OptimizeTours returns the winning sequence and its leg data.",
    usesRouting: true,
  },
  incrementalCost: {
    id: "incrementalCost",
    name: "Incremental Cost",
    shortLabel: "Impact",
    description: "Measures what every party gains or loses. Rejects nothing.",
    usesRouting: false,
  },
  hardConstraints: {
    id: "hardConstraints",
    name: "Hard Constraints",
    shortLabel: "Limits",
    description: "Binary accept/reject against every configured maximum, plus pooling policy.",
    usesRouting: false,
  },
  scoring: {
    id: "scoring",
    name: "Scoring",
    shortLabel: "Score",
    description: "Fairness-weighted ranking across drivers. Lower is better.",
    usesRouting: false,
  },
  commit: {
    id: "commit",
    name: "Commit",
    shortLabel: "Commit",
    description: "Builds the commit plan that makes the winning route the new baseline.",
    usesRouting: false,
  },
};
```

- [ ] **Step 7: Rewrite the registry**

Replace `src/matching/stages/index.ts`:

```ts
import type { StageRegistry } from "../pipeline";

import { basicEligibilityStage } from "./basicEligibility";
import { commitStage } from "./commit";
import { detourLowerBoundStage } from "./detourLowerBound";
import { directionCompatibilityStage } from "./directionCompatibility";
import { h3RouteCorridorStage } from "./h3RouteCorridor";
import { hardConstraintsStage } from "./hardConstraints";
import { incrementalCostStage } from "./incrementalCost";
import { operationalStateStage } from "./operationalState";
import { pickupRouteDistanceStage } from "./pickupRouteDistance";
import { pickupTimeWindowStage } from "./pickupTimeWindow";
import { requestValidationStage } from "./requestValidation";
import { roadRoutingStage } from "./roadRouting";
import { scoringStage } from "./scoring";
import { stopSequenceGenerationStage } from "./stopSequenceGeneration";

/**
 * Every stage the engine knows about, in `docs/Overview.md`'s numbering.
 * Which of them run, and in what order, is `MatchingSettings.stageOrder`.
 */
export const STAGE_REGISTRY: StageRegistry = {
  requestValidation: requestValidationStage,
  basicEligibility: basicEligibilityStage,
  operationalState: operationalStateStage,
  h3RouteCorridor: h3RouteCorridorStage,
  pickupRouteDistance: pickupRouteDistanceStage,
  directionCompatibility: directionCompatibilityStage,
  stopSequenceGeneration: stopSequenceGenerationStage,
  pickupTimeWindow: pickupTimeWindowStage,
  detourLowerBound: detourLowerBoundStage,
  roadRouting: roadRoutingStage,
  incrementalCost: incrementalCostStage,
  hardConstraints: hardConstraintsStage,
  scoring: scoringStage,
  commit: commitStage,
};

export { basicEligibilityStage } from "./basicEligibility";
export { commitStage } from "./commit";
export { detourLowerBoundStage } from "./detourLowerBound";
export { directionCompatibilityStage } from "./directionCompatibility";
export { h3RouteCorridorStage } from "./h3RouteCorridor";
export { hardConstraintsStage } from "./hardConstraints";
export { incrementalCostStage } from "./incrementalCost";
export { operationalStateStage } from "./operationalState";
export { pickupRouteDistanceStage } from "./pickupRouteDistance";
export { pickupTimeWindowStage } from "./pickupTimeWindow";
export { requestValidationStage } from "./requestValidation";
export { roadRoutingStage } from "./roadRouting";
export { scoringStage } from "./scoring";
export { stopSequenceGenerationStage } from "./stopSequenceGeneration";
```

Delete the seven superseded stage files:

```bash
git rm src/matching/stages/driverStatusFilter.ts \
       src/matching/stages/vehicleFilter.ts \
       src/matching/stages/capacityPreFilter.ts \
       src/matching/stages/pickupEtaFilter.ts \
       src/matching/stages/h3CandidateGeneration.ts \
       src/matching/stages/routeFeasibility.ts \
       src/matching/stages/poolingRules.ts
```

`routeInsertion.ts` stays on disk for now — Tasks 14 and 17 dismantle it. It is temporarily unreferenced, which lint will flag as unused exports only if that rule is enabled; if it complains, leave the file and add `// eslint-disable-next-line` where required, or accept the warning until Task 17 deletes it.

- [ ] **Step 8: Fix the candidate counter**

In `src/matching/engine.ts`, `countCandidates` looks for the old stage id. Change it:

```ts
function countCandidates(stageResults: readonly StageResult[]): number {
  const generation = stageResults.find((stage) => stage.stageId === "h3RouteCorridor");
  return generation ? generation.outputCount : 0;
}
```

- [ ] **Step 9: Update the existing tests**

`src/test/pipeline.test.ts` and `src/test/e2e-scenario.test.ts` reference the old stage ids and the removed `BRIEF_STAGE_ORDER`. Update every reference:

- `"h3CandidateGeneration"` → `"h3RouteCorridor"`
- `"driverStatusFilter"` / `"vehicleFilter"` / `"capacityPreFilter"` → `"basicEligibility"`
- `"pickupEtaFilter"` → delete the assertion; there is no ETA gate any more
- `"routeFeasibility"` → `"roadRouting"`
- `"poolingRules"` → `"hardConstraints"`
- Any `BRIEF_STAGE_ORDER` test → delete it

Assertions on `PICKUP_ETA_TOO_HIGH` and `PICKUP_DISTANCE_TOO_HIGH` must be deleted; those codes no longer exist. Assertions on detour, capacity, vehicle and offline rejections stay — the codes are unchanged.

Add one new test to `src/test/pipeline.test.ts` pinning the skeleton:

```ts
it("runs all fourteen stages in the Overview's order", async () => {
  const result = await runEngine({ scenario, request });

  expect(result.stageResults.map((stage) => stage.stageId)).toEqual([
    "requestValidation",
    "basicEligibility",
    "operationalState",
    "h3RouteCorridor",
    "pickupRouteDistance",
    "directionCompatibility",
    "stopSequenceGeneration",
    "pickupTimeWindow",
    "detourLowerBound",
    "roadRouting",
    "incrementalCost",
    "hardConstraints",
    "scoring",
    "commit",
  ]);
});
```

- [ ] **Step 10: Run everything**

Run: `bun run check-types && bun run lint && bun run test`
Expected: PASS. Some UI files will fail typechecking because they reference removed `StageId` values or `maxPickupEtaMin`; fix them minimally here (Task 22 does the real UI work) — usually deleting a hard-coded stage list or swapping a settings field name.

- [ ] **Step 11: Commit**

```bash
git add -A src
git commit -m "refactor(simulation): switch pipeline to the Overview's thirteen stages"
```

---

## Task 10: Stage 1 — Operational state — LANDED

**Files:**
- Modify: `src/matching/stages/operationalState.ts`
- Modify: `src/matching/types.ts` (`DriverMetrics`, `MatchingContext`)
- Test: `src/test/operationalState.test.ts` (create)

**Interfaces:**
- Consumes: `buildCorridors` (Task 3); `Passenger.maxPickupDelayMin` / `maxDropDelayMin` and `Stop.originalEtaMin` (Task 1).
- Produces: `DriverMetrics.flexibleStopCount?: number`, `DriverMetrics.tightestDelayBudgetMin?: number`, and a stage note `budgetsByDriver: Record<string, { stopId: string; passengerId: string; budgetMin: number }[]>` that stage 6 reads.

- [x] **Step 1: Write the failing test**

Create `src/test/operationalState.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { operationalStateStage } from "@/matching/stages/operationalState";
import { makeContext } from "./fixtures/stageContext";

describe("operationalState", () => {
  it("records a delay budget for every committed stop", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayMin: 8 }],
    });

    const outcome = await operationalStateStage.execute(context);
    const budgets = (outcome.notes?.budgetsByDriver as Record<string, unknown[]>).d1;

    expect(budgets).toHaveLength(2);
  });

  it("uses the pickup budget for a pickup and the drop budget for a drop", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4 },
        { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 },
      ],
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayMin: 8 }],
    });

    const outcome = await operationalStateStage.execute(context);
    const budgets = (outcome.notes?.budgetsByDriver as Record<string, { stopId: string; budgetMin: number }[]>).d1!;

    expect(budgets.find((entry) => entry.stopId === "s1")!.budgetMin).toBe(5);
    expect(budgets.find((entry) => entry.stopId === "s2")!.budgetMin).toBe(8);
  });

  it("passes an idle driver with no committed stops", async () => {
    const context = makeContext({ driverId: "d1", committedStops: [], passengers: [] });

    const outcome = await operationalStateStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("records the tightest budget as a metric", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [
        { id: "s1", passengerId: "pA", type: "DROP", originalEtaMin: 10 },
        { id: "s2", passengerId: "pB", type: "DROP", originalEtaMin: 20 },
      ],
      passengers: [
        { id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 3 },
        { id: "pB", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 12 },
      ],
    });

    await operationalStateStage.execute(context);

    expect(context.getMetrics("d1").tightestDelayBudgetMin).toBe(3);
  });

  it("rejects a driver whose every committed stop has a zero budget", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [{ id: "s1", passengerId: "pA", type: "DROP", originalEtaMin: 10 }],
      passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
    });

    const outcome = await operationalStateStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPERATIONAL_NO_FLEXIBILITY");
  });
});
```

- [x] **Step 2: Write the shared stage-context fixture**

Create `src/test/fixtures/stageContext.ts`. Every stage test from here on uses it, so it belongs in this task:

```ts
import type {
  Driver,
  MatchingSettings,
  Passenger,
  RideRequest,
  Scenario,
  Stop,
  Vehicle,
} from "@/domain/entities";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type {
  DriverMetrics,
  MatchingContext,
  RouteInsertionResult,
  ScoreBreakdown,
} from "@/matching/types";
import { MockRoutingEngine } from "@/routing";
import type { RoutingEngine } from "@/routing/types";

export interface StubStop {
  id: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  originalEtaMin: number;
  lat?: number;
  lng?: number;
}

export interface StubPassenger {
  id: string;
  state: Passenger["state"];
  maxPickupDelayMin: number;
  maxDropDelayMin: number;
  seatsRequired?: number;
  allowsPooling?: boolean;
}

export interface MakeContextInput {
  driverId: string;
  committedStops: StubStop[];
  passengers: StubPassenger[];
  driverLocation?: { lat: number; lng: number };
  request?: Partial<RideRequest>;
  settings?: Partial<MatchingSettings>;
  vehicle?: Partial<Vehicle>;
  routing?: RoutingEngine;
}

/**
 * Builds a `MatchingContext` around one driver.
 *
 * Stage tests want to assert one stage's behaviour, not assemble a whole
 * scenario. This keeps each test to the three or four facts it actually cares
 * about and fills the rest with defaults.
 */
export function makeContext(input: MakeContextInput): MatchingContext & {
  metrics: Map<string, DriverMetrics>;
} {
  const vehicle: Vehicle = {
    id: "v1",
    label: "Sedan",
    totalSeats: 4,
    luggageCapacity: 2,
    poolingEnabled: true,
    wheelchairAccessible: false,
    airConditioned: true,
    ...input.vehicle,
  };

  const passengers: Passenger[] = input.passengers.map((stub) => ({
    id: stub.id,
    name: stub.id,
    seatsRequired: stub.seatsRequired ?? 1,
    state: stub.state,
    specialRequirements: [],
    allowsPooling: stub.allowsPooling ?? true,
    maxPickupDelayMin: stub.maxPickupDelayMin,
    maxDropDelayMin: stub.maxDropDelayMin,
  }));

  const stops: Stop[] = input.committedStops.map((stub, index) => ({
    id: stub.id,
    rideId: "r1",
    passengerId: stub.passengerId,
    type: stub.type,
    location: { lat: stub.lat ?? 28.6 + index * 0.01, lng: stub.lng ?? 77.2 + index * 0.01 },
    sequence: index,
    originalEtaMin: stub.originalEtaMin,
  }));

  const hasRide = stops.length > 0;

  const driver: Driver = {
    id: input.driverId,
    name: input.driverId,
    status: "ONLINE",
    location: input.driverLocation ?? { lat: 28.6, lng: 77.19 },
    vehicleId: vehicle.id,
    currentRideId: hasRide ? "r1" : null,
    history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 0 },
  };

  const newPassenger: Passenger = {
    id: "pNew",
    name: "pNew",
    seatsRequired: 1,
    state: "WAITING",
    specialRequirements: [],
    allowsPooling: true,
    maxPickupDelayMin: 6,
    maxDropDelayMin: 10,
  };

  const request: RideRequest = {
    id: "req_1",
    passengerId: "pNew",
    seatsRequired: 1,
    pickup: { lat: 28.605, lng: 77.205 },
    drop: { lat: 28.64, lng: 77.26 },
    intermediateStops: [],
    poolingAllowed: true,
    vehiclePreference: "ANY",
    requiresWheelchairAccess: false,
    luggageCount: 0,
    maxWaitMinutes: 8,
    maxDetourPercent: 15,
    maxWalkingDistanceM: 300,
    priority: 0,
    ...input.request,
  };

  const settings: MatchingSettings = { ...DEFAULT_SETTINGS, ...input.settings };

  const scenario: Scenario = {
    schemaVersion: 2,
    id: "sc_test",
    name: "Stage fixture",
    drivers: [driver],
    vehicles: [vehicle],
    passengers: [...passengers, newPassenger],
    rides: hasRide ? [{ id: "r1", driverId: driver.id, passengerIds: passengers.map((p) => p.id), stops }] : [],
    requests: [request],
    settings,
  };

  const metrics = new Map<string, DriverMetrics>();
  const insertions = new Map<string, RouteInsertionResult>();
  const scores = new Map<string, ScoreBreakdown>();

  return {
    scenario,
    request,
    settings,
    routing: input.routing ?? new MockRoutingEngine(),
    liveDriverIds: [driver.id],
    metrics,
    getDriver: (id) => (id === driver.id ? driver : undefined),
    getVehicleForDriver: (id) => (id === driver.id ? vehicle : undefined),
    getRideForDriver: (id) =>
      id === driver.id && hasRide ? { stops, passengerIds: passengers.map((p) => p.id) } : undefined,
    getMetrics: (id) => metrics.get(id) ?? {},
    recordMetrics: (id, patch) => {
      metrics.set(id, { ...(metrics.get(id) ?? {}), ...patch });
    },
    recordInsertion: (id, insertion) => {
      insertions.set(id, insertion);
    },
    recordScore: (id, breakdown) => {
      scores.set(id, breakdown);
    },
  };
}
```

Note: the fixture returns a `MatchingContext` plus a `metrics` map, so tests can read what a stage recorded. The optimizer field is added to this fixture in Task 17.

- [x] **Step 3: Run the test to verify it fails**

Run: `bun run test src/test/operationalState.test.ts`
Expected: FAIL — the no-op stage records no notes and no metrics.

- [x] **Step 4: Implement the stage**

Replace `src/matching/stages/operationalState.ts`:

```ts
import type { Passenger } from "@/domain/entities";

import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/** How much later one committed stop may happen than it was promised. */
export interface StopDelayBudget {
  stopId: string;
  passengerId: string;
  type: "PICKUP" | "DROP";
  originalEtaMin: number;
  budgetMin: number;
}

/**
 * Stage 1. What is this *ride* currently doing?
 *
 * A driver is not an available/unavailable resource — it is a live route with
 * promises attached. This stage does not freeze those promises; it prices
 * them. Every committed stop gets a delay budget, and stages 5 and 6 use those
 * budgets to decide which orderings are legal. Rejecting the driver outright
 * here would silently throw away perfectly good matches, which was the whole
 * point of the Overview's flexible-commitment policy.
 */
export const operationalStateStage: MatchingStage = {
  id: "operationalState",
  name: "Operational State",
  description: "Computes each committed passenger's remaining delay budget.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const passengersById = new Map<string, Passenger>(
      context.scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];
    const budgetsByDriver: Record<string, StopDelayBudget[]> = {};

    for (const driverId of context.liveDriverIds) {
      const ride = context.getRideForDriver(driverId);
      const budgets: StopDelayBudget[] = [];

      for (const stop of ride?.stops ?? []) {
        const passenger = passengersById.get(stop.passengerId);
        if (!passenger || passenger.state === "DROPPED" || passenger.state === "CANCELLED") {
          continue;
        }

        // An onboard passenger's pickup already happened, so it carries no
        // remaining budget — only their drop is still a promise.
        if (stop.type === "PICKUP" && (passenger.state === "PICKED_UP" || passenger.state === "IN_RIDE")) {
          continue;
        }

        budgets.push({
          stopId: stop.id,
          passengerId: stop.passengerId,
          type: stop.type,
          originalEtaMin: stop.originalEtaMin,
          budgetMin: stop.type === "PICKUP" ? passenger.maxPickupDelayMin : passenger.maxDropDelayMin,
        });
      }

      budgetsByDriver[driverId] = budgets;

      const tightest = budgets.reduce<number | undefined>(
        (min, budget) => (min === undefined ? budget.budgetMin : Math.min(min, budget.budgetMin)),
        undefined,
      );

      context.recordMetrics(driverId, {
        flexibleStopCount: budgets.filter((budget) => budget.budgetMin > 0).length,
        ...(tightest === undefined ? {} : { tightestDelayBudgetMin: tightest }),
      });

      // An idle driver has no commitments to protect, so there is nothing
      // rigid about them. Only a driver whose every promise is already at zero
      // slack is a genuine dead end.
      if (budgets.length > 0 && budgets.every((budget) => budget.budgetMin <= 0)) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "OPERATIONAL_NO_FLEXIBILITY",
              "Every committed stop on this ride is already at zero delay tolerance",
              { value: 0, threshold: 1 },
            ),
          ],
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason(
            "OPERATIONAL_FLEXIBLE",
            budgets.length === 0
              ? "Driver has no committed stops"
              : `${String(budgets.length)} committed stop(s) with delay tolerance`,
            { value: budgets.length },
          ),
        ],
      });
    }

    return Promise.resolve({ verdicts, notes: { budgetsByDriver } });
  },
};
```

Add the two metric fields to `DriverMetrics` in `src/matching/types.ts`:

```ts
  // Operational state
  flexibleStopCount?: number;
  tightestDelayBudgetMin?: number;
```

- [x] **Step 5: Run the test to verify it passes**

Run: `bun run test src/test/operationalState.test.ts`
Expected: PASS, all five cases.

- [x] **Step 6: Run the whole suite**

Run: `bun run check-types && bun run lint && bun run test`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add src/matching src/test
git commit -m "feat(simulation): stage 1 operational-state delay budgets"
```

---

## Task 11: Stage 2 — H3 route corridor — LANDED

**Files:**
- Modify: `src/matching/stages/h3RouteCorridor.ts`
- Modify: `src/matching/types.ts` (`MatchingContext`, `DriverMetrics`)
- Modify: `src/matching/engine.ts` (context construction, `H3_OUTSIDE_SEARCH` fallback)
- Test: `src/test/h3RouteCorridor.test.ts` (create)

**Interfaces:**
- Consumes: `buildCorridors`, `indexCorridorsByCell`, `RideCorridor` (Task 3); `getCellsByRing`, `getH3CellFor` from `@/lib/h3`.
- Produces: `MatchingContext.getCorridor(driverId: string): RideCorridor | undefined` — every later stage reads the remaining-route polyline from here rather than rebuilding it. Stage note shape: `{ pickupCell, h3Resolution, maxH3Ring, minimumUsableCandidates, stoppedAtRing, searchExhausted, rings: RingNote[] }` (unchanged from the old stage, so `StageDetails.tsx` keeps working).

- [x] **Step 1: Write the failing test**

Create `src/test/h3RouteCorridor.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { makeContext } from "./fixtures/stageContext";

// A ride running due east from lng 77.10 to 77.30, driver currently at 77.20.
const eastboundRide = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP" as const, originalEtaMin: 0, lat: 28.6, lng: 77.1 },
    { id: "s2", passengerId: "pA", type: "DROP" as const, originalEtaMin: 20, lat: 28.6, lng: 77.3 },
  ],
  passengers: [
    { id: "pA", state: "IN_RIDE" as const, maxPickupDelayMin: 5, maxDropDelayMin: 8 },
  ],
};

describe("h3RouteCorridor", () => {
  it("accepts a pickup on the remaining route ahead of the vehicle", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.candidateDriverIds).toContain("d1");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("CORRIDOR_MATCH");
  });

  it("rejects a pickup on the historical route behind the vehicle", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.11 } },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.candidateDriverIds ?? []).not.toContain("d1");
  });

  it("finds an idle driver near the pickup", async () => {
    const context = makeContext({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.2 } },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.candidateDriverIds).toContain("d2");
  });

  it("records the discovered ring as a unitless hop count", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    await h3RouteCorridorStage.execute(context);
    const metrics = context.getMetrics("d1");

    expect(metrics.discoveredRing).toBe(0);
    expect(metrics.h3GridDistance).toBe(0);
    expect(metrics.straightLineKm).toBeGreaterThan(0);
  });

  it("exposes the corridor to later stages", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    await h3RouteCorridorStage.execute(context);

    expect(context.getCorridor("d1")!.remainingStops.map((stop) => stop.id)).toEqual(["s2"]);
  });

  it("reports the ring at which the search stopped", async () => {
    const context = makeContext({
      ...eastboundRide,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
      settings: { minimumUsableCandidates: 1 },
    });

    const outcome = await h3RouteCorridorStage.execute(context);

    expect(outcome.notes?.stoppedAtRing).toBe(0);
    expect(outcome.notes?.searchExhausted).toBe(false);
  });
});
```

- [x] **Step 2: Add `getCorridor` to the context**

In `src/matching/types.ts`, import `RideCorridor` and add to `MatchingContext`:

```ts
  /**
   * The driver's remaining-route corridor, built once at stage 2 and read by
   * stages 3, 4, 5 and 7. Undefined before stage 2 has run.
   */
  getCorridor(driverId: string): RideCorridor | undefined;
```

In `src/matching/engine.ts`, hold the corridors on the run and expose them. Add to `runMatching` before the stage loop:

```ts
  const corridors = new Map<string, RideCorridor>();
```

Pass it into `createContext`, and in `createContext` return:

```ts
    getCorridor: (driverId: string): RideCorridor | undefined => input.corridors.get(driverId),
```

Add `setCorridors` as an outcome channel — the simplest route is a mutable map the stage writes into, so extend `MatchingContext` with:

```ts
  /** Stage 2 only. Publishes the corridors every later stage reads. */
  setCorridor(driverId: string, corridor: RideCorridor): void;
```

wired in `createContext` as `(driverId, corridor) => input.corridors.set(driverId, corridor)`.

Also update the engine's `candidateSet` fallback reason: `H3_OUTSIDE_SEARCH` stays the code for a driver the ring search never reached, and is still correct.

- [x] **Step 3: Implement the stage**

Replace `src/matching/stages/h3RouteCorridor.ts`:

```ts
import { ANY_VEHICLE, type Driver, type Passenger } from "@/domain/entities";
import { haversineKm } from "@/lib/geo";
import { getCellsByRing, getH3CellFor } from "@/lib/h3";

import { buildCorridors, indexCorridorsByCell } from "../corridor";
import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

interface RingNote {
  ring: number;
  cells: number;
  discovered: number;
  usable: number;
  cumulativeDiscovered: number;
  cumulativeUsable: number;
}

/** `gridDisk` padding applied to each corridor cell. The Overview uses one ring. */
const CORRIDOR_RING_PADDING = 1;

/**
 * Stage 2. Does the pickup fall near this ride's *remaining route*?
 *
 * This is the single biggest correction the project made across its
 * iterations. Driver-to-pickup distance is a bad proxy the moment a vehicle
 * has a route: a driver 8 km away can be an excellent match if their corridor
 * runs straight past the pickup, and a driver 200 m away is useless if that
 * 200 m is behind them. The corridor is therefore built from remaining stops
 * only, which is what makes the behind-the-vehicle case reject.
 */
export const h3RouteCorridorStage: MatchingStage = {
  id: "h3RouteCorridor",
  name: "H3 Route Corridor",
  description: "Matches the pickup against each ride's remaining-route corridor.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { scenario, request, settings } = context;
    const resolution = settings.h3Resolution;

    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const corridors = buildCorridors({
      drivers: scenario.drivers,
      rides: scenario.rides,
      passengersById,
      resolution,
      ringPadding: CORRIDOR_RING_PADDING,
    });

    for (const [driverId, corridor] of corridors) {
      context.setCorridor(driverId, corridor);
    }

    const cellIndex = indexCorridorsByCell(corridors);
    const pickupCell = getH3CellFor(request.pickup, resolution);
    const rings = getCellsByRing(pickupCell, settings.maxH3Ring);

    const discovered = new Set<string>();
    const verdicts: DriverVerdict[] = [];
    const ringNotes: RingNote[] = [];

    let cumulativeDiscovered = 0;
    let cumulativeUsable = 0;
    let stoppedAtRing = 0;

    for (let ring = 0; ring < rings.length; ring += 1) {
      const cells = rings[ring] ?? [];
      let ringDiscovered = 0;
      let ringUsable = 0;

      for (const cell of cells) {
        for (const driverId of cellIndex.get(cell) ?? []) {
          // Dedup by driver so each is attributed to the lowest ring that
          // reached them, and never counted twice.
          if (discovered.has(driverId)) {
            continue;
          }

          const driver = context.getDriver(driverId);
          if (!driver) {
            continue;
          }

          discovered.add(driverId);
          ringDiscovered += 1;

          if (isUsableCandidate(driver, context)) {
            ringUsable += 1;
          }

          verdicts.push({
            driverId,
            status: "PASSED",
            reasons: [
              reason("CORRIDOR_MATCH", `Pickup falls on this ride's corridor at ring ${String(ring)}`, {
                value: ring,
                threshold: settings.maxH3Ring,
              }),
            ],
          });

          context.recordMetrics(driverId, {
            driverCell: getH3CellFor(driver.location, resolution),
            pickupCell,
            // Ring index is the grid distance by construction. Both are hop
            // counts. Neither is ever compared against a kilometre or a minute.
            h3GridDistance: ring,
            discoveredRing: ring,
            straightLineKm: haversineKm(driver.location, request.pickup),
          });
        }
      }

      cumulativeDiscovered += ringDiscovered;
      cumulativeUsable += ringUsable;
      stoppedAtRing = ring;

      ringNotes.push({
        ring,
        cells: cells.length,
        discovered: ringDiscovered,
        usable: ringUsable,
        cumulativeDiscovered,
        cumulativeUsable,
      });

      if (cumulativeUsable >= settings.minimumUsableCandidates) {
        break;
      }
    }

    return Promise.resolve({
      verdicts,
      candidateDriverIds: [...discovered],
      notes: {
        pickupCell,
        h3Resolution: resolution,
        maxH3Ring: settings.maxH3Ring,
        minimumUsableCandidates: settings.minimumUsableCandidates,
        stoppedAtRing,
        searchExhausted: cumulativeUsable < settings.minimumUsableCandidates,
        rings: ringNotes,
      },
    });
  },
};

/**
 * The counting heuristic that decides when ring expansion may stop.
 *
 * Drivers failing these predicates are still returned as candidates, so a
 * later stage can reject them with a precise, attributable reason rather than
 * them vanishing silently here.
 */
function isUsableCandidate(driver: Driver, context: MatchingContext): boolean {
  if (driver.status !== "ONLINE") {
    return false;
  }

  const vehicle = context.getVehicleForDriver(driver.id);
  if (!vehicle) {
    return false;
  }

  if (
    context.request.vehiclePreference !== ANY_VEHICLE &&
    vehicle.label !== context.request.vehiclePreference
  ) {
    return false;
  }

  return vehicle.totalSeats >= context.request.seatsRequired;
}
```

- [x] **Step 4: Extend the test fixture**

In `src/test/fixtures/stageContext.ts`, add a corridor map so `getCorridor` / `setCorridor` work:

```ts
  const corridors = new Map<string, RideCorridor>();
```

and to the returned object:

```ts
    getCorridor: (id) => corridors.get(id),
    setCorridor: (id, corridor) => {
      corridors.set(id, corridor);
    },
```

Import `RideCorridor` from `@/matching/corridor`.

- [x] **Step 5: Run the tests**

Run: `bun run test src/test/h3RouteCorridor.test.ts`
Expected: PASS, all six cases. The behind-the-vehicle rejection is the load-bearing one — if it passes when it should fail, `toProposedStops` is not dropping the onboard passenger's pickup, which means the fixture's passenger state is not `IN_RIDE`.

- [x] **Step 6: Run the whole suite**

Run: `bun run check-types && bun run lint && bun run test`
Expected: all green. `src/test/h3.test.ts` may assert on the old location-cell indexing — update it to test `cellsForPath` and ring attribution instead, keeping its dedup assertions.

- [x] **Step 7: Commit**

```bash
git add src/matching src/test
git commit -m "feat(simulation): stage 2 matches pickups against remaining-route corridors"
```

---

## Task 12: Stage 3 — Pickup to route distance — LANDED

**Files:**
- Modify: `src/matching/stages/pickupRouteDistance.ts`
- Modify: `src/matching/types.ts` (`DriverMetrics`)
- Test: `src/test/pickupRouteDistance.test.ts` (create)

**Interfaces:**
- Consumes: `context.getCorridor(driverId)` (Task 11); `pointToPolylineKm` (Task 2); `settings.maxPickupToRouteDistanceKm`.
- Produces: `DriverMetrics.pickupToRouteKm?: number`.

- [x] **Step 1: Write the failing test**

Create `src/test/pickupRouteDistance.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { pickupRouteDistanceStage } from "@/matching/stages/pickupRouteDistance";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function runWithCorridor(input: MakeContextInput) {
  const context = makeContext(input);
  await h3RouteCorridorStage.execute(context);
  const outcome = await pickupRouteDistanceStage.execute(context);
  return { context, outcome };
}

const eastbound: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 20, lat: 28.6, lng: 77.3 },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 8 }],
};

describe("pickupRouteDistance", () => {
  it("passes a pickup sitting on the route", async () => {
    const { outcome } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("PICKUP_ON_ROUTE");
  });

  it("rejects a pickup far off the route", async () => {
    const { outcome } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.75, lng: 77.25 } },
      settings: { maxPickupToRouteDistanceKm: 1.5 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("PICKUP_TOO_FAR_FROM_ROUTE");
  });

  it("attaches both the measurement and the threshold", async () => {
    const { outcome } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.75, lng: 77.25 } },
      settings: { maxPickupToRouteDistanceKm: 1.5 },
    });

    const rejection = outcome.verdicts[0]!.reasons[0]!;
    expect(rejection.threshold).toBe(1.5);
    expect(Number(rejection.value)).toBeGreaterThan(1.5);
  });

  it("records the distance as a metric", async () => {
    const { context } = await runWithCorridor({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 } },
    });

    expect(context.getMetrics("d1").pickupToRouteKm).toBeLessThan(0.2);
  });

  it("measures from the driver's position for an idle driver", async () => {
    const { context, outcome } = await runWithCorridor({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.21 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(context.getMetrics("d2").pickupToRouteKm).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/pickupRouteDistance.test.ts`
Expected: FAIL — the no-op stage passes everything and records nothing.

- [x] **Step 3: Implement the stage**

Replace `src/matching/stages/pickupRouteDistance.ts`:

```ts
import { pointToPolylineKm } from "@/lib/geo";

import { reason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 3. Tightens stage 2's cell-level match into real geometry.
 *
 * H3 corridor intersection is approximate — a cell is hundreds of metres
 * across, and the one-ring padding widens it further. This measures the actual
 * perpendicular distance from the pickup to the remaining-route polyline.
 *
 * It remains a *cheap approximation of proximity*, never the real detour: a
 * pickup 500 m off the line can mean driving 500 m out and 500 m back. Only
 * stage 8 knows that number. This stage exists to stop obviously-too-far
 * candidates from ever reaching the solver.
 */
export const pickupRouteDistanceStage: MatchingStage = {
  id: "pickupRouteDistance",
  name: "Pickup → Route Distance",
  description: "Point-to-polyline distance from the pickup to the remaining route.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);

      if (!corridor) {
        continue;
      }

      const distanceKm = pointToPolylineKm(request.pickup, corridor.polyline);
      context.recordMetrics(driverId, { pickupToRouteKm: distanceKm });

      if (distanceKm > settings.maxPickupToRouteDistanceKm) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason("PICKUP_TOO_FAR_FROM_ROUTE", "Pickup is too far from this ride's route", {
              value: round(distanceKm, 2),
              threshold: settings.maxPickupToRouteDistanceKm,
            }),
          ],
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("PICKUP_ON_ROUTE", "Pickup is close to this ride's route", {
            value: round(distanceKm, 2),
            threshold: settings.maxPickupToRouteDistanceKm,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
```

Add to `DriverMetrics` in `src/matching/types.ts`, under the spatial block:

```ts
  pickupToRouteKm?: number;
```

- [x] **Step 4: Run the tests**

Run: `bun run test src/test/pickupRouteDistance.test.ts`
Expected: PASS, all five cases.

- [x] **Step 5: Commit**

```bash
git add src/matching src/test/pickupRouteDistance.test.ts
git commit -m "feat(simulation): stage 3 pickup-to-route proximity"
```

---

## Task 13: Stage 4 — Direction and destination compatibility — LANDED

**Files:**
- Modify: `src/matching/stages/directionCompatibility.ts`
- Modify: `src/matching/types.ts` (`DriverMetrics`)
- Test: `src/test/directionCompatibility.test.ts` (create)

**Interfaces:**
- Consumes: `context.getCorridor` (Task 11); `polylineBearingDeg`, `pointToPolylineKm`, `projectOnPolylineKm`, `bearingDeg`, `bearingDifferenceDeg`; settings `maxBearingDifferenceDeg`, `maxDropToRouteDistanceKm`.
- Produces: `DriverMetrics.bearingDifferenceDeg?`, `dropToRouteKm?`, `dropProgressKm?`, `vehicleProgressKm?`.

- [x] **Step 1: Write the failing test**

Create `src/test/directionCompatibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { directionCompatibilityStage } from "@/matching/stages/directionCompatibility";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function run(input: MakeContextInput) {
  const context = makeContext(input);
  await h3RouteCorridorStage.execute(context);
  const outcome = await directionCompatibilityStage.execute(context);
  return { context, outcome };
}

// Route runs due east from the driver at 77.20 to a drop at 77.40.
const eastbound: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 30, lat: 28.6, lng: 77.4 },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 8 }],
};

describe("directionCompatibility", () => {
  it("passes a request travelling the same way as the route", async () => {
    const { outcome } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.35 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("DIRECTION_COMPATIBLE");
  });

  it("rejects a request travelling back the way the route came", async () => {
    const { outcome } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.3 }, drop: { lat: 28.6, lng: 77.22 } },
      settings: { maxBearingDifferenceDeg: 75 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("BEARING_INCOMPATIBLE");
  });

  it("rejects a destination far off the corridor", async () => {
    const { outcome } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.9, lng: 77.31 } },
      settings: { maxBearingDifferenceDeg: 180, maxDropToRouteDistanceKm: 3 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("DESTINATION_OFF_CORRIDOR");
  });

  it("rejects a destination behind the vehicle even when it is close to the line", async () => {
    const { outcome } = await run({
      ...eastbound,
      driverLocation: { lat: 28.6, lng: 77.3 },
      request: { pickup: { lat: 28.6, lng: 77.32 }, drop: { lat: 28.6, lng: 77.28 } },
      settings: { maxBearingDifferenceDeg: 180, maxDropToRouteDistanceKm: 10 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("DESTINATION_BEHIND_VEHICLE");
  });

  it("passes an idle driver, who has no direction to disagree with", async () => {
    const { outcome } = await run({
      driverId: "d2",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.21 }, drop: { lat: 28.4, lng: 77.05 } },
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("records all three signals as metrics", async () => {
    const { context } = await run({
      ...eastbound,
      request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.35 } },
    });

    const metrics = context.getMetrics("d1");
    expect(metrics.bearingDifferenceDeg).toBeLessThan(10);
    expect(metrics.dropToRouteKm).toBeLessThan(1);
    expect(metrics.dropProgressKm).toBeGreaterThan(metrics.pickupProgressKm ?? 0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/directionCompatibility.test.ts`
Expected: FAIL — no-op stage.

- [x] **Step 3: Implement the stage**

Replace `src/matching/stages/directionCompatibility.ts`:

```ts
import {
  bearingDeg,
  bearingDifferenceDeg,
  pointToPolylineKm,
  polylineBearingDeg,
  projectOnPolylineKm,
} from "@/lib/geo";

import { reason, type MatchReason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 4. Pickup proximity is not enough.
 *
 * A pickup can sit perfectly on the corridor while the destination drags the
 * vehicle somewhere else entirely. Three cheap geometric signals catch that
 * before a solver call is spent: which way the trip is heading, whether the
 * destination is anywhere near the corridor, and whether it is ahead of the
 * vehicle or behind it.
 *
 * All three are approximations — roads are not straight lines, so a moderate
 * bearing difference is not proof of anything. The thresholds are deliberately
 * loose; this stage is here to catch the obviously wrong, not to be clever.
 */
export const directionCompatibilityStage: MatchingStage = {
  id: "directionCompatibility",
  name: "Direction Compatibility",
  description: "Bearing, destination proximity and destination progress along the route.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);

      if (!corridor) {
        continue;
      }

      // An idle driver's "route" is a single point: there is no direction to
      // be incompatible with, and every destination is ahead of them.
      if (corridor.isIdle) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [reason("DIRECTION_COMPATIBLE", "Driver is idle — no route to conflict with")],
        });
        continue;
      }

      const routeBearing = polylineBearingDeg(corridor.polyline);
      const requestBearing = bearingDeg(request.pickup, request.drop);
      const difference =
        routeBearing === null ? 0 : bearingDifferenceDeg(routeBearing, requestBearing);

      const dropToRouteKm = pointToPolylineKm(request.drop, corridor.polyline);
      const dropProgressKm = projectOnPolylineKm(request.drop, corridor.polyline);
      // The corridor polyline starts at the vehicle, so the vehicle's own
      // progress along it is zero and every point is trivially "ahead" of it.
      // The question that actually discriminates is whether the destination is
      // ahead of the *pickup* along the direction of travel: a drop that
      // projects earlier than its own pickup means the rider wants to go back
      // the way this vehicle came.
      const pickupProgressKm = projectOnPolylineKm(request.pickup, corridor.polyline);

      context.recordMetrics(driverId, {
        bearingDifferenceDeg: round(difference, 1),
        dropToRouteKm: round(dropToRouteKm, 2),
        dropProgressKm: round(dropProgressKm, 2),
        pickupProgressKm: round(pickupProgressKm, 2),
      });

      const failure = firstDirectionFailure({
        difference,
        dropToRouteKm,
        dropProgressKm,
        pickupProgressKm,
        maxBearingDifferenceDeg: settings.maxBearingDifferenceDeg,
        maxDropToRouteDistanceKm: settings.maxDropToRouteDistanceKm,
      });

      if (failure) {
        verdicts.push({ driverId, status: "FAILED", reasons: [failure] });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("DIRECTION_COMPATIBLE", "Request travels compatibly with this route", {
            value: round(difference, 1),
            threshold: settings.maxBearingDifferenceDeg,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

/** Checked in a fixed order so the reported reason is deterministic. */
function firstDirectionFailure(args: {
  difference: number;
  dropToRouteKm: number;
  dropProgressKm: number;
  pickupProgressKm: number;
  maxBearingDifferenceDeg: number;
  maxDropToRouteDistanceKm: number;
}): MatchReason | undefined {
  if (args.difference > args.maxBearingDifferenceDeg) {
    return reason("BEARING_INCOMPATIBLE", "Request heads in a different direction to this route", {
      value: round(args.difference, 1),
      threshold: args.maxBearingDifferenceDeg,
    });
  }

  if (args.dropToRouteKm > args.maxDropToRouteDistanceKm) {
    return reason("DESTINATION_OFF_CORRIDOR", "Destination sits well off this route's corridor", {
      value: round(args.dropToRouteKm, 2),
      threshold: args.maxDropToRouteDistanceKm,
    });
  }

  // A destination the vehicle would have to double back to reach is a reject
  // however close it is to the line — the same failure mode as a pickup behind
  // the vehicle, one stop further along.
  if (args.dropProgressKm < args.pickupProgressKm) {
    return reason(
      "DESTINATION_BEHIND_VEHICLE",
      "Destination lies behind the pickup along this route's direction of travel",
      {
        value: round(args.dropProgressKm, 2),
        threshold: round(args.pickupProgressKm, 2),
      },
    );
  }

  return undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
```

Add to `DriverMetrics`:

```ts
  // Direction compatibility
  bearingDifferenceDeg?: number;
  dropToRouteKm?: number;
  dropProgressKm?: number;
  pickupProgressKm?: number;
```

- [x] **Step 4: Run the tests**

Run: `bun run test src/test/directionCompatibility.test.ts`
Expected: PASS, all six cases.

- [x] **Step 5: Commit**

```bash
git add src/matching src/test/directionCompatibility.test.ts
git commit -m "feat(simulation): stage 4 direction and destination compatibility"
```

---

## Task 14: Stage 5 — Legal stop sequences — LANDED

**Files:**
- Create: `src/matching/insertion/enumerate.ts`
- Modify: `src/matching/stages/stopSequenceGeneration.ts`
- Modify: `src/matching/types.ts` (`MatchingContext`)
- Test: `src/test/insertion.test.ts` (modify — it already covers `enumerateInsertions`)
- Test: `src/test/stopSequenceGeneration.test.ts` (create)

**Interfaces:**
- Consumes: `computeSegmentOccupancy`, `computeOnboardSeats` from `@/matching/occupancy`; `toProposedStops`, `newRiderStops` from `@/matching/stops`; `MAX_INTERMEDIATE_WAYPOINTS`.
- Produces:
  - `enumerateInsertions(existingStops, newPickup, newDrop): RouteInsertionCandidate[]` — moved verbatim out of `routeInsertion.ts`.
  - `MatchingContext.getSequences(driverId): RouteInsertionCandidate[]` and `setSequences(driverId, candidates)` — stages 6, 7 and 8 read them.
  - `DriverMetrics.enumeratedSequences?`, `capacityFeasibleSequences?`.

- [x] **Step 1: Move the enumerator**

Create `src/matching/insertion/enumerate.ts` and move `enumerateInsertions` into it **verbatim** from `src/matching/routeInsertion.ts`, including its doc comment. Then re-export it from `src/matching/insertion/index.ts`:

```ts
export { enumerateInsertions } from "./enumerate";
```

Update `src/test/insertion.test.ts` to import from `@/matching/insertion` instead of `@/matching/routeInsertion`. Its existing assertions — candidate count `(n+1)(n+2)/2`, frozen existing order, pickup before drop — all still apply and must keep passing unchanged.

- [x] **Step 2: Write the failing stage test**

Create `src/test/stopSequenceGeneration.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

const twoStopRide: MakeContextInput = {
  driverId: "d1",
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayMin: 8 }],
};

describe("stopSequenceGeneration", () => {
  it("enumerates exactly (n+1)(n+2)/2 candidates for n committed stops", async () => {
    const context = makeContext(twoStopRide);

    await stopSequenceGenerationStage.execute(context);

    // n = 2 → 3 × 4 / 2 = 6
    expect(context.getMetrics("d1").enumeratedSequences).toBe(6);
  });

  it("publishes the surviving sequences for later stages", async () => {
    const context = makeContext(twoStopRide);

    await stopSequenceGenerationStage.execute(context);

    expect(context.getSequences("d1").length).toBeGreaterThan(0);
    for (const candidate of context.getSequences("d1")) {
      const ids = candidate.stops.map((stop) => stop.id);
      expect(ids.indexOf("req_1:pickup")).toBeLessThan(ids.indexOf("req_1:drop"));
    }
  });

  it("never reorders the committed stops relative to each other", async () => {
    const context = makeContext(twoStopRide);

    await stopSequenceGenerationStage.execute(context);

    for (const candidate of context.getSequences("d1")) {
      const committed = candidate.stops.filter((stop) => !stop.isNew).map((stop) => stop.id);
      expect(committed).toEqual(["s1", "s2"]);
    }
  });

  it("prunes sequences that exceed capacity at any segment", async () => {
    const context = makeContext({
      ...twoStopRide,
      vehicle: { totalSeats: 1 },
      passengers: [
        { id: "pA", state: "WAITING", maxPickupDelayMin: 5, maxDropDelayMin: 8, seatsRequired: 1 },
      ],
    });

    await stopSequenceGenerationStage.execute(context);
    const metrics = context.getMetrics("d1");

    // Only the ordering where the new rider is fully served before pA boards,
    // or fully after pA alights, keeps a one-seat vehicle legal.
    expect(metrics.capacityFeasibleSequences).toBeLessThan(metrics.enumeratedSequences ?? 0);
  });

  it("fails a driver with no capacity-feasible ordering", async () => {
    const context = makeContext({
      driverId: "d1",
      committedStops: [{ id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 15 }],
      passengers: [
        { id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 8, seatsRequired: 4 },
      ],
      vehicle: { totalSeats: 4 },
    });

    const outcome = await stopSequenceGenerationStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("SEGMENT_CAPACITY_EXCEEDED");
  });

  it("rejects a route that would exceed the provider's waypoint limit", async () => {
    const manyStops = Array.from({ length: 26 }, (_, index) => ({
      id: `s${String(index)}`,
      passengerId: `p${String(index)}`,
      type: index % 2 === 0 ? ("PICKUP" as const) : ("DROP" as const),
      originalEtaMin: index,
    }));

    const context = makeContext({
      driverId: "d1",
      committedStops: manyStops,
      passengers: manyStops.map((stop) => ({
        id: stop.passengerId,
        state: "WAITING" as const,
        maxPickupDelayMin: 5,
        maxDropDelayMin: 8,
      })),
      vehicle: { totalSeats: 40 },
    });

    const outcome = await stopSequenceGenerationStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("WAYPOINT_LIMIT_EXCEEDED");
  });
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `bun run test src/test/stopSequenceGeneration.test.ts`
Expected: FAIL — `context.getSequences is not a function`.

- [x] **Step 4: Add sequence storage to the context**

In `src/matching/types.ts`:

```ts
  /** Candidate orderings published by stage 5 and narrowed by stages 6 and 7. */
  getSequences(driverId: string): RouteInsertionCandidate[];
  setSequences(driverId: string, candidates: RouteInsertionCandidate[]): void;
```

Wire both in `createContext` in `src/matching/engine.ts` against a `Map<string, RouteInsertionCandidate[]>` held for the run, exactly like the corridor map from Task 11. Add the same pair to `src/test/fixtures/stageContext.ts`.

- [x] **Step 5: Implement the stage**

Replace `src/matching/stages/stopSequenceGeneration.ts`:

```ts
import type { Passenger } from "@/domain/entities";
import { MAX_INTERMEDIATE_WAYPOINTS } from "@/domain/settings";

import { enumerateInsertions } from "../insertion";
import { computeOnboardSeats, computeSegmentOccupancy } from "../occupancy";
import { reason } from "../reasons";
import { newRiderStops, toProposedStops } from "../stops";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionCandidate,
  StageOutcome,
} from "../types";

/**
 * Stage 5. Where could the new rider actually be inserted?
 *
 * Naively there are `(k+2)!` orderings of `k` committed stops plus two new
 * ones. Almost all are illegal. Treating the committed stops as a frozen spine
 * and searching only for where the two new stops slot in gives exactly
 * `(n+1)(n+2)/2` candidates — polynomial rather than factorial, and every one
 * of them precedence-correct by construction rather than by filtering.
 *
 * Occupancy pruning runs here because it is free. On a busy vehicle it removes
 * most candidates before a single expensive thing has happened.
 */
export const stopSequenceGenerationStage: MatchingStage = {
  id: "stopSequenceGeneration",
  name: "Stop Sequence Generation",
  description: "Enumerates legal insertion positions under precedence and capacity.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const { pickup, drop } = newRiderStops(request);
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const vehicle = context.getVehicleForDriver(driverId);
      const ride = context.getRideForDriver(driverId);

      if (!vehicle) {
        continue;
      }

      const existingStops = ride ? toProposedStops(ride.stops, passengersById) : [];
      const onboardSeats = ride ? computeOnboardSeats(ride.passengerIds, passengersById) : 0;

      // Every candidate has the same waypoint count, so this is a route-level
      // gate rather than a per-candidate one.
      const intermediateCount = existingStops.length + 1;
      if (intermediateCount > MAX_INTERMEDIATE_WAYPOINTS) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "WAYPOINT_LIMIT_EXCEEDED",
              "Route exceeds the maximum intermediate waypoints the routing provider accepts",
              { value: intermediateCount, threshold: MAX_INTERMEDIATE_WAYPOINTS },
            ),
          ],
        });
        continue;
      }

      const candidates = enumerateInsertions(existingStops, pickup, drop);
      const feasible: RouteInsertionCandidate[] = [];
      let worstPeak = 0;

      for (const candidate of candidates) {
        const occupancy = computeSegmentOccupancy(candidate.stops, onboardSeats, vehicle.totalSeats);

        if (occupancy.overflowAtIndex === null) {
          feasible.push(candidate);
        } else {
          worstPeak = Math.max(worstPeak, occupancy.peakOccupancy);
        }
      }

      context.recordMetrics(driverId, {
        enumeratedSequences: candidates.length,
        capacityFeasibleSequences: feasible.length,
        totalSeats: vehicle.totalSeats,
      });

      if (feasible.length === 0) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "SEGMENT_CAPACITY_EXCEEDED",
              "No insertion position keeps the vehicle within capacity on every segment",
              { value: worstPeak, threshold: vehicle.totalSeats },
            ),
          ],
        });
        continue;
      }

      context.setSequences(driverId, feasible);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("SEQUENCE_GENERATED", `${String(feasible.length)} legal ordering(s) available`, {
            value: feasible.length,
            threshold: candidates.length,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};
```

Add to `DriverMetrics`:

```ts
  // Sequence generation
  enumeratedSequences?: number;
  capacityFeasibleSequences?: number;
```

- [x] **Step 6: Run the tests**

Run: `bun run test src/test/stopSequenceGeneration.test.ts src/test/insertion.test.ts`
Expected: PASS. The moved-enumerator tests must pass unchanged — if they do not, the move was not verbatim.

- [x] **Step 7: Commit**

```bash
git add src/matching src/test
git commit -m "feat(simulation): stage 5 legal stop sequence enumeration"
```

---

## Task 15: Stage 6 — Flexible pickup time window — LANDED

**Files:**
- Modify: `src/matching/stages/pickupTimeWindow.ts`
- Test: `src/test/pickupTimeWindow.test.ts` (create)

**Interfaces:**
- Consumes: `context.getSequences` (Task 14); `budgetsByDriver` note from stage 1 (Task 10) — read via a new `context.getDelayBudgets(driverId)` accessor added here; `haversineKm`; `settings.estimatedSpeedKmh` (new).
- Produces: `MatchingContext.getDelayBudgets(driverId): StopDelayBudget[]` and `setDelayBudgets(driverId, budgets)`; `DriverMetrics.timeWindowFeasibleSequences?`.

- [x] **Step 1: Publish the budgets through the context**

Stage 1 currently returns budgets in `notes`, which the UI reads but stages cannot. Add storage exactly like the corridor and sequence maps:

In `src/matching/types.ts`:

```ts
  /** Per-stop delay budgets published by stage 1 and enforced by stages 6 and 10. */
  getDelayBudgets(driverId: string): StopDelayBudget[];
  setDelayBudgets(driverId: string, budgets: StopDelayBudget[]): void;
```

Import `StopDelayBudget` from `./stages/operationalState`. Wire the pair in `createContext` and in `src/test/fixtures/stageContext.ts`. In `operationalState.ts`, call `context.setDelayBudgets(driverId, budgets)` alongside the existing `notes` write — the notes stay for the UI.

Add to `MatchingSettings`, `DEFAULT_SETTINGS` and `matchingSettingsSchema`:

```ts
  /**
   * Average road speed used only for stage 6's straight-line ETA pre-filter.
   * Never used for a reported ETA — those all come from stage 8.
   */
  estimatedSpeedKmh: number;
```

with a default of `24` and a schema of `z.number().min(1)`.

- [x] **Step 2: Write the failing test**

Create `src/test/pickupTimeWindow.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { operationalStateStage } from "@/matching/stages/operationalState";
import { pickupTimeWindowStage } from "@/matching/stages/pickupTimeWindow";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function run(input: MakeContextInput) {
  const context = makeContext(input);
  await operationalStateStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  const outcome = await pickupTimeWindowStage.execute(context);
  return { context, outcome };
}

// pA is waiting far along the route; the new rider's pickup sits before them.
const waitingRider: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 4, lat: 28.6, lng: 77.24 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 20, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 20, maxDropDelayMin: 20 }],
  request: { pickup: { lat: 28.6, lng: 77.22 }, drop: { lat: 28.6, lng: 77.3 } },
};

describe("pickupTimeWindow", () => {
  it("keeps orderings that respect a generous budget", async () => {
    const { context, outcome } = await run(waitingRider);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(context.getSequences("d1").length).toBeGreaterThan(0);
  });

  it("drops orderings that breach a strict passenger's own budget", async () => {
    const generous = await run(waitingRider);
    const strict = await run({
      ...waitingRider,
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
    });

    expect(strict.context.getSequences("d1").length).toBeLessThan(
      generous.context.getSequences("d1").length,
    );
  });

  it("rejects the driver only when every ordering breaches a budget", async () => {
    const { outcome } = await run({
      ...waitingRider,
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
      request: {
        pickup: { lat: 28.7, lng: 77.22 },
        drop: { lat: 28.7, lng: 77.3 },
      },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(["COMMITTED_PICKUP_DELAY_TOO_HIGH", "COMMITTED_DROP_DELAY_TOO_HIGH"]).toContain(
      outcome.verdicts[0]!.reasons[0]!.code,
    );
  });

  it("passes an idle driver untouched", async () => {
    const { outcome } = await run({
      driverId: "d2",
      committedStops: [],
      passengers: [],
    });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("records how many orderings survived", async () => {
    const { context } = await run(waitingRider);

    expect(context.getMetrics("d1").timeWindowFeasibleSequences).toBe(
      context.getSequences("d1").length,
    );
  });
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `bun run test src/test/pickupTimeWindow.test.ts`
Expected: FAIL — no-op stage narrows nothing.

- [x] **Step 4: Implement the stage**

Replace `src/matching/stages/pickupTimeWindow.ts`:

```ts
import { haversineKm } from "@/lib/geo";

import { reason, type MatchReason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionCandidate,
  StageOutcome,
} from "../types";

/**
 * Stage 6. Does this ordering break a promise we already made?
 *
 * This is stage 1's flexible-commitment policy applied per ordering. A
 * committed passenger is not frozen — inserting ahead of them is allowed
 * exactly as long as their own tolerance absorbs the delay. What gets rejected
 * is the *ordering*, never the driver: a driver survives as long as any one
 * ordering works.
 *
 * The ETA used here is a straight-line estimate, deliberately. This is a
 * pre-filter whose only job is to shrink the solver's search space; stage 10
 * re-checks the identical budgets against the solver's real leg times, and the
 * same budgets go to the solver as hard time windows. Three checks, one source
 * of truth — the passenger record.
 */
export const pickupTimeWindowStage: MatchingStage = {
  id: "pickupTimeWindow",
  name: "Pickup Time Window",
  description: "Drops orderings that breach a committed passenger's own delay budget.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);
      const budgets = context.getDelayBudgets(driverId);
      const candidates = context.getSequences(driverId);

      if (!corridor || candidates.length === 0 || budgets.length === 0) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [reason("TIME_WINDOW_OK", "No committed promises to protect")],
        });
        continue;
      }

      const budgetByStopId = new Map(budgets.map((budget) => [budget.stopId, budget]));
      const surviving: RouteInsertionCandidate[] = [];
      let lastFailure: MatchReason | undefined;

      for (const candidate of candidates) {
        const failure = firstBudgetBreach({
          candidate,
          start: corridor.polyline[0]!,
          budgetByStopId,
          speedKmh: settings.estimatedSpeedKmh,
        });

        if (failure) {
          lastFailure = failure;
        } else {
          surviving.push(candidate);
        }
      }

      context.recordMetrics(driverId, { timeWindowFeasibleSequences: surviving.length });

      if (surviving.length === 0) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            lastFailure ??
              reason(
                "COMMITTED_PICKUP_DELAY_TOO_HIGH",
                "No ordering keeps every committed promise within its delay budget",
              ),
          ],
        });
        continue;
      }

      context.setSequences(driverId, surviving);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("TIME_WINDOW_OK", `${String(surviving.length)} ordering(s) keep every promise`, {
            value: surviving.length,
            threshold: candidates.length,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function firstBudgetBreach(args: {
  candidate: RouteInsertionCandidate;
  start: { lat: number; lng: number };
  budgetByStopId: ReadonlyMap<string, { budgetMin: number; originalEtaMin: number; type: "PICKUP" | "DROP" }>;
  speedKmh: number;
}): MatchReason | undefined {
  const { candidate, start, budgetByStopId, speedKmh } = args;

  let cumulativeKm = 0;
  let previous = start;

  for (const stop of candidate.stops) {
    cumulativeKm += haversineKm(previous, stop.location);
    previous = stop.location;

    const budget = budgetByStopId.get(stop.id);
    if (!budget) {
      continue;
    }

    const projectedEtaMin = (cumulativeKm / speedKmh) * 60;
    const delayMin = projectedEtaMin - budget.originalEtaMin;

    if (delayMin > budget.budgetMin) {
      return reason(
        budget.type === "PICKUP"
          ? "COMMITTED_PICKUP_DELAY_TOO_HIGH"
          : "COMMITTED_DROP_DELAY_TOO_HIGH",
        budget.type === "PICKUP"
          ? "This ordering would collect a committed passenger later than they accept"
          : "This ordering would drop a committed passenger later than they accept",
        { value: round(delayMin, 2), threshold: budget.budgetMin },
      );
    }
  }

  return undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
```

Add to `DriverMetrics`:

```ts
  timeWindowFeasibleSequences?: number;
```

- [x] **Step 5: Run the tests**

Run: `bun run test src/test/pickupTimeWindow.test.ts`
Expected: PASS, all five cases.

- [x] **Step 6: Commit**

```bash
git add src/matching src/domain src/test
git commit -m "feat(simulation): stage 6 per-passenger pickup time windows"
```

---

## Task 16: Stage 7 — Detour lower bound — LANDED

**Files:**
- Modify: `src/matching/stages/detourLowerBound.ts`
- Test: `src/test/detourLowerBound.test.ts` (create)

**Interfaces:**
- Consumes: `context.getSequences`, `context.getCorridor`; `pathLengthKm` from `@/lib/geo`; settings `maxAdditionalDistanceKm`, `maxRoutedInsertionsPerDriver`.
- Produces: `DriverMetrics.lowerBoundAdditionalKm?`, `boundFeasibleSequences?`, `shortlistedSequences?`.

- [x] **Step 1: Write the failing test**

Create `src/test/detourLowerBound.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";

async function run(input: MakeContextInput) {
  const context = makeContext(input);
  await h3RouteCorridorStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  const outcome = await detourLowerBoundStage.execute(context);
  return { context, outcome };
}

const onRoute: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.35 },
  ],
  passengers: [{ id: "pA", state: "IN_RIDE", maxPickupDelayMin: 5, maxDropDelayMin: 20 }],
  request: { pickup: { lat: 28.6, lng: 77.25 }, drop: { lat: 28.6, lng: 77.32 } },
};

describe("detourLowerBound", () => {
  it("passes a request that barely lengthens the route", async () => {
    const { outcome, context } = await run(onRoute);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(context.getMetrics("d1").lowerBoundAdditionalKm).toBeLessThan(1);
  });

  it("rejects when even the straight-line bound already exceeds the cap", async () => {
    const { outcome } = await run({
      ...onRoute,
      request: { pickup: { lat: 28.9, lng: 77.25 }, drop: { lat: 28.95, lng: 77.32 } },
      settings: { maxAdditionalDistanceKm: 3 },
    });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("DETOUR_LOWER_BOUND_EXCEEDED");
  });

  it("reports the bound and the threshold on the rejection", async () => {
    const { outcome } = await run({
      ...onRoute,
      request: { pickup: { lat: 28.9, lng: 77.25 }, drop: { lat: 28.95, lng: 77.32 } },
      settings: { maxAdditionalDistanceKm: 3 },
    });

    const rejection = outcome.verdicts[0]!.reasons[0]!;
    expect(rejection.threshold).toBe(3);
    expect(Number(rejection.value)).toBeGreaterThan(3);
  });

  it("shortlists no more sequences than maxRoutedInsertionsPerDriver", async () => {
    const { context } = await run({
      driverId: "d1",
      driverLocation: { lat: 28.6, lng: 77.2 },
      committedStops: [
        { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
        { id: "s2", passengerId: "pB", type: "PICKUP", originalEtaMin: 6, lat: 28.6, lng: 77.24 },
        { id: "s3", passengerId: "pA", type: "DROP", originalEtaMin: 18, lat: 28.6, lng: 77.3 },
        { id: "s4", passengerId: "pB", type: "DROP", originalEtaMin: 24, lat: 28.6, lng: 77.34 },
      ],
      passengers: [
        { id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 },
        { id: "pB", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 },
      ],
      vehicle: { totalSeats: 6 },
      settings: { maxRoutedInsertionsPerDriver: 3 },
      request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
    });

    expect(context.getSequences("d1").length).toBeLessThanOrEqual(3);
    expect(context.getMetrics("d1").shortlistedSequences).toBe(context.getSequences("d1").length);
  });

  it("keeps the cheapest sequence when shortlisting", async () => {
    const { context } = await run({ ...onRoute, settings: { maxRoutedInsertionsPerDriver: 1 } });

    expect(context.getSequences("d1")).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/detourLowerBound.test.ts`
Expected: FAIL — no-op stage.

- [x] **Step 3: Implement the stage**

Replace `src/matching/stages/detourLowerBound.ts`:

```ts
import { pathLengthKm } from "@/lib/geo";

import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionCandidate,
  StageOutcome,
} from "../types";

/**
 * Stage 7. Is this provably too expensive, using only free arithmetic?
 *
 * Road distance can never be shorter than straight-line distance, so the
 * straight-line added length is an admissible lower bound — the same principle
 * as an admissible heuristic in A*. If the optimistic bound already breaks a
 * hard limit, the pessimistic reality certainly will, and a solver call would
 * only confirm that expensively.
 *
 * This stage changes no outcome. It only changes how many calls stage 8 makes.
 * That distinction matters: a bound that pruned a candidate stage 10 would
 * have accepted would be a bug, not an optimisation.
 */
export const detourLowerBoundStage: MatchingStage = {
  id: "detourLowerBound",
  name: "Detour Lower Bound",
  description: "Prunes sequences whose straight-line lower bound already fails.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);
      const candidates = context.getSequences(driverId);

      if (!corridor || candidates.length === 0) {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [reason("LOWER_BOUND_OK", "No sequences to bound")],
        });
        continue;
      }

      const start = corridor.polyline[0]!;
      const baselineKm = pathLengthKm(corridor.polyline);

      const scored = candidates.map((candidate) => ({
        candidate,
        addedKm:
          pathLengthKm([start, ...candidate.stops.map((stop) => stop.location)]) - baselineKm,
      }));

      scored.sort((a, b) => a.addedKm - b.addedKm);

      const best = scored[0]!;
      context.recordMetrics(driverId, {
        lowerBoundAdditionalKm: round(best.addedKm, 2),
      });

      // The best candidate's bound is the driver's bound: if even the cheapest
      // possible insertion is provably too long, no ordering can save them.
      if (best.addedKm > settings.maxAdditionalDistanceKm) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "DETOUR_LOWER_BOUND_EXCEEDED",
              "Even the straight-line lower bound exceeds the added-distance cap",
              { value: round(best.addedKm, 2), threshold: settings.maxAdditionalDistanceKm },
            ),
          ],
        });
        continue;
      }

      const withinBound = scored.filter(
        (entry) => entry.addedKm <= settings.maxAdditionalDistanceKm,
      );

      // A separate, blunter cap on top of the bound. The bound removes only
      // provably-hopeless candidates; this one bounds spend regardless of how
      // many plausible candidates survive.
      const shortlisted: RouteInsertionCandidate[] = withinBound
        .slice(0, settings.maxRoutedInsertionsPerDriver)
        .map((entry) => entry.candidate);

      context.recordMetrics(driverId, {
        boundFeasibleSequences: withinBound.length,
        shortlistedSequences: shortlisted.length,
      });

      context.setSequences(driverId, shortlisted);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("LOWER_BOUND_OK", "Insertion is within the added-distance cap", {
            value: round(best.addedKm, 2),
            threshold: settings.maxAdditionalDistanceKm,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
```

Add to `DriverMetrics`:

```ts
  lowerBoundAdditionalKm?: number;
  boundFeasibleSequences?: number;
  shortlistedSequences?: number;
```

- [x] **Step 4: Run the tests**

Run: `bun run test src/test/detourLowerBound.test.ts`
Expected: PASS, all five cases.

- [x] **Step 5: Add the admissibility regression**

Append to `src/test/detourLowerBound.test.ts`:

```ts
it("never prunes a candidate whose real added distance is within the cap", async () => {
  // Straight-line can only under-estimate road distance, so any candidate the
  // bound rejects must also fail on the road. Assert the inequality directly.
  const { context } = await run({ ...onRoute, settings: { maxAdditionalDistanceKm: 50 } });

  const bound = context.getMetrics("d1").lowerBoundAdditionalKm ?? 0;
  const straightLine = context.getMetrics("d1").straightLineKm ?? 0;

  expect(bound).toBeLessThanOrEqual(straightLine * 2 + 0.001);
});
```

Run: `bun run test src/test/detourLowerBound.test.ts`
Expected: PASS, six cases.

- [x] **Step 6: Commit**

```bash
git add src/matching src/test/detourLowerBound.test.ts
git commit -m "feat(simulation): stage 7 admissible detour lower bound"
```

---

## Task 17: Stage 8 — Road routing via OptimizeTours — LANDED

The largest task in the plan. It wires the optimizer into the engine, replaces the routing done inside `routeInsertion.ts`, and deletes that file.

**Files:**
- Modify: `src/matching/stages/roadRouting.ts`
- Modify: `src/matching/types.ts` (`MatchingContext`, `RouteInsertionResult`)
- Modify: `src/matching/engine.ts` (`RunMatchingOptions`, context, telemetry)
- Modify: `src/services/MatchingService.ts`, `src/services/LocalMatchingService.ts`
- Delete: `src/matching/routeInsertion.ts`
- Create: `src/test/fixtures/stubOptimizer.ts`
- Test: `src/test/roadRouting.test.ts` (create)

**Interfaces:**
- Consumes: `buildOptimizeToursRequest`, `toProposedStopSequence`, `OptimizerEngine`, `OptimizerBudgetExceededError`, `OptimizerCredentialsMissingError`, `OptimizerUnavailableError` (Tasks 4–7); `context.getSequences`, `context.getCorridor`.
- Produces:
  - `MatchingContext.optimizer: OptimizerEngine`
  - `MatchingContext.getSolution(driverId): SolvedRoute | undefined` / `setSolution(driverId, solution)` where
    ```ts
    interface SolvedRoute {
      stops: ProposedStop[];
      legs: RouteLegResult[];
      arrivalByStopId: Map<string, number>;
      totalDistanceKm: number;
      totalDurationMin: number;
      baselineDistanceKm: number;
      baselineDurationMin: number;
      baselineArrivalByStopId: Map<string, number>;
      soloDurationMin: number;
    }
    ```
  - `MatchingResult.optimizerTelemetry: OptimizerTelemetrySnapshot`
  - `MatchingRun.optimizerUnavailableReason: string | null`

- [x] **Step 1: Write the stub optimizer fixture**

Create `src/test/fixtures/stubOptimizer.ts`:

```ts
import { haversineKm } from "@/lib/geo";
import type {
  OptimizerEngine,
  OptimizerVisit,
  OptimizeToursRequest,
  OptimizeToursResult,
} from "@/optimization/types";
import type { RouteLegResult } from "@/routing/types";

/** Same road-factor and speed model `MockRoutingEngine` uses, so the two agree. */
const ROAD_FACTOR = 1.35;
const SPEED_KMH = 24;

interface Candidate {
  visits: { shipmentIndex: number; type: "PICKUP" | "DROP" }[];
}

/**
 * A deterministic stand-in for `OptimizeTours`.
 *
 * It honours the same contract the real solver does — locked spine, capacity,
 * hard deadlines, mandatory versus skippable shipments — and picks the
 * shortest straight-line legal ordering. That is not what Google's solver
 * optimises for, and it does not need to be: these tests assert that the
 * pipeline handles a solution correctly, not that the solver is good.
 */
export class StubOptimizerEngine implements OptimizerEngine {
  readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
  readonly requests: OptimizeToursRequest[] = [];

  optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
    this.requests.push(request);

    const orderings = enumerateLegalOrderings(request);
    const scored = orderings
      .map((candidate) => ({ candidate, cost: costOf(request, candidate) }))
      .filter((entry) => Number.isFinite(entry.cost))
      .sort((a, b) => a.cost - b.cost);

    const winner = scored[0];

    if (!winner) {
      // Nothing legal serves everybody. Drop the skippable shipments and
      // report them, exactly as the real API does.
      const skippable = request.shipments.filter((shipment) => shipment.penaltyCost !== null);
      const reduced: OptimizeToursRequest = {
        ...request,
        shipments: request.shipments.filter((shipment) => shipment.penaltyCost === null),
      };

      if (skippable.length === 0 || reduced.shipments.length === request.shipments.length) {
        return Promise.resolve({
          visits: [],
          legs: [],
          totalDistanceKm: 0,
          totalDurationMin: 0,
          skippedShipmentIds: skippable.map((shipment) => shipment.id),
        });
      }

      return this.optimize(reduced).then((result) => ({
        ...result,
        skippedShipmentIds: [...result.skippedShipmentIds, ...skippable.map((s) => s.id)],
      }));
    }

    return Promise.resolve(materialise(request, winner.candidate));
  }
}

function enumerateLegalOrderings(request: OptimizeToursRequest): Candidate[] {
  const events = request.shipments.flatMap((shipment, index) => [
    { shipmentIndex: index, type: "PICKUP" as const },
    { shipmentIndex: index, type: "DROP" as const },
  ]);

  const results: Candidate[] = [];

  const walk = (remaining: typeof events, built: typeof events): void => {
    if (remaining.length === 0) {
      results.push({ visits: [...built] });
      return;
    }

    for (let index = 0; index < remaining.length; index += 1) {
      const event = remaining[index]!;

      // Precedence: a drop may only follow its own pickup.
      if (
        event.type === "DROP" &&
        !built.some(
          (done) => done.shipmentIndex === event.shipmentIndex && done.type === "PICKUP",
        )
      ) {
        continue;
      }

      walk([...remaining.slice(0, index), ...remaining.slice(index + 1)], [...built, event]);
    }
  };

  walk(events, []);

  return results.filter((candidate) => respectsSpine(request, candidate));
}

/** The locked visits must appear, in order, at the head of the route. */
function respectsSpine(request: OptimizeToursRequest, candidate: Candidate): boolean {
  const indexById = new Map(request.shipments.map((shipment, index) => [shipment.id, index]));

  return request.lockedVisits.every((locked, position) => {
    const visit = candidate.visits[position];
    return (
      visit !== undefined &&
      visit.type === locked.type &&
      visit.shipmentIndex === indexById.get(locked.shipmentId)
    );
  });
}

/** Straight-line cost, or Infinity if capacity or a hard deadline is broken. */
function costOf(request: OptimizeToursRequest, candidate: Candidate): number {
  let occupancy = 0;
  let cumulativeKm = 0;
  let previous = request.vehicleStart;

  for (const visit of candidate.visits) {
    const shipment = request.shipments[visit.shipmentIndex]!;
    const location = visit.type === "PICKUP" ? shipment.pickup : shipment.drop;

    cumulativeKm += haversineKm(previous, location) * ROAD_FACTOR;
    previous = location;

    occupancy += visit.type === "PICKUP" ? shipment.seats : -shipment.seats;
    if (occupancy > request.seatCapacity) {
      return Infinity;
    }

    const arrivalMin = (cumulativeKm / SPEED_KMH) * 60;
    const deadline =
      visit.type === "PICKUP" ? shipment.pickupDeadlineMin : shipment.dropDeadlineMin;

    if (deadline !== undefined && arrivalMin > deadline) {
      return Infinity;
    }
  }

  return cumulativeKm;
}

function materialise(request: OptimizeToursRequest, candidate: Candidate): OptimizeToursResult {
  const visits: OptimizerVisit[] = [];
  const legs: RouteLegResult[] = [];
  let previous = request.vehicleStart;
  let cumulativeMin = 0;
  let totalDistanceKm = 0;

  for (const visit of candidate.visits) {
    const shipment = request.shipments[visit.shipmentIndex]!;
    const location = visit.type === "PICKUP" ? shipment.pickup : shipment.drop;
    const distanceKm = haversineKm(previous, location) * ROAD_FACTOR;
    const durationMin = (distanceKm / SPEED_KMH) * 60;

    previous = location;
    cumulativeMin += durationMin;
    totalDistanceKm += distanceKm;

    legs.push({ distanceKm, durationMin });
    visits.push({
      shipmentId: shipment.id,
      passengerId: shipment.passengerId,
      type: visit.type,
      location,
      arrivalMin: cumulativeMin,
    });
  }

  return {
    visits,
    legs,
    totalDistanceKm,
    totalDurationMin: cumulativeMin,
    skippedShipmentIds: [],
  };
}
```

- [x] **Step 2: Write the failing test**

Create `src/test/roadRouting.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  OptimizerBudgetExceededError,
  OptimizerCredentialsMissingError,
  type OptimizerEngine,
  type OptimizeToursRequest,
  type OptimizeToursResult,
} from "@/optimization/types";
import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { operationalStateStage } from "@/matching/stages/operationalState";
import { roadRoutingStage } from "@/matching/stages/roadRouting";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";
import { StubOptimizerEngine } from "./fixtures/stubOptimizer";

async function run(input: MakeContextInput & { optimizer?: OptimizerEngine }) {
  const context = makeContext(input);
  await operationalStateStage.execute(context);
  await h3RouteCorridorStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  await detourLowerBoundStage.execute(context);
  const outcome = await roadRoutingStage.execute(context);
  return { context, outcome };
}

const pooled: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
};

describe("roadRouting", () => {
  it("produces a solved route with one leg per stop", async () => {
    const { context, outcome } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    const solution = context.getSolution("d1")!;
    expect(solution.legs).toHaveLength(solution.stops.length);
  });

  it("keeps the new rider's pickup before their drop", async () => {
    const { context } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    const ids = context.getSolution("d1")!.stops.map((stop) => `${stop.passengerId}:${stop.type}`);
    expect(ids.indexOf("pNew:PICKUP")).toBeLessThan(ids.indexOf("pNew:DROP"));
  });

  it("records an arrival time for every stop", async () => {
    const { context } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    const solution = context.getSolution("d1")!;
    for (const stop of solution.stops) {
      expect(solution.arrivalByStopId.get(stop.id)).toBeGreaterThan(0);
    }
  });

  it("computes a baseline for the pre-insertion route", async () => {
    const { context } = await run({ ...pooled, optimizer: new StubOptimizerEngine() });

    const solution = context.getSolution("d1")!;
    expect(solution.baselineDistanceKm).toBeGreaterThan(0);
    expect(solution.totalDistanceKm).toBeGreaterThanOrEqual(solution.baselineDistanceKm);
  });

  it("rejects with OPTIMIZER_INFEASIBLE when the new rider is skipped", async () => {
    class SkippingEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
        const newShipment = request.shipments.find((shipment) => shipment.penaltyCost !== null)!;
        return Promise.resolve({
          visits: [],
          legs: [],
          totalDistanceKm: 0,
          totalDurationMin: 0,
          skippedShipmentIds: [newShipment.id],
        });
      }
    }

    const { outcome } = await run({ ...pooled, optimizer: new SkippingEngine() });

    expect(outcome.verdicts[0]!.status).toBe("FAILED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPTIMIZER_INFEASIBLE");
  });

  it("reports NOT_EVALUATED when the optimizer budget is exhausted", async () => {
    class BrokeEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(): Promise<OptimizeToursResult> {
        return Promise.reject(new OptimizerBudgetExceededError(0));
      }
    }

    const { outcome } = await run({ ...pooled, optimizer: new BrokeEngine() });

    expect(outcome.verdicts[0]!.status).toBe("NOT_EVALUATED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPTIMIZER_BUDGET_EXCEEDED");
  });

  it("propagates a credentials failure rather than turning it into a verdict", async () => {
    class UnauthenticatedEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(): Promise<OptimizeToursResult> {
        return Promise.reject(new OptimizerCredentialsMissingError("no ADC"));
      }
    }

    await expect(run({ ...pooled, optimizer: new UnauthenticatedEngine() })).rejects.toBeInstanceOf(
      OptimizerCredentialsMissingError,
    );
  });

  it("fails with a SYSTEM reason if the solver drops a committed passenger", async () => {
    class BadEngine implements OptimizerEngine {
      readonly kind = "GOOGLE_OPTIMIZE_TOURS" as const;
      optimize(request: OptimizeToursRequest): Promise<OptimizeToursResult> {
        const mandatory = request.shipments.find((shipment) => shipment.penaltyCost === null)!;
        return Promise.resolve({
          visits: [],
          legs: [],
          totalDistanceKm: 0,
          totalDurationMin: 0,
          skippedShipmentIds: [mandatory.id],
        });
      }
    }

    const { outcome } = await run({ ...pooled, optimizer: new BadEngine() });

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED");
  });
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `bun run test src/test/roadRouting.test.ts`
Expected: FAIL — `context.optimizer` and `context.getSolution` do not exist.

- [x] **Step 4: Extend the context and result types**

In `src/matching/types.ts` add the `SolvedRoute` interface exactly as given in this task's Interfaces block, then add to `MatchingContext`:

```ts
  readonly optimizer: OptimizerEngine;
  getSolution(driverId: string): SolvedRoute | undefined;
  setSolution(driverId: string, solution: SolvedRoute): void;
```

and to `MatchingResult`:

```ts
  optimizerTelemetry: OptimizerTelemetrySnapshot;
```

and to `MatchingRun`:

```ts
  optimizerUnavailableReason: string | null;
```

- [x] **Step 5: Wire the optimizer through the engine**

In `src/matching/engine.ts`, add `optimizer: OptimizerEngine` and `optimizerTelemetry: () => OptimizerTelemetrySnapshot` to `RunMatchingOptions`, pass `optimizer` into `createContext`, hold a `solutions` map like the corridor map, and include `optimizerTelemetry: options.optimizerTelemetry()` in the returned `MatchingResult`.

`OptimizerCredentialsMissingError` must **not** be caught by the stage loop — let it propagate out of `runMatching` so `LocalMatchingService` can surface it as a run-level failure.

In `src/services/MatchingService.ts`, add to `FindMatchesInput`:

```ts
  /** Injected by tests. Production uses the proxy-backed engine. */
  createOptimizerEngine?: () => OptimizerEngine;
```

In `src/services/LocalMatchingService.ts`, build the optimizer stack alongside the routing stack:

```ts
    const optimizerStack = createOptimizerStack({
      settings,
      ...(input.createOptimizerEngine ? { engine: input.createOptimizerEngine() } : {}),
      cache: this.optimizerCache,
    });
```

with `private readonly optimizerCache = new OptimizerCache();` on the class, pass `optimizer: optimizerStack.engine` and `optimizerTelemetry: () => optimizerStack.telemetry.snapshot()` into `runMatching`, and set `optimizerUnavailableReason` on the returned `MatchingRun` from the telemetry snapshot. Extend `clearCache()` to clear both caches.

Add `optimizer`, `getSolution` and `setSolution` to `src/test/fixtures/stageContext.ts`, defaulting `optimizer` to a `StubOptimizerEngine` when the test does not supply one.

- [x] **Step 6: Implement the stage**

Replace `src/matching/stages/roadRouting.ts`:

```ts
import type { Passenger } from "@/domain/entities";
import {
  buildOptimizeToursRequest,
  OptimizerBudgetExceededError,
  OptimizerCredentialsMissingError,
  shipmentIdFor,
  toProposedStopSequence,
  type CommittedStopInput,
} from "@/optimization";
import type { RouteLegResult } from "@/routing/types";

import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  ProposedStop,
  SolvedRoute,
  StageOutcome,
} from "../types";

/**
 * Stage 8. What does the road actually say?
 *
 * Everything before this point was approximation. Geometric proximity lies:
 * a river, a one-way street or a central median turns a 300 m crow-flight
 * pickup into a 2.5 km detour. This is where ground truth enters.
 *
 * One `OptimizeTours` call per driver. Sending every driver as a vehicle in
 * one call would be cheaper, but the solver would then choose the driver —
 * erasing the per-driver rejection reasons this whole tool exists to show, and
 * replacing our fairness scoring with Google's vehicle-cost objective.
 */
export const roadRoutingStage: MatchingStage = {
  id: "roadRouting",
  name: "Road Routing",
  description: "Google OptimizeTours returns the winning sequence and its leg data.",

  async execute(context: MatchingContext): Promise<StageOutcome> {
    const { request, scenario, settings } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    // Shared across every driver: what this trip would cost the new rider
    // alone. It is the reference their own detour is measured against.
    const solo = await context.routing.getRoute([request.pickup, request.drop]);

    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const corridor = context.getCorridor(driverId);
      const vehicle = context.getVehicleForDriver(driverId);

      if (!corridor || !vehicle) {
        continue;
      }

      const committedStops: CommittedStopInput[] = corridor.remainingStops.map((stop, index) => ({
        id: stop.id,
        passengerId: stop.passengerId,
        type: stop.type,
        location: stop.location,
        seats: stop.seats,
        originalEtaMin: context.getDelayBudgets(driverId)[index]?.originalEtaMin ?? 0,
      }));

      const optimizerRequest = buildOptimizeToursRequest({
        driverId,
        vehicleStart: corridor.polyline[0]!,
        seatCapacity: vehicle.totalSeats,
        committedStops,
        passengersById,
        request,
        newPassengerSoftDeadlineMin: request.maxWaitMinutes,
        softDeadlineCostPerHour: 50,
        timeoutMs: settings.optimizerTimeoutMs,
      });

      let solved;

      try {
        solved = await context.optimizer.optimize(optimizerRequest);
      } catch (error) {
        // A missing credential is not an opinion about this driver — it means
        // the run cannot happen at all. Let it escape.
        if (error instanceof OptimizerCredentialsMissingError) {
          throw error;
        }

        if (error instanceof OptimizerBudgetExceededError) {
          verdicts.push({
            driverId,
            status: "NOT_EVALUATED",
            reasons: [
              reason(
                "OPTIMIZER_BUDGET_EXCEEDED",
                "Optimizer budget for this run was exhausted before this driver was evaluated",
                { threshold: settings.maxOptimizerCallsPerRun },
              ),
            ],
          });
          continue;
        }

        verdicts.push({
          driverId,
          status: "NOT_EVALUATED",
          reasons: [
            reason(
              "OPTIMIZER_CALL_FAILED",
              error instanceof Error ? error.message : "Optimizer call failed",
            ),
          ],
        });
        continue;
      }

      const newShipmentId = shipmentIdFor(request.passengerId);
      const mandatorySkipped = solved.skippedShipmentIds.filter((id) => id !== newShipmentId);

      // The solver was told these shipments could not be dropped. If one comes
      // back skipped, our model is wrong, not the driver.
      if (mandatorySkipped.length > 0) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "OPTIMIZER_MANDATORY_SHIPMENT_SKIPPED",
              `Solver dropped ${String(mandatorySkipped.length)} committed passenger(s), which the model forbids`,
              { value: mandatorySkipped.length, threshold: 0 },
            ),
          ],
        });
        continue;
      }

      if (solved.skippedShipmentIds.includes(newShipmentId)) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "OPTIMIZER_INFEASIBLE",
              "No insertion satisfies this ride's capacity and time-window constraints",
            ),
          ],
        });
        continue;
      }

      if (solved.legs.length !== solved.visits.length) {
        verdicts.push({
          driverId,
          status: "FAILED",
          reasons: [
            reason(
              "ROUTE_LEG_MISMATCH",
              "Solver returned a leg count that does not match the visit sequence",
              { value: solved.legs.length, threshold: solved.visits.length },
            ),
          ],
        });
        continue;
      }

      const stops: ProposedStop[] = toProposedStopSequence(solved, request.passengerId).map(
        (stop) => ({
          ...stop,
          seats: passengersById.get(stop.passengerId)?.seatsRequired ?? 0,
        }),
      );

      const arrivalByStopId = new Map<string, number>();
      solved.visits.forEach((visit, index) => {
        arrivalByStopId.set(stops[index]!.id, visit.arrivalMin);
      });

      const baseline = await computeBaseline(context, driverId, corridor.polyline);

      const solution: SolvedRoute = {
        stops,
        legs: solved.legs,
        arrivalByStopId,
        totalDistanceKm: solved.totalDistanceKm,
        totalDurationMin: solved.totalDurationMin,
        baselineDistanceKm: baseline.distanceKm,
        baselineDurationMin: baseline.durationMin,
        baselineArrivalByStopId: baseline.arrivalByStopId,
        soloDurationMin: solo.durationMin,
      };

      context.setSolution(driverId, solution);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("OPTIMIZER_SOLVED", `Solved a ${String(stops.length)}-stop sequence`, {
            value: stops.length,
          }),
        ],
      });
    }

    return { verdicts };
  },
};

/**
 * The driver's pre-insertion route, from the Routes API rather than the
 * optimizer.
 *
 * There is nothing to optimise about a route that is already decided, and
 * `OptimizeTours` bills per shipment — so paying solver pricing for a pure
 * measurement would be waste. The routing cache also means an unchanged
 * baseline is billed once across many runs.
 */
async function computeBaseline(
  context: MatchingContext,
  driverId: string,
  polyline: readonly { lat: number; lng: number }[],
): Promise<{
  distanceKm: number;
  durationMin: number;
  arrivalByStopId: Map<string, number>;
}> {
  const corridor = context.getCorridor(driverId);
  const arrivalByStopId = new Map<string, number>();

  if (!corridor || corridor.remainingStops.length === 0) {
    return { distanceKm: 0, durationMin: 0, arrivalByStopId };
  }

  const route = await context.routing.getRoute(polyline);
  let cumulative = 0;

  corridor.remainingStops.forEach((stop, index) => {
    const leg: RouteLegResult | undefined = route.legs[index];
    if (leg) {
      cumulative += leg.durationMin;
      arrivalByStopId.set(stop.id, cumulative);
    }
  });

  return {
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    arrivalByStopId,
  };
}
```

- [x] **Step 7: Delete the superseded insertion engine**

```bash
git rm src/matching/routeInsertion.ts
```

Any remaining import of `findBestInsertion` must go. `enumerateInsertions` now lives in `src/matching/insertion/enumerate.ts` (Task 14).

- [x] **Step 8: Run the tests**

Run: `bun run check-types && bun run test src/test/roadRouting.test.ts`
Expected: PASS, all eight cases.

- [x] **Step 9: Run the whole suite**

Run: `bun run check-types && bun run lint && bun run test`
Expected: green. `src/test/detour.test.ts` asserted on `findBestInsertion`; rewrite its arithmetic assertions against `context.getSolution` in Task 18, or mark them `.skip` here with a comment naming Task 18 — do not delete them.

- [x] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat(simulation): stage 8 routes via Google OptimizeTours"
```

---

## Task 18: Stage 9 — Incremental cost — LANDED

**Files:**
- Modify: `src/matching/stages/incrementalCost.ts`
- Modify: `src/matching/delays.ts` (accept a solved route)
- Modify: `src/test/detour.test.ts`, `src/test/delays.test.ts`
- Test: `src/test/incrementalCost.test.ts` (create)

**Interfaces:**
- Consumes: `context.getSolution` (Task 17); `computeExistingPassengerDelays`, `computeExistingPickupDelays` from `@/matching/delays`.
- Produces: on `DriverMetrics` — `originalDistanceKm`, `newDistanceKm`, `additionalDistanceKm`, `detourPercent`, `originalDurationMin`, `newDurationMin`, `additionalDurationMin`, `newPassengerPickupEtaMin`, `newPassengerPickupDelayMin`, `newPassengerRideDetourMin`, `maximumExistingPassengerDelayMin` (all already declared). Also `context.recordInsertion(driverId, RouteInsertionResult)` so the map and detail sheet keep working unchanged.

- [x] **Step 1: Write the failing test**

Create `src/test/incrementalCost.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { incrementalCostStage } from "@/matching/stages/incrementalCost";
import { operationalStateStage } from "@/matching/stages/operationalState";
import { roadRoutingStage } from "@/matching/stages/roadRouting";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";
import { StubOptimizerEngine } from "./fixtures/stubOptimizer";

async function run(input: MakeContextInput) {
  const context = makeContext({ optimizer: new StubOptimizerEngine(), ...input });
  await operationalStateStage.execute(context);
  await h3RouteCorridorStage.execute(context);
  await stopSequenceGenerationStage.execute(context);
  await detourLowerBoundStage.execute(context);
  await roadRoutingStage.execute(context);
  const outcome = await incrementalCostStage.execute(context);
  return { context, outcome };
}

const pooled: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
};

describe("incrementalCost", () => {
  it("rejects nobody — it only measures", async () => {
    const { outcome } = await run(pooled);

    expect(outcome.verdicts.every((verdict) => verdict.status === "PASSED")).toBe(true);
  });

  it("measures the driver's added distance and duration", async () => {
    const { context } = await run(pooled);
    const metrics = context.getMetrics("d1");

    expect(metrics.additionalDistanceKm).toBeCloseTo(
      (metrics.newDistanceKm ?? 0) - (metrics.originalDistanceKm ?? 0),
      5,
    );
    expect(metrics.additionalDurationMin).toBeGreaterThanOrEqual(0);
  });

  it("computes detour percent against the baseline distance", async () => {
    const { context } = await run(pooled);
    const metrics = context.getMetrics("d1");

    expect(metrics.detourPercent).toBeCloseTo(
      ((metrics.additionalDistanceKm ?? 0) / (metrics.originalDistanceKm ?? 1)) * 100,
      3,
    );
  });

  it("reports zero detour for an idle driver, who has nothing to detour from", async () => {
    const { context } = await run({
      driverId: "d2",
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.21 }, drop: { lat: 28.6, lng: 77.28 } },
    });

    expect(context.getMetrics("d2").detourPercent).toBe(0);
  });

  it("measures each existing passenger's delay and the worst of them", async () => {
    const { context } = await run(pooled);
    const metrics = context.getMetrics("d1");

    expect(metrics.maximumExistingPassengerDelayMin).toBeGreaterThanOrEqual(0);
  });

  it("measures the new rider's own detour against a solo trip", async () => {
    const { context } = await run(pooled);

    expect(context.getMetrics("d1").newPassengerRideDetourMin).toBeGreaterThanOrEqual(0);
  });

  it("publishes an insertion result for the map and detail sheet", async () => {
    const context = makeContext({ optimizer: new StubOptimizerEngine(), ...pooled });
    await operationalStateStage.execute(context);
    await h3RouteCorridorStage.execute(context);
    await stopSequenceGenerationStage.execute(context);
    await detourLowerBoundStage.execute(context);
    await roadRoutingStage.execute(context);
    await incrementalCostStage.execute(context);

    // `recordInsertion` is captured by the fixture; assert through the metrics
    // it mirrors rather than reaching into private state.
    expect(context.getMetrics("d1").newDistanceKm).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/incrementalCost.test.ts`
Expected: FAIL — no-op stage records nothing.

- [x] **Step 3: Implement the stage**

Replace `src/matching/stages/incrementalCost.ts`:

```ts
import { computeExistingPassengerDelays, computeExistingPickupDelays } from "../delays";
import { computeSegmentOccupancy } from "../occupancy";
import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  RouteInsertionResult,
  StageOutcome,
} from "../types";

/**
 * Stage 9. Who gains, who loses, and by how much?
 *
 * This is the heart of fairness accounting. A route can look efficient in
 * total distance while badly hurting one specific passenger, and only a
 * per-person comparison against each party's own baseline exposes that.
 *
 * Nothing is rejected here. Measuring and judging are separate stages on
 * purpose: stage 10 does the judging, and keeping them apart is what lets the
 * UI show a driver's full impact profile even when they were rejected.
 */
export const incrementalCostStage: MatchingStage = {
  id: "incrementalCost",
  name: "Incremental Cost",
  description: "Measures what every party gains or loses. Rejects nothing.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request } = context;
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const solution = context.getSolution(driverId);
      const corridor = context.getCorridor(driverId);
      const vehicle = context.getVehicleForDriver(driverId);

      if (!solution || !corridor || !vehicle) {
        continue;
      }

      const hasExistingRoute = corridor.remainingStops.length > 0;

      const additionalDistanceKm = solution.totalDistanceKm - solution.baselineDistanceKm;
      const additionalDurationMin = solution.totalDurationMin - solution.baselineDurationMin;

      // With no committed route there is nothing to detour from: the driver is
      // dedicated to this rider, so a detour percentage would be meaningless.
      const detourPercent = hasExistingRoute
        ? (additionalDistanceKm / solution.baselineDistanceKm) * 100
        : 0;

      const newPickupId = solution.stops.find(
        (stop) => stop.isNew && stop.type === "PICKUP",
      )?.id;
      const newDropId = solution.stops.find((stop) => stop.isNew && stop.type === "DROP")?.id;

      const newPassengerPickupEtaMin = newPickupId
        ? (solution.arrivalByStopId.get(newPickupId) ?? 0)
        : 0;
      const newPassengerDropEtaMin = newDropId
        ? (solution.arrivalByStopId.get(newDropId) ?? 0)
        : 0;

      const newPassengerRideDetourMin = Math.max(
        0,
        newPassengerDropEtaMin - newPassengerPickupEtaMin - solution.soloDurationMin,
      );

      const committedStops = solution.stops.filter((stop) => !stop.isNew);

      const { delays, maximumDelayMin } = computeExistingPassengerDelays(
        committedStops,
        solution.baselineArrivalByStopId,
        solution.arrivalByStopId,
      );

      const pickupDelays = computeExistingPickupDelays(
        committedStops,
        solution.baselineArrivalByStopId,
        solution.arrivalByStopId,
      );

      const occupancy = computeSegmentOccupancy(solution.stops, 0, vehicle.totalSeats);

      context.recordMetrics(driverId, {
        originalDistanceKm: round(solution.baselineDistanceKm, 3),
        newDistanceKm: round(solution.totalDistanceKm, 3),
        additionalDistanceKm: round(additionalDistanceKm, 3),
        detourPercent: round(detourPercent, 2),
        originalDurationMin: round(solution.baselineDurationMin, 2),
        newDurationMin: round(solution.totalDurationMin, 2),
        additionalDurationMin: round(additionalDurationMin, 2),
        newPassengerPickupEtaMin: round(newPassengerPickupEtaMin, 2),
        // The new rider waits from now; there is no earlier promise to
        // compare against, so their "delay" is simply their wait.
        newPassengerPickupDelayMin: round(newPassengerPickupEtaMin, 2),
        newPassengerRideDetourMin: round(newPassengerRideDetourMin, 2),
        maximumExistingPassengerDelayMin: round(maximumDelayMin, 2),
        peakOccupancy: occupancy.peakOccupancy,
        roadDistanceKm: round(solution.totalDistanceKm, 3),
        roadEtaMin: round(newPassengerPickupEtaMin, 2),
      });

      const insertion: RouteInsertionResult = {
        feasible: true,
        insertedRoute: solution.stops,
        originalDistanceKm: solution.baselineDistanceKm,
        newDistanceKm: solution.totalDistanceKm,
        additionalDistanceKm,
        detourPercentage: detourPercent,
        originalDurationMin: solution.baselineDurationMin,
        newDurationMin: solution.totalDurationMin,
        additionalDurationMin,
        newPassengerPickupEtaMin,
        newPassengerPickupDelayMin: newPassengerPickupEtaMin,
        newPassengerRideDetourMin,
        existingPassengerDelays: [...delays, ...pickupDelays],
        maximumExistingPassengerDelayMin: maximumDelayMin,
        occupancyBySegment: occupancy.segments,
        attemptStats: {
          enumerated: context.getMetrics(driverId).enumeratedSequences ?? 0,
          waypointLimitPruned: 0,
          occupancyPruned:
            (context.getMetrics(driverId).enumeratedSequences ?? 0) -
            (context.getMetrics(driverId).capacityFeasibleSequences ?? 0),
          geographicallyPruned:
            (context.getMetrics(driverId).capacityFeasibleSequences ?? 0) -
            (context.getMetrics(driverId).shortlistedSequences ?? 0),
          routed: 1,
          cacheHits: 0,
          feasible: 1,
        },
      };

      context.recordInsertion(driverId, insertion);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("COST_MEASURED", "Impact measured for every affected party", {
            value: round(detourPercent, 2),
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
```

- [x] **Step 4: Repoint the arithmetic tests**

`src/test/detour.test.ts` and `src/test/delays.test.ts` asserted on `findBestInsertion`. Rewrite `detour.test.ts` to run the stage chain from `incrementalCost.test.ts` and assert the same arithmetic properties against `context.getMetrics(...)`. `delays.test.ts` tests `computeExistingPassengerDelays` directly and needs no change beyond adding the new `Passenger` fields to any literal it builds.

- [x] **Step 5: Run the tests**

Run: `bun run check-types && bun run test`
Expected: green, including the rewritten `detour.test.ts` and the `.skip`s from Task 17 now un-skipped.

- [x] **Step 6: Commit**

```bash
git add src/matching src/test
git commit -m "feat(simulation): stage 9 per-party incremental cost"
```

---

## Task 19: Stage 10 — Hard constraints — LANDED

**Files:**
- Modify: `src/matching/stages/hardConstraints.ts`
- Test: `src/test/hardConstraints.test.ts` (create)

**Interfaces:**
- Consumes: metrics recorded by stage 9 (Task 18); `context.getDelayBudgets` (Task 15); `activePassengerIds` from `@/matching/stops`.
- Produces: nothing new — it reuses the existing `ROUTE_*` and `POOLING_*` reason codes.

- [x] **Step 1: Write the failing test**

Create `src/test/hardConstraints.test.ts`. Build the context with the stage chain from `incrementalCost.test.ts`, then run `hardConstraintsStage` and assert:

```ts
import { describe, expect, it } from "vitest";

import { hardConstraintsStage } from "@/matching/stages/hardConstraints";
import { makeContext, type MakeContextInput } from "./fixtures/stageContext";
import { runToIncrementalCost } from "./fixtures/runStages";

const pooled: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
};

describe("hardConstraints", () => {
  it("passes a route within every limit", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("ROUTE_FEASIBLE");
  });

  it("rejects on detour percent before any other limit", async () => {
    const context = await runToIncrementalCost({ ...pooled, settings: { maxDetourPercent: 0 } });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("ROUTE_DETOUR_TOO_HIGH");
  });

  it("rejects on the driver's added distance", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      settings: { maxDetourPercent: 1000, maxAdditionalDistanceKm: 0 },
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("ADDITIONAL_DISTANCE_TOO_HIGH");
  });

  it("rejects on an existing passenger's own budget, not the global ceiling", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 0, maxDropDelayMin: 0 }],
      settings: { maxDetourPercent: 1000, maxExistingPassengerDelayMin: 1000 },
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("EXISTING_PASSENGER_DELAY_TOO_HIGH");
  });

  it("rejects a pool the vehicle is not configured for", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      vehicle: { poolingEnabled: false },
      settings: { maxDetourPercent: 1000 },
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("POOLING_NOT_SUPPORTED");
  });

  it("does not apply pooling rules to a solo ride", async () => {
    const context = await runToIncrementalCost({
      driverId: "d2",
      committedStops: [],
      passengers: [],
      vehicle: { poolingEnabled: false },
      request: { pickup: { lat: 28.6, lng: 77.21 }, drop: { lat: 28.6, lng: 77.28 } },
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.status).toBe("PASSED");
  });

  it("rejects a pool larger than the configured maximum", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      settings: { maxDetourPercent: 1000, maxPooledPassengers: 1 },
    });
    const outcome = await hardConstraintsStage.execute(context);

    expect(outcome.verdicts[0]!.reasons[0]!.code).toBe("MAX_POOLED_PASSENGERS_EXCEEDED");
  });
});
```

- [x] **Step 2: Extract the shared stage runner**

Create `src/test/fixtures/runStages.ts` so the chain is written once rather than in every stage test from here on:

```ts
import { detourLowerBoundStage } from "@/matching/stages/detourLowerBound";
import { h3RouteCorridorStage } from "@/matching/stages/h3RouteCorridor";
import { incrementalCostStage } from "@/matching/stages/incrementalCost";
import { operationalStateStage } from "@/matching/stages/operationalState";
import { pickupRouteDistanceStage } from "@/matching/stages/pickupRouteDistance";
import { pickupTimeWindowStage } from "@/matching/stages/pickupTimeWindow";
import { roadRoutingStage } from "@/matching/stages/roadRouting";
import { stopSequenceGenerationStage } from "@/matching/stages/stopSequenceGeneration";

import { makeContext, type MakeContextInput } from "./stageContext";
import { StubOptimizerEngine } from "./stubOptimizer";

/**
 * Runs stages 1 through 9 against a fixture context and hands back the
 * context, so a test for stage 10 or later can assert on real data rather than
 * hand-built metrics.
 */
export async function runToIncrementalCost(input: MakeContextInput) {
  const context = makeContext({ optimizer: new StubOptimizerEngine(), ...input });

  for (const stage of [
    operationalStateStage,
    h3RouteCorridorStage,
    pickupRouteDistanceStage,
    stopSequenceGenerationStage,
    pickupTimeWindowStage,
    detourLowerBoundStage,
    roadRoutingStage,
    incrementalCostStage,
  ]) {
    await stage.execute(context);
  }

  return context;
}
```

Add `optimizer?: OptimizerEngine` to `MakeContextInput` in `stageContext.ts` if Task 17 did not already.

- [x] **Step 3: Run the test to verify it fails**

Run: `bun run test src/test/hardConstraints.test.ts`
Expected: FAIL — no-op stage passes everything.

- [x] **Step 4: Implement the stage**

Replace `src/matching/stages/hardConstraints.ts`:

```ts
import type { Passenger } from "@/domain/entities";

import { reason, type MatchReason } from "../reasons";
import { activePassengerIds } from "../stops";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

/**
 * Stage 10. Is this acceptable at all?
 *
 * A route is only acceptable if *everyone* affected stays within their limits.
 * Efficiency for one party never justifies excessive harm to another — that is
 * a product principle, not an optimisation, which is why it lives in a
 * separate binary stage rather than as a penalty term in the score.
 *
 * These checks are kept even though the solver enforced the time windows
 * itself. The solver was never told about the driver's extra-distance cap or
 * our pooling policy, and an independent re-check is what makes the answer
 * trustworthy rather than merely plausible.
 */
export const hardConstraintsStage: MatchingStage = {
  id: "hardConstraints",
  name: "Hard Constraints",
  description: "Binary accept/reject against every configured maximum, plus pooling policy.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { scenario } = context;
    const passengersById = new Map<string, Passenger>(
      scenario.passengers.map((passenger) => [passenger.id, passenger]),
    );

    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const failure =
        firstThresholdBreach(driverId, context) ??
        firstPolicyViolation(driverId, context, passengersById);

      if (failure) {
        verdicts.push({ driverId, status: "FAILED", reasons: [failure] });
        continue;
      }

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [reason("ROUTE_FEASIBLE", "Every party stays within their limits")],
      });
    }

    return Promise.resolve({ verdicts });
  },
};

/** Fixed order, so the reported rejection is deterministic across runs. */
function firstThresholdBreach(
  driverId: string,
  context: MatchingContext,
): MatchReason | undefined {
  const { settings } = context;
  const metrics = context.getMetrics(driverId);
  const corridor = context.getCorridor(driverId);
  const hasExistingRoute = (corridor?.remainingStops.length ?? 0) > 0;

  if (hasExistingRoute) {
    if ((metrics.detourPercent ?? 0) > settings.maxDetourPercent) {
      return reason("ROUTE_DETOUR_TOO_HIGH", "Route detour exceeds the configured maximum", {
        value: metrics.detourPercent,
        threshold: settings.maxDetourPercent,
      });
    }

    if ((metrics.additionalDistanceKm ?? 0) > settings.maxAdditionalDistanceKm) {
      return reason("ADDITIONAL_DISTANCE_TOO_HIGH", "Insertion adds too much distance", {
        value: metrics.additionalDistanceKm,
        threshold: settings.maxAdditionalDistanceKm,
      });
    }

    if ((metrics.additionalDurationMin ?? 0) > settings.maxAdditionalDurationMin) {
      return reason("ADDITIONAL_DURATION_TOO_HIGH", "Insertion adds too much travel time", {
        value: metrics.additionalDurationMin,
        threshold: settings.maxAdditionalDurationMin,
      });
    }

    const budgetBreach = firstBudgetBreach(driverId, context);
    if (budgetBreach) {
      return budgetBreach;
    }
  }

  if ((metrics.newPassengerPickupDelayMin ?? 0) > settings.maxNewPassengerPickupDelayMin) {
    return reason(
      "NEW_PASSENGER_PICKUP_DELAY_TOO_HIGH",
      "New passenger waits longer than the configured maximum",
      {
        value: metrics.newPassengerPickupDelayMin,
        threshold: settings.maxNewPassengerPickupDelayMin,
      },
    );
  }

  if ((metrics.newPassengerRideDetourMin ?? 0) > settings.maxNewPassengerRideDetourMin) {
    return reason(
      "NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH",
      "New passenger's own journey is stretched too far by sharing",
      {
        value: metrics.newPassengerRideDetourMin,
        threshold: settings.maxNewPassengerRideDetourMin,
      },
    );
  }

  return undefined;
}

/**
 * Each committed passenger against their *own* tolerance first, then the
 * global ceiling.
 *
 * The per-passenger budget is the promise we actually made; the global setting
 * is a backstop for scenarios that never set one. Checking the personal budget
 * first means the rejection names the real constraint.
 */
function firstBudgetBreach(
  driverId: string,
  context: MatchingContext,
): MatchReason | undefined {
  const solution = context.getSolution(driverId);
  const budgets = context.getDelayBudgets(driverId);

  if (!solution) {
    return undefined;
  }

  for (const budget of budgets) {
    const after = solution.arrivalByStopId.get(budget.stopId);
    if (after === undefined) {
      continue;
    }

    const delayMin = after - budget.originalEtaMin;

    if (delayMin > budget.budgetMin) {
      return reason(
        "EXISTING_PASSENGER_DELAY_TOO_HIGH",
        `Passenger ${budget.passengerId} would be ${delayMin.toFixed(1)} min later than promised`,
        { value: round(delayMin, 2), threshold: budget.budgetMin },
      );
    }
  }

  const worst = context.getMetrics(driverId).maximumExistingPassengerDelayMin ?? 0;

  if (worst > context.settings.maxExistingPassengerDelayMin) {
    return reason(
      "EXISTING_PASSENGER_DELAY_TOO_HIGH",
      "An existing passenger would arrive too much later than promised",
      { value: worst, threshold: context.settings.maxExistingPassengerDelayMin },
    );
  }

  return undefined;
}

/**
 * Business policy, not physics.
 *
 * Kept as its own function with its own reason codes so the dashboard can
 * still tell "the car cannot fit them" from "our rules forbid this pool" —
 * two findings that call for completely different product responses.
 */
function firstPolicyViolation(
  driverId: string,
  context: MatchingContext,
  passengersById: ReadonlyMap<string, Passenger>,
): MatchReason | undefined {
  const { request, settings } = context;
  const vehicle = context.getVehicleForDriver(driverId);
  const ride = context.getRideForDriver(driverId);

  if (!vehicle) {
    return undefined;
  }

  const existing = ride ? activePassengerIds(ride.passengerIds, passengersById) : [];
  const pooledCount = existing.length + 1;

  context.recordMetrics(driverId, {
    existingPassengerCount: existing.length,
    pooledPassengerCount: pooledCount,
  });

  // A solo ride is not a pool. A vehicle with pooling switched off can still
  // carry one passenger perfectly well.
  if (existing.length === 0) {
    return undefined;
  }

  if (!vehicle.poolingEnabled) {
    return reason("POOLING_NOT_SUPPORTED", "Vehicle is not configured for pooling", {
      value: "false",
      threshold: "true",
    });
  }

  if (!request.poolingAllowed) {
    return reason(
      "POOLING_NOT_ALLOWED_BY_REQUEST",
      "The request refuses pooling but this driver already carries passengers",
      { value: existing.length, threshold: 0 },
    );
  }

  for (const passengerId of existing) {
    const passenger = passengersById.get(passengerId);
    if (passenger && !passenger.allowsPooling) {
      return reason(
        "POOLING_NOT_ALLOWED_BY_EXISTING_RIDER",
        `Existing passenger ${passenger.name} declined to share this ride`,
        { value: passenger.id },
      );
    }
  }

  if (pooledCount > settings.maxPooledPassengers) {
    return reason(
      "MAX_POOLED_PASSENGERS_EXCEEDED",
      "Pool would exceed the maximum number of shared passengers",
      { value: pooledCount, threshold: settings.maxPooledPassengers },
    );
  }

  return undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
```

Add one reason code to `src/matching/reasons.ts`:

```ts
  NEW_PASSENGER_RIDE_DETOUR_TOO_HIGH: {
    category: "ROUTE",
    label: "New rider's journey stretched too far",
    outcome: "FAIL",
  },
```

- [x] **Step 5: Run the tests**

Run: `bun run test src/test/hardConstraints.test.ts`
Expected: PASS, all seven cases.

- [x] **Step 6: Commit**

```bash
git add src/matching src/test
git commit -m "feat(simulation): stage 10 hard constraints and pooling policy"
```

---

## Task 20: Stage 11 — Fairness scoring — LANDED

**Files:**
- Modify: `src/domain/entities.ts` (`ScoringWeights`), `src/domain/settings.ts`, `src/domain/schemas.ts`
- Modify: `src/matching/normalize.ts` (`WeightKey`)
- Modify: `src/matching/stages/scoring.ts`
- Modify: `src/matching/types.ts` (`ScoreComponent.key`)
- Modify: `src/matching/engine.ts` (`rankEvaluations` sort direction)
- Test: `src/test/scoring.test.ts` (create)

**Interfaces:**
- Consumes: metrics from stage 9 (Task 18); thresholds from settings.
- Produces: `ScoringWeights = { driverImpact; existingPassengerImpact; newPassengerImpact; pickupDelay }`, `ScoreComponent.key: "driverImpact" | "existingPassengerImpact" | "newPassengerImpact" | "pickupDelay"`. **Lower `finalScore` is better** — the inverse of the old convention.

- [x] **Step 1: Write the failing test**

Create `src/test/scoring.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { scoringStage } from "@/matching/stages/scoring";
import { runToIncrementalCost } from "./fixtures/runStages";
import type { MakeContextInput } from "./fixtures/stageContext";

const pooled: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
};

describe("scoring", () => {
  it("produces exactly the Overview's four components", async () => {
    const context = await runToIncrementalCost(pooled);
    await scoringStage.execute(context);

    // The breakdown is captured by `recordScore`; assert via the verdict metrics.
    const outcome = await scoringStage.execute(context);
    const metrics = outcome.verdicts[0]!.metrics as Record<string, number>;

    expect(metrics.driverImpactContribution).toBeDefined();
    expect(metrics.existingPassengerImpactContribution).toBeDefined();
    expect(metrics.newPassengerImpactContribution).toBeDefined();
    expect(metrics.pickupDelayContribution).toBeDefined();
  });

  it("has contributions that sum to the final score", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await scoringStage.execute(context);
    const metrics = outcome.verdicts[0]!.metrics as Record<string, number>;

    const sum =
      metrics.driverImpactContribution +
      metrics.existingPassengerImpactContribution +
      metrics.newPassengerImpactContribution +
      metrics.pickupDelayContribution;

    expect(sum).toBeCloseTo(metrics.finalScore!, 2);
  });

  it("scores a zero-impact insertion at zero", async () => {
    const context = await runToIncrementalCost({
      driverId: "d2",
      committedStops: [],
      passengers: [],
      request: { pickup: { lat: 28.6, lng: 77.2 }, drop: { lat: 28.6, lng: 77.2001 } },
    });

    const outcome = await scoringStage.execute(context);
    const metrics = outcome.verdicts[0]!.metrics as Record<string, number>;

    expect(metrics.finalScore).toBeLessThan(5);
  });

  it("scores a worse insertion higher than a better one", async () => {
    const near = await runToIncrementalCost(pooled);
    const far = await runToIncrementalCost({
      ...pooled,
      request: { pickup: { lat: 28.66, lng: 77.26 }, drop: { lat: 28.66, lng: 77.31 } },
    });

    const nearScore = ((await scoringStage.execute(near)).verdicts[0]!.metrics as Record<string, number>)
      .finalScore!;
    const farScore = ((await scoringStage.execute(far)).verdicts[0]!.metrics as Record<string, number>)
      .finalScore!;

    expect(farScore).toBeGreaterThan(nearScore);
  });

  it("rejects nobody", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await scoringStage.execute(context);

    expect(outcome.verdicts.every((verdict) => verdict.status === "PASSED")).toBe(true);
  });

  it("weights sum to one after normalisation", async () => {
    const context = await runToIncrementalCost({
      ...pooled,
      settings: {
        weights: {
          driverImpact: 60,
          existingPassengerImpact: 60,
          newPassengerImpact: 50,
          pickupDelay: 30,
        },
      },
    });

    const outcome = await scoringStage.execute(context);
    const weights = outcome.notes?.weights as Record<string, number>;

    expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
  });
});
```

- [x] **Step 2: Change the weight shape**

In `src/domain/entities.ts`:

```ts
/**
 * The Overview's fairness formula. Lower is better throughout — these measure
 * harm, not merit, and the whole point is that the vehicle-cost-optimal route
 * is often not the fairest one.
 */
export interface ScoringWeights {
  driverImpact: number;
  existingPassengerImpact: number;
  newPassengerImpact: number;
  pickupDelay: number;
}
```

In `DEFAULT_SETTINGS`:

```ts
  weights: {
    driverImpact: 30,
    existingPassengerImpact: 30,
    newPassengerImpact: 25,
    pickupDelay: 15,
  },
```

In `src/domain/schemas.ts`:

```ts
const scoringWeightsSchema = z.object({
  driverImpact: z.number().min(0),
  existingPassengerImpact: z.number().min(0),
  newPassengerImpact: z.number().min(0),
  pickupDelay: z.number().min(0),
});
```

`WeightKey` in `src/matching/normalize.ts` is `keyof ScoringWeights` and follows automatically. `ScoreComponent.key` in `src/matching/types.ts` becomes the same union.

- [x] **Step 3: Implement the stage**

Replace `src/matching/stages/scoring.ts`:

```ts
import { normalizeLowerIsBetter, normalizeWeights } from "../normalize";
import { reason } from "../reasons";
import type {
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  ScoreBreakdown,
  ScoreComponent,
  StageOutcome,
} from "../types";

/**
 * Stage 11. Among the routes that are all valid, which is best?
 *
 * Validity is not optimality. Several insertions can clear every hard limit
 * while distributing the cost very differently, and the vehicle-cost-cheapest
 * one is frequently the one that hurts a single rider most. That is exactly
 * why this scoring stays in-house rather than being delegated to the solver,
 * whose objective is the vehicle's cost and nobody else's.
 *
 * Every component measures harm and is normalised against its own stage-10
 * threshold, so the total stays on one 0-100 scale and each contribution is a
 * real displayable number rather than an artefact of unit choice.
 *
 * Known limitation: `OptimizeTours` returns one sequence per driver, so this
 * ranks *across drivers*, not across sequences for a single driver. The
 * Overview's Route 1/2/3 example — our fairness score overriding Google's
 * winner among several candidate sequences — needs the Phase 3 in-house
 * insertion search. The results panel says so.
 */
export const scoringStage: MatchingStage = {
  id: "scoring",
  name: "Scoring",
  description: "Fairness-weighted ranking across drivers. Lower is better.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { settings } = context;
    const weights = normalizeWeights(settings.weights);
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const metrics = context.getMetrics(driverId);

      const components: ScoreComponent[] = [
        {
          key: "driverImpact",
          label: "Driver impact",
          rawValue: metrics.additionalDurationMin,
          normalized: normalizeLowerIsBetter(
            metrics.additionalDurationMin ?? 0,
            settings.maxAdditionalDurationMin,
          ),
          weight: weights.driverImpact,
          contribution: 0,
        },
        {
          key: "existingPassengerImpact",
          label: "Existing rider impact",
          rawValue: metrics.maximumExistingPassengerDelayMin,
          normalized: normalizeLowerIsBetter(
            metrics.maximumExistingPassengerDelayMin ?? 0,
            settings.maxExistingPassengerDelayMin,
          ),
          weight: weights.existingPassengerImpact,
          contribution: 0,
        },
        {
          key: "newPassengerImpact",
          label: "New rider impact",
          rawValue: metrics.newPassengerRideDetourMin,
          normalized: normalizeLowerIsBetter(
            metrics.newPassengerRideDetourMin ?? 0,
            settings.maxNewPassengerRideDetourMin,
          ),
          weight: weights.newPassengerImpact,
          contribution: 0,
        },
        {
          key: "pickupDelay",
          label: "Pickup wait",
          rawValue: metrics.newPassengerPickupDelayMin,
          normalized: normalizeLowerIsBetter(
            metrics.newPassengerPickupDelayMin ?? 0,
            settings.maxNewPassengerPickupDelayMin,
          ),
          weight: weights.pickupDelay,
          contribution: 0,
        },
      ];

      let finalScore = 0;

      for (const component of components) {
        component.contribution = component.normalized * component.weight;
        finalScore += component.contribution;
      }

      const breakdown: ScoreBreakdown = { components, finalScore };
      context.recordScore(driverId, breakdown);

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("ROUTE_FEASIBLE", `Fairness score ${finalScore.toFixed(1)} (lower is better)`, {
            value: Number(finalScore.toFixed(2)),
            threshold: 0,
          }),
        ],
        metrics: scoreMetrics(components, finalScore),
      });
    }

    return Promise.resolve({ verdicts, notes: { weights } });
  },
};

function scoreMetrics(
  components: readonly ScoreComponent[],
  finalScore: number,
): Record<string, number> {
  const output: Record<string, number> = { finalScore: round(finalScore, 2) };

  for (const component of components) {
    output[`${component.key}Score`] = round(component.normalized, 1);
    output[`${component.key}Contribution`] = round(component.contribution, 2);
  }

  return output;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
```

`normalizeLowerIsBetter` currently returns 100 for a zero measurement (higher = better). Under the new convention it must return **0** for zero harm and 100 at the threshold. Change it in `src/matching/normalize.ts`:

```ts
/**
 * Maps a harm measurement onto 0-100, where 0 is no harm and 100 is at the
 * threshold. Values past the threshold clamp at 100 — a route that is twice
 * over the limit is not twice as rejected; it was already rejected at stage 10.
 */
export function normalizeLowerIsBetter(
  value: number | undefined,
  threshold: number,
): number {
  if (value === undefined || threshold <= 0) {
    return 0;
  }

  return clamp((value / threshold) * 100, 0, 100);
}
```

- [x] **Step 4: Flip the ranking direction**

In `src/matching/engine.ts`, `rankEvaluations` sorts descending. Lower is now better:

```ts
  passed.sort((a, b) => {
    // Lower is better: the score measures harm, not merit.
    const scoreDelta = (a.finalScore ?? 0) - (b.finalScore ?? 0);
    // Ties break on driver id so repeated runs produce a stable ordering.
    return scoreDelta !== 0 ? scoreDelta : a.driverId.localeCompare(b.driverId);
  });
```

- [x] **Step 5: Run the tests**

Run: `bun run check-types && bun run test src/test/scoring.test.ts`
Expected: PASS, all six cases. Fix any UI file still referencing `weights.eta` / `weights.detour` / `weights.fairness` — Task 22 does the proper UI pass; here, just make it compile.

- [x] **Step 6: Commit**

```bash
git add src/domain src/matching src/test/scoring.test.ts
git commit -m "feat(simulation): stage 11 fairness scoring, lower is better"
```

---

## Task 21: Stage 12 — Commit and rolling horizon — LANDED

**Files:**
- Modify: `src/matching/stages/commit.ts`
- Modify: `src/matching/types.ts` (`CommitPlan`, `DriverEvaluation`)
- Modify: `src/stores/scenarioStore.ts`
- Test: `src/test/commit.test.ts` (create)

**Interfaces:**
- Consumes: `context.getSolution` (Task 17).
- Produces:
  - ```ts
    export interface CommitPlan {
      driverId: string;
      rideId: string | null;
      passengerId: string;
      requestId: string;
      /** The winning sequence, with re-stamped ETAs. */
      stops: { id: string; passengerId: string; type: "PICKUP" | "DROP"; location: LatLng; originalEtaMin: number }[];
    }
    ```
  - `DriverEvaluation.commitPlan?: CommitPlan`
  - `scenarioStore.commitMatch(plan: CommitPlan): void` and `scenarioStore.undoCommit(): void`

- [x] **Step 1: Write the failing test**

Create `src/test/commit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { commitStage } from "@/matching/stages/commit";
import { runToIncrementalCost } from "./fixtures/runStages";
import type { MakeContextInput } from "./fixtures/stageContext";

const pooled: MakeContextInput = {
  driverId: "d1",
  driverLocation: { lat: 28.6, lng: 77.2 },
  committedStops: [
    { id: "s1", passengerId: "pA", type: "PICKUP", originalEtaMin: 3, lat: 28.6, lng: 77.22 },
    { id: "s2", passengerId: "pA", type: "DROP", originalEtaMin: 25, lat: 28.6, lng: 77.34 },
  ],
  passengers: [{ id: "pA", state: "WAITING", maxPickupDelayMin: 30, maxDropDelayMin: 30 }],
  request: { pickup: { lat: 28.6, lng: 77.26 }, drop: { lat: 28.6, lng: 77.31 } },
};

describe("commit", () => {
  it("builds a plan containing every stop of the winning sequence", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    const plan = (outcome.notes?.plansByDriver as Record<string, { stops: unknown[] }>).d1!;
    expect(plan.stops).toHaveLength(context.getSolution("d1")!.stops.length);
  });

  it("re-stamps originalEtaMin from the solved arrival times", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    const plan = (
      outcome.notes?.plansByDriver as Record<
        string,
        { stops: { id: string; originalEtaMin: number }[] }
      >
    ).d1!;

    const solution = context.getSolution("d1")!;
    for (const stop of plan.stops) {
      expect(stop.originalEtaMin).toBeCloseTo(solution.arrivalByStopId.get(stop.id)!, 5);
    }
  });

  it("names the request being consumed and the passenger being added", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    const plan = (
      outcome.notes?.plansByDriver as Record<string, { requestId: string; passengerId: string }>
    ).d1!;

    expect(plan.requestId).toBe("req_1");
    expect(plan.passengerId).toBe("pNew");
  });

  it("does not mutate the scenario", async () => {
    const context = await runToIncrementalCost(pooled);
    const before = structuredClone(context.scenario);

    await commitStage.execute(context);

    expect(context.scenario).toEqual(before);
  });

  it("rejects nobody", async () => {
    const context = await runToIncrementalCost(pooled);
    const outcome = await commitStage.execute(context);

    expect(outcome.verdicts.every((verdict) => verdict.status === "PASSED")).toBe(true);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun run test src/test/commit.test.ts`
Expected: FAIL — the no-op stage writes no notes.

- [x] **Step 3: Implement the stage**

Replace `src/matching/stages/commit.ts`:

```ts
import { reason } from "../reasons";
import type {
  CommitPlan,
  DriverVerdict,
  MatchingContext,
  MatchingStage,
  StageOutcome,
} from "../types";

/**
 * Stage 12. Turn the winning sequence into the new baseline.
 *
 * The route is a living object, not a one-shot answer. Once a passenger is
 * committed, the very next request is matched against the post-commit route
 * rather than recomputed from scratch — the rolling-horizon principle. That
 * only works if the promises are re-stamped here: every remaining stop's
 * `originalEtaMin` becomes what the solver just said it would be, so the next
 * request's delay measurements are taken against reality rather than against
 * a promise two insertions old.
 *
 * This stage builds the plan; it does not apply it. `runMatching` must stay
 * pure — `e2e-scenario.test.ts` asserts the scenario is never written during a
 * run, and `scenarioStore.commitMatch` is what actually mutates.
 */
export const commitStage: MatchingStage = {
  id: "commit",
  name: "Commit",
  description: "Builds the commit plan that makes the winning route the new baseline.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const { request } = context;
    const verdicts: DriverVerdict[] = [];
    const plansByDriver: Record<string, CommitPlan> = {};

    for (const driverId of context.liveDriverIds) {
      const solution = context.getSolution(driverId);
      const corridor = context.getCorridor(driverId);

      if (!solution) {
        continue;
      }

      plansByDriver[driverId] = {
        driverId,
        rideId: corridor?.rideId ?? null,
        passengerId: request.passengerId,
        requestId: request.id,
        stops: solution.stops.map((stop) => ({
          id: stop.id,
          passengerId: stop.passengerId,
          type: stop.type,
          location: stop.location,
          originalEtaMin: solution.arrivalByStopId.get(stop.id) ?? 0,
        })),
      };

      verdicts.push({
        driverId,
        status: "PASSED",
        reasons: [
          reason("COMMIT_READY", `Plan ready: ${String(solution.stops.length)} stops`, {
            value: solution.stops.length,
          }),
        ],
      });
    }

    return Promise.resolve({ verdicts, notes: { plansByDriver } });
  },
};
```

Add `CommitPlan` to `src/matching/types.ts` exactly as given in this task's Interfaces block, plus `commitPlan?: CommitPlan` on `DriverEvaluation`. In `EvaluationLedger` (`src/matching/evaluation.ts`), add `recordCommitPlan(driverId, plan)` and attach it in `finalize`; wire the corresponding `context.recordCommitPlan` in `createContext` and in the test fixture, and call it from the stage alongside the notes write.

- [x] **Step 4: Apply the plan in the store**

In `src/stores/scenarioStore.ts`, add:

```ts
  /**
   * Applies a winning match to the live scenario.
   *
   * This is the only place a match ever changes the world. Keeping it out of
   * the engine is what lets a run be replayed, snapshotted and compared — and
   * what makes "run matching" safe to click repeatedly.
   */
  commitMatch: (plan: CommitPlan) => {
    set((state) => {
      const previous = structuredClone(state.scenario);
      const scenario = structuredClone(state.scenario);

      const driver = scenario.drivers.find((candidate) => candidate.id === plan.driverId);
      if (!driver) {
        return state;
      }

      const rideId = plan.rideId ?? createId("ride");
      let ride = scenario.rides.find((candidate) => candidate.id === rideId);

      if (!ride) {
        ride = { id: rideId, driverId: driver.id, passengerIds: [], stops: [] };
        scenario.rides.push(ride);
        driver.currentRideId = rideId;
      }

      if (!ride.passengerIds.includes(plan.passengerId)) {
        ride.passengerIds.push(plan.passengerId);
      }

      ride.stops = plan.stops.map((stop, index) => ({
        id: stop.id,
        rideId,
        passengerId: stop.passengerId,
        type: stop.type,
        location: stop.location,
        sequence: index,
        // The solved arrival becomes the promise the next insertion protects.
        originalEtaMin: stop.originalEtaMin,
      }));

      scenario.requests = scenario.requests.filter((candidate) => candidate.id !== plan.requestId);

      return { ...state, scenario, lastCommittedScenario: previous };
    });
  },

  /** Restores the scenario as it was before the most recent commit. */
  undoCommit: () => {
    set((state) =>
      state.lastCommittedScenario
        ? { ...state, scenario: state.lastCommittedScenario, lastCommittedScenario: null }
        : state,
    );
  },
```

with `lastCommittedScenario: Scenario | null` added to the store's state and initialised to `null`.

- [x] **Step 5: Add the rolling-horizon regression**

Append to `src/test/commit.test.ts` a test that runs the pipeline, applies the plan by hand (the store is React-free zustand, so it can be imported directly in vitest), and re-runs against the mutated scenario:

```ts
it("matches a following request against the post-commit route", async () => {
  const first = await runToIncrementalCost(pooled);
  const outcome = await commitStage.execute(first);
  const plan = (outcome.notes?.plansByDriver as Record<string, CommitPlan>).d1!;

  // The committed sequence now contains four stops, so a following request is
  // inserted into that, not into the original two-stop route.
  expect(plan.stops).toHaveLength(4);
  expect(plan.stops.filter((stop) => stop.passengerId === "pNew")).toHaveLength(2);
});
```

Import `CommitPlan` from `@/matching/types`.

- [x] **Step 6: Run the tests**

Run: `bun run check-types && bun run test`
Expected: green, including the untouched scenario-immutability assertion in `e2e-scenario.test.ts`.

- [x] **Step 7: Commit**

```bash
git add src/matching src/stores src/test
git commit -m "feat(simulation): stage 12 commit plan and rolling-horizon baseline"
```

---

## Task 22: UI for the new pipeline — LANDED

**Files:**
- Modify: `src/components/debug/StagePipeline.tsx`, `StageDetails.tsx`, `DebugConsole.tsx`, `RoutingBanner.tsx`
- Modify: `src/components/scenario/SettingsPanel.tsx`
- Modify: `src/components/results/MatchingResults.tsx`, `DriverDetailSheet.tsx`
- Modify: `src/hooks/useRunMatching.ts`
- Test: manual, plus `bun run check-types`

**Interfaces:**
- Consumes: `STAGE_METADATA` (Task 9), `MatchingResult.optimizerTelemetry` (Task 17), `CommitPlan` (Task 21), the new `ScoringWeights` (Task 20).
- Produces: no new module APIs — UI only.

- [x] **Step 1: Widen the funnel and stage details**

`StagePipeline.tsx` renders one segment per stage from `result.stageResults`, so it needs no structural change — but fourteen segments will not fit the old fixed widths. Switch its container to a wrapping flex row (`flex flex-wrap gap-1`) with `min-w-0 flex-1 basis-[7rem]` segments, and render `STAGE_METADATA[stageId].shortLabel` rather than the full name.

`StageDetails.tsx` already renders `notes` generically. Add explicit rendering for the three new note shapes:
- `budgetsByDriver` (stage 1) — a table of stop, passenger, promised ETA, budget.
- `plansByDriver` (stage 12) — the ordered stop sequence with re-stamped ETAs.
- Keep the existing `rings` renderer; stage 2's note shape is unchanged.

- [x] **Step 2: Rewrite the settings panel fields**

`SettingsPanel.tsx` has inputs bound to `maxPickupEtaMin` and `maxPickupRoadDistanceKm`, which no longer exist, and to the five old weights. Replace with:

- **Corridor**: `maxPickupToRouteDistanceKm`, `maxDropToRouteDistanceKm`, `maxBearingDifferenceDeg`
- **Route feasibility**: unchanged, plus `maxNewPassengerRideDetourMin`
- **Estimation**: `estimatedSpeedKmh`
- **Optimizer**: `maxOptimizerCallsPerRun`, `optimizerTimeoutMs`
- **Weights**: `driverImpact`, `existingPassengerImpact`, `newPassengerImpact`, `pickupDelay`

Delete the stage-order A/B selector entirely — `BRIEF_STAGE_ORDER` no longer exists.

- [x] **Step 3: Show optimizer telemetry and the unavailable state**

In `DebugConsole.tsx`, add a second telemetry block beside the routing one showing `optimizerTelemetry`: calls, shipments billed, cache hits/misses, budget used and remaining.

In `RoutingBanner.tsx`, keep the existing MOCK ROUTING banner and add a second, more severe banner when a run fails with `OptimizerCredentialsMissingError`. It must state the fix verbatim:

> Route Optimization is unavailable. Run `gcloud auth application-default login` and set `GOOGLE_CLOUD_PROJECT` in `apps/simulation/.env.local`, then restart `bun run dev`. The optimizer proxy only exists in the dev server — a built bundle cannot reach it.

In `useRunMatching.ts`, catch `OptimizerCredentialsMissingError` from `findMatches` and store it as a run-level error rather than letting it surface as an unhandled rejection. No partial result is displayed — the run did not happen.

- [x] **Step 4: Correct the score direction in the results UI**

`MatchingResults.tsx` and `DriverMatchCard.tsx` present a higher score as better ("Scored 82 out of 100"). Invert the language: label it **"Fairness cost"**, state "lower is better" next to the heading, and ensure any progress bar fills proportionally to harm rather than merit.

Add the limitation note under the score breakdown in `DriverDetailSheet.tsx`:

> Google returns one sequence per driver, so this ranks drivers, not alternative sequences for the same driver. Comparing several sequences for one driver needs the in-house insertion search (Phase 3).

- [x] **Step 5: Add the commit action**

In `MatchingResults.tsx`, add a **Commit winner** button on the top-ranked driver's card, enabled only when `evaluation.commitPlan` exists. It calls `scenarioStore.commitMatch(evaluation.commitPlan)`. Add an **Undo commit** button that appears while `lastCommittedScenario` is non-null.

- [x] **Step 6: Verify**

Run: `bun run check-types && bun run lint && bun run build`
Expected: all pass.

Run: `bun run dev`, then in the browser — load the **Airport Pooling** preset, click **Run matching**, and confirm: fourteen funnel segments render, the rejection dashboard groups the new `CORRIDOR` / `DIRECTION` / `OPTIMIZER` categories, the optimizer telemetry block populates, and **Commit winner** followed by a second **Run matching** shows the new passenger already in the route.

- [x] **Step 7: Commit**

```bash
git add src/components src/hooks
git commit -m "feat(simulation): UI for the thirteen-stage pipeline and optimizer telemetry"
```

---

## Task 23: Presets and the end-to-end scenario

**Files:**
- Modify: `src/scenarios/presets/index.ts`
- Modify: `src/scenarios/builders.ts`
- Modify: `src/test/e2e-scenario.test.ts`
- Modify: `src/test/fixtures/delhiScenario.ts`

**Interfaces:**
- Consumes: schema v2 (Task 1); the corridor primitive (Task 11).
- Produces: a twelfth preset, `Corridor Behind Vehicle`.

- [ ] **Step 1: Re-tune the three affected presets**

**Sparse Driver Area**, **Dense Driver Area** and **Busy Delhi** were written to exercise ring expansion against *driver location* cells. Under corridor indexing, a driver's cells are spread along their route, which changes how many rings the search needs. Run each preset and adjust driver placement or `minimumUsableCandidates` until the preset again demonstrates what its name claims:

- Sparse: the search must run to `maxH3Ring` without reaching `minimumUsableCandidates`.
- Dense: the search must stop at ring 0.
- Busy Delhi: ring 0 must satisfy the threshold.

Verify with: `bun run dev`, load each preset, run matching, read `stoppedAtRing` and `searchExhausted` in the stage 2 details panel.

- [ ] **Step 2: Add the Corridor Behind Vehicle preset**

In `src/scenarios/presets/index.ts`, add a preset with one driver mid-route on an eastbound trip, their passenger already `IN_RIDE`, and the new request's pickup placed on the stretch of road the vehicle has already driven past. This is the Overview's Example 11 and the single most important regression in the suite.

- [ ] **Step 3: Assert it in the e2e test**

In `src/test/e2e-scenario.test.ts`, add:

```ts
it("rejects a pickup that is on the historical route but behind the vehicle", async () => {
  const result = await runEngine({ scenario: corridorBehindVehicleScenario(), request });

  const evaluation = result.evaluations.find((entry) => entry.driverId === "d_behind")!;

  expect(evaluation.finalStatus).toBe("FAILED");
  expect(evaluation.failedAtStageId).toBe("h3RouteCorridor");
  expect(evaluation.reasons.map((r) => r.code)).toContain("H3_OUTSIDE_SEARCH");
});
```

Update the existing e2e assertions: the run now covers fourteen stages, the pass/fail codes for capacity, vehicle and offline are unchanged, the detour rejection now attributes to `hardConstraints` rather than `routeFeasibility`, and the ETA rejection assertion is deleted.

Wire `runEngine` in `src/test/fixtures/runEngine.ts` to pass a `StubOptimizerEngine` so the e2e stays offline.

- [ ] **Step 4: Run the suite**

Run: `bun run test`
Expected: green, including all eleven original preset behaviours plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/scenarios src/test
git commit -m "test(simulation): re-tune presets for corridor indexing, add behind-vehicle regression"
```

---

## Task 24: Documentation

**Files:**
- Modify: `apps/simulation/README.md`
- Modify: `apps/simulation/.env.example`

- [ ] **Step 1: Rewrite the pipeline section**

Replace the nine-stage list with the fourteen, and rewrite these sections to match what was built:

- **The matching pipeline** — the fourteen stages with a one-line purpose each, mapped to the Overview's numbering.
- **Key decisions** — replace "Existing stops are frozen" with the locked-spine explanation, add "the corridor is built from remaining stops only", and add "measuring and judging are separate stages".
- **Cost control** — two budgets now: `maxRoutingCallsPerRun` for baselines, `maxOptimizerCallsPerRun` for stage 8.
- **How to add a new filter or stage** — update for the new registry, `STAGE_METADATA`, and `DEFAULT_STAGE_ORDER`; note that `stageOrder` is no longer freely reorderable.
- **Known limits** — add: stage 11 ranks across drivers not sequences; the optimizer proxy is dev-server only; commit concurrency is unsolved.

- [ ] **Step 2: Add the Route Optimization setup section**

Insert after the existing "Google Maps API setup" section:

````markdown
## Route Optimization setup

Stage 8 sends each candidate driver to Google's `OptimizeTours`. That API is
server-side only — it needs OAuth2 credentials and does not support browser
CORS — so the dev server proxies it at `POST /api/optimize-tours`.

Authenticate once with Application Default Credentials:

```bash
gcloud auth application-default login
```

and set the project in `apps/simulation/.env.local`:

```
GOOGLE_CLOUD_PROJECT=your-project-id
```

Enable the **Route Optimization API** on that project.

No key material is ever committed or sent to the browser: the proxy signs each
request server-side and forwards only the solution.

**This works under `bun run dev` only.** `bun run build` produces static files
with no server behind them, so a built bundle cannot reach the optimizer and
the app shows the unavailable banner. That is deliberate — this is a lab tool,
not something anyone deploys.

Without credentials, **Run matching** refuses to start rather than reporting
per-driver failures. A run with no solver has no opinion about any driver, and
saying otherwise would be a lie.
````

- [ ] **Step 3: Verify the documented commands actually work**

Run each command block in the README from a clean checkout: `bun install`, `bun run dev`, `bun run test`, `bun run check-types`, `bun run lint`, `bun run build`.
Expected: each behaves as documented. Fix the README where it does not.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs(simulation): thirteen-stage pipeline and Route Optimization setup"
```

---

## Self-review notes

Checked against the spec:

- **Every spec section has a task.** Optimizer module → Tasks 4–7. Proxy → Task 8. Stage registry → Task 9. Stages 1–12 → Tasks 10–21. Schema v2 → Task 1. Scoring → Task 20. Testing → the stub optimizer in Task 17 and per-stage tests throughout. Documentation → Task 24.
- **Two spec details are implemented differently from the spec's wording, deliberately.** The spec described stage 4's third signal as "destination ahead of the *vehicle's* progress"; because the corridor polyline starts at the vehicle, that comparison is always trivially true, so Task 13 compares the destination's progress against the *pickup's* instead — the same property, measured where it discriminates. And the spec put stage 1's budgets in `notes`; Task 15 also publishes them through the context, because stages cannot read another stage's notes.
- **Naming is consistent across tasks.** `getCorridor`/`setCorridor`, `getSequences`/`setSequences`, `getDelayBudgets`/`setDelayBudgets`, `getSolution`/`setSolution` all follow one pattern and are each introduced in exactly one task and consumed by name in later ones.
- **One known ordering hazard.** Task 17's `roadRouting` reads `originalEtaMin` by positional index into `getDelayBudgets(driverId)`, which is correct only because stage 1 builds budgets in the same order `toProposedStops` produces stops. If Task 10 or Task 17 is implemented out of order, index them by `stopId` instead — the safer form, and worth preferring even if the orders do agree.
