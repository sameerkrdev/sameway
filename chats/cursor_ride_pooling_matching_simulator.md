# Ride pooling matching simulator
_Exported on 8/22/2026 at 19:07:48 GMT+5:30 from Cursor (3.16.17)_

---

**User**

note: make new frontend app called simulation and don't edit or update anything apart fromm this new app

# Ride Pooling Matching Simulator — Prototype Build Specification

## 1. Objective

Build a frontend-only interactive prototype for a ride-sharing / ride-pooling platform that simulates realistic driver matching scenarios on a Google Map.

The purpose of this application is NOT to build a production ride-booking UI.

The purpose is to build a **visual testing and experimentation environment** where we can:

1. Add drivers.
2. Add vehicles.
3. Define driver current location.
4. Define the driver's current route.
5. Add existing passengers/riders to a driver's ride.
6. Define existing passenger pickup/drop stops.
7. Add new ride requests.
8. Select pickup/drop locations directly from Google Maps.
9. Select multiple stops using a Google Maps-style stop-point interface.
10. Run our driver-matching algorithm entirely in the frontend.
11. Use H3 for spatial candidate generation.
12. Apply multiple matching stages and filters.
13. Return ranked candidate drivers.
14. Show exactly why every driver passed or failed.
15. Show exactly which stage/filter rejected each driver.
16. Visualize all of this directly on the map.
17. Allow us to create complicated real-life scenarios involving many drivers, riders, routes, vehicles, and simultaneous rides.

The application should feel like a **dispatch/matching simulator**, similar to a developer tool used to test Uber/Rapido-style ride matching algorithms.

---

# 2. Technology Stack

Use:

* React
* TypeScript
* Vite
* Tailwind CSS
* shadcn/ui
* Google Maps JavaScript API
* Google Maps Places API where useful
* H3 / h3-js
* React Query only if useful, although no backend is required
* Zustand for application state
* Zod for validation
* Lucide React for icons
* date-fns if required
* Turf.js where useful for geographic calculations
* a routing/directions solution compatible with Google Maps

Everything should currently run entirely in the browser.

Do NOT create a backend.

Do NOT require PostgreSQL.

Do NOT require Redis.

Do NOT require Prisma.

The architecture should, however, be designed so that the matching engine can later be extracted into a backend service.

---

# 3. Core Principle

The application should clearly separate:

```text
Scenario Setup
        ↓
Spatial Candidate Generation
        ↓
Hard Filters
        ↓
Route Compatibility
        ↓
Capacity Validation
        ↓
Detour Calculation
        ↓
Pooling Compatibility
        ↓
Scoring
        ↓
Final Driver Ranking
```

Do not create one giant matching function.

Each stage must be implemented as an independent module.

The UI must be able to show the output of every stage.

---

# 4. Main Application Layout

Create a professional desktop-first dashboard.

Use a layout similar to:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Header                                                              │
│ Ride Matching Simulator     Scenario: Delhi Test #1     Run Match  │
├───────────────┬───────────────────────────────────────┬─────────────┤
│               │                                       │             │
│ Scenario      │                                       │ Matching    │
│ Setup         │             GOOGLE MAP                │ Results     │
│               │                                       │             │
│ Drivers       │                                       │ Summary     │
│ Vehicles      │                                       │             │
│ Passengers    │                                       │ Candidates  │
│ Rides         │                                       │             │
│ Request       │                                       │ Rejections  │
│               │                                       │             │
├───────────────┴───────────────────────────────────────┴─────────────┤
│ Stage Pipeline / Debug Console                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The map should be the central visual element.

---

# 5. Left Sidebar — Scenario Builder

Create tabs or collapsible sections:

```text
Scenario
Drivers
Vehicles
Passengers
Existing Rides
New Request
Simulation Settings
```

Each section should allow creating and editing entities.

---

# 6. Driver Management

The user must be able to add unlimited drivers.

Driver form:

```text
Driver ID
Driver Name
Driver Status
Current Location
Vehicle
Current Ride
Available Seats
Maximum Seats
Driver Preferences
```

Status options:

```text
ONLINE
OFFLINE
BUSY
PAUSED
```

For matching purposes only ONLINE drivers should normally be considered.

Example:

```text
Driver:
D001

Name:
Rahul

Status:
ONLINE

Vehicle:
Auto A001

Current Location:
[Select on Map]

Current Ride:
Ride R001
```

---

# 7. Vehicle Management

Support at minimum:

```text
4-seater Cab
3-seater Auto
E-Rickshaw
6-seater Cab
```

Vehicle configuration:

```text
Vehicle ID
Vehicle Type
Total Seats
Luggage Capacity
Pooling Enabled
Wheelchair Accessible
AC / Non-AC
```

Example:

```text
Vehicle:

ID: V001
Type: 4-SEATER-CAB
Seats: 4
Pooling: true
```

Do not hard-code vehicle types into the matching engine.

Vehicle configuration should be data-driven.

---

# 8. Driver Location Selection

The user must be able to select a driver's current location directly on Google Maps.

Interaction:

```text
Add Driver
    ↓
Click "Select Location"
    ↓
Map enters location-selection mode
    ↓
User clicks map
    ↓
Marker appears
    ↓
Latitude / longitude are saved
    ↓
Reverse geocode the location if possible
```

Display:

```text
Latitude: 28.6139
Longitude: 77.2090
Address: Connaught Place, New Delhi
H3 Resolution 9:
8928308280fffff
```

Also display the H3 cell visually if practical.

---

# 9. Existing Ride Creation

A driver can have an existing ride.

Example:

```text
Ride R001

Driver: D001

Passengers:
P001
P002

Route:

Driver current location
      ↓
Pickup P001
      ↓
Pickup P002
      ↓
Drop P001
      ↓
Drop P002
```

The UI must support adding multiple passengers/stops.

---

# 10. Google Maps Stop Point System

Implement a Google Maps-style route builder.

The user should have a button:

```text
+ Add Stop
```

When clicked:

```text
Stop 1
Stop 2
Stop 3
...
```

Each stop can be:

```text
PICKUP
DROP
```

Each stop should have:

```text
Stop ID
Passenger
Type
Location
Sequence
```

Example:

```text
1. Pickup Rahul
2. Pickup Priya
3. Drop Rahul
4. Drop Priya
```

The user should be able to:

* click the map to select a stop
* search for a location
* drag a marker
* reorder stops
* delete stops
* change pickup/drop type
* assign a passenger
* visualize the sequence

Use numbered map markers:

```text
1 → Pickup Rahul
2 → Pickup Priya
3 → Drop Rahul
4 → Drop Priya
```

---

# 11. Passenger Management

Allow creation of passengers/riders.

Passenger:

```text
Passenger ID
Name
Seats Required
Special Requirements
```

Examples:

```text
P001
Rahul
1 seat

P002
Priya
2 seats
```

A passenger may belong to an existing ride or a new ride request.

---

# 12. New Ride Request

Create a dedicated "New Ride Request" panel.

Fields:

```text
Request ID

Passenger

Seats Required

Pickup Location

Drop Location

Maximum Wait Time

Maximum Detour

Pooling Allowed

Vehicle Preference

Maximum Walking Distance

Priority
```

Example:

```text
Request R100

Passenger:
Aman

Seats:
1

Pickup:
Connaught Place

Drop:
Noida Sector 62

Max Wait:
6 minutes

Max Detour:
15%

Pooling:
YES

Vehicle:
Any
```

Pickup and drop must be selectable directly on the map.

---

# 13. New Request Route

Support:

```text
Pickup
   ↓
Optional intermediate stops
   ↓
Drop
```

The user should be able to create:

```text
Pickup A
Stop B
Stop C
Drop D
```

Each point must have a type.

---

# 14. Map Visualization

The map is the most important part of the application.

Visualize:

### Drivers

Use different marker/icon styles:

```text
ONLINE driver
BUSY driver
OFFLINE driver
```

Example:

```text
🟢 D001
🟢 D002
🟡 D003
⚫ D004
```

Avoid relying only on emoji; create proper map markers/icons.

---

# 15. Driver Route Visualization

Every driver's current route should be rendered as a polyline.

Example:

```text
D001

Current Location
      │
      ▼
Pickup P1
      │
      ▼
Pickup P2
      │
      ▼
Drop P1
      │
      ▼
Drop P2
```

Use numbered stop markers.

When a driver is selected in the UI, highlight:

* current location
* complete route
* passengers
* stops
* route direction
* remaining route

---

# 16. New Request Visualization

Show the new ride request prominently.

For example:

```text
🟦 New Pickup
🟥 New Drop
```

Draw the requested route.

When a candidate driver is selected:

```text
Driver route
+
new rider pickup
+
new rider drop
```

should be visualized together.

---

# 17. H3 Visualization

Use H3 resolution 9 initially.

For every driver show:

```text
H3 Cell
```

For the new request show:

```text
Pickup H3 Cell
Drop H3 Cell
```

When Stage 1 runs, highlight:

```text
Pickup H3 Cell
Neighboring H3 Cells
Expanded H3 Cells
```

Use different visual states:

```text
Current cell
Ring 1
Ring 2
Ring 3
```

Do not make H3 visualization mandatory for every screen. Provide a toggle:

```text
☑ Show H3 Grid
```

When enabled, draw the relevant H3 polygons.

---

# 18. Matching Pipeline

Implement the following stages.

## Stage 0 — Request Validation

Validate:

```text
pickup exists
drop exists
seats > 0
pickup != drop
vehicle preference valid
```

If invalid:

```text
REQUEST_REJECTED
```

---

# 19. Stage 1 — H3 Candidate Generation

