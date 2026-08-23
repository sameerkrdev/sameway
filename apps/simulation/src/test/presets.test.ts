import { describe, expect, it } from "vitest";

import type { Scenario } from "@/domain/entities";
import type { MatchingResult } from "@/matching/types";
import { getPreset, SCENARIO_PRESETS } from "@/scenarios/presets";

import { runFixture } from "./fixtures/runEngine";

/**
 * Every preset earns its name.
 *
 * The plan asked for this to be checked by hand in the dev server. Asserted
 * here instead: a preset whose claim quietly stops being true is a worse
 * problem than one that never worked, because the lab is what people trust to
 * demonstrate the pipeline.
 */
async function runPreset(id: string): Promise<{ scenario: Scenario; result: MatchingResult }> {
  const preset = getPreset(id);
  if (!preset) {
    throw new Error(`No preset with id ${id}`);
  }

  const scenario = preset.build();
  const request = scenario.requests[0];
  if (!request) {
    throw new Error(`Preset ${id} has no request`);
  }

  return { scenario, result: await runFixture(scenario, request) };
}

function corridorNotes(result: MatchingResult) {
  return result.stageResults.find((stage) => stage.stageId === "h3RouteCorridor")?.notes;
}

describe("scenario presets", () => {
  it("every preset builds a scenario with a request", () => {
    for (const preset of SCENARIO_PRESETS) {
      const scenario = preset.build();
      expect(scenario.requests.length, preset.id).toBeGreaterThan(0);
      expect(scenario.drivers.length, preset.id).toBeGreaterThan(0);
    }
  });

  it("stamps every committed stop with an achievable promise", async () => {
    // originalEtaMin defaults to 0 in the builders. Left at 0 it is not a
    // default, it is a promise nobody can keep, and every long committed route
    // breaches its own delay budget before matching starts.
    for (const preset of SCENARIO_PRESETS) {
      const scenario = preset.build();

      for (const ride of scenario.rides) {
        const etas = ride.stops.map((stop) => stop.originalEtaMin);

        expect(etas.every((eta) => eta > 0), `${preset.id}/${ride.id}`).toBe(true);
        // Monotonic: a later stop cannot be promised earlier than an earlier one.
        expect([...etas].sort((a, b) => a - b), `${preset.id}/${ride.id}`).toEqual(etas);
      }
    }
  });

  it("Sparse Driver Area runs the ring search out without meeting the threshold", async () => {
    const { scenario, result } = await runPreset("sparse-driver-area");
    const notes = corridorNotes(result);

    expect(notes?.searchExhausted).toBe(true);
    expect(notes?.stoppedAtRing).toBe(scenario.settings.maxH3Ring);
  });

  it("Dense Driver Area stops at ring 0", async () => {
    const { result } = await runPreset("dense-driver-area");

    expect(corridorNotes(result)?.stoppedAtRing).toBe(0);
    expect(corridorNotes(result)?.searchExhausted).toBe(false);
  });

  it("Busy Delhi satisfies the threshold in ring 0", async () => {
    const { result } = await runPreset("busy-delhi");

    expect(corridorNotes(result)?.stoppedAtRing).toBe(0);
    expect(corridorNotes(result)?.searchExhausted).toBe(false);
  });
});

describe("Corridor Behind Vehicle", () => {
  it("rejects a pickup on the route the vehicle has already driven", async () => {
    // The Overview's Example 11, and the single most important corridor
    // regression: the pickup sits exactly on this ride's road, but behind the
    // vehicle. Proximity to the historical route must never make a ride look
    // compatible.
    const { result } = await runPreset("corridor-behind-vehicle");

    const behind = result.evaluations.find((entry) => entry.driverId === "D_BEHIND")!;

    expect(behind.finalStatus).toBe("FAILED");
    expect(behind.failedAtStageId).toBe("h3RouteCorridor");
    expect(behind.reasons.map((entry) => entry.code)).toContain("CORRIDOR_NO_MATCH");
  });

  it("still matches the driver running the same corridor who has not passed it", async () => {
    // Without this the preset would prove nothing: a pickup nobody can serve
    // is rejected for the wrong reason.
    const { result } = await runPreset("corridor-behind-vehicle");

    const ahead = result.evaluations.find((entry) => entry.driverId === "D_AHEAD")!;

    expect(ahead.stageResults.find((stage) => stage.reasons.length > 0)).toBeDefined();
    expect(
      ahead.failedAtStageId === "h3RouteCorridor",
      "D_AHEAD must clear the corridor stage",
    ).toBe(false);
  });
});
