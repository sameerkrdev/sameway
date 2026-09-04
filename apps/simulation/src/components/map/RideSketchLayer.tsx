import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { Fragment } from "react";

import type { LatLng } from "@/domain/entities";
import { cn } from "@/lib/utils";
import { useRideSketchStore } from "@/stores/rideSketchStore";

import { usePolyline } from "./useMapPrimitives";

const ACTIVE_REMAINING = "#38bdf8";
const ACTIVE_COVERED = "#94a3b8";
const INACTIVE_REMAINING = "#0ea5e9";
const INACTIVE_COVERED = "#64748b";

function SlotPaths({
  coveredPath,
  pathWaypoints,
  active,
}: {
  coveredPath: LatLng[];
  pathWaypoints: LatLng[];
  active: boolean;
}) {
  usePolyline(
    coveredPath.length >= 2
      ? {
          path: coveredPath,
          color: active ? ACTIVE_COVERED : INACTIVE_COVERED,
          weight: active ? 5 : 3,
          opacity: active ? 0.85 : 0.35,
          zIndex: active ? 18 : 8,
        }
      : null,
  );
  usePolyline(
    pathWaypoints.length >= 2
      ? {
          path: pathWaypoints,
          color: active ? ACTIVE_REMAINING : INACTIVE_REMAINING,
          weight: active ? 4 : 2,
          opacity: active ? 0.95 : 0.3,
          dashed: true,
          zIndex: active ? 20 : 9,
        }
      : null,
  );
  return null;
}

function VehicleNowMarker({ position, active, label }: { position: LatLng; active: boolean; label: string }) {
  return (
    <AdvancedMarker position={position} zIndex={active ? 60 : 40} title={`${label} vehicle now`}>
      <div
        className={cn(
          "rounded-md border-2 px-1.5 py-0.5 text-[10px] font-bold shadow",
          active
            ? "border-sky-400 bg-sky-500 text-white"
            : "border-slate-400 bg-slate-600/80 text-slate-100 opacity-70",
        )}
      >
        {active ? "VEHICLE NOW" : label}
      </div>
    </AdvancedMarker>
  );
}

function SketchStopMarker({
  position,
  index,
  type,
  passengerId,
  active,
  onRemove,
}: {
  position: LatLng;
  index: number;
  type: "PICKUP" | "DROP";
  passengerId: string;
  active: boolean;
  onRemove?: () => void;
}) {
  return (
    <AdvancedMarker
      position={position}
      zIndex={active ? 55 : 35}
      title={`${index}. ${type} ${passengerId}`}
      onClick={active ? onRemove : undefined}
    >
      <div
        className={cn(
          "flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-bold shadow",
          active && "ring-2 ring-sky-400/80",
          !active && "opacity-50",
          type === "PICKUP"
            ? "border-[var(--pass)] bg-[var(--card)] text-[var(--pass)]"
            : "border-[var(--fail)] bg-[var(--card)] text-[var(--fail)]",
        )}
      >
        {index}
      </div>
    </AdvancedMarker>
  );
}

function SketchRequestMarker({ position, kind }: { position: LatLng; kind: "PICKUP" | "DROP" }) {
  return (
    <AdvancedMarker position={position} zIndex={58} title={`Request ${kind.toLowerCase()}`}>
      <div
        className={cn(
          "rounded-md border-2 border-dashed px-1.5 py-0.5 text-[10px] font-bold shadow",
          kind === "PICKUP"
            ? "border-sky-300 bg-sky-500/90 text-white"
            : "border-rose-300 bg-rose-500/90 text-white",
        )}
      >
        {kind === "PICKUP" ? "NEW PICKUP" : "NEW DROP"}
      </div>
    </AdvancedMarker>
  );
}

/** All sketched rides; active slot is emphasized. */
export function RideSketchLayer() {
  const slots = useRideSketchStore((state) => state.slots);
  const activeIndex = useRideSketchStore((state) => state.activeIndex);
  const requestPickup = useRideSketchStore((state) => state.requestPickup);
  const requestDrop = useRideSketchStore((state) => state.requestDrop);
  const removeStop = useRideSketchStore((state) => state.removeStop);

  return (
    <>
      {slots.map((slot, slotIndex) => {
        const active = slotIndex === activeIndex;
        return (
          <Fragment key={slot.slotId}>
            <SlotPaths
              coveredPath={slot.coveredPath}
              pathWaypoints={slot.pathWaypoints}
              active={active}
            />
            {slot.vehicleLocation ? (
              <VehicleNowMarker
                position={slot.vehicleLocation}
                active={active}
                label={slot.label}
              />
            ) : null}
            {slot.stops.map((stop, index) => (
              <SketchStopMarker
                key={stop.id}
                position={stop.location}
                index={index + 1}
                type={stop.type}
                passengerId={stop.passengerId}
                active={active}
                onRemove={() => removeStop(stop.id)}
              />
            ))}
          </Fragment>
        );
      })}
      {requestPickup ? <SketchRequestMarker position={requestPickup} kind="PICKUP" /> : null}
      {requestDrop ? <SketchRequestMarker position={requestDrop} kind="DROP" /> : null}
    </>
  );
}