Calculate:

```ts
pickupCell = latLngToCell(
    pickup.lat,
    pickup.lng,
    9
);
```

Start with the pickup cell.

Then expand using:

```ts
gridDisk(pickupCell, radius)
```

Use adaptive search.

Example:

```text
Ring 0
   ↓
enough usable candidates?
   ↓ no
Ring 1
   ↓
enough?
   ↓ no
Ring 2
   ↓
enough?
```

Do NOT always search a huge radius.

Config:

```text
minimumCandidates = 10
maxH3Ring = 3
H3Resolution = 9
```

These values should be configurable in the UI.

---

# 20. Stage 1 Result

For every driver show:

```text
Candidate: YES/NO

Pickup H3:
8928308280fffff

Driver H3:
8928308281fffff

H3 Ring:
1

H3 Distance:
1

Reason:
"Driver found within H3 search area"
```

For rejected drivers:

```text
Reason:
"Driver outside maximum H3 search area"
```

---

# 21. Stage 2 — Driver Status Filter

Reject:

```text
OFFLINE
PAUSED
DISCONNECTED
```

Accept:

```text
ONLINE
```

Example:

```text
D001 → PASS
D002 → FAIL
Reason: Driver is OFFLINE
```

The system must preserve the rejection reason.

---

# 22. Stage 3 — Vehicle Filter

Check:

```text
requested vehicle type
vehicle capability
pooling support
```

Example:

```text
Request:
2 seats
vehicle preference:
CAB
```

Driver:

```text
E-Rickshaw
```

If incompatible:

```text
FAIL

Reason:
Vehicle type does not satisfy request preference.
```

---

# 23. Stage 4 — Capacity Filter

Calculate:

```text
availableSeats =
vehicle.totalSeats
-
currentPassengerSeats
```

Then:

```text
availableSeats >= requestedSeats
```

Example:

```text
Vehicle:
6 seats

Current passengers:
4

Available:
2

Request:
2 seats

PASS
```

Another:

```text
Vehicle:
3 seats

Current passengers:
2

Available:
1

Request:
2

FAIL
```

Reason:

```text
Insufficient available seats.
Required: 2
Available: 1
```

---

# 24. Stage 5 — Route Compatibility

This is one of the most important parts.

For drivers who passed the basic filters, determine whether the new passenger can reasonably be inserted into the driver's existing route.

The route has:

```text
current driver location
existing stops
existing passenger pickups
existing passenger drops
```

Try possible insertion points.

Example:

```text
Existing:

Driver
 ↓
Pickup A
 ↓
Drop A
 ↓
Pickup B
 ↓
Drop B
```

New passenger:

```text
Pickup C
Drop C
```

Try:

```text
Driver
 ↓
Pickup A
 ↓
Pickup C
 ↓
Drop A
 ↓
Drop C
 ↓
Pickup B
 ↓
Drop B
```

and other valid insertion combinations.

Respect passenger ordering:

```text
pickup must occur before drop
```

---

# 25. Route Compatibility Rules

The matching engine should support configurable rules:

```text
maximum route detour %
maximum additional distance
maximum additional travel time
maximum pickup delay
maximum passenger delay
```

Example:

```text
Max detour:
15%

Existing route:
10 km

New route:
11.2 km

Detour:
12%

PASS
```

Another:

```text
Existing:
10 km

New:
13 km

Detour:
30%

FAIL
```

Reason:

```text
Route detour exceeds configured maximum.
```

---

# 26. Routing Calculation

For the prototype, use Google Maps Directions / Routes capabilities if available.

Do not calculate road distance using straight-line distance for final route compatibility.

Straight-line/Haversine distance can be used only as a cheap pre-filter.

The architecture should distinguish:

```text
geographic distance
```

from:

```text
road distance
```

and:

```text
ETA
```

---

# 27. Route Calculation Optimization

Do not call the routing API for every possible driver/insertion combination unnecessarily.

Pipeline should be:

```text
H3
 ↓
Status
 ↓
Vehicle
 ↓
Capacity
 ↓
Cheap geographic filters
 ↓
Routing
 ↓
Detailed route compatibility
```

The purpose is to minimize expensive route calculations.

For the prototype, it is okay if routing is simplified when Google routing quota is unavailable, but keep the interface abstract:

```ts
interface RoutingEngine {
    calculateRoute(...)
    calculateDistance(...)
    calculateDuration(...)
}
```

Implement:

```text
GoogleRoutingEngine
```

and optionally:

```text
MockRoutingEngine
```

for development/testing.

---

# 28. Stage 6 — Pickup Proximity

Calculate actual road/geographic distance between:

```text
driver current position
```

and:

```text
new passenger pickup
```

Store:

```text
distance
ETA
```

Example:

```text
Driver D001

Distance:
1.8 km

ETA:
5 min

PASS
```

Reject if:

```text
ETA > maxWait
```

Reason:

```text
Driver ETA exceeds passenger maximum wait time.
```

---

# 29. Stage 7 — Pooling Compatibility

If:

```text
poolingAllowed = false
```

then only drivers without incompatible active pooled rides should be considered.

If pooling is enabled, evaluate:

```text
existing passengers
new passenger
route compatibility
capacity
detour
pickup ordering
drop ordering
```

---

# 30. Stage 8 — Score Candidates

For every driver that survives all hard filters, calculate a score.

Example:

```text
score =
    ETA score
  + distance score
  + detour score
  + route compatibility score
  + capacity score
  + driver fairness score
```

Do not hard-code everything into one expression.

Create configurable weights:

```text
ETA weight
Distance weight
Detour weight
Route compatibility weight
Driver fairness weight
```

Example:

```text
ETA Weight: 30
Distance Weight: 20
Detour Weight: 30
Fairness Weight: 20
```

---

# 31. Final Matching Result

Return:

```ts
interface DriverMatchResult {
    driverId: string;

    status: "PASSED" | "FAILED";

    finalScore?: number;

    stages: StageResult[];

    metrics: {
        h3Distance?: number;
        pickupDistance?: number;
        pickupEta?: number;
        currentRouteDistance?: number;
        newRouteDistance?: number;
        detourPercentage?: number;
        availableSeats?: number;
    };

    reasons: MatchReason[];
}
```

---

# 32. Explainability Is Mandatory

This is one of the most important requirements.

The application must NEVER simply say:

```text
Driver D001 not selected.
```

It must say:

```text
D001

Stage 1: PASS
H3 ring: 1

Stage 2: PASS
Driver online

Stage 3: PASS
Vehicle compatible

Stage 4: PASS
Available seats: 2

Stage 5: PASS
Route compatible

Stage 6: PASS
Pickup ETA: 4 min

Stage 7: PASS
Pooling compatible

Stage 8:
Score = 87.3

FINAL:
Rank #1
```

For a rejected driver:

```text
D002

Stage 1: PASS
H3 ring: 1

Stage 2: PASS
ONLINE

Stage 3: PASS
Vehicle compatible

Stage 4: FAIL

Reason:
Required seats: 2
Available seats: 1

Pipeline stopped here.
```

The UI should clearly show:

```text
✓ Passed
✗ Failed
— Not Evaluated
```

---

# 33. Results Dashboard

After clicking:

```text
Run Matching
```

show:

```text
MATCHING RESULTS

Request:
R100

Candidates:
24

Passed all filters:
5

Rejected:
19

Best Driver:
D014

Score:
92.4

ETA:
4 min

Detour:
6.2%
```

Then ranked candidates:

```text
#1 D014   92.4
#2 D007   88.7
#3 D021   81.2
#4 D004   77.5
#5 D011   73.1
```

---

# 34. Driver Result Card

Each driver card:

```text
┌──────────────────────────────────────┐
│ #1  D014                  Score 92.4 │
│ Rahul                               │
│ 6-Seater Cab                        │
│                                      │
│ ETA             4 min               │
│ Distance        1.2 km              │
│ Available       3 seats             │
│ Detour           6.2%               │
│ H3 Ring          1                   │
│                                      │
│ ✓ All filters passed                │
│                                      │
│ [View Details] [Show on Map]        │
└──────────────────────────────────────┘
```

---

# 35. Rejection Dashboard

Create a separate tab:

```text
Why Drivers Failed
```

Aggregate failures.

Example:

```text
Capacity                 7
Offline                  3
Vehicle mismatch         2
Pickup too far            3
Route detour              2
H3 outside search         1
Pooling incompatible      1
```

Clicking:

```text
Capacity: 7
```

shows the seven drivers.

This is extremely useful for algorithm testing.

---

# 36. Stage Debugger

Create a horizontal pipeline:

```text
REQUEST
   ↓
H3
   ↓
STATUS
   ↓
VEHICLE
   ↓
CAPACITY
   ↓
ROUTE
   ↓
ETA
   ↓
POOLING
   ↓
SCORING
```

Each stage should show:

```text
Input:
50 drivers

Output:
32 drivers

Rejected:
18
```

Click a stage to inspect it.

Example:

```text
CAPACITY

Input:
32

Passed:
25

Rejected:
7

Reasons:
- D001: available 1 < required 2
- D005: available 0 < required 1
...
```

---

# 37. Scenario Presets

Provide buttons:

```text
Load Scenario
```

Presets:

```text
Simple Single Ride

Busy Delhi

Airport Pooling

Multiple Passengers

Vehicle Capacity Test

Route Detour Test

Sparse Driver Area

Dense Driver Area

No Driver Available

Mixed Vehicle Fleet

Large Pooling Scenario
```

Each preset should populate:

```text
drivers
vehicles
passengers
rides
request
```

---

