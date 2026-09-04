import { ArrowDown, ArrowUp, GripVertical, MapPin, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Passenger, Ride, Stop } from "@/domain/entities";
import { formatCoordinate } from "@/lib/format";
import { findOrderingViolations } from "@/matching/stops";
import { useMapStore } from "@/stores/mapStore";
import { useScenarioStore } from "@/stores/scenarioStore";

/**
 * Google-Maps-style stop editor.
 *
 * Reordering is validated after every change: the insertion engine can never
 * produce a drop-before-pickup route, but a person dragging stops around can,
 * and a silently invalid route would produce nonsense occupancy numbers.
 */
export function RouteBuilder({ ride, passengers }: { ride: Ride; passengers: Passenger[] }) {
  const setRideStops = useScenarioStore((state) => state.setRideStops);
  const setMode = useMapStore((state) => state.setMode);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const stops = [...ride.stops].sort((a, b) => a.sequence - b.sequence);
  const nameFor = (passengerId: string) =>
    passengers.find((entry) => entry.id === passengerId)?.name ?? passengerId;
  const violations = findOrderingViolations(stops, nameFor);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length) {
      return;
    }
    const next = [...stops];
    const [moved] = next.splice(from, 1);
    if (moved) {
      next.splice(to, 0, moved);
      setRideStops(ride.id, next);
    }
  };

  const update = (index: number, patch: Partial<Stop>) => {
    setRideStops(
      ride.id,
      stops.map((stop, position) => (position === index ? { ...stop, ...patch } : stop)),
    );
  };

  const addStop = () => {
    const passenger = passengers[0];
    if (!passenger) {
      return;
    }
    setMode("ADD_STOP", {
      kind: "RIDE_STOP",
      entityId: ride.id,
      passengerId: passenger.id,
      stopType: "PICKUP",
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          Driver current location, then {stops.length} stop{stops.length === 1 ? "" : "s"}
        </span>
        <Button size="xs" variant="outline" onClick={addStop}>
          <Plus /> Add stop
        </Button>
      </div>

      {violations.length > 0 ? (
        <div className="flex items-start gap-1.5 rounded-md border border-[var(--fail)] bg-[color-mix(in_oklab,var(--fail)_12%,transparent)] p-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--fail)]" aria-hidden />
          <div className="text-[11px]">
            <p className="font-semibold text-[var(--fail)]">Invalid route</p>
            {violations.map((violation) => (
              <p key={violation.passengerId}>{violation.message}</p>
            ))}
          </div>
        </div>
      ) : null}

      <ol className="flex flex-col gap-1">
        {stops.map((stop, index) => (
          <li
            key={stop.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== index) {
                move(dragIndex, index);
              }
              setDragIndex(null);
            }}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] p-1.5"
          >
            <GripVertical
              className="size-3.5 shrink-0 cursor-grab text-[var(--muted-foreground)]"
              aria-hidden
            />
            <Badge variant="outline">{index + 1}</Badge>

            <Select
              value={stop.type}
              onValueChange={(value) => update(index, { type: value as Stop["type"] })}
            >
              <SelectTrigger className="h-7 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PICKUP">Pickup</SelectItem>
                <SelectItem value="DROP">Drop</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={stop.passengerId}
              onValueChange={(value) => update(index, { passengerId: value })}
            >
              <SelectTrigger className="h-7 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {passengers.map((passenger) => (
                  <SelectItem key={passenger.id} value={passenger.id}>
                    {passenger.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex flex-col">
              <Button
                size="iconSm"
                variant="ghost"
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label="Move stop up"
              >
                <ArrowUp />
              </Button>
              <Button
                size="iconSm"
                variant="ghost"
                onClick={() => move(index, index + 1)}
                disabled={index === stops.length - 1}
                aria-label="Move stop down"
              >
                <ArrowDown />
              </Button>
            </div>

            <Button
              size="iconSm"
              variant="ghost"
              title={`${formatCoordinate(stop.location.lat)}, ${formatCoordinate(stop.location.lng)}`}
              onClick={() =>
                useMapStore.getState().focusOn([stop.location])
              }
              aria-label="Focus stop on map"
            >
              <MapPin />
            </Button>

            <Button
              size="iconSm"
              variant="ghost"
              onClick={() =>
                setRideStops(
                  ride.id,
                  stops.filter((_, position) => position !== index),
                )
              }
              aria-label="Delete stop"
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}
