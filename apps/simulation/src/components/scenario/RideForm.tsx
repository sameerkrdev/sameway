import { Plus, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createId } from "@/lib/ids";
import { useMatchingStore } from "@/stores/matchingStore";
import { useScenarioStore } from "@/stores/scenarioStore";

import { RouteBuilder } from "./RouteBuilder";

export function RideForm() {
  const scenario = useScenarioStore((state) => state.scenario);
  const upsertRide = useScenarioStore((state) => state.upsertRide);
  const removeRide = useScenarioStore((state) => state.removeRide);
  const selectDriver = useMatchingStore((state) => state.selectDriver);

  const unassignedDrivers = scenario.drivers.filter((driver) => !driver.currentRideId);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          {scenario.rides.length} existing rides
        </span>
        <Button
          size="xs"
          variant="outline"
          disabled={unassignedDrivers.length === 0}
          title={
            unassignedDrivers.length === 0 ? "Every driver already has a ride" : "Create a ride"
          }
          onClick={() => {
            const driver = unassignedDrivers[0];
            if (driver) {
              upsertRide({ id: createId("R"), driverId: driver.id, passengerIds: [], stops: [] });
            }
          }}
        >
          <Plus /> Add ride
        </Button>
      </div>

      {scenario.rides.length === 0 ? (
        <EmptyState message="No existing rides. Drivers without a ride are treated as idle." />
      ) : null}

      {scenario.rides.map((ride) => (
        <div key={ride.id} className="rounded-md border border-[var(--border)] p-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{ride.id}</Badge>
            <div className="flex-1">
              <Label>Driver</Label>
              <Select
                value={ride.driverId}
                onValueChange={(driverId) => upsertRide({ ...ride, driverId })}
              >
                <SelectTrigger className="h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scenario.drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.id} — {driver.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="iconSm"
              variant="ghost"
              onClick={() => removeRide(ride.id)}
              aria-label={`Delete ${ride.id}`}
            >
              <Trash2 />
            </Button>
          </div>

          <div className="mt-2">
            <RouteBuilder ride={ride} passengers={scenario.passengers} />
          </div>

          <Button
            size="xs"
            variant="ghost"
            className="mt-1"
            onClick={() => selectDriver(ride.driverId)}
          >
            Show on map
          </Button>
        </div>
      ))}
    </div>
  );
}
