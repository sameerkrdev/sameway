import { MapPin } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/shared/StatusIcon";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ANY_VEHICLE } from "@/domain/entities";
import { formatCoordinate, shortCell } from "@/lib/format";
import { getH3CellFor } from "@/lib/h3";
import { useMapStore } from "@/stores/mapStore";
import { useScenarioStore } from "@/stores/scenarioStore";
import { useSettingsStore } from "@/stores/settingsStore";

import { NumberField, ToggleRow } from "./VehicleForm";

export function RequestForm() {
  const scenario = useScenarioStore((state) => state.scenario);
  const upsertRequest = useScenarioStore((state) => state.upsertRequest);
  const resolution = useSettingsStore((state) => state.settings.h3Resolution);
  const setMode = useMapStore((state) => state.setMode);

  const request = scenario.requests[0];

  const availablePassengers = useMemo(() => {
    const onRide = new Set(scenario.rides.flatMap((ride) => ride.passengerIds));
    return scenario.passengers.filter((passenger) => !onRide.has(passenger.id));
  }, [scenario.passengers, scenario.rides]);

  if (!request) {
    return <EmptyState message="No ride request. Load a preset to create one." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label>Passenger</Label>
        <Select
          value={request.passengerId}
          onValueChange={(passengerId) => upsertRequest({ ...request, passengerId })}
        >
          <SelectTrigger className="h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availablePassengers.map((passenger) => (
              <SelectItem key={passenger.id} value={passenger.id}>
                {passenger.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {availablePassengers.length === 0 ? (
          <p className="mt-1 text-[11px] text-[var(--fail)]">
            Every passenger is already on a ride. Sketch a new passenger for the next request.
          </p>
        ) : null}
      </div>

      <LocationRow
        label="Pickup"
        point={request.pickup}
        address={request.pickupAddress}
        cell={shortCell(getH3CellFor(request.pickup, resolution))}
        onPick={() =>
          setMode("ADD_PICKUP", { kind: "REQUEST_PICKUP", entityId: request.id })
        }
      />

      <LocationRow
        label="Drop"
        point={request.drop}
        address={request.dropAddress}
        cell={shortCell(getH3CellFor(request.drop, resolution))}
        onPick={() => setMode("ADD_DROP", { kind: "REQUEST_DROP", entityId: request.id })}
      />

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Seats required"
          value={request.seatsRequired}
          min={1}
          onChange={(seatsRequired) => upsertRequest({ ...request, seatsRequired })}
        />
        <NumberField
          label="Luggage"
          value={request.luggageCount}
          min={0}
          onChange={(luggageCount) => upsertRequest({ ...request, luggageCount })}
        />
        <NumberField
          label="Max wait (min)"
          value={request.maxWaitMinutes}
          min={0}
          onChange={(maxWaitMinutes) => upsertRequest({ ...request, maxWaitMinutes })}
        />
      </div>

      <div>
        <Label>Vehicle preference</Label>
        <Select
          value={request.vehiclePreference}
          onValueChange={(vehiclePreference) => upsertRequest({ ...request, vehiclePreference })}
        >
          <SelectTrigger className="h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_VEHICLE}>Any vehicle</SelectItem>
            {scenario.vehicles.map((vehicle) => (
              <SelectItem key={vehicle.id} value={vehicle.label}>
                {vehicle.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ToggleRow
        label="Pooling allowed"
        checked={request.poolingAllowed}
        onChange={(poolingAllowed) => upsertRequest({ ...request, poolingAllowed })}
      />
      <ToggleRow
        label="Needs wheelchair access"
        checked={request.requiresWheelchairAccess}
        onChange={(requiresWheelchairAccess) =>
          upsertRequest({ ...request, requiresWheelchairAccess })
        }
      />

      <p className="text-[11px] text-[var(--muted-foreground)]">
        Max wait and max detour on the request are the rider&apos;s own limits. The engine applies
        the stricter of these and the developer settings.
      </p>
    </div>
  );
}

function LocationRow({
  label,
  point,
  address,
  cell,
  onPick,
}: {
  label: string;
  point: { lat: number; lng: number };
  address?: string;
  cell: string;
  onPick: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] p-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button size="xs" variant="outline" onClick={onPick}>
          <MapPin /> Select on map
        </Button>
      </div>
      <p className="tabular mt-1 text-[11px]">
        {formatCoordinate(point.lat)}, {formatCoordinate(point.lng)}
      </p>
      {address ? <p className="text-[11px] text-[var(--muted-foreground)]">{address}</p> : null}
      <p className="tabular text-[11px] text-[var(--muted-foreground)]">H3 {cell}</p>
    </div>
  );
}
