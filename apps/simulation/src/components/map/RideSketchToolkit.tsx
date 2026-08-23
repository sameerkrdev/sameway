import {
  Check,
  CircleDot,
  Eraser,
  History,
  MapPin,
  Navigation,
  Plus,
  Route as RouteIcon,
  Trash2,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildMultiRideSketchCommit,
  sketchVehicleOptions,
  validateMultiRideSketch,
} from "@/lib/rideSketch";
import { cn } from "@/lib/utils";
import { DRIVER_STATUSES } from "@/domain/entities";
import { useMatchingStore } from "@/stores/matchingStore";
import { useMapStore } from "@/stores/mapStore";
import { useRideSketchStore, type SketchTool } from "@/stores/rideSketchStore";
import { useScenarioStore } from "@/stores/scenarioStore";

const TOOLS: { id: SketchTool; label: string; hint: string; icon: typeof Navigation }[] = [
  { id: "PLACE_VEHICLE", label: "Vehicle", hint: "Where the car is right now", icon: Navigation },
  {
    id: "DRAW_COVERED",
    label: "Covered",
    hint: "Click trail already driven (behind the vehicle)",
    icon: History,
  },
  {
    id: "DRAW_PATH",
    label: "Remaining",
    hint: "Click remaining route waypoints (ahead of the vehicle)",
    icon: RouteIcon,
  },
  { id: "PLACE_STOP", label: "Stop", hint: "Remaining PICKUP/DROP — onboard riders need DROP only", icon: MapPin },
  {
    id: "PLACE_REQUEST_PICKUP",
    label: "Req pick",
    hint: "New matching request pickup (shared across rides)",
    icon: CircleDot,
  },
  {
    id: "PLACE_REQUEST_DROP",
    label: "Req drop",
    hint: "New matching request drop",
    icon: CircleDot,
  },
];

