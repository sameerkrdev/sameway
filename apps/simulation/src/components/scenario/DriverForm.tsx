import { MapPin, Plus, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DRIVER_STATUSES, type Driver } from "@/domain/entities";
import { formatCoordinate, shortCell } from "@/lib/format";
import { getH3CellFor } from "@/lib/h3";
import { useMapStore } from "@/stores/mapStore";
import { newDriverId, useScenarioStore } from "@/stores/scenarioStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function DriverForm() {
  const scenario = useScenarioStore((state) => state.scenario);
  const upsertDriver = useScenarioStore((state) => state.upsertDriver);
  const removeDriver = useScenarioStore((state) => state.removeDriver);
  const resolution = useSettingsStore((state) => state.settings.h3Resolution);
  const setMode = useMapStore((state) => state.setMode);

  const addDriver = () => {
    const firstVehicle = scenario.vehicles[0];
    if (!firstVehicle) {
      return;
    }

    const id = newDriverId(scenario);
    upsertDriver({
      id,
      name: `Driver ${id}`,
      status: "ONLINE",
      location: useMapStore.getState().center,
      vehicleId: firstVehicle.id,
      currentRideId: null,
      history: { ridesCompletedToday: 0, lastAssignmentAt: null, idleMinutes: 10 },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          {scenario.drivers.length} drivers
        </span>
        <Button size="xs" variant="outline" onClick={addDriver}>
          <Plus /> Add driver
        </Button>
      </div>

      {scenario.drivers.length === 0 ? (
        <EmptyState message="No drivers yet. Add one, then place it on the map." />
      ) : null}

      <div className="flex flex-col gap-2">
        {scenario.drivers.map((driver) => (
          <DriverRow
            key={driver.id}
            driver={driver}
            resolution={resolution}
            vehicles={scenario.vehicles}
            onChange={upsertDriver}
            onRemove={() => removeDriver(driver.id)}
            onPlaceOnMap={() =>
              setMode("ADD_DRIVER_LOCATION", { kind: "DRIVER", entityId: driver.id })
            }
          />
        ))}
      </div>
    </div>
  );
}

function DriverRow({
  driver,
  vehicles,
  resolution,
  onChange,
  onRemove,
  onPlaceOnMap,
}: {
  driver: Driver;
  vehicles: { id: string; label: string; totalSeats: number }[];
  resolution: number;
  onChange: (driver: Driver) => void;
  onRemove: () => void;
  onPlaceOnMap: () => void;
}) {
  const vehicle = vehicles.find((entry) => entry.id === driver.vehicleId);

  return (
    <div className="rounded-md border border-[var(--border)] p-2">
      <div className="flex items-center gap-2">
        <Input
          value={driver.name}
          className="h-7"
          onChange={(event) => onChange({ ...driver, name: event.target.value })}
          aria-label={`Name for ${driver.id}`}
        />
        <Badge variant="outline">{driver.id}</Badge>
        <Button size="iconSm" variant="ghost" onClick={onRemove} aria-label={`Delete ${driver.id}`}>
          <Trash2 />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <Label>Status</Label>
          <Select
            value={driver.status}
            onValueChange={(value) =>
              onChange({ ...driver, status: value as Driver["status"] })
            }
          >
            <SelectTrigger className="h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRIVER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Vehicle</Label>
          <Select
            value={driver.vehicleId}
            onValueChange={(value) => onChange({ ...driver, vehicleId: value })}
          >
            <SelectTrigger className="h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {vehicles.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label} ({entry.totalSeats})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="tabular text-[11px] text-[var(--muted-foreground)]">
          <div>
            {formatCoordinate(driver.location.lat)}, {formatCoordinate(driver.location.lng)}
          </div>
          {/* Shown for spatial debugging only; a cell id is not a distance. */}
          <div title="H3 cell at the configured resolution">
            H3 {shortCell(getH3CellFor(driver.location, resolution))}
          </div>
        </div>
        <Button size="xs" variant="outline" onClick={onPlaceOnMap}>
          <MapPin /> Place
        </Button>
      </div>

      {!vehicle ? (
        <p className="mt-1 text-[11px] text-[var(--fail)]">
          This driver references a vehicle that no longer exists.
        </p>
      ) : null}
    </div>
  );
}