# 38. Scenario Builder

Allow:

```text
Save Scenario
Load Scenario
Duplicate Scenario
Reset Scenario
Export Scenario JSON
Import Scenario JSON
```

The scenario should be serializable.

Example:

```ts
interface Scenario {
    id: string;
    name: string;
    drivers: Driver[];
    vehicles: Vehicle[];
    passengers: Passenger[];
    rides: Ride[];
    requests: RideRequest[];
    settings: MatchingSettings;
}
```

---

# 39. Scenario JSON

Make it possible to export a complete test case.

Example:

```json
{
  "name": "Noida Pooling Test",
  "drivers": [],
  "vehicles": [],
  "passengers": [],
  "rides": [],
  "requests": [],
  "settings": {
    "h3Resolution": 9,
    "maxH3Ring": 3,
    "minimumCandidates": 10,
    "maxWaitMinutes": 6,
    "maxDetourPercent": 15
  }
}
```

This allows us to reproduce matching bugs.

---

# 40. Map Interaction Modes

The map should support explicit modes:

```text
Normal
Add Driver Location
Add Passenger Pickup
Add Passenger Drop
Add Stop
Select Route
Inspect H3
```

Display the current mode clearly.

Example:

```text
MAP MODE: ADD DRIVER LOCATION

Click anywhere on the map to place the driver.
```

---

# 41. Search Location

Provide a Google Maps-style location search:

```text
Search location...
```

Example:

```text
Connaught Place
Noida Sector 62
IGI Airport
Anand Vihar
```

Selecting a result moves the map and allows using it as:

```text
driver location
pickup
drop
stop
```

---

# 42. Map Popups

Clicking a driver should show:

```text
Driver D001

Status:
ONLINE

Vehicle:
6-Seater Cab

Current location:
28.6139, 77.2090

H3:
8928308280fffff

Passengers:
2

Available seats:
2

Current ride:
R001
```

Clicking a passenger:

```text
Passenger P001

Seats:
1

Pickup:
...
Drop:
...
```

Clicking a stop:

```text
Stop #3

Type:
DROP

Passenger:
P001

Sequence:
3
```

---

# 43. Route Builder UX

Create a route editor similar to Google Maps.

Example:

```text
Current Location
       ↓
[1] Pickup Rahul
       ↓
[2] Pickup Priya
       ↓
[3] Drop Rahul
       ↓
[4] Drop Priya
```

Each stop should have:

```text
drag handle
edit
delete
```

Allow reordering.

After reordering, validate:

```text
pickup before drop
```

If invalid:

```text
Invalid route:
Passenger Priya is dropped before pickup.
```

---

# 44. Passenger Ride State

Each passenger should have:

```text
WAITING
PICKED_UP
IN_RIDE
DROPPED
CANCELLED
```

The current state should affect capacity.

For example:

```text
WAITING
```

means the passenger will consume capacity after pickup.

```text
DROPPED
```

means that passenger no longer consumes capacity.

---

# 45. Simulation Mode

Add a future-ready simulation mode.

Button:

```text
▶ Simulate
```

Simulation should move drivers along their route.

For the prototype, it can be basic:

```text
tick every 1 second
```

Drivers move between route points.

Passengers transition:

```text
WAITING
 ↓
PICKED_UP
 ↓
IN_RIDE
 ↓
DROPPED
```

This is optional for the first version, but structure the data model so it can be added easily.

---

# 46. Important Matching Rule

The system must distinguish between:

```text
Hard Filters
```

and:

```text
Soft Ranking Factors
```

Hard filters:

```text
offline
wrong vehicle
insufficient capacity
maximum ETA exceeded
route impossible
detour exceeds maximum
pooling prohibited
```

Soft factors:

```text
ETA
distance
detour
driver fairness
route quality
```

A driver failing a hard filter must NOT reach scoring.

---

# 47. Matching Engine Architecture

Create:

```text
src/
  matching/
    engine.ts

    stages/
      requestValidation.ts
      h3CandidateGeneration.ts
      driverStatusFilter.ts
      vehicleFilter.ts
      capacityFilter.ts
      routeCompatibility.ts
      pickupEtaFilter.ts
      poolingCompatibility.ts
      scoring.ts

    types.ts
    reasons.ts
    config.ts
```

Each stage should have a common interface.

Example:

```ts
interface MatchingStage {
    id: string;
    name: string;

    execute(
        context: MatchingContext
    ): StageResult;
}
```

The engine:

```ts
const stages = [
    requestValidationStage,
    h3CandidateGenerationStage,
    driverStatusStage,
    vehicleStage,
    capacityStage,
    routeCompatibilityStage,
    pickupEtaStage,
    poolingCompatibilityStage,
    scoringStage
];
```

---

# 48. Do Not Mutate Scenario Data During Matching

The matching engine should be pure as much as possible.

Input:

```text
Scenario
+
RideRequest
+
MatchingSettings
```

Output:

```text
MatchingResult
```

Do not modify drivers/passengers/rides simply because a matching simulation was run.

This makes repeated testing reliable.

---

# 49. Matching Context

Use a structure similar to:

```ts
interface MatchingContext {
    scenario: Scenario;
    request: RideRequest;
    settings: MatchingSettings;

    candidates: CandidateDriver[];

    stageResults: StageResult[];

    routing: RoutingEngine;
}
```

---

# 50. Explainability Model

Create structured reasons.

Do not use only strings.

Example:

```ts
interface MatchReason {
    code: string;
    category: string;
    message: string;
    metadata?: Record<string, unknown>;
}
```

Examples:

```text
DRIVER_OFFLINE

INSUFFICIENT_CAPACITY

VEHICLE_MISMATCH

H3_OUTSIDE_SEARCH

PICKUP_ETA_TOO_HIGH

ROUTE_DETOUR_TOO_HIGH

POOLING_NOT_SUPPORTED

ROUTE_INCOMPATIBLE
```

This allows the UI to group failures.

---

# 51. H3 Module

Create a dedicated H3 utility module.

Functions:

```ts
getH3Cell(lat, lng, resolution)

getNeighborCells(cell, ring)

getH3Distance(cellA, cellB)

getCellBoundary(cell)

getCellsForPolygon(polygon)
```

Do not scatter H3 calls throughout the application.

---

# 52. H3 Configuration

Expose:

```text
H3 Resolution
Minimum Candidate Count
Maximum H3 Ring
```

in a developer settings panel.

Default:

```text
Resolution = 9
Minimum candidates = 10
Maximum ring = 3
```

Allow experimentation.

---

# 53. H3 Candidate Algorithm

Implement approximately:

```text
1. Convert request pickup to H3 cell.

2. Search ring 0.

3. Get drivers belonging to those cells.

4. Apply cheap filters.

5. If enough candidates exist:
      stop.

6. Otherwise expand to ring 1.

7. Repeat.

8. Stop at max ring.

9. Return all candidates and explain
   which ring discovered each driver.
```

Important:

Do not repeatedly add the same driver.

Deduplicate candidates by driver ID.

---

# 54. Route Insertion Engine

Create a separate module:

```text
routeInsertion.ts
```

Given:

```text
existing route
new pickup
new drop
```

generate valid insertion possibilities.

Example:

```text
existing stops = 4
```

Try possible insertion locations.

Reject invalid pickup/drop orderings.

For each valid route calculate:

```text
distance
duration
detour
pickup delay
existing passenger delay
```

Select the best valid insertion.

Return:

```ts
interface RouteInsertionResult {
    feasible: boolean;

    insertedRoute?: Route;

    pickupIndex?: number;

    dropIndex?: number;

    originalDistance?: number;

    newDistance?: number;

    detourPercentage?: number;

    additionalDuration?: number;

    reason?: MatchReason;
}
```

---

# 55. Important Real-Life Scenario

The system must support a driver already carrying passengers.

Example:

```text
Driver D001
Vehicle: 6-seater

Current passengers:
P1
P2
P3

Route:

Driver
 ↓
Pickup P1
 ↓
Pickup P2
 ↓
Drop P1
 ↓
Pickup P3
 ↓
Drop P2
 ↓
Drop P3
```

New request:

```text
P4
```

The engine should determine whether P4 can be inserted.

It should NOT simply say:

```text
6 seats - 3 passengers = 3 available
therefore PASS
```

Capacity is only one filter.

Route feasibility is required.

---

# 56. Multiple Existing Passengers

Support:

```text
1 driver
10+ passengers
```

where capacity and stop ordering are respected.

Example:

```text
Driver
 ↓
Pickup A
 ↓
Pickup B
 ↓
Drop A
 ↓
Pickup C
 ↓
Drop B
 ↓
Drop C
```

The system must understand that passenger occupancy changes throughout the route.

---

# 57. Dynamic Capacity

Capacity should be evaluated by route segment.

Example:

```text
6-seat vehicle

Segment 1:
2 passengers

Segment 2:
4 passengers

Segment 3:
5 passengers

Segment 4:
2 passengers
```

A new passenger requesting 2 seats may be:

```text
POSSIBLE
```

even though there are already 4 passengers somewhere on the route, depending on where the new pickup/drop occurs.

This is an important pooling rule.

Do NOT implement capacity only as:

```text
totalSeats - totalPassengers
```

for advanced route insertion.

Implement segment-level occupancy.

---

# 58. Final Result Example

The UI should produce something like:

