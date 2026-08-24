import { Copy, Dices, Download, FilePlus2, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Metric } from "@/components/shared/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBlankScenario } from "@/scenarios/builders";
import { generateScenario } from "@/scenarios/randomGenerator";
import { SCENARIO_PRESETS } from "@/scenarios/presets";
import {
  downloadScenario,
  duplicateScenario,
  importScenarioJson,
} from "@/scenarios/serialize";
import { useMatchingStore } from "@/stores/matchingStore";
import { useRideSketchStore } from "@/stores/rideSketchStore";
import { useScenarioStore } from "@/stores/scenarioStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function ScenarioPanel() {
  const scenario = useScenarioStore((state) => state.scenario);
  const setScenario = useScenarioStore((state) => state.setScenario);
  const renameScenario = useScenarioStore((state) => state.renameScenario);
  const replaceSettings = useSettingsStore((state) => state.replaceAll);
  const resetSettings = useSettingsStore((state) => state.reset);
  const clearResults = useMatchingStore((state) => state.clear);
  const discardSketch = useRideSketchStore((state) => state.discard);

  const fileInput = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [seed, setSeed] = useState(12345);

  const loadScenario = (next: ReturnType<typeof duplicateScenario>) => {
    setScenario(next);
    // Settings travel with the scenario so a shared repro reproduces exactly.
    replaceSettings(next.settings);
    clearResults();
    discardSketch(next);
    setImportErrors([]);
  };

  const loadBlank = () => {
    const blank = createBlankScenario();
    setScenario(blank);
    resetSettings();
    clearResults();
    discardSketch(blank);
    setImportErrors([]);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-[var(--muted-foreground)]">
        Scenes hold the world. Ride sketch on the map creates drivers and rides; this panel loads,
        exports, and inspects them. Run matching auto-applies an open sketch first.
      </p>

      <div>
        <Label>Scene name</Label>
        <Input
          className="h-7"
          value={scenario.name}
          onChange={(event) => renameScenario(event.target.value)}
        />
      </div>

      <Button size="sm" variant="outline" className="w-full justify-start" onClick={loadBlank}>
        <FilePlus2 /> New blank scene
      </Button>

      <div>
        <Label>Load a preset</Label>
        <Select
          onValueChange={(presetId) => {
            const preset = SCENARIO_PRESETS.find((entry) => entry.id === presetId);
            if (preset) {
              loadScenario(preset.build());
            }
          }}
        >
          <SelectTrigger className="h-7">
            <SelectValue placeholder="Choose a preset…" />
          </SelectTrigger>
          <SelectContent>
            {SCENARIO_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {SCENARIO_PRESETS.map((preset) => (
            <li key={preset.id} className="text-[11px] text-[var(--muted-foreground)]">
              <span className="font-medium text-[var(--foreground)]">{preset.name}</span> —{" "}
              {preset.tests}
            </li>
          ))}
        </ul>
      </div>

      <Separator />

      <div>
        <Label>Generate a random scene</Label>
        <div className="mt-1 flex items-end gap-2">
          <div className="flex-1">
            <Input
              type="number"
              className="h-7"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value) || 0)}
              aria-label="Generator seed"
            />
          </div>
          <Button size="xs" variant="outline" onClick={() => loadScenario(generateScenario({ seed }))}>
            <Dices /> Generate
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
          Same seed → same world. Useful for stress repros.
        </p>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-1.5">
        <Button size="xs" variant="outline" onClick={() => downloadScenario(scenario)}>
          <Download /> Export
        </Button>
        <Button size="xs" variant="outline" onClick={() => fileInput.current?.click()}>
          <Upload /> Import
        </Button>
        <Button size="xs" variant="outline" onClick={() => loadScenario(duplicateScenario(scenario))}>
          <Copy /> Duplicate
        </Button>
        <Button size="xs" variant="outline" onClick={loadBlank}>
          <RotateCcw /> Reset blank
        </Button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }
          void file.text().then((text) => {
            const result = importScenarioJson(text);
            if (result.ok) {
              loadScenario(result.scenario);
            } else {
              setImportErrors(result.errors);
            }
          });
          event.target.value = "";
        }}
      />

      {importErrors.length > 0 ? (
        <div className="rounded-md border border-[var(--fail)] p-2">
          <p className="text-[11px] font-semibold text-[var(--fail)]">Import failed</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {importErrors.slice(0, 8).map((error) => (
              <li key={error} className="font-mono text-[10px] break-words">
                {error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Separator />
      <ScenarioStats />
    </div>
  );
}

export function ScenarioStats() {
  const scenario = useScenarioStore((state) => state.scenario);

  const online = scenario.drivers.filter((driver) => driver.status === "ONLINE").length;
  const busy = scenario.drivers.filter((driver) => driver.currentRideId !== null).length;
  const vehiclesById = new Map(scenario.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const totalSeats = scenario.drivers.reduce(
    (sum, driver) => sum + (vehiclesById.get(driver.vehicleId)?.totalSeats ?? 0),
    0,
  );
  const waiting = scenario.passengers.filter((passenger) => passenger.state === "WAITING").length;
  const onboard = scenario.passengers.filter(
    (passenger) => passenger.state === "PICKED_UP" || passenger.state === "IN_RIDE",
  ).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold tracking-wide uppercase">Scene statistics</h4>
        {scenario.seed !== undefined ? <Badge variant="outline">seed {scenario.seed}</Badge> : null}
      </div>
      <div className="mt-1">
        <Metric label="Drivers" value={String(scenario.drivers.length)} />
        <Metric label="Online" value={String(online)} />
        <Metric label="On a ride" value={String(busy)} />
        <Metric label="Fleet seats" value={String(totalSeats)} />
        <Metric label="Existing rides" value={String(scenario.rides.length)} />
        <Metric label="Passengers" value={String(scenario.passengers.length)} />
        <Metric label="Waiting / aboard" value={`${waiting} / ${onboard}`} />
        <Metric label="Pending requests" value={String(scenario.requests.length)} />
      </div>
    </div>
  );
}
