import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator, Slider } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RoutingMode, ScoringWeights } from "@/domain/entities";
import { DEFAULT_STAGE_ORDER } from "@/domain/settings";
import { normalizeWeights } from "@/matching/normalize";
import { useSettingsStore } from "@/stores/settingsStore";

import { NumberField } from "./VehicleForm";

const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  driverImpact: "Driver impact",
  existingPassengerImpact: "Existing rider impact",
  newPassengerImpact: "New rider impact",
  pickupDelay: "Pickup wait",
};

export function SettingsPanel() {
  const settings = useSettingsStore((state) => state.settings);
  const set = useSettingsStore((state) => state.set);
  const setWeight = useSettingsStore((state) => state.setWeight);
  const reset = useSettingsStore((state) => state.reset);
  const useDefaultOrder = useSettingsStore((state) => state.useDefaultOrder);

  const normalized = normalizeWeights(settings.weights);
  const usingDefaultOrder = settings.stageOrder.join(",") === DEFAULT_STAGE_ORDER.join(",");

  return (
    <div className="flex flex-col gap-3">
      <Section title="Spatial search">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          H3 bounds the search area only. A ring index is a hop count, never a distance.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="H3 resolution"
            value={settings.h3Resolution}
            min={0}
            max={15}
            onChange={(value) => set("h3Resolution", value)}
          />
          <NumberField
            label="Max H3 ring"
            value={settings.maxH3Ring}
            min={0}
            max={12}
            onChange={(value) => set("maxH3Ring", value)}
          />
          <NumberField
            label="Min usable candidates"
            value={settings.minimumUsableCandidates}
            min={1}
            onChange={(value) => set("minimumUsableCandidates", value)}
          />
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Ring expansion counts online drivers with matching vehicle and seats when deciding
          whether to stop early — the same predicates eligibility applies later.
        </p>
      </Section>

      <Section title="Corridor proximity">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Max pickup → route (km)"
            value={settings.maxPickupToRouteDistanceKm}
            min={0}
            onChange={(value) => set("maxPickupToRouteDistanceKm", value)}
          />
          <NumberField
            label="Max bearing difference (deg)"
            value={settings.maxBearingDifferenceDeg}
            min={0}
            max={180}
            onChange={(value) => set("maxBearingDifferenceDeg", value)}
          />
        </div>
      </Section>

      <Section title="Route feasibility">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Max existing drop delay (%)"
            value={settings.maxExistingPassengerDelayPercent}
            min={0}
            onChange={(value) => set("maxExistingPassengerDelayPercent", value)}
          />
          <NumberField
            label="Short-trip solo ETA max (min)"
            value={settings.shortTripSoloEtaMaxMin}
            min={0}
            onChange={(value) => set("shortTripSoloEtaMaxMin", value)}
          />
          <NumberField
            label="Short-trip drop delay (%)"
            value={settings.shortTripDelayPercent}
            min={0}
            onChange={(value) => set("shortTripDelayPercent", value)}
          />
          <NumberField
            label="Max new pickup delay (min)"
            value={settings.maxNewPassengerPickupDelayMin}
            min={0}
            onChange={(value) => set("maxNewPassengerPickupDelayMin", value)}
          />
          <NumberField
            label="Max new rider ride detour (min)"
            value={settings.maxNewPassengerRideDetourMin}
            min={0}
            onChange={(value) => set("maxNewPassengerRideDetourMin", value)}
          />
          <NumberField
            label="Max pooled passengers"
            value={settings.maxPooledPassengers}
            min={1}
            onChange={(value) => set("maxPooledPassengers", value)}
          />
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Existing passenger drop delays are a percent of solo trip ETA. Trips at or below the
          short-trip ETA use the higher short-trip percent (default 250%).
        </p>
      </Section>

      <Section title="Routing and cost">
        <div>
          <Label>Routing engine</Label>
          <Select
            value={settings.routingMode}
            onValueChange={(value) => set("routingMode", value as RoutingMode)}
          >
            <SelectTrigger className="h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AUTO">Auto — Google when available</SelectItem>
              <SelectItem value="GOOGLE">Google Routes only</SelectItem>
              <SelectItem value="MOCK">Mock (no API calls)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Routed insertions / driver"
            value={settings.maxRoutedInsertionsPerDriver}
            min={1}
            onChange={(value) => set("maxRoutedInsertionsPerDriver", value)}
          />
          <NumberField
            label="Max routing calls / run"
            value={settings.maxRoutingCallsPerRun}
            min={1}
            onChange={(value) => set("maxRoutingCallsPerRun", value)}
          />
          <NumberField
            label="Max optimizer calls / run"
            value={settings.maxOptimizerCallsPerRun}
            min={1}
            onChange={(value) => set("maxOptimizerCallsPerRun", value)}
          />
          <NumberField
            label="Optimizer timeout (ms)"
            value={settings.optimizerTimeoutMs}
            min={1000}
            onChange={(value) => set("optimizerTimeoutMs", value)}
          />
          <NumberField
            label="Estimated speed (km/h)"
            value={settings.estimatedSpeedKmh}
            min={1}
            onChange={(value) => set("estimatedSpeedKmh", value)}
          />
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Routing and the optimizer have separate budgets because they are billed differently:
          routing prices per call, OptimizeTours per shipment. Estimated speed is used only by the
          stage 6 pre-filter, never for a reported ETA.
        </p>
      </Section>

      <Section title="Stage order">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          The fourteen stages have strict data dependencies, so the Overview&apos;s order is the
          only one that runs end to end.
        </p>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant={usingDefaultOrder ? "default" : "outline"}
            onClick={useDefaultOrder}
          >
            Overview order (default)
          </Button>
        </div>
      </Section>

      <Section title="Scoring weights">
        {(Object.keys(WEIGHT_LABELS) as (keyof ScoringWeights)[]).map((key) => (
          <div key={key}>
            <div className="flex items-center justify-between">
              <Label>{WEIGHT_LABELS[key]}</Label>
              <span className="tabular text-[11px] text-[var(--muted-foreground)]">
                {settings.weights[key]} → {(normalized[key] * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              className="mt-1"
              value={[settings.weights[key]]}
              min={0}
              max={100}
              step={5}
              onValueChange={([value]) => setWeight(key, value ?? 0)}
            />
          </div>
        ))}
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Weights are rescaled to sum to 100%. Fairness is a placeholder derived from mock driver
          history and defaults to zero so it never quietly moves a result.
        </p>
      </Section>

      <Separator />
      <Button size="sm" variant="outline" onClick={reset}>
        <RotateCcw /> Reset to defaults
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-[11px] font-semibold tracking-wide uppercase">{title}</h4>
      {children}
    </div>
  );
}