```text
MATCHING REQUEST R102

Pickup:
Connaught Place

Drop:
Noida Sector 62

Passengers:
1

────────────────────────────

SEARCH

H3 Resolution:
9

Ring 0:
4 drivers

Ring 1:
18 drivers

Ring 2:
47 drivers

Total candidates:
47

────────────────────────────

FILTER RESULTS

H3:
47 → 47

Status:
47 → 39

Vehicle:
39 → 34

Capacity:
34 → 26

Route:
26 → 12

ETA:
12 → 9

Pooling:
9 → 7

Final:
7 drivers
```

Then:

```text
#1 D014
Score: 93.4
ETA: 4 min
Detour: 5.4%

#2 D021
Score: 89.7
ETA: 5 min
Detour: 4.1%

#3 D007
Score: 86.2
ETA: 3 min
Detour: 11.8%
```

---

# 59. Detailed Rejection Example

Click:

```text
D032
```

Show:

```text
Driver D032

────────────────────────────

Stage 1 — H3
✓ PASS

H3 ring:
1

────────────────────────────

Stage 2 — Status
✓ PASS

Status:
ONLINE

────────────────────────────

Stage 3 — Vehicle
✓ PASS

Vehicle:
3-Seater Auto

────────────────────────────

Stage 4 — Capacity
✓ PASS

Available:
2

Required:
1

────────────────────────────

Stage 5 — Route
✗ FAIL

Existing route:
12.4 km

Best insertion route:
15.8 km

Detour:
27.4%

Maximum allowed:
15%

Reason:
ROUTE_DETOUR_TOO_HIGH

Pipeline stopped.
```

This level of visibility is required.

---

# 60. Bulk Scenario Generation

Add:

```text
Generate Random Scenario
```

Parameters:

```text
Drivers:
100

Passengers:
50

Existing rides:
30

Vehicle distribution:
Cab 40%
Auto 30%
E-rickshaw 20%
6-seater 10%
```

Generate locations around the current map area.

This allows stress testing.

---

# 61. Scenario Statistics

Show:

```text
Drivers:
100

Online:
83

Busy:
40

Available seats:
137

Existing rides:
42

Passengers:
91

Pending requests:
12
```

When matching runs:

```text
Candidates:
43

Passed:
8

Rejected:
35
```

---

# 62. Comparison Mode

Allow two matching configurations:

```text
Algorithm A
vs
Algorithm B
```

For example:

```text
H3 ring max = 2
vs
H3 ring max = 3
```

Compare:

```text
candidate count
passed count
best driver
average ETA
average detour
routing calls
```

This will be useful later when optimizing our algorithm.

---

# 63. Algorithm Debugging

Add a developer/debug panel.

Show:

```text
H3 calculations
Candidate counts
Routing calculations
Stage execution time
Total execution time
```

Example:

```text
H3 lookup:
1.2 ms

Candidate filtering:
0.7 ms

Route compatibility:
18 ms

Routing:
412 ms

Scoring:
0.3 ms

Total:
432 ms
```

For mocked routing, show simulated timings.

---

# 64. Routing Abstraction

Create:

```ts
interface RoutingEngine {
    getRoute(
        waypoints: LatLng[]
    ): Promise<RouteResult>;

    getDistance(
        origin: LatLng,
        destination: LatLng
    ): Promise<number>;

    getDuration(
        origin: LatLng,
        destination: LatLng
    ): Promise<number>;
}
```

The matching algorithm must not directly depend on Google Maps API.

This allows us to later replace:

```text
Google
```

with:

```text
OSRM
GraphHopper
Valhalla
Mapbox
HERE
our own routing service
```

---

# 65. Google Maps API Key

Use environment variables:

```text
VITE_GOOGLE_MAPS_API_KEY
```

Never hard-code the key.

Create clear documentation:

```text
.env.local

VITE_GOOGLE_MAPS_API_KEY=...
```

---

# 66. State Management

Use Zustand.

Suggested stores:

```text
scenarioStore
mapStore
matchingStore
settingsStore
simulationStore
```

Do not put the entire application state into one giant store.

---

# 67. UI Components

Create reusable components:

```text
MapView
DriverMarker
PassengerMarker
StopMarker
RoutePolyline
H3Overlay

DriverPanel
DriverForm
VehicleForm
PassengerForm
RideForm
RequestForm

RouteBuilder
StopEditor
MatchingResults
DriverMatchCard
StagePipeline
StageDetails
RejectionPanel
ScenarioPanel
ScenarioPresetSelector
DebugConsole
SettingsPanel
```

---

# 68. shadcn/ui

Use shadcn/ui for:

```text
Button
Card
Dialog
Drawer
Tabs
Accordion
Badge
Select
Input
Label
Slider
Switch
Tooltip
Table
Progress
Separator
DropdownMenu
Sheet
ScrollArea
```

The UI should look like a professional internal engineering tool, not a generic demo.

---

# 69. Responsive Design

Desktop is the priority because the map + debugging interface requires space.

Still make it usable on tablet.

On mobile:

```text
Map
 ↓
Bottom sheet
```

can contain:

```text
Drivers
Request
Results
```

But don't compromise desktop usability for mobile.

---

# 70. Color/Visual Semantics

Use consistent semantic states:

```text
PASS
FAIL
WARNING
ACTIVE
SELECTED
INACTIVE
```

Do not rely only on colors.

Use:

```text
icon + badge + text
```

for accessibility.

---

# 71. Important UX Feature — Click Driver Result

When the user clicks a result:

```text
D014
```

the map should automatically:

```text
center on D014
zoom appropriately
highlight D014
show existing route
show new passenger pickup
show new passenger drop
show proposed inserted route
```

The UI should display:

```text
Original route
Proposed route
```

side by side conceptually.

---

# 72. Important UX Feature — Click Rejection

When the user clicks:

```text
D032
FAIL — Route Detour
```

the map should show:

```text
Original route
+
best attempted insertion
```

and highlight where the detour became excessive.

This is extremely useful for debugging the matching algorithm.

---

# 73. Important UX Feature — Stage Replay

Allow:

```text
Run Matching
```

and then:

```text
Stage 1
Stage 2
Stage 3
...
```

The user can click:

```text
Stage 4 — Capacity
```

and see only the drivers surviving up to that stage.

This lets us visually inspect the funnel.

---

# 74. Example Stage Replay

Before matching:

```text
100 drivers
```

Stage 1:

```text
100 → 31
```

Map shows:

```text
31 candidate drivers
```

Stage 2:

```text
31 → 26
```

Map updates to show:

```text
26
```

Stage 3:

```text
26 → 22
```

and so on.

This makes the algorithm visually understandable.

---

# 75. Testing Requirements

Create unit tests for:

### H3

```text
lat/lng → cell
neighbor calculation
ring expansion
cell distance
```

### Capacity

```text
4 seat / 3 passengers / request 1 → PASS

4 seat / 3 passengers / request 2 → FAIL
```

### Route

```text
pickup before drop → PASS
drop before pickup → FAIL
```

### Detour

```text
10 km → 11 km = 10%
```

### ETA

```text
ETA 5 / max 6 → PASS
ETA 8 / max 6 → FAIL
```

### Pooling

Test multiple passenger insertion scenarios.

---

# 76. Important Edge Cases

Explicitly support and test:

```text
No drivers

No online drivers

All drivers offline

No vehicle with enough seats

Driver exactly at pickup

Driver very far away

Driver in neighboring H3 cell

Driver in ring 2

Driver in ring 3

Pickup and drop in same H3 cell

Pickup and drop very far apart

Existing ride with zero passengers

Existing ride with maximum passengers

Driver route has many stops

New passenger pickup overlaps existing pickup

New passenger drop overlaps existing drop

Two passengers share same pickup

Two passengers share same drop

Pickup occurs after existing passenger's drop

New ride causes capacity overflow

New ride causes excessive detour

Pooling disabled

Vehicle incompatible

Driver disconnected

Duplicate H3 candidate

Multiple drivers at exact same location
```

---

# 77. Seed Data

Provide realistic seed data around Delhi NCR.

Use places such as:

```text
Connaught Place
India Gate
Karol Bagh
Anand Vihar
Noida Sector 62
Noida Sector 18
Ghaziabad
Indirapuram
Vaishali
IGI Airport
Rajouri Garden
Lajpat Nagar
Saket
Gurgaon
```

Do not hard-code these locations into the matching engine.

They are only demo scenarios.

---

# 78. Example Seed Scenario

Create one scenario:

```text
Scenario:
Delhi NCR Morning Pool

Drivers:
20

Vehicles:
mixed

Existing rides:
8

Passengers:
15

New request:
1 passenger

Pickup:
Noida Sector 62

Drop:
Connaught Place
```

The result should produce a meaningful mix of:

```text
passed drivers
capacity failures
vehicle failures
route failures
ETA failures
H3 failures
```

so the UI demonstrates the entire pipeline.

---

# 79. Important Architecture Rule

Keep the matching algorithm independent of React.

Bad:

```text
React component
    ↓
calculate driver
    ↓
calculate H3
    ↓
calculate route
```

Good:

```text
React
  ↓
Matching Engine
  ↓
Pure TypeScript modules
```

For example:

```text
src/matching/
```

should be usable from:

```text
React
Node.js
unit tests
future backend
```

without requiring React.

---

# 80. Future Backend Migration

Design the prototype so later we can move:

```text
Matching Engine
H3 candidate generation
Routing
Scoring
```

to:

```text
Node.js Matching Service
```

without rewriting the UI.

The UI should eventually communicate with:

```text
POST /matching/preview
```

but for now call the local engine:

```text
matchingEngine.findMatches(...)
```

Create an abstraction:

```ts
interface MatchingService {
    findMatches(
        scenario: Scenario,
        request: RideRequest
    ): Promise<MatchingResult>;
}
```

Then implement:

```text
LocalMatchingService
```

