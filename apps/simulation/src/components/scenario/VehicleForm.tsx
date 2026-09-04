import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/misc";
import { createId } from "@/lib/ids";
import { useScenarioStore } from "@/stores/scenarioStore";

/**
 * Vehicle capability is scenario data, not an enum in the engine, so adding a
 * new class of vehicle is done here rather than in code.
 */
export function VehicleForm() {
  const vehicles = useScenarioStore((state) => state.scenario.vehicles);
  const drivers = useScenarioStore((state) => state.scenario.drivers);
  const upsertVehicle = useScenarioStore((state) => state.upsertVehicle);
  const removeVehicle = useScenarioStore((state) => state.removeVehicle);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          {vehicles.length} vehicle types
        </span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            const id = createId("V");
            upsertVehicle({
              id,
              label: "NEW-VEHICLE",
              totalSeats: 4,
              luggageCapacity: 2,
              poolingEnabled: true,
              wheelchairAccessible: false,
              airConditioned: true,
            });
          }}
        >
          <Plus /> Add vehicle
        </Button>
      </div>

      {vehicles.map((vehicle) => {
        const inUse = drivers.filter((driver) => driver.vehicleId === vehicle.id).length;

        return (
          <div key={vehicle.id} className="rounded-md border border-[var(--border)] p-2">
            <div className="flex items-center gap-2">
              <Input
                value={vehicle.label}
                className="h-7 font-mono text-xs"
                onChange={(event) => upsertVehicle({ ...vehicle, label: event.target.value })}
                aria-label={`Label for ${vehicle.id}`}
              />
              <Button
                size="iconSm"
                variant="ghost"
                disabled={inUse > 0}
                title={inUse > 0 ? `${inUse} drivers still use this vehicle` : "Delete"}
                onClick={() => removeVehicle(vehicle.id)}
                aria-label={`Delete ${vehicle.label}`}
              >
                <Trash2 />
              </Button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumberField
                label="Total seats"
                value={vehicle.totalSeats}
                min={1}
                onChange={(totalSeats) => upsertVehicle({ ...vehicle, totalSeats })}
              />
              <NumberField
                label="Luggage"
                value={vehicle.luggageCapacity}
                min={0}
                onChange={(luggageCapacity) => upsertVehicle({ ...vehicle, luggageCapacity })}
              />
            </div>

            <div className="mt-2 flex flex-col gap-1">
              <ToggleRow
                label="Pooling enabled"
                checked={vehicle.poolingEnabled}
                onChange={(poolingEnabled) => upsertVehicle({ ...vehicle, poolingEnabled })}
              />
              <ToggleRow
                label="Wheelchair accessible"
                checked={vehicle.wheelchairAccessible}
                onChange={(wheelchairAccessible) =>
                  upsertVehicle({ ...vehicle, wheelchairAccessible })
                }
              />
              <ToggleRow
                label="Air conditioned"
                checked={vehicle.airConditioned}
                onChange={(airConditioned) => upsertVehicle({ ...vehicle, airConditioned })}
              />
            </div>

            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              {inUse} {inUse === 1 ? "driver uses" : "drivers use"} this vehicle
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        className="h-7"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isNaN(next)) {
            onChange(next);
          }
        }}
      />
    </div>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span>
        {label}
        {hint ? (
          <span className="block text-[11px] text-[var(--muted-foreground)]">{hint}</span>
        ) : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
