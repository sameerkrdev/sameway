import { AdvancedMarker } from "@vis.gl/react-google-maps";

import type { Driver, DriverStatus, LatLng } from "@/domain/entities";
import { cn } from "@/lib/utils";

export const DRIVER_STATUS_COLOR: Record<DriverStatus, string> = {
  ONLINE: "var(--pass)",
  BUSY: "var(--warn)",
  PAUSED: "var(--skip)",
  OFFLINE: "var(--muted-foreground)",
};

/**
 * Status is encoded in the glyph as well as the colour: a filled dot for
 * online, a ring for busy, a bar for paused, a cross for offline.
 */
const STATUS_GLYPH: Record<DriverStatus, string> = {
  ONLINE: "●",
  BUSY: "◐",
  PAUSED: "▮",
  OFFLINE: "✕",
};

export function DriverMarker({
  driver,
  selected,
  dimmed,
  onSelect,
  onDragEnd,
  draggable,
}: {
  driver: Driver;
  selected: boolean;
  dimmed: boolean;
  onSelect: (driverId: string) => void;
  onDragEnd?: (driverId: string, location: LatLng) => void;
  draggable?: boolean;
}) {
  return (
    <AdvancedMarker
      position={driver.location}
      draggable={draggable ?? false}
      zIndex={selected ? 40 : 10}
      onClick={() => onSelect(driver.id)}
      onDragEnd={(event) => {
        const lat = event.latLng?.lat();
        const lng = event.latLng?.lng();
        if (lat !== undefined && lng !== undefined) {
          onDragEnd?.(driver.id, { lat, lng });
        }
      }}
      title={`${driver.id} — ${driver.status}`}
    >
      <div
        className={cn(
          "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold shadow-sm transition-opacity",
          selected
            ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]",
          dimmed && "opacity-25",
        )}
      >
        <span style={{ color: selected ? "inherit" : DRIVER_STATUS_COLOR[driver.status] }}>
          {STATUS_GLYPH[driver.status]}
        </span>
        {driver.id}
      </div>
    </AdvancedMarker>
  );
}

export function StopMarker({
  position,
  index,
  type,
  label,
  onClick,
}: {
  position: LatLng;
  index: number;
  type: "PICKUP" | "DROP";
  label: string;
  onClick?: () => void;
}) {
  return (
    <AdvancedMarker position={position} zIndex={30} onClick={onClick} title={label}>
      <div
        className={cn(
          "flex size-5 items-center justify-center rounded-full border-2 text-[10px] font-bold shadow",
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

export function RequestMarker({
  position,
  kind,
}: {
  position: LatLng;
  kind: "PICKUP" | "DROP";
}) {
  return (
    <AdvancedMarker position={position} zIndex={50} title={`New request ${kind.toLowerCase()}`}>
      <div
        className={cn(
          "rounded-md border-2 px-1.5 py-0.5 text-[10px] font-bold shadow",
          kind === "PICKUP"
            ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "border-[var(--fail)] bg-[var(--fail)] text-white",
        )}
      >
        {kind === "PICKUP" ? "NEW PICKUP" : "NEW DROP"}
      </div>
    </AdvancedMarker>
  );
}