now.

Later:

```text
ApiMatchingService
```

---

# 81. Performance Requirements

The prototype should handle approximately:

```text
500 drivers
500 passengers
200 active rides
1000 route stops
```

without becoming unusable.

Use memoization where useful.

Avoid unnecessary React re-renders.

Do not render hundreds of complex DOM elements over the map if Google Maps overlays/markers can handle them more efficiently.

---

# 82. Deliverables

Build a fully runnable project.

Provide:

```text
README.md
.env.example
package.json
```

README must explain:

```text
installation
Google Maps API setup
H3 setup
running locally
scenario creation
matching pipeline
algorithm architecture
how to add new filters
how to add new vehicle types
how to add new matching stages
```

---

# 83. Definition of Done

The prototype is considered complete only when I can perform this workflow:

```text
1. Open application.

2. See Google Map.

3. Add 10+ drivers.

4. Select each driver's location on map.

5. Assign different vehicles.

6. Create existing rides.

7. Add multiple passengers to existing rides.

8. Create pickup/drop stops.

9. Reorder stops.

10. See every driver's route on map.

11. Create a new ride request.

12. Select pickup on map.

13. Select drop on map.

14. Add optional intermediate stops.

15. Configure seats.

16. Configure maximum wait.

17. Configure maximum detour.

18. Configure pooling.

19. Click "Run Matching".

20. See H3 candidate generation.

21. See H3 cells/rings on map.

22. See each matching stage.

23. See candidate counts after every stage.

24. See final ranked drivers.

25. See score.

26. Click a driver.

27. See exactly why they passed.

28. Click a failed driver.

29. See exactly why they failed.

30. See the failed stage.

31. See original route.

32. See proposed route insertion.

33. See detour calculation.

34. See ETA.

35. See capacity calculation.

36. Export scenario.

37. Import scenario.

38. Load predefined scenarios.

39. Generate random scenarios.

40. Repeat matching with different settings.
```

---

# 84. Final Product Vision

The finished application should look and behave like:

```text
                 RIDE MATCHING LAB

 ┌──────────────────────────────────────────────────────────────┐
 │ Scenario: Delhi Morning Pool                    RUN MATCHING │
 ├─────────────┬───────────────────────────────┬────────────────┤
 │             │                               │                │
 │ SCENARIO    │                               │ MATCH RESULTS  │
 │             │                               │                │
 │ Drivers 20  │                               │ #1 D014  93.4 │
 │ Rides  8    │          GOOGLE MAP           │ #2 D021  89.7 │
 │ Users  15   │                               │ #3 D007  86.2 │
 │             │                               │                │
 │ REQUEST     │       H3 CELLS               │ FAILED         │
 │             │                               │ Capacity: 7    │
 │ Pickup      │       DRIVER ROUTES          │ Vehicle: 3     │
 │ Drop        │                               │ ETA: 2         │
 │ Seats       │                               │ Route: 4       │
 │ Max ETA     │                               │                │
 │ Max Detour  │                               │                │
 │             │                               │                │
 ├─────────────┴───────────────────────────────┴────────────────┤
 │ MATCHING PIPELINE                                             │
 │                                                              │
 │ Request → H3 → Status → Vehicle → Capacity → Route → ETA    │
 │             47      39        34        26       12     9   │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘
```

The most important goal is **explainability**.

This should become our laboratory for experimenting with the actual matching algorithm before implementing it in the production backend.

Every matching decision should be inspectable:

```text
WHY WAS THIS DRIVER CONSIDERED?
WHY WAS THIS DRIVER REJECTED?
AT WHICH STAGE?
WHAT WAS THE VALUE?
WHAT WAS THE THRESHOLD?
WHAT WOULD HAVE HAPPENED IF THE THRESHOLD CHANGED?
```

The architecture must make those questions answerable without modifying the core UI.


---

**Cursor**

I'll start by understanding the existing monorepo structure so the new app fits its conventions.

Good — I have the monorepo picture. Two decisions will significantly change the plan, so let me confirm them before writing it.

**Scoping the simulation app**

> **This spec has ~80 sections. How do you want the first build scoped?**
> - Build the whole spec in one pass — every section including comparison mode, simulation playback, bulk generation, and unit tests
> - Core vertical slice first (Recommended) — map + scenario builder + full 9-stage engine + explainability + results/rejection/stage-debugger + presets + import/export. Defer comparison mode, simulate playback, and Vitest suite to a follow-up ✔
> - Engine + types first with a minimal UI, then build out the full dashboard after you review the algorithm

> **Google Maps Directions API costs money per call and the pipeline makes many routing calls. What should the default RoutingEngine be?**
> - MockRoutingEngine by default (Recommended) — haversine x road-factor + speed model, zero API cost; a UI toggle switches to GoogleRoutingEngine (Directions via JS SDK) when you want real roads
> - GoogleRoutingEngine by default, with mock as fallback when no API key is present ✔
> - Mock only for now — build the RoutingEngine interface but do not implement the Google adapter yet

Let me check the shared configs I can extend without modifying them.

---

**User**

# Prompt 2 — Deep Architectural Review and Improvement of the Existing Ride Matching Simulator Plan

We already have an implementation plan for the frontend-only Ride Matching Simulator / Ride Pooling Matching Lab.

Do NOT blindly rewrite the entire plan.

Your job is to **deeply audit the existing plan, identify architectural/algorithmic/API/UX problems, and produce an improved implementation plan** before any code is written.

The goal is to make this prototype a serious **ride-matching algorithm laboratory**, not just a map demo.

The existing plan is the source of truth for the current intended scope. Preserve good decisions, but correct weaknesses where necessary.

---

# 1. First: Inspect the Existing Plan and Repository

Before proposing changes:

1. Read the complete existing implementation plan.
2. Inspect the repository structure.
3. Inspect the existing TurboRepo setup.
4. Inspect existing apps/packages/configuration.
5. Inspect existing TypeScript/ESLint/Tailwind conventions.
6. Check the existing package manager and workspace configuration.
7. Do not modify anything yet.

Do not assume that the repository structure described by the old plan is still correct.

Report:

```text
Existing architecture
Existing apps
Existing shared packages
Existing configs
Potential conflicts
Potential reusable packages
Potential dependency/version conflicts
```

The simulator should remain self-contained unless there is a compelling reason to reuse an existing shared package.

---

# 2. Core Objective

The application is a:

> Visual Ride Matching Laboratory for testing H3-based candidate generation, driver filtering, route insertion, pooling compatibility, ETA, capacity, detour, and driver ranking.

It should allow us to construct realistic scenarios:

```text
Drivers
Vehicles
Passengers
Existing rides
Existing routes
Pickup/drop stops
New ride requests
Driver locations
Passenger locations
Map routes
H3 cells
```

Then execute:

```text
Request Validation
        ↓
H3 Candidate Generation
        ↓
Driver Status
        ↓
Vehicle Compatibility
        ↓
Capacity Pre-filter
        ↓
Route Insertion / Route Feasibility
        ↓
Pickup ETA
        ↓
Pooling Business Rules
        ↓
Scoring
```

The application must explain:

```text
Why was this driver considered?
Why was this driver rejected?
At which stage?
What values were calculated?
What threshold caused rejection?
What was the best attempted route?
What was the final score?
```

---

# 3. Important: Do Not Treat H3 as Road Distance

Correct the architecture if necessary so that H3 is used only for:

```text
Spatial candidate generation
Spatial grouping
Neighborhood discovery
Spatial aggregation
Demand/supply analysis
```

H3 must NOT be treated as:

```text
road distance
ETA
actual route proximity
```

Clearly separate:

```text
H3 grid distance
Straight-line distance
Road distance
Road ETA
```

For example:

```text
H3 ring = 1
H3 grid distance = 1
straight-line distance = 1.4 km
road distance = 2.1 km
ETA = 5 min
```

These are separate metrics.

---

# 4. Correct H3 Candidate Generation

Review the existing H3 implementation.

Prefer the H3 v4 API appropriate for ring-aware traversal.

Expose through one isolated module:

```text
src/lib/h3.ts
```

No application code should directly import `h3-js`.

Provide functions conceptually like:

```ts
getH3Cell(lat, lng, resolution)

getCellsByRing(cell, maxRing)

getH3Distance(cellA, cellB)

getCellBoundary(cell)

getCellsForPolygon(polygon)
```

For adaptive search:

```text
Ring 0
 ↓
cheap filters
 ↓
enough usable candidates?
 ↓ no
Ring 1
 ↓
cheap filters
 ↓
enough?
 ↓ no
Ring 2
 ↓
...
```

Important:

"enough candidates" must mean:

> enough potentially usable candidates after cheap filters,

not simply:

> enough raw drivers found.

Deduplicate by driver ID.

Record:

```text
discoveredRing
h3Distance
driverCell
pickupCell
```

for explainability.

---

# 5. Correct Google Maps Routing Architecture

The old plan may reference legacy Directions APIs.

Do NOT use deprecated legacy routing APIs if the current Google Maps JS platform provides a newer supported API.

Design:

```text
RoutingEngine
    │
    ├── GoogleRoutesEngine
    │       ├── Route.computeRoutes()
    │       └── RouteMatrix
    │
    └── MockRoutingEngine
```

Do not tightly couple the matching engine to Google Maps.

The matching engine should know only:

```ts
RoutingEngine
```

and not:

```ts
google.maps...
```

---

# 6. Use RouteMatrix for Bulk ETA Filtering

Stage 6 should be optimized.

After earlier filters, suppose:

```text
24 candidate drivers
```

We need:

```text
driver current location
        ↓
new passenger pickup
```

Use a matrix-style routing API when appropriate instead of making one expensive route call per driver.

Conceptually:

```text
D1 → pickup = 4 min
D2 → pickup = 7 min
D3 → pickup = 3 min
...
```

Then:

```text
maxWait = 6 minutes
```

filters the candidates.

The debug console must show:

```text
routing requests
route matrix elements
cache hits
cache misses
```

---

# 7. Use Full Route Calculation for Route Insertion

RouteMatrix must NOT replace full route calculation.

For route insertion we need:

```text
current driver location
+
existing stops
+
new pickup
+
new drop
```

Use the full route calculation for candidate insertion.

The engine must compare:

```text
Original Route
vs
Proposed Route
```

and calculate:

```text
original distance
new distance
additional distance
detour percentage
original duration
new duration
additional duration
new passenger pickup delay
existing passenger delays
```

---

# 8. Route Insertion Semantics

This is extremely important.

Existing passenger stops are already committed.

Do NOT arbitrarily reorder existing stops.

Given:

```text
Driver
 ↓
Pickup A
 ↓
Pickup B
 ↓
Drop A
 ↓
Drop B
```

a new passenger can be inserted around these stops:

```text
Driver
 ↓
Pickup A
 ↓
Pickup New
 ↓
Pickup B
 ↓
Drop A
 ↓
Drop New
 ↓
Drop B
```

but the algorithm should not optimize by freely rearranging existing passengers.

The problem being solved is:

> Can a new ride be inserted into the driver's existing route?

It is NOT:

> What is the globally optimal route for all passengers?

---

# 9. Route Insertion Algorithm

Create:

```text
src/matching/routeInsertion.ts
```

It should:

1. Read existing ordered stops.
2. Generate valid insertion positions for the new pickup.
3. Generate valid insertion positions for the new drop.
4. Require pickup before drop.
5. Preserve the relative ordering of all existing stops.
6. Generate only valid routes.
7. Apply cheap geographic pruning where safe.
8. Calculate candidate routes.
9. Calculate segment occupancy.
10. Calculate passenger delays.
11. Calculate detour.
12. Calculate additional duration.
13. Select the best feasible insertion.

Return a rich object:

```ts
interface RouteInsertionResult {
    feasible: boolean;

    insertedRoute?: Stop[];

    pickupIndex?: number;
    dropIndex?: number;

    originalDistance?: number;
    newDistance?: number;
    additionalDistance?: number;
    detourPercentage?: number;

    originalDuration?: number;
    newDuration?: number;
    additionalDuration?: number;

    newPassengerPickupDelay?: number;

    existingPassengerDelays?: PassengerDelay[];

    maximumExistingPassengerDelay?: number;

    occupancyBySegment?: SegmentOccupancy[];

    rejectionReason?: MatchReason;
}
```

---

# 10. Segment-Level Capacity Is Mandatory

Do not use only:

```text
vehicle.totalSeats - numberOfPassengers
```

for final capacity validation.

Example:

```text
6-seater

Route:

Pickup A
Pickup B
Drop A
Pickup C
Drop B
Drop C
```

Occupancy changes:

```text
Segment 1 → 1
Segment 2 → 2
Segment 3 → 1
Segment 4 → 2
Segment 5 → 1
```

A new passenger may be feasible depending on where their pickup/drop are inserted.

Therefore:

```text
Stage 4:
cheap global capacity pre-filter

Stage 5:
authoritative segment-level occupancy validation
```

Stage 5 must reject any proposed route where:

```text
occupancy > vehicle.totalSeats
```

---

# 11. Existing Passenger Delay Must Be Measured

This is mandatory for realistic pooling.

Example:

```text
Before:

Passenger A destination ETA = 20 min

After inserting Passenger B:

Passenger A destination ETA = 28 min
```

Then:

```text
existingPassengerDelay = 8 min
```

A route can have acceptable overall detour but unacceptable passenger delay.

Therefore settings should include:

```text
maxNewPassengerPickupDelay
maxExistingPassengerDelay
maxRouteDetourPercent
maxAdditionalDistance
maxAdditionalDuration
```

These values must be visible in the developer settings UI.

---

# 12. Separate Route Feasibility From Pooling Business Rules

Do not make these two stages redundant.

## Stage 5 — Route Feasibility

Answers:

> Can this passenger technically be inserted into the route?

Checks:

```text
pickup/drop ordering
segment capacity
route distance
route duration
detour
existing passenger delay
new passenger delay
```

## Stage 7 — Pooling Compatibility

Answers:

> Is this technically feasible route allowed according to our business rules?

Checks:

```text
pooling enabled
vehicle supports pooling
request allows pooling
maximum pooled passengers
maximum passenger delay
same-direction constraints if configured
business rules
```

This separation must be visible in the architecture and UI.

---

# 13. Improve Scoring

Do not combine raw metrics directly.

Normalize each scoring component to 0–100.

For example:

```text
etaScore
distanceScore
detourScore
routeQualityScore
fairnessScore
```

Then:

```text
finalScore =
    etaScore * etaWeight
  + distanceScore * distanceWeight
  + detourScore * detourWeight
  + routeQualityScore * routeWeight
  + fairnessScore * fairnessWeight
```

Weights should be configurable.

The UI should show:

```text
ETA contribution
Distance contribution
Detour contribution
Route contribution
Fairness contribution
Final score
```

---

# 14. Treat Fairness as Experimental

Do not pretend we have a production-grade fairness algorithm.

For this prototype:

```text
fairnessScore
```

may be derived from configurable mock driver history:

```text
timeSinceLastAssignment
ridesCompleted
idleTime
```

Clearly label it:

```text
Experimental
```

Do not allow fairness to influence the result invisibly.

---

# 15. Matching Evaluation Model

Do not mutate candidates directly in every stage.

Create a stable evaluation structure:

```ts
interface DriverEvaluation {
    driverId: string;

    stageResults: StageResult[];

    metrics: DriverMetrics;

    reasons: MatchReason[];

    finalScore?: number;

    finalStatus: "PASSED" | "FAILED";
}
```

Each stage appends its evaluation.

This enables:

```text
per-driver explanation
stage replay
rejection aggregation
debugging
scenario comparison later
```

---

# 16. Stage Result Structure

Each stage must record:

```ts
interface StageResult {
    stageId: string;
    stageName: string;

    status:
        | "PASSED"
        | "FAILED"
        | "NOT_EVALUATED";

    inputCount: number;
    outputCount: number;
    rejectedCount: number;

    durationMs: number;

    driverResults: DriverStageResult[];
}
```

Each driver result:

```ts
interface DriverStageResult {
    driverId: string;

    status:
        | "PASSED"
        | "FAILED"
        | "NOT_EVALUATED";

    reasons: MatchReason[];

    metrics?: Record<string, number | string | boolean>;
}
```

---

# 17. Do Not Silently Stop Without Explanation

If a driver fails at Stage 4:

```text
Stage 4:
FAILED
```

then:

```text
Stage 5:
NOT_EVALUATED
Stage 6:
NOT_EVALUATED
Stage 7:
NOT_EVALUATED
Stage 8:
NOT_EVALUATED
```

Do not mark them as failed at every subsequent stage.

The UI must distinguish:

```text
FAILED
```

from:

```text
NOT_EVALUATED
```

---

# 18. Routing Fallback Must Be Explicit

If Google routing is unavailable:

```text
MOCK ROUTING
```

must be clearly visible.

Do not silently fallback.

Show:

```text
Routing Engine: MOCK

Warning:
Route distances and ETAs are simulated.
```

The debug console should contain:

```text
routingEngine
googleCalls
matrixElements
cacheHits
cacheMisses
fallbackReason
```

---

# 19. Routing Cache

Implement a deterministic cache.

Cache key should include all parameters that affect routing, not merely coordinates.

For example:

```text
origin
destination
waypoints
travelMode
routing options
traffic options
```

Use rounded coordinates only if the precision loss is intentional and documented.

Expose:

```text
cache hit
cache miss
```

in debugging.

---

# 20. Scenario Snapshot

Add a concept:

```ts
interface MatchingRun {
    id: string;
    createdAt: string;

    scenarioSnapshot: Scenario;
    requestSnapshot: RideRequest;
    settingsSnapshot: MatchingSettings;

    result: MatchingResult;

    routingEngine: "GOOGLE" | "MOCK";

    durationMs: number;
}
```

Every time "Run Matching" is clicked, create a run snapshot.

This allows us to reproduce algorithm behavior later.

---

# 21. Minimal Automated Tests

Do NOT defer all testing.

Before building the complete UI, implement a small deterministic test suite.

At minimum test:

### H3

```text
lat/lng → cell
ring expansion
deduplication
ring attribution
```

### Capacity

```text
enough seats
not enough seats
segment overflow
```

### Route ordering

```text
pickup before drop
existing ordering preserved
invalid insertion rejected
```

### Detour

```text
10 km → 11 km = 10%
```

### Passenger delay

```text
20 min → 28 min = 8 min
```

### Stage rejection

```text
capacity failure
```

### Full matching

Create at least one deterministic scenario with:

```text
pass
capacity fail
vehicle fail
offline fail
ETA fail
route detour fail
```

Do not proceed to UI integration until these pass.

---

# 22. Google Maps API Architecture

The map UI should use:

```text
@vis.gl/react-google-maps
```

and modern Google Maps APIs.

Use:

```text
APIProvider
Map
AdvancedMarker
```

where appropriate.

Use a Map ID for Advanced Markers.

Location search should use the current Places API / Places Library rather than legacy Places APIs.

