import { Focus, MapPinned, PencilRuler, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Driver, Passenger, Ride, RideRequest, Vehicle } from "@/domain/entities";
import { formatCoordinate } from "@/lib/format";
import { useMatchingStore } from "@/stores/matchingStore";
import { useMapStore } from "@/stores/mapStore";
import { useRideSketchStore } from "@/stores/rideSketchStore";
import { useScenarioStore } from "@/stores/scenarioStore";

function openSketchForDriver(driverId: string) {
  const scenario = useScenarioStore.getState().scenario;
  useRideSketchStore.getState().selectExistingDriver(scenario, driverId);
  useMapStore.getState().setMode("RIDE_SKETCH");
}

function focusPoints(points: { lat: number; lng: number }[]) {
  useMapStore.getState().focusOn(points);
}

export function DriversInventory() {
  const scenario = useScenarioStore((state) => state.scenario);
  const removeDriver = useScenarioStore((state) => state.removeDriver);
  const selectDriver = useMatchingStore((state) => state.selectDriver);
  const selectedDriverId = useMatchingStore((state) => state.selectedDriverId);
  const vehiclesById = new Map(scenario.vehicles.map((vehicle) => [vehicle.id, vehicle]));

  if (scenario.drivers.length === 0) {
    return (
      <EmptyState message="No drivers. Open Ride sketch on the map to create one, or load a preset." />
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {scenario.drivers.map((driver) => (
        <DriverRow
          key={driver.id}
          driver={driver}
          vehicle={vehiclesById.get(driver.vehicleId)}
          selected={driver.id === selectedDriverId}
          onSelect={() => {
            selectDriver(driver.id);
            focusPoints([driver.location]);
          }}
          onEditMap={() => openSketchForDriver(driver.id)}
          onRemove={() => removeDriver(driver.id)}
        />
      ))}
    </ul>
  );
}

function DriverRow({
  driver,
  vehicle,
  selected,
  onSelect,
  onEditMap,
  onRemove,
}: {
  driver: Driver;
  vehicle: Vehicle | undefined;
  selected: boolean;
  onSelect: () => void;
  onEditMap: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={`rounded-md border p-2 ${selected ? "border-[var(--primary)]" : "border-[var(--border)]"}`}
    >
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">{driver.name || driver.id}</span>
          <Badge variant="outline">{driver.status}</Badge>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
          {driver.id} · {vehicle?.label ?? driver.vehicleId}
          {driver.currentRideId ? ` · ride ${driver.currentRideId}` : " · idle"}
        </p>
        <p className="font-mono text-[10px] text-[var(--muted-foreground)]">
          {formatCoordinate(driver.location.lat)}, {formatCoordinate(driver.location.lng)}
        </p>
      </button>
      <div className="mt-1.5 flex gap-1">
        <Button size="xs" variant="outline" onClick={onEditMap}>
          <PencilRuler className="size-3" /> Edit on map
        </Button>
        <Button size="xs" variant="ghost" aria-label={`Remove ${driver.id}`} onClick={onRemove}>
          <Trash2 className="size-3" />
        </Button>
      </div>
    </li>
  );
}

export function VehiclesInventory() {
  const scenario = useScenarioStore((state) => state.scenario);
  const removeVehicle = useScenarioStore((state) => state.removeVehicle);

  if (scenario.vehicles.length === 0) {
    return (
      <EmptyState message="No vehicles in this scene. Ride sketch adds fleet types when you create a driver." />
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {scenario.vehicles.map((vehicle) => {
        const assigned = scenario.drivers.filter((driver) => driver.vehicleId === vehicle.id).length;
        return (
          <li key={vehicle.id} className="rounded-md border border-[var(--border)] p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">{vehicle.label}</span>
              <Badge variant="outline">{vehicle.totalSeats} seats</Badge>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              {vehicle.id} · {assigned} driver{assigned === 1 ? "" : "s"}
              {vehicle.poolingEnabled ? " · pooling" : " · no pool"}
            </p>
            <div className="mt-1.5">
              <Button
                size="xs"
                variant="ghost"
                disabled={assigned > 0}
                title={assigned > 0 ? "Unassign drivers first" : "Remove vehicle"}
                onClick={() => removeVehicle(vehicle.id)}
              >
                <Trash2 className="size-3" /> Remove
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PassengersInventory() {
  const scenario = useScenarioStore((state) => state.scenario);
  const removePassenger = useScenarioStore((state) => state.removePassenger);

  if (scenario.passengers.length === 0) {
    return <EmptyState message="No passengers yet. Add them in Ride sketch or load a preset." />;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {scenario.passengers.map((passenger) => (
        <PassengerRow
          key={passenger.id}
          passenger={passenger}
          onRemove={() => removePassenger(passenger.id)}
        />
      ))}
    </ul>
  );
}

function PassengerRow({ passenger, onRemove }: { passenger: Passenger; onRemove: () => void }) {
  return (
    <li className="rounded-md border border-[var(--border)] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{passenger.name || passenger.id}</span>
        <Badge variant="outline">{passenger.state}</Badge>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
        {passenger.id} · {passenger.seatsRequired} seat{passenger.seatsRequired === 1 ? "" : "s"}
        {passenger.allowsPooling ? " · pools" : " · solo"}
      </p>
      <Button size="xs" variant="ghost" className="mt-1" onClick={onRemove}>
        <Trash2 className="size-3" /> Remove
      </Button>
    </li>
  );
}

export function RidesInventory() {
  const scenario = useScenarioStore((state) => state.scenario);
  const removeRide = useScenarioStore((state) => state.removeRide);
  const selectDriver = useMatchingStore((state) => state.selectDriver);

  if (scenario.rides.length === 0) {
    return (
      <EmptyState message="No existing rides. Enable “Has active ride” in Ride sketch, or load a preset." />
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {scenario.rides.map((ride) => (
        <RideRow
          key={ride.id}
          ride={ride}
          onFocus={() => {
            selectDriver(ride.driverId);
            const driver = scenario.drivers.find((entry) => entry.id === ride.driverId);
            const points = [
              ...(driver ? [driver.location] : []),
              ...ride.stops.map((stop) => stop.location),
              ...(ride.coveredPath ?? []),
            ];
            focusPoints(points);
          }}
          onEditMap={() => openSketchForDriver(ride.driverId)}
          onRemove={() => removeRide(ride.id)}
        />
      ))}
    </ul>
  );
}

function RideRow({
  ride,
  onFocus,
  onEditMap,
  onRemove,
}: {
  ride: Ride;
  onFocus: () => void;
  onEditMap: () => void;
  onRemove: () => void;
}) {
  const remaining = [...ride.stops].sort((a, b) => a.sequence - b.sequence);
  return (
    <li className="rounded-md border border-[var(--border)] p-2">
      <button type="button" className="w-full text-left" onClick={onFocus}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">{ride.id}</span>
          <Badge variant="outline">{remaining.length} stops</Badge>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
          Driver {ride.driverId} · {ride.passengerIds.join(", ") || "no passengers"}
          {ride.coveredPath && ride.coveredPath.length > 0
            ? ` · ${ride.coveredPath.length} covered pts`
            : ""}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
          {remaining.map((stop, index) => `${index + 1}.${stop.type[0]}${stop.passengerId}`).join(" → ") ||
            "No remaining stops"}
        </p>
      </button>
      <div className="mt-1.5 flex gap-1">
        <Button size="xs" variant="outline" onClick={onFocus}>
          <Focus className="size-3" /> Show
        </Button>
        <Button size="xs" variant="outline" onClick={onEditMap}>
          <PencilRuler className="size-3" /> Edit on map
        </Button>
        <Button size="xs" variant="ghost" onClick={onRemove}>
          <Trash2 className="size-3" />
        </Button>
      </div>
    </li>
  );
}

export function RequestInventory() {
  const scenario = useScenarioStore((state) => state.scenario);
  const removeRequest = useScenarioStore((state) => state.removeRequest);
  const setMode = useMapStore((state) => state.setMode);
  const beginNew = useRideSketchStore((state) => state.beginNewDriver);

  const request = scenario.requests[0] as RideRequest | undefined;

  if (!request) {
    return (
      <div className="flex flex-col gap-2">
        <EmptyState message="No pending request. Sketch Req pick/drop on the map, or load a preset." />
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            beginNew(scenario);
            setMode("RIDE_SKETCH");
          }}
        >
          <MapPinned className="size-3" /> Open Ride sketch
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border)] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{request.id}</span>
        <Badge variant="outline">{request.seatsRequired} seats</Badge>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
        Passenger {request.passengerId}
        {request.poolingAllowed ? " · pooling" : " · solo"}
      </p>
      <p className="mt-1 font-mono text-[10px] text-[var(--muted-foreground)]">
        P {formatCoordinate(request.pickup.lat)}, {formatCoordinate(request.pickup.lng)}
      </p>
      <p className="font-mono text-[10px] text-[var(--muted-foreground)]">
        D {formatCoordinate(request.drop.lat)}, {formatCoordinate(request.drop.lng)}
      </p>
      <div className="mt-1.5 flex gap-1">
        <Button
          size="xs"
          variant="outline"
          onClick={() => focusPoints([request.pickup, request.drop])}
        >
          <Focus className="size-3" /> Show
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            beginNew(scenario);
            setMode("RIDE_SKETCH");
          }}
        >
          <PencilRuler className="size-3" /> Edit on map
        </Button>
        <Button size="xs" variant="ghost" onClick={() => removeRequest(request.id)}>
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}
