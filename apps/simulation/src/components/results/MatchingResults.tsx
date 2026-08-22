import { useMemo, useState } from "react";

import { EmptyState, Metric } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, Separator } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMinutes, formatPercent, formatScore } from "@/lib/format";
import { useMatchingStore } from "@/stores/matchingStore";
import { useMapStore } from "@/stores/mapStore";
import { useScenarioStore } from "@/stores/scenarioStore";

import { DriverDetailSheet } from "./DriverDetailSheet";
import { DriverMatchCard } from "./DriverMatchCard";
import { RejectionPanel } from "./RejectionPanel";

export function MatchingResults() {
  const run = useMatchingStore((state) => state.currentRun);
  const error = useMatchingStore((state) => state.error);
  const selectedDriverId = useMatchingStore((state) => state.selectedDriverId);
  const selectDriver = useMatchingStore((state) => state.selectDriver);
  const scenario = useScenarioStore((state) => state.scenario);
  const focusOn = useMapStore((state) => state.focusOn);

  const [detailsOpen, setDetailsOpen] = useState(false);

  const driversById = useMemo(
    () => new Map(scenario.drivers.map((driver) => [driver.id, driver])),
    [scenario.drivers],
  );

  const selectedEvaluation = run?.result.evaluations.find(
    (entry) => entry.driverId === selectedDriverId,
  );

  if (error) {
    return (
      <div className="rounded-md border border-[var(--fail)] p-3">
        <p className="text-xs font-semibold text-[var(--fail)]">Matching failed</p>
        <p className="mt-1 text-[11px]">{error}</p>
      </div>
    );
  }

  if (!run) {
    return <EmptyState message="Run the matcher to see ranked drivers and rejection analytics." />;
  }

  const { result } = run;

  /** Centres the map on the driver, their route, and the request endpoints. */
  const showOnMap = (driverId: string) => {
    selectDriver(driverId);
    const driver = driversById.get(driverId);
    const ride = scenario.rides.find((entry) => entry.driverId === driverId);
    const request = scenario.requests[0];

    focusOn(
      [
        driver?.location,
        ...(ride?.stops.map((stop) => stop.location) ?? []),
        request?.pickup,
        request?.drop,
      ].filter((point): point is { lat: number; lng: number } => point !== undefined),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {result.requestRejection ? (
        <div className="rounded-md border border-[var(--fail)] p-2">
          <p className="text-xs font-semibold text-[var(--fail)]">Request rejected</p>
          <p className="mt-0.5 text-[11px]">{result.requestRejection.message}</p>
          <Badge variant="outline" className="mt-1 font-mono">
            {result.requestRejection.code}
          </Badge>
        </div>
      ) : null}

      <div className="rounded-md border border-[var(--border)] p-2">
        <Metric label="Drivers in scenario" value={String(result.summary.totalDrivers)} />
        <Metric label="H3 candidates" value={String(result.summary.candidates)} />
        <Metric label="Passed all filters" value={String(result.summary.passed)} />
        <Metric label="Rejected" value={String(result.summary.rejected)} />
        {result.summary.bestDriverId ? (
          <>
            <Separator className="my-1" />
            <Metric label="Best driver" value={result.summary.bestDriverId} />
            <Metric label="Score" value={formatScore(result.summary.bestScore)} />
            <Metric
              label="ETA"
              value={formatMinutes(
                result.ranked[0]?.metrics.roadEtaMin,
              )}
            />
            <Metric
              label="Detour"
              value={formatPercent(result.ranked[0]?.metrics.detourPercent)}
            />
          </>
        ) : null}
      </div>

      <Tabs defaultValue="ranked" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="ranked">Ranked ({result.ranked.length})</TabsTrigger>
          <TabsTrigger value="rejected">Why drivers failed ({result.summary.rejected})</TabsTrigger>
        </TabsList>

        <TabsContent value="ranked" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-1.5 pr-2">
              {result.ranked.length === 0 ? (
                <EmptyState message="No driver passed every filter. The rejection tab explains why." />
              ) : null}
              {result.ranked.map((evaluation) => (
                <DriverMatchCard
                  key={evaluation.driverId}
                  evaluation={evaluation}
                  driver={driversById.get(evaluation.driverId)}
                  scenario={scenario}
                  selected={evaluation.driverId === selectedDriverId}
                  onSelect={() => selectDriver(evaluation.driverId)}
                  onShowOnMap={() => showOnMap(evaluation.driverId)}
                  onOpenDetails={() => {
                    selectDriver(evaluation.driverId);
                    setDetailsOpen(true);
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="rejected" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="pr-2">
              <RejectionPanel
                result={result}
                onSelectDriver={(driverId) => {
                  showOnMap(driverId);
                  setDetailsOpen(true);
                }}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <DriverDetailSheet
        run={run}
        evaluation={selectedEvaluation}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </div>
  );
}