Routing should use the current Routes APIs.

Avoid legacy Google Maps services unless there is a documented reason.

---

# 23. Separate Map State From Matching State

Do not make map state part of the matching engine.

Map state:

```text
selectedDriver
selectedPassenger
selectedStop
mapMode
center
zoom
showH3
showRoutes
```

Matching state:

```text
currentRun
driverEvaluations
stageResults
replayStage
selectedResult
```

Scenario state:

```text
drivers
vehicles
passengers
rides
requests
```

Settings state:

```text
H3
filters
routing
scoring
pooling
```

Keep these separate.

---

# 24. Map Interaction Requirements

The map must support:

```text
Normal

Add Driver Location

Add Pickup

Add Drop

Add Stop

Inspect H3
```

Clicking the map in a mode should perform exactly one predictable operation.

For example:

```text
ADD DRIVER LOCATION
↓
click map
↓
new marker
↓
coordinates saved
```

Dragging the marker should update coordinates.

Do not accidentally trigger scenario changes while simply inspecting the map.

---

# 25. Route Builder Requirements

The route builder must behave like a real route editor.

Support:

```text
Add stop
Delete stop
Edit stop
Drag reorder
Change pickup/drop
Assign passenger
Select location on map
Search location
```

Validate:

```text
pickup before drop
```

for every passenger.

Existing route ordering must be preserved during new-ride insertion.

---

# 26. Map Visualization During Matching

When a driver is selected:

Show:

```text
driver location
original route
best attempted insertion
new pickup
new drop
existing passengers
stop numbers
```

For accepted:

```text
ORIGINAL ROUTE
PROPOSED ROUTE
```

For rejected:

```text
ORIGINAL ROUTE
BEST ATTEMPT
REJECTION METRIC
THRESHOLD
```

Example:

```text
Detour:
24.1%

Maximum:
15%

FAIL
```

---

# 27. Stage Replay

Stage replay is a core feature.

Example:

```text
All drivers
 ↓
H3 candidates
 ↓
Online
 ↓
Vehicle compatible
 ↓
Capacity compatible
 ↓
Route compatible
 ↓
ETA compatible
 ↓
Pooling compatible
 ↓
Scored
```

When the user selects a stage:

```text
Stage 4
```

the map should show exactly the drivers that survived through Stage 4.

Do not recalculate the matching engine merely to replay.

Use stored stage results.

---

# 28. Rejection Analytics

Aggregate rejection reasons.

Example:

```text
Capacity                  8
Offline                   4
Vehicle mismatch          3
H3 outside search         2
ETA too high              5
Route detour              4
Pooling incompatible      2
```

Clicking a reason should show:

```text
affected drivers
their metrics
their thresholds
```

This is essential for algorithm tuning.

---

# 29. Random Scenario Generator

Keep random generation deterministic when a seed is supplied.

Support:

```text
seed
driver count
passenger count
existing ride count
vehicle distribution
density
geographic area
pooling percentage
```

Example:

```text
seed = 12345

drivers = 100
rides = 30
passengers = 70
```

Running the same seed should produce the same scenario.

This is important for debugging.

---

# 30. Scenario Presets

Presets should be deterministic.

Include:

```text
Simple Single Ride

Busy Delhi

Airport Pooling

Multiple Passengers

Vehicle Capacity Test

Route Detour Test

Sparse Driver Area

Dense Driver Area

No Driver Available

Mixed Vehicle Fleet

Large Pooling Scenario
```

Every preset should intentionally test a specific algorithm behavior.

Document what each preset is testing.

---

# 31. Performance

The simulator should support approximately:

```text
500 drivers
200 active rides
1000 route stops
```

without the UI becoming unusable.

Optimize:

```text
React renders
map markers
H3 polygons
matching calculations
route cache
```

Do not optimize prematurely, but don't build an O(N × huge route search) implementation without safeguards.

---

# 32. Important Routing Safety

The matching engine must not accidentally make hundreds of Google route calls during insertion enumeration.

Before routing:

```text
cheap geographic pruning
```

After routing:

```text
cache result
```

Expose:

```text
number of insertion candidates
number pruned before routing
number routed
number cached
```

Example:

```text
Driver D014

Insertion possibilities:
36

Geographic pre-filter:
36 → 14

Routing calls:
14

Cache hits:
5

Feasible:
3

Best:
Insertion #7
```

This is extremely useful for future optimization.

---

# 33. Make Limits Configurable

Add developer settings:

```text
H3 resolution

Minimum candidates

Maximum H3 ring

Maximum pickup ETA

Maximum route detour %

Maximum additional distance

Maximum additional duration

Maximum existing passenger delay

Maximum new passenger pickup delay

Maximum pooled passengers

Scoring weights

Routing mode
```

All values should be visible in the matching run snapshot.

---

# 34. Correct "No Backend" Scope

The prototype must perform matching locally in the browser.

But external Google APIs are allowed for:

```text
Map rendering
Places search
Road routing
Route matrix
```

No:

```text
PostgreSQL
Redis
Prisma
Node matching service
Kafka
```

for this prototype.

However, keep interfaces so the matching engine can later move to a backend.

---

# 35. Future Backend Boundary

The browser should conceptually call:

```ts
MatchingService.findMatches(...)
```

today implemented as:

```text
LocalMatchingService
```

Later:

```text
ApiMatchingService
```

can call:

```text
POST /matching/preview
```

without rewriting React components.

---

# 36. Final Required Architecture

The improved plan should result in something conceptually like:

```text
                    React UI
                       │
                Zustand State
                       │
                       ▼
               MatchingService
                       │
                       ▼
             Pure TS Matching Engine
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
      H3          Route Insertion     Scoring
       │               │
       │               ▼
       │         RoutingEngine
       │               │
       │        ┌──────┴──────┐
       │        ▼             ▼
       │   Google Routes    Mock
       │   + RouteMatrix
       │
       ▼
 Candidate Generation
       ↓
 Status
       ↓
 Vehicle
       ↓
 Capacity Pre-filter
       ↓
 Route Feasibility
       ↓
 Pickup ETA
       ↓
 Pooling Rules
       ↓
 Scoring
       ↓
 Explainable Results
```

---

# 37. Implementation Order

Do NOT build everything simultaneously.

Use this order:

## Phase 1 — Domain + engine

Build:

```text
types
H3 wrapper
matching types
reasons
settings
stage interfaces
engine
```

No UI yet.

## Phase 2 — Mock routing

Build:

```text
MockRoutingEngine
route insertion
segment occupancy
passenger delay
detour
```

## Phase 3 — Deterministic tests

Verify the matching engine.

## Phase 4 — Scenario state

Build:

```text
Zustand stores
scenario serialization
presets
random generator
```

## Phase 5 — Map

Build:

```text
Google Map
markers
routes
H3 overlay
map modes
```

## Phase 6 — Scenario builder

Build:

```text
driver
vehicle
passenger
ride
request
route builder
```

## Phase 7 — Results/debugger

Build:

```text
stage pipeline
driver details
rejection analytics
debug console
stage replay
```

## Phase 8 — Google routing

Add:

```text
GoogleRoutesEngine
Route.computeRoutes
RouteMatrix
cache
fallback
```

## Phase 9 — Integration verification

Run:

```text
typecheck
lint
unit tests
build
dev server
```

Then manually test the complete scenario workflow.

---

# 38. What You Must Return Before Coding

Before writing implementation code, produce an updated implementation plan containing:

1. Final architecture.
2. Corrected dependency list.
3. Corrected Google Maps API strategy.
4. H3 strategy.
5. Matching stage definitions.
6. Domain model.
7. Route insertion algorithm.
8. Segment capacity algorithm.
9. Passenger delay algorithm.
10. Routing/cache strategy.
11. Explainability model.
12. Zustand store boundaries.
13. Component hierarchy.
14. File structure.
15. Testing strategy.
16. Scenario/preset strategy.
17. Performance considerations.
18. Migration path to backend.
19. Risks and tradeoffs.
20. Exact implementation order.

For every change from the existing plan, explicitly state:

```text
CURRENT PLAN
→ PROPOSED CHANGE
→ WHY
→ IMPACT
```

Do not make silent changes.

---

# 39. Final Quality Bar

Before considering the plan complete, answer these questions explicitly:

### H3

```text
How are candidates discovered?
How are rings expanded?
How is deduplication handled?
How is H3 distance represented?
```

### Routing

```text
When is RouteMatrix used?
When is full Route calculation used?
How many routing calls can a scenario generate?
How does caching work?
What happens when Google routing fails?
```

### Capacity

```text
How is global capacity filtered?
How is segment occupancy calculated?
How does pickup/drop position affect capacity?
```

### Pooling

```text
How are existing passenger delays calculated?
How is new passenger delay calculated?
How is detour calculated?
What makes pooling technically feasible?
What makes it business-rule compatible?
```

### Ranking

```text
How are metrics normalized?
How are weights applied?
How is fairness represented?
```

### Explainability

```text
Can we answer why every driver failed?
Can we see the exact threshold?
Can we see the calculated value?
Can we replay each stage?
```

### Reproducibility

```text
Can we export a scenario?
Can we reproduce the same random scenario with a seed?
Can we save a complete matching run?
```

If any answer is vague, improve the architecture before coding.

---

# 40. Final instruction

Do not start implementation until the audit is complete.

First return:

```text
ARCHITECTURE AUDIT
PROBLEMS FOUND
RECOMMENDED CHANGES
FINAL ARCHITECTURE
FINAL STAGE PIPELINE
FINAL DATA MODEL
FINAL FILE STRUCTURE
IMPLEMENTATION ORDER
RISKS
```

