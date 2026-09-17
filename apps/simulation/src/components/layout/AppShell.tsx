import { Loader2, Play, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

import { DebugConsole } from "@/components/debug/DebugConsole";
import { RoutingBanner } from "@/components/debug/RoutingBanner";
import { StageDetails } from "@/components/debug/StageDetails";
import { StagePipeline } from "@/components/debug/StagePipeline";
import { MapView } from "@/components/map/MapView";
import { MatchingResults } from "@/components/results/MatchingResults";
import { ScenarioPanel } from "@/components/scenario/ScenarioPanel";
import { SettingsPanel } from "@/components/scenario/SettingsPanel";
import {
  DriversInventory,
  PassengersInventory,
  RequestInventory,
  RidesInventory,
  VehiclesInventory,
} from "@/components/scenario/WorldInventory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ScrollArea,
  Separator,
  TooltipProvider,
} from "@/components/ui/misc";
import { useRunMatching } from "@/hooks/useRunMatching";
import { preloadRoutesLibrary } from "@/routing";
import { useMatchingStore } from "@/stores/matchingStore";
import { useScenarioStore } from "@/stores/scenarioStore";

export function AppShell() {
  const { run, isRunning } = useRunMatching();
  const scenarioName = useScenarioStore((state) => state.scenario.name);
  const currentRun = useMatchingStore((state) => state.currentRun);
  const replayStageIndex = useMatchingStore((state) => state.replayStageIndex);
  const setReplayStageIndex = useMatchingStore((state) => state.setReplayStageIndex);
  const selectDriver = useMatchingStore((state) => state.selectDriver);

  const [consoleOpen, setConsoleOpen] = useState(true);

  useEffect(() => {
    // Resolve the Routes library once so the engine choice is a synchronous
    // decision at run time and a run can never mix real and mock distances.
    void preloadRoutesLibrary();
  }, []);

  const inspectedStage =
    replayStageIndex !== null ? currentRun?.result.stageResults[replayStageIndex] : undefined;

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 py-2">
          <h1 className="text-sm font-semibold">Ride Matching Lab</h1>
          <Badge variant="outline">{scenarioName}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => void run()} disabled={isRunning}>
              {isRunning ? <Loader2 className="animate-spin" /> : <Play />}
              {isRunning ? "Running…" : "Run matching"}
            </Button>
          </div>
        </header>

        <RoutingBanner />

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--border)]">
            <ScrollArea className="h-full">
              <div className="p-3">
                <Accordion type="multiple" defaultValue={["scenario", "drivers", "settings"]}>
                  <AccordionItem value="scenario">
                    <AccordionTrigger>Scenes</AccordionTrigger>
                    <AccordionContent>
                      <ScenarioPanel />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="drivers">
                    <AccordionTrigger>Drivers</AccordionTrigger>
                    <AccordionContent>
                      <DriversInventory />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="vehicles">
                    <AccordionTrigger>Vehicles</AccordionTrigger>
                    <AccordionContent>
                      <VehiclesInventory />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="passengers">
                    <AccordionTrigger>Passengers</AccordionTrigger>
                    <AccordionContent>
                      <PassengersInventory />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="rides">
                    <AccordionTrigger>Existing rides</AccordionTrigger>
                    <AccordionContent>
                      <RidesInventory />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="request">
                    <AccordionTrigger>New ride request</AccordionTrigger>
                    <AccordionContent>
                      <RequestInventory />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="settings">
                    <AccordionTrigger>Simulation settings</AccordionTrigger>
                    <AccordionContent>
                      <SettingsPanel />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </ScrollArea>
          </aside>

          <main className="min-w-0 flex-1">
            <MapView />
          </main>

          <aside className="flex w-96 shrink-0 flex-col border-l border-[var(--border)] p-3">
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide uppercase">
              Matching results
            </h2>
            <div className="min-h-0 flex-1">
              <MatchingResults />
            </div>
          </aside>
        </div>

        <footer className="shrink-0 border-t border-[var(--border)]">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setConsoleOpen((open) => !open)}
              aria-expanded={consoleOpen}
            >
              <Terminal /> Pipeline
            </Button>

            {currentRun ? (
              <div className="min-w-0 flex-1">
                <StagePipeline
                  result={currentRun.result}
                  replayStageIndex={replayStageIndex}
                  onSelectStage={setReplayStageIndex}
                />
              </div>
            ) : (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Run the matcher to populate the pipeline.
              </p>
            )}
          </div>

          {consoleOpen && currentRun ? (
            <>
              <Separator />
              <div className="grid max-h-64 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-[2fr_1fr]">
                <DebugConsole run={currentRun} />
                {inspectedStage ? (
                  <div className="min-h-0 border-l border-[var(--border)] pl-3">
                    <StageDetails stage={inspectedStage} onSelectDriver={selectDriver} />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </footer>
      </div>
    </TooltipProvider>
  );
}
