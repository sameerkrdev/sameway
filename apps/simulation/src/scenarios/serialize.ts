import type { Scenario } from "@/domain/entities";
import { parseScenario, type ScenarioParseResult } from "@/domain/schemas";
import { createId } from "@/lib/ids";

export function exportScenarioJson(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}

export function importScenarioJson(text: string): ScenarioParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [`Not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`],
    };
  }

  return parseScenario(parsed);
}

export function downloadScenario(scenario: Scenario): void {
  const blob = new Blob([exportScenarioJson(scenario)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${slug(scenario.name)}.scenario.json`;
  anchor.click();

  URL.revokeObjectURL(url);
}

/**
 * Copies a scenario under fresh ids so the duplicate can be edited without
 * colliding with the original in saved-scenario storage.
 */
export function duplicateScenario(scenario: Scenario): Scenario {
  return {
    ...structuredClone(scenario),
    id: createId("sc"),
    name: `${scenario.name} (copy)`,
  };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scenario"
  );
}