Then wait for approval before writing code.

The goal is not maximum code.

The goal is a **correct, explainable, experimentally useful ride-matching simulator** that we can use to test our actual pooling/matching algorithm and later move the pure matching engine into a production backend.


---

**Cursor**

This is a substantial audit. Let me verify the repo facts and, critically, the current state of Google's Routes API in the Maps JavaScript SDK, since the user explicitly flagged legacy-API risk.

The Routes library in the JS SDK is confirmed. Now let me check whether a route matrix exists there, and verify the Places and marker APIs.

Important finding: the JS Routes library has `computeRoutes` but no route matrix. Let me verify whether the REST matrix is callable from a browser, plus the current Places and React wrapper state.

Two more checks: the current Places autocomplete API and the h3-js v4 ring functions.

I have what I need. The most consequential finding: the current plan's routing approach targets APIs Google moved to Legacy status on March 1, 2025, which are **not available in new Cloud projects** — it would fail outright on a fresh API key. Let me rewrite the plan with the full audit.

I audited the plan against the repo and against Google's current API surface, and rewrote it. Twenty numbered changes are in the plan, each with CURRENT → PROPOSED → WHY → IMPACT. Here are the ones that actually matter.

**The plan had a blocking bug.** It specified routing via "Directions in the Maps JS SDK" — that's `google.maps.DirectionsService`, which Google moved to Legacy status on 2025-03-01. Legacy services are *not available in new Cloud projects*, and `DistanceMatrixService` carries a hard deprecation notice dated 2026-02-25. On a fresh API key the old plan would have failed immediately. The corrected plan uses `google.maps.routes.Route.computeRoutes` and `RouteMatrix.computeRouteMatrix`. The same Legacy transition hits the Places service, so location search moves to `AutocompleteSuggestion.fetchAutocompleteSuggestions`. This changes which APIs you enable: Routes API and Places API (New), with the legacy ones left disabled.

**Three algorithmic correctness problems.** First, the old insertion enumeration talked about "discarding orderings that break pickup-before-drop", which implies existing stops were being reordered — those are committed promises to real riders. Freezing existing order makes reordering impossible by construction and bounds the candidate count to `(n+1)(n+2)/2`. Second, the segment occupancy walk started at zero, which under-counts every vehicle carrying passengers who are already onboard and have no pickup stop left in the route; it now seeds from `PICKED_UP`/`IN_RIDE` seats. Third, existing-passenger delay was never modelled, and it's the one constraint aggregate detour structurally cannot detect — a route can be 8% longer overall while making one existing rider 15 minutes late. That now comes from per-leg cumulative durations, which is why the Routes field mask must request `legs` and why every stop must be a non-`via` waypoint.

**One deliberate deviation from your brief.** Your pipeline puts route feasibility before pickup ETA. That's backwards on cost: one matrix call typically halves the candidate set, and a driver 40 minutes away should never trigger insertion enumeration. I've defaulted to ETA-first but made stage order a data value in `pipeline.ts`, so you can flip it and compare rather than edit code. Flag it if you'd rather keep the declared order as the default.

**Testing moved ahead of the UI**, per your §21. Detour percentages and occupancy timelines are invisible-when-wrong arithmetic; debugging them through a map is expensive. Phase 3 is a gate — Phase 5 doesn't start until it's green.

Two smaller repo findings worth knowing. The root `turbo.json` declares `build.outputs` as `.next/**` only, so a Vite `dist/**` would never cache — solved with a package-level `turbo.json` inside `apps/simulation`, which keeps the change inside the new app as you required. And the shared base tsconfig sets `noUncheckedIndexedAccess: true`, which will add real friction to the array-heavy insertion code; I'm accepting that rather than disabling it locally, but it's a known tax.

I also made the previously-silent Turf.js omission explicit: dropped, because the only geometry needed is haversine, bearing, and bounding boxes.

The plan is in [ride_matching_simulator_app_b4c224b7.plan.md](c:\Users\sameerkrdev\.cursor\plans\ride_matching_simulator_app_b4c224b7.plan.md). No code written. Approve it and I'll start at Phase 1.

---

**User**

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

---

**Cursor**

I'll implement the audited plan in order, starting with the Phase 1 scaffold. First I need the current todos and the full plan.

---

**User**

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

---

**Cursor**

I have the full picture. Starting Phase 1a — scaffolding the app. Let me first pin down current dependency versions.

npm is blocked by the repo's `devEngines` gate. Using bun instead.

Versions confirmed. Now writing the Phase 1a scaffold.

Now installing dependencies so I can typecheck as I go.

Scaffold is green. Phase 1b — the domain model.

Phase 1c — the isolated H3, geo, and RNG libraries.

Phase 1d — engine core. First the routing interface that the engine types depend on.

Phase 1 is green. Phase 2a — mock routing with cache, telemetry, and the budget guard.

Phase 2b — occupancy, delays, and the insertion engine.

Now the route insertion engine — the core algorithm.

Phase 2c — the nine stages. First a small adjustment so budget-exhausted drivers can be reported as `NOT_EVALUATED` rather than algorithmically rejected.

Engine already handles that correctly. Now the stage helper and the nine stages.

All nine stages compile. Phase 3 — the deterministic test suite that gates UI work.

Two genuine findings. The pipeline bug is real: a request rejected at stage 0 still ranked every driver as passed. The insertion "failure" is actually correct behaviour — dropping the existing rider first *does* make room, which is exactly the point of segment occupancy — so my test premise was wrong.

Phase 3 gate cleared — 64 tests green. Phase 4 — state, service seam, scenarios.

Now the eleven documented presets.

Let me remove those non-null assertions — typing the fleet as a literal makes them unnecessary.

Now the five Zustand stores with strict boundaries.

---

**User**

continue

---

**Cursor**

Stores are in. Let me typecheck, then add the run hook that wires the stores to the service.

A `useRunMatching.ts` exists that I didn't write. Let me check it.

The hook references the Phase 8 factory, so I'll build the Google adapter now. Let me get the RouteMatrix response shape exactly right first.

Exact shapes confirmed. Writing the Google adapter.

Phase 4 complete. Phase 5 — the map. First the shadcn primitives the UI needs.

Now the map layer.

Now the MapView that ties the modes, markers, and overlays together.

Phase 5 done. Phase 6 — the scenario builder sidebar.

Phase 6 done. Phase 7 — the explainability UI.

Now the results panel, routing banner, and the app shell that assembles everything.

Phase 7 and 8 complete. Phase 9 — README, then full verification.

All green. Final step — a dev server smoke check and verifying turbo integration from the repo root.

Now verifying the app integrates with the monorepo's turbo tasks and that no other workspace was affected.

Only `bun.lock` and the new app directory changed — no other workspace touched. Let me confirm the package-level turbo config makes the build cacheable.

All nine phases are done and verified. The Ride Matching Lab is at `apps/simulation`, running on port 3100, with lint clean, 64 tests passing, typecheck clean, and a production build that turbo caches correctly.

**Verification results**

| Check | Result |
|---|---|
| `bun run lint` | clean, zero warnings |
| `bun run test` | 64 passed across 8 files |
| `bun run check-types` | clean |
| `bun run build` | built in 2.6s |
| Dev server | HTTP 200 at `localhost:3100` |
| `git status` | only `bun.lock` and `apps/simulation/` |

The turbo package config worked as the audit predicted — a second `turbo build` reported `FULL TURBO` from cache, which the root config's `.next/**`-only outputs would never have allowed for a Vite app.

**Two things the tests caught that I'd otherwise have shipped.** The first was a real bug: when stage 0 rejected a request, no driver was ever evaluated, but they all stayed marked alive in the ledger and got ranked as passing matches. The fix threads a `forceFailed` flag into `finalize()`. The second wasn't a bug at all — my insertion test asserted that a full vehicle with one pending drop had no valid placement, and the engine correctly found one *after* that drop. That is precisely the behaviour segment-level occupancy exists to produce, so I rewrote the test to assert it and added a companion case for genuinely impossible capacity.

**On Phase 8 running early.** A `useRunMatching.ts` hook was already present in the tree importing `@/routing/googleEngineFactory`, which didn't exist yet and broke the typecheck. Rather than stub it, I built the real Google adapter at that point. I fetched the RouteMatrix reference first to get the response shape right — it's `{ matrix: { rows: [{ items: [...] }] } }` with `distanceMeters`, `durationMillis`, and a `condition` of `ROUTE_EXISTS` or `ROUTE_NOT_FOUND`, which the adapter maps onto the `reachable` flag so an unreachable pickup becomes a proper `PICKUP_UNREACHABLE` rejection instead of an exception.

**Deviations worth flagging.** I skipped `tsconfig.node.json` and used a single tsconfig, because the two-file split exists to support `tsc -b` project references and `tsc --noEmit` is simpler and does the same job here. `MatchingService.findMatches` returns a `MatchingRun` rather than a bare `MatchingResult` — the run snapshot needs the routing engine identity and fallback reason, which only the service knows, and an `ApiMatchingService` can return the same shape. I also added two small modules the plan's file list didn't name: `matching/stops.ts` for stop conversion and ordering validation, and `scenarios/builders.ts` for preset helpers.

**One caveat.** The bundle is 780 KB (239 KB gzipped), mostly `h3-js`. Fine for an internal tool, but worth code-splitting if this ever gets shared widely.

Without a Google Maps key the app still runs end to end: the map shows a setup notice, the engine falls back to mock routing, and the `ROUTING ENGINE: MOCK` banner stays visible for the whole run so no one mistakes synthetic distances for real ones.

