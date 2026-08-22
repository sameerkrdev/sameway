import { FlaskConical, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { BRIEF_STAGE_ORDER } from "@/domain/settings";
import { normalizeWeights } from "@/matching/normalize";
import { useSettingsStore } from "@/stores/settingsStore";

import { NumberField } from "./VehicleForm";

const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  eta: "Pickup ETA",
  distance: "Pickup distance",
  detour: "Route detour",
  routeQuality: "Existing rider impact",
  fairness: "Driver fairness",
};

export function SettingsPanel() {
  const settings = useSettingsStore((state) => state.settings);
  const set = useSettingsStore((state) => state.set);
  const setWeight = useSettingsStore((state) => state.setWeight);
  const reset = useSettingsStore((state) => state.reset);
  const useDefaultOrder = useSettingsStore((state) => state.useDefaultOrder);
  const useBriefOrder = useSettingsStore((state) => state.useBriefOrder);

  const normalized = normalizeWeights(settings.weights);
  const usingBriefOrder = settings.stageOrder.join(",") === BRIEF_STAGE_ORDER.join(",");

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
          Expansion counts only drivers that survive the cheap filters, so a cluster of offline
          drivers cannot end the search early.
        </p>
      </Section>

      <Section title="Pickup proximity">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Max pickup ETA (min)"
            value={settings.maxPickupEtaMin}
            min={0}
            onChange={(value) => set("maxPickupEtaMin", value)}
          />
          <NumberField
            label="Max pickup distance (km)"
            value={settings.maxPickupRoadDistanceKm}
            min={0}
            onChange={(value) => set("maxPickupRoadDistanceKm", value)}
          />
        </div>
      </Section>

      <Section title="Route feasibility">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Max detour (%)"
            value={settings.maxDetourPercent}
            min={0}
            onChange={(value) => set("maxDetourPercent", value)}
          />
          <NumberField
            label="Max added distance (km)"
            value={settings.maxAdditionalDistanceKm}
            min={0}
            onChange={(value) => set("maxAdditionalDistanceKm", value)}
          />
          <NumberField
            label="Max added duration (min)"
            value={settings.maxAdditionalDurationMin}
            min={0}
            onChange={(value) => set("maxAdditionalDurationMin", value)}
          />
          <NumberField
            label="Max existing rider delay (min)"
            value={settings.maxExistingPassengerDelayMin}
            min={0}
            onChange={(value) => set("maxExistingPassengerDelayMin", value)}
          />
          <NumberField
            label="Max new pickup delay (min)"
            value={settings.maxNewPassengerPickupDelayMin}
            min={0}
            onChange={(value) => set("maxNewPassengerPickupDelayMin", value)}
          />
          <NumberField
            label="Max pooled passengers"
            value={settings.maxPooledPassengers}
            min={1}
            onChange={(value) => set("maxPooledPassengers", value)}
          />
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Existing rider delay catches what aggregate detour cannot: a route can be barely longer
          overall while making one passenger badly late.
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
        </div>
      </Section>

      <Section title="Stage order">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          The default runs the cheap ETA matrix before route insertion. The brief&apos;s order does
          the opposite and costs considerably more.
        </p>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant={usingBriefOrder ? "outline" : "default"}
            onClick={useDefaultOrder}
          >
            ETA first (default)
          </Button>
          <Button
            size="xs"
            variant={usingBriefOrder ? "default" : "outline"}
            onClick={useBriefOrder}
          >
            Route first (brief)
          </Button>
        </div>
      </Section>

      <Section title="Scoring weights">
        {(Object.keys(WEIGHT_LABELS) as (keyof ScoringWeights)[]).map((key) => (
          <div key={key}>
            <div className="flex items-center justify-between">
              <Label>
                {WEIGHT_LABELS[key]}
                {key === "fairness" ? (
                  <Badge variant="warn" className="ml-1">
                    <FlaskConical className="size-3" />
                    Experimental
                  </Badge>
                ) : null}
              </Label>
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
