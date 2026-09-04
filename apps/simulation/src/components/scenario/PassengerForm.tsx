import { Plus, Trash2 } from "lucide-react";

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
import { PASSENGER_STATES, type Passenger } from "@/domain/entities";
import { DEFAULT_PASSENGER_DELAY_BUDGETS } from "@/domain/settings";
import { newPassengerId, useScenarioStore } from "@/stores/scenarioStore";

import { NumberField, ToggleRow } from "./VehicleForm";

export function PassengerForm() {
  const scenario = useScenarioStore((state) => state.scenario);
  const upsertPassenger = useScenarioStore((state) => state.upsertPassenger);
  const removePassenger = useScenarioStore((state) => state.removePassenger);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          {scenario.passengers.length} passengers
        </span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            const id = newPassengerId(scenario);
            upsertPassenger({
              id,
              name: `Passenger ${id}`,
              seatsRequired: 1,
              state: "WAITING",
              specialRequirements: [],
              allowsPooling: true,
              ...DEFAULT_PASSENGER_DELAY_BUDGETS,
            });
          }}
        >
          <Plus /> Add passenger
        </Button>
      </div>

      {scenario.passengers.length === 0 ? (
        <EmptyState message="No passengers yet." />
      ) : null}

      {scenario.passengers.map((passenger) => (
        <PassengerRow
          key={passenger.id}
          passenger={passenger}
          onChange={upsertPassenger}
          onRemove={() => removePassenger(passenger.id)}
        />
      ))}
    </div>
  );
}

function PassengerRow({
  passenger,
  onChange,
  onRemove,
}: {
  passenger: Passenger;
  onChange: (passenger: Passenger) => void;
  onRemove: () => void;
}) {
  const onboard = passenger.state === "PICKED_UP" || passenger.state === "IN_RIDE";

  return (
    <div className="rounded-md border border-[var(--border)] p-2">
      <div className="flex items-center gap-2">
        <Input
          value={passenger.name}
          className="h-7"
          onChange={(event) => onChange({ ...passenger, name: event.target.value })}
          aria-label={`Name for ${passenger.id}`}
        />
        <Badge variant="outline">{passenger.id}</Badge>
        <Button
          size="iconSm"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Delete ${passenger.id}`}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField
          label="Max pickup delay (min)"
          value={passenger.maxPickupDelayMin}
          min={0}
          onChange={(maxPickupDelayMin) => onChange({ ...passenger, maxPickupDelayMin })}
        />
        <NumberField
          label="Max drop delay (%)"
          value={passenger.maxDropDelayPercent}
          min={0}
          onChange={(maxDropDelayPercent) => onChange({ ...passenger, maxDropDelayPercent })}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <Label>Seats</Label>
          <Input
            type="number"
            min={1}
            className="h-7"
            value={passenger.seatsRequired}
            onChange={(event) =>
              onChange({ ...passenger, seatsRequired: Math.max(1, Number(event.target.value)) })
            }
          />
        </div>
        <div>
          <Label>State</Label>
          <Select
            value={passenger.state}
            onValueChange={(value) =>
              onChange({ ...passenger, state: value as Passenger["state"] })
            }
          >
            <SelectTrigger className="h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PASSENGER_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-2">
        <ToggleRow
          label="Allows pooling"
          checked={passenger.allowsPooling}
          onChange={(allowsPooling) => onChange({ ...passenger, allowsPooling })}
        />
      </div>

      {onboard ? (
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
          Already aboard — occupies {passenger.seatsRequired} seat
          {passenger.seatsRequired === 1 ? "" : "s"} from the start of the route, and their pickup
          stop is ignored.
        </p>
      ) : null}
    </div>
  );
}