export function RideSketchToolkit() {
  const scenario = useScenarioStore((state) => state.scenario);
  const upsertDriver = useScenarioStore((state) => state.upsertDriver);
  const upsertVehicle = useScenarioStore((state) => state.upsertVehicle);
  const upsertPassenger = useScenarioStore((state) => state.upsertPassenger);
  const upsertRide = useScenarioStore((state) => state.upsertRide);
  const upsertRequest = useScenarioStore((state) => state.upsertRequest);
  const selectDriver = useMatchingStore((state) => state.selectDriver);
  const resetMode = useMapStore((state) => state.resetMode);

  const slots = useRideSketchStore((state) => state.slots);
  const activeIndex = useRideSketchStore((state) => state.activeIndex);
  const pendingPassengers = useRideSketchStore((state) => state.pendingPassengers);
  const tool = useRideSketchStore((state) => state.tool);
  const selectedPassengerId = useRideSketchStore((state) => state.selectedPassengerId);
  const selectedStopType = useRideSketchStore((state) => state.selectedStopType);
  const requestPickup = useRideSketchStore((state) => state.requestPickup);
  const requestDrop = useRideSketchStore((state) => state.requestDrop);
  const requestPassengerId = useRideSketchStore((state) => state.requestPassengerId);

  const addRideSlot = useRideSketchStore((state) => state.addRideSlot);
  const removeRideSlot = useRideSketchStore((state) => state.removeRideSlot);
  const setActiveSlot = useRideSketchStore((state) => state.setActiveSlot);
  const beginNewDriver = useRideSketchStore((state) => state.beginNewDriver);
  const selectExistingDriver = useRideSketchStore((state) => state.selectExistingDriver);
  const loadFromRide = useRideSketchStore((state) => state.loadFromRide);
  const setDriverConfig = useRideSketchStore((state) => state.setDriverConfig);
  const setTool = useRideSketchStore((state) => state.setTool);
  const setSelectedPassenger = useRideSketchStore((state) => state.setSelectedPassenger);
  const setSelectedStopType = useRideSketchStore((state) => state.setSelectedStopType);
  const addPassenger = useRideSketchStore((state) => state.addPassenger);
  const undoCoveredWaypoint = useRideSketchStore((state) => state.undoCoveredWaypoint);
  const undoPathWaypoint = useRideSketchStore((state) => state.undoPathWaypoint);
  const clearCovered = useRideSketchStore((state) => state.clearCovered);
  const clearPath = useRideSketchStore((state) => state.clearPath);
  const clearRequest = useRideSketchStore((state) => state.clearRequest);
  const setRequestPassenger = useRideSketchStore((state) => state.setRequestPassenger);
  const removeStop = useRideSketchStore((state) => state.removeStop);
  const discard = useRideSketchStore((state) => state.discard);

  const [applyError, setApplyError] = useState<string | null>(null);

  const active = slots[activeIndex];
  const passengers = useMemo(() => {
    const pendingIds = new Set(pendingPassengers.map((passenger) => passenger.id));
    return [
      ...pendingPassengers,
      ...scenario.passengers.filter((passenger) => !pendingIds.has(passenger.id)),
    ];
  }, [pendingPassengers, scenario.passengers]);

  const activeTool = TOOLS.find((entry) => entry.id === tool);
  const validation = validateMultiRideSketch(slots, {
    requestPickup,
    requestDrop,
    requestPassengerId,
  });

  function applyAll() {
    const state = useRideSketchStore.getState();
    const commit = buildMultiRideSketchCommit(
      state.slots,
      {
        requestPickup: state.requestPickup,
        requestDrop: state.requestDrop,
        requestPassengerId: state.requestPassengerId,
      },
      state.pendingPassengers,
      scenario,
    );
    if ("error" in commit) {
      setApplyError(commit.error);
      return;
    }

    const createdVehicleIds = new Set<string>();
    for (const rideCommit of commit.rides) {
      if (rideCommit.vehicleToCreate && !createdVehicleIds.has(rideCommit.vehicleToCreate.id)) {
        upsertVehicle(rideCommit.vehicleToCreate);
        createdVehicleIds.add(rideCommit.vehicleToCreate.id);
      }
      upsertDriver(rideCommit.driver);
      if (rideCommit.ride) {
        upsertRide(rideCommit.ride);
      }
    }
    for (const passenger of commit.sharedPassengers) {
      upsertPassenger(passenger);
    }
    if (commit.request) {
      upsertRequest(commit.request);
    }

    const firstDriver = commit.rides[0]?.driver.id;
    if (firstDriver) {
      selectDriver(firstDriver);
    }
    setApplyError(null);
    discard();
    resetMode();
  }

  if (!active) {
    return null;
  }

  return (
    <div className="absolute top-14 left-3 z-20 flex w-[22rem] max-h-[calc(100%-5rem)] flex-col gap-2 overflow-auto rounded-md border border-sky-500/40 bg-[var(--card)]/95 p-2.5 text-xs shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Multi-ride sketch</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Sketch several live rides, add one new request, Apply, then Run matching.
          </p>
        </div>
        <Button size="iconSm" variant="ghost" aria-label="Close sketch" onClick={() => resetMode()}>
          <X />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {slots.map((slot, index) => (
          <Button
            key={slot.slotId}
            size="xs"
            variant={index === activeIndex ? "default" : "outline"}
            onClick={() => setActiveSlot(index)}
          >
            {slot.label}
            {slot.vehicleLocation ? "" : " ·"}
          </Button>
        ))}
        <Button size="xs" variant="outline" onClick={() => addRideSlot(scenario)} title="Add another driver">
          <Plus className="size-3" /> Driver
        </Button>
        {slots.length > 1 ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => removeRideSlot(active.slotId)}
            title="Remove active ride"
          >
            <Trash2 className="size-3" />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-[var(--muted-foreground)]">
          Driver for {active.label}
        </label>
        <div className="flex gap-1">
          <select
            className="h-8 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
            value={active.isNewDriver ? "__new__" : (active.driverId ?? "")}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__new__") {
                beginNewDriver(scenario);
                return;
              }
              if (value) {
                selectExistingDriver(scenario, value);
              }
            }}
          >
            <option value="">Select…</option>
            <option value="__new__">+ Create new driver</option>
            {scenario.drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.id} · {driver.status}
              </option>
            ))}
          </select>
          <Button
            size="xs"
            variant="outline"
            disabled={!active.driverId || active.isNewDriver}
            onClick={() => {
              if (active.driverId) {
                loadFromRide(scenario, active.driverId);
              }
            }}
          >
            Load
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-md border border-[var(--border)] p-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-[var(--muted-foreground)]">Name</span>
            <input
              className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-xs"
              value={active.driverName}
              placeholder="Auto from id"
              onChange={(event) => setDriverConfig({ driverName: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-[var(--muted-foreground)]">Status</span>
            <select
              className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-xs"
              value={active.driverStatus}
              onChange={(event) =>
                setDriverConfig({ driverStatus: event.target.value as (typeof DRIVER_STATUSES)[number] })
              }
            >
              {DRIVER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-0.5">
            <span className="text-[10px] text-[var(--muted-foreground)]">Vehicle type</span>
            <select
              className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-xs"
              value={active.vehicleId}
              onChange={(event) => setDriverConfig({ vehicleId: event.target.value })}
            >
              {sketchVehicleOptions(scenario).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label} · {vehicle.totalSeats} seats
                  {vehicle.poolingEnabled ? "" : " · no pool"}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1.5">
            <span>
              <span className="block text-[11px] font-medium">Has active ride</span>
              <span className="text-[10px] text-[var(--muted-foreground)]">
                Off = idle (location only). On = draw path + stops. Keep status ONLINE to stay
                poolable; BUSY excludes them from matching.
              </span>
            </span>
            <input
              type="checkbox"
              className="size-4"
              checked={active.hasActiveRide}
              onChange={(event) => setDriverConfig({ hasActiveRide: event.target.checked })}
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1">
        {TOOLS.map((entry) => {
          const Icon = entry.icon;
          const rideOnly =
            entry.id === "DRAW_COVERED" || entry.id === "DRAW_PATH" || entry.id === "PLACE_STOP";
          const disabled = rideOnly && !active.hasActiveRide;
          return (
            <Button
              key={entry.id}
              size="xs"
              variant={tool === entry.id ? "default" : "outline"}
              className="flex h-auto flex-col gap-0.5 px-1 py-1.5"
              onClick={() => setTool(entry.id)}
              title={disabled ? "Turn on “Has active ride” first" : entry.hint}
              disabled={disabled}
            >
              <Icon className="size-3.5" />
              <span className="text-[10px] leading-none">{entry.label}</span>
            </Button>
          );
        })}
      </div>

      {active.hasActiveRide ? (
        <>
          {activeTool ? (
            <p className="rounded border border-[var(--border)] bg-[var(--secondary)]/60 px-2 py-1 text-[11px] text-[var(--muted-foreground)]">
              {activeTool.hint}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">Vehicle {active.vehicleLocation ? "set" : "—"}</Badge>
            <Badge variant="outline">{active.coveredPath.length} covered</Badge>
            <Badge variant="outline">{active.pathWaypoints.length} remain</Badge>
            <Badge variant="outline">{active.stops.length} stops</Badge>
          </div>

          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" onClick={undoCoveredWaypoint}>
              <Undo2 className="size-3" /> Covered
            </Button>
            <Button size="xs" variant="outline" onClick={clearCovered}>
              <Eraser className="size-3" /> Covered
            </Button>
            <Button size="xs" variant="outline" onClick={undoPathWaypoint}>
              <Undo2 className="size-3" /> Remain
            </Button>
            <Button size="xs" variant="outline" onClick={clearPath}>
              <Eraser className="size-3" /> Remain
            </Button>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
                Remaining stops
              </span>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant={selectedStopType === "PICKUP" ? "default" : "outline"}
                  onClick={() => {
                    setSelectedStopType("PICKUP");
                    setTool("PLACE_STOP");
                  }}
                >
                  Pickup
                </Button>
                <Button
                  size="xs"
                  variant={selectedStopType === "DROP" ? "default" : "outline"}
                  onClick={() => {
                    setSelectedStopType("DROP");
                    setTool("PLACE_STOP");
                  }}
                >
                  Drop
                </Button>
              </div>
            </div>

            <div className="flex gap-1">
              <select
                className="h-8 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
                value={selectedPassengerId ?? ""}
                onChange={(event) => {
                  setSelectedPassenger(event.target.value || null);
                  setTool("PLACE_STOP");
                }}
              >
                <option value="">Passenger…</option>
                {passengers.map((passenger) => (
                  <option key={passenger.id} value={passenger.id}>
                    {passenger.id}
                    {pendingPassengers.some((entry) => entry.id === passenger.id) ? " (new)" : ""}
                  </option>
                ))}
              </select>
              <Button
                size="xs"
                variant="outline"
                onClick={() => addPassenger(scenario)}
                title="Add passenger"
              >
                <UserPlus className="size-3.5" />
              </Button>
            </div>

            <p className="text-[10px] text-[var(--muted-foreground)]">
              Onboard rider: DROP only (no PICKUP) → saved as IN_RIDE. Waiting rider: PICKUP + DROP.
            </p>

            {active.stops.length === 0 ? (
              <p className="text-[11px] text-[var(--muted-foreground)]">No remaining stops yet.</p>
            ) : (
              <ul className="max-h-24 space-y-1 overflow-auto">
                {active.stops.map((stop, index) => (
                  <li
                    key={stop.id}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-1.5 py-1"
                  >
                    <span
                      className={cn(
                        stop.type === "PICKUP" ? "text-[var(--pass)]" : "text-[var(--fail)]",
                      )}
                    >
                      {index + 1}. {stop.type} · {stop.passengerId}
                    </span>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      aria-label="Remove stop"
                      onClick={() => removeStop(stop.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="rounded border border-[var(--border)] bg-[var(--secondary)]/60 px-2 py-1.5 text-[11px] text-[var(--muted-foreground)]">
          Idle driver — place Vehicle on the map. Enable Has active ride to draw path and stops.
        </p>
      )}

      <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2">
        <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
          New request (for matching)
        </span>
        <select
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
          value={requestPassengerId ?? ""}
          onChange={(event) => setRequestPassenger(event.target.value || null)}
        >
          <option value="">Request passenger…</option>
          {passengers.map((passenger) => (
            <option key={passenger.id} value={passenger.id}>
              {passenger.id}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Pickup {requestPickup ? "✓" : "—"} · Drop {requestDrop ? "✓" : "—"}
          </p>
          <Button size="xs" variant="ghost" onClick={clearRequest}>
            Clear req
          </Button>
        </div>
      </div>

      {applyError || validation ? (
        <p className="text-[11px] text-[var(--fail)]">{applyError ?? validation}</p>
      ) : (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {slots.length} ride{slots.length === 1 ? "" : "s"} ready · then Run matching to see winners.
        </p>
      )}

      <div className="flex gap-1 border-t border-[var(--border)] pt-2">
        <Button size="sm" className="flex-1" onClick={applyAll} disabled={Boolean(validation)}>
          <Check className="size-3.5" /> Apply all + request
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            discard();
            setApplyError(null);
          }}
        >
          <Trash2 className="size-3.5" /> Discard
        </Button>
      </div>
    </div>
  );
}
