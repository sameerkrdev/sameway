import { APIProvider, Map, MapControl, ControlPosition } from "@vis.gl/react-google-maps";
import { Grid3x3, Route as RouteIcon, X } from "lucide-react";
import { useCallback, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/misc";
import type { LatLng } from "@/domain/entities";
import { getH3CellFor } from "@/lib/h3";
import { shortCell } from "@/lib/format";
import { driversSurvivingStage, evaluationById, useMatchingStore } from "@/stores/matchingStore";
import { MAP_MODE_HINTS, MAP_MODE_LABELS, useMapStore } from "@/stores/mapStore";
import { useScenarioStore } from "@/stores/scenarioStore";
import { useSettingsStore } from "@/stores/settingsStore";

import { H3Overlay } from "./H3Overlay";
import { LocationSearch } from "./LocationSearch";
import { DriverMarker, RequestMarker, StopMarker } from "./markers";
import { RouteLayer } from "./RouteLayer";
import { useFitBounds } from "./useMapPrimitives";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

/** Above this many candidate markers, per-driver React children are dropped. */
const MARKER_BUDGET = 300;

export function MapView() {
  if (!API_KEY) {
    return <MissingKeyNotice />;
  }

  return (
    <APIProvider apiKey={API_KEY} version="weekly" libraries={["places", "marker"]}>
      <MapSurface />
    </APIProvider>
  );
}

function MapSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const setDriverLocation = useScenarioStore((state) => state.setDriverLocation);
  const upsertRequest = useScenarioStore((state) => state.upsertRequest);
  const setRideStops = useScenarioStore((state) => state.setRideStops);

  const settings = useSettingsStore((state) => state.settings);

  const mode = useMapStore((state) => state.mode);
  const pendingTarget = useMapStore((state) => state.pendingTarget);
  const showH3 = useMapStore((state) => state.showH3);
  const showAllRoutes = useMapStore((state) => state.showAllRoutes);
  const center = useMapStore((state) => state.center);
  const zoom = useMapStore((state) => state.zoom);
  const focusRequest = useMapStore((state) => state.focusRequest);
  const inspectedCell = useMapStore((state) => state.inspectedCell);

  const currentRun = useMatchingStore((state) => state.currentRun);
  const selectedDriverId = useMatchingStore((state) => state.selectedDriverId);
  const replayStageIndex = useMatchingStore((state) => state.replayStageIndex);
  const selectDriver = useMatchingStore((state) => state.selectDriver);

  const request = scenario.requests[0];

  const survivingDriverIds = useMemo(
    () => driversSurvivingStage(currentRun?.result.stageResults ?? [], replayStageIndex),
    [currentRun, replayStageIndex],
  );

  const selectedEvaluation = evaluationById(
    currentRun?.result.evaluations ?? [],
    selectedDriverId,
  );

  const selectedRide = useMemo(
    () => scenario.rides.find((ride) => ride.driverId === selectedDriverId),
    [scenario.rides, selectedDriverId],
  );

  const handleMapClick = useCallback(
    (point: LatLng) => {
      if (mode === "NORMAL") {
        return;
      }

      if (mode === "INSPECT_H3") {
        useMapStore.getState().setInspectedCell({
          cell: getH3CellFor(point, settings.h3Resolution),
          point,
        });
        return;
      }

      // Every placement mode does exactly one thing, driven by the target that
      // was set when the mode was entered.
      const target = pendingTarget;
      if (!target) {
        return;
      }

      if (target.kind === "DRIVER") {
        setDriverLocation(target.entityId, point);
      } else if (target.kind === "REQUEST_PICKUP" && request) {
        upsertRequest({ ...request, pickup: point, pickupAddress: undefined });
      } else if (target.kind === "REQUEST_DROP" && request) {
        upsertRequest({ ...request, drop: point, dropAddress: undefined });
      } else if (target.kind === "RIDE_STOP" && target.passengerId) {
        const ride = scenario.rides.find((entry) => entry.id === target.entityId);
        if (ride) {
          setRideStops(ride.id, [
            ...ride.stops,
            {
              id: `${ride.id}_S${ride.stops.length + 1}`,
              rideId: ride.id,
              passengerId: target.passengerId,
              type: target.stopType ?? "PICKUP",
              location: point,
              sequence: ride.stops.length,
              originalEtaMin: 0,
            },
          ]);
        }
      }

      useMapStore.getState().resetMode();
    },
    [mode, pendingTarget, request, scenario.rides, setDriverLocation, setRideStops, upsertRequest, settings.h3Resolution],
  );

  const visibleDrivers = useMemo(() => {
    if (!survivingDriverIds) {
      return scenario.drivers;
    }
    // During stage replay the map thins to whoever is still alive.
    return scenario.drivers.filter((driver) => survivingDriverIds.has(driver.id));
  }, [scenario.drivers, survivingDriverIds]);

  const overBudget = visibleDrivers.length > MARKER_BUDGET;
  const renderedDrivers = overBudget ? visibleDrivers.slice(0, MARKER_BUDGET) : visibleDrivers;

  const searchedRing = useMemo(() => {
    const stage = currentRun?.result.stageResults.find(
      (entry) => entry.stageId === "h3CandidateGeneration",
    );
    const stoppedAtRing = stage?.notes?.stoppedAtRing;
    return typeof stoppedAtRing === "number" ? stoppedAtRing : null;
  }, [currentRun]);

  useFitBounds(focusRequest?.bounds ?? null, focusRequest?.nonce ?? null);

  return (
    <div className="relative h-full w-full">
      <Map
        mapId={MAP_ID}
        defaultCenter={center}
        defaultZoom={zoom}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        colorScheme="DARK"
        className="h-full w-full"
        onClick={(event) => {
          const lat = event.detail.latLng?.lat;
          const lng = event.detail.latLng?.lng;
          if (lat !== undefined && lng !== undefined) {
            handleMapClick({ lat, lng });
          }
        }}
      >
        {showH3 && request ? (
          <H3Overlay
            pickup={request.pickup}
            resolution={settings.h3Resolution}
            maxRing={settings.maxH3Ring}
            searchedRing={searchedRing}
            extraCells={inspectedCell ? [inspectedCell.cell] : []}
          />
        ) : null}

        <RouteLayer
          scenario={scenario}
          showAllRoutes={showAllRoutes}
          selectedDriverId={selectedDriverId}
          selectedEvaluation={selectedEvaluation}
          visibleDriverIds={survivingDriverIds}
        />

        {renderedDrivers.map((driver) => (
          <DriverMarker
            key={driver.id}
            driver={driver}
            selected={driver.id === selectedDriverId}
            dimmed={false}
            draggable={mode === "NORMAL"}
            onSelect={selectDriver}
            onDragEnd={setDriverLocation}
          />
        ))}

        {selectedRide
          ? [...selectedRide.stops]
              .sort((a, b) => a.sequence - b.sequence)
              .map((stop, index) => (
                <StopMarker
                  key={stop.id}
                  position={stop.location}
                  index={index + 1}
                  type={stop.type}
                  label={`${index + 1}. ${stop.type === "PICKUP" ? "Pickup" : "Drop"} ${stop.passengerId}`}
                />
              ))
          : null}

        {request ? (
          <>
            <RequestMarker position={request.pickup} kind="PICKUP" />
            <RequestMarker position={request.drop} kind="DROP" />
          </>
        ) : null}

        <MapControl position={ControlPosition.TOP_LEFT}>
          <div className="m-2 w-72">
            <LocationSearch
              onSelect={(point) => {
                useMapStore.getState().setCenter(point);
                handleMapClick(point);
              }}
            />
          </div>
        </MapControl>
      </Map>

      <MapModeBanner />

      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)]/95 p-2 text-xs shadow-lg backdrop-blur">
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <Grid3x3 className="size-3.5" aria-hidden />
            Show H3 grid
          </span>
          <Switch checked={showH3} onCheckedChange={() => useMapStore.getState().toggleH3()} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <RouteIcon className="size-3.5" aria-hidden />
            Show all routes
          </span>
          <Switch
            checked={showAllRoutes}
            onCheckedChange={() => useMapStore.getState().toggleAllRoutes()}
          />
        </label>
        {overBudget ? (
          <p className="max-w-48 text-[11px] text-[var(--warn)]">
            Showing {MARKER_BUDGET} of {visibleDrivers.length} drivers to keep the map responsive.
          </p>
        ) : null}
        {inspectedCell ? (
          <p className="tabular text-[11px] text-[var(--muted-foreground)]">
            Cell {shortCell(inspectedCell.cell)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MapModeBanner() {
  const mode = useMapStore((state) => state.mode);
  const resetMode = useMapStore((state) => state.resetMode);

  if (mode === "NORMAL") {
    return null;
  }

  return (
    <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border border-[var(--primary)] bg-[var(--card)]/95 px-3 py-1.5 shadow-lg backdrop-blur">
      <Badge variant="outline">Map mode</Badge>
      <div>
        <p className="text-xs font-semibold">{MAP_MODE_LABELS[mode]}</p>
        <p className="text-[11px] text-[var(--muted-foreground)]">{MAP_MODE_HINTS[mode]}</p>
      </div>
      <Button size="iconSm" variant="ghost" onClick={resetMode} aria-label="Cancel map mode">
        <X />
      </Button>
    </div>
  );
}

function MissingKeyNotice() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--secondary)] p-8 text-center">
      <p className="text-sm font-semibold">Map unavailable</p>
      <p className="max-w-md text-xs text-[var(--muted-foreground)]">
        Set <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> in{" "}
        <code className="font-mono">apps/simulation/.env.local</code> to render the map. The
        matching engine still runs without it, using the mock routing engine.
      </p>
    </div>
  );
}
